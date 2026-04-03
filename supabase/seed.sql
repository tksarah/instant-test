insert into classes (id, owner_id, name, code, subject, student_count, homeroom_teacher, schedule)
values
  ('class-a1', '11111111-1111-1111-1111-111111111111', 'ClassA', 'A1', 'ITF+', 30, '伊藤 先生', '2026/04/10 4限'),
  ('class-1a', '11111111-1111-1111-1111-111111111111', '1年A組', 'ENG1A', '英語', 32, '高橋 先生', '2026/04/03 5限'),
  ('class-2b', '11111111-1111-1111-1111-111111111111', '2年B組', 'SCI2B', '理科', 28, '石田 先生', '2026/04/04 2限')
on conflict (id) do nothing;

insert into tests (
  id,
  owner_id,
  title,
  category,
  class_id,
  lesson_date,
  difficulty,
  status,
  question_type,
  choice_count,
  points_per_question,
  random_order,
  source_text
)
values (
  'present-perfect-check',
  '11111111-1111-1111-1111-111111111111',
  '現在完了の確認テスト',
  '英語',
  'class-1a',
  '2026-04-03',
  'ふつう',
  '公開中',
  '選択式',
  4,
  20,
  true,
  '今日の授業では現在完了の3用法として、継続・経験・完了を扱った。for は期間、since は起点を表し、already は肯定文、yet は否定文や疑問文で使われることを例文で確認した。現在完了は have または has と過去分詞で作る。'
)
on conflict (id) do nothing;

insert into questions (id, test_id, sort_order, prompt, choices, answer_index, explanation, enabled)
values
  ('q1', 'present-perfect-check', 1, 'I have lived in Osaka for three years. の意味として最も適切なのはどれですか。', '["大阪に3回行ったことがある。", "3年前に大阪へ引っ越した。", "3年間ずっと大阪に住んでいる。", "大阪に3年後に住む予定だ。"]', 2, 'for three years が期間を表し、現在完了の継続用法になっているため、『3年間ずっと住んでいる』が正しいです。', true),
  ('q2', 'present-perfect-check', 2, 'She has already finished her homework. に含まれる already の役割として正しいものはどれですか。', '["未来の予定を表す。", "すでに完了していることを強調する。", "疑問文で使う語である。", "継続を表す前置詞である。"]', 1, 'already は『すでに』を表し、現在完了の完了用法でよく使われます。', true),
  ('q3', 'present-perfect-check', 3, '次のうち、現在完了の経験用法の例文はどれですか。', '["I have visited Kyoto twice.", "I visited Kyoto yesterday.", "I am visiting Kyoto now.", "I will visit Kyoto tomorrow."]', 0, 'twice が経験回数を示しており、『京都を2回訪れたことがある』という経験用法です。', true),
  ('q4', 'present-perfect-check', 4, 'since 2024 を使うときの since の意味として最も近いものはどれですか。', '["期間", "起点", "回数", "目的"]', 1, 'since は『いつから』という起点を表します。', true),
  ('q5', 'present-perfect-check', 5, '次のうち、このMVPでは出題対象から外す設定になっている問題はどれですか。', '["継続用法の例文を選ぶ問題", "already の意味を問う問題", "自由記述で例文を書かせる問題", "since の意味を問う問題"]', 2, '初期MVPでは記述式を除外し、選択式のみを採用する想定です。', false)
on conflict (id) do nothing;

insert into student_attempts (id, test_id, class_code, student_name, score, correct_count, completed_at, answers, status)
values
  ('attempt-d5d257d5-293b-470d-b4b0-22e8066bfe51', 'present-perfect-check', 'A1', '体験ユーザー', 0, 0, '2026-04-03T07:15:13.007Z', '[1, 2, 3, 2]', '実施済み'),
  ('attempt-1', 'present-perfect-check', 'ENG1A', '山田 葵', 80, 4, '2026-04-03T17:42:00+09:00', '[2, 1, 0, 1]', '実施済み'),
  ('attempt-2', 'present-perfect-check', 'ENG1A', '佐藤 陽', 60, 3, '2026-04-03T17:45:00+09:00', '[2, 1, 1, 1]', '実施済み'),
  ('attempt-3', 'present-perfect-check', 'ENG1A', '木村 凛', 100, 5, '2026-04-03T17:47:00+09:00', '[2, 1, 0, 1, 2]', '実施済み'),
  ('attempt-4', 'present-perfect-check', 'ENG1A', '井上 蓮', 40, 2, '2026-04-03T17:50:00+09:00', '[1, 1, 2, 1]', '実施済み')
on conflict (id) do nothing;