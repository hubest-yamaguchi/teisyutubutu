// gas-app/Repo.gs の Templates 関連の移植。

import { REJECT_TEMPLATES, REMINDER_TEMPLATES } from '../model';

export type TemplateType = 'reject' | 'reminder';
export type Template = { id: string; title: string; text: string };

const TEMPLATE_TYPE_LABELS: Record<TemplateType, string> = { reject: '差し戻し理由', reminder: 'リマインダー' };

type TemplateRow = { TemplateId: string; Type: string; Title: string; Text: string };

// テーブルが未セットアップ・空の場合はコード側の初期値にフォールバック(listTemplates_と同じ)
export async function listTemplates(db: D1Database, type: TemplateType): Promise<Template[]> {
  const label = TEMPLATE_TYPE_LABELS[type];
  const { results } = await db.prepare('SELECT * FROM templates WHERE Type = ? ORDER BY TemplateId').bind(label).all<TemplateRow>();
  if (results && results.length > 0) {
    return results.map((r) => ({ id: r.TemplateId, title: r.Title, text: r.Text }));
  }
  const fallback = type === 'reject' ? REJECT_TEMPLATES : REMINDER_TEMPLATES;
  return fallback.map((t, i) => ({ id: `fallback-${i}`, title: t.title, text: t.text }));
}

function maxNumericSuffix(ids: string[]): number {
  let max = 0;
  for (const id of ids) {
    const n = parseInt(String(id).replace(/[^0-9]/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max;
}

export async function nextTemplateId(db: D1Database): Promise<string> {
  const { results } = await db.prepare('SELECT TemplateId FROM templates').all<{ TemplateId: string }>();
  const max = maxNumericSuffix((results ?? []).map((r) => r.TemplateId));
  return 'T' + String(max + 1).padStart(3, '0');
}

export async function addTemplate(db: D1Database, type: TemplateType, title: string, text: string): Promise<void> {
  const id = await nextTemplateId(db);
  await db
    .prepare('INSERT INTO templates (TemplateId, Type, Title, Text) VALUES (?, ?, ?, ?)')
    .bind(id, TEMPLATE_TYPE_LABELS[type] ?? type, title, text)
    .run();
}

export async function removeTemplate(db: D1Database, templateId: string): Promise<void> {
  await db.prepare('DELETE FROM templates WHERE TemplateId = ?').bind(templateId).run();
}

// 初期セットアップ時のシード投入用(seedTemplatesIfEmpty_と同じ判定: 既にデータがあれば何もしない)
export async function seedTemplatesIfEmpty(db: D1Database): Promise<void> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM templates').first<{ n: number }>();
  if ((row?.n ?? 0) > 0) return;

  let seq = 1;
  const stmt = db.prepare('INSERT INTO templates (TemplateId, Type, Title, Text) VALUES (?, ?, ?, ?)');
  const statements = [
    ...REJECT_TEMPLATES.map((t) => stmt.bind('T' + String(seq++).padStart(3, '0'), TEMPLATE_TYPE_LABELS.reject, t.title, t.text)),
    ...REMINDER_TEMPLATES.map((t) => stmt.bind('T' + String(seq++).padStart(3, '0'), TEMPLATE_TYPE_LABELS.reminder, t.title, t.text))
  ];
  await db.batch(statements);
}
