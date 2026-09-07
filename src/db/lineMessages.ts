// 内定者⇔管理者間のLINEメッセージ履歴(line_messagesテーブル)。

import { nowStr } from '../util/date';

export type LineMessageDirection = 'in' | 'out';
export type LineMessageType = 'text' | 'image';

export type LineMessageRow = {
  Id: number;
  EmployeeId: string;
  Direction: LineMessageDirection;
  MessageType: LineMessageType;
  Text: string;
  StorageKey: string;
  MimeType: string;
  LineMessageId: string;
  AdminEmail: string;
  CreatedAt: string;
};

export async function listMessages(db: D1Database, employeeId: string): Promise<LineMessageRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM line_messages WHERE EmployeeId = ? ORDER BY Id ASC')
    .bind(employeeId)
    .all<LineMessageRow>();
  return results ?? [];
}

export async function findMessageById(db: D1Database, id: number): Promise<LineMessageRow | null> {
  const row = await db.prepare('SELECT * FROM line_messages WHERE Id = ?').bind(id).first<LineMessageRow>();
  return row ?? null;
}

// Webhookの再送で同じLINEメッセージIDが来ても二重登録しない(line_messages.LineMessageIdの一意制約に委ねる)。
export async function insertInboundMessage(
  db: D1Database,
  row: { employeeId: string; messageType: LineMessageType; text: string; storageKey: string; mimeType: string; lineMessageId: string }
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO line_messages
       (EmployeeId, Direction, MessageType, Text, StorageKey, MimeType, LineMessageId, AdminEmail, CreatedAt)
       VALUES (?, 'in', ?, ?, ?, ?, ?, '', ?)`
    )
    .bind(row.employeeId, row.messageType, row.text, row.storageKey, row.mimeType, row.lineMessageId, nowStr())
    .run();
}

// ダッシュボードの「未返信件数」バッジ用。各社員について、最後に管理者が返信(Direction='out')した後に
// 届いた内定者からのメッセージ(Direction='in')の件数を数える(まだ一度も返信していない社員は、
// 届いた内定者メッセージ全件が対象になる)。
export async function getUnrepliedCounts(db: D1Database): Promise<Record<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT EmployeeId, COUNT(*) AS n
       FROM line_messages m
       WHERE Direction = 'in'
         AND Id > COALESCE(
           (SELECT MAX(Id) FROM line_messages m2 WHERE m2.EmployeeId = m.EmployeeId AND m2.Direction = 'out'),
           0
         )
       GROUP BY EmployeeId`
    )
    .all<{ EmployeeId: string; n: number }>();
  const map: Record<string, number> = {};
  for (const r of results ?? []) map[r.EmployeeId] = r.n;
  return map;
}

// ダッシュボードの一覧に「最新メッセージのプレビュー」を出すため、社員ごとに最後の1件だけを返す。
export async function getLatestMessages(
  db: D1Database
): Promise<Record<string, { text: string; direction: LineMessageDirection; messageType: LineMessageType; createdAt: string }>> {
  const { results } = await db
    .prepare(
      `SELECT m.EmployeeId, m.Direction, m.MessageType, m.Text, m.CreatedAt
       FROM line_messages m
       WHERE m.Id = (SELECT MAX(Id) FROM line_messages m2 WHERE m2.EmployeeId = m.EmployeeId)`
    )
    .all<{ EmployeeId: string; Direction: LineMessageDirection; MessageType: LineMessageType; Text: string; CreatedAt: string }>();
  const map: Record<string, { text: string; direction: LineMessageDirection; messageType: LineMessageType; createdAt: string }> = {};
  for (const r of results ?? []) {
    map[r.EmployeeId] = { text: r.Text, direction: r.Direction, messageType: r.MessageType, createdAt: r.CreatedAt };
  }
  return map;
}

export async function insertOutboundMessage(db: D1Database, employeeId: string, text: string, adminEmail: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO line_messages
       (EmployeeId, Direction, MessageType, Text, StorageKey, MimeType, LineMessageId, AdminEmail, CreatedAt)
       VALUES (?, 'out', 'text', ?, '', '', '', ?, ?)`
    )
    .bind(employeeId, text, adminEmail, nowStr())
    .run();
}
