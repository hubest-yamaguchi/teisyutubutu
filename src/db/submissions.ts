// gas-app-liff/Repo.gs, gas-app/Repo.gs の Submissions 関連の移植。

import { STATUS } from '../model';
import { nowStr } from '../util/date';

export type Submission = {
  EmployeeId: string;
  DocKey: string;
  Status: string;
  SubmittedAt: string;
  RejectReason: string;
  RejectedAt: string;
  ReceivedOriginal: boolean;
  UpdatedAt: string;
  StorageKey: string;
  MimeType: string;
  // dualFileの書類(マイナンバー表裏など)専用の2枚目のファイル。dualFileでない書類では常に空文字
  StorageKey2: string;
  MimeType2: string;
  TextContent: string; // ファイル添付の代わりに、テキストで直接提出された内容(textAllowedの書類のみ使用)
  JinjerSentStorageKey: string;
  // 個別社員に対する提出要否の上書き。null=通常通り書類マスタの条件で判定。1=この人だけ対象にする。0=この人だけ対象外にする
  RequiredOverride: number | null;
};

type SubmissionRow = Omit<Submission, 'ReceivedOriginal'> & { ReceivedOriginal: number };

function fromRow(row: SubmissionRow): Submission {
  return { ...row, ReceivedOriginal: !!row.ReceivedOriginal };
}

export async function getSubmissionsMap(db: D1Database, employeeId: string): Promise<Record<string, Submission>> {
  const { results } = await db
    .prepare('SELECT * FROM submissions WHERE EmployeeId = ?')
    .bind(employeeId)
    .all<SubmissionRow>();
  const map: Record<string, Submission> = {};
  for (const r of results ?? []) map[r.DocKey] = fromRow(r);
  return map;
}

export async function getAllSubmissions(db: D1Database): Promise<Record<string, Record<string, Submission>>> {
  const { results } = await db.prepare('SELECT * FROM submissions').all<SubmissionRow>();
  const byEmployee: Record<string, Record<string, Submission>> = {};
  for (const r of results ?? []) {
    const id = String(r.EmployeeId);
    if (!byEmployee[id]) byEmployee[id] = {};
    byEmployee[id][r.DocKey] = fromRow(r);
  }
  return byEmployee;
}

export type SubmissionPatch = Partial<
  Pick<
    Submission,
    | 'Status' | 'SubmittedAt' | 'RejectReason' | 'RejectedAt' | 'ReceivedOriginal'
    | 'StorageKey' | 'MimeType' | 'StorageKey2' | 'MimeType2' | 'TextContent' | 'RequiredOverride'
  >
>;

// upsertSubmission_ と同じ: 既存行があれば更新、なければ既定値+patchで新規作成。UpdatedAtは常に現在時刻。
export async function upsertSubmission(db: D1Database, employeeId: string, docKey: string, patch: SubmissionPatch): Promise<Submission> {
  const existingRow = await db
    .prepare('SELECT * FROM submissions WHERE EmployeeId = ? AND DocKey = ?')
    .bind(employeeId, docKey)
    .first<SubmissionRow>();
  const existing = existingRow ? fromRow(existingRow) : null;

  const record: Submission = {
    EmployeeId: employeeId,
    DocKey: docKey,
    Status: STATUS.NONE,
    SubmittedAt: '',
    RejectReason: '',
    RejectedAt: '',
    ReceivedOriginal: false,
    StorageKey: '',
    MimeType: '',
    StorageKey2: '',
    MimeType2: '',
    TextContent: '',
    JinjerSentStorageKey: '',
    RequiredOverride: null,
    ...(existing ?? {}),
    ...patch,
    UpdatedAt: nowStr()
  };

  await db
    .prepare(
      `INSERT INTO submissions (EmployeeId, DocKey, Status, SubmittedAt, RejectReason, RejectedAt, ReceivedOriginal, UpdatedAt, StorageKey, MimeType, StorageKey2, MimeType2, TextContent, JinjerSentStorageKey, RequiredOverride)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(EmployeeId, DocKey) DO UPDATE SET
         Status=excluded.Status, SubmittedAt=excluded.SubmittedAt, RejectReason=excluded.RejectReason,
         RejectedAt=excluded.RejectedAt, ReceivedOriginal=excluded.ReceivedOriginal, UpdatedAt=excluded.UpdatedAt,
         StorageKey=excluded.StorageKey, MimeType=excluded.MimeType, StorageKey2=excluded.StorageKey2, MimeType2=excluded.MimeType2,
         TextContent=excluded.TextContent, RequiredOverride=excluded.RequiredOverride`
    )
    .bind(
      record.EmployeeId,
      record.DocKey,
      record.Status,
      record.SubmittedAt,
      record.RejectReason,
      record.RejectedAt,
      record.ReceivedOriginal ? 1 : 0,
      record.UpdatedAt,
      record.StorageKey,
      record.MimeType,
      record.StorageKey2,
      record.MimeType2,
      record.TextContent,
      record.JinjerSentStorageKey,
      record.RequiredOverride === null || record.RequiredOverride === undefined ? null : record.RequiredOverride
    )
    .run();

  return record;
}

// jinjerへのファイル送信後、「このStorageKeyまでは送信済み」を記録する(src/jinjer.ts先頭のコメント参照:
// 同じrecord_codeへの再送は上書きになるため、書類が再提出されてStorageKeyが変わった場合だけ
// adminSendFilesToJinjer側で新しいレコードを作るかどうかの判定に使う)。
export async function markJinjerSent(db: D1Database, employeeId: string, docKey: string, storageKey: string): Promise<void> {
  await db
    .prepare('UPDATE submissions SET JinjerSentStorageKey = ? WHERE EmployeeId = ? AND DocKey = ?')
    .bind(storageKey, employeeId, docKey)
    .run();
}
