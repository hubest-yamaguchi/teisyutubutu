// gas-app-liff/Repo.gs, gas-app/Repo.gs の Employees 関連の移植。

export type Employee = {
  EmployeeId: string;
  Name: string;
  Kana: string;
  Company: string;
  Commute: string;
  HireDate: string;
  JobType: string;
  LineUserId: string;
  PictureUrl?: string;
  DriveSavedAt?: string;
};

export async function findEmployeeById(db: D1Database, employeeId: string): Promise<Employee | null> {
  const row = await db.prepare('SELECT * FROM employees WHERE EmployeeId = ?').bind(employeeId).first<Employee>();
  return row ?? null;
}

export async function findEmployeeByLineUserId(db: D1Database, lineUserId: string): Promise<Employee | null> {
  if (!lineUserId) return null;
  const row = await db.prepare('SELECT * FROM employees WHERE LineUserId = ?').bind(lineUserId).first<Employee>();
  return row ?? null;
}

// ひらがな→カタカナ変換・空白除去を行い、入力方式の揺れを吸収してからフリガナを比較する(normalizeKana_と同じ)
export function normalizeKana(kana: string): string {
  return String(kana || '')
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/\s+/g, '');
}

// フリガナが一致し、まだLINEと紐付いていない新入社員を探す。
// 本人には職種を入力させず、フリガナだけで特定した上で氏名・職種・配属先を画面に表示して確認してもらう方式にしている。
export async function findUnlinkedEmployeesByKana(db: D1Database, kana: string): Promise<Employee[]> {
  const { results } = await db.prepare("SELECT * FROM employees WHERE LineUserId = ''").all<Employee>();
  const normKana = normalizeKana(kana);
  return (results ?? []).filter((r) => normalizeKana(r.Kana) === normKana);
}

export async function saveEmployee(db: D1Database, employee: Employee): Promise<void> {
  await db
    .prepare(
      `INSERT INTO employees (EmployeeId, Name, Kana, Company, Commute, HireDate, JobType, LineUserId, PictureUrl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(EmployeeId) DO UPDATE SET
         Name=excluded.Name, Kana=excluded.Kana, Company=excluded.Company, Commute=excluded.Commute,
         HireDate=excluded.HireDate, JobType=excluded.JobType, LineUserId=excluded.LineUserId, PictureUrl=excluded.PictureUrl`
    )
    .bind(
      employee.EmployeeId,
      employee.Name,
      employee.Kana ?? '',
      employee.Company ?? '',
      employee.Commute ?? '',
      employee.HireDate ?? '',
      employee.JobType ?? '',
      employee.LineUserId ?? '',
      employee.PictureUrl ?? ''
    )
    .run();
}

// 一括登録用(saveEmployees_と同じ)
export async function saveEmployees(db: D1Database, employees: Employee[]): Promise<void> {
  if (!employees.length) return;
  const stmt = db.prepare(
    `INSERT INTO employees (EmployeeId, Name, Kana, Company, Commute, HireDate, JobType, LineUserId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await db.batch(
    employees.map((e) =>
      stmt.bind(e.EmployeeId, e.Name, e.Kana ?? '', e.Company ?? '', e.Commute ?? '', e.HireDate ?? '', e.JobType ?? '', e.LineUserId ?? '')
    )
  );
}

export async function listEmployees(db: D1Database): Promise<Employee[]> {
  const { results } = await db.prepare('SELECT * FROM employees ORDER BY EmployeeId').all<Employee>();
  return results ?? [];
}

// テスト登録などを取り消すための削除。提出物・履歴も合わせて削除する(孤立データを残さないため)
export async function deleteEmployee(db: D1Database, employeeId: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM submissions WHERE EmployeeId = ?').bind(employeeId),
    db.prepare('DELETE FROM submission_history WHERE EmployeeId = ?').bind(employeeId),
    db.prepare('DELETE FROM employees WHERE EmployeeId = ?').bind(employeeId)
  ]);
}

export async function markDriveSaved(db: D1Database, employeeId: string, timestamp: string): Promise<void> {
  await db.prepare('UPDATE employees SET DriveSavedAt = ? WHERE EmployeeId = ?').bind(timestamp, employeeId).run();
}

export async function bulkSetHireDate(db: D1Database, hireDate: string): Promise<number> {
  const res = await db.prepare('UPDATE employees SET HireDate = ?').bind(hireDate).run();
  return res.meta.changes ?? 0;
}

function maxNumericSuffix(ids: string[]): number {
  let max = 0;
  for (const id of ids) {
    const n = parseInt(String(id).replace(/[^0-9]/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max;
}

export async function nextEmployeeId(db: D1Database): Promise<string> {
  const { results } = await db.prepare('SELECT EmployeeId FROM employees').all<{ EmployeeId: string }>();
  const max = maxNumericSuffix((results ?? []).map((r) => r.EmployeeId));
  return 'E' + String(max + 1).padStart(4, '0');
}

export async function nextEmployeeIds(db: D1Database, count: number): Promise<string[]> {
  const { results } = await db.prepare('SELECT EmployeeId FROM employees').all<{ EmployeeId: string }>();
  const base = maxNumericSuffix((results ?? []).map((r) => r.EmployeeId));
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) ids.push('E' + String(base + i).padStart(4, '0'));
  return ids;
}
