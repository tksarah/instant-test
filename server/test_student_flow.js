const http = require('http');

function req(method, path, data){
  const opts = { hostname: 'localhost', port: 3000, path, method, headers: { 'Content-Type': 'application/json' } };
  return new Promise((resolve, reject)=>{
    const r = http.request(opts, res=>{
      let body='';
      res.on('data', c=> body+=c);
      res.on('end', ()=>{
        try{ const json = JSON.parse(body); resolve(json); } catch(e){ resolve(body); }
      });
    });
    r.on('error', reject);
    if(data) r.write(JSON.stringify(data));
    r.end();
  });
}

(async ()=>{
  try{
    console.log('CREATE STUDENT');
    const student = await req('POST','/api/students', { class_id: 1, name: '生徒太郎' });
    console.log(student);

    console.log('\nLIST TESTS');
    const tests = await req('GET','/api/tests?class_id=1');
    console.log(tests);

    console.log('\nGET QUESTIONS for test 1');
    const questions = await req('GET','/api/tests/1/questions');
    console.log(questions);

    console.log('\nSUBMIT ANSWER (choice_id=1)');
    const submit = await req('POST','/api/submit-answer', { student_id: student.id || 1, test_id: 1, question_id: 1, choice_id: 1 });
    console.log(submit);

    console.log('\nSTUDENT ANSWERS');
    const answers = await req('GET', `/api/studentAnswers?student_id=${student.id||1}&test_id=1`);
    console.log(answers);

  }catch(e){ console.error('ERROR', e); process.exitCode=1; }
})();
