// 設定ページのカテゴリ定義。サイドタブの並び・管理者ごとのチェックボックス権限の両方で使う。

export const SETTINGS_CATEGORIES = ['emp', 'tpl', 'job', 'admin', 'line', 'doc', 'drive', 'jinjer', 'setup'] as const;
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];

export const SETTINGS_CATEGORY_LABELS: Record<SettingsCategory, string> = {
  emp: '新入社員登録',
  tpl: 'テンプレート',
  job: '職種法人マスタ',
  admin: '管理者一覧',
  line: 'LINE公式アカウント設定',
  doc: '書類マスタ',
  drive: 'Google Drive連携設定',
  jinjer: 'jinjer連携設定',
  setup: '初期データ投入'
};

// 新規登録時のデフォルト権限(旧: IsSuperAdmin=0の管理者が使えていた範囲)
export const DEFAULT_PERMISSIONS: SettingsCategory[] = ['emp', 'tpl', 'job'];

export function isSettingsCategory(v: string): v is SettingsCategory {
  return (SETTINGS_CATEGORIES as readonly string[]).includes(v);
}

export function sanitizePermissions(values: string[]): SettingsCategory[] {
  const set = new Set(values.filter(isSettingsCategory));
  return SETTINGS_CATEGORIES.filter((c) => set.has(c));
}
