import { NextResponse } from "next/server";

import { createAttempt, listAttempts } from "@/lib/persistence";
import { ensureTeacherApiSession } from "@/lib/teacher-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authState = await ensureTeacherApiSession();

  if (!authState) {
    return NextResponse.json(
      { message: "先生アカウントでログインしてください。" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const testId = searchParams.get("testId");
  const attempts = await listAttempts();

  return NextResponse.json({
    attempts: testId
      ? attempts.filter((entry) => entry.testId === testId)
      : attempts,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      testId?: string;
      classCode?: string;
      studentName?: string;
      score?: number;
      correctCount?: number;
      answers?: number[];
    };

    const attempt = await createAttempt({
      testId: body.testId ?? "",
      classCode: body.classCode ?? "",
      studentName: body.studentName ?? "",
      score: Number(body.score) || 0,
      correctCount: Number(body.correctCount) || 0,
      answers: Array.isArray(body.answers) ? body.answers : [],
    });

    return NextResponse.json({ attempt }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "受験結果の保存に失敗しました。",
      },
      { status: 400 },
    );
  }
}