const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbFile = path.join(__dirname, '..', 'data.sqlite');
console.log('Opening DB:', dbFile);
const db = new sqlite3.Database(dbFile, (err) => {
  if(err){ console.error('DB open error:', err.message); process.exit(1); }
  doClear();
});
function doClear(){
  db.serialize(() => {
    console.log('Disabling foreign_keys');
    db.run('PRAGMA foreign_keys = OFF;');
    db.run('DELETE FROM student_answers;', function(err){ if(err) console.error('student_answers delete error:', err.message); else console.log('student_answers cleared, rows affected:', this.changes); });
    db.run('DELETE FROM exam_sessions;', function(err){ if(err) console.error('exam_sessions delete error:', err.message); else console.log('exam_sessions cleared, rows affected:', this.changes); });
    db.run("DELETE FROM sqlite_sequence WHERE name='student_answers' OR name='exam_sessions';", function(err){ if(err) { /* ignore */ } else { console.log('sqlite_sequence entries cleared (if existed)'); } });
    db.run('PRAGMA foreign_keys = ON;');
    db.run('VACUUM;', function(err){ if(err) console.error('VACUUM error:', err.message); else console.log('VACUUM completed'); db.close(); });
  });
}
