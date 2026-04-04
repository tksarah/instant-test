# InstantTest — ローカル開発用プロトタイプ

InstantTest は教員が簡単にテストを作成し、生徒が受験・採点・レポート閲覧できる軽量プロトタイプです。

主な用途:
- 教員：クラス・テストの管理、問題の編集、AIによる問題自動生成（モック）
- 生徒：テスト参加、回答送信、個人レポートの確認

特徴:
- シンプルなREST API（Express）とSQLiteによる永続化
- フロントエンドは静的なReact（バンドルなし、`/vendor` 経由でライブラリを提供）
- AI生成は `server/mockAi.js` のモック実装（実運用時は差し替え可能）
- QRコード生成、試験セッション、部分採点・集計をサポート

クイックスタート（Windows / PowerShell）:

1. サーバーの依存関係をインストール:

```powershell
cd server
npm install
```

2. サーバーを起動:

```powershell
node index.js
```

3. ブラウザで開く: http://localhost:3000

主要なファイルと場所:
- サーバー: [server/index.js](server/index.js)
- DB・スキーマ: [server/db.js](server/db.js)（データファイル: `server/data.sqlite`）
- AIモック: [server/mockAi.js](server/mockAi.js)
- フロントエンド（静的）: [server/public/](server/public/)
- 教師向けテーマのサンプル: [public/](public/) （ハイコントラスト等のCSS）
- メンテナンス用スクリプト: [server/scripts/](server/scripts/)
- 簡易テストスクリプト: [server/test_api.js](server/test_api.js) 等

APIの詳細仕様やアーキテクチャは [SPEC.md](SPEC.md) を参照してください。UI/UX については [DESIGN.md](DESIGN.md) をご覧ください。

注意（プロトタイプ）:
- 簡易実装で認証や権限管理は含まれていません。公開前に認証、入力検証、TLS、レート制限などの対策が必要です。

ライセンス: 実験用プロトタイプとして利用してください。
