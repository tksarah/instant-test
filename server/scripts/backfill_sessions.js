const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbFile = path.join(__dirname, '..', 'data.sqlite');
const db = new sqlite3.Database(dbFile);

function log(...a){ console.log(...a); }

(async function main(){
  try{
    // find distinct student_id,test_id combos from student_answers where session_id IS NULL
    db.all('SELECT DISTINCT student_id, test_id FROM student_answers WHERE session_id IS NULL', async (err, combos)=>{
      if(err) throw err;
      if(!combos || combos.length===0){ log('No combos to backfill.'); db.close(); return; }
      log('Found', combos.length, 'combos to backfill');
      for(const c of combos){
        const sid = c.student_id; const tid = c.test_id;
        // fetch questions
        const questions = await new Promise((resolve, reject)=> db.all('SELECT id, points FROM questions WHERE test_id=?', [tid], (e, rows)=> e?reject(e):resolve(rows || [])));
        const qids = (questions||[]).map(q=>q.id);
        let total = 0, earned = 0;
        if(qids.length>0){
          const choices = await new Promise((resolve, reject)=> db.all(`SELECT * FROM choices WHERE question_id IN (${qids.join(',')})`, (e, rows)=> e?reject(e):resolve(rows || [])));
          const answers = await new Promise((resolve, reject)=> db.all('SELECT * FROM student_answers WHERE student_id=? AND test_id=?', [sid, tid], (e, rows)=> e?reject(e):resolve(rows || [])));
          const choicesMap = {};
          (choices||[]).forEach(ch => { choicesMap[ch.question_id] = choicesMap[ch.question_id] || []; choicesMap[ch.question_id].push(ch); });
          const answersMap = {};
          (answers||[]).forEach(a => { answersMap[a.question_id] = answersMap[a.question_id] || []; if(a.choice_id !== null && typeof a.choice_id !== 'undefined') answersMap[a.question_id].push(a.choice_id); });
          (questions||[]).forEach(q=>{
            const correctIds = (choicesMap[q.id]||[]).filter(x=>x.is_correct==1).map(x=>x.id);
            total += q.points || 1;
            const given = Array.from(new Set((answersMap[q.id]||[]).map(x=>parseInt(x))));
            if(given.length===0) return;
            const s1 = new Set(given);
            const s2 = new Set(correctIds.map(x=>parseInt(x)));
            if(s1.size === s2.size && [...s1].every(x=>s2.has(x))) earned += q.points || 1;
          });
        }
        const percent = total>0 ? (earned/total*100) : 0;
        const now = new Date().toISOString();
        // insert exam_session (include actual student_id)
        const insertId = await new Promise((resolve, reject)=>{
          db.run('INSERT INTO exam_sessions (student_id, test_id, started_at, finished_at, duration_sec, score, max_score, percent, status) VALUES (?,?,?,?,?,?,?,?,?)', [sid, tid, null, now, null, earned, total, percent, 'completed'], function(e){ if(e) reject(e); else resolve(this.lastID); });
        });
        // update student_answers rows for that student/test that have null session_id
        await new Promise((resolve, reject)=>{
          db.run('UPDATE student_answers SET session_id=? WHERE student_id=? AND test_id=? AND (session_id IS NULL)', [insertId, sid, tid], function(e){ if(e) reject(e); else resolve(this.changes); });
        });
        log(`Backfilled session ${insertId} for student ${sid} test ${tid}: score ${earned}/${total} (${percent.toFixed(2)}%)`);
      }
      db.close();
      log('Backfill complete.');
    });
  }catch(e){ console.error('Error:', e); db.close(); }
})();
