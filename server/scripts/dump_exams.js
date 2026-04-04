const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbFile = path.join(__dirname, '..', 'data.sqlite');
const db = new sqlite3.Database(dbFile, sqlite3.OPEN_READONLY, (err)=>{
  if(err){ console.error('DB open error:', err.message); process.exit(1); }
});

function printRows(label, rows){
  console.log('--- ' + label + ' ---');
  if(!rows || rows.length === 0){ console.log('(no rows)'); return; }
  rows.forEach(r => console.log(JSON.stringify(r)));
}

db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='exam_sessions'", (err, rows)=>{
  if(err) return console.error('schema check error', err.message);
  console.log('exam_sessions table exists:', rows && rows.length > 0);
  db.all('PRAGMA table_info(exam_sessions)', (piErr, piRows)=>{
    if(piErr) console.error('pragma exam_sessions error', piErr.message);
    printRows('exam_sessions schema', piRows);
    db.all('PRAGMA table_info(student_answers)', (paErr, paRows)=>{
      if(paErr) console.error('pragma student_answers error', paErr.message);
      printRows('student_answers schema', paRows);
      db.all('SELECT id, student_id, test_id, started_at, finished_at, duration_sec, score, max_score, percent, status FROM exam_sessions ORDER BY id DESC LIMIT 50', (e, sessRows)=>{
        if(e) return console.error('exam_sessions query error', e.message);
        printRows('exam_sessions (latest 50)', sessRows);
        db.all('SELECT id, student_id, test_id, question_id, choice_id, session_id FROM student_answers ORDER BY id DESC LIMIT 50', (e2, ansRows)=>{
          if(e2) return console.error('student_answers query error', e2.message);
          printRows('student_answers (latest 50)', ansRows);
          db.all('SELECT id, name FROM students LIMIT 50', (e3, students)=>{ printRows('students', students || []);
            db.all('SELECT id, name FROM tests LIMIT 50', (e4, tests)=>{ printRows('tests', tests || []);
              db.close();
            });
          });
        });
      });
    });
  });
});
