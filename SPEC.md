# SPEC — 仕様・アーキテクチャ

概要
- InstantTest はローカルで動作するプロトタイプです。サーバーは Node.js（Express）、データは SQLite、フロントエンドは静的に提供される最小Reactベースです。

技術スタック
- サーバー: Node.js + Express
- データベース: SQLite（ファイル: `server/data.sqlite`）
- フロントエンド: React（軽量なDOM生成）、静的ファイルは `server/public/` に配置
- 依存: `express`, `cors`, `sqlite3`, `qrcode` 等（`server/package.json` を参照）

フォルダ構成（抜粋）
- `server/` — サーバーとAPI、DB初期化、スクリプト
- `server/public/` — フロントエンド静的ファイル
- `public/` — テーマやサンプルの静的アセット（教員向けテーマなど）

データモデル（主なテーブル）
- `classes` (id, name)
- `tests` (id, class_id, name, description, public, randomize)
- `questions` (id, test_id, type, text, points, public, explanation)
- `choices` (id, question_id, text, is_correct)
- `students` (id, class_id, name, code)
- `student_answers` (id, student_id, test_id, question_id, choice_id, correct, session_id)
- `exam_sessions` (id, student_id, test_id, started_at, finished_at, duration_sec, score, max_score, percent, status)

主要APIエンドポイント（抜粋）
- `GET /api/health` — ヘルスチェック
- `GET /api/qr-code?text=...` — QRコードのDataURLを返す

- Classes
  - `POST /api/classes` — クラス作成
  - `GET /api/classes` — 一覧取得
  - `PUT /api/classes/:id` — 更新
  - `DELETE /api/classes/:id` — 削除（依存がある場合は `?cascade=1` で関連データも削除）

- Tests
  - `POST /api/tests` — テスト作成
  - `GET /api/tests` — フィルタ付き一覧（`class_id`, `public`）
  - `PUT /api/tests/:id` — 更新（`class_id` はオプション）
  - `DELETE /api/tests/:id` — 削除（依存がある場合は `?cascade=1`）

- Questions / Choices
  - `POST /api/tests/:testId/questions` — 問題追加（ボディに `choices` を含められる）
  - `GET /api/tests/:testId/questions` — 問題一覧（テストの `randomize` が有効なら順序と選択肢をランダム化）
  - `PUT /api/questions/:id` — 問題更新（`explanation` を含む）
  - `POST /api/questions/:id/choices` — 選択肢追加
  - `PUT /api/choices/:id` — 選択肢更新

- Students / Answers / Sessions
  - `POST /api/students` — 生徒作成（`class_id` または `class_name` と `name`）→ `code` を返す
  - `POST /api/submit-answer` — 回答送信（`student_id,test_id,question_id` と `choice_id` または `choice_ids`）→ 正誤を返す
  - `GET /api/studentAnswers?student_id=&test_id=` — 生徒の回答取得
  - `POST /api/exam-sessions` — 試行開始（session 作成）
  - `PUT /api/exam-sessions/:id/finish` — 試行終了→ セッションに紐づいた回答（`session_id`）からスコアを計算して保存

- AI 生成
  - `POST /api/generate-questions` — ボディに `{ testId, text }` を与えると `server/mockAi.js` を使って問題を生成し、DB に追加する（現状はモック、外部APIに差し替え可能）

ビジネスルール／重要な挙動
- 削除：`classes` や `tests` の削除は依存（questions, students, answers）がある場合、`?cascade=1` を要求して明示的に関連データを削除する。サーバー側で確認を行う。
- ランダム化：テストの `randomize` が 1 の場合、`GET /api/tests/:testId/questions` は問題と選択肢をサーバー側でシャッフルして返す。
- 採点：ある問題の正解判定は「正解選択肢IDの集合」と「提出された選択肢IDの集合」が等しいかで判定する（集合比較）。部分点は無し（現状）。
- セッション：`exam_sessions` によって試行を区別でき、`student_answers.session_id` に紐づけて計算できる。

データとファイル
- DB ファイル: `server/data.sqlite`（ローカルファイル）
- 静的ライブラリ提供: `/vendor` ルートで `server/node_modules` を公開しているため、フロントエンドはバンドルを必要としない構成になっている。

運用・デプロイ
- 簡易：`cd server && npm install && node index.js`（デフォルト PORT=3000）
- 本番では SQLite のファイル配置、バックアップ、TLS 経路、適切なプロセスマネージャ（PM2 等）、および認証・権限の導入を推奨。

セキュリティ上の注意
- このリポジトリはプロトタイプであり認証・認可が実装されていません。公開環境では必ず認証、入力検証、CSRF 対策、TLS、APIキーの管理、レート制限などを実施してください。

AI（外部連携）について
- 現在は `server/mockAi.js` で固定の問題を生成しています。実運用では下記のいずれかの方法で差し替えます:
  - `server/mockAi.js` を編集して外部APIを呼ぶ実装に置き換える
  - 新しいサービスモジュール（例: `server/services/ai.js`）を作り、`/api/generate-questions` から呼び出す
  - APIキーは `process.env` を使って環境変数で管理すること

テスト・メンテナンス
- 簡易テストスクリプトが `server/test_*.js` として置かれています。CI を導入する場合はテストランナー（Jest、Mocha等）で自動化を検討してください。

拡張案
- 部分点や配点ルールの柔軟化
- 問題バンク、タグ付け、インポート/エクスポート（QTI/CSV）
- 本格的なAI統合では生成候補のスコアリングやフィードバックの生成
