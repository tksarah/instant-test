# InstantTest

InstantTest は、教師がテストを作成・配布し、生徒が受験して結果を確認できるローカル実行のプロトタイプです。

現在の実装（要点）
- サーバー: Node.js + Express
- DB: SQLite（保存ファイル: `server/data.sqlite`）
- フロントエンド: サーバーから配信される静的ファイル（`server/public/`）
- AI 統合: `server/geminiAi.js` を通じて Google Gemini API を利用（`GEMINI_API_KEY` 必須）

クイックスタート
1. Node.js がインストールされていることを確認してください（推奨 Node.js 16+）。
2. 依存関係をインストール:

```powershell
cd server
npm install
```

3. 環境変数を設定してサーバーを起動:

```powershell
# 管理用パスワード（管理者APIを使う場合）
$env:ADMIN_PASSWORD="<管理者パスワード>"

# AI 生成を使う場合（任意）：Google Gemini の API キー
$env:GEMINI_API_KEY="<Gemini API Key>"

# 任意で使用する Gemini モデルを上書き
$env:GEMINI_MODEL="gemini-2.5-flash-lite"

node index.js
```

4. ブラウザで開く: http://localhost:3000

主要な環境変数
- `PORT` — サーバーの待ち受けポート（デフォルト: `3000`）
- `ADMIN_PASSWORD` — 管理者操作（`/api/admin/*`）で必要。管理APIはリクエストヘッダ `x-admin-password` で送ります。
- `GEMINI_API_KEY` — AI 生成機能を有効にするために必要（設定がないと `/api/generate-questions` はエラーになります）
- `GEMINI_MODEL` — 使用する Gemini モデル（省略時は `gemini-2.5-flash-lite`）

プロジェクト構成（抜粋）
- `server/` — サーバーコード、API、DB 初期化、管理スクリプト
	- `server/index.js` — エントリーポイント
	- `server/db.js` — SQLite 初期化とスキーマ
	- `server/geminiAi.js` — Gemini 呼び出しラッパー
	- `server/mockAi.js` — ローカル用の簡易モック（現在ルートで使用されていません）
	- `server/public/` — フロントエンド静的ファイル
	- `server/scripts/` — バックフィル/メンテ用スクリプト
- `public/` — 教師用テーマやサンプルスタイル（ハイコントラスト等）

開発・運用上の注意
- AI 生成は `GEMINI_API_KEY` を用いて外部 API にアクセスします。ローカルで試す場合はキー管理に注意してください。
- 管理 API は `ADMIN_PASSWORD` を環境変数で設定し、リクエストヘッダ `x-admin-password` に同値を送る形で保護しています（プロトタイプとして簡易実装）。
- 教師のログイン状態は `teacher_session` という HttpOnly クッキーで管理されます。
- 本番公開前に認証、TLS、入力検証、レート制限、監査ログ等の対策を必ず実施してください。

参考ファイル
- サーバー: [server/index.js](server/index.js)
- DB 初期化: [server/db.js](server/db.js)
- API 仕様: [SPEC.md](SPEC.md)
- UI/UX 設計: [DESIGN.md](DESIGN.md)

テストとスクリプト
- 簡易テストスクリプト: `server/test_*.js`
- メンテナンス用スクリプト: `server/scripts/` 内の各スクリプト

ライセンス
プロトタイプ用途で利用してください。変更・配布は自由ですが、安全対策は自己責任で行ってください。
