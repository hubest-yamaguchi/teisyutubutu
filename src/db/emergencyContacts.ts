// 緊急連絡先。1人につき複数件あり得るため、保存は「既存を全削除→配列を再挿入」の置き換え方式にする
// (件数の増減・並び順の変更を個別のadd/remove APIなしで単純に扱うため)。

import { nowStr } from '../util/date';

export type EmergencyContact = {
  LastNameKana: string;
  FirstNameKana: string;
  LastName: string;
  FirstName: string;
  Relationship: string;
  PostalCode: string;
  AddressKana: string;
  Prefecture: string;
  City: string;
  AddressLine: string;
  Building: string;
  PhoneNumber: string;
  Email: string;
};

export async function listEmergencyContacts(db: D1Database, employeeId: string): Promise<EmergencyContact[]> {
  const { results } = await db
    .prepare('SELECT * FROM emergency_contacts WHERE EmployeeId = ? ORDER BY SortOrder')
    .bind(employeeId)
    .all<EmergencyContact>();
  return results ?? [];
}

export async function saveEmergencyContacts(db: D1Database, employeeId: string, contacts: EmergencyContact[]): Promise<void> {
  const now = nowStr();
  const stmt = db.prepare(
    `INSERT INTO emergency_contacts
      (EmployeeId, SortOrder, LastNameKana, FirstNameKana, LastName, FirstName, Relationship,
       PostalCode, AddressKana, Prefecture, City, AddressLine, Building, PhoneNumber, Email, UpdatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await db.batch([
    db.prepare('DELETE FROM emergency_contacts WHERE EmployeeId = ?').bind(employeeId),
    ...contacts.map((c, i) =>
      stmt.bind(
        employeeId,
        i,
        c.LastNameKana ?? '',
        c.FirstNameKana ?? '',
        c.LastName ?? '',
        c.FirstName ?? '',
        c.Relationship ?? '',
        c.PostalCode ?? '',
        c.AddressKana ?? '',
        c.Prefecture ?? '',
        c.City ?? '',
        c.AddressLine ?? '',
        c.Building ?? '',
        c.PhoneNumber ?? '',
        c.Email ?? '',
        now
      )
    )
  ]);
}
