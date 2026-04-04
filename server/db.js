const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbFile = path.join(__dirname, 'data.sqlite');
const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER,
    name TEXT,
    description TEXT,
    public INTEGER DEFAULT 0,
    randomize INTEGER DEFAULT 0,
    FOREIGN KEY(class_id) REFERENCES classes(id)
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_id INTEGER,
    type TEXT,
    text TEXT,
    points INTEGER DEFAULT 1,
    public INTEGER DEFAULT 1,
    explanation TEXT DEFAULT '',
    FOREIGN KEY(test_id) REFERENCES tests(id)
  );`);

  // Ensure existing DB has 'explanation' column in questions
  db.all("PRAGMA table_info('questions')", (err, rows) => {
    if(err) return;
    const hasExplanation = rows && rows.some(r => r.name === 'explanation');
    if(!hasExplanation){
      db.run("ALTER TABLE questions ADD COLUMN explanation TEXT DEFAULT ''", (e) => {
        if(e){ console.error('Failed to add explanation column:', e.message); }
        else { console.log('Added explanation column to questions'); }
      });
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS choices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER,
    text TEXT,
    is_correct INTEGER DEFAULT 0,
    FOREIGN KEY(question_id) REFERENCES questions(id)
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER,
    name TEXT,
    code TEXT,
    FOREIGN KEY(class_id) REFERENCES classes(id)
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS student_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    test_id INTEGER,
    question_id INTEGER,
    choice_id INTEGER,
    correct INTEGER,
    FOREIGN KEY(student_id) REFERENCES students(id),
    FOREIGN KEY(test_id) REFERENCES tests(id),
    FOREIGN KEY(question_id) REFERENCES questions(id),
    FOREIGN KEY(choice_id) REFERENCES choices(id)
  );`);

  // Ensure student_answers has a session_id column for exam session linking
  db.all("PRAGMA table_info('student_answers')", (err, rows) => {
    if(err) return;
    const hasSession = rows && rows.some(r => r.name === 'session_id');
    if(!hasSession){
      db.run("ALTER TABLE student_answers ADD COLUMN session_id INTEGER", (e) => {
        if(e){ console.error('Failed to add session_id column to student_answers:', e.message); }
        else { console.log('Added session_id column to student_answers'); }
      });
    }
  });

  // Create exam_sessions table to record per-attempt metadata (start/end, duration, score)
  db.run(`CREATE TABLE IF NOT EXISTS exam_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    test_id INTEGER,
    started_at TEXT,
    finished_at TEXT,
    duration_sec INTEGER,
    score INTEGER,
    max_score INTEGER,
    percent REAL,
    status TEXT DEFAULT 'in_progress',
    FOREIGN KEY(student_id) REFERENCES students(id),
    FOREIGN KEY(test_id) REFERENCES tests(id)
  );`);
});

module.exports = db;
