import Link from "next/link";

import { getHomepageData } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { classes, featuredTest, publishedTests, summary } = await getHomepageData();
  const teacherEntryHref = isSupabaseConfigured() ? "/teacher/login" : "/teacher";

  return (
    <div className="app-shell">
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 md:px-10">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-[var(--brand)]">
            Instant Test MVP
          </p>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            授業直後の理解確認を、その場で作ってその場で返す。
          </p>
        </div>
        <nav className="flex items-center gap-3 text-sm font-medium">
          <Link
            href={teacherEntryHref}
            className="rounded-full border border-[rgba(25,35,46,0.12)] px-4 py-2 transition hover:bg-white/70"
          >
            先生画面
          </Link>
          <Link
            href="/student"
            className="rounded-full bg-[var(--brand)] px-4 py-2 text-white transition hover:bg-[var(--brand-strong)]"
          >
            学生画面
          </Link>
        </nav>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-7xl gap-8 px-6 pb-16 pt-8 md:px-10 lg:grid-cols-[1.15fr_0.85fr] lg:pt-12">
        <section className="surface-card rounded-[2rem] p-8 md:p-10">
          <span className="pill">授業の最後 10 分で実施する即時確認テスト</span>
          <h1 className="font-display mt-6 max-w-3xl text-5xl font-semibold leading-[0.95] text-[var(--ink)] md:text-7xl">
            授業内容を貼り付けるだけで、確認テストを即時生成。
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--ink-soft)]">
            先生は授業テキストから選択式問題を組み立て、学生は QR からアクセスして 1 問ずつ回答。
            回答直後に正答と解説を返し、授業の終わりに理解度をその場で見える化します。
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={teacherEntryHref}
              className="rounded-full bg-[var(--ink)] px-6 py-3 text-center text-sm font-semibold text-white transition hover:bg-[#101821]"
            >
              先生側の運用を見る
            </Link>
            <Link
              href="/student/session"
              className="rounded-full border border-[rgba(25,35,46,0.12)] bg-white/70 px-6 py-3 text-center text-sm font-semibold transition hover:bg-white"
            >
              学生テストを試す
            </Link>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <div className="soft-card rounded-[1.5rem] p-5">
              <p className="text-sm text-[var(--ink-soft)]">登録クラス</p>
              <p className="kpi-number mt-3">{classes.length}</p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">クラスコードで受験を紐づけ</p>
            </div>
            <div className="soft-card rounded-[1.5rem] p-5">
              <p className="text-sm text-[var(--ink-soft)]">現在の公開テスト</p>
              <p className="kpi-number mt-3">{publishedTests.length}</p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">選択式のみで最短運用</p>
            </div>
            <div className="soft-card rounded-[1.5rem] p-5">
              <p className="text-sm text-[var(--ink-soft)]">平均点</p>
              <p className="kpi-number mt-3">{summary.average}</p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                {featuredTest ? `${featuredTest.title} の直近結果` : "公開テストの準備中"}
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4">
          <article className="surface-card rounded-[2rem] p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
              今日の授業サイクル
            </p>
            <div className="mt-6 space-y-4">
              {[
                "授業テキストを貼り付けて問題を自動生成",
                "先生が問題を編集し、公開設定と配点を調整",
                "学生はクラスコードと名前だけで受験",
                "回答直後に解説表示、最後にスコア集計",
              ].map((item, index) => (
                <div
                  key={item}
                  className="soft-card flex items-start gap-4 rounded-[1.4rem] p-4"
                >
                  <span className="font-display flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-sm font-bold text-[var(--accent)]">
                    0{index + 1}
                  </span>
                  <p className="pt-1 text-sm leading-7 text-[var(--ink-soft)]">{item}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="surface-card rounded-[2rem] p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                  直近の公開テスト
                </p>
                <h2 className="font-display mt-2 text-2xl font-semibold">
                  {featuredTest?.title ?? "公開テストがまだありません"}
                </h2>
              </div>
              {featuredTest ? (
                <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">
                  {featuredTest.difficulty}
                </span>
              ) : null}
            </div>

            <dl className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="soft-card rounded-[1.4rem] p-4">
                <dt className="text-sm text-[var(--ink-soft)]">カテゴリ</dt>
                <dd className="mt-2 text-lg font-semibold">{featuredTest?.category ?? "未設定"}</dd>
              </div>
              <div className="soft-card rounded-[1.4rem] p-4">
                <dt className="text-sm text-[var(--ink-soft)]">問題数</dt>
                <dd className="mt-2 text-lg font-semibold">{featuredTest?.questions.length ?? 0} 問</dd>
              </div>
              <div className="soft-card rounded-[1.4rem] p-4">
                <dt className="text-sm text-[var(--ink-soft)]">受験人数</dt>
                <dd className="mt-2 text-lg font-semibold">{summary.participantCount} 人</dd>
              </div>
              <div className="soft-card rounded-[1.4rem] p-4">
                <dt className="text-sm text-[var(--ink-soft)]">最低点 / 最高点</dt>
                <dd className="mt-2 text-lg font-semibold">
                  {summary.lowest} / {summary.highest}
                </dd>
              </div>
            </dl>
          </article>
        </section>
      </main>
    </div>
  );
}
