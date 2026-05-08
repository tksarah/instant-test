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
  const username = 'archive-test-' + unique;
  const token = crypto.randomBytes(24).toString('hex');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  let teacherId = null;
  let classId = null;
  let activeTestId = null;
  let archivedTestId = null;

  try{
    const teacher = await dbRun(
      'INSERT INTO teachers (username, display_name, password_hash, active, created_at) VALUES (?,?,?,?,?)',
      [username, 'Archive API Test', 'dummy-hash', 1, now]
    );
    teacherId = teacher.lastID;

    await dbRun(
      'INSERT INTO teacher_sessions (token, teacher_id, expires_at, created_at, last_seen_at) VALUES (?,?,?,?,?)',
      [token, teacherId, expiresAt, now, now]
    );

    const createdClass = await dbRun(
      'INSERT INTO classes (teacher_id, name) VALUES (?,?)',
      [teacherId, 'Archive API Class ' + unique]
    );
    classId = createdClass.lastID;

    const activeTest = await dbRun(
      'INSERT INTO tests (teacher_id, class_id, name, description, public, randomize, archived) VALUES (?,?,?,?,?,?,?)',
      [teacherId, classId, 'Archive Active ' + unique, '', 1, 0, 0]
    );
    activeTestId = activeTest.lastID;

    const archivedTest = await dbRun(
      'INSERT INTO tests (teacher_id, class_id, name, description, public, randomize, archived) VALUES (?,?,?,?,?,?,?)',
      [teacherId, classId, 'Archive Hidden ' + unique, '', 1, 0, 1]
    );
    archivedTestId = archivedTest.lastID;

    const teacherCookie = { Cookie: 'teacher_session=' + encodeURIComponent(token) };

    const teacherDefault = await req('GET', '/api/tests', null, teacherCookie);
    assert(teacherDefault.status === 200 && Array.isArray(teacherDefault.body), '教師の一覧取得に失敗しました');
    assert(teacherDefault.body.some(test => test.id === activeTestId), '通常一覧に運用中テストが必要です');
    assert(!teacherDefault.body.some(test => test.id === archivedTestId), '通常一覧にアーカイブ済みテストは含まれない必要があります');

    const teacherArchived = await req('GET', '/api/tests?archived=1', null, teacherCookie);
    assert(teacherArchived.status === 200 && Array.isArray(teacherArchived.body), 'アーカイブ一覧取得に失敗しました');
    assert(teacherArchived.body.some(test => test.id === archivedTestId), 'archived=1 でアーカイブ済みテストが必要です');
    assert(!teacherArchived.body.some(test => test.id === activeTestId), 'archived=1 に運用中テストは含まれない必要があります');

    const teacherAll = await req('GET', '/api/tests?include_archived=1', null, teacherCookie);
    assert(teacherAll.status === 200 && Array.isArray(teacherAll.body), '全件一覧取得に失敗しました');
    assert(teacherAll.body.some(test => test.id === activeTestId), 'include_archived=1 で運用中テストが必要です');
    assert(teacherAll.body.some(test => test.id === archivedTestId), 'include_archived=1 でアーカイブ済みテストが必要です');

    const archiveUpdate = await req('PUT', '/api/tests/' + encodeURIComponent(activeTestId), {
      name: 'Archive Active ' + unique,
      description: '',
      public: 0,
      randomize: 0,
      class_id: classId,
      archived: 1
    }, teacherCookie);
    assert(archiveUpdate.status === 200 && archiveUpdate.body && archiveUpdate.body.archived === 1, 'アーカイブ更新に失敗しました');

    const teacherDefaultAfterArchive = await req('GET', '/api/tests', null, teacherCookie);
    assert(!teacherDefaultAfterArchive.body.some(test => test.id === activeTestId), 'アーカイブ後は通常一覧から外れる必要があります');

    const restoreUpdate = await req('PUT', '/api/tests/' + encodeURIComponent(activeTestId), {
      name: 'Archive Active ' + unique,
      description: '',
      public: 1,
      randomize: 0,
      class_id: classId,
      archived: 0
    }, teacherCookie);
    assert(restoreUpdate.status === 200 && restoreUpdate.body && restoreUpdate.body.archived === 0, '復元更新に失敗しました');

    const publicStudentList = await req('GET', '/api/tests?class_id=' + encodeURIComponent(classId) + '&public=1');
    assert(publicStudentList.status === 200 && Array.isArray(publicStudentList.body), '生徒向け一覧取得に失敗しました');
    assert(publicStudentList.body.some(test => test.id === activeTestId), '生徒向け一覧に運用中公開テストが必要です');
    assert(!publicStudentList.body.some(test => test.id === archivedTestId), '生徒向け一覧にアーカイブ済み公開テストは含まれない必要があります');

    console.log('archive API checks passed');
  }catch(err){
    console.error('ERROR', err);
    process.exitCode = 1;
  }finally{
    try{
      if(activeTestId) await dbRun('DELETE FROM tests WHERE id=?', [activeTestId]);
      if(archivedTestId) await dbRun('DELETE FROM tests WHERE id=?', [archivedTestId]);
      if(classId) await dbRun('DELETE FROM classes WHERE id=?', [classId]);
      await dbRun('DELETE FROM teacher_sessions WHERE token=?', [token]);
      if(teacherId) await dbRun('DELETE FROM teachers WHERE id=?', [teacherId]);
    }catch(_cleanupErr){
      // ignore cleanup errors in the test script
    }
  }
})();
