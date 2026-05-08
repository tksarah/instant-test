const http = require('http');

const port = parseInt(process.env.PORT, 10) || 3000;

function req(method, path, data, headers){
  const opts = { hostname: 'localhost', port, path, method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) };
  return new Promise((resolve, reject)=>{
    const r = http.request(opts, res=>{
      let body='';
      res.on('data', c=> body+=c);
      res.on('end', ()=>{
        try{ const json = JSON.parse(body); resolve({ status: res.statusCode, body: json, headers: res.headers }); } catch(e){ resolve({ status: res.statusCode, body, headers: res.headers }); }
      });
    });
    r.on('error', reject);
    if(data) r.write(JSON.stringify(data));
    r.end();
  });
}

function extractCookie(headers){
  const setCookie = headers && headers['set-cookie'];
  if(!Array.isArray(setCookie) || !setCookie.length) return '';
  return setCookie.map(cookie => String(cookie).split(';')[0]).join('; ');
}

function assert(cond, msg){
  if(!cond){
    throw new Error(msg);
  }
}

(async ()=>{
  try{
    console.log('LIST PUBLIC CLASSES');
    const classes = await req('GET', '/api/classes');
    console.log(classes);
    assert(classes.status === 200 && Array.isArray(classes.body) && classes.body.length > 0, '公開クラスが必要です');
    const classId = classes.body[0].id;

    console.log('\nLIST TESTS');
    const tests = await req('GET', '/api/tests?class_id=' + encodeURIComponent(classId) + '&public=1');
    console.log(tests);
    assert(tests.status === 200 && Array.isArray(tests.body) && tests.body.length > 0, '公開テストが必要です');
    const testId = tests.body[0].id;

    console.log('CREATE STUDENT');
    const student = await req('POST','/api/students', { class_id: classId, name: '生徒太郎' });
    console.log(student);
    assert(student.status === 200 && student.body && student.body.id, '生徒作成に失敗しました');
    const studentCookie = extractCookie(student.headers);
    assert(studentCookie, '生徒セッションクッキーが必要です');
    const studentId = student.body.id;

    console.log('\nCREATE EXAM SESSION');
    const session = await req('POST','/api/exam-sessions', { student_id: studentId, test_id: testId }, { Cookie: studentCookie });
    console.log(session);
    assert(session.status === 200 && session.body && session.body.id, '受験セッション作成に失敗しました');
    const sessionId = session.body.id;

    console.log('\nGET SESSION QUESTIONS');
    const questions = await req('GET','/api/exam-sessions/' + encodeURIComponent(sessionId) + '/questions', null, { Cookie: studentCookie });
    console.log(questions);
    assert(questions.status === 200 && Array.isArray(questions.body) && questions.body.length > 0, '問題取得に失敗しました');
    const question = questions.body[0];
    assert(question && question.id, '問題IDが必要です');
    const choiceId = Array.isArray(question.choices) && question.choices.length ? question.choices[0].id : null;
    assert(choiceId, '選択肢IDが必要です');

    console.log('\nSUBMIT ANSWER (choice_id=1)');
    const submit = await req('POST','/api/submit-answer', { student_id: studentId, test_id: testId, question_id: question.id, choice_id: choiceId, session_id: sessionId }, { Cookie: studentCookie });
    console.log(submit);
    assert(submit.status === 200, '回答送信に失敗しました');
    assert(!submit.body.feedback, 'deferred_summary モードでは即時フィードバックを返さない必要があります');

    console.log('\nFINISH SESSION');
    const finish = await req('PUT', '/api/exam-sessions/' + encodeURIComponent(sessionId) + '/finish', null, { Cookie: studentCookie });
    console.log(finish);
    assert(finish.status === 200, '受験終了に失敗しました');

    console.log('\nSUMMARY');
    const summary = await req('GET', `/api/tests/${encodeURIComponent(testId)}/summary?student_id=${encodeURIComponent(studentId)}&session_id=${encodeURIComponent(sessionId)}`, null, { Cookie: studentCookie });
    console.log(summary);
    assert(summary.status === 200 && summary.body && Array.isArray(summary.body.details), 'summary 取得に失敗しました');

  }catch(e){ console.error('ERROR', e); process.exitCode=1; }
})();
