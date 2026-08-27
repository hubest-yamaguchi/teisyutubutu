export type Env = {
  DB: D1Database;
  DOCS: R2Bucket;
  ASSETS: Fetcher;
  ENVIRONMENT: string;

  // LINEチャネルアクセストークン等は settings テーブル(D1)に保存し、管理画面の「設定」から
  // 再デプロイなしで変更できるようにする(旧Config.gs/PropertiesServiceと同じ運用)。env secretsは使わない。

  // Cloudflare Access (Zero Trust) — /admin配下の保護に使う。Accessアプリ作成後に設定する。
  CF_ACCESS_TEAM_DOMAIN?: string; // 例: "yourteam.cloudflareaccess.com"
  CF_ACCESS_AUD?: string; // Accessアプリの Application Audience (AUD) タグ
};
