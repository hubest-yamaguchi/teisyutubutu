export type Env = {
  DB: D1Database;
  DOCS: R2Bucket;
  ASSETS: Fetcher;
  ENVIRONMENT: string;

  // LINEチャネルアクセストークン等は settings テーブル(D1)に保存し、管理画面の「設定」から
  // 再デプロイなしで変更できるようにする(旧Config.gs/PropertiesServiceと同じ運用)。env secretsは使わない。

  // 例外: Google Driveサービスアカウントの秘密鍵は機微度が特に高く、管理画面のテキスト欄経由でDBに
  // 保存する運用にはしたくないため、`wrangler secret put`で設定するWorker secretとする。
  // 保存先フォルダID( DRIVE_ROOT_FOLDER_ID )はトークンほど機微ではないためsettingsテーブル側で管理する。
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: string;

  // ジンジャーAPIキーはLINEチャネルアクセストークンと同じ扱いとし、settingsテーブル(SETTINGS_KEYS.JINJER_API_KEY)に
  // 保存する(管理画面の「設定」から再デプロイなしで変更できるようにするため)。env secretsは使わない。
};
