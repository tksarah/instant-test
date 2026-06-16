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
        try{ parsed = JSON.parse(body); }catch(_err){}
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

function extractCookie(headers){
  const setCookie = headers && headers['set-cookie'];
  if(!Array.isArray(setCookie) || !setCookie.length) return '';
  return setCookie.map(cookie => String(cookie).split(';')[0]).join('; ');
}

function assert(condition, message){
  if(!condition) throw new Error(message);
}

(async () => {
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);
  const token = crypto.randomBytes(24).toString('hex');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const created = { teachers: [], sessions: [], classes: [], tests: [], sets: [], students: [], questions: [], choices: [], examSessions: [] };

  try{
    const teacherId = (await dbRun(
      'INSERT INTO teachers (username, display_name, password_hash, active, created_at) VALUES (?,?,?,?,?)',
      ['set-api-' + unique, 'Set API', 'dummy-hash', 1, now]
    )).lastID;
    created.teachers.push(teacherId);
    await dbRun('INSERT INTO teacher_sessions (token, teacher_id, expires_at, created_at, last_seen_at) VALUES (?,?,?,?,?)', [token, teacherId, expiresAt, now, now]);
    created.sessions.push(token);

    const teacherCookie = { Cookie: 'teacher_session=' + encodeURIComponent(token) };
    const classA = (await dbRun('INSERT INTO classes (teacher_id, name) VALUES (?,?)', [teacherId, 'Set Class A ' + unique])).lastID;
    const classB = (await dbRun('INSERT INTO classes (teacher_id, name) VALUES (?,?)', [teacherId, 'Set Class B ' + unique])).lastID;
    created.classes.push(classA, classB);

    const testA = (await dbRun('INSERT INTO tests (teacher_id, class_id, name, public, randomize, answer_mode, archived) VALUES (?,?,?,?,?,?,?)', [teacherId, null, 'Set Test A ' + unique, 0, 0, 'deferred_summary', 0])).lastID;
    const testB = (await dbRun('INSERT INTO tests (teacher_id, class_id, name, public, randomize, answer_mode, archived) VALUES (?,?,?,?,?,?,?)', [teacherId, null, 'Set Test B ' + unique, 1, 0, 'deferred_summary', 1])).lastID;
    created.tests.push(testA, testB);

    for(const testId of [testA, testB]){
      const q = (await dbRun('INSERT INTO questions (test_id, type, text, points, explanation) VALUES (?,?,?,?,?)', [testId, 'single', 'Question ' + testId, 2, ''])).lastID;
      created.questions.push(q);
      const c1 = (await dbRun('INSERT INTO choices (question_id, text, is_correct) VALUES (?,?,?)', [q, 'A', 1])).lastID;
      const c2 = (await dbRun('INSERT INTO choices (question_id, text, is_correct) VALUES (?,?,?)', [q, 'B', 0])).lastID;
      created.choices.push(c1, c2);
    }

    const createdSet = await req('POST', '/api/test-sets', {
      name: 'Review Set ' + unique,
      description: 'term review',
      public: 1,
      class_ids: [classA],
      test_ids: [testA, testB]
    }, teacherCookie);
    assert(createdSet.status === 200 && createdSet.body && createdSet.body.id, 'set creation failed');
    created.sets.push(createdSet.body.id);
    assert(createdSet.body.items.length === 2, 'set should include two tests');
    assert(createdSet.body.items.some(item => String(item.id) === String(testB) && item.archived === 1), 'set should keep archived tests as items');

    const publicSetsA = await req('GET', '/api/test-sets?class_id=' + encodeURIComponent(classA) + '&public=1');
    assert(publicSetsA.status === 200 && publicSetsA.body.some(s => String(s.id) === String(createdSet.body.id)), 'class A should see set');
    const publicSetsB = await req('GET', '/api/test-sets?class_id=' + encodeURIComponent(classB) + '&public=1');
    assert(publicSetsB.status === 200 && !publicSetsB.body.some(s => String(s.id) === String(createdSet.body.id)), 'class B should not see set');

    const student = await req('POST', '/api/students', { class_id: classA, name: 'Set Student' });
    assert(student.status === 200 && student.body && student.body.id, 'student should join through set-only class');
    created.students.push(student.body.id);
    const studentCookie = extractCookie(student.headers);

    const examSession = await req('POST', '/api/exam-sessions', { student_id: student.body.id, test_id: testA }, { Cookie: studentCookie });
    assert(examSession.status === 200 && examSession.body && examSession.body.id, 'student should start a set item test even when test is not individually public');
    created.examSessions.push(examSession.body.id);

    const archivedExamSession = await req('POST', '/api/exam-sessions', { student_id: student.body.id, test_id: testB }, { Cookie: studentCookie });
    assert(archivedExamSession.status === 200 && archivedExamSession.body && archivedExamSession.body.id, 'student should start an archived set item test through the set');
    created.examSessions.push(archivedExamSession.body.id);

    const questions = await req('GET', '/api/exam-sessions/' + encodeURIComponent(examSession.body.id) + '/questions', null, { Cookie: studentCookie });
    assert(questions.status === 200 && Array.isArray(questions.body) && questions.body.length === 1, 'session questions should load');
    const archivedQuestions = await req('GET', '/api/exam-sessions/' + encodeURIComponent(archivedExamSession.body.id) + '/questions', null, { Cookie: studentCookie });
    assert(archivedQuestions.status === 200 && Array.isArray(archivedQuestions.body) && archivedQuestions.body.length === 1, 'archived set item session questions should load');
    const submit = await req('POST', '/api/submit-answer', {
      student_id: student.body.id,
      test_id: testA,
      question_id: questions.body[0].id,
      choice_id: questions.body[0].choices[0].id,
      session_id: examSession.body.id
    }, { Cookie: studentCookie });
    assert(submit.status === 200, 'set item answer submit failed');
    const finish = await req('PUT', '/api/exam-sessions/' + encodeURIComponent(examSession.body.id) + '/finish', null, { Cookie: studentCookie });
    assert(finish.status === 200, 'set item finish failed');

    const laterIncompleteSession = await req('POST', '/api/exam-sessions', { student_id: student.body.id, test_id: testA }, { Cookie: studentCookie });
    assert(laterIncompleteSession.status === 200 && laterIncompleteSession.body && laterIncompleteSession.body.id, 'student should be able to start a later in-progress attempt');
    created.examSessions.push(laterIncompleteSession.body.id);

    const summary = await req('GET', '/api/test-sets/' + encodeURIComponent(createdSet.body.id) + '/summary', null, teacherCookie);
    assert(summary.status === 200 && summary.body && summary.body.totals, 'set summary failed');
    assert(summary.body.totals.completed_tests === 1, 'summary should count partial completion');
    assert(summary.body.totals.possible_tests === 2, 'summary should keep possible test count');
    assert(summary.body.totals.score === 2 && summary.body.totals.max_score === 2, 'summary should keep completed scores when a later attempt is in progress');
    const studentSummary = (summary.body.students || []).find(row => String(row.student_id) === String(student.body.id));
    assert(studentSummary, 'summary should include the student row');
    const testASummary = (studentSummary.tests || []).find(row => String(row.test_id) === String(testA));
    const testBSummary = (studentSummary.tests || []).find(row => String(row.test_id) === String(testB));
    assert(testASummary && testASummary.status === 'completed', 'completed set item should remain completed even after a later in-progress attempt');
    assert(testASummary.score === 2 && testASummary.max_score === 2, 'completed set item should keep its score');
    assert(testBSummary && testBSummary.status !== 'completed' && testBSummary.score === 0 && testBSummary.max_score === 0, 'in-progress-only set item should not count as scored');

    const updated = await req('PUT', '/api/test-sets/' + encodeURIComponent(createdSet.body.id), {
      name: 'Updated Set ' + unique,
      public: 0,
      class_ids: [classA, classB],
      test_ids: [testB, testA]
    }, teacherCookie);
    assert(updated.status === 200 && updated.body.public === 0 && updated.body.class_ids.length === 2, 'set update failed');

    console.log('test set API checks passed');
  }catch(err){
    console.error('ERROR', err);
    process.exitCode = 1;
  }finally{
    try{
      for(const sessionId of created.examSessions){
        await dbRun('DELETE FROM student_answers WHERE session_id=?', [sessionId]);
        await dbRun('DELETE FROM exam_session_questions WHERE session_id=?', [sessionId]);
        await dbRun('DELETE FROM exam_sessions WHERE id=?', [sessionId]);
      }
      for(const setId of created.sets){
        await dbRun('DELETE FROM test_set_items WHERE set_id=?', [setId]);
        await dbRun('DELETE FROM test_set_classes WHERE set_id=?', [setId]);
        await dbRun('DELETE FROM test_sets WHERE id=?', [setId]);
      }
      for(const choiceId of created.choices) await dbRun('DELETE FROM choices WHERE id=?', [choiceId]);
      for(const questionId of created.questions) await dbRun('DELETE FROM questions WHERE id=?', [questionId]);
      for(const testId of created.tests) await dbRun('DELETE FROM tests WHERE id=?', [testId]);
      for(const studentId of created.students) await dbRun('DELETE FROM students WHERE id=?', [studentId]);
      for(const classId of created.classes) await dbRun('DELETE FROM classes WHERE id=?', [classId]);
      for(const tokenValue of created.sessions) await dbRun('DELETE FROM teacher_sessions WHERE token=?', [tokenValue]);
      for(const teacherId of created.teachers) await dbRun('DELETE FROM teachers WHERE id=?', [teacherId]);
    }catch(cleanupErr){
      console.error('CLEANUP_ERROR', cleanupErr);
      process.exitCode = 1;
    }
  }
})();
