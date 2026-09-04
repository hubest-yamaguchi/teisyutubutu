// Config.gs (PropertiesService) の移植。settings テーブルをkey/valueストアとして使う。
// 機微度の高い値(LINEチャネルアクセストークン等)は、可能ならWorkerのsecret(env)を優先し、
// 実行時に管理画面から変更できる必要がある値のみここに保存する(元のConfig.gsと同じ運用)。

export const SETTINGS_KEYS = {
  LINE_CHANNEL_ACCESS_TOKEN: 'LINE_CHANNEL_ACCESS_TOKEN',
  LINE_CHANNEL_SECRET: 'LINE_CHANNEL_SECRET', // Webhook署名検証用(LINE Developersコンソールの「チャネルシークレット」)
  LIFF_CHANNEL_ID: 'LIFF_CHANNEL_ID',
  SETTINGS_TAB_ORDER: 'SETTINGS_TAB_ORDER',
  DRIVE_ROOT_FOLDER_ID: 'DRIVE_ROOT_FOLDER_ID',
  JINJER_API_BASE_URL: 'JINJER_API_BASE_URL', // 【要確認】開発者ガイドで実際のベースURLを確認する
  JINJER_COMPANY_ID: 'JINJER_COMPANY_ID'
} as const;

export async function getSetting(db: D1Database, key: string): Promise<string> {
  const row = await db.prepare('SELECT Value FROM settings WHERE Key = ?').bind(key).first<{ Value: string }>();
  return row?.Value ?? '';
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(`INSERT INTO settings (Key, Value) VALUES (?, ?) ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value`)
    .bind(key, value ?? '')
    .run();
}

export async function setSettings(db: D1Database, map: Record<string, string>): Promise<void> {
  const entries = Object.entries(map);
  if (!entries.length) return;
  const stmt = db.prepare(`INSERT INTO settings (Key, Value) VALUES (?, ?) ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value`);
  await db.batch(entries.map(([k, v]) => stmt.bind(k, v ?? '')));
}
