// gas-app/Repo.gs の Admins 関連 + Auth.gs の認可判定の移植。
// GroupsAppによるグループ判定は廃止し、admins テーブルの列(PermissionsJson/MyNumberCompaniesJson)で判定する。
// 権限は「代表管理者かどうか」の単一フラグではなく、設定ページのカテゴリ単位のチェックボックス(Permissions)で管理する。
// ログインはCloudflare AccessからID/パスワード(PasswordHash)方式に変更した(src/crypto.ts, src/api/auth.ts)。

import { SettingsCategory, sanitizePermissions } from '../permissions';

export type Admin = {
  AdminId: string;
  Name: string;
  Email: string;
  Company: string;
  LineUserId: string;
  MyNumberCompanies: string[];
  Permissions: SettingsCategory[];
  HasPassword: boolean;
};

type AdminRow = {
  AdminId: string;
  Name: string;
  Email: string;
  Company: string;
  LineUserId: string;
  MyNumberCompaniesJson: string;
  PermissionsJson: string;
  PasswordHash: string;
};

function fromRow(row: AdminRow): Admin {
  let myNumberCompanies: string[] = [];
  try {
    myNumberCompanies = JSON.parse(row.MyNumberCompaniesJson || '[]');
  } catch {
    myNumberCompanies = [];
  }
  let permissions: string[] = [];
  try {
    permissions = JSON.parse(row.PermissionsJson || '[]');
  } catch {
    permissions = [];
  }
  return {
    AdminId: row.AdminId,
    Name: row.Name,
    Email: row.Email,
    Company: row.Company,
    LineUserId: row.LineUserId,
    MyNumberCompanies: myNumberCompanies,
    Permissions: sanitizePermissions(permissions),
    HasPassword: !!row.PasswordHash
  };
}

export async function listAdmins(db: D1Database): Promise<Admin[]> {
  const { results } = await db.prepare('SELECT * FROM admins ORDER BY AdminId').all<AdminRow>();
  return (results ?? []).map(fromRow);
}

export async function countAdmins(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM admins').first<{ n: number }>();
  return row?.n ?? 0;
}

export async function findAdminByEmail(db: D1Database, email: string): Promise<Admin | null> {
  if (!email) return null;
  const row = await db.prepare('SELECT * FROM admins WHERE Email = ?').bind(email).first<AdminRow>();
  return row ? fromRow(row) : null;
}

export async function isHrAdmin(db: D1Database, email: string): Promise<boolean> {
  if (!email) return false;
  return (await findAdminByEmail(db, email)) !== null;
}

// カテゴリ単位の権限チェック(旧: requireSuperAdmin_)。管理者一覧のチェックボックスで管理者ごとに設定する。
export async function hasCategoryPermission(db: D1Database, email: string, category: SettingsCategory): Promise<boolean> {
  const admin = await findAdminByEmail(db, email);
  return !!admin?.Permissions.includes(category);
}

export async function canViewMyNumber(db: D1Database, email: string, company: string): Promise<boolean> {
  const admin = await findAdminByEmail(db, email);
  if (!admin) return false;
  return admin.MyNumberCompanies.includes(company);
}

// パスワード検証用。ハッシュそのものはAdmin型に含めない(一覧表示APIで誤って返さないため)。
export async function getPasswordHash(db: D1Database, email: string): Promise<string> {
  const row = await db.prepare('SELECT PasswordHash FROM admins WHERE Email = ?').bind(email).first<{ PasswordHash: string }>();
  return row?.PasswordHash ?? '';
}

export async function setPasswordHash(db: D1Database, email: string, hash: string): Promise<void> {
  await db.prepare('UPDATE admins SET PasswordHash = ? WHERE Email = ?').bind(hash, email).run();
}

export async function updateAdmin(
  db: D1Database,
  adminId: string,
  admin: { Name: string; Email: string; Company?: string; LineUserId?: string; Permissions?: SettingsCategory[]; MyNumberCompanies?: string[] }
): Promise<void> {
  await db
    .prepare('UPDATE admins SET Name=?, Email=?, Company=?, LineUserId=?, PermissionsJson=?, MyNumberCompaniesJson=? WHERE AdminId=?')
    .bind(
      admin.Name,
      admin.Email,
      admin.Company ?? '',
      admin.LineUserId ?? '',
      JSON.stringify(sanitizePermissions(admin.Permissions ?? [])),
      JSON.stringify(admin.MyNumberCompanies ?? []),
      adminId
    )
    .run();
}

function maxNumericSuffix(ids: string[]): number {
  let max = 0;
  for (const id of ids) {
    const n = parseInt(String(id).replace(/[^0-9]/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max;
}

export async function nextAdminId(db: D1Database): Promise<string> {
  const { results } = await db.prepare('SELECT AdminId FROM admins').all<{ AdminId: string }>();
  const max = maxNumericSuffix((results ?? []).map((r) => r.AdminId));
  return 'A' + String(max + 1).padStart(3, '0');
}

export async function addAdmin(
  db: D1Database,
  admin: { Name: string; Email: string; Company?: string; LineUserId?: string; Permissions?: SettingsCategory[]; MyNumberCompanies?: string[] }
): Promise<string> {
  const id = await nextAdminId(db);
  await db
    .prepare(
      `INSERT INTO admins (AdminId, Name, Email, Company, LineUserId, PermissionsJson, MyNumberCompaniesJson)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      admin.Name,
      admin.Email,
      admin.Company ?? '',
      admin.LineUserId ?? '',
      JSON.stringify(sanitizePermissions(admin.Permissions ?? [])),
      JSON.stringify(admin.MyNumberCompanies ?? [])
    )
    .run();
  return id;
}

export async function removeAdmin(db: D1Database, adminId: string): Promise<void> {
  await db.prepare('DELETE FROM admins WHERE AdminId = ?').bind(adminId).run();
}
