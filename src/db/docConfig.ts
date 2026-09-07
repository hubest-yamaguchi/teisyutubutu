// gas-app-liff/DocConfig.gs, gas-app/DocConfig.gs の移植。
// company_document_config テーブルを実際の判定に使う書類マスタとして読み込む。
// テーブルが未セットアップ・空の場合は model.ts の DOC_TYPES をそのまま使う(フォールバック)。

import { DOC_TYPES, DocType, DocCondition } from '../model';

// ConditionType列にはDB内で日本語ラベルとして保存する(既存データが'通勤手段'のため後方互換)。
// DocType.condition.typeは内部的な英語キー('commute'/'hasLicense')なので、ここで相互変換する。
const CONDITION_TYPE_LABELS: Record<DocCondition['type'], string> = {
  commute: '通勤手段',
  hasLicense: '運転免許証の有無'
};
const CONDITION_TYPE_BY_LABEL: Partial<Record<string, DocCondition['type']>> = {
  通勤手段: 'commute',
  運転免許証の有無: 'hasLicense'
};

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
  JinjerCustomMenuId: string;
  JinjerCustomItemId: string;
  JinjerRecordCode: string;
  Optional: number;
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
      companies,
      optional: !!r.Optional,
      jinjerCustomMenuId: r.JinjerCustomMenuId || '',
      jinjerCustomItemId: r.JinjerCustomItemId || '',
      jinjerRecordCode: r.JinjerRecordCode || ''
    };
    const condType = CONDITION_TYPE_BY_LABEL[String(r.ConditionType || '').trim()];
    if (condType && r.ConditionValue) {
      d.condition = { type: condType, value: String(r.ConditionValue).trim() };
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
      (DocKey, Label, RequiresOriginal, PdfAllowed, ConditionType, ConditionValue, Sensitive, Description, SortOrder, CompaniesJson, JinjerCustomMenuId, JinjerCustomItemId, JinjerRecordCode, Optional)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await db.batch(
    DOC_TYPES.map((d, i) =>
      stmt.bind(
        d.key,
        d.label,
        d.requiresOriginal ? 1 : 0,
        d.pdfAllowed ? 1 : 0,
        d.condition ? CONDITION_TYPE_LABELS[d.condition.type] : '',
        d.condition ? d.condition.value : '',
        d.sensitive ? 1 : 0,
        d.description ?? '',
        i,
        JSON.stringify(d.companies ?? []),
        d.jinjerCustomMenuId ?? '',
        d.jinjerCustomItemId ?? '',
        d.jinjerRecordCode ?? '',
        d.optional ? 1 : 0
      )
    )
  );
}

export async function upsertDocConfig(db: D1Database, doc: DocType, sortOrder: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO company_document_config
        (DocKey, Label, RequiresOriginal, PdfAllowed, ConditionType, ConditionValue, Sensitive, Description, SortOrder, CompaniesJson, JinjerCustomMenuId, JinjerCustomItemId, JinjerRecordCode, Optional)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(DocKey) DO UPDATE SET
         Label=excluded.Label, RequiresOriginal=excluded.RequiresOriginal, PdfAllowed=excluded.PdfAllowed,
         ConditionType=excluded.ConditionType, ConditionValue=excluded.ConditionValue, Sensitive=excluded.Sensitive,
         Description=excluded.Description, SortOrder=excluded.SortOrder, CompaniesJson=excluded.CompaniesJson,
         JinjerCustomMenuId=excluded.JinjerCustomMenuId, JinjerCustomItemId=excluded.JinjerCustomItemId,
         JinjerRecordCode=excluded.JinjerRecordCode, Optional=excluded.Optional`
    )
    .bind(
      doc.key,
      doc.label,
      doc.requiresOriginal ? 1 : 0,
      doc.pdfAllowed ? 1 : 0,
      doc.condition ? CONDITION_TYPE_LABELS[doc.condition.type] : '',
      doc.condition ? doc.condition.value : '',
      doc.sensitive ? 1 : 0,
      doc.description ?? '',
      sortOrder,
      JSON.stringify(doc.companies ?? []),
      doc.jinjerCustomMenuId ?? '',
      doc.jinjerCustomItemId ?? '',
      doc.jinjerRecordCode ?? '',
      doc.optional ? 1 : 0
    )
    .run();
}

export async function removeDocConfig(db: D1Database, docKey: string): Promise<void> {
  await db.prepare('DELETE FROM company_document_config WHERE DocKey = ?').bind(docKey).run();
}
