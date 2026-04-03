"use client";

import { QRCodeSVG } from "qrcode.react";

type AccessQrProps = {
  path: string;
  classCode: string;
};

export function AccessQr({ path, classCode }: AccessQrProps) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const url = `${baseUrl}${path}`;

  return (
    <aside className="surface-card rounded-[2rem] p-6">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
        学生アクセス QR
      </p>
      <div className="mt-5 flex flex-col items-center gap-4 rounded-[1.6rem] bg-white/90 p-5 text-center">
        <QRCodeSVG bgColor="transparent" fgColor="#19232e" size={180} value={url} />
        <div>
          <p className="text-sm font-semibold text-[var(--ink)]">
            クラスコード: {classCode}
          </p>
          <p className="mt-2 max-w-xs text-sm leading-6 text-[var(--ink-soft)]">
            学生は QR から学生画面に入り、クラスコードと名前のみで受験します。
          </p>
        </div>
      </div>
      <div className="mt-4 rounded-[1.2rem] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--ink-soft)]">
        生成先 URL: {url}
      </div>
    </aside>
  );
}