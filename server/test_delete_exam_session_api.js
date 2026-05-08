const crypto = require('crypto');
const http = require('http');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const port = parseInt(process.env.PORT, 10) || 3000;
const dbPath = path.join(__dirname, 'data.sqlite');
const db = new sqlite3.Database(dbPath);

function req(method, pathName, data, headers){
  const opts = {
    hostname: 'localhost',
    port,
    path: pathName,
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {})
  };
  return new Promise((resolve, reject) => {
    const request = http.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try{
          resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null, headers: res.headers });
        }catch(error){
          reject(error);
        }
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
    db.get(sql, params || [], (err, row) => {
      if(err) return reject(err);
      resolve(row);
    });
  });
}

function assert(condition, message){
  if(!condition) throw new Error(message);
}

(async function(){
  const unique = Date.now();
  const token = crypto.randomBytes(16).toString('hex');
  let teacherId;
  let classId;
  let studentId;
  let testId;
  let questionId;
  let choiceId;
  let sessionId;
  try{
    const teacher = await dbRun(
      'INSERT INTO teachers (username, display_name, password_hash, active, created_at) VALUES (?,?,?,?,?)',
      ['delete-session-' + unique, 'Delete Session Teacher', 'not-used', 1, new Date().toISOString()]
    );
    teacherId = teacher.lastID;
    await dbRun(
      'INSERT INTO teacher_sessions (token, teacher_id, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?)',
      [token, teacherId, new Date().toISOString(), new Date().toISOString(), new Date(Date.now() + 3600 * 1000).toISOString()]
    );
    classId = (await dbRun('INSERT INTO classes (teacher_id, name) VALUES (?,?)', [teacherId, 'Delete Session Class ' + unique])).lastID;
    studentId = (await dbRun('INSERT INTO students (class_id, name, code) VALUES (?,?,?)', [classId, 'Delete Session Student', 'code-' + unique])).lastID;
    testId = (await dbRun('INSERT INTO tests (teacher_id, class_id, name, description, public, randomize) VALUES (?,?,?,?,?,?)', [teacherId, classId, 'Delete Session Test ' + unique, '', 0, 0])).lastID;
    questionId = (await dbRun('INSERT INTO questions (test_id, type, text, points, public, explanation) VALUES (?,?,?,?,?,?)', [testId, 'single', 'Question', 1, 1, ''])).lastID;
    choiceId = (await dbRun('INSERT INTO choices (question_id, text, is_correct) VALUES (?,?,?)', [questionId, 'Choice', 1])).lastID;
    sessionId = (await dbRun('INSERT INTO exam_sessions (student_id, test_id, started_at, finished_at, duration_sec, score, max_score, percent, status) VALUES (?,?,?,?,?,?,?,?,?)', [studentId, testId, new Date().toISOString(), new Date().toISOString(), 10, 1, 1, 100, 'completed'])).lastID;
    await dbRun('INSERT INTO student_answers (student_id, test_id, question_id, choice_id, correct, session_id) VALUES (?,?,?,?,?,?)', [studentId, testId, questionId, choiceId, 1, sessionId]);

    const cookie = 'teacher_session=' + encodeURIComponent(token);
    const beforeSession = await dbGet('SELECT id FROM exam_sessions WHERE id=?', [sessionId]);
    const beforeAnswers = await dbGet('SELECT COUNT(*) AS count FROM student_answers WHERE session_id=?', [sessionId]);
    assert(beforeSession && beforeSession.id === sessionId, '削除前のセッションが見つかりません');
    assert(beforeAnswers && beforeAnswers.count === 1, '削除前の回答件数が不正です');

    const deleted = await req('DELETE', '/api/exam-sessions/' + encodeURIComponent(sessionId), null, { Cookie: cookie });
    assert(deleted.status === 200, 'DELETE /api/exam-sessions/:id が失敗しました');
    assert(deleted.body && deleted.body.deleted === true, '削除結果が不正です');

    const afterSession = await dbGet('SELECT id FROM exam_sessions WHERE id=?', [sessionId]);
    const afterAnswers = await dbGet('SELECT COUNT(*) AS count FROM student_answers WHERE session_id=?', [sessionId]);
    assert(!afterSession, 'exam_sessions レコードが削除されていません');
    assert(afterAnswers && afterAnswers.count === 0, '関連する student_answers が削除されていません');

    console.log('Exam session delete regression check passed.');
  }catch(error){
    console.error(error.message || error);
    process.exitCode = 1;
  }finally{
    try{ if(sessionId) await dbRun('DELETE FROM exam_sessions WHERE id=?', [sessionId]); }catch(e){}
    try{ if(questionId) await dbRun('DELETE FROM student_answers WHERE question_id=?', [questionId]); }catch(e){}
    try{ if(choiceId) await dbRun('DELETE FROM choices WHERE id=?', [choiceId]); }catch(e){}
    try{ if(questionId) await dbRun('DELETE FROM questions WHERE id=?', [questionId]); }catch(e){}
    try{ if(testId) await dbRun('DELETE FROM tests WHERE id=?', [testId]); }catch(e){}
    try{ if(studentId) await dbRun('DELETE FROM students WHERE id=?', [studentId]); }catch(e){}
    try{ if(classId) await dbRun('DELETE FROM classes WHERE id=?', [classId]); }catch(e){}
    try{ if(teacherId) await dbRun('DELETE FROM teacher_sessions WHERE teacher_id=?', [teacherId]); }catch(e){}
    try{ if(teacherId) await dbRun('DELETE FROM teachers WHERE id=?', [teacherId]); }catch(e){}
    db.close();
  }
})();