
# UPDATE.md

このファイルは、GCP VM 上（Docker / `docker compose` 設置済み）で稼働中のアプリを改良・修正した後に、安全かつ短時間で更新（デプロイ）するための実務手順をまとめたものです。

前提
- サーバは `docker compose` で稼働中（`docker compose ps` で確認）
- `BUILD.md` の手順で初期デプロイが完了していること
- リモートリポジトリに変更を push できること
- 重要: 本番作業前に必ずバックアップを取る（`./backup.sh` を利用）

全体フロー（推奨、短時間で確実）
1. ローカルでコードをコミットして push
2. CI（推奨）でイメージをビルドしレジストリへ push（タグ付けする）
3. サーバでデプロイ前準備（バックアップ・メンテ告知）
4. サーバで `docker compose pull` → `docker compose up -d app`（ローリング更新）
5. スモークテスト・監視
6. 問題があればロールバック（旧タグで pull → up）

A. レジストリ方式（推奨） — CI を用いる場合の手順

1) ローカルで作業
```bash
git checkout -b feat/xxx
git add .
git commit -m "feat: ..."
git push origin feat/xxx
```

2) CI が動作（例: GitHub Actions）
- CI: テスト → イメージビルド → `ghcr.io/<org>/instanttest-server:sha-<short>` と `:latest` を push

3) サーバ側で（SSH）
```bash
ssh your-vm
cd ~/instant-test
# 事前バックアップ（必須）
./backup.sh

# pull 最新イメージ
docker compose pull app

# コンテナを差し替え（短時間）
docker compose up -d app

# 確認
docker compose logs -f app --since 1m
curl -sS https://your.example.domain/api/health
```

4) ロールバック（必要時）
```bash
# 既存の安定タグに戻す例
docker compose pull app=ghcr.io/<org>/instanttest-server:previous-tag
docker compose up -d app
```

B. サーバで直接ビルドする（小規模・テスト向け）

1) サーバで再ビルド
```bash
ssh your-vm
cd ~/instant-test
# バックアップ
./backup.sh

# 再ビルド
docker compose build --no-cache app

# 再起動
docker compose up -d

# 確認
docker compose logs -f app --since 1m
curl -sS https://your.example.domain/api/health
```

C. DB マイグレーションについて（SQLite）
- SQLite は単一ノード向けのため、マイグレーションは慎重に。必ずバックアップを取る。
- オプション:
  - アプリ内に `scripts/migrate.js` を用意し、`docker compose exec app node scripts/migrate.js` で実行する。
  - 重大なスキーマ変更はステージングで検証後、本番でオフライン適用（コンテナ停止→マイグレーション→起動）。

D. スモークテスト（自動）
- デプロイ直後に以下を実行して正常性をチェック:
```bash
curl -sS https://your.example.domain/api/health || exit 1
curl -sS https://your.example.domain/api/teacher/me -I # 認証が必要なら別途
```

E. 可観測性とモニタリング
- `docker compose logs -f app` と `docker compose logs -f caddy` を確認
- 重要なエラーログは外部に集約する（例: Stackdriver, Datadog）を推奨

F. 安全な運用のヒント
- 変更が授業に影響する場合は授業時間外にデプロイ
- レコード数が増えている場合はバックアップを複数世代で保存
- Gemini API の使用はコストに直結するので、生成機能の呼び出しを UI で制限

G. 例: シンプルなデプロイスクリプト（サーバ上で実行）
```bash
#!/usr/bin/env bash
set -euo pipefail
cd /home/youruser/instant-test
echo "Backup..."
./backup.sh
echo "Pulling image..."
docker compose pull app
echo "Restarting app..."
docker compose up -d app
echo "Waiting 5s for startup..."
sleep 5
curl -sS https://your.example.domain/api/health
```

H. トラブル発生時の迅速対応
- 1) 直ちに旧イメージへロールバック
- 2) DB に問題があれば最新バックアップを戻す（ただしデータ損失リスクあり）
- 3) 必要であればサービスを一時停止して調査（`docker compose stop app`）

最後に
- 小さな修正はサーバ上で直接ビルドできるが、信頼性と起動時間の観点から CI→レジストリ→pull の運用を強く推奨します。
