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
  let teacherId;
  let classIdA;
  let classIdB;
  let studentIdA;
  let studentIdB;
  let testId;
  let sessionIdA;
  let sessionIdB;

  try{
    teacherId = (await dbRun(
      'INSERT INTO teachers (username, display_name, password_hash, active, created_at) VALUES (?,?,?,?,?)',
      ['exams-class-filter-' + unique, 'Exams Class Filter', 'dummy-hash', 1, now]
    )).lastID;

    await dbRun(
      'INSERT INTO teacher_sessions (token, teacher_id, expires_at, created_at, last_seen_at) VALUES (?,?,?,?,?)',
      [token, teacherId, expiresAt, now, now]
    );

    classIdA = (await dbRun('INSERT INTO classes (teacher_id, name) VALUES (?,?)', [teacherId, 'Class A ' + unique])).lastID;
    classIdB = (await dbRun('INSERT INTO classes (teacher_id, name) VALUES (?,?)', [teacherId, 'Class B ' + unique])).lastID;
    studentIdA = (await dbRun('INSERT INTO students (class_id, name, code) VALUES (?,?,?)', [classIdA, 'Student A', 'a-' + unique])).lastID;
    studentIdB = (await dbRun('INSERT INTO students (class_id, name, code) VALUES (?,?,?)', [classIdB, 'Student B', 'b-' + unique])).lastID;
    testId = (await dbRun('INSERT INTO tests (teacher_id, class_id, name, description, public, randomize) VALUES (?,?,?,?,?,?)', [teacherId, classIdA, 'Shared Test ' + unique, '', 0, 0])).lastID;

    sessionIdA = (await dbRun(
      'INSERT INTO exam_sessions (student_id, test_id, started_at, finished_at, duration_sec, score, max_score, percent, status) VALUES (?,?,?,?,?,?,?,?,?)',
      [studentIdA, testId, now, now, 60, 8, 10, 80, 'completed']
    )).lastID;
    sessionIdB = (await dbRun(
      'INSERT INTO exam_sessions (student_id, test_id, started_at, finished_at, duration_sec, score, max_score, percent, status) VALUES (?,?,?,?,?,?,?,?,?)',
      [studentIdB, testId, now, now, 55, 6, 10, 60, 'completed']
    )).lastID;

    const teacherCookie = { Cookie: 'teacher_session=' + encodeURIComponent(token) };

    const allRes = await req('GET', '/api/exams', null, teacherCookie);
    assert(allRes.status === 200 && Array.isArray(allRes.body), '全件の受験結果取得に失敗しました');
    const allRows = allRes.body.filter(function(row){
      return row && String(row.testId || '') === String(testId);
    });
    assert(allRows.length === 2, '対象テストの受験結果が2件必要です');
    assert(allRows.every(function(row){ return String(row.classId || '') === String(classIdA) && row.className; }), 'テスト紐付け class 情報が返却されていません');
    assert(allRows.some(function(row){ return String(row.studentClassId || '') === String(classIdB); }), '生徒所属クラス情報の確認データが不足しています');

    const filteredRes = await req('GET', '/api/exams?class_id=' + encodeURIComponent(classIdA), null, teacherCookie);
    assert(filteredRes.status === 200 && Array.isArray(filteredRes.body), 'class_id 指定の受験結果取得に失敗しました');
    const filteredRows = filteredRes.body.filter(function(row){
      return row && String(row.testId || '') === String(testId);
    });
    assert(filteredRows.length === 2, 'class_id 絞り込みはテスト紐付けクラスの受験結果をすべて返す必要があります');
    assert(filteredRows.every(function(row){ return String(row.classId || '') === String(classIdA); }), 'class_id 絞り込み結果の classId が不正です');

    console.log('exam reports class filter checks passed');
  }catch(err){
    console.error('ERROR', err);
    process.exitCode = 1;
  }finally{
    try{ if(sessionIdA) await dbRun('DELETE FROM exam_sessions WHERE id=?', [sessionIdA]); }catch(_cleanupErr){}
    try{ if(sessionIdB) await dbRun('DELETE FROM exam_sessions WHERE id=?', [sessionIdB]); }catch(_cleanupErr){}
    try{ if(testId) await dbRun('DELETE FROM tests WHERE id=?', [testId]); }catch(_cleanupErr){}
    try{ if(studentIdA) await dbRun('DELETE FROM students WHERE id=?', [studentIdA]); }catch(_cleanupErr){}
    try{ if(studentIdB) await dbRun('DELETE FROM students WHERE id=?', [studentIdB]); }catch(_cleanupErr){}
    try{ if(classIdA) await dbRun('DELETE FROM classes WHERE id=?', [classIdA]); }catch(_cleanupErr){}
    try{ if(classIdB) await dbRun('DELETE FROM classes WHERE id=?', [classIdB]); }catch(_cleanupErr){}
    try{ await dbRun('DELETE FROM teacher_sessions WHERE token=?', [token]); }catch(_cleanupErr){}
    try{ if(teacherId) await dbRun('DELETE FROM teachers WHERE id=?', [teacherId]); }catch(_cleanupErr){}
  }
})();