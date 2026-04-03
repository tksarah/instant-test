import type { InstantTest, QuizQuestion } from "@/lib/mock-data";

export const MAX_QUESTIONS = 10;
export const DEFAULT_GENERATED_QUESTION_COUNT = 5;

const fallbackChoicePool = [
  "未確認項目",
  "応用内容",
  "補足事項",
  "例外ルール",
  "発展課題",
  "関連語句",
];

function createQuestionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `question-${crypto.randomUUID()}`;
  }

  return `question-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampAnswerIndex(index: number, choiceCount: InstantTest["choiceCount"]) {
  return Math.min(Math.max(0, Number(index) || 0), choiceCount - 1);
}

export function getSuggestedQuestionCount(existingCount: number) {
  const count = Number(existingCount) || DEFAULT_GENERATED_QUESTION_COUNT;

  return Math.min(MAX_QUESTIONS, Math.max(1, count));
}

export function resizeChoices(
  choices: string[],
  choiceCount: InstantTest["choiceCount"],
) {
  return Array.from({ length: choiceCount }, (_, index) => choices[index] ?? "");
}

export function createEmptyQuestion(
  choiceCount: InstantTest["choiceCount"],
): QuizQuestion {
  return {
    id: createQuestionId(),
    prompt: "",
    choices: resizeChoices([], choiceCount),
    answerIndex: 0,
    explanation: "",
    enabled: true,
  };
}

function isQuestionBlank(question: QuizQuestion) {
  return [question.prompt, question.explanation, ...question.choices].every(
    (value) => !value.trim(),
  );
}

export function buildChoiceList(
  correctChoice: string,
  distractorPool: string[],
  choiceCount: InstantTest["choiceCount"],
  seed = 0,
) {
  const uniquePool = Array.from(
    new Set(
      distractorPool
        .map((choice) => choice.trim())
        .filter((choice) => choice && choice !== correctChoice),
    ),
  );

  while (uniquePool.length < choiceCount - 1) {
    const fallbackChoice = fallbackChoicePool[uniquePool.length % fallbackChoicePool.length];

    if (fallbackChoice !== correctChoice && !uniquePool.includes(fallbackChoice)) {
      uniquePool.push(fallbackChoice);
    }
  }

  const answerIndex = seed % choiceCount;
  const choices = uniquePool.slice(0, choiceCount - 1);

  choices.splice(answerIndex, 0, correctChoice);

  return {
    choices,
    answerIndex,
  };
}

export function sanitizeQuestionForSave(
  question: QuizQuestion,
  index: number,
  choiceCount: InstantTest["choiceCount"],
) {
  if (isQuestionBlank(question)) {
    return null;
  }

  const prompt = question.prompt.trim();
  const choices = resizeChoices(question.choices, choiceCount).map((choice) => choice.trim());
  const answerIndex = clampAnswerIndex(question.answerIndex, choiceCount);
  const correctChoice = choices[answerIndex] ?? "";

  if (!prompt) {
    throw new Error(`第${index + 1}問の問題文を入力してください。`);
  }

  if (choices.some((choice) => !choice)) {
    throw new Error(`第${index + 1}問の選択肢をすべて入力してください。`);
  }

  return {
    ...question,
    id: question.id || createQuestionId(),
    prompt,
    choices,
    answerIndex,
    explanation: question.explanation.trim() || `${correctChoice} が正答です。`,
    enabled: question.enabled !== false,
  } satisfies QuizQuestion;
}

export function prepareQuestionsForSave(
  questions: QuizQuestion[],
  choiceCount: InstantTest["choiceCount"],
) {
  return questions
    .slice(0, MAX_QUESTIONS)
    .map((question, index) => sanitizeQuestionForSave(question, index, choiceCount))
    .filter((question): question is QuizQuestion => question !== null);
}