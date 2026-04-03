import { NextResponse } from "next/server";

import { ensureTeacherApiSession } from "@/lib/teacher-auth";
import { createClass, listClasses } from "@/lib/persistence";

export const dynamic = "force-dynamic";

export async function GET() {
  const authState = await ensureTeacherApiSession();

  if (!authState) {
    return NextResponse.json(
      { message: "先生アカウントでログインしてください。" },
      { status: 401 },
    );
  }

  const classes = await listClasses();

  return NextResponse.json({ classes });
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
      name?: string;
      code?: string;
      subject?: string;
      studentCount?: number;
      homeroomTeacher?: string;
      schedule?: string;
    };

    const classroom = await createClass({
      name: body.name ?? "",
      code: body.code ?? "",
      subject: body.subject ?? "",
      studentCount: Number(body.studentCount) || 0,
      homeroomTeacher: body.homeroomTeacher ?? "",
      schedule: body.schedule ?? "",
    });

    return NextResponse.json({ classroom }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "クラスの保存に失敗しました。",
      },
      { status: 400 },
    );
  }
}