import { promises as fs } from "node:fs";
import path from "node:path";

import type { ClassRoom, InstantTest, StudentAttempt } from "@/lib/mock-data";
import {
  createEmptyStore,
  formatCompletedAt,
  isChoiceCount,
  isDifficulty,
  isStatus,
  normalizeAttempt,
  normalizeClassCode,
  normalizeTest,
  slugify,
} from "@/lib/persistence-shared";
import type {
  CreateAttemptInput,
  CreateClassInput,
  PersistedStore,
  SaveTestInput,
} from "@/lib/persistence-types";
import { prepareQuestionsForSave } from "@/lib/test-question-utils";

const storeFilePath = path.join(process.cwd(), "data", "instant-test-db.json");

let writeQueue: Promise<void> = Promise.resolve();

async function ensureStoreFile() {
  try {
    await fs.access(storeFilePath);
  } catch {
    await fs.mkdir(path.dirname(storeFilePath), { recursive: true });
    await fs.writeFile(
      storeFilePath,
      `${JSON.stringify(createEmptyStore(), null, 2)}\n`,
      "utf8",
    );
  }
}

async function readLocalStore(): Promise<PersistedStore> {
  await ensureStoreFile();

  const raw = await fs.readFile(storeFilePath, "utf8");
  const parsed = JSON.parse(raw) as Partial<PersistedStore>;

  return {
    classes: parsed.classes ?? [],
    tests: (parsed.tests ?? []).map((entry) => normalizeTest(entry)),
    studentAttempts: (parsed.studentAttempts ?? []).map((entry) =>
      normalizeAttempt(entry),
    ),
  };
}

async function writeLocalStore(store: PersistedStore) {
  await fs.writeFile(storeFilePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function updateLocalStore<T>(
  mutator: (store: PersistedStore) => T | Promise<T>,
): Promise<T> {
  const work = writeQueue.then(async () => {
    const currentStore = await readLocalStore();
    const result = await mutator(currentStore);
    await writeLocalStore(currentStore);
    return result;
  });

  writeQueue = work.then(
    () => undefined,
    () => undefined,
  );

  return work;
}

export async function readLocalStoreSnapshot() {
  return readLocalStore();
}

export async function listClassesLocal() {
  const store = await readLocalStore();

  return store.classes;
}

export async function getClassByIdLocal(classId: string) {
  const store = await readLocalStore();

  return store.classes.find((entry) => entry.id === classId);
}

export async function getClassByCodeLocal(classCode: string) {
  const store = await readLocalStore();

  return store.classes.find(
    (entry) => entry.code === normalizeClassCode(classCode),
  );
}

export async function listPublishedClassesLocal() {
  const store = await readLocalStore();
  const publishedClassIds = new Set(
    store.tests
      .filter((entry) => entry.status === "公開中")
      .map((entry) => entry.classId),
  );

  return store.classes.filter((entry) => publishedClassIds.has(entry.id));
}

export async function getClassByCodePublicLocal(classCode: string) {
  const classes = await listPublishedClassesLocal();

  return classes.find((entry) => entry.code === normalizeClassCode(classCode));
}

export async function createClassLocal(input: CreateClassInput) {
  const code = normalizeClassCode(input.code);

  if (!input.name.trim()) {
    throw new Error("クラス名を入力してください。");
  }

  if (!code) {
    throw new Error("クラスコードを入力してください。");
  }

  return updateLocalStore((store) => {
    const duplicate = store.classes.find((entry) => entry.code === code);

    if (duplicate) {
      throw new Error("同じクラスコードが既に登録されています。");
    }

    const classroom: ClassRoom = {
      id: `class-${slugify(code) || crypto.randomUUID()}`,
      name: input.name.trim(),
      code,
      subject: input.subject.trim(),
      studentCount: Math.max(0, Number(input.studentCount) || 0),
      homeroomTeacher: input.homeroomTeacher.trim(),
      schedule: input.schedule.trim(),
    };

    store.classes.unshift(classroom);

    return classroom;
  });
}

export async function listTestsLocal() {
  const store = await readLocalStore();

  return store.tests;
}

export async function getTestByIdLocal(testId: string) {
  const store = await readLocalStore();

  return store.tests.find((entry) => entry.id === testId);
}

export async function listPublishedTestsLocal() {
  const store = await readLocalStore();

  return store.tests.filter((entry) => entry.status === "公開中");
}

export async function getPublishedTestByIdLocal(testId: string) {
  const store = await readLocalStore();

  return store.tests.find(
    (entry) => entry.id === testId && entry.status === "公開中",
  );
}

export async function saveTestLocal(input: SaveTestInput) {
  if (!input.title.trim()) {
    throw new Error("テストタイトルを入力してください。");
  }

  if (!input.classId.trim()) {
    throw new Error("紐づけるクラスを選択してください。");
  }

  return updateLocalStore((store) => {
    const classroom = store.classes.find((entry) => entry.id === input.classId);

    if (!classroom) {
      throw new Error("指定されたクラスが見つかりません。");
    }

    const existingTest = input.id
      ? store.tests.find((entry) => entry.id === input.id)
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
      classId: classroom.id,
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

    const existingIndex = store.tests.findIndex((entry) => entry.id === nextTest.id);

    if (existingIndex >= 0) {
      store.tests[existingIndex] = nextTest;
    } else {
      store.tests.unshift(nextTest);
    }

    return nextTest;
  });
}

export async function listAttemptsLocal() {
  const store = await readLocalStore();

  return store.studentAttempts;
}

export async function listAttemptsForTestLocal(testId: string) {
  const store = await readLocalStore();

  return store.studentAttempts.filter((entry) => entry.testId === testId);
}

export async function getPublicTestStatsLocal(testId: string) {
  const attempts = await listAttemptsForTestLocal(testId);
  const scores = attempts.map((entry) => entry.score);

  if (scores.length === 0) {
    return {
      participantCount: 0,
      average: 0,
      highest: 0,
      lowest: 0,
    };
  }

  const total = scores.reduce((sum, score) => sum + score, 0);

  return {
    participantCount: scores.length,
    average: Math.round(total / scores.length),
    highest: Math.max(...scores),
    lowest: Math.min(...scores),
  };
}

export async function createAttemptLocal(input: CreateAttemptInput) {
  const normalizedClassCode = normalizeClassCode(input.classCode);
  const studentName = input.studentName.trim();

  if (!studentName) {
    throw new Error("学生名を入力してください。");
  }

  return updateLocalStore((store) => {
    const test = store.tests.find((entry) => entry.id === input.testId);

    if (!test) {
      throw new Error("対象の確認テストが見つかりません。");
    }

    const classroom = store.classes.find((entry) => entry.code === normalizedClassCode);

    if (!classroom) {
      throw new Error("クラスコードが見つかりません。");
    }

    const now = new Date();
    const attempt: StudentAttempt = {
      id: `attempt-${crypto.randomUUID()}`,
      testId: test.id,
      classCode: normalizedClassCode,
      studentName,
      score: Math.max(0, Number(input.score) || 0),
      correctCount: Math.max(0, Number(input.correctCount) || 0),
      completedAt: formatCompletedAt(now),
      completedAtIso: now.toISOString(),
      answers: input.answers,
      status: "実施済み",
    };

    store.studentAttempts.unshift(attempt);

    return attempt;
  });
}