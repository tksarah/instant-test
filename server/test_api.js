const http = require('http');

function req(method, path, data){
  const opts = { hostname: 'localhost', port: 3000, path, method, headers: { 'Content-Type': 'application/json' } };
  return new Promise((resolve, reject)=>{
    const r = http.request(opts, res=>{
      let body='';
      res.on('data', c=> body+=c);
      res.on('end', ()=>{
        try{ const json = JSON.parse(body); resolve({ status: res.statusCode, body: json }); } catch(e){ resolve({ status: res.statusCode, body }); }
      });
    });
    r.on('error', reject);
    if(data) r.write(JSON.stringify(data));
    r.end();
  });
}

function assert(cond, msg){
  if(!cond){ console.error('ASSERTION FAILED:', msg); process.exitCode = 1; throw new Error(msg); }
}

(async ()=>{
  try{
    console.log('FETCH BEFORE QUESTIONS');
    const before = await req('GET','/api/tests/1/questions');
    console.log(JSON.stringify(before, null, 2));
    const beforeQ1 = (Array.isArray(before.body) ? before.body.find(q=>q.id===1) : null);
    const beforeChoicesCount = beforeQ1 ? (beforeQ1.choices ? beforeQ1.choices.length : 0) : null;
    if(beforeQ1 && Array.isArray(beforeQ1.choices)){
      assert(!('is_correct' in beforeQ1), 'question data should not expose is_correct');
      beforeQ1.choices.forEach(choice => assert(!('is_correct' in choice), 'choice data should not expose is_correct'));
    }

    console.log('UPDATE QUESTION 1 (text,type,points,explanation,public)');
    const qUpdate = await req('PUT','/api/questions/1', { text: '編集済みの問題文', type: 'single', points: 2, explanation: '解説を追加', public: 1 });
    console.log('UPDATE_Q:', qUpdate);
    assert(qUpdate.status === 200, 'PUT /api/questions/1 status');

    console.log('UPDATE CHOICE 1 (text,is_correct)');
    const cUpdate = await req('PUT','/api/choices/1', { text: '編集済みの選択肢', is_correct: 1 });
    console.log('UPDATE_C:', cUpdate);
    assert(cUpdate.status === 200, 'PUT /api/choices/1 status');

    console.log('ADD NEW CHOICE to question 1');
    const addChoice = await req('POST','/api/questions/1/choices', { text: '新しい選択肢', is_correct: 0 });
    console.log('ADD_CHOICE:', addChoice);
    assert(addChoice.status === 200, 'POST /api/questions/1/choices status');

    console.log('UPDATE TEST 1 metadata');
    const tUpdate = await req('PUT','/api/tests/1', { name: '編集済みテスト名', description: '説明を更新', public: 1, randomize: 1 });
    console.log('UPDATE_TEST:', tUpdate);
    assert(tUpdate.status === 200, 'PUT /api/tests/1 status');
    assert(tUpdate.body && tUpdate.body.name === '編集済みテスト名', 'test name updated');

    console.log('FETCH AFTER QUESTIONS');
    const after = await req('GET','/api/tests/1/questions');
    console.log(JSON.stringify(after, null, 2));
    const afterQ1 = (Array.isArray(after.body) ? after.body.find(q=>q.id===1) : null);
    assert(afterQ1, 'question 1 exists after update');

    assert(typeof afterQ1.explanation === 'undefined', 'explanation should stay hidden from student view');
    assert(typeof afterQ1.public === 'undefined', 'public flag should not be exposed to student view');
    assert(!('is_correct' in afterQ1), 'question data should not expose is_correct');
    (afterQ1.choices || []).forEach(choice => assert(!('is_correct' in choice), 'choice data should not expose is_correct'));

    if(beforeChoicesCount !== null){
      const expected = beforeChoicesCount + 1;
      const actual = afterQ1.choices ? afterQ1.choices.length : 0;
      assert(actual === expected, `choices count expected ${expected}, got ${actual}`);
    } else {
      assert(Array.isArray(afterQ1.choices) && afterQ1.choices.length >= 1, 'choices exist for question');
    }

    console.log('All checks passed.');
  }catch(e){ console.error('ERROR', e); process.exitCode = 1; }
})();
