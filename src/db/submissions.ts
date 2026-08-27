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
  Pick<Submission, 'Status' | 'SubmittedAt' | 'RejectReason' | 'RejectedAt' | 'ReceivedOriginal' | 'StorageKey' | 'MimeType'>
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
    ...(existing ?? {}),
    ...patch,
    UpdatedAt: nowStr()
  };

  await db
    .prepare(
      `INSERT INTO submissions (EmployeeId, DocKey, Status, SubmittedAt, RejectReason, RejectedAt, ReceivedOriginal, UpdatedAt, StorageKey, MimeType)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(EmployeeId, DocKey) DO UPDATE SET
         Status=excluded.Status, SubmittedAt=excluded.SubmittedAt, RejectReason=excluded.RejectReason,
         RejectedAt=excluded.RejectedAt, ReceivedOriginal=excluded.ReceivedOriginal, UpdatedAt=excluded.UpdatedAt,
         StorageKey=excluded.StorageKey, MimeType=excluded.MimeType`
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
      record.MimeType
    )
    .run();

  return record;
}
