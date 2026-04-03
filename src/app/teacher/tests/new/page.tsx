import Link from "next/link";

import { TestBuilderForm } from "@/components/test-builder-form";
import { TeacherSessionSummary } from "@/components/teacher-session-summary";
import { getTeacherBuilderData } from "@/lib/data";
import type { InstantTest } from "@/lib/mock-data";
import { requireTeacherSession } from "@/lib/teacher-auth";

export const dynamic = "force-dynamic";

type SearchParams = {
  testId?: string | string[];
};

function createFallbackDraft(classId: string): InstantTest {
  return {
    id: "",
    title: "新しい確認テスト",
    category: "",
    classId,
    date: new Date().toISOString().slice(0, 10),
    difficulty: "ふつう",
    status: "下書き",
    questionType: "選択式",
    choiceCount: 4,
    pointsPerQuestion: 10,
    randomOrder: true,
    sourceText: "",
    questions: [],
  };
}

export default async function TeacherTestBuilderPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams> | SearchParams;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const testId = Array.isArray(resolvedSearchParams.testId)
    ? resolvedSearchParams.testId[0]
    : resolvedSearchParams.testId;
  const authState = await requireTeacherSession();
  const { classes, draft } = await getTeacherBuilderData(testId);
  const currentDraft = draft ?? createFallbackDraft(classes[0]?.id ?? "");

  return (
    <div className="app-shell">
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 md:px-10">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-[var(--brand)]">Test Builder</p>
          <h1 className="font-display mt-2 text-3xl font-semibold">確認テスト作成</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <TeacherSessionSummary
            authRequired={authState.authRequired}
            displayName={authState.profile?.displayName}
            email={authState.profile?.email}
          />
          <Link href="/teacher" className="rounded-full border border-[rgba(25,35,46,0.12)] px-4 py-2 text-sm font-semibold transition hover:bg-white/70">
            ダッシュボードへ戻る
          </Link>
          <Link href="/teacher/results" className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--brand-strong)]">
            結果画面を見る
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 pb-16 md:px-10">
        <section className="surface-card rounded-[2rem] p-8">
          <span className="pill">MVP では選択式のみを先行実装</span>
          <h2 className="font-display mt-6 text-4xl font-semibold">
            授業テキストから問題を生成し、公開前に先生が調整する。
          </h2>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-[var(--ink-soft)]">
            フォームで確認テストの条件を指定し、右側の生成プレビューで問題を修正します。非採用にした問題は出題対象から除外できます。
          </p>
        </section>

        <TestBuilderForm
          key={currentDraft.id || "new-test"}
          classes={classes}
          draft={currentDraft}
        />
      </main>
    </div>
  );
}