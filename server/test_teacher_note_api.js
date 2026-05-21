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

(async () => {
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);
  const username = 'teacher-note-test-' + unique;
  const token = crypto.randomBytes(24).toString('hex');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  let teacherId = null;
  let classId = null;
  let testId = null;

  try{
    const teacher = await dbRun(
      'INSERT INTO teachers (username, display_name, password_hash, active, created_at) VALUES (?,?,?,?,?)',
      [username, 'Teacher Note API Test', 'dummy-hash', 1, now]
    );
    teacherId = teacher.lastID;

    await dbRun(
      'INSERT INTO teacher_sessions (token, teacher_id, expires_at, created_at, last_seen_at) VALUES (?,?,?,?,?)',
      [token, teacherId, expiresAt, now, now]
    );

    const createdClass = await dbRun(
      'INSERT INTO classes (teacher_id, name) VALUES (?,?)',
      [teacherId, 'Teacher Note Class ' + unique]
    );
    classId = createdClass.lastID;

    const teacherCookie = { Cookie: 'teacher_session=' + encodeURIComponent(token) };
    const initialNote = 'Bring printed rubric for ' + unique;
    const createdTest = await req('POST', '/api/tests', {
      class_id: classId,
      name: 'Teacher Note Test ' + unique,
      description: '',
      public: 1,
      randomize: 0,
      teacher_note: initialNote
    }, teacherCookie);

    assert(createdTest.status === 200 && createdTest.body && createdTest.body.id, 'test create failed');
    testId = createdTest.body.id;
    assert(createdTest.body.teacher_note === initialNote, 'created test should include teacher_note for teacher');

    const teacherList = await req('GET', '/api/tests?include_archived=1', null, teacherCookie);
    const listed = (teacherList.body || []).find(test => test.id === testId);
    assert(listed && listed.teacher_note === initialNote, 'teacher list should include teacher_note');

    const updatedNote = 'Updated note ' + unique;
    const updatedTest = await req('PUT', '/api/tests/' + encodeURIComponent(testId), {
      name: listed.name,
      description: '',
      public: 1,
      randomize: 1,
      class_id: classId,
      archived: 0,
      teacher_note: updatedNote
    }, teacherCookie);
    assert(updatedTest.status === 200 && updatedTest.body.teacher_note === updatedNote, 'teacher_note update failed');

    const publicStudentList = await req('GET', '/api/tests?class_id=' + encodeURIComponent(classId) + '&public=1');
    const publicListed = (publicStudentList.body || []).find(test => test.id === testId);
    assert(publicListed, 'student public list should include public test');
    assert(!Object.prototype.hasOwnProperty.call(publicListed, 'teacher_note'), 'student public list must not expose teacher_note');

    const publicToggle = await req('PUT', '/api/tests/' + encodeURIComponent(testId), {
      name: listed.name,
      description: '',
      public: 0,
      randomize: 0,
      class_id: classId,
      archived: 0
    }, teacherCookie);
    assert(publicToggle.status === 200 && publicToggle.body.teacher_note === updatedNote, 'metadata update should preserve teacher_note');

    console.log('teacher note API checks passed');
  }catch(err){
    console.error('ERROR', err);
    process.exitCode = 1;
  }finally{
    try{
      if(testId) await dbRun('DELETE FROM tests WHERE id=?', [testId]);
      if(classId) await dbRun('DELETE FROM classes WHERE id=?', [classId]);
      await dbRun('DELETE FROM teacher_sessions WHERE token=?', [token]);
      if(teacherId) await dbRun('DELETE FROM teachers WHERE id=?', [teacherId]);
    }catch(_cleanupErr){
      // ignore cleanup errors in the test script
    }
  }
})();
