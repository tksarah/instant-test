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

function dbGet(sql, params){
  return new Promise((resolve, reject) => {
    db.get(sql, params || [], (err, row) => {
      if(err) return reject(err);
      resolve(row);
    });
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
  const created = { tests: [], questions: [], choices: [], students: [], sessions: [], answers: [] };
  try{
    const teacherSeed = await dbGet('SELECT teacher_id, class_id FROM tests WHERE public=1 AND teacher_id IS NOT NULL AND class_id IS NOT NULL ORDER BY id ASC LIMIT 1');
    assert(teacherSeed && teacherSeed.teacher_id && teacherSeed.class_id, '公開テスト由来の教師とクラスが必要です');

    const deferredTest = await dbRun(
      'INSERT INTO tests (teacher_id, class_id, name, description, public, randomize, answer_mode) VALUES (?,?,?,?,?,?,?)',
      [teacherSeed.teacher_id, teacherSeed.class_id, 'session guard deferred', '', 1, 0, 'deferred_summary']
    );
    created.tests.push(deferredTest.lastID);

    const deferredQuestion1 = await dbRun('INSERT INTO questions (test_id, type, text, points, explanation) VALUES (?,?,?,?,?)', [deferredTest.lastID, 'single', 'Q1', 1, '']);
    const deferredQuestion2 = await dbRun('INSERT INTO questions (test_id, type, text, points, explanation) VALUES (?,?,?,?,?)', [deferredTest.lastID, 'single', 'Q2', 1, '']);
    created.questions.push(deferredQuestion1.lastID, deferredQuestion2.lastID);

    const dq1a = await dbRun('INSERT INTO choices (question_id, text, is_correct) VALUES (?,?,?)', [deferredQuestion1.lastID, 'Q1-A', 1]);
    const dq1b = await dbRun('INSERT INTO choices (question_id, text, is_correct) VALUES (?,?,?)', [deferredQuestion1.lastID, 'Q1-B', 0]);
    const dq2a = await dbRun('INSERT INTO choices (question_id, text, is_correct) VALUES (?,?,?)', [deferredQuestion2.lastID, 'Q2-A', 1]);
    const dq2b = await dbRun('INSERT INTO choices (question_id, text, is_correct) VALUES (?,?,?)', [deferredQuestion2.lastID, 'Q2-B', 0]);
    created.choices.push(dq1a.lastID, dq1b.lastID, dq2a.lastID, dq2b.lastID);

    const immediateTest = await dbRun(
      'INSERT INTO tests (teacher_id, class_id, name, description, public, randomize, answer_mode) VALUES (?,?,?,?,?,?,?)',
      [teacherSeed.teacher_id, teacherSeed.class_id, 'session guard immediate', '', 1, 0, 'immediate_feedback']
    );
    created.tests.push(immediateTest.lastID);

    const immediateQuestion = await dbRun('INSERT INTO questions (test_id, type, text, points, explanation) VALUES (?,?,?,?,?)', [immediateTest.lastID, 'single', 'Immediate Q', 1, 'すぐ表示']);
    created.questions.push(immediateQuestion.lastID);
    const iq1 = await dbRun('INSERT INTO choices (question_id, text, is_correct) VALUES (?,?,?)', [immediateQuestion.lastID, 'I-A', 1]);
    const iq2 = await dbRun('INSERT INTO choices (question_id, text, is_correct) VALUES (?,?,?)', [immediateQuestion.lastID, 'I-B', 0]);
    created.choices.push(iq1.lastID, iq2.lastID);

    const deferredStudent = await req('POST', '/api/students', { class_id: teacherSeed.class_id, name: 'guard deferred student' });
    assert(deferredStudent.status === 200 && deferredStudent.body && deferredStudent.body.id, 'deferred student 作成に失敗しました');
    created.students.push(deferredStudent.body.id);
    const deferredCookie = extractCookie(deferredStudent.headers);

    const deferredSession = await req('POST', '/api/exam-sessions', { student_id: deferredStudent.body.id, test_id: deferredTest.lastID }, { Cookie: deferredCookie });
    assert(deferredSession.status === 200 && deferredSession.body && deferredSession.body.id, 'deferred session 作成に失敗しました');
    created.sessions.push(deferredSession.body.id);

    const deferredQuestions = await req('GET', '/api/exam-sessions/' + encodeURIComponent(deferredSession.body.id) + '/questions', null, { Cookie: deferredCookie });
    assert(deferredQuestions.status === 200 && Array.isArray(deferredQuestions.body) && deferredQuestions.body.length === 2, 'deferred session 問題取得に失敗しました');

    const outOfOrder = await req('POST', '/api/submit-answer', {
      student_id: deferredStudent.body.id,
      test_id: deferredTest.lastID,
      question_id: deferredQuestions.body[1].id,
      choice_id: deferredQuestions.body[1].choices[0].id,
      session_id: deferredSession.body.id
    }, { Cookie: deferredCookie });
    assert(outOfOrder.status === 409 && outOfOrder.body && outOfOrder.body.error === 'question_out_of_order', '順不同回答は 409 で拒否される必要があります');

    const deferredSubmit = await req('POST', '/api/submit-answer', {
      student_id: deferredStudent.body.id,
      test_id: deferredTest.lastID,
      question_id: deferredQuestions.body[0].id,
      choice_id: deferredQuestions.body[0].choices[0].id,
      session_id: deferredSession.body.id
    }, { Cookie: deferredCookie });
    assert(deferredSubmit.status === 200, 'deferred submit に失敗しました');
    assert(!deferredSubmit.body.feedback, 'deferred_summary では feedback を返さない必要があります');

    const summaryBeforeFinish = await req('GET', `/api/tests/${deferredTest.lastID}/summary?student_id=${deferredStudent.body.id}&session_id=${deferredSession.body.id}`, null, { Cookie: deferredCookie });
    assert(summaryBeforeFinish.status === 403, '完了前 summary は 403 で拒否される必要があります');

    const deferredSubmit2 = await req('POST', '/api/submit-answer', {
      student_id: deferredStudent.body.id,
      test_id: deferredTest.lastID,
      question_id: deferredQuestions.body[1].id,
      choice_id: deferredQuestions.body[1].choices[0].id,
      session_id: deferredSession.body.id
    }, { Cookie: deferredCookie });
    assert(deferredSubmit2.status === 200, 'deferred second submit に失敗しました');

    const deferredFinish = await req('PUT', '/api/exam-sessions/' + encodeURIComponent(deferredSession.body.id) + '/finish', null, { Cookie: deferredCookie });
    assert(deferredFinish.status === 200, 'deferred finish に失敗しました');

    const summaryAfterFinish = await req('GET', `/api/tests/${deferredTest.lastID}/summary?student_id=${deferredStudent.body.id}&session_id=${deferredSession.body.id}`, null, { Cookie: deferredCookie });
    assert(summaryAfterFinish.status === 200, '完了後 summary は成功する必要があります');

    const immediateStudent = await req('POST', '/api/students', { class_id: teacherSeed.class_id, name: 'guard immediate student' });
    assert(immediateStudent.status === 200 && immediateStudent.body && immediateStudent.body.id, 'immediate student 作成に失敗しました');
    created.students.push(immediateStudent.body.id);
    const immediateCookie = extractCookie(immediateStudent.headers);

    const immediateSession = await req('POST', '/api/exam-sessions', { student_id: immediateStudent.body.id, test_id: immediateTest.lastID }, { Cookie: immediateCookie });
    assert(immediateSession.status === 200 && immediateSession.body && immediateSession.body.id, 'immediate session 作成に失敗しました');
    created.sessions.push(immediateSession.body.id);

    const immediateQuestions = await req('GET', '/api/exam-sessions/' + encodeURIComponent(immediateSession.body.id) + '/questions', null, { Cookie: immediateCookie });
    assert(immediateQuestions.status === 200 && Array.isArray(immediateQuestions.body) && immediateQuestions.body.length === 1, 'immediate session 問題取得に失敗しました');

    const immediateSubmit = await req('POST', '/api/submit-answer', {
      student_id: immediateStudent.body.id,
      test_id: immediateTest.lastID,
      question_id: immediateQuestions.body[0].id,
      choice_id: immediateQuestions.body[0].choices[0].id,
      session_id: immediateSession.body.id
    }, { Cookie: immediateCookie });
    assert(immediateSubmit.status === 200, 'immediate submit に失敗しました');
    assert(immediateSubmit.body && immediateSubmit.body.feedback && Array.isArray(immediateSubmit.body.feedback.correct_choice_ids), 'immediate_feedback では feedback を返す必要があります');

    console.log('exam session guard checks passed');
  }catch(err){
    console.error('ERROR', err);
    process.exitCode = 1;
  }finally{
    try{
      for(const sessionId of created.sessions){
        await dbRun('DELETE FROM exam_session_questions WHERE session_id=?', [sessionId]);
      }
      for(const testId of created.tests){
        await dbRun('DELETE FROM student_answers WHERE test_id=?', [testId]);
        await dbRun('DELETE FROM exam_sessions WHERE test_id=?', [testId]);
      }
      for(const choiceId of created.choices){
        await dbRun('DELETE FROM choices WHERE id=?', [choiceId]);
      }
      for(const questionId of created.questions){
        await dbRun('DELETE FROM questions WHERE id=?', [questionId]);
      }
      for(const testId of created.tests){
        await dbRun('DELETE FROM tests WHERE id=?', [testId]);
      }
      for(const studentId of created.students){
        await dbRun('DELETE FROM students WHERE id=?', [studentId]);
      }
    }catch(cleanupErr){
      console.error('CLEANUP_ERROR', cleanupErr);
      process.exitCode = 1;
    }
  }
})();