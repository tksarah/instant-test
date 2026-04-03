"use client";

import { useActionState } from "react";

import {
  signInTeacher,
  signUpTeacher,
  type TeacherAuthFormState,
} from "@/app/teacher/login/actions";

const initialTeacherAuthFormState: TeacherAuthFormState = {
  status: "idle",
  message: "",
};

type TeacherLoginFormProps = {
  authAvailable: boolean;
  nextPath: string;
  demoEmail: string;
  demoPassword: string;
};

function MessageBlock({
  message,
  tone,
}: {
  message: string;
  tone: "error" | "success";
}) {
  return (
    <p
      className={`mt-4 text-sm ${
        tone === "error" ? "text-[var(--danger)]" : "text-[var(--success)]"
      }`}
    >
      {message}
    </p>
  );
}

export function TeacherLoginForm({
  authAvailable,
  nextPath,
  demoEmail,
  demoPassword,
}: TeacherLoginFormProps) {
  const [signInState, signInAction, signInPending] = useActionState(
    signInTeacher,
    initialTeacherAuthFormState,
  );
  const [signUpState, signUpAction, signUpPending] = useActionState(
    signUpTeacher,
    initialTeacherAuthFormState,
  );

  if (!authAvailable) {
    return (
      <section className="surface-card rounded-[2rem] p-8">
        <span className="pill">Supabase 未設定</span>
        <h2 className="font-display mt-6 text-4xl font-semibold">
          現在はログインなしで先生画面を利用できます。
        </h2>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--ink-soft)]">
          Supabase URL と公開キーが未設定のため、認証保護は有効になっていません。設定が整っていない間は既存のローカルモードのまま動作します。
        </p>
      </section>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="surface-card rounded-[2rem] p-6">
        <div className="rounded-[1.5rem] bg-[var(--surface-strong)] p-4 text-sm leading-7 text-[var(--ink-soft)]">
          <p className="font-semibold text-[var(--ink)]">ローカル確認用 demo 教員</p>
          <p className="mt-2">メール: {demoEmail}</p>
          <p>パスワード: {demoPassword}</p>
        </div>

        <form action={signInAction} className="mt-6 space-y-4">
          <input type="hidden" name="next" value={nextPath} />
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-[var(--ink)]">
              メールアドレス
            </span>
            <input
              className="field"
              defaultValue={demoEmail}
              name="email"
              required
              type="email"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-[var(--ink)]">
              パスワード
            </span>
            <input
              className="field"
              defaultValue={demoPassword}
              name="password"
              required
              type="password"
            />
          </label>
          <button
            type="submit"
            disabled={signInPending}
            className="w-full rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white transition enabled:hover:bg-[#101821] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {signInPending ? "ログイン中..." : "先生としてログイン"}
          </button>
        </form>

        {signInState.message ? (
          <MessageBlock
            message={signInState.message}
            tone={signInState.status === "error" ? "error" : "success"}
          />
        ) : null}
      </section>

      <section className="surface-card rounded-[2rem] p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
          新規教員登録
        </p>
        <h2 className="font-display mt-3 text-2xl font-semibold">
          自分の先生アカウントを作成
        </h2>
        <p className="mt-3 text-sm leading-7 text-[var(--ink-soft)]">
          作成後は自分のクラス、テスト、受験結果だけが表示されます。ローカル Supabase ではメール確認なしでそのままログインできます。
        </p>

        <form action={signUpAction} className="mt-6 space-y-4">
          <input type="hidden" name="next" value={nextPath} />
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-[var(--ink)]">
              表示名
            </span>
            <input className="field" name="displayName" required type="text" />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-[var(--ink)]">
              メールアドレス
            </span>
            <input className="field" name="email" required type="email" />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-[var(--ink)]">
              パスワード
            </span>
            <input className="field" minLength={6} name="password" required type="password" />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-[var(--ink)]">
              パスワード確認
            </span>
            <input
              className="field"
              minLength={6}
              name="confirmPassword"
              required
              type="password"
            />
          </label>
          <button
            type="submit"
            disabled={signUpPending}
            className="w-full rounded-full bg-[var(--brand)] px-5 py-3 text-sm font-semibold text-white transition enabled:hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {signUpPending ? "作成中..." : "先生アカウントを作成"}
          </button>
        </form>

        {signUpState.message ? (
          <MessageBlock
            message={signUpState.message}
            tone={signUpState.status === "error" ? "error" : "success"}
          />
        ) : null}
      </section>
    </div>
  );
}