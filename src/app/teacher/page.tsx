import Link from "next/link";

import { AccessQr } from "@/components/access-qr";
import { ClassRegistrationForm } from "@/components/class-registration-form";
import { TeacherSessionSummary } from "@/components/teacher-session-summary";
import { getTeacherDashboardData } from "@/lib/data";
import { requireTeacherSession } from "@/lib/teacher-auth";

export const dynamic = "force-dynamic";

export default async function TeacherPage() {
  const authState = await requireTeacherSession();
  const { classes, featuredClass, featuredTest, stats, tests } =
    await getTeacherDashboardData();
  const enabledQuestionCount = featuredTest
    ? featuredTest.questions.filter((question) => question.enabled).length
    : 0;
  const recentTests = tests.slice(0, 4);

  return (
    <div className="app-shell">
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 md:px-10">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-[var(--brand)]">Teacher Console</p>
          <h1 className="font-display mt-2 text-3xl font-semibold">先生ダッシュボード</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <TeacherSessionSummary
            authRequired={authState.authRequired}
            displayName={authState.profile?.displayName}
            email={authState.profile?.email}
          />
          <Link href="/" className="rounded-full border border-[rgba(25,35,46,0.12)] px-4 py-2 text-sm font-semibold transition hover:bg-white/70">
            ホーム
          </Link>
          <Link href="/teacher/tests/new" className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--brand-strong)]">
            テストを作成
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 pb-16 md:px-10">
        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="surface-card rounded-[2rem] p-8">
            <span className="pill">{featuredClass?.schedule}</span>
            <h2 className="font-display mt-6 text-5xl font-semibold leading-[0.95]">
              {featuredClass?.name ?? "クラス未設定"} の授業内容から、
              <br />
              その場で確認テストを生成。
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--ink-soft)]">
              授業テキストを元に選択式問題を組み立て、編集後に即公開。学生は QR から参加し、先生はクラス別の得点分布をすぐ確認できます。
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/teacher/tests/new" className="rounded-full bg-[var(--ink)] px-6 py-3 text-center text-sm font-semibold text-white transition hover:bg-[#101821]">
                問題生成を開く
              </Link>
              <Link href="/teacher/results" className="rounded-full border border-[rgba(25,35,46,0.12)] bg-white/70 px-6 py-3 text-center text-sm font-semibold transition hover:bg-white">
                学習履歴を見る
              </Link>
            </div>
          </div>

          <AccessQr path="/student" classCode={featuredClass?.code ?? "ENG1A"} />
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <div className="soft-card rounded-[1.6rem] p-5">
            <p className="text-sm text-[var(--ink-soft)]">公開中テスト</p>
            <p className="kpi-number mt-3">{tests.filter((test) => test.status === "公開中").length}</p>
          </div>
          <div className="soft-card rounded-[1.6rem] p-5">
            <p className="text-sm text-[var(--ink-soft)]">有効問題数</p>
            <p className="kpi-number mt-3">{enabledQuestionCount}</p>
          </div>
          <div className="soft-card rounded-[1.6rem] p-5">
            <p className="text-sm text-[var(--ink-soft)]">受験人数</p>
            <p className="kpi-number mt-3">{stats.participantCount}</p>
          </div>
          <div className="soft-card rounded-[1.6rem] p-5">
            <p className="text-sm text-[var(--ink-soft)]">平均点</p>
            <p className="kpi-number mt-3">{stats.average}</p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <article className="surface-card rounded-[2rem] p-6">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">クラス一覧</p>
                <h3 className="font-display mt-2 text-2xl font-semibold">登録済みクラス</h3>
              </div>
              <span className="text-sm text-[var(--ink-soft)]">確認テストの紐づけ先</span>
            </div>

            <ClassRegistrationForm />

            <div className="mt-5 space-y-4">
              {classes.map((classroom) => (
                <div key={classroom.id} className="soft-card rounded-[1.4rem] p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-lg font-semibold text-[var(--ink)]">{classroom.name}</p>
                      <p className="mt-1 text-sm text-[var(--ink-soft)]">
                        {classroom.subject} / {classroom.homeroomTeacher}
                      </p>
                    </div>
                    <div className="text-sm text-[var(--ink-soft)]">
                      <p>クラスコード: {classroom.code}</p>
                      <p>在籍: {classroom.studentCount} 名</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="surface-card rounded-[2rem] p-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">確認テスト管理</p>
                <h3 className="font-display mt-2 text-2xl font-semibold">{featuredTest?.title ?? "テスト未作成"}</h3>
              </div>
              {featuredTest ? (
                <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">
                  {featuredTest.status}
                </span>
              ) : null}
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="soft-card rounded-[1.4rem] p-5">
                <p className="text-sm text-[var(--ink-soft)]">カテゴリ</p>
                <p className="mt-2 text-lg font-semibold">{featuredTest?.category ?? "未設定"}</p>
              </div>
              <div className="soft-card rounded-[1.4rem] p-5">
                <p className="text-sm text-[var(--ink-soft)]">難易度</p>
                <p className="mt-2 text-lg font-semibold">{featuredTest?.difficulty ?? "未設定"}</p>
              </div>
              <div className="soft-card rounded-[1.4rem] p-5">
                <p className="text-sm text-[var(--ink-soft)]">出題形式</p>
                <p className="mt-2 text-lg font-semibold">{featuredTest?.questionType ?? "未設定"}</p>
              </div>
              <div className="soft-card rounded-[1.4rem] p-5">
                <p className="text-sm text-[var(--ink-soft)]">1問ごとの点数</p>
                <p className="mt-2 text-lg font-semibold">{featuredTest?.pointsPerQuestion ?? 0} 点</p>
              </div>
            </div>

            <div className="mt-5 rounded-[1.4rem] bg-white/78 p-5">
              <p className="text-sm font-semibold text-[var(--ink)]">今日の運用メモ</p>
              <ul className="mt-4 space-y-3 text-sm leading-7 text-[var(--ink-soft)]">
                <li>授業テキストから問題候補を生成し、その場で問題文と選択肢を編集可能</li>
                <li>問題数は最大 10 問まで、選択肢数は 2〜4 を指定可能</li>
                <li>不要な問題は削除か出題除外を選んでから公開する想定</li>
                <li>回答順ランダム化と配点変更に対応する設計</li>
              </ul>
            </div>

            <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[var(--ink)]">保存済みテスト</p>
                <Link href="/teacher/tests/new" className="text-sm font-semibold text-[var(--brand)] transition hover:text-[var(--brand-strong)]">
                  新規作成
                </Link>
              </div>

              {recentTests.length > 0 ? (
                recentTests.map((test) => {
                  const classroom = classes.find((entry) => entry.id === test.classId);

                  return (
                    <div key={test.id} className="soft-card rounded-[1.4rem] p-4">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-semibold text-[var(--ink)]">{test.title}</p>
                          <p className="mt-1 text-sm text-[var(--ink-soft)]">
                            {classroom?.name ?? "クラス未設定"} / {test.date} / {test.status}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Link href={`/teacher/tests/new?testId=${test.id}`} className="rounded-full border border-[rgba(25,35,46,0.12)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-[var(--surface)]">
                            編集
                          </Link>
                          <Link href={`/teacher/results?testId=${test.id}`} className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#101821]">
                            結果
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="soft-card rounded-[1.4rem] p-4 text-sm leading-7 text-[var(--ink-soft)]">
                  まだ保存済みテストがありません。右上のボタンから最初のテストを作成してください。
                </div>
              )}
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}