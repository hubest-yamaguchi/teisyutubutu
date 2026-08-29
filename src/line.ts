// gas-app-liff/Line.gs, gas-app/Line.gs の移植。UrlFetchApp -> fetch。

import { getSetting } from './db/settings';
import { SETTINGS_KEYS } from './db/settings';
import { logNotifications, buildNotificationLogRow, SendResult } from './db/notifications';

type NotificationRequest = { url: string; method: 'POST'; headers: Record<string, string>; body: string };
type BuiltNotification = { skip: string } | { request: NotificationRequest };

async function buildNotificationRequest(db: D1Database, lineUserId: string, message: string): Promise<BuiltNotification> {
  const token = await getSetting(db, SETTINGS_KEYS.LINE_CHANNEL_ACCESS_TOKEN);
  if (!token) return { skip: 'LINEアクセストークン未設定' };
  if (!lineUserId) return { skip: 'LINEユーザーID未登録' };
  return {
    request: {
      url: 'https://api.line.me/v2/bot/message/push',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text: message }] })
    }
  };
}

async function sendRequest(req: NotificationRequest): Promise<SendResult> {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  if (res.ok) return { sent: true };
  const text = await res.text().catch(() => '');
  console.log(`LINE push failed (${res.status}): ${text}`);
  return { sent: false, reason: `LINE API エラー(${res.status})` };
}

async function sendNotification(db: D1Database, lineUserId: string, message: string): Promise<SendResult> {
  const built = await buildNotificationRequest(db, lineUserId, message);
  if ('skip' in built) return { sent: false, reason: built.skip };
  return sendRequest(built.request);
}

// 本人(新入社員)への通知。管理者への「提出がありました」通知は行わない方針のため、
// LINE通知は「差し戻し」「リマインダー」など、こちらから本人へ送る場合のみ使う。
export async function notifyEmployee(db: D1Database, employee: { EmployeeId: string; LineUserId: string }, message: string): Promise<SendResult> {
  const result = await sendNotification(db, employee.LineUserId, message);
  await logNotifications(db, [buildNotificationLogRow('to_employee', employee.EmployeeId, '', message, result)]);
  return result;
}
