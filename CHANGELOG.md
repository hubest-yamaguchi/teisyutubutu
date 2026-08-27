# 変更履歴

## 2026-08-27 — 実装完了(フェーズ1〜6)・Cloudflareアカウント側の初期セットアップ

GASからCloudflareへの完全移行(入社書類管理システム)を実施。既存のGASコード(`gas-app`/`gas-app-liff`)は一切変更せず、リポジトリとして手を加えず保存。新規実装は本リポジトリ`teisyutubutu`で行った。詳細な設計は `.claude/plans` のプラン(GAS→Cloudflare 完全移行)を参照。

### 実装した内容

- **土台**: wrangler + Hono + TypeScript + D1 + R2 の構成。`migrations/`でD1スキーマ管理
- **データ層**: `src/model.ts`(gas-app/Model.gs相当)、`src/db/*.ts`(Repo.gs/Sheets.gs相当)
- **LIFF側**: `src/api/liff.ts` + `public/liff/index.html`。`?demo=1`でLINEログインなしの画面デモが可能
- **管理画面**: `src/api/admin.ts` + `public/admin/index.html`。Cloudflare Access(Zero Trust)のJWT検証で認可(GroupsApp判定は廃止し、`admins`テーブルの列(IsSuperAdmin/マイナンバー閲覧法人)で管理)
- **新設UI**: 書類マスタ・職種法人マスタのCRUD画面(旧GAS版はスプレッドシート直接編集だった分)
- **書類ファイル閲覧**: `submissions`にStorageKey/MimeType列を追加し、管理画面から提出書類(R2上のファイル)を表示できるように
- **データ移行スクリプト**: `scripts/migrate-from-sheets.ts`(Googleスプレッドシート/DriveからD1/R2への一回限りの移行。dry-run既定、`--apply`で実書き込み)

### Cloudflareアカウント側で完了した作業

- `wrangler login`でアカウント連携(m-yamaguchi@hubest.jp)
- D1データベース`teisyutubutu-db`作成、マイグレーション適用(local/remote両方)
- R2バケット`teisyutubutu-docs`作成(ダッシュボードでの初回有効化が必要だった)
- workers.devサブドメイン`hubest`を登録
- Workerを本番デプロイ。本番URL: **https://teisyutubutu.hubest.workers.dev**
  - 補足: サブドメイン登録直後、HTTPS(443番)の証明書がCloudflareエッジに反映されるまで通常より時間がかかった(体感30〜45分程度。HTTPは早い段階から応答していたので、デプロイ自体は問題なかった)。現在は解消済み

### 今、問題となっている点

- **Cloudflare Accessが未設定**: `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD`が空のため、本番の管理画面API(`/api/admin/*`)は現状「誰からのリクエストも認証エラーで拒否」される状態(安全側に倒れているが、管理画面自体がまだ使えない)
- **LINE公式アカウント未接続**: 本番のLIFFチャネルID・チャネルアクセストークンが未設定のため、LIFF画面を開くと「LIFFチャネルIDが未設定です」と表示される
- **本番データが空**: 実データの移行(`migrate-from-sheets.ts --apply`)がまだ未実施。現在の本番D1は空(`/health`で`employees:0`)

### この後やることリスト

1. **Cloudflare Access設定**: Zero Trustでチーム作成→ログイン方法(One-time PIN推奨)→`/admin*`と`/api/admin*`を保護するアプリケーション作成→Application Audience(AUD)タグ取得→`wrangler.toml`の`CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD`に反映して再デプロイ
2. **LINE本番公式アカウント接続**: Messaging API有効化→チャネルアクセストークン発行→本番URL(`https://teisyutubutu.hubest.workers.dev/liff/`)をエンドポイントにしたLIFFアプリを追加→LIFF ID取得→管理画面「設定」からトークン・LIFF IDを登録
3. **データ移行の実行**: Googleサービスアカウント準備(対象スプレッドシート/Driveに閲覧権限付与)→`npm run migrate:from-sheets`でdry-run→件数確認→HRにGAS側の操作を止めてもらう→`npm run migrate:from-sheets:apply`で本実行→管理画面で「代表管理者」「マイナンバー閲覧可否」を手動再設定(旧シートに無い情報のため)
4. **切替前の一連テスト**: 実LINEアカウントでのLIFFログイン〜提出〜通知、Cloudflare Accessでの管理画面ログイン、CSV一括登録などをブラウザで確認
5. **本番切替**: LINEのLIFF URLと管理画面URLを新しいものに切替→GASのWeb Appデプロイを停止(コードは保存したまま)
