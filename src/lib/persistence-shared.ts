import {
  classes as seedClasses,
  studentAttempts as seedAttempts,
  tests as seedTests,
} from "@/lib/mock-data";
import type { InstantTest, StudentAttempt } from "@/lib/mock-data";
import type { PersistedStore } from "@/lib/persistence-types";

const difficultyOptions = ["やさしい", "ふつう", "難しい"] as const;
const statusOptions = ["公開中", "下書き", "非公開"] as const;
const choiceCountOptions = [2, 3, 4] as const;

export const defaultStore: PersistedStore = {
  classes: seedClasses,
  tests: seedTests,
  studentAttempts: seedAttempts,
};

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createEmptyStore(): PersistedStore {
  return cloneValue(defaultStore);
}

export function normalizeClassCode(value: string) {
  return value.trim().toUpperCase();
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

export function formatCompletedAt(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function isDifficulty(value: string): value is InstantTest["difficulty"] {
  return difficultyOptions.includes(value as InstantTest["difficulty"]);
}

export function isStatus(value: string): value is InstantTest["status"] {
  return statusOptions.includes(value as InstantTest["status"]);
}

export function isChoiceCount(value: number): value is InstantTest["choiceCount"] {
  return choiceCountOptions.includes(value as InstantTest["choiceCount"]);
}

export function normalizeQuestion(
  question: InstantTest["questions"][number],
  index: number,
  choiceCount: InstantTest["choiceCount"],
) {
  const choices = question.choices
    .slice(0, choiceCount)
    .map((choice) => choice.trim());

  return {
    ...question,
    id: question.id || `question-${index + 1}`,
    prompt: question.prompt.trim(),
    explanation: question.explanation.trim(),
    choices,
    answerIndex: Math.min(
      Math.max(0, Number(question.answerIndex) || 0),
      Math.max(choices.length - 1, 0),
    ),
    enabled: Boolean(question.enabled),
  };
}

export function normalizeTest(test: InstantTest): InstantTest {
  const seedTest = seedTests.find((entry) => entry.id === test.id);
  const choiceCount = isChoiceCount(test.choiceCount)
    ? test.choiceCount
    : seedTest?.choiceCount ?? 4;

  return {
    ...test,
    difficulty: isDifficulty(test.difficulty)
      ? test.difficulty
      : seedTest?.difficulty ?? "ふつう",
    status: isStatus(test.status) ? test.status : seedTest?.status ?? "下書き",
    questionType: "選択式",
    choiceCount,
    pointsPerQuestion: Math.max(1, Number(test.pointsPerQuestion) || 1),
    questions: test.questions.map((question, index) =>
      normalizeQuestion(question, index, choiceCount),
    ),
  };
}

export function normalizeAttempt(attempt: StudentAttempt): StudentAttempt {
  return {
    ...attempt,
    answers: Array.isArray(attempt.answers)
      ? attempt.answers.map((entry) => Number(entry))
      : [],
    status: "実施済み",
  };
}