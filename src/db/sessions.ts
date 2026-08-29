// ID/パスワードログインのセッション管理。Cookieには生トークンのみを乗せ、DBにはそのSHA-256ハッシュを保存する
// (DBが漏れても有効なCookie値を復元できないようにするため)。

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24時間

export async function createSession(db: D1Database, sessionHash: string, email: string): Promise<Date> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db
    .prepare('INSERT INTO admin_sessions (SessionHash, Email, CreatedAt, ExpiresAt) VALUES (?, ?, ?, ?)')
    .bind(sessionHash, email, now.toISOString(), expiresAt.toISOString())
    .run();
  return expiresAt;
}

export async function findSessionEmail(db: D1Database, sessionHash: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT Email, ExpiresAt FROM admin_sessions WHERE SessionHash = ?')
    .bind(sessionHash)
    .first<{ Email: string; ExpiresAt: string }>();
  if (!row) return null;
  if (new Date(row.ExpiresAt).getTime() < Date.now()) {
    await deleteSession(db, sessionHash);
    return null;
  }
  return row.Email;
}

export async function deleteSession(db: D1Database, sessionHash: string): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE SessionHash = ?').bind(sessionHash).run();
}

export async function deleteExpiredSessions(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE ExpiresAt < ?').bind(new Date().toISOString()).run();
}

export { SESSION_TTL_MS };
