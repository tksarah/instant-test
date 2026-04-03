import { NextResponse } from "next/server";

import { listTests, saveTest } from "@/lib/persistence";
import { ensureTeacherApiSession } from "@/lib/teacher-auth";
import type { InstantTest } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const authState = await ensureTeacherApiSession();

  if (!authState) {
    return NextResponse.json(
      { message: "先生アカウントでログインしてください。" },
      { status: 401 },
    );
  }

  const tests = await listTests();

  return NextResponse.json({ tests });
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
      id?: string;
      title?: string;
      category?: string;
      classId?: string;
      date?: string;
      difficulty?: InstantTest["difficulty"];
      status?: InstantTest["status"];
      questionType?: InstantTest["questionType"];
      choiceCount?: InstantTest["choiceCount"];
      pointsPerQuestion?: number;
      randomOrder?: boolean;
      sourceText?: string;
      questions?: InstantTest["questions"];
    };

    const test = await saveTest({
      id: body.id,
      title: body.title ?? "",
      category: body.category ?? "",
      classId: body.classId ?? "",
      date: body.date ?? new Date().toISOString().slice(0, 10),
      difficulty: body.difficulty ?? "ふつう",
      status: body.status ?? "下書き",
      questionType: "選択式",
      choiceCount: body.choiceCount ?? 4,
      pointsPerQuestion: Number(body.pointsPerQuestion) || 10,
      randomOrder: Boolean(body.randomOrder),
      sourceText: body.sourceText ?? "",
      questions: body.questions ?? [],
    });

    return NextResponse.json({ test }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "確認テストの保存に失敗しました。",
      },
      { status: 400 },
    );
  }
}