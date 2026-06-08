require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');
const db = require('./db');
const geminiAi = require('./geminiAi');
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json({ limit: '150kb' }));
const uploadsRoot = path.join(__dirname, 'uploads');
const questionImagesRoot = path.join(uploadsRoot, 'question-images');
fs.mkdirSync(questionImagesRoot, { recursive: true });
app.use('/uploads', express.static(uploadsRoot));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules')));
app.use(express.static(path.join(__dirname, 'public')));

const MAX_QUESTION_HTML_LENGTH = 100 * 1024;
const allowedQuestionTags = ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'img'];
const allowedQuestionAttributes = {
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'title']
};

function isInternalUploadUrl(value){
  const raw = String(value || '').trim();
  return /^\/uploads\/question-images\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.(?:png|jpe?g|webp|gif)$/i.test(raw);
}

function sanitizeQuestionHtml(input){
  const raw = String(input || '');
  if(raw.length > MAX_QUESTION_HTML_LENGTH){
    const err = new Error('content_html too long');
    err.statusCode = 400;
    throw err;
  }
  return sanitizeHtml(raw, {
    allowedTags: allowedQuestionTags,
    allowedAttributes: allowedQuestionAttributes,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: []
    },
    transformTags: {
      a: function(tagName, attribs){
        const next = Object.assign({}, attribs);
        if(next.href && /^https?:\/\//i.test(next.href)){
          next.target = '_blank';
          next.rel = 'noopener noreferrer';
        }
        return { tagName: tagName, attribs: next };
      },
      img: function(tagName, attribs){
        const src = isInternalUploadUrl(attribs && attribs.src) ? attribs.src : '';
        if(!src) return { tagName: 'span', attribs: {} };
        return {
          tagName: tagName,
          attribs: {
            src: src,
            alt: String((attribs && attribs.alt) || '').slice(0, 200),
            title: String((attribs && attribs.title) || '').slice(0, 200)
          }
        };
      }
    }
  }).trim();
}

function stripHtmlToText(html){
  return sanitizeHtml(String(html || ''), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeQuestionContent(body){
  const hasHtml = body && typeof body.content_html === 'string' && body.content_html.trim();
  const contentHtml = hasHtml ? sanitizeQuestionHtml(body.content_html) : '';
  const text = String((body && body.text) || stripHtmlToText(contentHtml) || '').trim();
  return {
    text: text,
    content_html: contentHtml,
    content_format: contentHtml ? 'html' : 'plain'
  };
}

const questionImageStorage = multer.diskStorage({
  destination: function(req, file, cb){
    const teacherId = String(req.teacher && req.teacher.id ? req.teacher.id : 'unknown');
    const dest = path.join(questionImagesRoot, teacherId);
    fs.mkdir(dest, { recursive: true }, function(err){ cb(err, dest); });
  },
  filename: function(req, file, cb){
    const extByMime = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif'
    };
    const ext = extByMime[file.mimetype] || path.extname(file.originalname || '').toLowerCase();
    cb(null, Date.now() + '-' + crypto.randomBytes(8).toString('hex') + ext);
  }
});

const uploadQuestionImage = multer({
  storage: questionImageStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: function(req, file, cb){
    if(['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mimetype)){
      return cb(null, true);
    }
    cb(new Error('unsupported_image_type'));
  }
});

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

const studentSessionSecret = process.env.STUDENT_SESSION_SECRET || process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || crypto.randomBytes(32).toString('hex');

function signStudentSession(studentId, classId){
  return crypto.createHmac('sha256', studentSessionSecret).update(`${studentId}:${classId}`).digest('hex');
}

function makeStudentSessionToken(studentId, classId){
  return `${studentId}.${classId}.${signStudentSession(studentId, classId)}`;
}

function parseStudentSessionToken(token){
  const raw = typeof token === 'string' ? token.trim() : '';
  const parts = raw.split('.');
  if(parts.length !== 3) return null;
  const studentId = parseInt(parts[0], 10);
  const classId = parseInt(parts[1], 10);
  const sig = parts[2];
  if(!studentId || !classId || !sig) return null;
  const expected = signStudentSession(studentId, classId);
  if(!timingSafeEqualStr(sig, expected)) return null;
  return { studentId, classId };
}

function setStudentSessionCookie(res, token, maxAgeSec){
  const safeAge = Math.max(0, parseInt(maxAgeSec, 10) || 0);
  const cookie = `student_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${safeAge}`;
  const existing = res.getHeader('Set-Cookie');
  if(Array.isArray(existing)){
    res.setHeader('Set-Cookie', existing.concat(cookie));
    return;
  }
  if(existing){
    res.setHeader('Set-Cookie', [existing, cookie]);
    return;
  }
  res.setHeader('Set-Cookie', cookie);
}

function clearStudentSessionCookie(res){
  const cookie = 'student_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  const existing = res.getHeader('Set-Cookie');
  if(Array.isArray(existing)){
    res.setHeader('Set-Cookie', existing.concat(cookie));
    return;
  }
  if(existing){
    res.setHeader('Set-Cookie', [existing, cookie]);
    return;
  }
  res.setHeader('Set-Cookie', cookie);
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
    await dbRunAsync('DELETE FROM exam_session_questions WHERE session_id IN (SELECT id FROM exam_sessions WHERE test_id IN (SELECT id FROM tests WHERE teacher_id=?) OR student_id IN (SELECT id FROM students WHERE class_id IN (SELECT id FROM classes WHERE teacher_id=?)))', [id, id]);
    await dbRunAsync('DELETE FROM exam_sessions WHERE test_id IN (SELECT id FROM tests WHERE teacher_id=?) OR student_id IN (SELECT id FROM students WHERE class_id IN (SELECT id FROM classes WHERE teacher_id=?))', [id, id]);
    await dbRunAsync('DELETE FROM choices WHERE question_id IN (SELECT id FROM questions WHERE test_id IN (SELECT id FROM tests WHERE teacher_id=?))', [id]);
    await dbRunAsync('DELETE FROM questions WHERE test_id IN (SELECT id FROM tests WHERE teacher_id=?)', [id]);
    await dbRunAsync('DELETE FROM test_set_items WHERE set_id IN (SELECT id FROM test_sets WHERE teacher_id=?) OR test_id IN (SELECT id FROM tests WHERE teacher_id=?)', [id, id]);
    await dbRunAsync('DELETE FROM test_set_classes WHERE set_id IN (SELECT id FROM test_sets WHERE teacher_id=?) OR class_id IN (SELECT id FROM classes WHERE teacher_id=?)', [id, id]);
    await dbRunAsync('DELETE FROM test_sets WHERE teacher_id=?', [id]);
    await dbRunAsync('DELETE FROM test_classes WHERE test_id IN (SELECT id FROM tests WHERE teacher_id=?) OR class_id IN (SELECT id FROM classes WHERE teacher_id=?)', [id, id]);
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

app.use((req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.student_session;
  if(!token) return next();
  const parsed = parseStudentSessionToken(token);
  if(!parsed){
    clearStudentSessionCookie(res);
    return next();
  }
  db.get('SELECT id, name, class_id FROM students WHERE id=? AND class_id=?', [parsed.studentId, parsed.classId], (err, row) => {
    if(err || !row){
      clearStudentSessionCookie(res);
      return next();
    }
    req.student = {
      id: row.id,
      name: row.name || '',
      class_id: row.class_id
    };
    next();
  });
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

function ensureTeacherOwnsExamSession(req, res, sessionId, cb){
  db.get(
    `SELECT es.*, t.teacher_id
     FROM exam_sessions es
     JOIN tests t ON t.id = es.test_id
     WHERE es.id=? AND t.teacher_id=?`,
    [sessionId, req.teacher.id],
    (err, row) => {
      if(err) return res.status(500).json({ error: err.message });
      if(!row) return res.status(404).json({ error: 'not_found' });
      cb(row);
    }
  );
}

function normalizeAnswerMode(value){
  if(value === 'immediate_feedback') return 'immediate_feedback';
  if(value === 'exam_mode') return 'exam_mode';
  return 'deferred_summary';
}

function normalizeTeacherNote(value){
  if(typeof value !== 'string') return '';
  return value.slice(0, 1000);
}

function normalizeClassIdsFromBody(body){
  const source = Array.isArray(body && body.class_ids)
    ? body.class_ids
    : (typeof (body && body.class_id) !== 'undefined' && body.class_id !== null && body.class_id !== '' ? [body.class_id] : []);
  const ids = source
    .map(value => parseInt(value, 10))
    .filter(value => Number.isInteger(value) && value > 0);
  return Array.from(new Set(ids));
}

async function ensureTeacherOwnsClassesAsync(teacherId, classIds){
  const ids = Array.isArray(classIds) ? classIds : [];
  if(ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await dbAllAsync(
    `SELECT id FROM classes WHERE teacher_id=? AND id IN (${placeholders})`,
    [teacherId].concat(ids)
  );
  if(rows.length !== ids.length){
    const err = new Error('class_not_found');
    err.statusCode = 404;
    throw err;
  }
}

async function ensureTeacherOwnsTestsAsync(teacherId, testIds){
  const ids = Array.isArray(testIds) ? testIds : [];
  if(ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await dbAllAsync(
    `SELECT id FROM tests WHERE teacher_id=? AND id IN (${placeholders})`,
    [teacherId].concat(ids)
  );
  if(rows.length !== ids.length){
    const err = new Error('test_not_found');
    err.statusCode = 404;
    throw err;
  }
}

async function replaceTestClasses(testId, classIds){
  const ids = Array.isArray(classIds) ? classIds : [];
  await dbRunAsync('DELETE FROM test_classes WHERE test_id=?', [testId]);
  for(const classId of ids){
    await dbRunAsync('INSERT OR IGNORE INTO test_classes (test_id, class_id) VALUES (?,?)', [testId, classId]);
  }
}

async function hydrateTestsForResponse(rows, includeTeacherNote){
  const tests = (rows || []).map(row => serializeTestForResponse(row, includeTeacherNote));
  if(tests.length === 0) return tests;
  const ids = tests.map(row => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const assignments = await dbAllAsync(
    `SELECT tc.test_id, c.id, c.name
     FROM test_classes tc
     JOIN classes c ON c.id=tc.class_id
     WHERE tc.test_id IN (${placeholders})
     ORDER BY c.name ASC, c.id ASC`,
    ids
  );
  const byTest = {};
  assignments.forEach(row => {
    byTest[row.test_id] = byTest[row.test_id] || [];
    byTest[row.test_id].push({ id: row.id, name: row.name });
  });
  return tests.map(test => {
    const assigned = byTest[test.id] || [];
    const classIds = assigned.map(row => row.id);
    const representativeClassId = classIds.length ? classIds[0] : (test.class_id || null);
    return Object.assign({}, test, {
      class_id: representativeClassId,
      class_ids: classIds,
      assigned_classes: assigned
    });
  });
}

function normalizeTestSetName(value){
  return String(value || '').trim().slice(0, 80);
}

function normalizeTestSetDescription(value){
  return String(value || '').trim().slice(0, 1000);
}

function normalizeIds(source){
  const values = Array.isArray(source) ? source : [];
  return Array.from(new Set(values.map(value => parseInt(value, 10)).filter(value => Number.isInteger(value) && value > 0)));
}

async function replaceTestSetClasses(setId, classIds){
  await dbRunAsync('DELETE FROM test_set_classes WHERE set_id=?', [setId]);
  for(const classId of classIds){
    await dbRunAsync('INSERT OR IGNORE INTO test_set_classes (set_id, class_id) VALUES (?,?)', [setId, classId]);
  }
}

async function replaceTestSetItems(setId, testIds){
  await dbRunAsync('DELETE FROM test_set_items WHERE set_id=?', [setId]);
  for(let i = 0; i < testIds.length; i++){
    await dbRunAsync('INSERT OR IGNORE INTO test_set_items (set_id, test_id, position) VALUES (?,?,?)', [setId, testIds[i], i + 1]);
  }
}

async function getTestSetClasses(setIds){
  if(!setIds.length) return {};
  const placeholders = setIds.map(() => '?').join(',');
  const rows = await dbAllAsync(
    `SELECT tsc.set_id, c.id, c.name
     FROM test_set_classes tsc
     JOIN classes c ON c.id=tsc.class_id
     WHERE tsc.set_id IN (${placeholders})
     ORDER BY c.name ASC, c.id ASC`,
    setIds
  );
  const bySet = {};
  rows.forEach(row => {
    bySet[row.set_id] = bySet[row.set_id] || [];
    bySet[row.set_id].push({ id: row.id, name: row.name });
  });
  return bySet;
}

async function getTestSetItems(setIds, studentId){
  if(!setIds.length) return {};
  const placeholders = setIds.map(() => '?').join(',');
  const rows = await dbAllAsync(
    `SELECT tsi.set_id, tsi.position, t.id, t.name, t.description, t.public, t.randomize, t.answer_mode, t.archived,
            COUNT(q.id) AS question_count
     FROM test_set_items tsi
     JOIN tests t ON t.id=tsi.test_id
     LEFT JOIN questions q ON q.test_id=t.id
     WHERE tsi.set_id IN (${placeholders})
     GROUP BY tsi.set_id, tsi.position, t.id
     ORDER BY tsi.set_id ASC, tsi.position ASC`,
    setIds
  );
  let sessionsByTest = {};
  if(studentId && rows.length){
    const testIds = Array.from(new Set(rows.map(row => row.id)));
    const testPlaceholders = testIds.map(() => '?').join(',');
    const sessions = await dbAllAsync(
      `SELECT es.*
       FROM exam_sessions es
       JOIN (
         SELECT test_id, MAX(id) AS id
         FROM exam_sessions
         WHERE student_id=? AND test_id IN (${testPlaceholders})
         GROUP BY test_id
       ) latest ON latest.id=es.id`,
      [studentId].concat(testIds)
    );
    sessions.forEach(session => {
      sessionsByTest[session.test_id] = session;
    });
  }
  const bySet = {};
  rows.forEach(row => {
    const session = sessionsByTest[row.id] || null;
    bySet[row.set_id] = bySet[row.set_id] || [];
    bySet[row.set_id].push({
      id: row.id,
      name: row.name,
      description: row.description || '',
      public: row.public ? 1 : 0,
      archived: row.archived ? 1 : 0,
      randomize: row.randomize ? 1 : 0,
      answer_mode: normalizeAnswerMode(row.answer_mode),
      question_count: row.question_count || 0,
      position: row.position,
      latest_session: session ? {
        id: session.id,
        status: session.status,
        score: session.score || 0,
        max_score: session.max_score || 0,
        percent: session.percent || 0,
        finished_at: session.finished_at,
        started_at: session.started_at
      } : null
    });
  });
  return bySet;
}

async function hydrateTestSetsForResponse(rows, options){
  const sets = (rows || []).map(row => ({
    id: row.id,
    teacher_id: row.teacher_id,
    name: row.name,
    description: row.description || '',
    public: row.public ? 1 : 0,
    archived: row.archived ? 1 : 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
    class_ids: [],
    assigned_classes: [],
    items: []
  }));
  if(!sets.length) return sets;
  const ids = sets.map(row => row.id);
  const classesBySet = await getTestSetClasses(ids);
  const itemsBySet = await getTestSetItems(ids, options && options.studentId);
  return sets.map(set => {
    const assigned = classesBySet[set.id] || [];
    return Object.assign({}, set, {
      class_ids: assigned.map(row => row.id),
      assigned_classes: assigned,
      items: itemsBySet[set.id] || []
    });
  });
}

async function studentCanAccessTest(studentClassId, testId){
  const row = await dbGetAsync(
    `SELECT 1 AS ok
     FROM test_classes tc
     JOIN tests t_direct ON t_direct.id=tc.test_id
     WHERE tc.test_id=? AND tc.class_id=? AND t_direct.public=1 AND (t_direct.archived IS NULL OR t_direct.archived=0)
     UNION
     SELECT 1 AS ok
     FROM tests
     WHERE id=? AND class_id=? AND public=1 AND (archived IS NULL OR archived=0)
     UNION
     SELECT 1 AS ok
     FROM test_set_items tsi
     JOIN test_sets ts ON ts.id=tsi.set_id
     JOIN test_set_classes tsc ON tsc.set_id=ts.id
     WHERE tsi.test_id=?
       AND tsc.class_id=?
       AND ts.public=1
       AND (ts.archived IS NULL OR ts.archived=0)
     LIMIT 1`,
    [testId, studentClassId, testId, studentClassId, testId, studentClassId]
  );
  return !!row;
}

function serializeTestForResponse(row, includeTeacherNote){
  const normalized = { ...row, answer_mode: normalizeAnswerMode(row && row.answer_mode) };
  if(includeTeacherNote){
    normalized.teacher_note = normalizeTeacherNote(row && row.teacher_note);
  } else {
    delete normalized.teacher_note;
  }
  return normalized;
}

function shuffleArrayInPlace(arr){
  for(let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

function parseChoiceOrderJson(raw){
  if(!raw) return [];
  try{
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(id => parseInt(id, 10)).filter(Boolean) : [];
  }catch(_err){
    return [];
  }
}

async function getQuestionBankForTest(testId){
  const questions = await dbAllAsync('SELECT * FROM questions WHERE test_id=?', [testId]);
  const qids = (questions || []).map(q => q.id);
  if(!qids.length){
    return { questions: [], choicesMap: {} };
  }
  const choices = await dbAllAsync(`SELECT * FROM choices WHERE question_id IN (${qids.join(',')})`, []);
  const choicesMap = {};
  (choices || []).forEach(choice => {
    choicesMap[choice.question_id] = choicesMap[choice.question_id] || [];
    choicesMap[choice.question_id].push(choice);
  });
  return { questions: questions || [], choicesMap };
}

function sortChoicesByStoredOrder(choiceRows, choiceOrderJson){
  const orderedIds = parseChoiceOrderJson(choiceOrderJson);
  if(!orderedIds.length) return (choiceRows || []).slice();
  const byId = new Map((choiceRows || []).map(choice => [choice.id, choice]));
  const ordered = [];
  orderedIds.forEach(id => {
    const choice = byId.get(id);
    if(choice){
      ordered.push(choice);
      byId.delete(id);
    }
  });
  return ordered.concat(Array.from(byId.values()));
}

function buildStudentQuestionPayload(question, choiceRows){
  return {
    id: question.id,
    test_id: question.test_id,
    type: question.type,
    text: question.text,
    content_html: question.content_html || '',
    content_format: question.content_format || (question.content_html ? 'html' : 'plain'),
    points: question.points,
    choices: (choiceRows || []).map(choice => ({
      id: choice.id,
      question_id: choice.question_id,
      text: choice.text
    }))
  };
}

function createSessionQuestionPlanRows(questionRows, choicesMap, shouldRandomize){
  const planned = (questionRows || []).map(question => ({
    question,
    choices: ((choicesMap && choicesMap[question.id]) || []).slice()
  }));

  if(shouldRandomize){
    planned.forEach(item => {
      if(item.choices.length > 1) shuffleArrayInPlace(item.choices);
    });
    shuffleArrayInPlace(planned);
  }

  return planned.map((item, index) => ({
    question_id: item.question.id,
    position: index + 1,
    choice_order_json: JSON.stringify(item.choices.map(choice => choice.id))
  }));
}

async function storeExamSessionQuestionPlan(sessionId, testId, shouldRandomize){
  const bank = await getQuestionBankForTest(testId);
  const planRows = createSessionQuestionPlanRows(bank.questions, bank.choicesMap, shouldRandomize);
  await dbRunAsync('DELETE FROM exam_session_questions WHERE session_id=?', [sessionId]);
  for(const row of planRows){
    await dbRunAsync(
      'INSERT INTO exam_session_questions (session_id, question_id, position, choice_order_json) VALUES (?,?,?,?)',
      [sessionId, row.question_id, row.position, row.choice_order_json]
    );
  }
  return planRows;
}

async function ensureExamSessionQuestionPlan(session){
  const existingRows = await dbAllAsync('SELECT * FROM exam_session_questions WHERE session_id=? ORDER BY position ASC', [session.id]);
  if(existingRows.length){
    return existingRows;
  }
  await storeExamSessionQuestionPlan(session.id, session.test_id, session.randomize === 1);
  return dbAllAsync('SELECT * FROM exam_session_questions WHERE session_id=? ORDER BY position ASC', [session.id]);
}

async function buildQuestionsResponse(testId, options){
  const teacherView = !!(options && options.teacherView);
  const sessionPlanRows = options && Array.isArray(options.sessionPlanRows) ? options.sessionPlanRows : null;
  const shouldRandomize = !!(options && options.shouldRandomize);
  const bank = await getQuestionBankForTest(testId);
  const questions = bank.questions || [];
  const choicesMap = bank.choicesMap || {};

  if(!questions.length){
    return [];
  }

  if(sessionPlanRows && sessionPlanRows.length){
    const questionMap = new Map(questions.map(question => [question.id, question]));
    return sessionPlanRows.map(planRow => {
      const question = questionMap.get(planRow.question_id);
      if(!question) return null;
      const plannedChoices = sortChoicesByStoredOrder(choicesMap[question.id] || [], planRow.choice_order_json);
      if(teacherView){
        return { ...question, choices: plannedChoices };
      }
      return buildStudentQuestionPayload(question, plannedChoices);
    }).filter(Boolean);
  }

  const orderedQuestions = questions.slice();
  const orderedChoicesMap = {};
  Object.keys(choicesMap).forEach(questionId => {
    orderedChoicesMap[questionId] = (choicesMap[questionId] || []).slice();
  });

  if(shouldRandomize){
    Object.keys(orderedChoicesMap).forEach(questionId => {
      if(orderedChoicesMap[questionId].length > 1){
        shuffleArrayInPlace(orderedChoicesMap[questionId]);
      }
    });
    shuffleArrayInPlace(orderedQuestions);
  }

  return orderedQuestions.map(question => {
    const questionChoices = orderedChoicesMap[question.id] || [];
    if(teacherView){
      return { ...question, choices: questionChoices };
    }
    return buildStudentQuestionPayload(question, questionChoices);
  });
}

function authorizeExamSessionAccess(req, res, sessionId, cb){
  (async () => {
    try{
      const session = await dbGetAsync(
        `SELECT es.*, t.teacher_id, t.class_id, t.public, t.randomize, t.answer_mode
         FROM exam_sessions es
         JOIN tests t ON t.id=es.test_id
         WHERE es.id=?`,
        [sessionId]
      );
      if(!session) return res.status(404).json({ error: 'session_not_found' });

      if(req.teacher){
        if(session.teacher_id !== req.teacher.id) return res.status(404).json({ error: 'not_found' });
        return cb(session, { actor: 'teacher' });
      }

      if(!req.student) return res.status(401).json({ error: 'unauthorized' });
      if(req.student.id !== session.student_id) return res.status(403).json({ error: 'forbidden' });
      if(!(await studentCanAccessTest(req.student.class_id, session.test_id))) return res.status(403).json({ error: 'forbidden' });
      return cb(session, { actor: 'student' });
    }catch(err){
      return res.status(500).json({ error: err.message });
    }
  })();
}

function buildAnswerFeedback(questionRow, choiceRows, submittedChoiceIds, correct){
  const choiceTextMap = {};
  (choiceRows || []).forEach(row => { choiceTextMap[row.id] = row.text; });
  const correctIds = (choiceRows || []).filter(row => row.is_correct === 1 || row.is_correct === true).map(row => row.id);
  return {
    question_id: questionRow.id,
    question_text: questionRow.text,
    content_html: questionRow.content_html || '',
    content_format: questionRow.content_format || (questionRow.content_html ? 'html' : 'plain'),
    correct: correct,
    explanation: String(questionRow.explanation || '').trim(),
    given_choice_ids: submittedChoiceIds,
    correct_choice_ids: correctIds,
    given_texts: submittedChoiceIds.map(cid => choiceTextMap[cid]).filter(Boolean),
    correct_texts: correctIds.map(cid => choiceTextMap[cid]).filter(Boolean)
  };
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
              db.all('SELECT * FROM student_answers WHERE session_id=? AND student_id=? AND test_id=?', [sessionId, studentId, testId], done);
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
              content_html: q.content_html || '',
              content_format: q.content_format || (q.content_html ? 'html' : 'plain'),
              points: qTotal,
              correct: correct,
              explanation: String(q.explanation || '').trim(),
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

function authorizeStudentTestAccess(req, res, testId, studentId, cb){
  const requestedStudentId = parseInt(studentId, 10);
  const requestedTestId = parseInt(testId, 10);
  if(!requestedStudentId || !requestedTestId){
    return res.status(400).json({ error: 'student_id and test_id required' });
  }

  (async () => {
    try{
      if(req.teacher){
        const ownedTest = await dbGetAsync('SELECT id, class_id, public, teacher_id, randomize, answer_mode FROM tests WHERE id=? AND teacher_id=?', [requestedTestId, req.teacher.id]);
        if(!ownedTest) return res.status(404).json({ error: 'not_found' });
        return cb({ studentId: requestedStudentId, test: ownedTest, actor: 'teacher' });
      }

      const test = await dbGetAsync('SELECT id, class_id, public, randomize, answer_mode, archived FROM tests WHERE id=?', [requestedTestId]);
      if(!test) return res.status(404).json({ error: 'not_found' });
      if(!req.student) return res.status(401).json({ error: 'unauthorized' });
      if(req.student.id !== requestedStudentId) return res.status(403).json({ error: 'forbidden' });
      if(!(await studentCanAccessTest(req.student.class_id, requestedTestId))) return res.status(403).json({ error: 'forbidden' });
      return cb({ studentId: requestedStudentId, test: test, actor: 'student' });
    }catch(err){
      return res.status(500).json({ error: err.message });
    }
  })();
}

function authorizeSummaryAccess(req, res, testId, studentId, sessionId, cb){
  const requestedSessionId = sessionId ? parseInt(sessionId, 10) : null;
  if(!studentId) return res.status(400).json({ error: 'student_id required' });
  if(sessionId && !requestedSessionId) return res.status(400).json({ error: 'invalid_session_id' });

  authorizeStudentTestAccess(req, res, testId, studentId, ({ studentId: authorizedStudentId, test, actor }) => {
    (async () => {
      try{
        let resolvedSession = null;
        if(requestedSessionId){
          resolvedSession = await dbGetAsync('SELECT id, status, finished_at FROM exam_sessions WHERE id=? AND student_id=? AND test_id=?', [requestedSessionId, authorizedStudentId, testId]);
          if(!resolvedSession){
            return res.status(actor === 'teacher' ? 404 : 403).json({ error: actor === 'teacher' ? 'not_found' : 'forbidden' });
          }
        }

        if(actor !== 'teacher'){
          if(normalizeAnswerMode(test && test.answer_mode) === 'exam_mode'){
            return res.status(403).json({ error: 'summary_unavailable_for_exam_mode' });
          }
          if(!requestedSessionId) return res.status(400).json({ error: 'session_id required' });
          if(!resolvedSession || (resolvedSession.status !== 'completed' && !resolvedSession.finished_at)){
            return res.status(403).json({ error: 'summary_not_ready' });
          }
        }

        return cb({ studentId: authorizedStudentId, sessionId: requestedSessionId });
      }catch(err){
        return res.status(500).json({ error: err.message });
      }
    })();
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

app.post('/api/question-images', requireTeacher, (req, res) => {
  uploadQuestionImage.single('image')(req, res, (err) => {
    if(err){
      const status = err.code === 'LIMIT_FILE_SIZE' || err.message === 'unsupported_image_type' ? 400 : 500;
      return res.status(status).json({ error: err.message || 'upload_failed' });
    }
    if(!req.file){
      return res.status(400).json({ error: 'image required' });
    }
    const teacherId = String(req.teacher.id);
    res.json({
      url: '/uploads/question-images/' + encodeURIComponent(teacherId) + '/' + encodeURIComponent(req.file.filename)
    });
  });
});

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
  let { name } = req.body || {};
  name = typeof name === 'string' ? name.trim() : '';
  if(!name) return res.status(400).json({ error: 'name required' });
  if(name.length > 25) return res.status(400).json({ error: 'name too long' });
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
    `SELECT c.id, c.name
     FROM classes c
     WHERE EXISTS (
       SELECT 1
       FROM tests t
       LEFT JOIN test_classes tc ON tc.test_id=t.id
       WHERE t.public=1
         AND (t.archived IS NULL OR t.archived=0)
         AND (tc.class_id=c.id OR t.class_id=c.id)
       UNION
       SELECT 1
       FROM test_sets ts
       JOIN test_set_classes tsc ON tsc.set_id=ts.id
       WHERE ts.public=1
         AND (ts.archived IS NULL OR ts.archived=0)
         AND tsc.class_id=c.id
     )
     ORDER BY c.name ASC`,
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
      `SELECT
        (SELECT COUNT(DISTINCT t.id)
         FROM tests t
         LEFT JOIN test_classes tc ON tc.test_id=t.id
         WHERE t.teacher_id=? AND (t.class_id=? OR tc.class_id=?)) AS tests,
        (SELECT COUNT(*) FROM students WHERE class_id=?) AS students`,
      [req.teacher.id, id, id, id],
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
            db.run('DELETE FROM exam_session_questions WHERE session_id IN (SELECT id FROM exam_sessions WHERE test_id IN (SELECT id FROM tests WHERE class_id=? AND teacher_id=?))', [id, req.teacher.id], function(planErr){
              if(planErr) return res.status(500).json({ error: planErr.message });
              db.run('DELETE FROM exam_sessions WHERE test_id IN (SELECT id FROM tests WHERE class_id=? AND teacher_id=?)', [id, req.teacher.id], function(err3){
                if(err3) return res.status(500).json({ error: err3.message });
                db.run('DELETE FROM choices WHERE question_id IN (SELECT id FROM questions WHERE test_id IN (SELECT id FROM tests WHERE class_id=? AND teacher_id=?))', [id, req.teacher.id], function(err4){
                  if(err4) return res.status(500).json({ error: err4.message });
                  db.run('DELETE FROM questions WHERE test_id IN (SELECT id FROM tests WHERE class_id=? AND teacher_id=?)', [id, req.teacher.id], function(err5){
                    if(err5) return res.status(500).json({ error: err5.message });
                    db.run('DELETE FROM tests WHERE class_id=? AND teacher_id=?', [id, req.teacher.id], function(err6){
                      if(err6) return res.status(500).json({ error: err6.message });
                      db.run('DELETE FROM students WHERE class_id=?', [id], function(err7){
                        if(err7) return res.status(500).json({ error: err7.message });
                        db.run('DELETE FROM test_set_classes WHERE class_id=?', [id], function(setClassErr){
                          if(setClassErr) return res.status(500).json({ error: setClassErr.message });
                          db.run('DELETE FROM test_classes WHERE class_id=?', [id], function(unlinkErr){
                            if(unlinkErr) return res.status(500).json({ error: unlinkErr.message });
                            db.run('DELETE FROM classes WHERE id=? AND teacher_id=?', [id, req.teacher.id], function(err8){
                              if(err8) return res.status(500).json({ error: err8.message });
                              res.json({ id: Number(id), deleted: true, cascade: true });
                            });
                          });
                        });
                      });
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
            db.run('DELETE FROM test_set_classes WHERE class_id=?', [id], function(setClassErr){
              if(setClassErr) return res.status(500).json({ error: setClassErr.message });
              db.run('DELETE FROM test_classes WHERE class_id=?', [id], function(unlinkErr){
                if(unlinkErr) return res.status(500).json({ error: unlinkErr.message });
                db.run('UPDATE tests SET class_id=NULL WHERE class_id=? AND teacher_id=?', [id, req.teacher.id], function(err3){
                  if(err3) return res.status(500).json({ error: err3.message });
                  res.json({ id: id, deleted: true });
                });
              });
            });
          });
        }
      }
    );
  });
});

// Test sets
app.get('/api/test-sets', (req, res) => {
  const { class_id, public: pub, archived, include_archived } = req.query;
  const wantsArchivedOnly = archived === '1' || archived === 1;
  const wantsIncludeArchived = include_archived === '1' || include_archived === 1;
  let sql = 'SELECT DISTINCT ts.* FROM test_sets ts';
  const params = [];
  const conditions = [];

  if(req.teacher){
    conditions.push('ts.teacher_id=?');
    params.push(req.teacher.id);
    if(class_id){
      sql += ' LEFT JOIN test_set_classes tsc_filter ON tsc_filter.set_id=ts.id';
      conditions.push('tsc_filter.class_id=?');
      params.push(class_id);
    }
    if(typeof pub !== 'undefined'){
      conditions.push('ts.public=?');
      params.push(pub == 1 || pub === '1' ? 1 : 0);
    }
    if(wantsArchivedOnly){
      conditions.push('ts.archived=1');
    } else if(!wantsIncludeArchived){
      conditions.push('(ts.archived IS NULL OR ts.archived=0)');
    }
  } else {
    conditions.push('ts.public=1');
    conditions.push('(ts.archived IS NULL OR ts.archived=0)');
    if(class_id){
      sql += ' JOIN test_set_classes tsc_filter ON tsc_filter.set_id=ts.id';
      conditions.push('tsc_filter.class_id=?');
      params.push(class_id);
    }
  }

  if(conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY ts.id DESC';
  db.all(sql, params, async (err, rows) => {
    if(err) return res.status(500).json({ error: err.message });
    try{
      res.json(await hydrateTestSetsForResponse(rows || [], { studentId: req.student && req.student.id }));
    }catch(hydrateErr){
      res.status(500).json({ error: hydrateErr.message });
    }
  });
});

app.get('/api/test-sets/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if(!id) return res.status(400).json({ error: 'invalid_set_id' });
  const sql = req.teacher
    ? 'SELECT * FROM test_sets WHERE id=? AND teacher_id=?'
    : 'SELECT * FROM test_sets WHERE id=? AND public=1 AND (archived IS NULL OR archived=0)';
  const params = req.teacher ? [id, req.teacher.id] : [id];
  db.get(sql, params, async (err, row) => {
    if(err) return res.status(500).json({ error: err.message });
    if(!row) return res.status(404).json({ error: 'not_found' });
    try{
      const hydrated = await hydrateTestSetsForResponse([row], { studentId: req.student && req.student.id });
      const set = hydrated[0];
      if(!req.teacher){
        const classId = req.student ? req.student.class_id : parseInt(req.query.class_id, 10);
        if(!classId || set.class_ids.map(String).indexOf(String(classId)) === -1){
          return res.status(403).json({ error: 'forbidden' });
        }
      }
      res.json(set);
    }catch(hydrateErr){
      res.status(500).json({ error: hydrateErr.message });
    }
  });
});

app.post('/api/test-sets', requireTeacher, async (req, res) => {
  const name = normalizeTestSetName(req.body && req.body.name);
  if(!name) return res.status(400).json({ error: 'name required' });
  const description = normalizeTestSetDescription(req.body && req.body.description);
  const classIds = normalizeIds(req.body && req.body.class_ids);
  const testIds = normalizeIds(req.body && req.body.test_ids);
  const nowIso = new Date().toISOString();
  try{
    await ensureTeacherOwnsClassesAsync(req.teacher.id, classIds);
    await ensureTeacherOwnsTestsAsync(req.teacher.id, testIds);
    await dbRunAsync('BEGIN IMMEDIATE TRANSACTION');
    const inserted = await dbRunAsync(
      'INSERT INTO test_sets (teacher_id, name, description, public, archived, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      [req.teacher.id, name, description, req.body && req.body.public ? 1 : 0, req.body && req.body.archived ? 1 : 0, nowIso, nowIso]
    );
    await replaceTestSetClasses(inserted.lastID, classIds);
    await replaceTestSetItems(inserted.lastID, testIds);
    await dbRunAsync('COMMIT');
    const row = await dbGetAsync('SELECT * FROM test_sets WHERE id=? AND teacher_id=?', [inserted.lastID, req.teacher.id]);
    const hydrated = await hydrateTestSetsForResponse([row], {});
    res.json(hydrated[0]);
  }catch(err){
    try{ await dbRunAsync('ROLLBACK'); }catch(_rollbackErr){}
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.put('/api/test-sets/:id', requireTeacher, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if(!id) return res.status(400).json({ error: 'invalid_set_id' });
  const current = await dbGetAsync('SELECT * FROM test_sets WHERE id=? AND teacher_id=?', [id, req.teacher.id]).catch(err => {
    res.status(500).json({ error: err.message });
    return null;
  });
  if(!current) return;
  const name = Object.prototype.hasOwnProperty.call(req.body || {}, 'name') ? normalizeTestSetName(req.body.name) : current.name;
  if(!name) return res.status(400).json({ error: 'name required' });
  const description = Object.prototype.hasOwnProperty.call(req.body || {}, 'description') ? normalizeTestSetDescription(req.body.description) : current.description || '';
  const shouldUpdateClasses = Object.prototype.hasOwnProperty.call(req.body || {}, 'class_ids');
  const shouldUpdateItems = Object.prototype.hasOwnProperty.call(req.body || {}, 'test_ids');
  const classIds = shouldUpdateClasses ? normalizeIds(req.body.class_ids) : null;
  const testIds = shouldUpdateItems ? normalizeIds(req.body.test_ids) : null;
  const nowIso = new Date().toISOString();
  try{
    if(shouldUpdateClasses) await ensureTeacherOwnsClassesAsync(req.teacher.id, classIds);
    if(shouldUpdateItems) await ensureTeacherOwnsTestsAsync(req.teacher.id, testIds);
    await dbRunAsync('BEGIN IMMEDIATE TRANSACTION');
    await dbRunAsync(
      'UPDATE test_sets SET name=?, description=?, public=?, archived=?, updated_at=? WHERE id=? AND teacher_id=?',
      [
        name,
        description,
        Object.prototype.hasOwnProperty.call(req.body || {}, 'public') ? (req.body.public ? 1 : 0) : (current.public ? 1 : 0),
        Object.prototype.hasOwnProperty.call(req.body || {}, 'archived') ? (req.body.archived ? 1 : 0) : (current.archived ? 1 : 0),
        nowIso,
        id,
        req.teacher.id
      ]
    );
    if(shouldUpdateClasses) await replaceTestSetClasses(id, classIds);
    if(shouldUpdateItems) await replaceTestSetItems(id, testIds);
    await dbRunAsync('COMMIT');
    const row = await dbGetAsync('SELECT * FROM test_sets WHERE id=? AND teacher_id=?', [id, req.teacher.id]);
    const hydrated = await hydrateTestSetsForResponse([row], {});
    res.json(hydrated[0]);
  }catch(err){
    try{ await dbRunAsync('ROLLBACK'); }catch(_rollbackErr){}
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete('/api/test-sets/:id', requireTeacher, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if(!id) return res.status(400).json({ error: 'invalid_set_id' });
  try{
    const row = await dbGetAsync('SELECT id FROM test_sets WHERE id=? AND teacher_id=?', [id, req.teacher.id]);
    if(!row) return res.status(404).json({ error: 'not_found' });
    await dbRunAsync('BEGIN IMMEDIATE TRANSACTION');
    await dbRunAsync('DELETE FROM test_set_items WHERE set_id=?', [id]);
    await dbRunAsync('DELETE FROM test_set_classes WHERE set_id=?', [id]);
    await dbRunAsync('DELETE FROM test_sets WHERE id=? AND teacher_id=?', [id, req.teacher.id]);
    await dbRunAsync('COMMIT');
    res.json({ id, deleted: true });
  }catch(err){
    try{ await dbRunAsync('ROLLBACK'); }catch(_rollbackErr){}
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/test-sets/:id/summary', requireTeacher, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if(!id) return res.status(400).json({ error: 'invalid_set_id' });
  try{
    const row = await dbGetAsync('SELECT * FROM test_sets WHERE id=? AND teacher_id=?', [id, req.teacher.id]);
    if(!row) return res.status(404).json({ error: 'not_found' });
    const hydrated = await hydrateTestSetsForResponse([row], {});
    const set = hydrated[0];
    const testIds = (set.items || []).map(item => item.id);
    const classIds = (set.class_ids || []).map(idValue => parseInt(idValue, 10)).filter(Boolean);
    if(!testIds.length || !classIds.length){
      return res.json({ set, students: [], totals: { students: 0, completed_tests: 0, possible_tests: 0, score: 0, max_score: 0, percent: 0 } });
    }
    const classPlaceholders = classIds.map(() => '?').join(',');
    const students = await dbAllAsync(
      `SELECT s.id, s.name, s.class_id, c.name AS className
       FROM students s
       LEFT JOIN classes c ON c.id=s.class_id
       WHERE s.class_id IN (${classPlaceholders})
       ORDER BY c.name ASC, s.name ASC, s.id ASC`,
      classIds
    );
    const testPlaceholders = testIds.map(() => '?').join(',');
    const studentIds = students.map(student => student.id);
    let sessions = [];
    if(studentIds.length){
      const studentPlaceholders = studentIds.map(() => '?').join(',');
      sessions = await dbAllAsync(
        `SELECT es.*
         FROM exam_sessions es
         JOIN (
           SELECT student_id, test_id, MAX(id) AS id
           FROM exam_sessions
           WHERE student_id IN (${studentPlaceholders})
             AND test_id IN (${testPlaceholders})
           GROUP BY student_id, test_id
         ) latest ON latest.id=es.id`,
        studentIds.concat(testIds)
      );
    }
    const byStudentTest = {};
    sessions.forEach(session => {
      byStudentTest[session.student_id + ':' + session.test_id] = session;
    });
    let completedTests = 0;
    let score = 0;
    let maxScore = 0;
    const studentRows = students.map(student => {
      let studentCompleted = 0;
      let studentInProgress = 0;
      let studentScore = 0;
      let studentMax = 0;
      const testsForStudent = (set.items || []).map(item => {
        const session = byStudentTest[student.id + ':' + item.id] || null;
        const completed = !!(session && (session.status === 'completed' || session.finished_at));
        if(completed){
          studentCompleted++;
          completedTests++;
          studentScore += session.score || 0;
          studentMax += session.max_score || 0;
          score += session.score || 0;
          maxScore += session.max_score || 0;
        } else if(session) {
          studentInProgress++;
        }
        return {
          test_id: item.id,
          test_name: item.name,
          status: session ? session.status : 'not_started',
          session_id: session ? session.id : null,
          score: completed ? (session.score || 0) : 0,
          max_score: completed ? (session.max_score || 0) : 0,
          percent: completed ? (session.percent || 0) : 0,
          finished_at: session ? session.finished_at : null,
          started_at: session ? session.started_at : null
        };
      });
      return {
        student_id: student.id,
        student_name: student.name,
        class_id: student.class_id,
        class_name: student.className,
        completed_tests: studentCompleted,
        in_progress_tests: studentInProgress,
        total_tests: testIds.length,
        score: studentScore,
        max_score: studentMax,
        percent: studentMax ? (studentScore / studentMax * 100) : 0,
        tests: testsForStudent
      };
    });
    res.json({
      set,
      students: studentRows,
      totals: {
        students: students.length,
        completed_tests: completedTests,
        possible_tests: students.length * testIds.length,
        score,
        max_score: maxScore,
        percent: maxScore ? (score / maxScore * 100) : 0
      }
    });
  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

// Tests
app.post('/api/tests', requireTeacher, async (req, res) => {
  const { name, description, public: pub, randomize, answer_mode, teacher_note } = req.body;
  const answerMode = normalizeAnswerMode(answer_mode);
  const teacherNote = normalizeTeacherNote(teacher_note);
  const classIds = normalizeClassIdsFromBody(req.body || {});
  try{
    await ensureTeacherOwnsClassesAsync(req.teacher.id, classIds);
    const representativeClassId = classIds.length ? classIds[0] : null;
    const inserted = await dbRunAsync(
      'INSERT INTO tests (teacher_id, class_id, name, description, teacher_note, public, randomize, answer_mode) VALUES (?,?,?,?,?,?,?,?)',
      [req.teacher.id, representativeClassId, name, description||'', teacherNote, pub?1:0, randomize?1:0, answerMode]
    );
    await replaceTestClasses(inserted.lastID, classIds);
    const row = await dbGetAsync('SELECT * FROM tests WHERE id=? AND teacher_id=?', [inserted.lastID, req.teacher.id]);
    const hydrated = await hydrateTestsForResponse([row], true);
    res.json(hydrated[0]);
  }catch(err){
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});
app.get('/api/tests', (req, res) => {
  const { class_id, public: pub, archived, include_archived } = req.query;
  let sql = 'SELECT DISTINCT tests.* FROM tests';
  const params = [];
  const conditions = [];
  const wantsArchivedOnly = archived === '1' || archived === 1;
  const wantsIncludeArchived = include_archived === '1' || include_archived === 1;
  if(req.teacher){
    conditions.push('teacher_id=?');
    params.push(req.teacher.id);
    if(class_id){
      sql += ' LEFT JOIN test_classes tc_filter ON tc_filter.test_id=tests.id';
      conditions.push('(tests.class_id=? OR tc_filter.class_id=?)');
      params.push(class_id, class_id);
    }
    if(typeof pub !== 'undefined'){
      conditions.push('public=?'); params.push(pub==1 || pub==='1' ? 1 : 0);
    }
    if(wantsArchivedOnly){
      conditions.push('archived=1');
    } else if(!wantsIncludeArchived){
      conditions.push('(archived IS NULL OR archived=0)');
    }
  } else {
    // Public(student) view: only published tests
    conditions.push('public=1');
    conditions.push('(archived IS NULL OR archived=0)');
    if(class_id){
      sql += ' LEFT JOIN test_classes tc_filter ON tc_filter.test_id=tests.id';
      conditions.push('(tests.class_id=? OR tc_filter.class_id=?)');
      params.push(class_id, class_id);
    }
  }
  if(conditions.length > 0){ sql += ' WHERE ' + conditions.join(' AND '); }
  sql += ' ORDER BY tests.id DESC';
  db.all(sql, params, async (err, rows) => {
    if(err) return res.status(500).json({ error: err.message });
    try{
      res.json(await hydrateTestsForResponse(rows || [], !!req.teacher));
    }catch(hydrateErr){
      res.status(500).json({ error: hydrateErr.message });
    }
  });
});

// Update a test (name, description, public, randomize, answer_mode, archived, teacher_note)
app.put('/api/tests/:id', requireTeacher, (req, res) => {
  const id = req.params.id;
  const { name, description, public: pub, randomize, answer_mode, class_id, archived, teacher_note } = req.body;
  // Build update dynamically so that if `class_id` is undefined we don't overwrite it
  const fields = ['name=?', 'description=?', 'public=?', 'randomize=?'];
  const vals = [name, description||'', pub?1:0, randomize?1:0];
  ensureTeacherOwnsTest(req, res, id, () => {
    const proceed = async () => {
      const hasClassIds = Object.prototype.hasOwnProperty.call(req.body || {}, 'class_ids');
      const shouldUpdateClasses = hasClassIds || Object.prototype.hasOwnProperty.call(req.body || {}, 'class_id');
      const classIds = shouldUpdateClasses ? normalizeClassIdsFromBody(req.body || {}) : null;
      if(shouldUpdateClasses){
        await ensureTeacherOwnsClassesAsync(req.teacher.id, classIds);
      }
      if(typeof answer_mode !== 'undefined'){
        fields.push('answer_mode=?');
        vals.push(normalizeAnswerMode(answer_mode));
      }
      if(shouldUpdateClasses){
        fields.push('class_id=?');
        vals.push(classIds.length ? classIds[0] : null);
      }
      if(typeof archived !== 'undefined'){
        fields.push('archived=?');
        vals.push(archived ? 1 : 0);
      }
      if(typeof teacher_note !== 'undefined'){
        fields.push('teacher_note=?');
        vals.push(normalizeTeacherNote(teacher_note));
      }
      const updateSql = `UPDATE tests SET ${fields.join(', ')} WHERE id=? AND teacher_id=?`;
      vals.push(id, req.teacher.id);
      await dbRunAsync(updateSql, vals);
      if(shouldUpdateClasses){
        await replaceTestClasses(id, classIds);
      }
      const row = await dbGetAsync('SELECT * FROM tests WHERE id=? AND teacher_id=?', [id, req.teacher.id]);
      const hydrated = await hydrateTestsForResponse([row], true);
      res.json(hydrated[0]);
    };
    proceed().catch(err => res.status(err.statusCode || 500).json({ error: err.message }));
  });
});

// Delete a test (optional cascade deletes related questions, choices, and student_answers)
app.delete('/api/tests/:id', requireTeacher, (req, res) => {
  const id = req.params.id;
  ensureTeacherOwnsTest(req, res, id, () => {
    db.get(
      'SELECT (SELECT COUNT(*) FROM questions WHERE test_id=?) AS questions, (SELECT COUNT(*) FROM student_answers WHERE test_id=?) AS answers, (SELECT COUNT(*) FROM exam_sessions WHERE test_id=?) AS sessions',
      [id, id, id],
      (err, row) => {
        if(err) return res.status(500).json({ error: err.message });
        const hasDeps = row && (row.questions > 0 || row.answers > 0 || row.sessions > 0);
        if(hasDeps && req.query.cascade !== '1'){
          return res.status(400).json({ error: 'has_dependencies', questions: row.questions, answers: row.answers, sessions: row.sessions });
        }
        if(hasDeps && req.query.cascade === '1'){
          // cascade delete related data
          db.run('DELETE FROM student_answers WHERE test_id=?', [id], function(err2){
            if(err2) return res.status(500).json({ error: err2.message });
            db.run('DELETE FROM exam_session_questions WHERE session_id IN (SELECT id FROM exam_sessions WHERE test_id=?)', [id], function(planErr){
              if(planErr) return res.status(500).json({ error: planErr.message });
              db.run('DELETE FROM exam_sessions WHERE test_id=?', [id], function(err3){
                if(err3) return res.status(500).json({ error: err3.message });
                db.run('DELETE FROM choices WHERE question_id IN (SELECT id FROM questions WHERE test_id=?)', [id], function(err4){
                  if(err4) return res.status(500).json({ error: err4.message });
                  db.run('DELETE FROM questions WHERE test_id=?', [id], function(err5){
                    if(err5) return res.status(500).json({ error: err5.message });
                    db.run('DELETE FROM test_set_items WHERE test_id=?', [id], function(setItemErr){
                      if(setItemErr) return res.status(500).json({ error: setItemErr.message });
                    db.run('DELETE FROM test_classes WHERE test_id=?', [id], function(unlinkErr){
                      if(unlinkErr) return res.status(500).json({ error: unlinkErr.message });
                      db.run('DELETE FROM tests WHERE id=? AND teacher_id=?', [id, req.teacher.id], function(err6){
                      if(err6) return res.status(500).json({ error: err6.message });
                      res.json({ id: id, deleted: true, cascade: true });
                      });
                    });
                    });
                  });
                });
              });
            });
          });
        } else {
          // no dependencies - safe to delete
          db.run('DELETE FROM test_set_items WHERE test_id=?', [id], function(setItemErr){
            if(setItemErr) return res.status(500).json({ error: setItemErr.message });
          db.run('DELETE FROM test_classes WHERE test_id=?', [id], function(unlinkErr){
            if(unlinkErr) return res.status(500).json({ error: unlinkErr.message });
            db.run('DELETE FROM tests WHERE id=? AND teacher_id=?', [id, req.teacher.id], function(err2){
              if(err2) return res.status(500).json({ error: err2.message });
              res.json({ id: id, deleted: true });
            });
          });
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
  let content;
  try{
    content = normalizeQuestionContent(req.body || {});
  }catch(err){
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
  ensureTeacherOwnsTest(req, res, testId, () => {
    db.run('INSERT INTO questions (test_id, type, text, points, explanation, content_html, content_format) VALUES (?,?,?,?,?,?,?)', [testId, type||'single', content.text || text || '', points||1, explanation || '', content.content_html, content.content_format], function(err){
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
    buildQuestionsResponse(testId, {
      teacherView: !!req.teacher,
      shouldRandomize: testRow && testRow.randomize === 1
    })
      .then(out => res.json(out))
      .catch(err => res.status(500).json({ error: err.message }));
  });
});

app.get('/api/exam-sessions/:id/questions', (req, res) => {
  const id = req.params.id;
  authorizeExamSessionAccess(req, res, id, (session, { actor }) => {
    ensureExamSessionQuestionPlan(session)
      .then(planRows => buildQuestionsResponse(session.test_id, {
        teacherView: actor === 'teacher',
        sessionPlanRows: planRows,
        shouldRandomize: false
      }))
      .then(questions => res.json(questions))
      .catch(err => res.status(500).json({ error: err.message }));
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
      db.run('INSERT INTO questions (test_id, type, text, points, explanation, content_html, content_format) VALUES (?,?,?,?,?,?,?)', [testId, q.type, q.text, q.points || 1, q.explanation || '', '', 'plain'], function(err){
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
      db.get(
        `SELECT *
         FROM classes
         WHERE id=?
           AND EXISTS (
             SELECT 1
             FROM tests t
             LEFT JOIN test_classes tc ON tc.test_id=t.id
             WHERE t.public=1
               AND (t.archived IS NULL OR t.archived=0)
               AND (tc.class_id=classes.id OR t.class_id=classes.id)
             UNION
             SELECT 1
             FROM test_sets ts
             JOIN test_set_classes tsc ON tsc.set_id=ts.id
             WHERE ts.public=1
               AND (ts.archived IS NULL OR ts.archived=0)
               AND tsc.class_id=classes.id
           )`,
        [class_id],
        cb
      );
    }
    else if(class_name){
      db.get(
        `SELECT *
         FROM classes
         WHERE name=?
           AND EXISTS (
             SELECT 1
             FROM tests t
             LEFT JOIN test_classes tc ON tc.test_id=t.id
             WHERE t.public=1
               AND (t.archived IS NULL OR t.archived=0)
               AND (tc.class_id=classes.id OR t.class_id=classes.id)
             UNION
             SELECT 1
             FROM test_sets ts
             JOIN test_set_classes tsc ON tsc.set_id=ts.id
             WHERE ts.public=1
               AND (ts.archived IS NULL OR ts.archived=0)
               AND tsc.class_id=classes.id
           )`,
        [class_name],
        cb
      );
    }
    else cb(null, null);
  };
  findClass((err, cls) => {
    if(err) return res.status(500).json({ error: err.message });
    if(!cls) return res.status(400).json({ error: 'class not found' });
    const code = Math.random().toString(36).slice(2,8).toUpperCase();
    db.run('INSERT INTO students (class_id, name, code) VALUES (?,?,?)', [cls.id, name, code], function(err2){
      if(err2) return res.status(500).json({ error: err2.message });
      const studentId = this.lastID;
      setStudentSessionCookie(res, makeStudentSessionToken(studentId, cls.id), 60 * 60 * 12);
      res.json({ id: studentId, name, code, class_id: cls.id });
    });
  });
});

// Submit an answer (single or multiple)
app.post('/api/submit-answer', (req, res) => {
  const { student_id, test_id, question_id, choice_id, choice_ids, session_id } = req.body;
  if(!student_id || !test_id || !question_id) return res.status(400).json({ error: 'student_id,test_id,question_id required' });
  authorizeStudentTestAccess(req, res, test_id, student_id, ({ studentId: authorizedStudentId, test }) => {
    (async () => {
      const normalizedSessionId = parseInt(session_id, 10);
      if(!normalizedSessionId) return res.status(400).json({ error: 'session_id required' });

      const submitted = [];
      if(Array.isArray(choice_ids)) submitted.push(...choice_ids.map(x => parseInt(x, 10)).filter(Boolean));
      else if(choice_id) submitted.push(parseInt(choice_id, 10));
      const uniqueSubmitted = Array.from(new Set(submitted));
      const answerMode = normalizeAnswerMode(test && test.answer_mode);

      try{
        await dbRunAsync('BEGIN IMMEDIATE TRANSACTION');

        const session = await dbGetAsync(
          'SELECT id, student_id, test_id, status, finished_at FROM exam_sessions WHERE id=? AND student_id=? AND test_id=?',
          [normalizedSessionId, authorizedStudentId, test_id]
        );
        if(!session){
          await dbRunAsync('ROLLBACK');
          return res.status(403).json({ error: 'forbidden' });
        }
        if(session.status === 'completed' || session.finished_at){
          await dbRunAsync('ROLLBACK');
          return res.status(409).json({ error: 'session_completed' });
        }

        const questionRow = await dbGetAsync('SELECT id, test_id, text, explanation, content_html, content_format FROM questions WHERE id=? AND test_id=?', [question_id, test_id]);
        if(!questionRow){
          await dbRunAsync('ROLLBACK');
          return res.status(400).json({ error: 'invalid_question_id' });
        }

        const planRows = await ensureExamSessionQuestionPlan({ ...session, randomize: test && test.randomize });
        const nextPlanRow = (planRows || []).find(row => !row.answered_at);
        if(!nextPlanRow){
          await dbRunAsync('ROLLBACK');
          return res.status(409).json({ error: 'session_completed' });
        }
        if(Number(nextPlanRow.question_id) !== Number(question_id)){
          await dbRunAsync('ROLLBACK');
          return res.status(409).json({ error: 'question_out_of_order', expected_question_id: nextPlanRow.question_id });
        }

        const existingAnswers = await dbAllAsync(
          'SELECT choice_id FROM student_answers WHERE session_id=? AND student_id=? AND test_id=? AND question_id=?',
          [normalizedSessionId, authorizedStudentId, test_id, question_id]
        );
        if(existingAnswers.length){
          await dbRunAsync('ROLLBACK');
          return res.status(409).json({ error: 'question_already_answered' });
        }

        const choiceRows = await dbAllAsync('SELECT id, text, is_correct FROM choices WHERE question_id=?', [question_id]);
        const validChoiceIds = new Set((choiceRows || []).map(row => row.id));
        const hasInvalidChoice = uniqueSubmitted.some(cid => !validChoiceIds.has(cid));
        if(hasInvalidChoice){
          await dbRunAsync('ROLLBACK');
          return res.status(400).json({ error: 'invalid_choice_id' });
        }

        const correctIds = (choiceRows || []).filter(row => row.is_correct === 1 || row.is_correct === true).map(row => row.id);
        let correct = false;
        if(uniqueSubmitted.length > 0){
          const submittedSet = new Set(uniqueSubmitted);
          const correctSet = new Set(correctIds);
          if(submittedSet.size === correctSet.size){
            correct = [...submittedSet].every(id => correctSet.has(id));
          }
        }

        if(uniqueSubmitted.length === 0){
          await dbRunAsync(
            'INSERT INTO student_answers (student_id, test_id, question_id, choice_id, correct, session_id) VALUES (?,?,?,?,?,?)',
            [authorizedStudentId, test_id, question_id, null, correct ? 1 : 0, normalizedSessionId]
          );
        } else {
          for(const submittedChoiceId of uniqueSubmitted){
            await dbRunAsync(
              'INSERT INTO student_answers (student_id, test_id, question_id, choice_id, correct, session_id) VALUES (?,?,?,?,?,?)',
              [authorizedStudentId, test_id, question_id, submittedChoiceId, correct ? 1 : 0, normalizedSessionId]
            );
          }
        }

        const answeredAt = new Date().toISOString();
        const markAnswered = await dbRunAsync(
          'UPDATE exam_session_questions SET answered_at=? WHERE session_id=? AND question_id=? AND answered_at IS NULL',
          [answeredAt, normalizedSessionId, question_id]
        );
        if(!markAnswered.changes){
          await dbRunAsync('ROLLBACK');
          return res.status(409).json({ error: 'question_already_answered' });
        }

        await dbRunAsync('COMMIT');

        const response = { accepted: true };
        if(answerMode === 'immediate_feedback'){
          response.feedback = buildAnswerFeedback(questionRow, choiceRows, uniqueSubmitted, correct);
        }
        return res.json(response);
      }catch(err){
        try{
          await dbRunAsync('ROLLBACK');
        }catch(_rollbackErr){
          // surface the original error
        }
        return res.status(500).json({ error: err.message });
      }
    })();
  });
});

// Update an already-submitted answer while an exam session is still in progress.
app.put('/api/exam-sessions/:sessionId/answers/:questionId', (req, res) => {
  const sessionId = parseInt(req.params.sessionId, 10);
  const questionId = parseInt(req.params.questionId, 10);
  const { student_id, test_id, choice_id, choice_ids } = req.body || {};
  if(!sessionId) return res.status(400).json({ error: 'invalid_session_id' });
  if(!questionId) return res.status(400).json({ error: 'invalid_question_id' });
  if(!student_id || !test_id) return res.status(400).json({ error: 'student_id and test_id required' });

  authorizeStudentTestAccess(req, res, test_id, student_id, ({ studentId: authorizedStudentId, test }) => {
    (async () => {
      const submitted = [];
      if(Array.isArray(choice_ids)) submitted.push(...choice_ids.map(x => parseInt(x, 10)).filter(Boolean));
      else if(choice_id) submitted.push(parseInt(choice_id, 10));
      const uniqueSubmitted = Array.from(new Set(submitted));

      try{
        await dbRunAsync('BEGIN IMMEDIATE TRANSACTION');

        const session = await dbGetAsync(
          'SELECT id, student_id, test_id, status, finished_at FROM exam_sessions WHERE id=? AND student_id=? AND test_id=?',
          [sessionId, authorizedStudentId, test_id]
        );
        if(!session){
          await dbRunAsync('ROLLBACK');
          return res.status(403).json({ error: 'forbidden' });
        }
        if(session.status === 'completed' || session.finished_at){
          await dbRunAsync('ROLLBACK');
          return res.status(409).json({ error: 'session_completed' });
        }

        const planRows = await ensureExamSessionQuestionPlan({ ...session, randomize: test && test.randomize });
        const planRow = (planRows || []).find(row => Number(row.question_id) === Number(questionId));
        if(!planRow){
          await dbRunAsync('ROLLBACK');
          return res.status(400).json({ error: 'question_not_in_session' });
        }

        const questionRow = await dbGetAsync('SELECT id, test_id FROM questions WHERE id=? AND test_id=?', [questionId, test_id]);
        if(!questionRow){
          await dbRunAsync('ROLLBACK');
          return res.status(400).json({ error: 'invalid_question_id' });
        }

        const choiceRows = await dbAllAsync('SELECT id, is_correct FROM choices WHERE question_id=?', [questionId]);
        const validChoiceIds = new Set((choiceRows || []).map(row => row.id));
        const hasInvalidChoice = uniqueSubmitted.some(cid => !validChoiceIds.has(cid));
        if(hasInvalidChoice){
          await dbRunAsync('ROLLBACK');
          return res.status(400).json({ error: 'invalid_choice_id' });
        }

        const correctIds = (choiceRows || []).filter(row => row.is_correct === 1 || row.is_correct === true).map(row => row.id);
        let correct = false;
        if(uniqueSubmitted.length > 0){
          const submittedSet = new Set(uniqueSubmitted);
          const correctSet = new Set(correctIds);
          if(submittedSet.size === correctSet.size){
            correct = [...submittedSet].every(id => correctSet.has(id));
          }
        }

        await dbRunAsync(
          'DELETE FROM student_answers WHERE session_id=? AND student_id=? AND test_id=? AND question_id=?',
          [sessionId, authorizedStudentId, test_id, questionId]
        );

        if(uniqueSubmitted.length === 0){
          await dbRunAsync(
            'INSERT INTO student_answers (student_id, test_id, question_id, choice_id, correct, session_id) VALUES (?,?,?,?,?,?)',
            [authorizedStudentId, test_id, questionId, null, correct ? 1 : 0, sessionId]
          );
        } else {
          for(const submittedChoiceId of uniqueSubmitted){
            await dbRunAsync(
              'INSERT INTO student_answers (student_id, test_id, question_id, choice_id, correct, session_id) VALUES (?,?,?,?,?,?)',
              [authorizedStudentId, test_id, questionId, submittedChoiceId, correct ? 1 : 0, sessionId]
            );
          }
        }

        const answeredAt = new Date().toISOString();
        await dbRunAsync(
          'UPDATE exam_session_questions SET answered_at=COALESCE(answered_at, ?) WHERE session_id=? AND question_id=?',
          [answeredAt, sessionId, questionId]
        );

        await dbRunAsync('COMMIT');
        return res.json({ accepted: true, question_id: questionId, choice_ids: uniqueSubmitted });
      }catch(err){
        try{
          await dbRunAsync('ROLLBACK');
        }catch(_rollbackErr){
          // surface the original error
        }
        return res.status(500).json({ error: err.message });
      }
    })();
  });
});

// Fetch student answers (filter by student_id and test_id)
app.get('/api/studentAnswers', requireTeacher, (req, res) => {
  const { student_id, test_id } = req.query;
  if(!student_id || !test_id) return res.status(400).json({ error: 'student_id and test_id required' });
  ensureTeacherOwnsTest(req, res, test_id, () => {
    db.all('SELECT * FROM student_answers WHERE student_id=? AND test_id=?', [student_id, test_id], (err, rows)=>{
      if(err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });
});

// Summary for a student's test: per-question detail and totals
app.get('/api/tests/:testId/summary', (req, res) => {
  const testId = req.params.testId;
  const studentId = req.query.student_id;
  const sessionId = req.query.session_id;
  authorizeSummaryAccess(req, res, testId, studentId, sessionId, ({ studentId: authorizedStudentId, sessionId: authorizedSessionId }) => {
    buildTestSummaryForStudent(testId, authorizedStudentId, authorizedSessionId)
      .then(summary => res.json(summary))
      .catch(summaryErr => res.status(500).json({ error: summaryErr.message }));
  });
});

app.get('/api/teacher/tests/:testId/summary', requireTeacher, (req, res) => {
  const testId = req.params.testId;
  const studentId = req.query.student_id;
  const sessionId = req.query.session_id;
  authorizeSummaryAccess(req, res, testId, studentId, sessionId, ({ studentId: authorizedStudentId, sessionId: authorizedSessionId }) => {
    buildTestSummaryForStudent(testId, authorizedStudentId, authorizedSessionId)
      .then(summary => res.json(summary))
      .catch(summaryErr => res.status(500).json({ error: summaryErr.message }));
  });
});

// Aggregated exam records (student x test)
app.get('/api/exams', requireTeacher, (req, res) => {
  const { test_id, student_id, class_id } = req.query;
  // Try to return exam_sessions rows if table exists and has data
  db.all('SELECT name FROM sqlite_master WHERE type="table" AND name="exam_sessions"', (err, rows) => {
    if(!err && rows && rows.length > 0){
      const conds = [];
      const params = [];
      conds.push('t.teacher_id=?');
      params.push(req.teacher.id);
      if(test_id){ conds.push('es.test_id=?'); params.push(test_id); }
      if(student_id){ conds.push('es.student_id=?'); params.push(student_id); }
      if(class_id){ conds.push('s.class_id=?'); params.push(class_id); }
      let sql = 'SELECT es.*, s.name as studentName, s.class_id as studentClassId, sc.name as studentClassName, s.class_id as classId, sc.name as className, t.name as testName FROM exam_sessions es LEFT JOIN students s ON s.id=es.student_id LEFT JOIN tests t ON t.id=es.test_id LEFT JOIN classes sc ON sc.id=s.class_id';
      if(conds.length) sql += ' WHERE ' + conds.join(' AND ');
      sql += ' ORDER BY es.finished_at DESC';
      db.all(sql, params, (e, sessions) => {
        if(!e && sessions && sessions.length > 0){
          const out = sessions.map(s => ({
            sessionId: s.id,
            studentId: s.student_id,
            studentName: s.studentName,
            studentClassId: s.studentClassId,
            studentClassName: s.studentClassName,
            classId: s.classId,
            className: s.className,
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
    if(class_id){ conditions.push('s.class_id=?'); params.push(class_id); }
    let sql = 'SELECT DISTINCT sa.student_id, sa.test_id FROM student_answers sa JOIN tests t ON t.id=sa.test_id JOIN students s ON s.id=sa.student_id';
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
        db.get('SELECT s.id, s.name, s.class_id as studentClassId, c.name as studentClassName FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE s.id=?', [sid], (err1, studentRow) => {
          db.get('SELECT t.id, t.name FROM tests t WHERE t.id=?', [tid], (err2, testRow) => {
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
                  results.push({ studentId: sid, studentName: studentRow?studentRow.name:null, studentClassId: studentRow?studentRow.studentClassId:null, studentClassName: studentRow?studentRow.studentClassName:null, classId: studentRow?studentRow.studentClassId:null, className: studentRow?studentRow.studentClassName:null, testId: tid, testName: testRow?testRow.name:null, score: 0, maxScore: 0, percent: 0, status: '完了', finished_at: dt });
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
                      results.push({ studentId: sid, studentName: studentRow?studentRow.name:null, studentClassId: studentRow?studentRow.studentClassId:null, studentClassName: studentRow?studentRow.studentClassName:null, classId: studentRow?studentRow.studentClassId:null, className: studentRow?studentRow.studentClassName:null, testId: tid, testName: testRow?testRow.name:null, score: earned, maxScore: total, percent: total>0 ? (earned/total*100) : 0, status: '完了', finished_at: dt });
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
  authorizeStudentTestAccess(req, res, test_id, student_id, ({ studentId: authorizedStudentId, test }) => {
    (async () => {
      const started_at = new Date().toISOString();
      try{
        await dbRunAsync('BEGIN IMMEDIATE TRANSACTION');
        const inserted = await dbRunAsync(
          'INSERT INTO exam_sessions (student_id, test_id, started_at, status) VALUES (?,?,?,?)',
          [authorizedStudentId, test_id, started_at, 'in_progress']
        );
        await storeExamSessionQuestionPlan(inserted.lastID, test_id, test && test.randomize === 1);
        await dbRunAsync('COMMIT');
        return res.json({ id: inserted.lastID, student_id: authorizedStudentId, test_id, started_at, status: 'in_progress' });
      }catch(err){
        try{
          await dbRunAsync('ROLLBACK');
        }catch(_rollbackErr){
          // surface the original error
        }
        return res.status(500).json({ error: err.message });
      }
    })();
  });
});

app.delete('/api/exam-sessions/:id', requireTeacher, (req, res) => {
  const id = req.params.id;
  ensureTeacherOwnsExamSession(req, res, id, () => {
    db.run('DELETE FROM student_answers WHERE session_id=?', [id], function(err){
      if(err) return res.status(500).json({ error: err.message });
      db.run('DELETE FROM exam_session_questions WHERE session_id=?', [id], function(planErr){
        if(planErr) return res.status(500).json({ error: planErr.message });
        db.run('DELETE FROM exam_sessions WHERE id=?', [id], function(deleteErr){
          if(deleteErr) return res.status(500).json({ error: deleteErr.message });
          res.json({ id: Number(id), deleted: true });
        });
      });
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
    authorizeStudentTestAccess(req, res, session.test_id, session.student_id, () => {
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
          db.all('SELECT * FROM student_answers WHERE session_id=? AND student_id=? AND test_id=?', [id, session.student_id, session.test_id], (err4, answers) => {
            if(err4) return res.status(500).json({ error: err4.message });
            const proceedWith = (answers && answers.length > 0) ? answers : null;
            if(!proceedWith){
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
                const given = Array.from(new Set((answersMap[q.id] || []).map(x => parseInt(x, 10))));
                if(given.length === 0) return;
                const s1 = new Set(given);
                const s2 = new Set(correctIds.map(x => parseInt(x, 10)));
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
  let content;
  try{
    content = normalizeQuestionContent(req.body || {});
  }catch(err){
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
  const vals = [content.text || text || '', type || 'single', points || 1, pub?1:0, explanation || '', content.content_html, content.content_format, id];
  db.get('SELECT t.teacher_id FROM questions q JOIN tests t ON t.id=q.test_id WHERE q.id=?', [id], (ownErr, ownRow) => {
    if(ownErr) return res.status(500).json({ error: ownErr.message });
    if(!ownRow || ownRow.teacher_id !== req.teacher.id) return res.status(404).json({ error: 'not_found' });
    db.run('UPDATE questions SET text=?, type=?, points=?, public=?, explanation=?, content_html=?, content_format=? WHERE id=?', vals, function(err){
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
