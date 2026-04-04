const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbFile = path.join(__dirname, '..', 'data.sqlite');
const db = new sqlite3.Database(dbFile);

function log(...a){ console.log(...a); }

// For any exam_sessions with NULL student_id, try to assign student_id from student_answers
(function main(){
  db.all('SELECT id FROM exam_sessions WHERE student_id IS NULL', (err, rows)=>{
    if(err){ console.error('Error fetching sessions:', err.message); db.close(); return; }
    if(!rows || rows.length === 0){ log('No exam_sessions with NULL student_id found.'); db.close(); return; }
    log('Found', rows.length, 'sessions with NULL student_id');
    let pending = rows.length;
    rows.forEach(r => {
      db.get('SELECT student_id FROM student_answers WHERE session_id=? LIMIT 1', [r.id], (e, ar) => {
        if(e){ console.error('Error querying student_answers for session', r.id, e.message); pending--; if(pending===0){ log('Done'); db.close(); } return; }
        if(ar && ar.student_id){
          db.run('UPDATE exam_sessions SET student_id=? WHERE id=?', [ar.student_id, r.id], function(upErr){
            if(upErr) console.error('Failed to update session', r.id, upErr.message);
            else log('Updated session', r.id, '-> student_id', ar.student_id);
            pending--; if(pending===0){ log('Fix complete'); db.close(); }
          });
        } else {
          log('No student_answers found for session', r.id, '; leaving student_id NULL');
          pending--; if(pending===0){ log('Fix complete'); db.close(); }
        }
      });
    });
  });
})();
