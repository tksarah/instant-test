const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const mockAi = require('./mockAi');
const QRCode = require('qrcode');
const util = require('util');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/vendor', express.static(path.join(__dirname, 'node_modules')));
app.use(express.static(path.join(__dirname, 'public')));

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
app.post('/api/classes', (req, res) => {
  const { name } = req.body;
  db.run('INSERT INTO classes (name) VALUES (?)', [name], function(err){
    if(err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, name });
  });
});
app.get('/api/classes', (req, res) => {
  db.all('SELECT * FROM classes', (err, rows) => {
    if(err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Update a class (name)
app.put('/api/classes/:id', (req, res) => {
  const id = req.params.id;
  const { name } = req.body;
  if(!name) return res.status(400).json({ error: 'name required' });
  db.run('UPDATE classes SET name=? WHERE id=?', [name, id], function(err){
    if(err) return res.status(500).json({ error: err.message });
    db.get('SELECT * FROM classes WHERE id=?', [id], (e, row) => {
      if(e) return res.status(500).json({ error: e.message });
      res.json(row);
    });
  });
});

// Delete a class (optional cascade)
app.delete('/api/classes/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT (SELECT COUNT(*) FROM tests WHERE class_id=?) AS tests, (SELECT COUNT(*) FROM students WHERE class_id=?) AS students', [id, id], (err, row) => {
    if(err) return res.status(500).json({ error: err.message });
    const hasDeps = row && (row.tests > 0 || row.students > 0);
    if(hasDeps && req.query.cascade !== '1'){
      return res.status(400).json({ error: 'has_dependencies', tests: row.tests, students: row.students });
    }
    if(hasDeps && req.query.cascade === '1'){
      // cascade delete related data
      db.run('DELETE FROM student_answers WHERE test_id IN (SELECT id FROM tests WHERE class_id=?)', [id], function(err2){
        if(err2) return res.status(500).json({ error: err2.message });
        db.run('DELETE FROM choices WHERE question_id IN (SELECT id FROM questions WHERE test_id IN (SELECT id FROM tests WHERE class_id=?))', [id], function(err3){
          if(err3) return res.status(500).json({ error: err3.message });
          db.run('DELETE FROM questions WHERE test_id IN (SELECT id FROM tests WHERE class_id=?)', [id], function(err4){
            if(err4) return res.status(500).json({ error: err4.message });
            db.run('DELETE FROM tests WHERE class_id=?', [id], function(err5){
              if(err5) return res.status(500).json({ error: err5.message });
              db.run('DELETE FROM students WHERE class_id=?', [id], function(err6){
                if(err6) return res.status(500).json({ error: err6.message });
                db.run('DELETE FROM classes WHERE id=?', [id], function(err7){
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
      db.run('DELETE FROM classes WHERE id=?', [id], function(err2){
        if(err2) return res.status(500).json({ error: err2.message });
        db.run('UPDATE tests SET class_id=NULL WHERE class_id=?', [id], function(err3){
          res.json({ id: id, deleted: true });
        });
      });
    }
  });
});

// Tests
app.post('/api/tests', (req, res) => {
  const { class_id, name, description, public: pub, randomize } = req.body;
  db.run('INSERT INTO tests (class_id, name, description, public, randomize) VALUES (?,?,?,?,?)', [class_id||null, name, description||'', pub?1:0, randomize?1:0], function(err){
    if(err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});
app.get('/api/tests', (req, res) => {
  const { class_id, public: pub } = req.query;
  let sql = 'SELECT * FROM tests';
  const params = [];
  const conditions = [];
  if(class_id){ conditions.push('class_id=?'); params.push(class_id); }
  if(typeof pub !== 'undefined'){
    conditions.push('public=?'); params.push(pub==1 || pub==='1' ? 1 : 0);
  }
  if(conditions.length > 0){ sql += ' WHERE ' + conditions.join(' AND '); }
  db.all(sql, params, (err, rows) => {
    if(err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Update a test (name, description, public, randomize)
app.put('/api/tests/:id', (req, res) => {
  const id = req.params.id;
  const { name, description, public: pub, randomize, class_id } = req.body;
  // Build update dynamically so that if `class_id` is undefined we don't overwrite it
  const fields = ['name=?', 'description=?', 'public=?', 'randomize=?'];
  const vals = [name, description||'', pub?1:0, randomize?1:0];
  if(typeof class_id !== 'undefined'){
    fields.push('class_id=?');
    vals.push(class_id);
  }
  const updateSql = `UPDATE tests SET ${fields.join(', ')} WHERE id=?`;
  vals.push(id);
  db.run(updateSql, vals, function(err){
    if(err) return res.status(500).json({ error: err.message });
    db.get('SELECT * FROM tests WHERE id=?', [id], (e, row) => {
      if(e) return res.status(500).json({ error: e.message });
      res.json(row);
    });
  });
});

// Delete a test (optional cascade deletes related questions, choices, and student_answers)
app.delete('/api/tests/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT (SELECT COUNT(*) FROM questions WHERE test_id=?) AS questions, (SELECT COUNT(*) FROM student_answers WHERE test_id=?) AS answers', [id, id], (err, row) => {
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
            db.run('DELETE FROM tests WHERE id=?', [id], function(err5){
              if(err5) return res.status(500).json({ error: err5.message });
              res.json({ id: id, deleted: true, cascade: true });
            });
          });
        });
      });
    } else {
      // no dependencies - safe to delete
      db.run('DELETE FROM tests WHERE id=?', [id], function(err2){
        if(err2) return res.status(500).json({ error: err2.message });
        res.json({ id: id, deleted: true });
      });
    }
  });
});

// Questions
app.post('/api/tests/:testId/questions', (req, res) => {
  const testId = req.params.testId;
  const { type, text, points, choices } = req.body;
  db.run('INSERT INTO questions (test_id, type, text, points) VALUES (?,?,?,?)', [testId, type||'single', text, points||1], function(err){
    if(err) return res.status(500).json({ error: err.message });
    const questionId = this.lastID;
    if(!choices || choices.length === 0) return res.json({ id: questionId });
    const stmt = db.prepare('INSERT INTO choices (question_id, text, is_correct) VALUES (?,?,?)');
    choices.forEach(c => stmt.run(questionId, c.text, c.is_correct?1:0));
    stmt.finalize(() => res.json({ id: questionId }));
  });
});

app.get('/api/tests/:testId/questions', (req, res) => {
  const testId = req.params.testId;
  // check test's randomize flag, then fetch questions
  db.get('SELECT * FROM tests WHERE id=?', [testId], (errt, testRow) => {
    if(errt) return res.status(500).json({ error: errt.message });
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
          // helper shuffle
          const shuffle = arr => {
            for(let i = arr.length - 1; i > 0; i--){
              const j = Math.floor(Math.random() * (i + 1));
              const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
            }
          };
          // shuffle choices within each question
          out.forEach(q => { if(q.choices && q.choices.length > 1) shuffle(q.choices); });
          // shuffle question order
          shuffle(out);
        }
        res.json(out);
    });
  });
  });
});

// AI generate (mock)
app.post('/api/generate-questions', (req, res) => {
  const { testId, text } = req.body;
  if(!testId || !text) return res.status(400).json({ error: 'testId and text required' });
  const generated = mockAi.generateQuestions(text);
  const results = [];
  const insertQuestion = (q, cb) => {
    db.run('INSERT INTO questions (test_id, type, text, points) VALUES (?,?,?,?)', [testId, q.type, q.text, q.points||1], function(err){
      if(err) return cb(err);
      const qid = this.lastID;
      const stmt = db.prepare('INSERT INTO choices (question_id, text, is_correct) VALUES (?,?,?)');
      q.choices.forEach(c => stmt.run(qid, c.text, c.is_correct?1:0));
      stmt.finalize(() => cb(null, { id: qid, ...q }));
    });
  };
  (function next(i){ if(i>=generated.length) return res.json(results); insertQuestion(generated[i], (err, row)=>{ if(err) return res.status(500).json({ error: err.message }); results.push(row); next(i+1); }); })(0);
});

// Students: create/login
app.post('/api/students', (req, res) => {
  const { class_id, class_name, name } = req.body;
  if(!name) return res.status(400).json({ error: 'name required' });
  const findClass = (cb) => {
    if(class_id){ db.get('SELECT * FROM classes WHERE id=?', [class_id], cb); }
    else if(class_name){ db.get('SELECT * FROM classes WHERE name=?', [class_name], cb); }
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
  // fetch questions and choices
  db.all('SELECT * FROM questions WHERE test_id=?', [testId], (err, questions)=>{
    if(err) return res.status(500).json({ error: err.message });
    const qids = questions.map(q=>q.id);
    if(qids.length === 0) return res.json({ total_points: 0, earned_points: 0, details: [] });
    db.all(`SELECT * FROM choices WHERE question_id IN (${qids.join(',')})`, (err2, choices)=>{
      if(err2) return res.status(500).json({ error: err2.message });
      const choicesMap = {};
      choices.forEach(c=>{ choicesMap[c.question_id] = choicesMap[c.question_id] || []; choicesMap[c.question_id].push(c); });
      // fetch student's answers (optionally filter by session_id)
      const answersSql = sessionId ? 'SELECT * FROM student_answers WHERE session_id=?' : 'SELECT * FROM student_answers WHERE student_id=? AND test_id=?';
      const answersParams = sessionId ? [sessionId] : [studentId, testId];
      db.all(answersSql, answersParams, (err3, answers)=>{
        if(err3) return res.status(500).json({ error: err3.message });
        const answersMap = {};
        (answers||[]).forEach(a=>{ answersMap[a.question_id] = answersMap[a.question_id] || []; answersMap[a.question_id].push(a); });
        // build details
        let total = 0;
        let earned = 0;
        const details = questions.map(q=>{
          const qChoices = choicesMap[q.id] || [];
          const correctIds = qChoices.filter(c=>c.is_correct===1 || c.is_correct===true).map(c=>c.id);
          // student submitted choice ids for this question
          const given = (answersMap[q.id] || []).map(a=>a.choice_id).filter(x=>x!==null && typeof x !== 'undefined');
          const uniqueGiven = Array.from(new Set(given));
          // scoring: full points if set matches
          const qTotal = q.points || 1;
          total += qTotal;
          let correct = false;
          if(uniqueGiven.length === 0) correct = false;
          else {
            const s1 = new Set(uniqueGiven.map(x=>parseInt(x)));
            const s2 = new Set(correctIds.map(x=>parseInt(x)));
            if(s1.size === s2.size && [...s1].every(x => s2.has(x))) correct = true;
          }
          if(correct) earned += qTotal;
          return { question_id: q.id, text: q.text, points: qTotal, correct, given_choice_ids: uniqueGiven, correct_choice_ids: correctIds };
        });
        res.json({ total_points: total, earned_points: earned, details });
      });
    });
  });
});

// Aggregated exam records (student x test)
app.get('/api/exams', (req, res) => {
  const { test_id, student_id } = req.query;
  // Try to return exam_sessions rows if table exists and has data
  db.all('SELECT name FROM sqlite_master WHERE type="table" AND name="exam_sessions"', (err, rows) => {
    if(!err && rows && rows.length > 0){
      const conds = [];
      const params = [];
      if(test_id){ conds.push('es.test_id=?'); params.push(test_id); }
      if(student_id){ conds.push('es.student_id=?'); params.push(student_id); }
      let sql = 'SELECT es.*, s.name as studentName, t.name as testName FROM exam_sessions es LEFT JOIN students s ON s.id=es.student_id LEFT JOIN tests t ON t.id=es.test_id';
      if(conds.length) sql += ' WHERE ' + conds.join(' AND ');
      sql += ' ORDER BY es.finished_at DESC';
      db.all(sql, params, (e, sessions) => {
        if(!e && sessions && sessions.length > 0){
          const out = sessions.map(s => ({
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
    const conditions = [];
    const params = [];
    if(test_id){ conditions.push('test_id=?'); params.push(test_id); }
    if(student_id){ conditions.push('student_id=?'); params.push(student_id); }
    let sql = 'SELECT DISTINCT student_id, test_id FROM student_answers';
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
  const started_at = new Date().toISOString();
  db.run('INSERT INTO exam_sessions (student_id, test_id, started_at, status) VALUES (?,?,?,?)', [student_id, test_id, started_at, 'in_progress'], function(err){
    if(err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, student_id, test_id, started_at, status: 'in_progress' });
  });
});

// Finish an exam session: compute score from answers linked to session_id (fallback to student/test answers)
app.put('/api/exam-sessions/:id/finish', (req, res) => {
  const id = req.params.id;
  const finished_at = new Date().toISOString();
  db.get('SELECT * FROM exam_sessions WHERE id=?', [id], (err, session) => {
    if(err) return res.status(500).json({ error: err.message });
    if(!session) return res.status(404).json({ error: 'session_not_found' });
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

// Update a question
app.put('/api/questions/:id', (req, res) => {
  const id = req.params.id;
  const { text, type, points, public: pub, explanation } = req.body;
  const vals = [text, type || 'single', points || 1, pub?1:0, explanation || '', id];
  db.run('UPDATE questions SET text=?, type=?, points=?, public=?, explanation=? WHERE id=?', vals, function(err){
    if(err) return res.status(500).json({ error: err.message });
    res.json({ id });
  });
});

// Update a choice
app.put('/api/choices/:id', (req, res) => {
  const id = req.params.id;
  const { text, is_correct } = req.body;
  db.run('UPDATE choices SET text=?, is_correct=? WHERE id=?', [text, is_correct?1:0, id], function(err){
    if(err) return res.status(500).json({ error: err.message });
    res.json({ id });
  });
});

// Add a new choice to a question
app.post('/api/questions/:id/choices', (req, res) => {
  const questionId = req.params.id;
  const { text, is_correct } = req.body;
  db.run('INSERT INTO choices (question_id, text, is_correct) VALUES (?,?,?)', [questionId, text, is_correct?1:0], function(err){
    if(err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});

// Fallback to frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`InstantTest server listening on ${port}`));
