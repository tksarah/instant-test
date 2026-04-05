# SPEC — 仕様・アーキテクチャ（最新）

概要
- InstantTest はローカルで動作するプロトタイプです。サーバーは Node.js（Express）、データは SQLite、フロントエンドはサーバー配信の静的ファイルです。

技術スタック
- サーバー: Node.js + Express
- データベース: SQLite（ローカルファイル: `server/data.sqlite`）
- フロントエンド: 静的ファイル（`server/public/`）
- 主な依存: `express`, `cors`, `sqlite3`, `qrcode`, `dotenv` など（`server/package.json` を参照）

フォルダ構成（抜粋）
- `server/` — サーバーと API、DB 初期化、スクリプト
- `server/public/` — フロントエンド静的ファイル
- `public/` — テーマやサンプルの静的アセット（教員向けテーマ等）

データモデル（主なテーブルと主要カラム）
- `teachers` (id, username, display_name, password_hash, active, created_at)
- `teacher_sessions` (token, teacher_id, created_at, last_seen_at, expires_at)
- `classes` (id, teacher_id, name)
- `tests` (id, teacher_id, class_id, name, description, public, randomize)
- `questions` (id, test_id, type, text, points, public, explanation)
- `choices` (id, question_id, text, is_correct)
- `students` (id, class_id, name, code)
- `student_answers` (id, student_id, test_id, question_id, choice_id, correct, session_id)
- `exam_sessions` (id, student_id, test_id, started_at, finished_at, duration_sec, score, max_score, percent, status)

主要 API（要点）
- `GET /api/health` — ヘルスチェック
- `GET /api/qr-code?text=...` — QRコードの DataURL を返す

Classes
- `POST /api/classes` — クラス作成（教師認証要）
- `GET /api/classes` — 教師用の一覧、または公開テストが存在するクラスの公開一覧
- `PUT /api/classes/:id` — 更新（教師所有チェック）
- `DELETE /api/classes/:id` — 削除（依存がある場合は `?cascade=1` を要求）

Tests
- `POST /api/tests` — テスト作成（教師認証要）
- `GET /api/tests` — フィルタ付き一覧（`class_id`, `public`）
- `PUT /api/tests/:id` — 更新
- `DELETE /api/tests/:id` — 削除（`?cascade=1` で関連データも削除）

Questions / Choices
- `POST /api/tests/:testId/questions` — 問題追加（`choices` を同時に渡せる）
- `GET /api/tests/:testId/questions` — 問題一覧（`randomize` 有効時は順序・選択肢をシャッフル）
- `PUT /api/questions/:id` — 問題更新
- `POST /api/questions/:id/choices` — 選択肢追加
- `PUT /api/choices/:id` — 選択肢更新

Students / Answers / Sessions
- `POST /api/students` — 生徒作成（`class_id` または `class_name` と `name`）→ `code` を返却
- `POST /api/submit-answer` — 回答送信（`student_id,test_id,question_id` と `choice_id` または `choice_ids`）→ 正誤を返す
- `GET /api/studentAnswers?student_id=&test_id=` — 生徒の回答取得
- `POST /api/exam-sessions` — 試行開始（session 作成）
- `PUT /api/exam-sessions/:id/finish` — 試行終了→ `session_id` に紐づく回答からスコアを計算して保存

AI 生成
- `POST /api/generate-questions` — 教師権限で呼び出す。現在は `server/geminiAi.js` を使って Google Gemini API を呼び出す実装です。実行には `GEMINI_API_KEY` が必要です。
- 補足: `server/mockAi.js` はモック実装として存在しますが、現在のメインルートでは `geminiAi.js` を使用しています（キー未設定時は生成に失敗します）。

ビジネスルール / 重要な挙動
- 削除: `classes` や `tests` の削除は関連データが存在する場合、クライアントが `?cascade=1` を明示して実行する必要があります（サーバー側で確認およびトランザクションで削除）。
- ランダム化: テストの `randomize` フラグが有効な場合、問題と選択肢はサーバー側でランダム化されて返却されます。
- 採点: 正誤判定は「正解選択肢IDの集合」と「提出選択肢IDの集合」が一致するかで判定します（集合比較）。現状は部分点を与えません。
- セッション管理: 教師は `teacher_session` クッキー（HttpOnly）で認証されます。管理操作は環境変数 `ADMIN_PASSWORD` による保護とリクエストヘッダ `x-admin-password` の組合せで行います。

データとファイル
- DB ファイル: `server/data.sqlite`（ローカルファイル）
- 静的ライブラリ提供: サーバー側で `/vendor` を `server/node_modules` に割り当てているため、フロント側はバンドルなしで利用できます。

運用・デプロイ
- 開発（ローカル簡易）: `cd server && npm install && node index.js`（デフォルト PORT=3000）
- 本番では SQLite のファイル管理、バックアップ、TLS、プロセスマネージャ（PM2 等）、および堅牢な認証・認可の導入を推奨します。

セキュリティ注意点
- このリポジトリはプロトタイプです。公開環境では入力検証、CSRF 対策、TLS、API キーの適切な管理、レート制限、監査ログ等を必須で導入してください。

拡張案（参考）
- 部分点や柔軟な配点ルールの導入
- 問題バンク、タグ付け、インポート/エクスポート（CSV/QTI）
- AI 統合の改善: 候補スコアリング、生成候補のプレビュー、編集履歴管理

