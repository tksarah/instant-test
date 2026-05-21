const http = require('http');
const crypto = require('crypto');
const db = require('./db');

function dbRun(sql, params){
  return new Promise((resolve, reject) => {
    db.run(sql, params || [], function(err){
      if(err) reject(err);
      else resolve(this);
    });
  });
}

function req(method, requestPath, data, headers){
  const body = data ? JSON.stringify(data) : null;
  const opts = {
    hostname: 'localhost',
    port: 3000,
    path: requestPath,
    method,
    headers: Object.assign({}, headers || {})
  };
  if(body){
    opts.headers['Content-Type'] = 'application/json';
    opts.headers['Content-Length'] = Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const request = http.request(opts, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: raw ? JSON.parse(raw) : null });
      });
    });
    request.on('error', reject);
    if(body) request.write(body);
    request.end();
  });
}

function multipartUpload(requestPath, fieldName, filename, mimeType, fileBuffer, headers){
  const boundary = '----instanttest-' + crypto.randomBytes(8).toString('hex');
  const head = Buffer.from(
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="' + fieldName + '"; filename="' + filename + '"\r\n' +
    'Content-Type: ' + mimeType + '\r\n\r\n'
  );
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
  const body = Buffer.concat([head, fileBuffer, tail]);
  const opts = {
    hostname: 'localhost',
    port: 3000,
    path: requestPath,
    method: 'POST',
    headers: Object.assign({
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Content-Length': body.length
    }, headers || {})
  };
  return new Promise((resolve, reject) => {
    const request = http.request(opts, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: raw ? JSON.parse(raw) : null });
      });
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function assert(condition, message){
  if(!condition) throw new Error(message);
}

(async function(){
  const unique = Date.now();
  const token = 'rich-' + crypto.randomBytes(12).toString('hex');
  let teacherId;
  let classId;
  let testId;
  let questionId;
  try{
    teacherId = (await dbRun(
      'INSERT INTO teachers (username, display_name, password_hash, active, created_at) VALUES (?,?,?,?,?)',
      ['rich-teacher-' + unique, 'Rich Teacher', 'test', 1, new Date().toISOString()]
    )).lastID;
    await dbRun(
      'INSERT INTO teacher_sessions (token, teacher_id, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?)',
      [token, teacherId, new Date().toISOString(), new Date().toISOString(), new Date(Date.now() + 3600 * 1000).toISOString()]
    );
    classId = (await dbRun('INSERT INTO classes (teacher_id, name) VALUES (?,?)', [teacherId, 'Rich Class ' + unique])).lastID;
    const cookie = { Cookie: 'teacher_session=' + encodeURIComponent(token) };

    const createdTest = await req('POST', '/api/tests', { class_id: classId, name: 'Rich Test ' + unique, public: 1 }, cookie);
    assert(createdTest.status === 200 && createdTest.body && createdTest.body.id, 'test create failed');
    testId = createdTest.body.id;

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
    const uploaded = await multipartUpload('/api/question-images', 'image', 'pixel.png', 'image/png', png, cookie);
    assert(uploaded.status === 200 && uploaded.body && /^\/uploads\/question-images\//.test(uploaded.body.url), 'image upload failed');

    const richHtml = '<p><strong>太字</strong> <a href="https://example.com">link</a></p>' +
      '<pre><code>if (a &lt; b) return a;</code></pre>' +
      '<p><img src="' + uploaded.body.url + '" alt="pixel"></p>' +
      '<script>alert(1)</script><img src="https://evil.example/x.png" onerror="alert(1)">';
    const createdQuestion = await req('POST', '/api/tests/' + testId + '/questions', {
      text: '太字 link if code',
      content_html: richHtml,
      type: 'single',
      points: 1,
      choices: [
        { text: 'A', is_correct: 1 },
        { text: 'B', is_correct: 0 }
      ],
      explanation: ''
    }, cookie);
    assert(createdQuestion.status === 200 && createdQuestion.body && createdQuestion.body.id, 'question create failed');
    questionId = createdQuestion.body.id;

    const questions = await req('GET', '/api/tests/' + testId + '/questions', null, cookie);
    assert(questions.status === 200 && Array.isArray(questions.body) && questions.body.length === 1, 'question fetch failed');
    const question = questions.body[0];
    assert(question.content_format === 'html', 'content_format should be html');
    assert(question.content_html.includes('<pre><code>'), 'code block should be preserved');
    assert(question.content_html.includes(uploaded.body.url), 'internal uploaded image should be preserved');
    assert(!question.content_html.includes('<script'), 'script should be stripped');
    assert(!question.content_html.includes('evil.example'), 'external image should be stripped');
    assert(!question.content_html.includes('onerror'), 'event handlers should be stripped');

    console.log('Rich question content API regression check passed.');
  }catch(error){
    console.error(error.message || error);
    process.exitCode = 1;
  }finally{
    try{ if(questionId) await dbRun('DELETE FROM choices WHERE question_id=?', [questionId]); }catch(_err){}
    try{ if(questionId) await dbRun('DELETE FROM questions WHERE id=?', [questionId]); }catch(_err){}
    try{ if(testId) await dbRun('DELETE FROM tests WHERE id=?', [testId]); }catch(_err){}
    try{ if(classId) await dbRun('DELETE FROM classes WHERE id=?', [classId]); }catch(_err){}
    try{ if(teacherId) await dbRun('DELETE FROM teacher_sessions WHERE teacher_id=?', [teacherId]); }catch(_err){}
    try{ if(teacherId) await dbRun('DELETE FROM teachers WHERE id=?', [teacherId]); }catch(_err){}
    db.close();
  }
})();
