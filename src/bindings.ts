export type Env = {
  DB: D1Database;
  DOCS: R2Bucket;
  ASSETS: Fetcher;
  ENVIRONMENT: string;

  // LINEチャネルアクセストークン等は settings テーブル(D1)に保存し、管理画面の「設定」から
  // 再デプロイなしで変更できるようにする(旧Config.gs/PropertiesServiceと同じ運用)。env secretsは使わない。
};
