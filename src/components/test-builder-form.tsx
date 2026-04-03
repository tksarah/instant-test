"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { ClassRoom, InstantTest, QuizQuestion } from "@/lib/mock-data";
import {
  createEmptyQuestion,
  getSuggestedQuestionCount,
  MAX_QUESTIONS,
  prepareQuestionsForSave,
  resizeChoices,
} from "@/lib/test-question-utils";

type TestBuilderFormProps = {
  classes: ClassRoom[];
  draft: InstantTest;
};

const fieldLabelClass = "text-sm font-semibold text-[var(--ink)]";

type BuilderFormState = {
  id: string;
  title: string;
  category: string;
  classId: string;
  date: string;
  difficulty: InstantTest["difficulty"];
  status: InstantTest["status"];
  choiceCount: InstantTest["choiceCount"];
  pointsPerQuestion: number;
  randomOrder: boolean;
};

function createInitialFormState(draft: InstantTest): BuilderFormState {
  return {
    id: draft.id,
    title: draft.title,
    category: draft.category,
    classId: draft.classId,
    date: draft.date,
    difficulty: draft.difficulty,
    status: draft.status,
    choiceCount: draft.choiceCount,
    pointsPerQuestion: draft.pointsPerQuestion,
    randomOrder: draft.randomOrder,
  };
}

export function TestBuilderForm({ classes, draft }: TestBuilderFormProps) {
  const router = useRouter();
  const [isSaving, startSavingTransition] = useTransition();
  const [isGenerating, startGeneratingTransition] = useTransition();
  const [formState, setFormState] = useState<BuilderFormState>(() =>
    createInitialFormState(draft),
  );
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [sourceText, setSourceText] = useState(draft.sourceText);
  const [questions, setQuestions] = useState<QuizQuestion[]>(draft.questions);
  const [requestedQuestionCount, setRequestedQuestionCount] = useState(
    getSuggestedQuestionCount(draft.questions.length),
  );

  const selectedClassroom = classes.find(
    (classroom) => classroom.id === formState.classId,
  );
  const enabledQuestionCount = questions.filter((question) => question.enabled).length;

  function updateFormState<Key extends keyof BuilderFormState>(
    key: Key,
    value: BuilderFormState[Key],
  ) {
    setFormState((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateQuestion(
    questionId: string,
    updater: (question: QuizQuestion) => QuizQuestion,
  ) {
    setQuestions((current) =>
      current.map((question) =>
        question.id === questionId ? updater(question) : question,
      ),
    );
  }

  function handleChoiceCountChange(value: number) {
    const nextChoiceCount = value === 2 || value === 3 || value === 4 ? value : 4;

    updateFormState("choiceCount", nextChoiceCount);
    setQuestions((current) =>
      current.map((question) => ({
        ...question,
        choices: resizeChoices(question.choices, nextChoiceCount),
        answerIndex: Math.min(question.answerIndex, nextChoiceCount - 1),
      })),
    );
  }

  function handleGenerateQuestions() {
    startGeneratingTransition(async () => {
      setMessage("");
      setErrorMessage("");

      const response = await fetch("/api/tests/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sourceText,
          title: formState.title,
          category: formState.category,
          difficulty: formState.difficulty,
          choiceCount: formState.choiceCount,
          questionCount: requestedQuestionCount,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | { message?: string; questions?: QuizQuestion[] }
        | null;

      if (response.status === 401) {
        setErrorMessage(
          data?.message ?? "セッションが切れました。先生として再ログインしてください。",
        );
        return;
      }

      if (!response.ok || !data?.questions) {
        setErrorMessage(data?.message ?? "問題候補の生成に失敗しました。");
        return;
      }

      setQuestions(data.questions);
      setMessage(
        `${data.questions.length}問の候補を生成しました。必要な箇所を編集してから保存してください。`,
      );
    });
  }

  function handleAddQuestion() {
    setQuestions((current) => {
      if (current.length >= MAX_QUESTIONS) {
        return current;
      }

      return [...current, createEmptyQuestion(formState.choiceCount)];
    });
  }

  function handleDeleteQuestion(questionId: string) {
    setQuestions((current) => current.filter((question) => question.id !== questionId));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    let preparedQuestions: QuizQuestion[];

    try {
      preparedQuestions = prepareQuestionsForSave(questions, formState.choiceCount);
    } catch (error) {
      setMessage("");
      setErrorMessage(
        error instanceof Error ? error.message : "問題の入力内容を確認してください。",
      );
      return;
    }

    if (preparedQuestions.length === 0) {
      setMessage("");
      setErrorMessage("少なくとも1問は問題を作成してください。");
      return;
    }

    const payload = {
      id: formState.id || undefined,
      title: formState.title,
      category: formState.category,
      classId: formState.classId,
      date: formState.date,
      difficulty: formState.difficulty,
      status: formState.status,
      choiceCount: formState.choiceCount,
      pointsPerQuestion: formState.pointsPerQuestion,
      randomOrder: formState.randomOrder,
      sourceText,
      questionType: "選択式",
      questions: preparedQuestions,
    };

    startSavingTransition(async () => {
      setMessage("");
      setErrorMessage("");

      const response = await fetch("/api/tests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => null)) as
        | { message?: string; test?: InstantTest }
        | null;

      if (response.status === 401) {
        setErrorMessage(
          data?.message ?? "セッションが切れました。先生として再ログインしてください。",
        );
        return;
      }

      if (!response.ok) {
        setErrorMessage(data?.message ?? "確認テストの保存に失敗しました。");
        return;
      }

      const nextTestId = data?.test?.id ?? formState.id;

      setMessage("確認テストを保存しました。最新の内容を反映します。");

      if (nextTestId && nextTestId !== formState.id) {
        updateFormState("id", nextTestId);
        router.replace(`/teacher/tests/new?testId=${nextTestId}`);
      }

      router.refresh();
    });
  }

  const previewHref =
    formState.id && selectedClassroom
      ? `/student/session?testId=${formState.id}&classCode=${selectedClassroom.code}&studentName=プレビュー`
      : undefined;

  return (
    <section className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
      <form onSubmit={handleSubmit} className="surface-card rounded-[2rem] p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className={fieldLabelClass}>授業日付</span>
            <input
              className="field"
              onChange={(event) => updateFormState("date", event.target.value)}
              type="date"
              value={formState.date}
            />
          </label>
          <label className="space-y-2">
            <span className={fieldLabelClass}>タイトル</span>
            <input
              className="field"
              onChange={(event) => updateFormState("title", event.target.value)}
              type="text"
              value={formState.title}
            />
          </label>
          <label className="space-y-2">
            <span className={fieldLabelClass}>カテゴリ</span>
            <input
              className="field"
              onChange={(event) => updateFormState("category", event.target.value)}
              type="text"
              value={formState.category}
            />
          </label>
          <label className="space-y-2">
            <span className={fieldLabelClass}>クラス</span>
            <select
              className="field"
              onChange={(event) => updateFormState("classId", event.target.value)}
              value={formState.classId}
            >
              {classes.map((classroom) => (
                <option key={classroom.id} value={classroom.id}>
                  {classroom.name} / {classroom.code}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className={fieldLabelClass}>難易度</span>
            <select
              className="field"
              onChange={(event) =>
                updateFormState(
                  "difficulty",
                  event.target.value as InstantTest["difficulty"],
                )
              }
              value={formState.difficulty}
            >
              <option value="やさしい">やさしい</option>
              <option value="ふつう">ふつう</option>
              <option value="難しい">難しい</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className={fieldLabelClass}>問題形式</span>
            <select className="field" defaultValue={draft.questionType} disabled>
              <option value="選択式">選択式</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className={fieldLabelClass}>生成目標問題数</span>
            <input
              className="field"
              max={MAX_QUESTIONS}
              min={1}
              onChange={(event) =>
                setRequestedQuestionCount(
                  Math.min(
                    MAX_QUESTIONS,
                    Math.max(1, Number(event.target.value) || 1),
                  ),
                )
              }
              type="number"
              value={requestedQuestionCount}
            />
          </label>
          <label className="space-y-2">
            <span className={fieldLabelClass}>選択肢数</span>
            <input
              className="field"
              max={4}
              min={2}
              onChange={(event) => handleChoiceCountChange(Number(event.target.value))}
              type="number"
              value={formState.choiceCount}
            />
          </label>
          <label className="space-y-2">
            <span className={fieldLabelClass}>1問ごとの点数</span>
            <input
              className="field"
              min={1}
              onChange={(event) =>
                updateFormState(
                  "pointsPerQuestion",
                  Math.max(1, Number(event.target.value) || 1),
                )
              }
              type="number"
              value={formState.pointsPerQuestion}
            />
          </label>
          <label className="space-y-2">
            <span className={fieldLabelClass}>公開状態</span>
            <select
              className="field"
              onChange={(event) =>
                updateFormState("status", event.target.value as InstantTest["status"])
              }
              value={formState.status}
            >
              <option value="公開中">公開</option>
              <option value="非公開">非公開</option>
              <option value="下書き">下書き</option>
            </select>
          </label>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="soft-card flex items-center gap-3 rounded-[1.4rem] px-4 py-4 text-sm text-[var(--ink-soft)]">
            <input
              checked={formState.randomOrder}
              onChange={(event) => updateFormState("randomOrder", event.target.checked)}
              type="checkbox"
            />
            問題をランダム順で出題する
          </label>
          <label className="soft-card flex items-center gap-3 rounded-[1.4rem] px-4 py-4 text-sm text-[var(--ink-soft)]">
            <input defaultChecked type="checkbox" disabled />
            回答直後に解説を表示する
          </label>
        </div>

        <div className="mt-5 rounded-[1.6rem] bg-white/78 p-5">
          <p className="text-sm font-semibold text-[var(--ink)]">教育特化プロンプト設計</p>
          <ul className="mt-4 space-y-3 text-sm leading-7 text-[var(--ink-soft)]">
            <li>授業テキストから重要概念だけを抽出し、出題しすぎを防ぐ</li>
            <li>正答の根拠が説明できる 4 択問題を優先生成する</li>
            <li>誤答選択肢は紛らわしいが授業内容と矛盾しないものを使う</li>
            <li>難易度に応じて語彙やひっかけの強さを調整する</li>
          </ul>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white transition enabled:hover:bg-[#101821] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? "保存中..." : "下書きを保存"}
          </button>
          {previewHref ? (
            <Link
              href={previewHref}
              className="rounded-full border border-[rgba(25,35,46,0.12)] bg-white/75 px-5 py-3 text-center text-sm font-semibold transition hover:bg-white"
            >
              学生プレビューを開く
            </Link>
          ) : (
            <button
              type="button"
              className="rounded-full border border-[rgba(25,35,46,0.12)] bg-white/75 px-5 py-3 text-sm font-semibold transition hover:bg-white"
              onClick={() => {
                setMessage("プレビューは一度保存すると開けます。");
                setErrorMessage("");
              }}
            >
              学生プレビューを開く
            </button>
          )}
        </div>

        {message ? <p className="mt-4 text-sm text-[var(--success)]">{message}</p> : null}
        {errorMessage ? <p className="mt-4 text-sm text-[var(--danger)]">{errorMessage}</p> : null}
      </form>

      <div className="space-y-6">
        <article className="surface-card rounded-[2rem] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                授業テキスト
              </p>
              <h3 className="font-display mt-2 text-2xl font-semibold">生成元コンテンツ</h3>
            </div>
            <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">
              {formState.category || "カテゴリ未設定"}
            </span>
          </div>
          <textarea
            className="field mt-5 min-h-48 resize-none leading-7"
            onChange={(event) => setSourceText(event.target.value)}
            value={sourceText}
          />
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-7 text-[var(--ink-soft)]">
              生成時は現在の候補を置き換えます。必要な箇所は右側で直接編集できます。
            </p>
            <button
              type="button"
              onClick={handleGenerateQuestions}
              disabled={isGenerating || !sourceText.trim()}
              className="rounded-full bg-[var(--brand)] px-5 py-3 text-sm font-semibold text-white transition enabled:hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isGenerating ? "生成中..." : "授業テキストから問題生成"}
            </button>
          </div>
        </article>

        <article className="surface-card rounded-[2rem] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                生成問題プレビュー
              </p>
              <h3 className="font-display mt-2 text-2xl font-semibold">編集・削除・出題除外の確認</h3>
            </div>
            <span className="text-sm text-[var(--ink-soft)]">
              {enabledQuestionCount} / {questions.length} 問が出題対象
            </span>
          </div>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-7 text-[var(--ink-soft)]">
              問題文、選択肢、正答、解説をそのまま編集できます。不要な問題は削除か除外を選んでください。
            </p>
            <button
              type="button"
              onClick={handleAddQuestion}
              disabled={questions.length >= MAX_QUESTIONS}
              className="rounded-full border border-[rgba(25,35,46,0.12)] bg-white px-4 py-2 text-sm font-semibold transition enabled:hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              問題を追加
            </button>
          </div>
          <div className="mt-5 space-y-4">
            {questions.length > 0 ? (
              questions.map((question, index) => (
                <article key={question.id} className="soft-card rounded-[1.6rem] p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="font-display rounded-full bg-[var(--accent-soft)] px-3 py-1 text-sm font-semibold text-[var(--accent)]">
                          Q{index + 1}
                        </span>
                        <span className="text-sm text-[var(--ink-soft)]">
                          {question.enabled ? "出題対象" : "除外中"}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--ink-soft)]">
                      <label className="flex items-center gap-2">
                        <input
                          checked={question.enabled}
                          onChange={(event) =>
                            updateQuestion(question.id, (current) => ({
                              ...current,
                              enabled: event.target.checked,
                            }))
                          }
                          type="checkbox"
                        />
                        出題する
                      </label>
                      <button
                        type="button"
                        onClick={() => handleDeleteQuestion(question.id)}
                        className="rounded-full border border-[rgba(25,35,46,0.12)] bg-white px-3 py-1.5 font-semibold text-[var(--ink)] transition hover:bg-[var(--surface)]"
                      >
                        削除
                      </button>
                    </div>
                  </div>

                  <label className="mt-4 block space-y-2">
                    <span className={fieldLabelClass}>問題文</span>
                    <textarea
                      className="field min-h-28 resize-y leading-7"
                      onChange={(event) =>
                        updateQuestion(question.id, (current) => ({
                          ...current,
                          prompt: event.target.value,
                        }))
                      }
                      value={question.prompt}
                    />
                  </label>

                  <ol className="mt-4 grid gap-3 md:grid-cols-2">
                    {question.choices.map((choice, choiceIndex) => (
                      <li
                        key={`${question.id}-${choiceIndex}`}
                        className="rounded-[1.1rem] border border-[rgba(25,35,46,0.08)] bg-white/85 p-4 text-sm leading-7 text-[var(--ink-soft)]"
                      >
                        <label className="space-y-2">
                          <span className="font-semibold text-[var(--ink)]">
                            選択肢 {String.fromCharCode(65 + choiceIndex)}
                          </span>
                          <input
                            className="field"
                            onChange={(event) =>
                              updateQuestion(question.id, (current) => {
                                const nextChoices = [...current.choices];

                                nextChoices[choiceIndex] = event.target.value;

                                return {
                                  ...current,
                                  choices: nextChoices,
                                };
                              })
                            }
                            type="text"
                            value={choice}
                          />
                        </label>
                        <label className="mt-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                          <input
                            checked={question.answerIndex === choiceIndex}
                            onChange={() =>
                              updateQuestion(question.id, (current) => ({
                                ...current,
                                answerIndex: choiceIndex,
                              }))
                            }
                            name={`answer-${question.id}`}
                            type="radio"
                          />
                          この選択肢を正答にする
                        </label>
                      </li>
                    ))}
                  </ol>

                  <label className="mt-4 block space-y-2">
                    <span className={fieldLabelClass}>解説</span>
                    <textarea
                      className="field min-h-24 resize-y leading-7"
                      onChange={(event) =>
                        updateQuestion(question.id, (current) => ({
                          ...current,
                          explanation: event.target.value,
                        }))
                      }
                      value={question.explanation}
                    />
                  </label>
                </article>
              ))
            ) : (
              <div className="soft-card rounded-[1.6rem] p-5 text-sm leading-7 text-[var(--ink-soft)]">
                まだ問題がありません。授業テキストから生成するか、上のボタンから手動で追加してください。
              </div>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}