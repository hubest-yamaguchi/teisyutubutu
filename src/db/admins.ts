// gas-app/Repo.gs の Admins 関連 + Auth.gs の認可判定の移植。
// GroupsAppによるグループ判定は廃止し、admins テーブルの列(IsSuperAdmin/MyNumberCompaniesJson)で判定する。
// ブートストラップモード(Auth.gsと同じ考え方): adminsが1件も無い間は、初回セットアップ担当者を通すため誰でもHR管理者/代表管理者として扱う。

export type Admin = {
  AdminId: string;
  Name: string;
  Email: string;
  Company: string;
  LineUserId: string;
  IsSuperAdmin: boolean;
  MyNumberCompanies: string[];
};

type AdminRow = {
  AdminId: string;
  Name: string;
  Email: string;
  Company: string;
  LineUserId: string;
  IsSuperAdmin: number;
  MyNumberCompaniesJson: string;
};

function fromRow(row: AdminRow): Admin {
  let myNumberCompanies: string[] = [];
  try {
    myNumberCompanies = JSON.parse(row.MyNumberCompaniesJson || '[]');
  } catch {
    myNumberCompanies = [];
  }
  return {
    AdminId: row.AdminId,
    Name: row.Name,
    Email: row.Email,
    Company: row.Company,
    LineUserId: row.LineUserId,
    IsSuperAdmin: !!row.IsSuperAdmin,
    MyNumberCompanies: myNumberCompanies
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
  if ((await countAdmins(db)) === 0) return true; // ブートストラップモード
  return (await findAdminByEmail(db, email)) !== null;
}

export async function isSuperAdmin(db: D1Database, email: string): Promise<boolean> {
  if (!email) return false;
  if ((await countAdmins(db)) === 0) return true; // ブートストラップモード
  const admin = await findAdminByEmail(db, email);
  return !!admin?.IsSuperAdmin;
}

export async function canViewMyNumber(db: D1Database, email: string, company: string): Promise<boolean> {
  if (!(await isHrAdmin(db, email))) return false;
  const admin = await findAdminByEmail(db, email);
  if (!admin) return false; // ブートストラップ中でも、マイナンバーは明示的な許可がなければ見せない
  return admin.MyNumberCompanies.includes(company);
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
  admin: { Name: string; Email: string; Company?: string; LineUserId?: string; IsSuperAdmin?: boolean; MyNumberCompanies?: string[] }
): Promise<string> {
  const id = await nextAdminId(db);
  await db
    .prepare(
      `INSERT INTO admins (AdminId, Name, Email, Company, LineUserId, IsSuperAdmin, MyNumberCompaniesJson)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      admin.Name,
      admin.Email,
      admin.Company ?? '',
      admin.LineUserId ?? '',
      admin.IsSuperAdmin ? 1 : 0,
      JSON.stringify(admin.MyNumberCompanies ?? [])
    )
    .run();
  return id;
}

export async function removeAdmin(db: D1Database, adminId: string): Promise<void> {
  await db.prepare('DELETE FROM admins WHERE AdminId = ?').bind(adminId).run();
}
