import Link from "next/link";

import { StudentEntryPanel } from "@/components/student-entry-panel";
import { getStudentLandingData } from "@/lib/data";

export const dynamic = "force-dynamic";

function buildDefaultStartLink(
  testId: string | undefined,
  classCode: string,
  studentName: string,
) {
  if (!testId) {
    return "/student/session";
  }

  const params = new URLSearchParams({
    testId,
    classCode,
    studentName,
  });

  return `/student/session?${params.toString()}`;
}

export default async function StudentPage() {
  const { availableTests, primaryClass } = await getStudentLandingData();
  const defaultStartLink = buildDefaultStartLink(
    availableTests[0]?.test.id,
    primaryClass?.code ?? "ENG1A",
    "体験ユーザー",
  );

  return (
    <div className="app-shell">
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 md:px-10">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-[var(--brand)]">Student Flow</p>
          <h1 className="font-display mt-2 text-3xl font-semibold">学生受験画面</h1>
        </div>
        <div className="flex gap-3">
          <Link href="/" className="rounded-full border border-[rgba(25,35,46,0.12)] px-4 py-2 text-sm font-semibold transition hover:bg-white/70">
            ホーム
          </Link>
          <Link href={defaultStartLink} className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--brand-strong)]">
            テストを開始
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-7xl gap-6 px-6 pb-16 md:px-10 lg:grid-cols-[0.9fr_1.1fr]">
        <StudentEntryPanel
          availableTests={availableTests}
          primaryClassCode={primaryClass?.code ?? "ENG1A"}
        />
      </main>
    </div>
  );
}