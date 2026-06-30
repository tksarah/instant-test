const crypto = require('crypto');
const http = require('http');
const db = require('./db');

const port = parseInt(process.env.PORT, 10) || 3000;

function req(method, path, data, headers){
  const opts = {
    hostname: 'localhost',
    port,
    path,
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {})
  };
  return new Promise((resolve, reject) => {
    const request = http.request(opts, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        let parsed = body;
        try{
          parsed = JSON.parse(body);
        }catch(_err){
          // keep raw body
        }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    request.on('error', reject);
    if(data) request.write(JSON.stringify(data));
    request.end();
  });
}

function dbRun(sql, params){
  return new Promise((resolve, reject) => {
    db.run(sql, params || [], function(err){
      if(err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function assert(cond, msg){
  if(!cond) throw new Error(msg);
}

function extractCookie(headers){
  const setCookie = headers && headers['set-cookie'];
  if(!Array.isArray(setCookie) || !setCookie.length) return '';
  return setCookie.map(cookie => String(cookie).split(';')[0]).join('; ');
}

(async () => {
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);
  const token = crypto.randomBytes(24).toString('hex');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const created = { teacherId: null, classId: null, testId: null, questionId: null, studentId: null, sessionIds: [] };

  try{
    const teacher = await dbRun(
      'INSERT INTO teachers (username, display_name, password_hash, active, created_at) VALUES (?,?,?,?,?)',
      ['fill-blank-test-' + unique, 'Fill Blank API Test', 'dummy-hash', 1, now]
    );
    created.teacherId = teacher.lastID;

    await dbRun(
      'INSERT INTO teacher_sessions (token, teacher_id, expires_at, created_at, last_seen_at) VALUES (?,?,?,?,?)',
      [token, created.teacherId, expiresAt, now, now]
    );

    const cls = await dbRun('INSERT INTO classes (teacher_id, name) VALUES (?,?)', [created.teacherId, 'Fill Blank Class ' + unique]);
    created.classId = cls.lastID;
    const teacherCookie = { Cookie: 'teacher_session=' + encodeURIComponent(token) };

    const createdTest = await req('POST', '/api/tests', {
      class_id: created.classId,
      name: 'Fill Blank Test ' + unique,
      description: '',
      public: 1,
      randomize: 0,
      answer_mode: 'immediate_feedback'
    }, teacherCookie);
    assert(createdTest.status === 200 && createdTest.body && createdTest.body.id, 'test create failed');
    created.testId = createdTest.body.id;

    const question = await req('POST', '/api/tests/' + encodeURIComponent(created.testId) + '/questions', {
      type: 'fill_blank',
      text: '水は____と酸素からできている。',
      points: 1,
      explanation: '水は水素と酸素からできています。',
      choices: [
        { text: '水素', is_correct: 1 },
        { text: '窒素', is_correct: 0 },
        { text: '炭素', is_correct: 0 }
      ]
    }, teacherCookie);
    assert(question.status === 200 && question.body && question.body.id, 'fill_blank question create failed');
    created.questionId = question.body.id;

    const teacherQuestions = await req('GET', '/api/tests/' + encodeURIComponent(created.testId) + '/questions', null, teacherCookie);
    assert(teacherQuestions.status === 200 && Array.isArray(teacherQuestions.body) && teacherQuestions.body.length === 1, 'teacher questions fetch failed');
    assert(teacherQuestions.body[0].type === 'fill_blank', 'teacher question type should be fill_blank');
    assert((teacherQuestions.body[0].text.match(/____/g) || []).length === 1, 'fill_blank question should keep one blank marker');
    assert(teacherQuestions.body[0].choices.filter(choice => choice.is_correct === 1 || choice.is_correct === true).length === 1, 'fill_blank should have one correct choice');

    const student = await req('POST', '/api/students', { class_id: created.classId, name: 'fill blank student ' + unique });
    assert(student.status === 200 && student.body && student.body.id, 'student create failed');
    created.studentId = student.body.id;
    const studentCookie = { Cookie: extractCookie(student.headers) };

    const correctSession = await req('POST', '/api/exam-sessions', {
      student_id: created.studentId,
      test_id: created.testId
    }, studentCookie);
    assert(correctSession.status === 200 && correctSession.body && correctSession.body.id, 'correct session create failed');
    created.sessionIds.push(correctSession.body.id);

    const studentQuestions = await req('GET', '/api/exam-sessions/' + encodeURIComponent(correctSession.body.id) + '/questions', null, studentCookie);
    assert(studentQuestions.status === 200 && Array.isArray(studentQuestions.body) && studentQuestions.body.length === 1, 'student questions fetch failed');
    const studentQuestion = studentQuestions.body[0];
    assert(studentQuestion.type === 'fill_blank', 'student question type should be fill_blank');
    assert(Array.isArray(studentQuestion.choices) && studentQuestion.choices.length === 3, 'student choices should be present');
    assert(typeof studentQuestion.choices[0].is_correct === 'undefined', 'student choices should not expose correctness');

    const correctChoice = studentQuestion.choices.find(choice => choice.text === '水素');
    const wrongChoice = studentQuestion.choices.find(choice => choice.text === '窒素');
    assert(correctChoice && wrongChoice, 'expected fill_blank candidates missing');

    const correctSubmit = await req('POST', '/api/submit-answer', {
      student_id: created.studentId,
      test_id: created.testId,
      question_id: studentQuestion.id,
      choice_id: correctChoice.id,
      session_id: correctSession.body.id
    }, studentCookie);
    assert(correctSubmit.status === 200 && correctSubmit.body && correctSubmit.body.accepted, 'correct fill_blank submit failed');
    assert(correctSubmit.body.feedback && correctSubmit.body.feedback.correct === true, 'correct fill_blank answer should be marked correct');
    assert(correctSubmit.body.feedback.type === 'fill_blank', 'fill_blank feedback should preserve question type');

    const finishCorrect = await req('PUT', '/api/exam-sessions/' + encodeURIComponent(correctSession.body.id) + '/finish', null, studentCookie);
    assert(finishCorrect.status === 200, 'correct fill_blank session finish failed');

    const summary = await req(
      'GET',
      '/api/tests/' + encodeURIComponent(created.testId) + '/summary?student_id=' + encodeURIComponent(created.studentId) + '&session_id=' + encodeURIComponent(correctSession.body.id),
      null,
      studentCookie
    );
    assert(summary.status === 200 && summary.body && Array.isArray(summary.body.details), 'fill_blank summary fetch failed');
    assert(summary.body.details[0] && summary.body.details[0].type === 'fill_blank', 'fill_blank summary should preserve question type');

    const wrongSession = await req('POST', '/api/exam-sessions', {
      student_id: created.studentId,
      test_id: created.testId
    }, studentCookie);
    assert(wrongSession.status === 200 && wrongSession.body && wrongSession.body.id, 'wrong session create failed');
    created.sessionIds.push(wrongSession.body.id);

    const wrongSubmit = await req('POST', '/api/submit-answer', {
      student_id: created.studentId,
      test_id: created.testId,
      question_id: studentQuestion.id,
      choice_id: wrongChoice.id,
      session_id: wrongSession.body.id
    }, studentCookie);
    assert(wrongSubmit.status === 200 && wrongSubmit.body && wrongSubmit.body.accepted, 'wrong fill_blank submit failed');
    assert(wrongSubmit.body.feedback && wrongSubmit.body.feedback.correct === false, 'wrong fill_blank answer should be marked incorrect');
    assert(wrongSubmit.body.feedback.type === 'fill_blank', 'wrong fill_blank feedback should preserve question type');

    console.log('test_fill_blank_api: ok');
  }catch(error){
    console.error(error.message || error);
    process.exitCode = 1;
  }finally{
    try{ for(const sessionId of created.sessionIds) await dbRun('DELETE FROM exam_session_questions WHERE session_id=?', [sessionId]); }catch(_err){}
    try{ for(const sessionId of created.sessionIds) await dbRun('DELETE FROM student_answers WHERE session_id=?', [sessionId]); }catch(_err){}
    try{ for(const sessionId of created.sessionIds) await dbRun('DELETE FROM exam_sessions WHERE id=?', [sessionId]); }catch(_err){}
    try{ if(created.questionId) await dbRun('DELETE FROM choices WHERE question_id=?', [created.questionId]); }catch(_err){}
    try{ if(created.questionId) await dbRun('DELETE FROM questions WHERE id=?', [created.questionId]); }catch(_err){}
    try{ if(created.studentId) await dbRun('DELETE FROM students WHERE id=?', [created.studentId]); }catch(_err){}
    try{ if(created.testId) await dbRun('DELETE FROM tests WHERE id=?', [created.testId]); }catch(_err){}
    try{ if(created.classId) await dbRun('DELETE FROM classes WHERE id=?', [created.classId]); }catch(_err){}
    try{ if(created.teacherId) await dbRun('DELETE FROM teacher_sessions WHERE teacher_id=?', [created.teacherId]); }catch(_err){}
    try{ if(created.teacherId) await dbRun('DELETE FROM teachers WHERE id=?', [created.teacherId]); }catch(_err){}
    db.close();
  }
})();
