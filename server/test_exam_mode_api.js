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

function dbGet(sql, params){
  return new Promise((resolve, reject) => {
    db.get(sql, params || [], function(err, row){
      if(err) return reject(err);
      resolve(row || null);
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
  const created = { teacherId: null, classId: null, testId: null, questionIds: [], choiceIds: [], studentId: null, sessionId: null, sessionIds: [] };

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
      answer_mode: 'exam_mode',
      time_limit_minutes: 30
    }, teacherCookie);
    assert(createdTest.status === 200 && createdTest.body && createdTest.body.id, 'exam_mode test create failed');
    created.testId = createdTest.body.id;
    assert(createdTest.body.answer_mode === 'exam_mode', 'created test should preserve exam_mode');
    assert(createdTest.body.time_limit_minutes === 30, 'created exam_mode test should preserve time_limit_minutes');

    const invalidModeUpdate = await req('PUT', '/api/tests/' + encodeURIComponent(created.testId), {
      name: createdTest.body.name,
      description: '',
      public: 1,
      randomize: 0,
      class_id: created.classId,
      answer_mode: 'invalid_mode',
      time_limit_minutes: 20
    }, teacherCookie);
    assert(invalidModeUpdate.status === 200 && invalidModeUpdate.body.answer_mode === 'deferred_summary', 'invalid answer_mode should normalize to deferred_summary');
    assert(invalidModeUpdate.body.time_limit_minutes === null, 'non-exam mode should clear time_limit_minutes');

    const examModeUpdate = await req('PUT', '/api/tests/' + encodeURIComponent(created.testId), {
      name: createdTest.body.name,
      description: '',
      public: 1,
      randomize: 0,
      class_id: created.classId,
      answer_mode: 'exam_mode',
      time_limit_minutes: 30
    }, teacherCookie);
    assert(examModeUpdate.status === 200 && examModeUpdate.body.answer_mode === 'exam_mode', 'exam_mode update failed');
    assert(examModeUpdate.body.time_limit_minutes === 30, 'exam_mode update should preserve time_limit_minutes');

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

    const secondQuestion = await req('POST', '/api/tests/' + encodeURIComponent(created.testId) + '/questions', {
      type: 'single',
      text: 'Exam mode second question',
      points: 1,
      explanation: 'Also hidden from students in exam mode',
      choices: [
        { text: 'Second Correct', is_correct: 1 },
        { text: 'Second Wrong', is_correct: 0 }
      ]
    }, teacherCookie);
    assert(secondQuestion.status === 200 && secondQuestion.body && secondQuestion.body.id, 'second question create failed');
    created.questionIds.push(secondQuestion.body.id);

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
    created.sessionIds.push(session.body.id);
    assert(session.body.time_limit_minutes === 30, 'exam session should snapshot time_limit_minutes');
    assert(session.body.deadline_at && session.body.server_now, 'exam session should return deadline_at and server_now');
    const firstSessionDeadline = session.body.deadline_at;

    const changedLimitUpdate = await req('PUT', '/api/tests/' + encodeURIComponent(created.testId), {
      name: createdTest.body.name,
      description: '',
      public: 1,
      randomize: 0,
      class_id: created.classId,
      answer_mode: 'exam_mode',
      time_limit_minutes: 45
    }, teacherCookie);
    assert(changedLimitUpdate.status === 200 && changedLimitUpdate.body.time_limit_minutes === 45, 'time_limit_minutes update failed');

    const questions = await req('GET', '/api/exam-sessions/' + encodeURIComponent(created.sessionId) + '/questions', null, { Cookie: studentCookie });
    assert(questions.status === 200 && Array.isArray(questions.body) && questions.body.length === 2, 'session questions fetch failed');
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

    const invalidChoiceUpdate = await req('PUT', '/api/exam-sessions/' + encodeURIComponent(created.sessionId) + '/answers/' + encodeURIComponent(firstQuestion.id), {
      student_id: created.studentId,
      test_id: created.testId,
      choice_id: 999999999
    }, { Cookie: studentCookie });
    assert(invalidChoiceUpdate.status === 400 && invalidChoiceUpdate.body && invalidChoiceUpdate.body.error === 'invalid_choice_id', 'invalid review choice should be rejected');

    const outsideQuestionUpdate = await req('PUT', '/api/exam-sessions/' + encodeURIComponent(created.sessionId) + '/answers/' + encodeURIComponent(firstQuestion.id + 999999), {
      student_id: created.studentId,
      test_id: created.testId,
      choice_id: firstQuestion.choices[0].id
    }, { Cookie: studentCookie });
    assert(outsideQuestionUpdate.status === 400 && outsideQuestionUpdate.body && outsideQuestionUpdate.body.error === 'question_not_in_session', 'question outside session should be rejected');

    const changedAnswer = await req('PUT', '/api/exam-sessions/' + encodeURIComponent(created.sessionId) + '/answers/' + encodeURIComponent(firstQuestion.id), {
      student_id: created.studentId,
      test_id: created.testId,
      choice_id: firstQuestion.choices[1].id
    }, { Cookie: studentCookie });
    assert(changedAnswer.status === 200 && changedAnswer.body && changedAnswer.body.accepted === true, 'exam_mode answer update failed');

    const finish = await req('PUT', '/api/exam-sessions/' + encodeURIComponent(created.sessionId) + '/finish', null, { Cookie: studentCookie });
    assert(finish.status === 200 && finish.body && finish.body.status === 'completed', 'exam_mode finish failed');
    assert(finish.body.score === 0 && finish.body.max_score === 2, 'exam_mode finish should score the updated answer and unanswered questions as zero');
    assert(finish.body.time_limit_minutes === 30 && finish.body.deadline_at === firstSessionDeadline, 'started session should keep its original time limit after test update');

    const completedUpdate = await req('PUT', '/api/exam-sessions/' + encodeURIComponent(created.sessionId) + '/answers/' + encodeURIComponent(firstQuestion.id), {
      student_id: created.studentId,
      test_id: created.testId,
      choice_id: firstQuestion.choices[0].id
    }, { Cookie: studentCookie });
    assert(completedUpdate.status === 409 && completedUpdate.body && completedUpdate.body.error === 'session_completed', 'completed exam session should reject answer updates');

    const studentSummary = await req('GET', `/api/tests/${created.testId}/summary?student_id=${created.studentId}&session_id=${created.sessionId}`, null, { Cookie: studentCookie });
    assert(studentSummary.status === 403 && studentSummary.body && studentSummary.body.error === 'summary_unavailable_for_exam_mode', 'student summary must be forbidden in exam_mode');

    const teacherSummary = await req('GET', `/api/teacher/tests/${created.testId}/summary?student_id=${created.studentId}&session_id=${created.sessionId}`, null, teacherCookie);
    assert(teacherSummary.status === 200 && teacherSummary.body && Array.isArray(teacherSummary.body.details), 'teacher summary should be available in exam_mode');

    const timeoutSession = await req('POST', '/api/exam-sessions', {
      student_id: created.studentId,
      test_id: created.testId
    }, { Cookie: studentCookie });
    assert(timeoutSession.status === 200 && timeoutSession.body && timeoutSession.body.id, 'timeout session create failed');
    created.sessionIds.push(timeoutSession.body.id);
    assert(timeoutSession.body.time_limit_minutes === 45, 'new session should use updated time limit');
    const timeoutQuestions = await req('GET', '/api/exam-sessions/' + encodeURIComponent(timeoutSession.body.id) + '/questions', null, { Cookie: studentCookie });
    assert(timeoutQuestions.status === 200 && Array.isArray(timeoutQuestions.body) && timeoutQuestions.body.length === 2, 'timeout questions fetch failed');
    const timeoutFinish = await req('PUT', '/api/exam-sessions/' + encodeURIComponent(timeoutSession.body.id) + '/finish', {
      reason: 'time_limit',
      current_answer: {
        question_id: timeoutQuestions.body[0].id,
        choice_id: timeoutQuestions.body[0].choices[0].id
      }
    }, { Cookie: studentCookie });
    assert(timeoutFinish.status === 200 && timeoutFinish.body && timeoutFinish.body.status === 'completed', 'time-limit finish failed');
    assert(timeoutFinish.body.finish_reason === 'time_limit', 'time-limit finish should report finish_reason');
    assert(timeoutFinish.body.score === 1 && timeoutFinish.body.max_score === 2, 'time-limit finish should save current answer and leave unanswered questions at zero');

    const expiredSubmitSession = await req('POST', '/api/exam-sessions', {
      student_id: created.studentId,
      test_id: created.testId
    }, { Cookie: studentCookie });
    assert(expiredSubmitSession.status === 200 && expiredSubmitSession.body && expiredSubmitSession.body.id, 'expired submit session create failed');
    created.sessionIds.push(expiredSubmitSession.body.id);
    await dbRun('UPDATE exam_sessions SET deadline_at=? WHERE id=?', [new Date(Date.now() - 1000).toISOString(), expiredSubmitSession.body.id]);
    const expiredSubmitQuestions = await req('GET', '/api/exam-sessions/' + encodeURIComponent(expiredSubmitSession.body.id) + '/questions', null, { Cookie: studentCookie });
    const expiredSubmit = await req('POST', '/api/submit-answer', {
      student_id: created.studentId,
      test_id: created.testId,
      question_id: expiredSubmitQuestions.body[0].id,
      choice_id: expiredSubmitQuestions.body[0].choices[0].id,
      session_id: expiredSubmitSession.body.id
    }, { Cookie: studentCookie });
    assert(expiredSubmit.status === 409 && expiredSubmit.body && expiredSubmit.body.error === 'time_limit_exceeded', 'expired session should reject normal answer submit');

    const expiredUpdateSession = await req('POST', '/api/exam-sessions', {
      student_id: created.studentId,
      test_id: created.testId
    }, { Cookie: studentCookie });
    assert(expiredUpdateSession.status === 200 && expiredUpdateSession.body && expiredUpdateSession.body.id, 'expired update session create failed');
    created.sessionIds.push(expiredUpdateSession.body.id);
    const expiredUpdateQuestions = await req('GET', '/api/exam-sessions/' + encodeURIComponent(expiredUpdateSession.body.id) + '/questions', null, { Cookie: studentCookie });
    const beforeExpirySubmit = await req('POST', '/api/submit-answer', {
      student_id: created.studentId,
      test_id: created.testId,
      question_id: expiredUpdateQuestions.body[0].id,
      choice_id: expiredUpdateQuestions.body[0].choices[0].id,
      session_id: expiredUpdateSession.body.id
    }, { Cookie: studentCookie });
    assert(beforeExpirySubmit.status === 200, 'pre-expiry submit failed');
    await dbRun('UPDATE exam_sessions SET deadline_at=? WHERE id=?', [new Date(Date.now() - 1000).toISOString(), expiredUpdateSession.body.id]);
    const expiredUpdate = await req('PUT', '/api/exam-sessions/' + encodeURIComponent(expiredUpdateSession.body.id) + '/answers/' + encodeURIComponent(expiredUpdateQuestions.body[0].id), {
      student_id: created.studentId,
      test_id: created.testId,
      choice_id: expiredUpdateQuestions.body[0].choices[1].id
    }, { Cookie: studentCookie });
    assert(expiredUpdate.status === 409 && expiredUpdate.body && expiredUpdate.body.error === 'time_limit_exceeded', 'expired session should reject review updates');

    console.log('exam mode API checks passed');
  }catch(err){
    console.error('ERROR', err);
    process.exitCode = 1;
  }finally{
    try{
      for(const sessionId of created.sessionIds){
        await dbRun('DELETE FROM exam_session_questions WHERE session_id=?', [sessionId]);
      }
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
