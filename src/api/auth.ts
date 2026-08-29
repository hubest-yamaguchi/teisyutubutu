// ID/パスワードログインの業務ロジック。Cookie発行そのものはsession.ts、配線はindex.tsで行う。

import type { Env } from '../bindings';
import { findAdminByEmail, getPasswordHash, setPasswordHash, countAdmins, addAdmin } from '../db/admins';
import { hashPassword, verifyPassword } from '../crypto';
import { SETTINGS_CATEGORIES } from '../permissions';

class AuthError extends Error {}

export async function login(env: Env, email: string, password: string): Promise<string> {
  if (!email || !password) throw new AuthError('メールアドレスとパスワードを入力してください');
  const hash = await getPasswordHash(env.DB, email);
  if (!hash || !(await verifyPassword(password, hash))) {
    throw new AuthError('メールアドレスまたはパスワードが違います');
  }
  return email;
}

// 初回のみ使う「アカウントの有効化」。管理者一覧に登録済みだがパスワード未設定のメールに対して、
// 本人が初めてここでパスワードを設定する(旧: Cloudflare Accessのメール招待に相当)。
// admins が1件も無い状態(初回デプロイ直後)なら、このメールで全権限の最初の管理者を作成する。
export async function claimAccount(env: Env, name: string, email: string, password: string): Promise<void> {
  if (!email || !password) throw new AuthError('メールアドレスとパスワードを入力してください');
  if (password.length < 8) throw new AuthError('パスワードは8文字以上にしてください');

  const admin = await findAdminByEmail(env.DB, email);
  if (admin) {
    if (admin.HasPassword) {
      throw new AuthError('このメールアドレスはすでにパスワードが設定されています。パスワードを忘れた場合は他の管理者にリセットを依頼してください。');
    }
    await setPasswordHash(env.DB, email, await hashPassword(password));
    return;
  }

  if ((await countAdmins(env.DB)) > 0) {
    throw new AuthError('このメールアドレスは管理者として登録されていません。既存の管理者に登録を依頼してください。');
  }

  await addAdmin(env.DB, { Name: name || email, Email: email, Permissions: [...SETTINGS_CATEGORIES] });
  await setPasswordHash(env.DB, email, await hashPassword(password));
}

export async function changePassword(env: Env, email: string, currentPassword: string, newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 8) throw new AuthError('新しいパスワードは8文字以上にしてください');
  const hash = await getPasswordHash(env.DB, email);
  if (!hash || !(await verifyPassword(currentPassword, hash))) throw new AuthError('現在のパスワードが違います');
  await setPasswordHash(env.DB, email, await hashPassword(newPassword));
}

export { AuthError };
