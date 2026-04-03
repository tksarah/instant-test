import type { ClassRoom, InstantTest, StudentAttempt } from "@/lib/mock-data";
import {
  formatCompletedAt,
  isChoiceCount,
  isDifficulty,
  isStatus,
  normalizeAttempt,
  normalizeClassCode,
  normalizeQuestion,
  normalizeTest,
  slugify,
} from "@/lib/persistence-shared";
import type {
  CreateAttemptInput,
  CreateClassInput,
  SaveTestInput,
} from "@/lib/persistence-types";
import { prepareQuestionsForSave } from "@/lib/test-question-utils";
import {
  createSupabasePublicClient,
  createSupabaseServerClient,
  type Database,
  type SupabaseAppClient,
} from "@/lib/supabase/server";

type ClassRow = Database["public"]["Tables"]["classes"]["Row"];
type ClassInsert = Database["public"]["Tables"]["classes"]["Insert"];
type TestRow = Database["public"]["Tables"]["tests"]["Row"];
type TestInsert = Database["public"]["Tables"]["tests"]["Insert"];
type QuestionRow = Database["public"]["Tables"]["questions"]["Row"];
type QuestionInsert = Database["public"]["Tables"]["questions"]["Insert"];
type AttemptRow = Database["public"]["Tables"]["student_attempts"]["Row"];
type AttemptInsert = Database["public"]["Tables"]["student_attempts"]["Insert"];
type ClassReadRow = Omit<ClassRow, "owner_id">;
type TestReadRow = Omit<TestRow, "owner_id">;

function toErrorMessage(prefix: string, detail?: string | null) {
  return detail ? `${prefix}: ${detail}` : prefix;
}

function mapClassRow(row: ClassReadRow): ClassRoom {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    subject: row.subject,
    studentCount: row.student_count,
    homeroomTeacher: row.homeroom_teacher,
    schedule: row.schedule,
  };
}

function mapChoiceArray(value: QuestionRow["choices"]) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function mapQuestionRow(row: QuestionRow) {
  const choices = mapChoiceArray(row.choices);

  return normalizeQuestion(
    {
      id: row.id,
      prompt: row.prompt,
      choices,
      answerIndex: row.answer_index,
      explanation: row.explanation,
      enabled: row.enabled,
    },
    Math.max(0, row.sort_order - 1),
    isChoiceCount(choices.length) ? choices.length : 4,
  );
}

function mapAttemptRow(row: AttemptRow): StudentAttempt {
  const completedAtDate = new Date(row.completed_at);

  return normalizeAttempt({
    id: row.id,
    testId: row.test_id,
    classCode: row.class_code,
    studentName: row.student_name,
    score: row.score,
    correctCount: row.correct_count,
    completedAt: formatCompletedAt(completedAtDate),
    completedAtIso: row.completed_at,
    answers: Array.isArray(row.answers)
      ? row.answers.map((entry) => Number(entry))
      : [],
    status: "実施済み",
  });
}

function mapTests(rows: TestReadRow[], questionRows: QuestionRow[]): InstantTest[] {
  const groupedQuestions = new Map<string, QuestionRow[]>();

  for (const questionRow of questionRows) {
    const current = groupedQuestions.get(questionRow.test_id) ?? [];
    current.push(questionRow);
    groupedQuestions.set(questionRow.test_id, current);
  }

  return rows.map((row) => {
    const questions = (groupedQuestions.get(row.id) ?? [])
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((question) => mapQuestionRow(question));

    return normalizeTest({
      id: row.id,
      title: row.title,
      category: row.category,
      classId: row.class_id,
      date: row.lesson_date,
      difficulty: isDifficulty(row.difficulty) ? row.difficulty : "ふつう",
      status: isStatus(row.status) ? row.status : "下書き",
      questionType: "選択式",
      choiceCount: isChoiceCount(row.choice_count) ? row.choice_count : 4,
      pointsPerQuestion: row.points_per_question,
      randomOrder: row.random_order,
      sourceText: row.source_text,
      questions,
    });
  });
}

function toClassInsert(classroom: ClassRoom): ClassInsert {
  return {
    id: classroom.id,
    name: classroom.name,
    code: classroom.code,
    subject: classroom.subject,
    student_count: classroom.studentCount,
    homeroom_teacher: classroom.homeroomTeacher,
    schedule: classroom.schedule,
  };
}

function toTestInsert(test: InstantTest): TestInsert {
  return {
    id: test.id,
    title: test.title,
    category: test.category,
    class_id: test.classId,
    lesson_date: test.date,
    difficulty: test.difficulty,
    status: test.status,
    question_type: test.questionType,
    choice_count: test.choiceCount,
    points_per_question: test.pointsPerQuestion,
    random_order: test.randomOrder,
    source_text: test.sourceText,
  };
}

function toQuestionInsert(
  testId: string,
  question: InstantTest["questions"][number],
  index: number,
): QuestionInsert {
  return {
    id: question.id,
    test_id: testId,
    sort_order: index + 1,
    prompt: question.prompt,
    choices: question.choices,
    answer_index: question.answerIndex,
    explanation: question.explanation,
    enabled: question.enabled,
  };
}

function toAttemptInsert(attempt: StudentAttempt): AttemptInsert {
  return {
    id: attempt.id,
    test_id: attempt.testId,
    class_code: attempt.classCode,
    student_name: attempt.studentName,
    score: attempt.score,
    correct_count: attempt.correctCount,
    completed_at: attempt.completedAtIso ?? new Date().toISOString(),
    answers: attempt.answers ?? [],
    status: "実施済み",
  };
}

async function fetchQuestionsByTestIds(client: SupabaseAppClient, testIds: string[]) {
  if (testIds.length === 0) {
    return [] satisfies QuestionRow[];
  }

  const { data, error } = await client
    .from("questions")
    .select("id, test_id, sort_order, prompt, choices, answer_index, explanation, enabled, created_at")
    .in("test_id", testIds)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(toErrorMessage("問題データの取得に失敗しました", error.message));
  }

  return data ?? [];
}
async function findTestByIdInternal(client: SupabaseAppClient, testId: string) {
  const { data, error } = await client
    .from("tests")
    .select("id, title, category, class_id, lesson_date, difficulty, status, question_type, choice_count, points_per_question, random_order, source_text, created_at")
    .eq("id", testId)
    .maybeSingle();

  if (error) {
    throw new Error(toErrorMessage("確認テストの取得に失敗しました", error.message));
  }

  if (!data) {
    return undefined;
  }

  const questions = await fetchQuestionsByTestIds(client, [data.id]);

  return mapTests([data], questions)[0];
}

export async function listClassesSupabase() {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("classes")
    .select("id, name, code, subject, student_count, homeroom_teacher, schedule, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(toErrorMessage("クラスデータの取得に失敗しました", error.message));
  }

  return (data ?? []).map((row) => mapClassRow(row));
}

export async function getClassByIdSupabase(classId: string) {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("classes")
    .select("id, name, code, subject, student_count, homeroom_teacher, schedule, created_at")
    .eq("id", classId)
    .maybeSingle();

  if (error) {
    throw new Error(toErrorMessage("クラスの取得に失敗しました", error.message));
  }

  return data ? mapClassRow(data) : undefined;
}

export async function getClassByCodeSupabase(classCode: string) {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("classes")
    .select("id, name, code, subject, student_count, homeroom_teacher, schedule, created_at")
    .eq("code", normalizeClassCode(classCode))
    .maybeSingle();

  if (error) {
    throw new Error(toErrorMessage("クラスコードの照会に失敗しました", error.message));
  }

  return data ? mapClassRow(data) : undefined;
}

export async function listPublishedClassesPublicSupabase() {
  const client = createSupabasePublicClient();
  const { data, error } = await client
    .from("classes")
    .select("id, name, code, subject, student_count, homeroom_teacher, schedule, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(toErrorMessage("公開クラスの取得に失敗しました", error.message));
  }

  return (data ?? []).map((row) => mapClassRow(row));
}

export async function getClassByCodePublicSupabase(classCode: string) {
  const client = createSupabasePublicClient();
  const { data, error } = await client
    .from("classes")
    .select("id, name, code, subject, student_count, homeroom_teacher, schedule, created_at")
    .eq("code", normalizeClassCode(classCode))
    .maybeSingle();

  if (error) {
    throw new Error(toErrorMessage("公開クラスコードの照会に失敗しました", error.message));
  }

  return data ? mapClassRow(data) : undefined;
}

export async function createClassSupabase(input: CreateClassInput) {
  const code = normalizeClassCode(input.code);

  if (!input.name.trim()) {
    throw new Error("クラス名を入力してください。");
  }

  if (!code) {
    throw new Error("クラスコードを入力してください。");
  }

  const client = await createSupabaseServerClient();
  const classroom: ClassRoom = {
    id: `class-${slugify(code) || crypto.randomUUID()}`,
    name: input.name.trim(),
    code,
    subject: input.subject.trim(),
    studentCount: Math.max(0, Number(input.studentCount) || 0),
    homeroomTeacher: input.homeroomTeacher.trim(),
    schedule: input.schedule.trim(),
  };

  const { data, error } = await client
    .from("classes")
    .insert(toClassInsert(classroom))
    .select("id, name, code, subject, student_count, homeroom_teacher, schedule, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("同じクラスコードが既に登録されています。");
    }

    throw new Error(toErrorMessage("クラスの保存に失敗しました", error.message));
  }

  return mapClassRow(data);
}

export async function listTestsSupabase() {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("tests")
    .select("id, title, category, class_id, lesson_date, difficulty, status, question_type, choice_count, points_per_question, random_order, source_text, created_at")
    .order("lesson_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(toErrorMessage("テストデータの取得に失敗しました", error.message));
  }

  const testRows = data ?? [];
  const questions = await fetchQuestionsByTestIds(
    client,
    testRows.map((row) => row.id),
  );

  return mapTests(testRows, questions);
}

export async function getTestByIdSupabase(testId: string) {
  const client = await createSupabaseServerClient();

  return findTestByIdInternal(client, testId);
}

export async function listPublishedTestsPublicSupabase() {
  const client = createSupabasePublicClient();
  const { data, error } = await client
    .from("tests")
    .select("id, title, category, class_id, lesson_date, difficulty, status, question_type, choice_count, points_per_question, random_order, source_text, created_at")
    .eq("status", "公開中")
    .order("lesson_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(toErrorMessage("公開テストの取得に失敗しました", error.message));
  }

  const testRows = data ?? [];
  const questions = await fetchQuestionsByTestIds(
    client,
    testRows.map((row) => row.id),
  );

  return mapTests(testRows, questions);
}

export async function getPublishedTestByIdPublicSupabase(testId: string) {
  const client = createSupabasePublicClient();
  const { data, error } = await client
    .from("tests")
    .select("id, title, category, class_id, lesson_date, difficulty, status, question_type, choice_count, points_per_question, random_order, source_text, created_at")
    .eq("id", testId)
    .eq("status", "公開中")
    .maybeSingle();

  if (error) {
    throw new Error(toErrorMessage("公開テストの取得に失敗しました", error.message));
  }

  if (!data) {
    return undefined;
  }

  const questions = await fetchQuestionsByTestIds(client, [data.id]);

  return mapTests([data], questions)[0];
}

export async function saveTestSupabase(input: SaveTestInput) {
  if (!input.title.trim()) {
    throw new Error("テストタイトルを入力してください。");
  }

  if (!input.classId.trim()) {
    throw new Error("紐づけるクラスを選択してください。");
  }

  const client = await createSupabaseServerClient();
  const { data: classRow, error: classError } = await client
    .from("classes")
    .select("id")
    .eq("id", input.classId)
    .maybeSingle();

  if (classError) {
    throw new Error(toErrorMessage("クラスの確認に失敗しました", classError.message));
  }

  if (!classRow) {
    throw new Error("指定されたクラスが見つかりません。");
  }

  const existingTest = input.id
    ? await findTestByIdInternal(client, input.id)
    : undefined;
  const safeChoiceCount = isChoiceCount(input.choiceCount)
    ? input.choiceCount
    : existingTest?.choiceCount ?? 4;
  const safeQuestions = prepareQuestionsForSave(input.questions, safeChoiceCount);

  if (safeQuestions.length === 0) {
    throw new Error("少なくとも1問は問題を作成してください。");
  }

  const nextTest: InstantTest = {
    id:
      input.id?.trim() ||
      `${slugify(input.title) || "instant-test"}-${Date.now().toString(36)}`,
    title: input.title.trim(),
    category: input.category.trim(),
    classId: input.classId,
    date: input.date,
    difficulty: isDifficulty(input.difficulty)
      ? input.difficulty
      : existingTest?.difficulty ?? "ふつう",
    status: isStatus(input.status) ? input.status : existingTest?.status ?? "下書き",
    questionType: "選択式",
    choiceCount: safeChoiceCount,
    pointsPerQuestion: Math.max(1, Number(input.pointsPerQuestion) || 1),
    randomOrder: Boolean(input.randomOrder),
    sourceText: input.sourceText.trim(),
    questions: safeQuestions,
  };

  const { error: testUpsertError } = await client
    .from("tests")
    .upsert(toTestInsert(nextTest), { onConflict: "id" });

  if (testUpsertError) {
    throw new Error(toErrorMessage("確認テストの保存に失敗しました", testUpsertError.message));
  }

  const { error: deleteError } = await client
    .from("questions")
    .delete()
    .eq("test_id", nextTest.id);

  if (deleteError) {
    throw new Error(toErrorMessage("既存問題の更新に失敗しました", deleteError.message));
  }

  if (nextTest.questions.length > 0) {
    const { error: insertError } = await client.from("questions").insert(
      nextTest.questions.map((question, index) =>
        toQuestionInsert(nextTest.id, question, index),
      ),
    );

    if (insertError) {
      throw new Error(toErrorMessage("問題データの保存に失敗しました", insertError.message));
    }
  }

  return nextTest;
}

export async function listAttemptsSupabase() {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("student_attempts")
    .select("id, test_id, class_code, student_name, score, correct_count, completed_at, answers, status, created_at")
    .order("completed_at", { ascending: false });

  if (error) {
    throw new Error(toErrorMessage("受験結果の取得に失敗しました", error.message));
  }

  return (data ?? []).map((row) => mapAttemptRow(row));
}

export async function listAttemptsForTestSupabase(testId: string) {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("student_attempts")
    .select("id, test_id, class_code, student_name, score, correct_count, completed_at, answers, status, created_at")
    .eq("test_id", testId)
    .order("completed_at", { ascending: false });

  if (error) {
    throw new Error(toErrorMessage("受験結果の取得に失敗しました", error.message));
  }

  return (data ?? []).map((row) => mapAttemptRow(row));
}

export async function getPublicTestStatsSupabase(testId: string) {
  const client = createSupabasePublicClient();
  const { data, error } = await client.rpc("get_public_test_stats", {
    target_test_id: testId,
  });

  if (error) {
    throw new Error(toErrorMessage("公開テスト集計の取得に失敗しました", error.message));
  }

  const stats = data?.[0];

  return {
    participantCount: stats?.participant_count ?? 0,
    average: stats?.average_score ?? 0,
    highest: stats?.highest_score ?? 0,
    lowest: stats?.lowest_score ?? 0,
  };
}

export async function createPublicAttemptSupabase(input: CreateAttemptInput) {
  const normalizedClassCode = normalizeClassCode(input.classCode);
  const studentName = input.studentName.trim();

  if (!studentName) {
    throw new Error("学生名を入力してください。");
  }

  const client = createSupabasePublicClient();
  const { data: classRow, error: classError } = await client
    .from("classes")
    .select("id")
    .eq("code", normalizedClassCode)
    .maybeSingle();

  if (classError) {
    throw new Error(toErrorMessage("クラスコードの確認に失敗しました", classError.message));
  }

  if (!classRow) {
    throw new Error("クラスコードが見つかりません。");
  }

  const { data: testRow, error: testError } = await client
    .from("tests")
    .select("id, class_id")
    .eq("id", input.testId)
    .eq("status", "公開中")
    .maybeSingle();

  if (testError) {
    throw new Error(toErrorMessage("確認テストの確認に失敗しました", testError.message));
  }

  if (!testRow) {
    throw new Error("対象の確認テストが見つかりません。");
  }

  if (testRow.class_id !== classRow.id) {
    throw new Error("クラスコードと確認テストの組み合わせが一致しません。");
  }

  const now = new Date();
  const attempt: StudentAttempt = {
    id: `attempt-${crypto.randomUUID()}`,
    testId: input.testId,
    classCode: normalizedClassCode,
    studentName,
    score: Math.max(0, Number(input.score) || 0),
    correctCount: Math.max(0, Number(input.correctCount) || 0),
    completedAt: formatCompletedAt(now),
    completedAtIso: now.toISOString(),
    answers: input.answers,
    status: "実施済み",
  };

  const { data, error } = await client
    .from("student_attempts")
    .insert(toAttemptInsert(attempt))
    .select("id, test_id, class_code, student_name, score, correct_count, completed_at, answers, status, created_at")
    .single();

  if (error) {
    throw new Error(toErrorMessage("受験結果の保存に失敗しました", error.message));
  }

  return mapAttemptRow(data);
}