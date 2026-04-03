import { signOutTeacher } from "@/app/teacher/login/actions";

type TeacherSessionSummaryProps = {
  authRequired: boolean;
  displayName?: string;
  email?: string;
};

export function TeacherSessionSummary({
  authRequired,
  displayName,
  email,
}: TeacherSessionSummaryProps) {
  if (!authRequired) {
    return (
      <div className="rounded-[1.4rem] bg-white/78 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
        Local JSON Mode
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="rounded-[1.4rem] bg-white/78 px-4 py-3 text-right">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">
          Signed in
        </p>
        <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
          {displayName ?? "Teacher"}
        </p>
        {email ? (
          <p className="mt-1 text-xs text-[var(--ink-soft)]">{email}</p>
        ) : null}
      </div>
      <form action={signOutTeacher}>
        <button
          type="submit"
          className="rounded-full border border-[rgba(25,35,46,0.12)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-[var(--surface)]"
        >
          ログアウト
        </button>
      </form>
    </div>
  );
}