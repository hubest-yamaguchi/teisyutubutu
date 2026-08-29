// gas-app-liff/DocConfig.gs, gas-app/DocConfig.gs の移植。
// company_document_config テーブルを実際の判定に使う書類マスタとして読み込む。
// テーブルが未セットアップ・空の場合は model.ts の DOC_TYPES をそのまま使う(フォールバック)。

import { DOC_TYPES, DocType, DocCondition } from '../model';

type DocConfigRow = {
  DocKey: string;
  Label: string;
  RequiresOriginal: number;
  PdfAllowed: number;
  ConditionType: string;
  ConditionValue: string;
  Sensitive: number;
  Description: string;
  SortOrder: number;
  CompaniesJson: string;
};

export async function loadDocTypes(db: D1Database): Promise<DocType[]> {
  const { results } = await db.prepare('SELECT * FROM company_document_config ORDER BY SortOrder, DocKey').all<DocConfigRow>();
  const rows = (results ?? []).filter((r) => r.DocKey && String(r.DocKey).trim() !== '');
  if (!rows.length) return DOC_TYPES;

  return rows.map((r) => {
    let companies: string[] = [];
    try {
      companies = JSON.parse(r.CompaniesJson || '[]');
    } catch {
      companies = [];
    }
    const d: DocType = {
      key: String(r.DocKey).trim(),
      label: r.Label,
      requiresOriginal: !!r.RequiresOriginal,
      pdfAllowed: !!r.PdfAllowed,
      sensitive: !!r.Sensitive,
      description: r.Description || '',
      companies
    };
    if (String(r.ConditionType || '').trim() === '通勤手段' && r.ConditionValue) {
      d.condition = { type: 'commute', value: String(r.ConditionValue).trim() } as DocCondition;
    }
    return d;
  });
}

// 初期セットアップ時のシード投入用(seedCompanyDocumentConfigIfEmpty_と同じ判定)
export async function seedCompanyDocumentConfigIfEmpty(db: D1Database): Promise<void> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM company_document_config').first<{ n: number }>();
  if ((row?.n ?? 0) > 0) return;

  const stmt = db.prepare(
    `INSERT INTO company_document_config
      (DocKey, Label, RequiresOriginal, PdfAllowed, ConditionType, ConditionValue, Sensitive, Description, SortOrder, CompaniesJson)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await db.batch(
    DOC_TYPES.map((d, i) =>
      stmt.bind(
        d.key,
        d.label,
        d.requiresOriginal ? 1 : 0,
        d.pdfAllowed ? 1 : 0,
        d.condition ? '通勤手段' : '',
        d.condition ? d.condition.value : '',
        d.sensitive ? 1 : 0,
        d.description ?? '',
        i,
        JSON.stringify(d.companies ?? [])
      )
    )
  );
}

export async function upsertDocConfig(db: D1Database, doc: DocType, sortOrder: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO company_document_config
        (DocKey, Label, RequiresOriginal, PdfAllowed, ConditionType, ConditionValue, Sensitive, Description, SortOrder, CompaniesJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(DocKey) DO UPDATE SET
         Label=excluded.Label, RequiresOriginal=excluded.RequiresOriginal, PdfAllowed=excluded.PdfAllowed,
         ConditionType=excluded.ConditionType, ConditionValue=excluded.ConditionValue, Sensitive=excluded.Sensitive,
         Description=excluded.Description, SortOrder=excluded.SortOrder, CompaniesJson=excluded.CompaniesJson`
    )
    .bind(
      doc.key,
      doc.label,
      doc.requiresOriginal ? 1 : 0,
      doc.pdfAllowed ? 1 : 0,
      doc.condition ? '通勤手段' : '',
      doc.condition ? doc.condition.value : '',
      doc.sensitive ? 1 : 0,
      doc.description ?? '',
      sortOrder,
      JSON.stringify(doc.companies ?? [])
    )
    .run();
}

export async function removeDocConfig(db: D1Database, docKey: string): Promise<void> {
  await db.prepare('DELETE FROM company_document_config WHERE DocKey = ?').bind(docKey).run();
}
