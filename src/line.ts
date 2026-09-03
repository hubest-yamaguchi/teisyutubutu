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

// チャット機能(管理画面からの個別返信)用。通知ログ(notification_queue)には積まず、
// 呼び出し側(admin.ts)がline_messagesに送信結果を記録する。
export async function sendChatReply(db: D1Database, lineUserId: string, message: string): Promise<SendResult> {
  return sendNotification(db, lineUserId, message);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// LINE Webhookのx-line-signatureヘッダー検証(チャネルシークレットでのHMAC-SHA256署名、base64比較)。
// 生のリクエストボディ(JSON.parse前の文字列)をそのまま渡すこと。
export async function verifyLineSignature(channelSecret: string, rawBody: string, signatureHeader: string | null | undefined): Promise<boolean> {
  if (!channelSecret || !signatureHeader) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(channelSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
  return timingSafeEqual(expected, signatureHeader);
}

// 画像メッセージの実体(バイナリ)取得。テキストと違いMessaging APIの専用ドメイン(api-data.line.me)を使う。
export async function fetchLineMessageContent(
  channelAccessToken: string,
  messageId: string
): Promise<{ bytes: ArrayBuffer; mimeType: string } | null> {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${channelAccessToken}` }
  });
  if (!res.ok) {
    console.log(`LINE content fetch failed (${res.status}): ${await res.text().catch(() => '')}`);
    return null;
  }
  return { bytes: await res.arrayBuffer(), mimeType: res.headers.get('Content-Type') || 'application/octet-stream' };
}
