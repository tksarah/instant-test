# Instant Test MVP

授業の最後に使う確認テストを、その場で生成して、その場で解いて、その場で結果確認までつなぐための Next.js MVP です。

## 現在の実装範囲

- 先生ログイン / サインアップ
- 先生向けトップダッシュボード
- クラス登録フォーム
- 授業テキストからの簡易問題生成
- 確認テスト作成フォームの保存
- 生成問題の編集、追加、削除、出題除外 UI
- 学習履歴と統計の一覧画面
- Supabase Auth + RLS による先生単位のデータ分離
- 学生の参加画面
- 1問ずつ回答し、正答と解説を即時表示する受験画面
- 受験結果の永続化
- QR コード表示

現在はローカル永続化対応済みで、クラス・テスト・受験結果は [data/instant-test-db.json](data/instant-test-db.json) に保存されます。
初期シード値は [src/lib/mock-data.ts](src/lib/mock-data.ts) を元に投入しています。

Supabase の接続情報がある場合は Supabase を優先し、未設定時はローカル JSON に自動フォールバックします。
ローカル Supabase 開発用の schema source of truth は [supabase/migrations](supabase/migrations) と [supabase/seed.sql](supabase/seed.sql) です。

## 主な画面

- ホーム: /
- 先生ダッシュボード: /teacher
- テスト作成: /teacher/tests/new
- 結果確認: /teacher/results
- 学生入口: /student
- 学生受験: /student/session

## 技術構成

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- qrcode.react
- App Router Route Handlers

## 永続化の構成

- backend adapter: [src/lib/persistence.ts](src/lib/persistence.ts)
- ローカル backend: [src/lib/persistence-local.ts](src/lib/persistence-local.ts)
- Supabase backend: [src/lib/persistence-supabase.ts](src/lib/persistence-supabase.ts)
- 共有変換と型: [src/lib/persistence-shared.ts](src/lib/persistence-shared.ts), [src/lib/persistence-types.ts](src/lib/persistence-types.ts)
- 保存先フォールバック: [data/instant-test-db.json](data/instant-test-db.json)
- Supabase server client: [src/lib/supabase/server.ts](src/lib/supabase/server.ts)
- Supabase proxy helper: [src/lib/supabase/proxy.ts](src/lib/supabase/proxy.ts)
- Supabase env helper: [src/lib/supabase/env.ts](src/lib/supabase/env.ts)
- generated Supabase types: [src/lib/supabase/database.types.ts](src/lib/supabase/database.types.ts)
- local Supabase config: [supabase/config.toml](supabase/config.toml)
- local Supabase migration: [supabase/migrations/20260403000100_initial_schema.sql](supabase/migrations/20260403000100_initial_schema.sql)
- auth / RLS migration: [supabase/migrations/20260403000200_auth_rls.sql](supabase/migrations/20260403000200_auth_rls.sql)
- local Supabase seed: [supabase/seed.sql](supabase/seed.sql)
- teacher auth helper: [src/lib/teacher-auth.ts](src/lib/teacher-auth.ts)
- Next.js proxy entrypoint: [src/proxy.ts](src/proxy.ts)
- 画面用の集約データ: [src/lib/data.ts](src/lib/data.ts)
- API ルート:
	- /api/classes
	- /api/tests
	- /api/attempts

Supabase の初期データ投入は runtime では行わず、必ず migration + seed で再現します。

## セットアップ

```bash
npm install
npm run supabase:start
npm run supabase:db:reset
npm run supabase:env
npm run supabase:gen:types
npm run verify:supabase
npm run dev
```

ブラウザで http://localhost:3000 を開くと確認できます。
ローカル Supabase は Docker Desktop など Docker API 互換ランタイムが起動していることが前提です。

QR コードに埋め込む URL を本番環境に合わせる場合は、環境変数を設定してください。

```bash
NEXT_PUBLIC_APP_URL=https://your-domain.example
```

未設定時は http://localhost:3000 を使用します。

Supabase に切り替える際の変数ひな形は [.env.example](.env.example) に置いています。
ローカル Supabase を使う場合は、まず `npm run supabase:start` でローカルスタックを起動し、そのあと `npm run supabase:env` で `.env.local` を自動生成してください。

アプリ本体が Supabase を使うための最低限必要な変数は以下です。

```bash
SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-or-publishable-key
```

`NEXT_PUBLIC_SUPABASE_URL` は `SUPABASE_URL` と同じ値で構いません。
`SUPABASE_SERVICE_ROLE_KEY` は `npm run verify:supabase` などの管理系スクリプトで使いますが、通常の画面表示と teacher 認証には必須ではありません。

## ローカル demo 教員

`npm run supabase:db:reset` 後は、以下の demo 教員で先生画面へログインできます。

```text
email: teacher@example.com
password: DemoTeacher123!
```

この資格情報はローカル確認用です。共有環境や本番相当の Supabase を使う場合は、seed を変更するか demo ユーザーを削除してください。

## 検証済みコマンド

```bash
npm run lint
npm run build
npm run supabase:status
npm run supabase:gen:types
npm run supabase:db:reset
npm run verify:supabase
```

開発サーバー起動後は API ルートも確認できます。

```bash
npm run dev
```

Supabase 実接続を切り分ける場合は、以下のコマンドで環境変数の読込状況、接続可否、主要テーブル件数を確認できます。

```bash
npm run verify:supabase
```

このコマンドは `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を確認し、設定済みなら `classes`, `tests`, `questions`, `student_attempts` への疎通まで検証します。

ローカル Supabase の基本操作は以下です。

```bash
npm run supabase:start
npm run supabase:status
npm run supabase:env
npm run supabase:gen:types
npm run supabase:db:reset
npm run supabase:stop
```

スキーマを更新したら `npm run supabase:gen:types` を実行して、[src/lib/supabase/database.types.ts](src/lib/supabase/database.types.ts) を再生成してください。

## 次の実装候補

- LLM 連携による問題生成精度の向上
- クラスコードと名前の入力結果を保持する簡易セッション
- 問題別正答率、CSV 出力、未実施学生の表示
- 記述式問題への拡張

## プッシュ前チェックリスト

リポジトリを別端末で開いて作業／検証する前に実行しておくとスムーズです。

- **ローカル Supabase の起動**: Docker が起動していることを確認し、次を実行します。

```bash
npm run supabase:start
npm run supabase:db:reset    # 必要に応じて
npm run supabase:env
npm run supabase:gen:types
```

- **環境ファイル**: `.env.local` は `npm run supabase:env` で生成されます。外部公開する際は機密キーを含まないよう注意してください。

- **検証コマンド** (ローカルでの最終チェック)

```bash
npm run lint
npm run build
npm run verify:supabase
npm run dev
```

- **動作確認ポイント**
	- `http://localhost:3000/teacher/login` が 200 で表示される
	- 未ログインで `http://localhost:3000/teacher` がログインへリダイレクトされる
	- 学生向け `http://localhost:3000/student` がログイン不要で見える
	- API：`/api/classes` `/api/tests` `/api/attempts` の基本的な GET/POST が期待通り動作する

- **デモ教員アカウント**（ローカル seed）

```
email: teacher@example.com
password: DemoTeacher123!
```

- **注意事項**
	- ローカル Supabase は Docker のネットワークに依存します。別端末からアクセスする場合は実際にバインドされているマシンの LAN アドレスを確認するか、ngrok 等でトンネルしてください。
	- `.env.local` に含まれるシークレットはリモートに公開しないでください。

---

上のチェックを満たしていれば、そのまま GitHub にコミット & プッシュして構いません。プッシュ後に別端末でクローンして同じ手順を実行すれば再現できるはずです。
