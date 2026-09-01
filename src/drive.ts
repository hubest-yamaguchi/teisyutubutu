// Google Drive連携。サービスアカウントの秘密鍵からJWTを都度組み立ててOAuth2トークンを取得し、
// Drive API v3をfetchで直接叩く(Workers環境では googleapis 公式SDKは使わず、必要な範囲だけ自前実装)。

import type { Env } from './bindings';

function base64UrlEncode(input: string | Uint8Array): string {
  const bin = typeof input === 'string' ? input : String.fromCharCode(...input);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

async function fetchAccessToken(clientEmail: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claim))}`;
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  if (!res.ok) throw new Error(`Google認証に失敗しました: ${await res.text()}`);
  const data = await res.json<{ access_token: string }>();
  return data.access_token;
}

export async function getDriveAccessToken(env: Env): Promise<string> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error('Google Driveサービスアカウントの設定(secret)がありません');
  }
  return fetchAccessToken(env.GOOGLE_SERVICE_ACCOUNT_EMAIL, env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
}

function escapeForQuery(name: string): string {
  return name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findChildByName(accessToken: string, parentId: string, name: string, mimeType?: string): Promise<string | null> {
  const conditions = [`'${parentId}' in parents`, `name = '${escapeForQuery(name)}'`, 'trashed = false'];
  if (mimeType) conditions.push(`mimeType = '${mimeType}'`);
  const q = encodeURIComponent(conditions.join(' and '));
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Drive検索に失敗しました: ${await res.text()}`);
  const data = await res.json<{ files: { id: string }[] }>();
  return data.files?.[0]?.id ?? null;
}

// 指定フォルダ直下の子フォルダを取得、無ければ作成する(旧gas-app/Drive.gsのgetOrCreateEmployeeFolder_と同じ考え方)。
// 年度フォルダ・社員フォルダのどちらの階層を作る際にも使う汎用関数。
export async function ensureFolder(accessToken: string, parentFolderId: string, folderName: string): Promise<string> {
  const existing = await findChildByName(accessToken, parentFolderId, folderName, 'application/vnd.google-apps.folder');
  if (existing) return existing;

  const res = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentFolderId] })
  });
  if (!res.ok) throw new Error(`Driveフォルダの作成に失敗しました: ${await res.text()}`);
  const data = await res.json<{ id: string }>();
  return data.id;
}

type DrivePermission = {
  id: string;
  emailAddress?: string;
  role: string;
  type: string;
  permissionDetails?: { inherited?: boolean }[];
};

// 上位階層(共有ドライブのメンバー、親フォルダの共有など)から引き継いだ権限かどうか。
// 継承された権限はこのフォルダ単体では削除できない(Drive APIがcannotDeletePermissionで拒否する)。
function isInheritedPermission(p: DrivePermission): boolean {
  return !!p.permissionDetails && p.permissionDetails.some((d) => d.inherited);
}

async function listFolderPermissions(accessToken: string, folderId: string): Promise<DrivePermission[]> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${folderId}/permissions?fields=permissions(id,emailAddress,role,type,permissionDetails)&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Drive権限一覧の取得に失敗しました: ${await res.text()}`);
  const data = await res.json<{ permissions: DrivePermission[] }>();
  return data.permissions ?? [];
}

async function createFolderPermission(accessToken: string, folderId: string, email: string): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${folderId}/permissions?supportsAllDrives=true&sendNotificationEmail=false`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'user', emailAddress: email })
    }
  );
  if (!res.ok) throw new Error(`Driveフォルダの共有に失敗しました(${email}): ${await res.text()}`);
}

async function deleteFolderPermission(accessToken: string, folderId: string, permissionId: string): Promise<void> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions/${permissionId}?supportsAllDrives=true`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`Driveフォルダの共有解除に失敗しました: ${await res.text()}`);
}

/**
 * フォルダの閲覧権限(role: reader, type: user)を targetEmails だけに揃える。
 * ・owner権限(サービスアカウント自身)には一切触れない
 * ・type が user 以外(anyone/domain/groupなど、共有ドライブ全体設定に由来するもの)にも触れない
 * ・上位階層から継承された権限(共有ドライブのメンバー、親フォルダの共有など)にも触れない
 *   (このフォルダ単体では削除できず、Drive APIがcannotDeletePermissionで拒否するため。
 *    これらを本当に外したい場合は、共有ドライブ側で手動対応する必要がある)
 */
export async function syncFolderPermissions(
  accessToken: string,
  folderId: string,
  targetEmails: string[]
): Promise<{ granted: string[]; revoked: string[] }> {
  const current = await listFolderPermissions(accessToken, folderId);
  const targetSet = new Set(targetEmails.map((e) => e.toLowerCase()));
  const managed = current.filter((p) => p.type === 'user' && p.role !== 'owner' && !isInheritedPermission(p));

  const granted: string[] = [];
  const revoked: string[] = [];

  for (const perm of managed) {
    const email = (perm.emailAddress || '').toLowerCase();
    if (!targetSet.has(email)) {
      await deleteFolderPermission(accessToken, folderId, perm.id);
      revoked.push(perm.emailAddress || perm.id);
    }
  }

  const already = new Set(managed.map((p) => (p.emailAddress || '').toLowerCase()));
  for (const email of targetEmails) {
    if (!already.has(email.toLowerCase())) {
      await createFolderPermission(accessToken, folderId, email);
      granted.push(email);
    }
  }

  return { granted, revoked };
}

// 同名ファイルが既にあれば削除してから保存する(上書き。旧gas-app/Drive.gsのsaveEmployeeFile_と同じ挙動)。
export async function uploadFileToDrive(
  accessToken: string,
  folderId: string,
  fileName: string,
  mimeType: string,
  bytes: ArrayBuffer
): Promise<string> {
  const existingId = await findChildByName(accessToken, folderId, fileName);
  if (existingId) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${existingId}?supportsAllDrives=true`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  }

  const boundary = crypto.randomUUID();
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.byteLength + tail.length);
  body.set(head, 0);
  body.set(new Uint8Array(bytes), head.length);
  body.set(tail, head.length + bytes.byteLength);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  if (!res.ok) throw new Error(`Driveへのアップロードに失敗しました: ${await res.text()}`);
  const data = await res.json<{ id: string }>();
  return data.id;
}
