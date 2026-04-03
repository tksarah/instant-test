import Link from "next/link";

import { TeacherSessionSummary } from "@/components/teacher-session-summary";
import { getTeacherResultsData } from "@/lib/data";
import { requireTeacherSession } from "@/lib/teacher-auth";

export const dynamic = "force-dynamic";

type SearchParams = {
  testId?: string | string[];
};

export default async function TeacherResultsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams> | SearchParams;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const testId = Array.isArray(resolvedSearchParams.testId)
    ? resolvedSearchParams.testId[0]
    : resolvedSearchParams.testId;
  const authState = await requireTeacherSession();
  const { attempts, classroom, stats, test, tests } = await getTeacherResultsData(testId);

  return (
    <div className="app-shell">
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 md:px-10">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-[var(--brand)]">Learning Analytics</p>
          <h1 className="font-display mt-2 text-3xl font-semibold">学習履歴と統計</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <TeacherSessionSummary
            authRequired={authState.authRequired}
            displayName={authState.profile?.displayName}
            email={authState.profile?.email}
          />
          <Link href="/teacher" className="rounded-full border border-[rgba(25,35,46,0.12)] px-4 py-2 text-sm font-semibold transition hover:bg-white/70">
            ダッシュボード
          </Link>
          <Link href="/student/session" className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--brand-strong)]">
            学生画面を確認
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 pb-16 md:px-10">
        <section className="surface-card rounded-[2rem] p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">対象テスト</p>
              <h2 className="font-display mt-2 text-2xl font-semibold">分析する確認テストを切り替える</h2>
            </div>
            <Link href="/teacher/tests/new" className="rounded-full border border-[rgba(25,35,46,0.12)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-[var(--surface)]">
              新しいテストを作成
            </Link>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {tests.map((entry) => (
              <Link
                key={entry.id}
                href={`/teacher/results?testId=${entry.id}`}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  entry.id === test?.id
                    ? "bg-[var(--brand)] text-white hover:bg-[var(--brand-strong)]"
                    : "border border-[rgba(25,35,46,0.12)] bg-white hover:bg-[var(--surface)]"
                }`}
              >
                {entry.title}
              </Link>
            ))}
          </div>
        </section>

        <section className="surface-card rounded-[2rem] p-8">
          <span className="pill">{classroom?.name ?? "クラス未設定"} / {test?.category ?? "カテゴリ未設定"}</span>
          <h2 className="font-display mt-6 text-4xl font-semibold">{test?.title ?? "確認テスト未作成"}</h2>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-[var(--ink-soft)]">
            クラス別の受験状況、平均点、最高点、最低点を一覧化し、授業内容がどれだけ定着しているかをその場で確認します。
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <div className="soft-card rounded-[1.6rem] p-5">
            <p className="text-sm text-[var(--ink-soft)]">受験人数</p>
            <p className="kpi-number mt-3">{stats.participantCount}</p>
          </div>
          <div className="soft-card rounded-[1.6rem] p-5">
            <p className="text-sm text-[var(--ink-soft)]">平均点</p>
            <p className="kpi-number mt-3">{stats.average}</p>
          </div>
          <div className="soft-card rounded-[1.6rem] p-5">
            <p className="text-sm text-[var(--ink-soft)]">最高点</p>
            <p className="kpi-number mt-3">{stats.highest}</p>
          </div>
          <div className="soft-card rounded-[1.6rem] p-5">
            <p className="text-sm text-[var(--ink-soft)]">最低点</p>
            <p className="kpi-number mt-3">{stats.lowest}</p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <article className="surface-card rounded-[2rem] p-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">学生一覧</p>
                <h3 className="font-display mt-2 text-2xl font-semibold">実施済み学生のスコア</h3>
              </div>
              <span className="text-sm text-[var(--ink-soft)]">クラスコード: {classroom?.code}</span>
            </div>

            <div className="mt-5 overflow-hidden rounded-[1.5rem] border border-[rgba(25,35,46,0.08)] bg-white/82">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-[rgba(25,35,46,0.04)] text-[var(--ink-soft)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">名前</th>
                    <th className="px-4 py-3 font-medium">状態</th>
                    <th className="px-4 py-3 font-medium">得点</th>
                    <th className="px-4 py-3 font-medium">正答数</th>
                    <th className="px-4 py-3 font-medium">完了時刻</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.length > 0 ? (
                    attempts.map((attempt) => (
                      <tr key={attempt.id} className="border-t border-[rgba(25,35,46,0.08)] text-[var(--ink)]">
                        <td className="px-4 py-4 font-semibold">{attempt.studentName}</td>
                        <td className="px-4 py-4 text-[var(--ink-soft)]">{attempt.status}</td>
                        <td className="px-4 py-4">{attempt.score} 点</td>
                        <td className="px-4 py-4">{attempt.correctCount} 問</td>
                        <td className="px-4 py-4 text-[var(--ink-soft)]">{attempt.completedAt}</td>
                      </tr>
                    ))
                  ) : (
                    <tr className="border-t border-[rgba(25,35,46,0.08)] text-[var(--ink-soft)]">
                      <td className="px-4 py-4" colSpan={5}>
                        まだ受験結果がありません。学生画面から回答するとここに記録されます。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className="surface-card rounded-[2rem] p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">授業の読み取り</p>
            <h3 className="font-display mt-2 text-2xl font-semibold">即時フィードバックの観点</h3>

            <div className="mt-5 space-y-4">
              <div className="soft-card rounded-[1.4rem] p-5">
                <p className="text-sm text-[var(--ink-soft)]">つまずき傾向</p>
                <p className="mt-3 text-sm leading-7 text-[var(--ink-soft)]">
                  継続用法と since / for の使い分けで点差が出やすいため、授業の次回冒頭で再確認しやすい構成です。
                </p>
              </div>
              <div className="soft-card rounded-[1.4rem] p-5">
                <p className="text-sm text-[var(--ink-soft)]">公開設定</p>
                <p className="mt-3 text-sm leading-7 text-[var(--ink-soft)]">
                  現在は公開中、回答順はランダム化、回答直後に解説表示ありの運用を想定しています。
                </p>
              </div>
              <div className="soft-card rounded-[1.4rem] p-5">
                <p className="text-sm text-[var(--ink-soft)]">次の実装ポイント</p>
                <p className="mt-3 text-sm leading-7 text-[var(--ink-soft)]">
                  本番では学生ごとの未実施表示、問題別正答率、CSV 出力を追加しやすいように一覧構造を分離しています。
                </p>
              </div>
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}