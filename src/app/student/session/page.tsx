import Link from "next/link";

import { StudentQuiz } from "@/components/student-quiz";
import { getStudentSessionData } from "@/lib/data";

export const dynamic = "force-dynamic";

type SearchParams = {
  testId?: string | string[];
  classCode?: string | string[];
  studentName?: string | string[];
};

function getSingleValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function StudentSessionPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams> | SearchParams;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const testId = getSingleValue(resolvedSearchParams.testId);
  const classCode = getSingleValue(resolvedSearchParams.classCode) ?? "ENG1A";
  const studentName = getSingleValue(resolvedSearchParams.studentName) ?? "体験ユーザー";
  const { classroom, test } = await getStudentSessionData({
    testId,
    classCode,
  });

  return (
    <div className="app-shell">
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 md:px-10">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-[var(--brand)]">Instant Test</p>
          <h1 className="font-display mt-2 text-3xl font-semibold">確認テスト実施</h1>
        </div>
        <div className="flex gap-3">
          <Link href="/student" className="rounded-full border border-[rgba(25,35,46,0.12)] px-4 py-2 text-sm font-semibold transition hover:bg-white/70">
            テスト一覧へ戻る
          </Link>
          <Link href="/teacher/results" className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--brand-strong)]">
            先生の結果画面
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-16 md:px-10">
        {test ? (
          <StudentQuiz
            classCode={classCode}
            classroomName={classroom?.name ?? "対象クラス"}
            studentName={studentName}
            test={test}
          />
        ) : (
          <section className="surface-card rounded-[2rem] p-8">
            <span className="pill">テスト未公開</span>
            <h2 className="font-display mt-6 text-4xl font-semibold">受験可能な確認テストがありません</h2>
            <p className="mt-4 text-lg leading-8 text-[var(--ink-soft)]">
              先生側でテストを公開するとここから受験できます。公開設定とクラスコードを確認してください。
            </p>
          </section>
        )}
      </main>
    </div>
  );
}