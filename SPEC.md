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

認証・認可
- 教師操作は `teacher_session`（HttpOnly クッキー）で認証されます。`/api/teacher/login` で認証しクッキーが設定されます。
- 管理用エンドポイント（`/api/admin/*`）は、環境変数 `ADMIN_PASSWORD` をサーバーに設定し、リクエストヘッダ `x-admin-password` に同値を送ることで利用可能になります。

共通エラー形式
HTTP レスポンスはエラー時に JSON を返します。例: `{ "error": "not_found" }`。

主要 API（要点と例）
- `GET /api/health` — ヘルスチェック（例: `{ "status":"ok" }`）
- `GET /api/qr-code?text=...` — QRコードの DataURL を返す（例: `{ "dataUrl":"data:image/png;base64,..." }`）

---

Teacher login (例)

```bash
curl -i -X POST http://localhost:3000/api/teacher/login \
	-H "Content-Type: application/json" \
	-d '{"username":"alice","password":"secret"}' \
	-c cookies.txt
```

クッキーを保存した `cookies.txt` を使って認証付きリクエストを送れます。

Class 作成 (認証あり)

```bash
curl -X POST http://localhost:3000/api/classes \
	-H "Content-Type: application/json" \
	-d '{"name":"Class A"}' \
	-b cookies.txt
```

管理 API 例（`ADMIN_PASSWORD` 必須）

```bash
curl -H "x-admin-password: $ADMIN_PASSWORD" http://localhost:3000/api/admin/teachers
```

AI 生成の呼び出し例（教師認証）

```bash
curl -X POST http://localhost:3000/api/generate-questions \
	-H "Content-Type: application/json" \
	-b cookies.txt \
	-d '{"testId":1,"lessonContent":"太陽系の惑星について","questionCount":3,"choiceCount":4,"difficulty":"normal"}'
```

説明: `/api/generate-questions` は `GEMINI_API_KEY` がサーバーに設定されていないと失敗します。

---

データ整合性 / ビジネスルール（要点）
- 削除: 依存データがある場合は `?cascade=1` をクライアントが付けて明示実行する（サーバー側でトランザクション処理）。
- ランダム化: `tests.randomize` が有効ならサーバー側で問題と選択肢をシャッフルして返す。
- 採点: 正誤は "正解選択肢 ID の集合" と "提出選択肢 ID の集合" の集合比較で判定する（部分点は未対応）。

---

拡張案
- 部分点、インポート/エクスポート、タグ付けや問題バンクの追加
- AI 候補のプレビューやスコアリング

参考実装: [server/index.js](server/index.js), [server/db.js](server/db.js)

