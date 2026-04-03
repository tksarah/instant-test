export type Difficulty = "やさしい" | "ふつう" | "難しい";
export type PublicationStatus = "公開中" | "下書き" | "非公開";

export type ClassRoom = {
  id: string;
  name: string;
  code: string;
  subject: string;
  studentCount: number;
  homeroomTeacher: string;
  schedule: string;
};

export type QuizQuestion = {
  id: string;
  prompt: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
  enabled: boolean;
};

export type InstantTest = {
  id: string;
  title: string;
  category: string;
  classId: string;
  date: string;
  difficulty: Difficulty;
  status: PublicationStatus;
  questionType: "選択式";
  choiceCount: 2 | 3 | 4;
  pointsPerQuestion: number;
  randomOrder: boolean;
  sourceText: string;
  questions: QuizQuestion[];
};

export type StudentAttempt = {
  id: string;
  testId: string;
  classCode: string;
  studentName: string;
  score: number;
  correctCount: number;
  completedAt: string;
  completedAtIso?: string;
  answers?: number[];
  status: "実施済み";
};

export const classes: ClassRoom[] = [
  {
    id: "class-1a",
    name: "1年A組",
    code: "ENG1A",
    subject: "英語",
    studentCount: 32,
    homeroomTeacher: "高橋 先生",
    schedule: "2026/04/03 5限",
  },
  {
    id: "class-2b",
    name: "2年B組",
    code: "SCI2B",
    subject: "理科",
    studentCount: 28,
    homeroomTeacher: "石田 先生",
    schedule: "2026/04/04 2限",
  },
];

export const tests: InstantTest[] = [
  {
    id: "present-perfect-check",
    title: "現在完了の確認テスト",
    category: "英語",
    classId: "class-1a",
    date: "2026-04-03",
    difficulty: "ふつう",
    status: "公開中",
    questionType: "選択式",
    choiceCount: 4,
    pointsPerQuestion: 20,
    randomOrder: true,
    sourceText:
      "今日の授業では現在完了の3用法として、継続・経験・完了を扱った。for は期間、since は起点を表し、already は肯定文、yet は否定文や疑問文で使われることを例文で確認した。現在完了は have または has と過去分詞で作る。",
    questions: [
      {
        id: "q1",
        prompt: "I have lived in Osaka for three years. の意味として最も適切なのはどれですか。",
        choices: [
          "大阪に3回行ったことがある。",
          "3年前に大阪へ引っ越した。",
          "3年間ずっと大阪に住んでいる。",
          "大阪に3年後に住む予定だ。",
        ],
        answerIndex: 2,
        explanation:
          "for three years が期間を表し、現在完了の継続用法になっているため、『3年間ずっと住んでいる』が正しいです。",
        enabled: true,
      },
      {
        id: "q2",
        prompt: "She has already finished her homework. に含まれる already の役割として正しいものはどれですか。",
        choices: [
          "未来の予定を表す。",
          "すでに完了していることを強調する。",
          "疑問文で使う語である。",
          "継続を表す前置詞である。",
        ],
        answerIndex: 1,
        explanation:
          "already は『すでに』を表し、現在完了の完了用法でよく使われます。",
        enabled: true,
      },
      {
        id: "q3",
        prompt: "次のうち、現在完了の経験用法の例文はどれですか。",
        choices: [
          "I have visited Kyoto twice.",
          "I visited Kyoto yesterday.",
          "I am visiting Kyoto now.",
          "I will visit Kyoto tomorrow.",
        ],
        answerIndex: 0,
        explanation:
          "twice が経験回数を示しており、『京都を2回訪れたことがある』という経験用法です。",
        enabled: true,
      },
      {
        id: "q4",
        prompt: "since 2024 を使うときの since の意味として最も近いものはどれですか。",
        choices: [
          "期間",
          "起点",
          "回数",
          "目的",
        ],
        answerIndex: 1,
        explanation:
          "since は『いつから』という起点を表します。",
        enabled: true,
      },
      {
        id: "q5",
        prompt: "次のうち、このMVPでは出題対象から外す設定になっている問題はどれですか。",
        choices: [
          "継続用法の例文を選ぶ問題",
          "already の意味を問う問題",
          "自由記述で例文を書かせる問題",
          "since の意味を問う問題",
        ],
        answerIndex: 2,
        explanation:
          "初期MVPでは記述式を除外し、選択式のみを採用する想定です。",
        enabled: false,
      },
    ],
  },
];

export const studentAttempts: StudentAttempt[] = [
  {
    id: "attempt-1",
    testId: "present-perfect-check",
    classCode: "ENG1A",
    studentName: "山田 葵",
    score: 80,
    correctCount: 4,
    completedAt: "17:42",
    completedAtIso: "2026-04-03T17:42:00+09:00",
    status: "実施済み",
  },
  {
    id: "attempt-2",
    testId: "present-perfect-check",
    classCode: "ENG1A",
    studentName: "佐藤 陽",
    score: 60,
    correctCount: 3,
    completedAt: "17:45",
    completedAtIso: "2026-04-03T17:45:00+09:00",
    status: "実施済み",
  },
  {
    id: "attempt-3",
    testId: "present-perfect-check",
    classCode: "ENG1A",
    studentName: "木村 凛",
    score: 100,
    correctCount: 5,
    completedAt: "17:47",
    completedAtIso: "2026-04-03T17:47:00+09:00",
    status: "実施済み",
  },
  {
    id: "attempt-4",
    testId: "present-perfect-check",
    classCode: "ENG1A",
    studentName: "井上 蓮",
    score: 40,
    correctCount: 2,
    completedAt: "17:50",
    completedAtIso: "2026-04-03T17:50:00+09:00",
    status: "実施済み",
  },
];

export function getClassById(classId: string) {
  return classes.find((entry) => entry.id === classId);
}

export function getTestById(testId: string) {
  return tests.find((entry) => entry.id === testId);
}

export function getAttemptsForTest(testId: string) {
  return studentAttempts.filter((entry) => entry.testId === testId);
}

export function getTestStats(testId: string) {
  const attempts = getAttemptsForTest(testId);
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

export function getEnabledQuestionCount(testId: string) {
  const test = getTestById(testId);

  return test ? test.questions.filter((question) => question.enabled).length : 0;
}