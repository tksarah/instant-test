const http = require('http');

function req(method, path, data){
  const opts = {
    hostname: 'localhost',
    port: 3000,
    path,
    method,
    headers: { 'Content-Type': 'application/json' }
  };

  return new Promise((resolve, reject) => {
    const request = http.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try{
          resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null });
        }catch(error){
          reject(error);
        }
      });
    });
    request.on('error', reject);
    if(data) request.write(JSON.stringify(data));
    request.end();
  });
}

function assert(condition, message){
  if(!condition){
    throw new Error(message);
  }
}

(async function(){
  try{
    const unique = Date.now();
    const testName = 'delete-question-' + unique;

    const createdTest = await req('POST', '/api/tests', { name: testName, public: 0, randomize: 0 });
    assert(createdTest.status === 200 && createdTest.body && createdTest.body.id, 'テスト作成に失敗しました');
    const testId = createdTest.body.id;

    const firstQuestion = await req('POST', '/api/tests/' + testId + '/questions', {
      text: '最初の問題',
      type: 'single',
      points: 1,
      choices: [
        { text: 'A', is_correct: 1 },
        { text: 'B', is_correct: 0 }
      ]
    });
    assert(firstQuestion.status === 200 && firstQuestion.body && firstQuestion.body.id, '1問目の作成に失敗しました');

    const secondQuestion = await req('POST', '/api/tests/' + testId + '/questions', {
      text: '2問目の問題',
      type: 'single',
      points: 1,
      choices: [
        { text: 'C', is_correct: 1 },
        { text: 'D', is_correct: 0 }
      ]
    });
    assert(secondQuestion.status === 200 && secondQuestion.body && secondQuestion.body.id, '2問目の作成に失敗しました');

    const beforeDelete = await req('GET', '/api/tests/' + testId + '/questions');
    assert(beforeDelete.status === 200, '削除前の問題取得に失敗しました');
    assert(Array.isArray(beforeDelete.body) && beforeDelete.body.length === 2, '削除前の問題数が不正です');

    const deleted = await req('DELETE', '/api/questions/' + firstQuestion.body.id);
    assert(deleted.status === 200, '問題削除APIが失敗しました');
    assert(deleted.body && deleted.body.deleted === true, '問題削除結果が不正です');

    const afterDelete = await req('GET', '/api/tests/' + testId + '/questions');
    assert(afterDelete.status === 200, '削除後の問題取得に失敗しました');
    assert(Array.isArray(afterDelete.body) && afterDelete.body.length === 1, '削除後の問題数が不正です');
    assert(afterDelete.body[0].id === secondQuestion.body.id, '削除対象ではない問題が残っていません');

    console.log('Question delete regression check passed.');
  }catch(error){
    console.error(error.message || error);
    process.exitCode = 1;
  }
})();