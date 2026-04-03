"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function ClassRegistrationForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
      name: String(formData.get("name") ?? ""),
      code: String(formData.get("code") ?? ""),
      subject: String(formData.get("subject") ?? ""),
      studentCount: Number(formData.get("studentCount") ?? 0),
      homeroomTeacher: String(formData.get("homeroomTeacher") ?? ""),
      schedule: String(formData.get("schedule") ?? ""),
    };

    startTransition(async () => {
      setMessage("");
      setErrorMessage("");

      const response = await fetch("/api/classes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;

      if (response.status === 401) {
        setErrorMessage(
          data?.message ?? "セッションが切れました。先生として再ログインしてください。",
        );
        return;
      }

      if (!response.ok) {
        setErrorMessage(data?.message ?? "クラス登録に失敗しました。");
        return;
      }

      form.reset();
      setMessage("クラスを保存しました。ダッシュボードの一覧を更新します。");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="soft-card mt-5 rounded-[1.4rem] p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--ink)]">クラス登録</p>
          <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
            クラスコードを保存すると、学生入口で利用できます。
          </p>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white transition enabled:hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "保存中..." : "クラスを追加"}
        </button>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="space-y-2">
          <span className="text-sm font-semibold text-[var(--ink)]">クラス名</span>
          <input name="name" className="field" defaultValue="3年C組" required type="text" />
        </label>
        <label className="space-y-2">
          <span className="text-sm font-semibold text-[var(--ink)]">クラスコード</span>
          <input name="code" className="field" defaultValue="MATH3C" required type="text" />
        </label>
        <label className="space-y-2">
          <span className="text-sm font-semibold text-[var(--ink)]">教科</span>
          <input name="subject" className="field" defaultValue="数学" type="text" />
        </label>
        <label className="space-y-2">
          <span className="text-sm font-semibold text-[var(--ink)]">在籍人数</span>
          <input name="studentCount" className="field" defaultValue={30} min={0} type="number" />
        </label>
        <label className="space-y-2">
          <span className="text-sm font-semibold text-[var(--ink)]">担当</span>
          <input name="homeroomTeacher" className="field" defaultValue="伊藤 先生" type="text" />
        </label>
        <label className="space-y-2">
          <span className="text-sm font-semibold text-[var(--ink)]">授業枠</span>
          <input name="schedule" className="field" defaultValue="2026/04/10 4限" type="text" />
        </label>
      </div>

      {message ? <p className="mt-4 text-sm text-[var(--success)]">{message}</p> : null}
      {errorMessage ? <p className="mt-4 text-sm text-[var(--danger)]">{errorMessage}</p> : null}
    </form>
  );
}