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
  const created = { teacherId: null, classId: null, testId: null, questionIds: [], choiceIds: [], studentId: null, sessionId: null };

  try{
    const teacher = await dbRun(
      'INSERT INTO teachers (username, display_name, password_hash, active, created_at) VALUES (?,?,?,?,?)',
      ['exam-mode-test-' + unique, 'Exam Mode API Test', 'dummy-hash', 1, now]
    );
    created.teacherId = teacher.lastID;

    await dbRun(
      'INSERT INTO teacher_sessions (token, teacher_id, expires_at, created_at, last_seen_at) VALUES (?,?,?,?,?)',
      [token, created.teacherId, expiresAt, now, now]
    );

    const cls = await dbRun('INSERT INTO classes (teacher_id, name) VALUES (?,?)', [created.teacherId, 'Exam Mode Class ' + unique]);
    created.classId = cls.lastID;
    const teacherCookie = { Cookie: 'teacher_session=' + encodeURIComponent(token) };

    const createdTest = await req('POST', '/api/tests', {
      class_id: created.classId,
      name: 'Exam Mode Test ' + unique,
      description: '',
      public: 1,
      randomize: 0,
      answer_mode: 'exam_mode'
    }, teacherCookie);
    assert(createdTest.status === 200 && createdTest.body && createdTest.body.id, 'exam_mode test create failed');
    created.testId = createdTest.body.id;
    assert(createdTest.body.answer_mode === 'exam_mode', 'created test should preserve exam_mode');

    const invalidModeUpdate = await req('PUT', '/api/tests/' + encodeURIComponent(created.testId), {
      name: createdTest.body.name,
      description: '',
      public: 1,
      randomize: 0,
      class_id: created.classId,
      answer_mode: 'invalid_mode'
    }, teacherCookie);
    assert(invalidModeUpdate.status === 200 && invalidModeUpdate.body.answer_mode === 'deferred_summary', 'invalid answer_mode should normalize to deferred_summary');

    const examModeUpdate = await req('PUT', '/api/tests/' + encodeURIComponent(created.testId), {
      name: createdTest.body.name,
      description: '',
      public: 1,
      randomize: 0,
      class_id: created.classId,
      answer_mode: 'exam_mode'
    }, teacherCookie);
    assert(examModeUpdate.status === 200 && examModeUpdate.body.answer_mode === 'exam_mode', 'exam_mode update failed');

    const question = await req('POST', '/api/tests/' + encodeURIComponent(created.testId) + '/questions', {
      type: 'single',
      text: 'Exam mode question',
      points: 1,
      explanation: 'Hidden from students in exam mode',
      choices: [
        { text: 'Correct', is_correct: 1 },
        { text: 'Wrong', is_correct: 0 }
      ]
    }, teacherCookie);
    assert(question.status === 200 && question.body && question.body.id, 'question create failed');
    created.questionIds.push(question.body.id);

    const student = await req('POST', '/api/students', { class_id: created.classId, name: 'exam mode student ' + unique });
    assert(student.status === 200 && student.body && student.body.id, 'student create failed');
    created.studentId = student.body.id;
    const studentCookie = extractCookie(student.headers);

    const session = await req('POST', '/api/exam-sessions', {
      student_id: created.studentId,
      test_id: created.testId
    }, { Cookie: studentCookie });
    assert(session.status === 200 && session.body && session.body.id, 'exam session create failed');
    created.sessionId = session.body.id;

    const questions = await req('GET', '/api/exam-sessions/' + encodeURIComponent(created.sessionId) + '/questions', null, { Cookie: studentCookie });
    assert(questions.status === 200 && Array.isArray(questions.body) && questions.body.length === 1, 'session questions fetch failed');
    const firstQuestion = questions.body[0];
    assert(firstQuestion && Array.isArray(firstQuestion.choices) && firstQuestion.choices.length === 2, 'session question choices missing');

    const submit = await req('POST', '/api/submit-answer', {
      student_id: created.studentId,
      test_id: created.testId,
      question_id: firstQuestion.id,
      choice_id: firstQuestion.choices[0].id,
      session_id: created.sessionId
    }, { Cookie: studentCookie });
    assert(submit.status === 200, 'exam_mode submit failed');
    assert(!submit.body.feedback, 'exam_mode must not return feedback');

    const finish = await req('PUT', '/api/exam-sessions/' + encodeURIComponent(created.sessionId) + '/finish', null, { Cookie: studentCookie });
    assert(finish.status === 200 && finish.body && finish.body.status === 'completed', 'exam_mode finish failed');

    const studentSummary = await req('GET', `/api/tests/${created.testId}/summary?student_id=${created.studentId}&session_id=${created.sessionId}`, null, { Cookie: studentCookie });
    assert(studentSummary.status === 403 && studentSummary.body && studentSummary.body.error === 'summary_unavailable_for_exam_mode', 'student summary must be forbidden in exam_mode');

    const teacherSummary = await req('GET', `/api/teacher/tests/${created.testId}/summary?student_id=${created.studentId}&session_id=${created.sessionId}`, null, teacherCookie);
    assert(teacherSummary.status === 200 && teacherSummary.body && Array.isArray(teacherSummary.body.details), 'teacher summary should be available in exam_mode');

    console.log('exam mode API checks passed');
  }catch(err){
    console.error('ERROR', err);
    process.exitCode = 1;
  }finally{
    try{
      if(created.sessionId) await dbRun('DELETE FROM exam_session_questions WHERE session_id=?', [created.sessionId]);
      if(created.testId) await dbRun('DELETE FROM student_answers WHERE test_id=?', [created.testId]);
      if(created.testId) await dbRun('DELETE FROM exam_sessions WHERE test_id=?', [created.testId]);
      if(created.testId) await dbRun('DELETE FROM choices WHERE question_id IN (SELECT id FROM questions WHERE test_id=?)', [created.testId]);
      if(created.testId) await dbRun('DELETE FROM questions WHERE test_id=?', [created.testId]);
      if(created.testId) await dbRun('DELETE FROM test_classes WHERE test_id=?', [created.testId]);
      if(created.testId) await dbRun('DELETE FROM tests WHERE id=?', [created.testId]);
      if(created.studentId) await dbRun('DELETE FROM students WHERE id=?', [created.studentId]);
      if(created.classId) await dbRun('DELETE FROM classes WHERE id=?', [created.classId]);
      await dbRun('DELETE FROM teacher_sessions WHERE token=?', [token]);
      if(created.teacherId) await dbRun('DELETE FROM teachers WHERE id=?', [created.teacherId]);
    }catch(cleanupErr){
      console.error('CLEANUP_ERROR', cleanupErr);
      process.exitCode = 1;
    }
  }
})();
