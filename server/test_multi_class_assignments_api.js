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
  let classIdC;
  let testId;
  let sessionIdA;
  let sessionIdB;

  try{
    teacherId = (await dbRun(
      'INSERT INTO teachers (username, display_name, password_hash, active, created_at) VALUES (?,?,?,?,?)',
      ['multi-class-' + unique, 'Multi Class Test', 'dummy-hash', 1, now]
    )).lastID;
    await dbRun(
      'INSERT INTO teacher_sessions (token, teacher_id, expires_at, created_at, last_seen_at) VALUES (?,?,?,?,?)',
      [token, teacherId, expiresAt, now, now]
    );
    classIdA = (await dbRun('INSERT INTO classes (teacher_id, name) VALUES (?,?)', [teacherId, 'Class A ' + unique])).lastID;
    classIdB = (await dbRun('INSERT INTO classes (teacher_id, name) VALUES (?,?)', [teacherId, 'Class B ' + unique])).lastID;
    classIdC = (await dbRun('INSERT INTO classes (teacher_id, name) VALUES (?,?)', [teacherId, 'Class C ' + unique])).lastID;

    const teacherCookie = { Cookie: 'teacher_session=' + encodeURIComponent(token) };
    const created = await req('POST', '/api/tests', {
      name: 'Multi assigned ' + unique,
      public: 1,
      randomize: 0,
      class_ids: [classIdA, classIdB]
    }, teacherCookie);
    assert(created.status === 200 && created.body && created.body.id, 'test creation failed');
    testId = created.body.id;
    assert(Array.isArray(created.body.class_ids) && created.body.class_ids.length === 2, 'created test should return two class ids');

    const classATests = await req('GET', '/api/tests?class_id=' + encodeURIComponent(classIdA) + '&public=1');
    assert(classATests.status === 200 && classATests.body.some(t => String(t.id) === String(testId)), 'class A should see the shared test');
    const classBTests = await req('GET', '/api/tests?class_id=' + encodeURIComponent(classIdB) + '&public=1');
    assert(classBTests.status === 200 && classBTests.body.some(t => String(t.id) === String(testId)), 'class B should see the shared test');
    const classCTests = await req('GET', '/api/tests?class_id=' + encodeURIComponent(classIdC) + '&public=1');
    assert(classCTests.status === 200 && !classCTests.body.some(t => String(t.id) === String(testId)), 'class C should not see the shared test');

    const studentA = await req('POST', '/api/students', { class_id: classIdA, name: 'Student A' });
    assert(studentA.status === 200 && studentA.body && studentA.body.id, 'class A student should join');
    const studentB = await req('POST', '/api/students', { class_id: classIdB, name: 'Student B' });
    assert(studentB.status === 200 && studentB.body && studentB.body.id, 'class B student should join');
    const studentC = await req('POST', '/api/students', { class_id: classIdC, name: 'Student C' });
    assert(studentC.status === 400, 'class C student should not join without an assigned public test');

    sessionIdA = (await dbRun(
      'INSERT INTO exam_sessions (student_id, test_id, started_at, finished_at, duration_sec, score, max_score, percent, status) VALUES (?,?,?,?,?,?,?,?,?)',
      [studentA.body.id, testId, now, now, 30, 8, 10, 80, 'completed']
    )).lastID;
    sessionIdB = (await dbRun(
      'INSERT INTO exam_sessions (student_id, test_id, started_at, finished_at, duration_sec, score, max_score, percent, status) VALUES (?,?,?,?,?,?,?,?,?)',
      [studentB.body.id, testId, now, now, 35, 7, 10, 70, 'completed']
    )).lastID;
    const reportA = await req('GET', '/api/exams?class_id=' + encodeURIComponent(classIdA), null, teacherCookie);
    assert(reportA.status === 200 && reportA.body.filter(row => String(row.testId) === String(testId)).length === 1, 'reports should filter by class A student membership');
    const reportB = await req('GET', '/api/exams?class_id=' + encodeURIComponent(classIdB), null, teacherCookie);
    assert(reportB.status === 200 && reportB.body.filter(row => String(row.testId) === String(testId)).length === 1, 'reports should filter by class B student membership');

    console.log('multi-class assignment checks passed');
  }catch(err){
    console.error('ERROR', err);
    process.exitCode = 1;
  }finally{
    try{ if(sessionIdA) await dbRun('DELETE FROM exam_sessions WHERE id=?', [sessionIdA]); }catch(_cleanupErr){}
    try{ if(sessionIdB) await dbRun('DELETE FROM exam_sessions WHERE id=?', [sessionIdB]); }catch(_cleanupErr){}
    try{ if(testId) await dbRun('DELETE FROM test_classes WHERE test_id=?', [testId]); }catch(_cleanupErr){}
    try{ if(testId) await dbRun('DELETE FROM tests WHERE id=?', [testId]); }catch(_cleanupErr){}
    try{ if(classIdA) await dbRun('DELETE FROM students WHERE class_id=?', [classIdA]); }catch(_cleanupErr){}
    try{ if(classIdB) await dbRun('DELETE FROM students WHERE class_id=?', [classIdB]); }catch(_cleanupErr){}
    try{ if(classIdC) await dbRun('DELETE FROM students WHERE class_id=?', [classIdC]); }catch(_cleanupErr){}
    try{ if(classIdA) await dbRun('DELETE FROM classes WHERE id=?', [classIdA]); }catch(_cleanupErr){}
    try{ if(classIdB) await dbRun('DELETE FROM classes WHERE id=?', [classIdB]); }catch(_cleanupErr){}
    try{ if(classIdC) await dbRun('DELETE FROM classes WHERE id=?', [classIdC]); }catch(_cleanupErr){}
    try{ await dbRun('DELETE FROM teacher_sessions WHERE token=?', [token]); }catch(_cleanupErr){}
    try{ if(teacherId) await dbRun('DELETE FROM teachers WHERE id=?', [teacherId]); }catch(_cleanupErr){}
  }
})();
