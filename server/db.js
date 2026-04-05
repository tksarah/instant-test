const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbFile = path.join(__dirname, 'data.sqlite');
const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT DEFAULT '',
    password_hash TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS teacher_sessions (
    token TEXT PRIMARY KEY,
    teacher_id INTEGER NOT NULL,
    created_at TEXT,
    last_seen_at TEXT,
    expires_at TEXT,
    FOREIGN KEY(teacher_id) REFERENCES teachers(id)
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER,
    name TEXT NOT NULL
  );`);

  // Ensure existing DB has 'teacher_id' column in classes
  db.all("PRAGMA table_info('classes')", (err, rows) => {
    if(err) return;
    const hasTeacher = rows && rows.some(r => r.name === 'teacher_id');
    if(!hasTeacher){
      db.run('ALTER TABLE classes ADD COLUMN teacher_id INTEGER', (e) => {
        if(e){ console.error('Failed to add teacher_id column to classes:', e.message); }
        else { console.log('Added teacher_id column to classes'); }
      });
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER,
    class_id INTEGER,
    name TEXT,
    description TEXT,
    public INTEGER DEFAULT 0,
    randomize INTEGER DEFAULT 0,
    FOREIGN KEY(class_id) REFERENCES classes(id)
  );`);

  // Ensure existing DB has 'teacher_id' column in tests
  db.all("PRAGMA table_info('tests')", (err, rows) => {
    if(err) return;
    const hasTeacher = rows && rows.some(r => r.name === 'teacher_id');
    if(!hasTeacher){
      db.run('ALTER TABLE tests ADD COLUMN teacher_id INTEGER', (e) => {
        if(e){ console.error('Failed to add teacher_id column to tests:', e.message); }
        else { console.log('Added teacher_id column to tests'); }
      });
    }
  });

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
