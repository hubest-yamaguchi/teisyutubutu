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
