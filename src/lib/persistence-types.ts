import type { ClassRoom, InstantTest, StudentAttempt } from "@/lib/mock-data";

export type PersistedStore = {
  classes: ClassRoom[];
  tests: InstantTest[];
  studentAttempts: StudentAttempt[];
};

export type CreateClassInput = Omit<ClassRoom, "id">;

export type SaveTestInput = {
  id?: string;
  title: string;
  category: string;
  classId: string;
  date: string;
  difficulty: InstantTest["difficulty"];
  status: InstantTest["status"];
  questionType: InstantTest["questionType"];
  choiceCount: InstantTest["choiceCount"];
  pointsPerQuestion: number;
  randomOrder: boolean;
  sourceText: string;
  questions: InstantTest["questions"];
};

export type CreateAttemptInput = {
  testId: string;
  classCode: string;
  studentName: string;
  score: number;
  correctCount: number;
  answers: number[];
};