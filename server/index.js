require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const geminiAi = require('./geminiAi');
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/vendor', express.static(path.join(__dirname, 'node_modules')));
app.use(express.static(path.join(__dirname, 'public')));

function parseCookies(headerValue){
  const header = typeof headerValue === 'string' ? headerValue : '';
  const out = {};
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if(idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if(!key) return;
    out[key] = decodeURIComponent(val);
  });
  return out;
}

function timingSafeEqualStr(a, b){
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if(aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function makePasswordHash(password){
  const iterations = 210000;
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex');
  // format: pbkdf2$sha256$<iterations>$<salt>$<hash>
  return `pbkdf2$sha256$${iterations}$${salt}$${derived}`.replace(/\$\$/g, '$');
}

function verifyPassword(password, stored){
  const raw = String(stored || '');
  // expected: pbkdf2$sha256$<iterations>$<salt>$<hash>
  const parts = raw.split('$');
  if(parts.length !== 5) return false;
  if(parts[0] !== 'pbkdf2') return false;
  if(parts[1] !== 'sha256') return false;
  const iterations = parseInt(parts[2], 10);
  const salt = parts[3];
  const hashHex = parts[4];
  if(!iterations || !salt || !hashHex) return false;
  const derived = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex');
  return timingSafeEqualStr(derived, hashHex);
}

function setTeacherSessionCookie(res, token, maxAgeSec){
  const safeAge = Math.max(0, parseInt(maxAgeSec, 10) || 0);
  const cookie = `teacher_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${safeAge}`;
  res.setHeader('Set-Cookie', cookie);
}

function clearTeacherSessionCookie(res){
  res.setHeader('Set-Cookie', 'teacher_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function dbGetAsync(sql, params){
  return new Promise((resolve, reject) => {
    db.get(sql, params || [], (err, row) => {
      if(err) return reject(err);
      resolve(row);
    });
  });
}

function dbAllAsync(sql, params){
  return new Promise((resolve, reject) => {
    db.all(sql, params || [], (err, rows) => {
      if(err) return reject(err);
      resolve(rows || []);
    });
  });
}

function dbRunAsync(sql, params){
  return new Promise((resolve, reject) => {
    db.run(sql, params || [], function(err){
      if(err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

async function getTeacherDataSummary(teacherId){
  const id = Number(teacherId);
  const [classesRow, testsRow, questionsRow, studentsRow, answersRow, examsRow, sessionsRow] = await Promise.all([
    dbGetAsync('SELECT COUNT(*) AS count FROM classes WHERE teacher_id=?', [id]),
    dbGetAsync('SELECT COUNT(*) AS count FROM tests WHERE teacher_id=?', [id]),
    dbGetAsync('SELECT COUNT(*) AS count FROM questions WHERE test_id IN (SELECT id FROM tests WHERE teacher_id=?)', [id]),
    dbGetAsync('SELECT COUNT(*) AS count FROM students WHERE class_id IN (SELECT id FROM classes WHERE teacher_id=?)', [id]),
    dbGetAsync('SELECT COUNT(*) AS count FROM student_answers WHERE test_id IN (SELECT id FROM tests WHERE teacher_id=?) OR student_id IN (SELECT id FROM students WHERE class_id IN (SELECT id FROM classes WHERE teacher_id=?))', [id, id]),
    dbGetAsync('SELECT COUNT(*) AS count FROM exam_sessions WHERE test_id IN (SELECT id FROM tests WHERE teacher_id=?) OR student_id IN (SELECT id FROM students WHERE class_id IN (SELECT id FROM classes WHERE teacher_id=?))', [id, id]),
    dbGetAsync('SELECT COUNT(*) AS count FROM teacher_sessions WHERE teacher_id=?', [id])
  ]);

  return {
    classes: classesRow ? classesRow.count : 0,
    tests: testsRow ? testsRow.count : 0,
    questions: questionsRow ? questionsRow.count : 0,
    students: studentsRow ? studentsRow.count : 0,
    student_answers: answersRow ? answersRow.count : 0,
    exam_sessions: examsRow ? examsRow.count : 0,
    teacher_sessions: sessionsRow ? sessionsRow.count : 0
  };
}

async function deleteTeacherCascade(teacherId){
  const id = Number(teacherId);
  const teacher = await dbGetAsync('SELECT id, username, display_name, active, created_at FROM teachers WHERE id=?', [id]);
  if(!teacher) return null;

  const summary = await getTeacherDataSummary(id);

  await dbRunAsync('BEGIN IMMEDIATE TRANSACTION');
  try{
    await dbRunAsync('DELETE FROM teacher_sessions WHERE teacher_id=?', [id]);
    await dbRunAsync('DELETE FROM student_answers WHERE test_id IN (SELECT id FROM tests WHERE teacher_id=?) OR student_id IN (SELECT id FROM students WHERE class_id IN (SELECT id FROM classes WHERE teacher_id=?))', [id, id]);
    await dbRunAsync('DELETE FROM exam_sessions WHERE test_id IN (SELECT id FROM tests WHERE teacher_id=?) OR student_id IN (SELECT id FROM students WHERE class_id IN (SELECT id FROM classes WHERE teacher_id=?))', [id, id]);
    await dbRunAsync('DELETE FROM choices WHERE question_id IN (SELECT id FROM questions WHERE test_id IN (SELECT id FROM tests WHERE teacher_id=?))', [id]);
    await dbRunAsync('DELETE FROM questions WHERE test_id IN (SELECT id FROM tests WHERE teacher_id=?)', [id]);
    await dbRunAsync('DELETE FROM tests WHERE teacher_id=?', [id]);
    await dbRunAsync('DELETE FROM students WHERE class_id IN (SELECT id FROM classes WHERE teacher_id=?)', [id]);
    await dbRunAsync('DELETE FROM classes WHERE teacher_id=?', [id]);
    const teacherDelete = await dbRunAsync('DELETE FROM teachers WHERE id=?', [id]);
    if(!teacherDelete.changes){
      throw new Error('teacher_delete_failed');
    }
    await dbRunAsync('COMMIT');
    return { teacher: teacher, summary: summary };
  }catch(err){
    try{
      await dbRunAsync('ROLLBACK');
    }catch(_rollbackErr){
      // ignore rollback errors and surface the original failure
    }
    throw err;
  }
}

// Attach req.teacher when session cookie exists and is valid
app.use((req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.teacher_session;
  if(!token) return next();
  db.get(
    'SELECT ts.token, ts.teacher_id, ts.expires_at, t.username, t.display_name, t.active FROM teacher_sessions ts JOIN teachers t ON t.id=ts.teacher_id WHERE ts.token=?',
    [token],
    (err, row) => {
      if(err || !row) return next();
      if(row.active === 0){
        return next();
      }
      const nowIso = new Date().toISOString();
      if(row.expires_at && Date.parse(row.expires_at) <= Date.now()){
        db.run('DELETE FROM teacher_sessions WHERE token=?', [token], () => next());
        return;
      }
      req.teacher = {
        id: row.teacher_id,
        username: row.username,
        display_name: row.display_name || ''
      };
      db.run('UPDATE teacher_sessions SET last_seen_at=? WHERE token=?', [nowIso, token], () => next());
    }
  );
});

function requireTeacher(req, res, next){
  if(!req.teacher) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function requireAdmin(req, res, next){
  const expected = process.env.ADMIN_PASSWORD;
  if(!expected){
    return res.status(500).json({ error: 'admin_not_configured', hint: 'Set ADMIN_PASSWORD in .env' });
  }
  const provided = req.get('x-admin-password') || '';
  if(!timingSafeEqualStr(provided, expected)){
    return res.status(401).json({ error: 'admin_unauthorized' });
  }
  next();
}

function ensureTeacherOwnsClass(req, res, classId, cb){
  db.get('SELECT * FROM classes WHERE id=? AND teacher_id=?', [classId, req.teacher.id], (err, row) => {
    if(err) return res.status(500).json({ error: err.message });
    if(!row) return res.status(404).json({ error: 'not_found' });
    cb(row);
  });
}

function ensureTeacherOwnsTest(req, res, testId, cb){
  db.get('SELECT * FROM tests WHERE id=? AND teacher_id=?', [testId, req.teacher.id], (err, row) => {
    if(err) return res.status(500).json({ error: err.message });
    if(!row) return res.status(404).json({ error: 'not_found' });
    cb(row);
  });
}

function buildTestSummaryForStudent(testId, studentId, sessionId){
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM questions WHERE test_id=?', [testId], (err, questions) => {
      if(err) return reject(err);
      const qids = (questions || []).map(q => q.id);
      if(qids.length === 0){
        return resolve({ total_points: 0, earned_points: 0, details: [] });
      }
      db.all(`SELECT * FROM choices WHERE question_id IN (${qids.join(',')})`, (err2, choices) => {
        if(err2) return reject(err2);
        const choicesMap = {};
        (choices || []).forEach(c => {
          choicesMap[c.question_id] = choicesMap[c.question_id] || [];
          choicesMap[c.question_id].push(c);
        });
        const fetchAnswers = sessionId
          ? function(done){
              db.all('SELECT * FROM student_answers WHERE session_id=?', [sessionId], (sessionErr, sessionAnswers) => {
                if(sessionErr) return done(sessionErr);
                if(sessionAnswers && sessionAnswers.length > 0){
                  return done(null, sessionAnswers);
                }
                db.all('SELECT * FROM student_answers WHERE student_id=? AND test_id=?', [studentId, testId], done);
              });
            }
          : function(done){
              db.all('SELECT * FROM student_answers WHERE student_id=? AND test_id=?', [studentId, testId], done);
            };
        fetchAnswers((err3, answers) => {
          if(err3) return reject(err3);
          const answersMap = {};
          (answers || []).forEach(a => {
            answersMap[a.question_id] = answersMap[a.question_id] || [];
            answersMap[a.question_id].push(a);
          });
          let total = 0;
          let earned = 0;
          const details = (questions || []).map(q => {
            const qChoices = choicesMap[q.id] || [];
            const correctIds = qChoices.filter(c => c.is_correct === 1 || c.is_correct === true).map(c => c.id);
            const given = (answersMap[q.id] || []).map(a => a.choice_id).filter(x => x !== null && typeof x !== 'undefined');
            const uniqueGiven = Array.from(new Set(given));
            const qTotal = q.points || 1;
            total += qTotal;
            let correct = false;
            if(uniqueGiven.length > 0){
              const submittedSet = new Set(uniqueGiven.map(x => parseInt(x, 10)));
              const correctSet = new Set(correctIds.map(x => parseInt(x, 10)));
              if(submittedSet.size === correctSet.size && [...submittedSet].every(x => correctSet.has(x))){
                correct = true;
              }
            }
            if(correct) earned += qTotal;
            return {
              question_id: q.id,
              text: q.text,
              points: qTotal,
              correct: correct,
              given_choice_ids: uniqueGiven,
              correct_choice_ids: correctIds
            };
          });
          resolve({ total_points: total, earned_points: earned, details: details });
        });
      });
    });
  });
}

function ensurePublicTestAccess(res, testId, cb){
  db.get('SELECT * FROM tests WHERE id=? AND public=1', [testId], (err, row) => {
    if(err) return res.status(500).json({ error: err.message });
    if(!row) return res.status(404).json({ error: 'not_found' });
    cb(row);
  });
}

// Teacher auth APIs
app.get('/api/teacher/me', (req, res) => {
  if(!req.teacher) return res.status(401).json({ error: 'unauthorized' });
  res.json({ teacher: req.teacher });
});

app.post('/api/teacher/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = typeof username === 'string' ? username.trim() : '';
  const p = typeof password === 'string' ? password : '';
  if(!u || !p) return res.status(400).json({ error: 'username_and_password_required' });
  db.get('SELECT * FROM teachers WHERE username=? AND active=1', [u], (err, row) => {
    if(err) return res.status(500).json({ error: err.message });
    if(!row) return res.status(401).json({ error: 'invalid_credentials' });
    if(!verifyPassword(p, row.password_hash)){
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    const nowIso = new Date().toISOString();
    const maxAgeSec = 60 * 60 * 24 * 14; // 14 days
    const expiresIso = new Date(Date.now() + maxAgeSec * 1000).toISOString();
    db.run(
      'INSERT INTO teacher_sessions (token, teacher_id, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?)',
      [token, row.id, nowIso, nowIso, expiresIso],
      function(e){
        if(e) return res.status(500).json({ error: e.message });
        setTeacherSessionCookie(res, token, maxAgeSec);
        res.json({ teacher: { id: row.id, username: row.username, display_name: row.display_name || '' } });
      }
    );
  });
});

app.post('/api/teacher/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.teacher_session;
  clearTeacherSessionCookie(res);
  if(!token) return res.json({ ok: true });
  db.run('DELETE FROM teacher_sessions WHERE token=?', [token], () => res.json({ ok: true }));
});

// Admin: teacher user management (manual registration)
app.get('/api/admin/teachers', requireAdmin, (req, res) => {
  db.all('SELECT id, username, display_name, active, created_at FROM teachers ORDER BY id DESC', async (err, rows) => {
    if(err) return res.status(500).json({ error: err.message });
    try{
      const teachers = await Promise.all((rows || []).map(async row => {
        const summary = await getTeacherDataSummary(row.id);
        return { ...row, summary: summary };
      }));
      res.json(teachers);
    }catch(summaryErr){
      res.status(500).json({ error: summaryErr.message });
    }
  });
});

app.post('/api/admin/teachers', requireAdmin, (req, res) => {
  const { username, display_name, password } = req.body || {};
  const u = typeof username === 'string' ? username.trim() : '';
  const dn = typeof display_name === 'string' ? display_name.trim() : '';
  const p = typeof password === 'string' ? password : '';
  if(!u || !p) return res.status(400).json({ error: 'username_and_password_required' });
  const hash = makePasswordHash(p);
  const nowIso = new Date().toISOString();
  db.run(
    'INSERT INTO teachers (username, display_name, password_hash, active, created_at) VALUES (?,?,?,?,?)',
    [u, dn, hash, 1, nowIso],
    function(err){
      if(err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, username: u, display_name: dn, active: 1, created_at: nowIso });
    }
  );
});

app.put('/api/admin/teachers/:id/password', requireAdmin, (req, res) => {
  const id = req.params.id;
  const { password } = req.body || {};
  const p = typeof password === 'string' ? password : '';
  if(!p) return res.status(400).json({ error: 'password_required' });
  const hash = makePasswordHash(p);
  db.run('UPDATE teachers SET password_hash=? WHERE id=?', [hash, id], function(err){
    if(err) return res.status(500).json({ error: err.message });
    res.json({ id: Number(id), updated: this.changes > 0 });
  });
});

// Update teacher display name
app.patch('/api/admin/teachers/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const { display_name } = req.body || {};
  const dn = typeof display_name === 'string' ? display_name.trim() : '';
  db.run('UPDATE teachers SET display_name=? WHERE id=?', [dn, id], function(err){
    if(err) return res.status(500).json({ error: err.message });
    if(!this.changes) return res.status(404).json({ error: 'not_found' });
    db.get('SELECT id, username, display_name, active, created_at FROM teachers WHERE id=?', [id], (e, row) => {
      if(e) return res.status(500).json({ error: e.message });
      res.json(row || {});
    });
  });
});

app.delete('/api/admin/teachers/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const mode = String(req.query.mode || '').trim();
  if(mode === 'deactivate'){
    db.run('UPDATE teachers SET active=0 WHERE id=?', [id], function(err){
      if(err) return res.status(500).json({ error: err.message });
      if(!this.changes) return res.status(404).json({ error: 'not_found' });
      return res.json({ id: Number(id), deactivated: true });
    });
    return;
  }

  deleteTeacherCascade(id)
    .then(result => {
      if(!result) return res.status(404).json({ error: 'not_found' });
      return res.json({
        id: Number(id),
        deleted: true,
        cascade: true,
        teacher: result.teacher,
        deleted_summary: result.summary
      });
    })
    .catch(err => {
      res.status(500).json({ error: err.message });
    });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/qr-code', async (req, res) => {
  const text = typeof req.query.text === 'string' ? req.query.text.trim() : '';
  if(!text) return res.status(400).json({ error: 'text required' });
  try{
    const dataUrl = await QRCode.toDataURL(text, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
      color: {
        dark: '#18324a',
        light: '#FFFFFFFF'
      }
    });
    res.json({ dataUrl });
  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

// Classes
app.post('/api/classes', requireTeacher, (req, res) => {
  const { name } = req.body;
  db.run('INSERT INTO classes (teacher_id, name) VALUES (?,?)', [req.teacher.id, name], function(err){
    if(err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, name });
  });
});
app.get('/api/classes', (req, res) => {
  if(req.teacher){
    return db.all('SELECT * FROM classes WHERE teacher_id=? ORDER BY id DESC', [req.teacher.id], (err, rows) => {
      if(err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    });
  }
  // Public(student) view: only classes that have at least one public test
  db.all(
    'SELECT c.id, c.name FROM classes c WHERE EXISTS (SELECT 1 FROM tests t WHERE t.class_id=c.id AND t.public=1) ORDER BY c.name ASC',
    (err, rows) => {
      if(err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

// Update a class (name)
app.put('/api/classes/:id', requireTeacher, (req, res) => {
  const id = req.params.id;
  const { name } = req.body;
  if(!name) return res.status(400).json({ error: 'name required' });
  ensureTeacherOwnsClass(req, res, id, () => {
    db.run('UPDATE classes SET name=? WHERE id=? AND teacher_id=?', [name, id, req.teacher.id], function(err){
      if(err) return res.status(500).json({ error: err.message });
      db.get('SELECT * FROM classes WHERE id=? AND teacher_id=?', [id, req.teacher.id], (e, row) => {
        if(e) return res.status(500).json({ error: e.message });
        res.json(row);
      });
    });
  });
});

// Delete a class (optional cascade)
app.delete('/api/classes/:id', requireTeacher, (req, res) => {
  const id = req.params.id;
  ensureTeacherOwnsClass(req, res, id, () => {
    db.get(
      'SELECT (SELECT COUNT(*) FROM tests WHERE class_id=? AND teacher_id=?) AS tests, (SELECT COUNT(*) FROM students WHERE class_id=?) AS students',
      [id, req.teacher.id, id],
      (err, row) => {
        if(err) return res.status(500).json({ error: err.message });
        const hasDeps = row && (row.tests > 0 || row.students > 0);
        if(hasDeps && req.query.cascade !== '1'){
          return res.status(400).json({ error: 'has_dependencies', tests: row.tests, students: row.students });
        }
        if(hasDeps && req.query.cascade === '1'){
          // cascade delete related data for this teacher's tests
          db.run('DELETE FROM student_answers WHERE test_id IN (SELECT id FROM tests WHERE class_id=? AND teacher_id=?)', [id, req.teacher.id], function(err2){
            if(err2) return res.status(500).json({ error: err2.message });
            db.run('DELETE FROM choices WHERE question_id IN (SELECT id FROM questions WHERE test_id IN (SELECT id FROM tests WHERE class_id=? AND teacher_id=?))', [id, req.teacher.id], function(err3){
              if(err3) return res.status(500).json({ error: err3.message });
              db.run('DELETE FROM questions WHERE test_id IN (SELECT id FROM tests WHERE class_id=? AND teacher_id=?)', [id, req.teacher.id], function(err4){
                if(err4) return res.status(500).json({ error: err4.message });
                db.run('DELETE FROM tests WHERE class_id=? AND teacher_id=?', [id, req.teacher.id], function(err5){
                  if(err5) return res.status(500).json({ error: err5.message });
                  db.run('DELETE FROM students WHERE class_id=?', [id], function(err6){
                    if(err6) return res.status(500).json({ error: err6.message });
                    db.run('DELETE FROM classes WHERE id=? AND teacher_id=?', [id, req.teacher.id], function(err7){
                      if(err7) return res.status(500).json({ error: err7.message });
                      res.json({ id: id, deleted: true, cascade: true });
                    });
                  });
                });
              });
            });
          });
        } else {
          // no dependencies - safe to delete
          db.run('DELETE FROM classes WHERE id=? AND teacher_id=?', [id, req.teacher.id], function(err2){
            if(err2) return res.status(500).json({ error: err2.message });
            db.run('UPDATE tests SET class_id=NULL WHERE class_id=? AND teacher_id=?', [id, req.teacher.id], function(err3){
              res.json({ id: id, deleted: true });
            });
          });
        }
      }
    );
  });
});

// Tests
app.post('/api/tests', requireTeacher, (req, res) => {
  const { class_id, name, description, public: pub, randomize } = req.body;
  const proceed = () => {
    db.run(
      'INSERT INTO tests (teacher_id, class_id, name, description, public, randomize) VALUES (?,?,?,?,?,?)',
      [req.teacher.id, class_id||null, name, description||'', pub?1:0, randomize?1:0],
      function(err){
        if(err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
      }
    );
  };
  if(class_id){
    return ensureTeacherOwnsClass(req, res, class_id, () => proceed());
  }
  proceed();
});
app.get('/api/tests', (req, res) => {
  const { class_id, public: pub } = req.query;
  let sql = 'SELECT * FROM tests';
  const params = [];
  const conditions = [];
  if(req.teacher){
    conditions.push('teacher_id=?');
    params.push(req.teacher.id);
    if(class_id){ conditions.push('class_id=?'); params.push(class_id); }
    if(typeof pub !== 'undefined'){
      conditions.push('public=?'); params.push(pub==1 || pub==='1' ? 1 : 0);
    }
  } else {
    // Public(student) view: only published tests
    conditions.push('public=1');
    if(class_id){ conditions.push('class_id=?'); params.push(class_id); }
  }
  if(conditions.length > 0){ sql += ' WHERE ' + conditions.join(' AND '); }
  sql += ' ORDER BY id DESC';
  db.all(sql, params, (err, rows) => {
    if(err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Update a test (name, description, public, randomize)
app.put('/api/tests/:id', requireTeacher, (req, res) => {
  const id = req.params.id;
  const { name, description, public: pub, randomize, class_id } = req.body;
  // Build update dynamically so that if `class_id` is undefined we don't overwrite it
  const fields = ['name=?', 'description=?', 'public=?', 'randomize=?'];
  const vals = [name, description||'', pub?1:0, randomize?1:0];
  ensureTeacherOwnsTest(req, res, id, () => {
    const proceed = () => {
      if(typeof class_id !== 'undefined'){
        fields.push('class_id=?');
        vals.push(class_id);
      }
      const updateSql = `UPDATE tests SET ${fields.join(', ')} WHERE id=? AND teacher_id=?`;
      vals.push(id, req.teacher.id);
      db.run(updateSql, vals, function(err){
        if(err) return res.status(500).json({ error: err.message });
        db.get('SELECT * FROM tests WHERE id=? AND teacher_id=?', [id, req.teacher.id], (e, row) => {
          if(e) return res.status(500).json({ error: e.message });
          res.json(row);
        });
      });
    };
    if(typeof class_id !== 'undefined' && class_id){
      return ensureTeacherOwnsClass(req, res, class_id, () => proceed());
    }
    proceed();
  });
});

// Delete a test (optional cascade deletes related questions, choices, and student_answers)
app.delete('/api/tests/:id', requireTeacher, (req, res) => {
  const id = req.params.id;
  ensureTeacherOwnsTest(req, res, id, () => {
    db.get(
      'SELECT (SELECT COUNT(*) FROM questions WHERE test_id=?) AS questions, (SELECT COUNT(*) FROM student_answers WHERE test_id=?) AS answers',
      [id, id],
      (err, row) => {
        if(err) return res.status(500).json({ error: err.message });
        const hasDeps = row && (row.questions > 0 || row.answers > 0);
        if(hasDeps && req.query.cascade !== '1'){
          return res.status(400).json({ error: 'has_dependencies', questions: row.questions, answers: row.answers });
        }
        if(hasDeps && req.query.cascade === '1'){
          // cascade delete related data
          db.run('DELETE FROM student_answers WHERE test_id=?', [id], function(err2){
            if(err2) return res.status(500).json({ error: err2.message });
            db.run('DELETE FROM choices WHERE question_id IN (SELECT id FROM questions WHERE test_id=?)', [id], function(err3){
              if(err3) return res.status(500).json({ error: err3.message });
              db.run('DELETE FROM questions WHERE test_id=?', [id], function(err4){
                if(err4) return res.status(500).json({ error: err4.message });
                db.run('DELETE FROM tests WHERE id=? AND teacher_id=?', [id, req.teacher.id], function(err5){
                  if(err5) return res.status(500).json({ error: err5.message });
                  res.json({ id: id, deleted: true, cascade: true });
                });
              });
            });
          });
        } else {
          // no dependencies - safe to delete
          db.run('DELETE FROM tests WHERE id=? AND teacher_id=?', [id, req.teacher.id], function(err2){
            if(err2) return res.status(500).json({ error: err2.message });
            res.json({ id: id, deleted: true });
          });
        }
      }
    );
  });
});

// Questions
app.post('/api/tests/:testId/questions', requireTeacher, (req, res) => {
  const testId = req.params.testId;
  const { type, text, points, choices, explanation } = req.body;
  ensureTeacherOwnsTest(req, res, testId, () => {
    db.run('INSERT INTO questions (test_id, type, text, points, explanation) VALUES (?,?,?,?,?)', [testId, type||'single', text, points||1, explanation || ''], function(err){
      if(err) return res.status(500).json({ error: err.message });
      const questionId = this.lastID;
      if(!choices || choices.length === 0) return res.json({ id: questionId });
      const stmt = db.prepare('INSERT INTO choices (question_id, text, is_correct) VALUES (?,?,?)');
      choices.forEach(c => stmt.run(questionId, c.text, c.is_correct?1:0));
      stmt.finalize(() => res.json({ id: questionId }));
    });
  });
});

app.get('/api/tests/:testId/questions', (req, res) => {
  const testId = req.params.testId;
  // check test's randomize flag, then fetch questions
  const loadTest = (cb) => {
    if(req.teacher){
      return db.get('SELECT * FROM tests WHERE id=? AND teacher_id=?', [testId, req.teacher.id], cb);
    }
    return db.get('SELECT * FROM tests WHERE id=? AND public=1', [testId], cb);
  };
  loadTest((errt, testRow) => {
    if(errt) return res.status(500).json({ error: errt.message });
    if(!testRow) return res.status(404).json({ error: 'not_found' });
    const shouldRandomize = testRow && testRow.randomize === 1;
    db.all('SELECT * FROM questions WHERE test_id=?', [testId], (err, questions) => {
      if(err) return res.status(500).json({ error: err.message });
      const qids = questions.map(q => q.id);
      if(qids.length === 0) return res.json([]);
      db.all(`SELECT * FROM choices WHERE question_id IN (${qids.join(',')})`, (err2, choices) => {
        if(err2) return res.status(500).json({ error: err2.message });
        const map = {};
        choices.forEach(c => { map[c.question_id] = map[c.question_id] || []; map[c.question_id].push(c); });
        // attach choices
        let out = questions.map(q => ({ ...q, choices: (map[q.id] || []).slice() }));
        // if randomize flagged on test, shuffle questions and choices
        if(shouldRandomize){
          const shuffle = arr => {
            for(let i = arr.length - 1; i > 0; i--){
              const j = Math.floor(Math.random() * (i + 1));
              const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
            }
          };
          out.forEach(q => { if(q.choices && q.choices.length > 1) shuffle(q.choices); });
          shuffle(out);
        }
        res.json(out);
      });
    });
  });
});

// AI generate (Gemini)
app.post('/api/generate-questions', requireTeacher, async (req, res) => {
  const { testId, text, lessonContent, questionCount, difficulty, choiceCount, allowMultipleAnswers } = req.body || {};
  const sourceText = typeof lessonContent === 'string' && lessonContent.trim() ? lessonContent.trim() : (typeof text === 'string' ? text.trim() : '');
  const requestedQuestionCount = Math.max(1, Math.min(10, parseInt(questionCount, 10) || 3));
  const requestedChoiceCount = Math.max(2, Math.min(4, parseInt(choiceCount, 10) || 4));
  const difficultyMap = {
    easy: 'やさしい',
    normal: 'ふつう',
    hard: 'むずかしい'
  };
  const difficultyKey = difficultyMap[difficulty] ? difficulty : 'normal';

  if(!sourceText){
    return res.status(400).json({ error: 'lessonContent or text required' });
  }

  try{
    const generated = await geminiAi.generateQuestions({
      lessonContent: sourceText,
      questionCount: requestedQuestionCount,
      choiceCount: requestedChoiceCount,
      difficultyLabel: difficultyMap[difficultyKey],
      allowMultipleAnswers: !!allowMultipleAnswers && requestedChoiceCount === 4
    });

    if(!testId){
      return res.json({
        questions: generated,
        model: geminiAi.DEFAULT_MODEL
      });
    }

    // Ensure the test belongs to the logged-in teacher
    const owned = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM tests WHERE id=? AND teacher_id=?', [testId, req.teacher.id], (e, row) => {
        if(e) return reject(e);
        resolve(!!row);
      });
    });
    if(!owned){
      return res.status(404).json({ error: 'not_found' });
    }

    const results = [];
    const insertQuestion = (q, cb) => {
      db.run('INSERT INTO questions (test_id, type, text, points, explanation) VALUES (?,?,?,?,?)', [testId, q.type, q.text, q.points || 1, q.explanation || ''], function(err){
        if(err) return cb(err);
        const qid = this.lastID;
        const stmt = db.prepare('INSERT INTO choices (question_id, text, is_correct) VALUES (?,?,?)');
        q.choices.forEach(c => stmt.run(qid, c.text, c.is_correct ? 1 : 0));
        stmt.finalize(() => cb(null, { id: qid, ...q }));
      });
    };
    (function next(i){
      if(i >= generated.length) return res.json(results);
      insertQuestion(generated[i], (err, row) => {
        if(err) return res.status(500).json({ error: err.message });
        results.push(row);
        next(i + 1);
      });
    })(0);
  }catch(err){
    console.error(err);
    res.status(500).json({ error: err.message || 'question generation failed' });
  }
});

// Students: create/login
app.post('/api/students', (req, res) => {
  const { class_id, class_name, name } = req.body;
  if(!name) return res.status(400).json({ error: 'name required' });
  const findClass = (cb) => {
    if(class_id){
      db.get('SELECT * FROM classes WHERE id=? AND EXISTS (SELECT 1 FROM tests t WHERE t.class_id=classes.id AND t.public=1)', [class_id], cb);
    }
    else if(class_name){
      db.get('SELECT * FROM classes WHERE name=? AND EXISTS (SELECT 1 FROM tests t WHERE t.class_id=classes.id AND t.public=1)', [class_name], cb);
    }
    else cb(null, null);
  };
  findClass((err, cls) => {
    if(err) return res.status(500).json({ error: err.message });
    if(!cls) return res.status(400).json({ error: 'class not found' });
    const code = Math.random().toString(36).slice(2,8).toUpperCase();
    db.run('INSERT INTO students (class_id, name, code) VALUES (?,?,?)', [cls.id, name, code], function(err2){
      if(err2) return res.status(500).json({ error: err2.message });
      res.json({ id: this.lastID, name, code, class_id: cls.id });
    });
  });
});

// Submit an answer (single or multiple)
app.post('/api/submit-answer', (req, res) => {
  const { student_id, test_id, question_id, choice_id, choice_ids, session_id } = req.body;
  if(!student_id || !test_id || !question_id) return res.status(400).json({ error: 'student_id,test_id,question_id required' });
  // only allow answering public tests
  ensurePublicTestAccess(res, test_id, () => {
  const submitted = [];
  if(Array.isArray(choice_ids)) submitted.push(...choice_ids.map(x=>parseInt(x)));
  else if(choice_id) submitted.push(parseInt(choice_id));

  db.all('SELECT id FROM choices WHERE question_id=? AND is_correct=1', [question_id], (err, correctRows)=>{
    if(err) return res.status(500).json({ error: err.message });
    const correctIds = correctRows.map(r=>r.id);
    // determine correctness
    let correct = false;
    if(submitted.length === 0){ correct = false; }
    else {
      // compare sets
      const s1 = new Set(submitted);
      const s2 = new Set(correctIds);
      if(s1.size === s2.size){
        correct = [...s1].every(x => s2.has(x));
      } else correct = false;
    }
    // store answers: if no submitted choices, insert a row with null choice_id
    const ops = [];
    if(submitted.length === 0){
      ops.push(new Promise((resolve, reject)=>{
        db.run('INSERT INTO student_answers (student_id, test_id, question_id, choice_id, correct, session_id) VALUES (?,?,?,?,?,?)', [student_id, test_id, null, null, correct?1:0, session_id||null], function(e){ if(e) reject(e); else resolve(); });
      }));
    } else {
      submitted.forEach(cid => {
        ops.push(new Promise((resolve, reject)=>{
          db.run('INSERT INTO student_answers (student_id, test_id, question_id, choice_id, correct, session_id) VALUES (?,?,?,?,?,?)', [student_id, test_id, question_id, cid, correct?1:0, session_id||null], function(e){ if(e) reject(e); else resolve(); });
        }));
      });
    }
    Promise.all(ops).then(()=>{
      // fetch question explanation if any
      db.get('SELECT explanation FROM questions WHERE id=?', [question_id], (er, qrow)=>{
        res.json({ correct, correct_choice_ids: correctIds, explanation: qrow? qrow.explanation : '' });
      });
    }).catch(e=>res.status(500).json({ error: e.message }));
  });
  });
});

// Fetch student answers (filter by student_id and test_id)
app.get('/api/studentAnswers', (req, res) => {
  const { student_id, test_id } = req.query;
  if(!student_id || !test_id) return res.status(400).json({ error: 'student_id and test_id required' });
  db.all('SELECT * FROM student_answers WHERE student_id=? AND test_id=?', [student_id, test_id], (err, rows)=>{
    if(err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Summary for a student's test: per-question detail and totals
app.get('/api/tests/:testId/summary', (req, res) => {
  const testId = req.params.testId;
  const studentId = req.query.student_id;
  const sessionId = req.query.session_id;
  if(!studentId) return res.status(400).json({ error: 'student_id required' });
  ensurePublicTestAccess(res, testId, () => {
    buildTestSummaryForStudent(testId, studentId, sessionId)
      .then(summary => res.json(summary))
      .catch(summaryErr => res.status(500).json({ error: summaryErr.message }));
  });
});

app.get('/api/teacher/tests/:testId/summary', requireTeacher, (req, res) => {
  const testId = req.params.testId;
  const studentId = req.query.student_id;
  const sessionId = req.query.session_id;
  if(!studentId) return res.status(400).json({ error: 'student_id required' });
  ensureTeacherOwnsTest(req, res, testId, () => {
    buildTestSummaryForStudent(testId, studentId, sessionId)
      .then(summary => res.json(summary))
      .catch(summaryErr => res.status(500).json({ error: summaryErr.message }));
  });
});

// Aggregated exam records (student x test)
app.get('/api/exams', requireTeacher, (req, res) => {
  const { test_id, student_id } = req.query;
  // Try to return exam_sessions rows if table exists and has data
  db.all('SELECT name FROM sqlite_master WHERE type="table" AND name="exam_sessions"', (err, rows) => {
    if(!err && rows && rows.length > 0){
      const conds = [];
      const params = [];
      conds.push('t.teacher_id=?');
      params.push(req.teacher.id);
      if(test_id){ conds.push('es.test_id=?'); params.push(test_id); }
      if(student_id){ conds.push('es.student_id=?'); params.push(student_id); }
      let sql = 'SELECT es.*, s.name as studentName, t.name as testName FROM exam_sessions es LEFT JOIN students s ON s.id=es.student_id LEFT JOIN tests t ON t.id=es.test_id';
      if(conds.length) sql += ' WHERE ' + conds.join(' AND ');
      sql += ' ORDER BY es.finished_at DESC';
      db.all(sql, params, (e, sessions) => {
        if(!e && sessions && sessions.length > 0){
          const out = sessions.map(s => ({
            sessionId: s.id,
            studentId: s.student_id,
            studentName: s.studentName,
            testId: s.test_id,
            testName: s.testName,
            score: s.score || 0,
            maxScore: s.max_score || 0,
            percent: s.percent || 0,
            started_at: s.started_at,
            finished_at: s.finished_at,
            duration_sec: s.duration_sec,
            status: s.status
          }));
          return res.json(out);
        }
        // fallback to legacy aggregation if no sessions found
        legacyAggregation();
      });
    } else {
      legacyAggregation();
    }
  });

  function legacyAggregation(){
    const conditions = ['t.teacher_id=?'];
    const params = [req.teacher.id];
    if(test_id){ conditions.push('sa.test_id=?'); params.push(test_id); }
    if(student_id){ conditions.push('sa.student_id=?'); params.push(student_id); }
    let sql = 'SELECT DISTINCT sa.student_id, sa.test_id FROM student_answers sa JOIN tests t ON t.id=sa.test_id';
    if(conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    db.all(sql, params, (err, combos) => {
      if(err) return res.status(500).json({ error: err.message });
      if(!combos || combos.length === 0) return res.json([]);
      const results = [];
      let pending = combos.length;
      combos.forEach(function(c){
        const sid = c.student_id;
        const tid = c.test_id;
        // fetch student, test, questions then compute earned points
        db.get('SELECT id, name FROM students WHERE id=?', [sid], (err1, studentRow) => {
          db.get('SELECT id, name FROM tests WHERE id=?', [tid], (err2, testRow) => {
            db.all('SELECT id, points FROM questions WHERE test_id=?', [tid], (err3, questions) => {
              if(err1 || err2 || err3){
                pending--; if(pending===0) return res.json(results);
                return;
              }
              const qids = (questions || []).map(q => q.id);
              if(qids.length === 0){
                // attach latest exam_sessions timestamp when available
                db.get('SELECT finished_at, started_at FROM exam_sessions WHERE student_id=? AND test_id=? ORDER BY finished_at DESC LIMIT 1', [sid, tid], (errSess, sessRow) => {
                  const dt = sessRow ? (sessRow.finished_at || sessRow.started_at) : null;
                  results.push({ studentId: sid, studentName: studentRow?studentRow.name:null, testId: tid, testName: testRow?testRow.name:null, score: 0, maxScore: 0, percent: 0, status: '完了', finished_at: dt });
                  pending--; if(pending===0) return res.json(results);
                });
              } else {
                // fetch choices for questions
                db.all(`SELECT * FROM choices WHERE question_id IN (${qids.join(',')})`, (err4, choices) => {
                  if(err4){ pending--; if(pending===0) return res.json(results); return; }
                  db.all('SELECT * FROM student_answers WHERE student_id=? AND test_id=?', [sid, tid], (err5, answers) => {
                    if(err5){ pending--; if(pending===0) return res.json(results); return; }
                    const choicesMap = {};
                    (choices || []).forEach(ch => { choicesMap[ch.question_id] = choicesMap[ch.question_id] || []; choicesMap[ch.question_id].push(ch); });
                    const answersMap = {};
                    (answers || []).forEach(a => { answersMap[a.question_id] = answersMap[a.question_id] || []; if(a.choice_id !== null && typeof a.choice_id !== 'undefined') answersMap[a.question_id].push(a.choice_id); });
                    let total = 0; let earned = 0;
                    (questions || []).forEach(q => {
                      const correctIds = (choicesMap[q.id] || []).filter(x => x.is_correct==1).map(x => x.id);
                      total += q.points || 1;
                      const given = Array.from(new Set((answersMap[q.id] || []).map(x => parseInt(x))));
                      if(given.length === 0) return; // incorrect
                      const s1 = new Set(given);
                      const s2 = new Set(correctIds.map(x => parseInt(x)));
                      if(s1.size === s2.size && [...s1].every(x => s2.has(x))){ earned += q.points || 1; }
                    });
                    // attach latest exam_sessions timestamp when available
                    db.get('SELECT finished_at, started_at FROM exam_sessions WHERE student_id=? AND test_id=? ORDER BY finished_at DESC LIMIT 1', [sid, tid], (errSess, sessRow) => {
                      const dt = sessRow ? (sessRow.finished_at || sessRow.started_at) : null;
                      results.push({ studentId: sid, studentName: studentRow?studentRow.name:null, testId: tid, testName: testRow?testRow.name:null, score: earned, maxScore: total, percent: total>0 ? (earned/total*100) : 0, status: '完了', finished_at: dt });
                      pending--; if(pending===0) return res.json(results);
                    });
                  });
                });
              }
            });
          });
        });
      });
    });
  }
});

// Create a new exam session (start an attempt)
app.post('/api/exam-sessions', (req, res) => {
  const { student_id, test_id } = req.body;
  if(!student_id || !test_id) return res.status(400).json({ error: 'student_id and test_id required' });
  ensurePublicTestAccess(res, test_id, () => {
  const started_at = new Date().toISOString();
  db.run('INSERT INTO exam_sessions (student_id, test_id, started_at, status) VALUES (?,?,?,?)', [student_id, test_id, started_at, 'in_progress'], function(err){
    if(err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, student_id, test_id, started_at, status: 'in_progress' });
  });
  });
});

// Finish an exam session: compute score from answers linked to session_id (fallback to student/test answers)
app.put('/api/exam-sessions/:id/finish', (req, res) => {
  const id = req.params.id;
  const finished_at = new Date().toISOString();
  db.get('SELECT * FROM exam_sessions WHERE id=?', [id], (err, session) => {
    if(err) return res.status(500).json({ error: err.message });
    if(!session) return res.status(404).json({ error: 'session_not_found' });
    ensurePublicTestAccess(res, session.test_id, () => {
    // fetch questions for this test
    db.all('SELECT id, points FROM questions WHERE test_id=?', [session.test_id], (err2, questions) => {
      if(err2) return res.status(500).json({ error: err2.message });
      const qids = (questions || []).map(q => q.id);
      if(qids.length === 0){
        const duration = session.started_at ? Math.max(0, Math.round((Date.parse(finished_at) - Date.parse(session.started_at))/1000)) : null;
        db.run('UPDATE exam_sessions SET finished_at=?, duration_sec=?, score=?, max_score=?, percent=?, status=? WHERE id=?', [finished_at, duration, 0, 0, 0, 'completed', id], function(eu){
          if(eu) return res.status(500).json({ error: eu.message });
          db.get('SELECT * FROM exam_sessions WHERE id=?', [id], (e, updated) => { if(e) return res.status(500).json({ error: e.message }); res.json(updated); });
        });
        return;
      }
      db.all(`SELECT * FROM choices WHERE question_id IN (${qids.join(',')})`, (err3, choices) => {
        if(err3) return res.status(500).json({ error: err3.message });
        // fetch answers for this session
        db.all('SELECT * FROM student_answers WHERE session_id=?', [id], (err4, answers) => {
          if(err4) return res.status(500).json({ error: err4.message });
          const proceedWith = (answers && answers.length > 0) ? answers : null;
          if(!proceedWith){
            // fallback: use all answers for this student/test
            db.all('SELECT * FROM student_answers WHERE student_id=? AND test_id=?', [session.student_id, session.test_id], (err5, fallbackAnswers) => {
              if(err5) return res.status(500).json({ error: err5.message });
              computeAndSave(fallbackAnswers);
            });
          } else {
            computeAndSave(proceedWith);
          }

          function computeAndSave(answersForSession){
            const choicesMap = {};
            (choices || []).forEach(ch => { choicesMap[ch.question_id] = choicesMap[ch.question_id] || []; choicesMap[ch.question_id].push(ch); });
            const answersMap = {};
            (answersForSession || []).forEach(a => { answersMap[a.question_id] = answersMap[a.question_id] || []; if(a.choice_id !== null && typeof a.choice_id !== 'undefined') answersMap[a.question_id].push(a.choice_id); });
            let total = 0, earned = 0;
            (questions || []).forEach(q => {
              const correctIds = (choicesMap[q.id] || []).filter(x => x.is_correct==1).map(x => x.id);
              total += q.points || 1;
              const given = Array.from(new Set((answersMap[q.id] || []).map(x => parseInt(x))));
              if(given.length === 0) return;
              const s1 = new Set(given);
              const s2 = new Set(correctIds.map(x => parseInt(x)));
              if(s1.size === s2.size && [...s1].every(x => s2.has(x))) earned += q.points || 1;
            });
            const percent = total>0 ? (earned/total*100) : 0;
            const duration = session.started_at ? Math.max(0, Math.round((Date.parse(finished_at) - Date.parse(session.started_at))/1000)) : null;
            db.run('UPDATE exam_sessions SET finished_at=?, duration_sec=?, score=?, max_score=?, percent=?, status=? WHERE id=?', [finished_at, duration, earned, total, percent, 'completed', id], function(upErr){
              if(upErr) return res.status(500).json({ error: upErr.message });
              db.get('SELECT * FROM exam_sessions WHERE id=?', [id], (e, updated) => { if(e) return res.status(500).json({ error: e.message }); res.json(updated); });
            });
          }
        });
      });
    });
    });
  });
});

// Update a question
app.put('/api/questions/:id', requireTeacher, (req, res) => {
  const id = req.params.id;
  const { text, type, points, public: pub, explanation } = req.body;
  const vals = [text, type || 'single', points || 1, pub?1:0, explanation || '', id];
  db.get('SELECT t.teacher_id FROM questions q JOIN tests t ON t.id=q.test_id WHERE q.id=?', [id], (ownErr, ownRow) => {
    if(ownErr) return res.status(500).json({ error: ownErr.message });
    if(!ownRow || ownRow.teacher_id !== req.teacher.id) return res.status(404).json({ error: 'not_found' });
    db.run('UPDATE questions SET text=?, type=?, points=?, public=?, explanation=? WHERE id=?', vals, function(err){
      if(err) return res.status(500).json({ error: err.message });
      res.json({ id });
    });
  });
});

// Update a choice
app.put('/api/choices/:id', requireTeacher, (req, res) => {
  const id = req.params.id;
  const { text, is_correct } = req.body;
  db.get('SELECT t.teacher_id FROM choices c JOIN questions q ON q.id=c.question_id JOIN tests t ON t.id=q.test_id WHERE c.id=?', [id], (ownErr, ownRow) => {
    if(ownErr) return res.status(500).json({ error: ownErr.message });
    if(!ownRow || ownRow.teacher_id !== req.teacher.id) return res.status(404).json({ error: 'not_found' });
    db.run('UPDATE choices SET text=?, is_correct=? WHERE id=?', [text, is_correct?1:0, id], function(err){
      if(err) return res.status(500).json({ error: err.message });
      res.json({ id });
    });
  });
});

// Delete a question and related records
app.delete('/api/questions/:id', requireTeacher, (req, res) => {
  const id = req.params.id;
  db.get('SELECT t.teacher_id FROM questions q JOIN tests t ON t.id=q.test_id WHERE q.id=?', [id], (ownErr, ownRow) => {
    if(ownErr) return res.status(500).json({ error: ownErr.message });
    if(!ownRow || ownRow.teacher_id !== req.teacher.id) return res.status(404).json({ error: 'not_found' });
    db.run('DELETE FROM student_answers WHERE question_id=?', [id], function(answerErr){
      if(answerErr) return res.status(500).json({ error: answerErr.message });
      db.run('DELETE FROM choices WHERE question_id=?', [id], function(choiceErr){
        if(choiceErr) return res.status(500).json({ error: choiceErr.message });
        db.run('DELETE FROM questions WHERE id=?', [id], function(questionErr){
          if(questionErr) return res.status(500).json({ error: questionErr.message });
          res.json({ id: Number(id), deleted: this.changes > 0 });
        });
      });
    });
  });
});

// Delete a choice and related student answers
app.delete('/api/choices/:id', requireTeacher, (req, res) => {
  const id = req.params.id;
  db.get('SELECT t.teacher_id FROM choices c JOIN questions q ON q.id=c.question_id JOIN tests t ON t.id=q.test_id WHERE c.id=?', [id], (ownErr, ownRow) => {
    if(ownErr) return res.status(500).json({ error: ownErr.message });
    if(!ownRow || ownRow.teacher_id !== req.teacher.id) return res.status(404).json({ error: 'not_found' });
    db.run('DELETE FROM student_answers WHERE choice_id=?', [id], function(answerErr){
      if(answerErr) return res.status(500).json({ error: answerErr.message });
      db.run('DELETE FROM choices WHERE id=?', [id], function(choiceErr){
        if(choiceErr) return res.status(500).json({ error: choiceErr.message });
        res.json({ id: Number(id), deleted: this.changes > 0 });
      });
    });
  });
});

// Add a new choice to a question
app.post('/api/questions/:id/choices', requireTeacher, (req, res) => {
  const questionId = req.params.id;
  const { text, is_correct } = req.body;
  db.get('SELECT t.teacher_id FROM questions q JOIN tests t ON t.id=q.test_id WHERE q.id=?', [questionId], (ownErr, ownRow) => {
    if(ownErr) return res.status(500).json({ error: ownErr.message });
    if(!ownRow || ownRow.teacher_id !== req.teacher.id) return res.status(404).json({ error: 'not_found' });
    db.run('INSERT INTO choices (question_id, text, is_correct) VALUES (?,?,?)', [questionId, text, is_correct?1:0], function(err){
      if(err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    });
  });
});

// Fallback to frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

const port = process.env.PORT || 3000;
const selectedGeminiModel = process.env.GEMINI_MODEL || geminiAi.DEFAULT_MODEL;
app.listen(port, () => console.log(`InstantTest server listening on ${port} (Gemini model: ${selectedGeminiModel})`));
