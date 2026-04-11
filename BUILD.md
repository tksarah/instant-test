# BUILD.md

このファイルは、GCP 上の VM に Docker がインストール済みで、パブリック IP とドメインの設定が完了した後に行うビルド／起動手順をまとめたものです。

前提
- GCP の VM に SSH で接続できること（Docker / `docker compose` がインストール済み）
- ドメインの A レコードが VM のパブリック IP を指していること
- リポジトリは VM 上の作業ディレクトリに配置済みであること（この手順は Docker 準備完了以降の手順）

作業手順

1) リポジトリ配置（VM 上）
```bash
cd ~
mkdir -p instant-test
cd instant-test
git clone <YOUR_REPO_URL> .   # プライベートなら鍵等を用意
```

2) ディレクトリ準備と初期 DB
```bash
mkdir -p data backups caddy
touch data/data.sqlite
```

3) 環境変数ファイル作成（編集して値を入力）
```bash
cat > .env <<EOF
ADMIN_PASSWORD=ここに強いパスワード
GEMINI_API_KEY=ここに実際のキー（空可）
GEMINI_MODEL=gemini-2.5-flash-lite
PORT=3000
DOMAIN=your.example.domain
EOF
chmod 600 .env
```

4) `caddy/Caddyfile` を作成（`your.example.domain` を実ドメインに置換）
```
your.example.domain {
  reverse_proxy app:3000
  tls you@example.com
}
```

5) 推奨 `server/Dockerfile`（既にある場合は内容を確認する）
```dockerfile
FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential python3 pkg-config libsqlite3-dev sqlite3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --build-from-source
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
```

6) `docker-compose.yml` の確認
- `app` サービスの `build.context` が `./server` になっていること
- `./data/data.sqlite` を `/app/data.sqlite` にマウントしていること
- `server/public` を `/app/public:ro` としてマウントしていること

7) イメージビルドと起動
```bash
# 初回はキャッシュ無しで確実にビルド
docker compose build --no-cache app
docker compose up -d
```

8) 動作確認
```bash
docker compose ps
docker compose logs -f app
docker compose exec app curl -sS http://localhost:3000/api/health
curl -sS https://your.example.domain/api/health
```

運用（停止・再起動）
- アプリのみ停止／再起動:
```bash
docker compose stop app
docker compose up -d app
```
- 全サービス停止（Caddy を含む）:
```bash
docker compose down
```
- VM を停止してコスト削減（GCP 操作）:
```bash
gcloud compute instances stop <INSTANCE_NAME> --zone=<ZONE>
gcloud compute instances start <INSTANCE_NAME> --zone=<ZONE>
```

バックアップ（簡易）
- プロジェクトルートに `backup.sh` を作成:
```bash
#!/usr/bin/env bash
set -euo pipefail
TIMESTAMP=$(date +%F_%H%M%S)
docker compose exec -T app sqlite3 /app/data.sqlite ".backup '/backup/instanttest-${TIMESTAMP}.sqlite'"
echo "Saved: ./backups/instanttest-${TIMESTAMP}.sqlite"
```

- 実行:
```bash
chmod +x backup.sh
./backup.sh
```

- GCS へ自動アップロード（任意、事前に `gsutil` 設定）:
```bash
gsutil cp ./backups/instanttest-${TIMESTAMP}.sqlite gs://your-gcs-bucket/
```

定期化（cron 例）
```cron
0 2 * * * cd /home/youruser/instant-test && ./backup.sh && gsutil cp ./backups/*.sqlite gs://your-gcs-bucket/
```

セキュリティ・運用注意
- `.env` の `ADMIN_PASSWORD` と `GEMINI_API_KEY` は `chmod 600` で保護
- ドメインが Let's Encrypt による証明書を取得するために 80/443 が公開されていること
- SQLite は単一ノード向け。複数ノードで同時書き込みしないこと。スケールが必要なら PostgreSQL 等へ移行する
- Gemini API は有料。生成操作は回数制限を UI 側で設けることを推奨

トラブルシュート（代表例）
- Caddy が TLS を取得できない → ドメインの A レコードと 80/443 の通信確認
- `node_sqlite3` の glibc エラー → `server/Dockerfile` を `node:20-slim` にして `npm ci --build-from-source` を実行して再ビルド
- 外部からアクセスできない → `curl -I https://your.example.domain/` と `docker compose logs caddy` を確認

CI / イメージ配布（推奨）
- CI（GitHub Actions 等）でイメージをビルドしレジストリへ push、サーバは `docker compose pull && docker compose up -d` で運用すると起動が高速化

--
保存: この内容をプロジェクトルートに `BUILD.md` として保存しました。
