const http = require('http');

const HOST = 'localhost';
const PORT = 3000;

function req(method, path, data){
  return new Promise((resolve, reject)=>{
    const sdata = data ? JSON.stringify(data) : null;
    const options = { hostname: HOST, port: PORT, path: path, method: method, headers: { 'Accept': 'application/json' } };
    if(sdata){ options.headers['Content-Type'] = 'application/json'; options.headers['Content-Length'] = Buffer.byteLength(sdata); }
    const r = http.request(options, res => {
      let body = '';
      res.on('data', c => body += c.toString());
      res.on('end', () => {
        const ct = res.headers['content-type'] || '';
        if(ct.includes('application/json')){
          try{ return resolve({ status: res.statusCode, body: JSON.parse(body) }); }catch(e){ return resolve({ status: res.statusCode, body: body }); }
        }
        return resolve({ status: res.statusCode, body: body });
      });
    });
    r.on('error', err => reject(err));
    if(sdata) r.write(sdata);
    r.end();
  });
}

(async function main(){
  try{
    console.log('1) Fetching classes...');
    const classesRes = await req('GET','/api/classes');
    const classes = Array.isArray(classesRes.body) ? classesRes.body : (classesRes.body && classesRes.body.value ? classesRes.body.value : []);
    if(classes.length === 0){ console.error('No classes found'); process.exit(1); }
    const classId = classes[0].id;
    console.log(' -> using class id', classId);

    console.log('2) Creating a student...');
    const name = 'sim_user_' + Date.now();
    const studentRes = await req('POST','/api/students', { class_id: classId, name });
    if(studentRes.status < 200 || studentRes.status >= 300){ console.error('Student creation failed', studentRes); process.exit(1); }
    const student = studentRes.body;
    console.log(' -> created student', student.id, student.name);

    console.log('3) Fetching tests for class...');
    const testsRes = await req('GET', `/api/tests?class_id=${encodeURIComponent(classId)}&public=1`);
    const tests = Array.isArray(testsRes.body) ? testsRes.body : (testsRes.body && testsRes.body.value ? testsRes.body.value : []);
    if(tests.length === 0){ console.error('No tests found for class', classId); process.exit(1); }
    const test = tests[0];
    console.log(' -> using test', test.id, test.name);

    console.log('4) Creating exam session...');
    const sessRes = await req('POST','/api/exam-sessions', { student_id: student.id, test_id: test.id });
    if(sessRes.status < 200 || sessRes.status >= 300){ console.error('Failed to create session', sessRes); process.exit(1); }
    const session = sessRes.body;
    console.log(' -> session id', session.id, 'started_at', session.started_at);

    console.log('5) Fetching questions...');
    const qsRes = await req('GET', `/api/tests/${encodeURIComponent(test.id)}/questions`);
    const questions = Array.isArray(qsRes.body) ? qsRes.body : (qsRes.body && qsRes.body.value ? qsRes.body.value : []);
    if(questions.length === 0){ console.log('No questions for test', test.id); }

    console.log('6) Submitting answers for', questions.length, 'questions');
    for(const q of questions){
      const payload = { student_id: student.id, test_id: test.id, question_id: q.id, session_id: session.id };
      if(q.type === 'multiple') payload.choice_ids = (q.choices || []).map(c => c.id);
      else payload.choice_id = (q.choices && q.choices[0]) ? q.choices[0].id : null;
      const sub = await req('POST','/api/submit-answer', payload);
      console.log(` -> question ${q.id} submit status=${sub.status} resp=${JSON.stringify(sub.body)}`);
    }

    console.log('7) Finishing session...');
    const fin = await req('PUT', `/api/exam-sessions/${encodeURIComponent(session.id)}/finish`);
    console.log(' -> finish status', fin.status, 'body', fin.body);

    console.log('8) Checking /api/exams for student...');
    const exams = await req('GET', `/api/exams?student_id=${encodeURIComponent(student.id)}`);
    console.log(' -> exams response status', exams.status);
    console.log(JSON.stringify(exams.body, null, 2));

    console.log('Simulation complete.');
    process.exit(0);
  }catch(e){ console.error('Error in simulation:', e); process.exit(2); }
})();
