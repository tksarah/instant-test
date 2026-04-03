import type { InstantTest, QuizQuestion } from "@/lib/mock-data";
import {
  buildChoiceList,
  MAX_QUESTIONS,
  prepareQuestionsForSave,
} from "@/lib/test-question-utils";

type GenerationKind = "meaning" | "usage" | "structure" | "list" | "cloze";

type GenerateQuestionsInput = {
  sourceText: string;
  title: string;
  category: string;
  difficulty: InstantTest["difficulty"];
  choiceCount: InstantTest["choiceCount"];
  questionCount: number;
};

type Fact = {
  subject: string;
  answer: string;
  sentence: string;
  kind: Exclude<GenerationKind, "cloze">;
};

const japaneseStopwords = new Set([
  "今日",
  "授業",
  "内容",
  "確認",
  "問題",
  "本文",
  "こと",
  "もの",
  "ため",
  "よう",
  "これ",
  "それ",
  "今回",
  "ここ",
  "あと",
]);

function normalizeSourceText(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/[\t ]+/g, " ").trim();
}

function splitSentences(text: string) {
  return text
    .split(/(?<=[。.!?！？])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function cleanFragment(value: string) {
  return value
    .replace(/^[\s「」『』（）()【】]+|[\s「」『』（）()【】]+$/g, "")
    .replace(/[。.!?！？]+$/g, "")
    .trim();
}

function cleanSubject(value: string) {
  return cleanFragment(value)
    .replace(/^.*?では/, "")
    .replace(/^.*?で/, "")
    .trim();
}

function cleanAnswer(value: string) {
  return cleanFragment(value)
    .replace(/(を表(?:し|す|した)|で使(?:い|わ)われ(?:る|た)?|で作(?:る|られる|った)|を扱(?:う|った)|を確認(?:した)?|といえる)$/g, "")
    .replace(/(ことを例文で確認した|ことを確認した|を例文で確認した)$/g, "")
    .trim();
}

function detectKind(sentence: string, clause: string): Fact["kind"] {
  if (/で使(?:い|わ)われ/.test(clause) || /で使(?:い|わ)われ/.test(sentence)) {
    return "usage";
  }

  if (/で作(?:る|られる|った)/.test(clause) || /で作(?:る|られる|った)/.test(sentence)) {
    return "structure";
  }

  if (/を表(?:し|す|した)/.test(clause) || /を表(?:し|す|した)/.test(sentence)) {
    return "meaning";
  }

  return "meaning";
}

function isValidSubject(value: string) {
  if (!value || value.length > 20) {
    return false;
  }

  return !/[でにをがともへやか]$/.test(value);
}

function isValidAnswer(value: string) {
  return Boolean(value) && value.length <= 36;
}

function extractPairFacts(sentence: string): Fact[] {
  const clauses = sentence
    .split(/[、,]/)
    .map((clause) => clause.trim())
    .filter(Boolean);

  return clauses
    .map((clause) => {
      const separatorIndex = clause.indexOf("は");

      if (separatorIndex <= 0) {
        return null;
      }

      const subject = cleanSubject(clause.slice(0, separatorIndex));
      const answer = cleanAnswer(clause.slice(separatorIndex + 1));

      if (!isValidSubject(subject) || !isValidAnswer(answer)) {
        return null;
      }

      return {
        subject,
        answer,
        sentence,
        kind: detectKind(sentence, clause),
      } satisfies Fact;
    })
    .filter((fact): fact is Fact => fact !== null);
}

function extractListFacts(sentence: string): Fact[] {
  const match = sentence.match(/(.+?)として[、,]?(.+?)(?:を扱|を確認)/);

  if (!match) {
    return [] satisfies Fact[];
  }

  const subject = cleanSubject(match[1]);
  const items = match[2]
    .split(/[・、,]/)
    .map((item) => cleanFragment(item))
    .filter((item) => item.length > 0 && item.length <= 20);

  return items.map(
    (answer) =>
      ({
        subject,
        answer,
        sentence,
        kind: "list",
      }) satisfies Fact,
  );
}

function dedupeFacts(facts: Fact[]) {
  const seen = new Set<string>();

  return facts.filter((fact) => {
    const key = `${fact.kind}:${fact.subject}:${fact.answer}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function extractTerms(text: string) {
  const asciiTerms = text.match(/[A-Za-z][A-Za-z0-9-]{1,20}/g) ?? [];
  const japaneseTerms = text.match(/[一-龠ぁ-んァ-ヶー]{2,12}/g) ?? [];

  return Array.from(new Set([...asciiTerms, ...japaneseTerms]))
    .map((term) => cleanFragment(term))
    .filter((term) => term.length >= 2 && !japaneseStopwords.has(term) && !/^\d+$/.test(term));
}

function buildFactPrompt(fact: Fact) {
  switch (fact.kind) {
    case "usage":
      return `${fact.subject} が使われる場面として最も適切なのはどれですか。`;
    case "structure":
      return `${fact.subject} の形として本文に合うものはどれですか。`;
    case "list":
      return `本文で扱った ${fact.subject} として含まれるものはどれですか。`;
    case "meaning":
    default:
      return `${fact.subject} が表す内容として最も適切なのはどれですか。`;
  }
}

function buildFactExplanation(fact: Fact) {
  return `本文では「${fact.sentence}」と説明されています。`;
}

function buildFactQuestions(
  facts: Fact[],
  terms: string[],
  input: GenerateQuestionsInput,
): QuizQuestion[] {
  return facts.map((fact, index) => {
    const distractorPool = [
      ...facts
        .filter((candidate) => candidate.answer !== fact.answer)
        .map((candidate) => candidate.answer),
      ...terms.filter((term) => term !== fact.answer && term !== fact.subject),
    ];
    const { choices, answerIndex } = buildChoiceList(
      fact.answer,
      distractorPool,
      input.choiceCount,
      index,
    );

    return {
      id: `generated-fact-${index + 1}`,
      prompt: buildFactPrompt(fact),
      choices,
      answerIndex,
      explanation: buildFactExplanation(fact),
      enabled: true,
    } satisfies QuizQuestion;
  });
}

function buildClozeQuestions(
  sentences: string[],
  terms: string[],
  input: GenerateQuestionsInput,
  existingPrompts: Set<string>,
): QuizQuestion[] {
  const questions: QuizQuestion[] = [];

  for (const sentence of sentences) {
    const sentenceTerms = extractTerms(sentence).filter((term) => sentence.includes(term));
    const target = sentenceTerms[0];

    if (!target) {
      continue;
    }

    const blankedSentence = sentence.replace(target, "____");
    const prompt = `次の文の空欄に入る語句として最も適切なのはどれですか。 ${blankedSentence}`;

    if (existingPrompts.has(prompt)) {
      continue;
    }

    const distractorPool = terms.filter((term) => term !== target);
    const { choices, answerIndex } = buildChoiceList(
      target,
      distractorPool,
      input.choiceCount,
      questions.length,
    );

    questions.push({
      id: `generated-cloze-${questions.length + 1}`,
      prompt,
      choices,
      answerIndex,
      explanation: `本文の該当箇所は「${sentence}」です。`,
      enabled: true,
    });
    existingPrompts.add(prompt);
  }

  return questions;
}

export function generateQuestionsFromSource(input: GenerateQuestionsInput) {
  const normalizedSourceText = normalizeSourceText(input.sourceText);

  if (!normalizedSourceText) {
    return [] satisfies QuizQuestion[];
  }

  const sentences = splitSentences(normalizedSourceText);
  const safeQuestionCount = Math.min(
    MAX_QUESTIONS,
    Math.max(1, Number(input.questionCount) || 1),
  );
  const facts = dedupeFacts(
    sentences.flatMap((sentence) => [
      ...extractListFacts(sentence),
      ...extractPairFacts(sentence),
    ]),
  );
  const terms = extractTerms(`${input.title} ${input.category} ${normalizedSourceText}`);
  const questions = buildFactQuestions(facts, terms, input);
  const promptSet = new Set(questions.map((question) => question.prompt));

  if (questions.length < safeQuestionCount) {
    questions.push(
      ...buildClozeQuestions(sentences, terms, input, promptSet).slice(
        0,
        safeQuestionCount - questions.length,
      ),
    );
  }

  return prepareQuestionsForSave(
    questions.slice(0, safeQuestionCount),
    input.choiceCount,
  );
}