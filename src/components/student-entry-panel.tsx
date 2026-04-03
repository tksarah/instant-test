"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { AvailableTestCard } from "@/lib/data";

type StudentEntryPanelProps = {
  availableTests: AvailableTestCard[];
  primaryClassCode: string;
};

function buildSessionHref(
  testId: string,
  classCode: string,
  studentName: string,
) {
  const params = new URLSearchParams({
    testId,
    classCode,
    studentName,
  });

  return `/student/session?${params.toString()}`;
}

export function StudentEntryPanel({
  availableTests,
  primaryClassCode,
}: StudentEntryPanelProps) {
  const [classCode, setClassCode] = useState(primaryClassCode);
  const [studentName, setStudentName] = useState("体験ユーザー");
  const [isFiltered, setIsFiltered] = useState(false);

  const normalizedClassCode = classCode.trim().toUpperCase();

  const filteredTests = useMemo(() => {
    if (!isFiltered || !normalizedClassCode) {
      return availableTests;
    }

    return availableTests.filter(
      (entry) => entry.classroom?.code === normalizedClassCode,
    );
  }, [availableTests, isFiltered, normalizedClassCode]);

  const startStudentName = studentName.trim() || "体験ユーザー";

  return (
    <>
      <section className="surface-card rounded-[2rem] p-8">
        <span className="pill">QR からアクセスした想定の入口画面</span>
        <h2 className="font-display mt-6 text-4xl font-semibold">
          クラスコードと名前だけで参加
        </h2>
        <p className="mt-5 text-lg leading-8 text-[var(--ink-soft)]">
          ログインは不要です。該当クラスのコードと名前を入力すると、その場で受験可能な確認テストが一覧表示されます。
        </p>

        <form
          className="mt-8 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setIsFiltered(true);
          }}
        >
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-[var(--ink)]">クラスコード</span>
            <input
              className="field"
              onChange={(event) => setClassCode(event.target.value)}
              type="text"
              value={classCode}
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-[var(--ink)]">名前</span>
            <input
              className="field"
              onChange={(event) => setStudentName(event.target.value)}
              type="text"
              value={studentName}
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#101821]"
          >
            利用可能なテストを表示
          </button>
        </form>
      </section>

      <section className="space-y-6">
        <article className="surface-card rounded-[2rem] p-6">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
              利用可能な確認テスト
            </p>
            {isFiltered ? (
              <span className="text-sm text-[var(--ink-soft)]">
                絞り込み中: {normalizedClassCode || "全クラス"}
              </span>
            ) : null}
          </div>

          <div className="mt-5 space-y-4">
            {filteredTests.length > 0 ? (
              filteredTests.map((entry) => (
                <div key={entry.test.id} className="soft-card rounded-[1.5rem] p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-lg font-semibold text-[var(--ink)]">{entry.test.title}</p>
                      <p className="mt-1 text-sm text-[var(--ink-soft)]">
                        {entry.test.category} / {entry.test.difficulty} / {entry.enabledQuestionCount} 問
                      </p>
                      <p className="mt-1 text-sm text-[var(--ink-soft)]">
                        対象クラス: {entry.classroom?.name ?? "未設定"} ({entry.classroom?.code ?? "----"})
                      </p>
                    </div>
                    <Link
                      href={buildSessionHref(
                        entry.test.id,
                        normalizedClassCode || entry.classroom?.code || primaryClassCode,
                        startStudentName,
                      )}
                      className="rounded-full bg-[var(--brand)] px-5 py-3 text-center text-sm font-semibold text-white transition hover:bg-[var(--brand-strong)]"
                    >
                      このテストを解く
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <div className="soft-card rounded-[1.5rem] p-5 text-sm leading-7 text-[var(--ink-soft)]">
                入力したクラスコードに一致する公開テストがありません。クラスコードを確認するか、先生側で公開設定を見直してください。
              </div>
            )}
          </div>
        </article>

        <article className="surface-card rounded-[2rem] p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">受験フロー</p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {[
              "クラスコードと名前を入力",
              "受ける確認テストを選択",
              "1 問ずつ答えて結果を確認",
            ].map((step, index) => (
              <div key={step} className="soft-card rounded-[1.4rem] p-5">
                <p className="font-display text-2xl font-semibold text-[var(--accent)]">0{index + 1}</p>
                <p className="mt-3 text-sm leading-7 text-[var(--ink-soft)]">{step}</p>
              </div>
            ))}
          </div>
        </article>
      </section>
    </>
  );
}