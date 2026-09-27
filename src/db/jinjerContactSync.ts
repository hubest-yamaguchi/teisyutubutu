// 緊急連絡先のjinjer送信状況を、連絡先の内容(フィンガープリント)単位で記録する。
// emergency_contactsは編集のたびに「全削除→再挿入」される(行IDが安定しない)ため、
// 行IDではなくここで管理する。src/api/admin.tsのadminSyncToJinjer参照。

import { EmergencyContact } from './emergencyContacts';

// 送信内容を構成する項目を連結してキーにする(いずれかの項目が変われば別の連絡先として扱う)。
export function contactFingerprint(c: EmergencyContact): string {
  return [
    c.LastName, c.FirstName, c.LastNameKana, c.FirstNameKana, c.Relationship,
    c.PostalCode, c.Prefecture, c.City, c.AddressLine, c.Building, c.PhoneNumber, c.Email
  ].map((v) => (v ?? '').trim()).join('|');
}

export async function getSyncedContactFingerprints(db: D1Database, employeeId: string): Promise<Set<string>> {
  const { results } = await db
    .prepare('SELECT ContactFingerprint FROM jinjer_synced_contacts WHERE EmployeeId = ?')
    .bind(employeeId)
    .all<{ ContactFingerprint: string }>();
  return new Set((results ?? []).map((r) => r.ContactFingerprint));
}

export async function markContactSynced(db: D1Database, employeeId: string, fingerprint: string, timestamp: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO jinjer_synced_contacts (EmployeeId, ContactFingerprint, SyncedAt)
       VALUES (?, ?, ?)
       ON CONFLICT(EmployeeId, ContactFingerprint) DO UPDATE SET SyncedAt = excluded.SyncedAt`
    )
    .bind(employeeId, fingerprint, timestamp)
    .run();
}
