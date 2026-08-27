// gas-app-liff/Line.gs, gas-app/Line.gs の移植。UrlFetchApp -> fetch。

import { getSetting } from './db/settings';
import { SETTINGS_KEYS, NOTIFY_PROVIDERS } from './db/settings';
import { listAdmins } from './db/admins';
import { logNotifications, buildNotificationLogRow, SendResult, NotificationDirection } from './db/notifications';

type NotificationRequest = { url: string; method: 'POST'; headers: Record<string, string>; body: string };
type BuiltNotification = { skip: string } | { request: NotificationRequest };

async function buildNotificationRequest(db: D1Database, lineUserId: string, message: string): Promise<BuiltNotification> {
  const provider = (await getSetting(db, SETTINGS_KEYS.NOTIFY_PROVIDER)) || NOTIFY_PROVIDERS.LINE;

  if (provider === NOTIFY_PROVIDERS.LINY) {
    const apiKey = await getSetting(db, SETTINGS_KEYS.LINY_API_KEY);
    if (!apiKey) return { skip: 'Liny HR APIキー未設定' };
    // Liny側の正式なAPI仕様が未確認のため未実装(gas-app/Line.gsと同じ状態)。
    return { skip: 'Liny HR連携は仕様確認中のため未実装です' };
  }

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

// 本人(新入社員)への通知
export async function notifyEmployee(db: D1Database, employee: { EmployeeId: string; LineUserId: string }, message: string): Promise<SendResult> {
  const result = await sendNotification(db, employee.LineUserId, message);
  await logNotifications(db, [buildNotificationLogRow('to_employee', employee.EmployeeId, '', message, result)]);
  return result;
}

// 管理者への通知。Adminsの全員に並列で個別送信する(notifyAllAdmins_と同じ)
export async function notifyAllAdmins(db: D1Database, message: string): Promise<void> {
  const admins = await listAdmins(db);
  if (!admins.length) return;

  const built = await Promise.all(admins.map((a) => buildNotificationRequest(db, a.LineUserId, message)));
  const results: SendResult[] = await Promise.all(
    built.map((b) => ('skip' in b ? Promise.resolve<SendResult>({ sent: false, reason: b.skip }) : sendRequest(b.request)))
  );

  const rows = admins.map((a, i) => buildNotificationLogRow('to_admin' as NotificationDirection, '', a.AdminId, message, results[i]));
  await logNotifications(db, rows);
}
