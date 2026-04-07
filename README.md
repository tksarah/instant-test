# InstantTest

InstantTest は、教師がテストを作成・配布し、生徒が受験して結果を確認できるローカル実行のプロトタイプです。

**目的**: クラス単位の簡易テスト作成／配布ワークフローを素早く検証することを主眼にしています。

---

## すばやい開始手順 (PowerShell / macOS/Linux シェル共通)

1. Node.js がインストールされていることを確認（推奨: Node.js 16+）。
2. サーバーディレクトリへ移動して依存をインストール:

```bash
cd server
npm install
```

3. 環境変数を設定（`.env` を `server/.env` に作成するか、シェルで設定）

例 (PowerShell):
```powershell
copy .env.example .env
$env:ADMIN_PASSWORD="your_admin_password"
# 任意: Gemini API キー
$env:GEMINI_API_KEY="<your_gemini_api_key>"
node index.js
```

例 (macOS / Linux):
```bash
cp .env.example .env
export ADMIN_PASSWORD=your_admin_password
# 任意: export GEMINI_API_KEY=<your_gemini_api_key>
node index.js
```

4. ブラウザで開く: http://localhost:3000

---

## 主要な環境変数
- `PORT` — サーバー待ち受けポート（デフォルト: `3000`）
- `ADMIN_PASSWORD` — 管理（`/api/admin/*`）用パスワード。API リクエストではヘッダ `x-admin-password` を送ります。
- `GEMINI_API_KEY` — Google Gemini を用いる場合に設定（未設定だと `/api/generate-questions` は失敗します）
- `GEMINI_MODEL` — 使用する Gemini モデル（省略時は `gemini-2.5-flash-lite`）

---

## テストと検証スクリプト
`server/` 配下には簡易検証用のスクリプトがあり、ローカル環境で API の挙動を確認できます。例:

```bash
cd server
node test_api.js
node test_student_flow.js
```

これらは実装の簡易チェック用スクリプトです。より体系的なテストフレームワークは未導入です。

---

## プロジェクト構成（抜粋）
- `server/` — サーバー、API、DB 初期化、スクリプト
  - [server/index.js](server/index.js) — エントリーポイント
  - [server/db.js](server/db.js) — SQLite スキーマと初期化
  - [server/geminiAi.js](server/geminiAi.js) — Gemini 呼び出しラッパー
  - `server/public/` — フロントエンド静的ファイル（`app.html`, `create_test.html` 等）
- `public/` — 教師向けのテーマサンプル（ハイコントラスト等）

---

## 開発・運用上の注意
- このリポジトリはプロトタイプです。本番運用前に認証強化、TLS、入力検証、レート制限、監査ログ等の対策を必須で行ってください。
- 教師の認証は `teacher_session`（HttpOnly クッキー）で管理されます。管理 API は `ADMIN_PASSWORD` 環境変数と `x-admin-password` ヘッダで保護しています。
- データは `server/data.sqlite` に保存されます。バックアップ・移行を運用で検討してください。

---

## 参考
- API 仕様: [SPEC.md](SPEC.md)
- UI/UX 設計: [DESIGN.md](DESIGN.md)
- サーバー実装: [server/index.js](server/index.js)

---

## ライセンス
プロトタイプ用途で利用してください。変更・配布は自由ですが、安全対策は自己責任で行ってください。
