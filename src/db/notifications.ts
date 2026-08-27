// gas-app/Line.gs の logNotifications_ / adminListNotifications 相当。

import { nowStr } from '../util/date';

export type NotificationDirection = 'to_admin' | 'to_employee';
export type SendResult = { sent: boolean; reason?: string };

export type NotificationLogRow = {
  Timestamp: string;
  Direction: string;
  ToEmployeeId: string;
  ToAdminId: string;
  Message: string;
  Status: string;
  SentAt: string;
};

const DIRECTION_LABELS: Record<NotificationDirection, string> = { to_admin: '管理者宛', to_employee: '本人宛' };

// notificationLogRow_ と同じ
export function buildNotificationLogRow(
  direction: NotificationDirection,
  employeeId: string,
  adminId: string,
  message: string,
  result: SendResult
): NotificationLogRow {
  return {
    Timestamp: nowStr(),
    Direction: DIRECTION_LABELS[direction] ?? direction,
    ToEmployeeId: employeeId || '',
    ToAdminId: adminId || '',
    Message: message,
    Status: result.sent ? '送信済み' : `保留中（${result.reason}）`,
    SentAt: result.sent ? nowStr() : ''
  };
}

export async function logNotifications(db: D1Database, rows: NotificationLogRow[]): Promise<void> {
  if (!rows.length) return;
  const stmt = db.prepare(
    `INSERT INTO notification_queue (Timestamp, Direction, ToEmployeeId, ToAdminId, Message, Status, SentAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  await db.batch(rows.map((r) => stmt.bind(r.Timestamp, r.Direction, r.ToEmployeeId, r.ToAdminId, r.Message, r.Status, r.SentAt)));
}

export async function listRecentNotifications(db: D1Database, limit = 100): Promise<NotificationLogRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM notification_queue ORDER BY Id DESC LIMIT ?')
    .bind(limit)
    .all<NotificationLogRow>();
  return results ?? [];
}
