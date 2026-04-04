const db = require('../db');

function run(){
  db.serialize(() => {
    // create a class
    db.run("INSERT INTO classes(name) VALUES(?)", ['Sample Class'], function(err){
      const classId = this.lastID;
      // create a test
      db.run("INSERT INTO tests(class_id, name, public, randomize) VALUES(?,?,?,?)", [classId, 'Sample Test', 1, 0], function(err){
        const testId = this.lastID;
        // create students
        const students = ['Alice','Bob','Carol','Dave','Eve'];
        const studentIds = [];
        const stmt = db.prepare("INSERT INTO students(class_id, name, code) VALUES(?,?,?)");
        students.forEach((name, i) => { stmt.run([classId, name, 'code'+i], function(){ studentIds.push(this.lastID); }); });
        stmt.finalize(() => {
          // insert exam_sessions spread across dates
          const now = new Date();
          const dates = [
            new Date(now.getTime() - 40*24*60*60*1000), // 40 days ago
            new Date(now.getTime() - 20*24*60*60*1000), // 20 days ago
            new Date(now.getTime() - 10*24*60*60*1000), // 10 days ago
            new Date(now.getTime() - 3*24*60*60*1000),  // 3 days ago
            now // today
          ];
          const ins = db.prepare("INSERT INTO exam_sessions(student_id,test_id,started_at,finished_at,duration_sec,score,max_score,percent,status) VALUES(?,?,?,?,?,?,?,?,?)");
          dates.forEach((d, idx) => {
            const sid = studentIds[idx % studentIds.length] || 1;
            const started = new Date(d.getTime() - 15*60*1000).toISOString();
            const finished = new Date(d.getTime()).toISOString();
            const max = 20;
            const score = Math.floor(Math.random()*max);
            const pct = Math.round((score/max)*10000)/100;
            ins.run([sid, testId, started, finished, 15*60, score, max, pct, 'finished']);
          });
          ins.finalize(() => { console.log('Sample exam_sessions inserted'); process.exit(0); });
        });
      });
    });
  });
}
run();
