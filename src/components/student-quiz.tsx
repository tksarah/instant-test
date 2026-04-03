"use client";

import { useState, useTransition } from "react";

import type { InstantTest } from "@/lib/mock-data";

type StudentQuizProps = {
  classroomName: string;
  classCode: string;
  studentName: string;
  test: InstantTest;
};

export function StudentQuiz({
  classroomName,
  classCode,
  studentName,
  test,
}: StudentQuizProps) {
  const questions = test.questions.filter((question) => question.enabled);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const isFinished = currentIndex >= questions.length;
  const currentQuestion = questions[currentIndex];
  const selectedAnswer = answers[currentIndex];
  const correctCount = questions.reduce((total, question, index) => {
    return total + (answers[index] === question.answerIndex ? 1 : 0);
  }, 0);
  const score = correctCount * test.pointsPerQuestion;

  function submitAttempt(answerSet: number[]) {
    startTransition(async () => {
      setSaveState("saving");
      setSaveMessage("");

      const finalCorrectCount = questions.reduce((total, question, index) => {
        return total + (answerSet[index] === question.answerIndex ? 1 : 0);
      }, 0);

      const response = await fetch("/api/attempts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          testId: test.id,
          classCode,
          studentName,
          score: finalCorrectCount * test.pointsPerQuestion,
          correctCount: finalCorrectCount,
          answers: answerSet,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;

      if (!response.ok) {
        setSaveState("error");
        setSaveMessage(data?.message ?? "結果の保存に失敗しました。");
        return;
      }

      setSaveState("saved");
      setSaveMessage("受験結果を保存しました。先生の集計画面に反映されます。");
    });
  }

  function selectAnswer(choiceIndex: number) {
    if (revealed) {
      return;
    }

    setAnswers((current) => {
      const next = [...current];
      next[currentIndex] = choiceIndex;
      return next;
    });
  }

  function revealAnswer() {
    if (selectedAnswer === undefined) {
      return;
    }

    setRevealed(true);
  }

  function moveNext() {
    if (!revealed) {
      return;
    }

    if (currentIndex === questions.length - 1) {
      if (saveState === "idle") {
        submitAttempt(answers);
      }

      setCurrentIndex(questions.length);
      return;
    }

    setCurrentIndex((value) => value + 1);
    setRevealed(false);
  }

  function restart() {
    setAnswers([]);
    setCurrentIndex(0);
    setRevealed(false);
    setSaveState("idle");
    setSaveMessage("");
  }

  if (isFinished) {
    return (
      <section className="surface-card rounded-[2rem] p-8">
        <span className="pill">受験完了</span>
        <h2 className="font-display mt-6 text-4xl font-semibold">{studentName} さんの結果</h2>
        <p className="mt-4 text-lg leading-8 text-[var(--ink-soft)]">
          {classroomName} / {test.title} の受験が完了しました。回答内容は保存後に先生の集計画面へ反映されます。
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="soft-card rounded-[1.5rem] p-5">
            <p className="text-sm text-[var(--ink-soft)]">総合点</p>
            <p className="kpi-number mt-3">{score}</p>
          </div>
          <div className="soft-card rounded-[1.5rem] p-5">
            <p className="text-sm text-[var(--ink-soft)]">正答数</p>
            <p className="kpi-number mt-3">
              {correctCount}/{questions.length}
            </p>
          </div>
          <div className="soft-card rounded-[1.5rem] p-5">
            <p className="text-sm text-[var(--ink-soft)]">1問あたり</p>
            <p className="kpi-number mt-3">{test.pointsPerQuestion}</p>
          </div>
        </div>

        <div className="mt-8 rounded-[1.6rem] bg-white/80 p-5">
          <p className="text-sm font-semibold text-[var(--ink)]">見直しメモ</p>
          <ul className="mt-4 space-y-3 text-sm leading-7 text-[var(--ink-soft)]">
            {questions.map((question, index) => {
              const isCorrect = answers[index] === question.answerIndex;

              return (
                <li key={question.id} className="rounded-[1rem] border border-[rgba(25,35,46,0.08)] px-4 py-3">
                  <span className={isCorrect ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                    {isCorrect ? "正解" : "要復習"}
                  </span>{" "}
                  {question.prompt}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mt-6 rounded-[1.4rem] bg-[var(--surface-strong)] px-4 py-4 text-sm leading-7 text-[var(--ink-soft)]">
          <p className="font-semibold text-[var(--ink)]">保存状況</p>
          <p className="mt-2">
            {saveState === "saved"
              ? saveMessage
              : saveState === "error"
                ? saveMessage
                : saveState === "saving" || isPending
                  ? "受験結果を保存しています..."
                  : "結果画面に入ると保存を開始します。"}
          </p>
          {saveState === "error" ? (
            <button
              type="button"
              onClick={() => submitAttempt(answers)}
              className="mt-4 rounded-full border border-[rgba(25,35,46,0.12)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface)]"
            >
              もう一度保存する
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={restart}
          className="mt-8 rounded-full bg-[var(--brand)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--brand-strong)]"
        >
          もう一度解く
        </button>
      </section>
    );
  }

  const progress = Math.round((currentIndex / questions.length) * 100);
  const isCorrect = selectedAnswer === currentQuestion.answerIndex;

  return (
    <section className="surface-card rounded-[2rem] p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <span className="pill">
            {classroomName} / {studentName}
          </span>
          <h2 className="font-display mt-5 text-4xl font-semibold">{test.title}</h2>
          <p className="mt-3 text-sm leading-7 text-[var(--ink-soft)]">
            回答後に正答と解説を表示し、確認したら次の問題へ進みます。
          </p>
        </div>
        <div className="min-w-52 rounded-[1.4rem] bg-white/75 p-4">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-soft)]">
            <span>進行状況</span>
            <span>
              {currentIndex + 1}/{questions.length}
            </span>
          </div>
          <div className="mt-3 h-2 rounded-full bg-[rgba(25,35,46,0.08)]">
            <div
              className="h-2 rounded-full bg-[var(--brand)] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-[1.8rem] bg-white/82 p-6">
        <div className="flex items-center justify-between gap-4">
          <span className="font-display text-sm font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">
            Question {currentIndex + 1}
          </span>
          <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">
            {test.pointsPerQuestion} 点
          </span>
        </div>

        <h3 className="mt-4 text-2xl font-semibold leading-10 text-[var(--ink)]">
          {currentQuestion.prompt}
        </h3>

        <div className="mt-6 grid gap-3">
          {currentQuestion.choices.map((choice, choiceIndex) => {
            const selected = selectedAnswer === choiceIndex;
            const shouldHighlightCorrect = revealed && choiceIndex === currentQuestion.answerIndex;
            const shouldHighlightWrong =
              revealed && selected && choiceIndex !== currentQuestion.answerIndex;

            return (
              <button
                key={`${currentQuestion.id}-${choice}`}
                type="button"
                onClick={() => selectAnswer(choiceIndex)}
                className={`rounded-[1.3rem] border px-4 py-4 text-left text-sm leading-7 transition ${
                  shouldHighlightCorrect
                    ? "border-[var(--success)] bg-[rgba(47,158,68,0.10)]"
                    : shouldHighlightWrong
                      ? "border-[var(--danger)] bg-[rgba(195,66,85,0.10)]"
                      : selected
                        ? "border-[var(--brand)] bg-[rgba(31,122,114,0.10)]"
                        : "border-[rgba(25,35,46,0.08)] bg-white hover:border-[rgba(25,35,46,0.18)]"
                }`}
              >
                <span className="font-semibold text-[var(--ink)]">{String.fromCharCode(65 + choiceIndex)}.</span>{" "}
                <span className="text-[var(--ink-soft)]">{choice}</span>
              </button>
            );
          })}
        </div>

        {revealed ? (
          <div className="mt-6 rounded-[1.4rem] bg-[var(--surface-strong)] p-5">
            <p className={`text-sm font-semibold ${isCorrect ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
              {isCorrect ? "正解です" : "不正解です"}
            </p>
            <p className="mt-3 text-sm leading-7 text-[var(--ink-soft)]">
              正答: {currentQuestion.choices[currentQuestion.answerIndex]}
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">{currentQuestion.explanation}</p>
          </div>
        ) : null}
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={revealAnswer}
          disabled={selectedAnswer === undefined || revealed}
          className="rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white transition enabled:hover:bg-[#101821] disabled:cursor-not-allowed disabled:opacity-40"
        >
          正答と解説を見る
        </button>
        <button
          type="button"
          onClick={moveNext}
          disabled={!revealed}
          className="rounded-full border border-[rgba(25,35,46,0.12)] bg-white/75 px-5 py-3 text-sm font-semibold transition enabled:hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {currentIndex === questions.length - 1 ? "結果を見る" : "次の問題へ"}
        </button>
      </div>
    </section>
  );
}