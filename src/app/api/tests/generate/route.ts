import { NextResponse } from "next/server";

import type { InstantTest } from "@/lib/mock-data";
import { ensureTeacherApiSession } from "@/lib/teacher-auth";
import { generateQuestionsFromSource } from "@/lib/test-generation";

export const dynamic = "force-dynamic";

function isChoiceCount(value: number): value is InstantTest["choiceCount"] {
  return value === 2 || value === 3 || value === 4;
}

function isDifficulty(value: string): value is InstantTest["difficulty"] {
  return value === "やさしい" || value === "ふつう" || value === "難しい";
}

export async function POST(request: Request) {
  try {
    const authState = await ensureTeacherApiSession();

    if (!authState) {
      return NextResponse.json(
        { message: "先生アカウントでログインしてください。" },
        { status: 401 },
      );
    }

    const body = (await request.json()) as {
      sourceText?: string;
      title?: string;
      category?: string;
      difficulty?: string;
      choiceCount?: number;
      questionCount?: number;
    };
    const requestedDifficulty = body.difficulty ?? "";
    const difficulty: InstantTest["difficulty"] = isDifficulty(requestedDifficulty)
      ? requestedDifficulty
      : "ふつう";
    const requestedChoiceCount = Number(body.choiceCount);
    const choiceCount: InstantTest["choiceCount"] = isChoiceCount(requestedChoiceCount)
      ? requestedChoiceCount
      : 4;

    const questions = generateQuestionsFromSource({
      sourceText: body.sourceText ?? "",
      title: body.title ?? "",
      category: body.category ?? "",
      difficulty,
      choiceCount,
      questionCount: Math.max(1, Number(body.questionCount) || 5),
    });

    if (questions.length === 0) {
      throw new Error("授業テキストから問題候補を作れませんでした。内容を増やして再生成してください。");
    }

    return NextResponse.json({ questions });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "問題候補の生成に失敗しました。",
      },
      { status: 400 },
    );
  }
}