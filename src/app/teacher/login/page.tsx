import Link from "next/link";
import { redirect } from "next/navigation";

import { TeacherLoginForm } from "@/components/teacher-login-form";
import { getTeacherAuthState } from "@/lib/teacher-auth";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = {
  next?: string | string[];
};

function getNextPath(value?: string | string[]) {
  const nextPath = Array.isArray(value) ? value[0] : value;

  return nextPath && nextPath.startsWith("/teacher") ? nextPath : "/teacher";
}

export default async function TeacherLoginPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams> | SearchParams;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const nextPath = getNextPath(resolvedSearchParams.next);
  const authAvailable = isSupabaseConfigured();

  if (authAvailable) {
    const authState = await getTeacherAuthState();

    if (authState.user) {
      redirect(nextPath);
    }
  }

  return (
    <div className="app-shell">
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 md:px-10">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-[var(--brand)]">
            Teacher Access
          </p>
          <h1 className="font-display mt-2 text-3xl font-semibold">
            先生ログイン
          </h1>
        </div>
        <div className="flex gap-3">
          <Link
            href="/"
            className="rounded-full border border-[rgba(25,35,46,0.12)] px-4 py-2 text-sm font-semibold transition hover:bg-white/70"
          >
            ホーム
          </Link>
          <Link
            href="/student"
            className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--brand-strong)]"
          >
            学生画面
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 pb-16 md:px-10">
        <section className="surface-card rounded-[2rem] p-8">
          <span className="pill">Supabase Auth + RLS</span>
          <h2 className="font-display mt-6 text-4xl font-semibold">
            先生ごとのデータだけを表示するための認証導線です。
          </h2>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-[var(--ink-soft)]">
            ログイン後は、自分のクラス、確認テスト、受験結果だけにアクセスできます。学生側の受験フローはログイン不要のまま維持します。
          </p>
        </section>

        <TeacherLoginForm
          authAvailable={authAvailable}
          nextPath={nextPath}
          demoEmail="teacher@example.com"
          demoPassword="DemoTeacher123!"
        />
      </main>
    </div>
  );
}