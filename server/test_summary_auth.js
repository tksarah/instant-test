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
          // keep raw body when the response is not JSON
        }
        resolve({
          status: res.statusCode,
          body: parsed,
          headers: res.headers
        });
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
  let teacherToken = null;
  try{
    const test = await dbGet('SELECT id, class_id, teacher_id FROM tests WHERE public=1 ORDER BY id ASC LIMIT 1');
    assert(test && test.id, '公開テストが必要です');

    const studentARes = await req('POST', '/api/students', { class_id: test.class_id, name: '認可テストA' });
    assert(studentARes.status === 200 && studentARes.body && studentARes.body.id, 'student A の作成に失敗しました');
    const studentACookie = extractCookie(studentARes.headers);
    assert(studentACookie.includes('student_session='), 'student A のセッションクッキーが設定されていません');
    const studentA = studentARes.body;

    const studentBRes = await req('POST', '/api/students', { class_id: test.class_id, name: '認可テストB' });
    assert(studentBRes.status === 200 && studentBRes.body && studentBRes.body.id, 'student B の作成に失敗しました');
    const studentBCookie = extractCookie(studentBRes.headers);
    assert(studentBCookie.includes('student_session='), 'student B のセッションクッキーが設定されていません');
    const studentB = studentBRes.body;

    const anonymousSessionStart = await req('POST', '/api/exam-sessions', { student_id: studentA.id, test_id: test.id });
    assert(anonymousSessionStart.status === 401, '未認証の受験セッション開始は 401 で拒否される必要があります');

    const foreignSessionStart = await req('POST', '/api/exam-sessions', { student_id: studentA.id, test_id: test.id }, { Cookie: studentBCookie });
    assert(foreignSessionStart.status === 403, '他人生徒としての受験セッション開始は 403 で拒否される必要があります');

    const sessionARes = await req('POST', '/api/exam-sessions', { student_id: studentA.id, test_id: test.id }, { Cookie: studentACookie });
    assert(sessionARes.status === 200 && sessionARes.body && sessionARes.body.id, 'student A の受験セッション作成に失敗しました');
    const sessionA = sessionARes.body;

    const sessionAQuestions = await req('GET', `/api/exam-sessions/${sessionA.id}/questions`, null, { Cookie: studentACookie });
    assert(sessionAQuestions.status === 200 && Array.isArray(sessionAQuestions.body) && sessionAQuestions.body.length > 0, 'student A のセッション問題取得に失敗しました');
    const question = sessionAQuestions.body[0];
    assert(question && question.id, '問題IDを取得できませんでした');
    assert(Array.isArray(question.choices) && question.choices.length > 0, '問題に選択肢が必要です');
    const choice = question.choices[0];

    const sessionBRes = await req('POST', '/api/exam-sessions', { student_id: studentB.id, test_id: test.id }, { Cookie: studentBCookie });
    assert(sessionBRes.status === 200 && sessionBRes.body && sessionBRes.body.id, 'student B の受験セッション作成に失敗しました');
    const sessionB = sessionBRes.body;

    const anonymousSessionQuestions = await req('GET', `/api/exam-sessions/${sessionA.id}/questions`);
    assert(anonymousSessionQuestions.status === 401, '未認証のセッション問題取得は 401 で拒否される必要があります');

    const foreignSessionQuestions = await req('GET', `/api/exam-sessions/${sessionA.id}/questions`, null, { Cookie: studentBCookie });
    assert(foreignSessionQuestions.status === 403, '他人生徒のセッション問題取得は 403 で拒否される必要があります');

    const submitARes = await req('POST', '/api/submit-answer', {
      student_id: studentA.id,
      test_id: test.id,
      question_id: question.id,
      choice_id: choice.id,
      session_id: sessionA.id
    }, { Cookie: studentACookie });
    assert(submitARes.status === 200, 'student A の回答送信に失敗しました');

    const anonymousSubmit = await req('POST', '/api/submit-answer', {
      student_id: studentA.id,
      test_id: test.id,
      question_id: question.id,
      choice_id: choice.id,
      session_id: sessionA.id
    });
    assert(anonymousSubmit.status === 401, '未認証の回答送信は 401 で拒否される必要があります');

    const foreignSubmit = await req('POST', '/api/submit-answer', {
      student_id: studentA.id,
      test_id: test.id,
      question_id: question.id,
      choice_id: choice.id,
      session_id: sessionA.id
    }, { Cookie: studentBCookie });
    assert(foreignSubmit.status === 403, '他人生徒としての回答送信は 403 で拒否される必要があります');

    const hijackedSubmit = await req('POST', '/api/submit-answer', {
      student_id: studentA.id,
      test_id: test.id,
      question_id: question.id,
      choice_id: choice.id,
      session_id: sessionB.id
    }, { Cookie: studentACookie });
    assert(hijackedSubmit.status === 403, '他人の session_id を使う回答送信は 403 で拒否される必要があります');

    const anonymousSummary = await req('GET', `/api/tests/${test.id}/summary?student_id=${studentA.id}`);
    assert(anonymousSummary.status === 401, '未認証アクセスは 401 で拒否される必要があります');

    const anonymousAnswers = await req('GET', `/api/studentAnswers?student_id=${studentA.id}&test_id=${test.id}`);
    assert(anonymousAnswers.status === 401, '未認証の studentAnswers 取得は 401 で拒否される必要があります');

    const ownSummary = await req('GET', `/api/tests/${test.id}/summary?student_id=${studentA.id}&session_id=${sessionA.id}`, null, { Cookie: studentACookie });
    assert(ownSummary.status === 403, '完了前の summary 取得は 403 で拒否される必要があります');

    const studentAnswersAsStudent = await req('GET', `/api/studentAnswers?student_id=${studentA.id}&test_id=${test.id}`, null, { Cookie: studentACookie });
    assert(studentAnswersAsStudent.status === 401, '生徒からの studentAnswers 取得は 401 で拒否される必要があります');

    const otherStudentSummary = await req('GET', `/api/tests/${test.id}/summary?student_id=${studentA.id}&session_id=${sessionA.id}`, null, { Cookie: studentBCookie });
    assert(otherStudentSummary.status === 403, '他人生徒の summary 取得は 403 で拒否される必要があります');

    const hijackedSessionSummary = await req('GET', `/api/tests/${test.id}/summary?student_id=${studentA.id}&session_id=${sessionB.id}`, null, { Cookie: studentACookie });
    assert(hijackedSessionSummary.status === 403, '他人の session_id を指定した summary 取得は 403 で拒否される必要があります');

    const anonymousFinish = await req('PUT', `/api/exam-sessions/${sessionA.id}/finish`);
    assert(anonymousFinish.status === 401, '未認証の受験終了は 401 で拒否される必要があります');

    const foreignFinish = await req('PUT', `/api/exam-sessions/${sessionA.id}/finish`, null, { Cookie: studentBCookie });
    assert(foreignFinish.status === 403, '他人生徒としての受験終了は 403 で拒否される必要があります');

    const ownFinish = await req('PUT', `/api/exam-sessions/${sessionA.id}/finish`, null, { Cookie: studentACookie });
    assert(ownFinish.status === 200, '本人の受験終了は成功する必要があります');

    const finishedSummary = await req('GET', `/api/tests/${test.id}/summary?student_id=${studentA.id}&session_id=${sessionA.id}`, null, { Cookie: studentACookie });
    assert(finishedSummary.status === 200, '完了後の本人 summary 取得は成功する必要があります');
    assert(finishedSummary.body && Array.isArray(finishedSummary.body.details), 'summary の本文形式が不正です');

    teacherToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await dbRun('INSERT INTO teacher_sessions (token, teacher_id, expires_at, created_at, last_seen_at) VALUES (?,?,?,?,?)', [teacherToken, test.teacher_id, expiresAt, new Date().toISOString(), new Date().toISOString()]);
    const teacherSummary = await req('GET', `/api/tests/${test.id}/summary?student_id=${studentA.id}&session_id=${sessionA.id}`, null, { Cookie: `teacher_session=${teacherToken}` });
    assert(teacherSummary.status === 200, 'テスト担当教師の summary 取得は成功する必要があります');
    const teacherAnswers = await req('GET', `/api/studentAnswers?student_id=${studentA.id}&test_id=${test.id}`, null, { Cookie: `teacher_session=${teacherToken}` });
    assert(teacherAnswers.status === 200, 'テスト担当教師の studentAnswers 取得は成功する必要があります');
    assert(Array.isArray(teacherAnswers.body), 'studentAnswers は配列で返る必要があります');

    console.log('summary authorization checks passed');
  }catch(err){
    console.error('ERROR', err);
    process.exitCode = 1;
  }finally{
    if(teacherToken){
      try{
        await dbRun('DELETE FROM teacher_sessions WHERE token=?', [teacherToken]);
      }catch(_cleanupErr){
        // ignore cleanup errors in the test script
      }
    }
  }
})();