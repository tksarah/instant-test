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

function assert(condition, message){
  if(!condition) throw new Error(message);
}

(async () => {
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);
  const token = crypto.randomBytes(24).toString('hex');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const created = {
    teachers: [],
    teacherSessions: [],
    classes: [],
    students: [],
    tests: [],
    questions: [],
    choices: [],
    examSessions: [],
    answers: []
  };

  try{
    const teacherId = (await dbRun(
      'INSERT INTO teachers (username, display_name, password_hash, active, created_at) VALUES (?,?,?,?,?)',
      ['exams-class-filter-' + unique, 'Exams Class Filter', 'dummy-hash', 1, now]
    )).lastID;
    created.teachers.push(teacherId);

    await dbRun(
      'INSERT INTO teacher_sessions (token, teacher_id, expires_at, created_at, last_seen_at) VALUES (?,?,?,?,?)',
      [token, teacherId, expiresAt, now, now]
    );
    created.teacherSessions.push(token);

    const classIdA = (await dbRun('INSERT INTO classes (teacher_id, name) VALUES (?,?)', [teacherId, 'Class A ' + unique])).lastID;
    const classIdB = (await dbRun('INSERT INTO classes (teacher_id, name) VALUES (?,?)', [teacherId, 'Class B ' + unique])).lastID;
    created.classes.push(classIdA, classIdB);

    const studentIdA = (await dbRun('INSERT INTO students (class_id, name, code) VALUES (?,?,?)', [classIdA, 'Student A', 'a-' + unique])).lastID;
    const studentIdB = (await dbRun('INSERT INTO students (class_id, name, code) VALUES (?,?,?)', [classIdB, 'Student B', 'b-' + unique])).lastID;
    created.students.push(studentIdA, studentIdB);

    const sharedTestId = (await dbRun(
      'INSERT INTO tests (teacher_id, class_id, name, description, public, randomize) VALUES (?,?,?,?,?,?)',
      [teacherId, classIdA, 'Shared Test ' + unique, '', 0, 0]
    )).lastID;
    const incompleteOnlyTestId = (await dbRun(
      'INSERT INTO tests (teacher_id, class_id, name, description, public, randomize) VALUES (?,?,?,?,?,?)',
      [teacherId, classIdA, 'Incomplete Only Test ' + unique, '', 0, 0]
    )).lastID;
    const zeroScoreTestId = (await dbRun(
      'INSERT INTO tests (teacher_id, class_id, name, description, public, randomize) VALUES (?,?,?,?,?,?)',
      [teacherId, classIdB, 'Zero Score Test ' + unique, '', 0, 0]
    )).lastID;
    const legacyTestId = (await dbRun(
      'INSERT INTO tests (teacher_id, class_id, name, description, public, randomize) VALUES (?,?,?,?,?,?)',
      [teacherId, classIdA, 'Legacy Test ' + unique, '', 0, 0]
    )).lastID;
    created.tests.push(sharedTestId, incompleteOnlyTestId, zeroScoreTestId, legacyTestId);

    const completedSessionA = (await dbRun(
      'INSERT INTO exam_sessions (student_id, test_id, started_at, finished_at, duration_sec, score, max_score, percent, status) VALUES (?,?,?,?,?,?,?,?,?)',
      [studentIdA, sharedTestId, now, now, 60, 8, 10, 80, 'completed']
    )).lastID;
    const completedSessionB = (await dbRun(
      'INSERT INTO exam_sessions (student_id, test_id, started_at, finished_at, duration_sec, score, max_score, percent, status) VALUES (?,?,?,?,?,?,?,?,?)',
      [studentIdB, sharedTestId, now, now, 55, 6, 10, 60, 'completed']
    )).lastID;
    created.examSessions.push(completedSessionA, completedSessionB);

    const incompleteQuestionId = (await dbRun(
      'INSERT INTO questions (test_id, type, text, points, explanation) VALUES (?,?,?,?,?)',
      [incompleteOnlyTestId, 'single', 'Incomplete question', 1, '']
    )).lastID;
    const incompleteChoiceId = (await dbRun(
      'INSERT INTO choices (question_id, text, is_correct) VALUES (?,?,?)',
      [incompleteQuestionId, 'A', 1]
    )).lastID;
    created.questions.push(incompleteQuestionId);
    created.choices.push(incompleteChoiceId);
    const incompleteSessionId = (await dbRun(
      'INSERT INTO exam_sessions (student_id, test_id, started_at, status) VALUES (?,?,?,?)',
      [studentIdA, incompleteOnlyTestId, now, 'in_progress']
    )).lastID;
    created.examSessions.push(incompleteSessionId);
    const incompleteAnswerId = (await dbRun(
      'INSERT INTO student_answers (student_id, test_id, question_id, choice_id, correct, session_id) VALUES (?,?,?,?,?,?)',
      [studentIdA, incompleteOnlyTestId, incompleteQuestionId, incompleteChoiceId, 1, incompleteSessionId]
    )).lastID;
    created.answers.push(incompleteAnswerId);

    const zeroSessionId = (await dbRun(
      'INSERT INTO exam_sessions (student_id, test_id, started_at, finished_at, duration_sec, score, max_score, percent, status) VALUES (?,?,?,?,?,?,?,?,?)',
      [studentIdB, zeroScoreTestId, now, now, 40, 0, 10, 0, 'completed']
    )).lastID;
    created.examSessions.push(zeroSessionId);

    const legacyQuestionId = (await dbRun(
      'INSERT INTO questions (test_id, type, text, points, explanation) VALUES (?,?,?,?,?)',
      [legacyTestId, 'single', 'Legacy question', 3, '']
    )).lastID;
    const legacyChoiceId = (await dbRun(
      'INSERT INTO choices (question_id, text, is_correct) VALUES (?,?,?)',
      [legacyQuestionId, 'A', 1]
    )).lastID;
    created.questions.push(legacyQuestionId);
    created.choices.push(legacyChoiceId);
    const legacyAnswerId = (await dbRun(
      'INSERT INTO student_answers (student_id, test_id, question_id, choice_id, correct, session_id) VALUES (?,?,?,?,?,?)',
      [studentIdA, legacyTestId, legacyQuestionId, legacyChoiceId, 1, null]
    )).lastID;
    created.answers.push(legacyAnswerId);

    const teacherCookie = { Cookie: 'teacher_session=' + encodeURIComponent(token) };

    const allRes = await req('GET', '/api/exams', null, teacherCookie);
    assert(allRes.status === 200 && Array.isArray(allRes.body), 'GET /api/exams should return a list');
    const sharedRows = allRes.body.filter(function(row){
      return row && String(row.testId || '') === String(sharedTestId);
    });
    assert(sharedRows.length === 2, 'shared test should include the two completed sessions');
    assert(sharedRows.every(function(row){ return row.finished_at; }), 'report rows should be completed sessions');
    assert(!allRes.body.some(function(row){ return String(row.sessionId || '') === String(incompleteSessionId); }), 'in-progress sessions should not be listed');
    assert(sharedRows.every(function(row){ return row.className && row.studentClassName; }), 'report rows should include student class names');
    assert(sharedRows.some(function(row){ return String(row.classId || '') === String(classIdA) && String(row.studentClassId || '') === String(classIdA); }), 'Class A completed session should be listed');
    assert(sharedRows.some(function(row){ return String(row.classId || '') === String(classIdB) && String(row.studentClassId || '') === String(classIdB); }), 'Class B completed session should be listed');

    const incompleteOnlyRes = await req('GET', '/api/exams?test_id=' + encodeURIComponent(incompleteOnlyTestId), null, teacherCookie);
    assert(incompleteOnlyRes.status === 200 && Array.isArray(incompleteOnlyRes.body), 'incomplete-only test report should return a list');
    assert(!incompleteOnlyRes.body.some(function(row){ return String(row.testId || '') === String(incompleteOnlyTestId); }), 'in-progress answers should not fall back into legacy reports');

    const zeroScoreRes = await req('GET', '/api/exams?test_id=' + encodeURIComponent(zeroScoreTestId), null, teacherCookie);
    assert(zeroScoreRes.status === 200 && Array.isArray(zeroScoreRes.body), 'zero-score report should return a list');
    const zeroRows = zeroScoreRes.body.filter(function(row){ return String(row.testId || '') === String(zeroScoreTestId); });
    assert(zeroRows.length === 1, 'completed zero-score attempt should be listed');
    assert(Number(zeroRows[0].score || 0) === 0 && Number(zeroRows[0].maxScore || 0) === 10, 'completed zero-score attempt should keep its score');

    const legacyRes = await req('GET', '/api/exams?test_id=' + encodeURIComponent(legacyTestId), null, teacherCookie);
    assert(legacyRes.status === 200 && Array.isArray(legacyRes.body), 'legacy report should return a list');
    const legacyRows = legacyRes.body.filter(function(row){ return String(row.testId || '') === String(legacyTestId); });
    assert(legacyRows.length === 1, 'legacy answers without sessions should still be reported');
    assert(Number(legacyRows[0].score || 0) === 3, 'legacy answer score should be calculated');

    const filteredResA = await req('GET', '/api/exams?class_id=' + encodeURIComponent(classIdA), null, teacherCookie);
    assert(filteredResA.status === 200 && Array.isArray(filteredResA.body), 'class A report should return a list');
    const filteredRowsA = filteredResA.body.filter(function(row){
      return row && String(row.testId || '') === String(sharedTestId);
    });
    assert(filteredRowsA.length === 1, 'class filter should return only Class A completed results');
    assert(filteredRowsA.every(function(row){ return String(row.classId || '') === String(classIdA) && String(row.studentClassId || '') === String(classIdA); }), 'class A report rows should use the student class');

    const filteredResB = await req('GET', '/api/exams?class_id=' + encodeURIComponent(classIdB), null, teacherCookie);
    assert(filteredResB.status === 200 && Array.isArray(filteredResB.body), 'class B report should return a list');
    const filteredRowsB = filteredResB.body.filter(function(row){
      return row && String(row.testId || '') === String(sharedTestId);
    });
    assert(filteredRowsB.length === 1, 'class filter should return only Class B completed results');
    assert(filteredRowsB.every(function(row){ return String(row.classId || '') === String(classIdB) && String(row.studentClassId || '') === String(classIdB); }), 'class B report rows should use the student class');

    console.log('exam reports class filter checks passed');
  }catch(err){
    console.error('ERROR', err);
    process.exitCode = 1;
  }finally{
    try{
      for(const answerId of created.answers) await dbRun('DELETE FROM student_answers WHERE id=?', [answerId]);
      for(const sessionId of created.examSessions) await dbRun('DELETE FROM exam_sessions WHERE id=?', [sessionId]);
      for(const choiceId of created.choices) await dbRun('DELETE FROM choices WHERE id=?', [choiceId]);
      for(const questionId of created.questions) await dbRun('DELETE FROM questions WHERE id=?', [questionId]);
      for(const testId of created.tests) await dbRun('DELETE FROM tests WHERE id=?', [testId]);
      for(const studentId of created.students) await dbRun('DELETE FROM students WHERE id=?', [studentId]);
      for(const classId of created.classes) await dbRun('DELETE FROM classes WHERE id=?', [classId]);
      for(const tokenValue of created.teacherSessions) await dbRun('DELETE FROM teacher_sessions WHERE token=?', [tokenValue]);
      for(const teacherId of created.teachers) await dbRun('DELETE FROM teachers WHERE id=?', [teacherId]);
    }catch(cleanupErr){
      console.error('CLEANUP_ERROR', cleanupErr);
      process.exitCode = 1;
    }
  }
})();
