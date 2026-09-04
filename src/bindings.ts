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

  // 同様の理由でジンジャーAPIキーもWorker secretとする。ベースURL・会社IDはトークンほど機微ではないため
  // settingsテーブル側で管理する(SETTINGS_KEYS.JINJER_API_BASE_URL / JINJER_COMPANY_ID)。
  // 【要確認】認証方式(Bearerトークンか専用ヘッダーか等)は開発者ガイド確認後にsrc/jinjer.tsと合わせて調整する。
  JINJER_API_KEY: string;
};
