create table if not exists classes (
  id text primary key,
  name text not null,
  code text not null unique,
  subject text not null,
  student_count integer not null default 0,
  homeroom_teacher text not null,
  schedule text not null,
  created_at timestamptz not null default now()
);

create table if not exists tests (
  id text primary key,
  title text not null,
  category text not null,
  class_id text not null references classes (id) on delete cascade,
  lesson_date date not null,
  difficulty text not null check (difficulty in ('やさしい', 'ふつう', '難しい')),
  status text not null check (status in ('公開中', '下書き', '非公開')),
  question_type text not null check (question_type in ('選択式')),
  choice_count integer not null check (choice_count between 2 and 4),
  points_per_question integer not null default 10,
  random_order boolean not null default false,
  source_text text not null,
  created_at timestamptz not null default now()
);

create table if not exists questions (
  id text primary key,
  test_id text not null references tests (id) on delete cascade,
  sort_order integer not null,
  prompt text not null,
  choices jsonb not null,
  answer_index integer not null,
  explanation text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists student_attempts (
  id text primary key,
  test_id text not null references tests (id) on delete cascade,
  class_code text not null,
  student_name text not null,
  score integer not null default 0,
  correct_count integer not null default 0,
  completed_at timestamptz not null default now(),
  answers jsonb,
  status text not null default '実施済み',
  created_at timestamptz not null default now()
);