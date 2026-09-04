-- 緊急連絡先(jinjer連携を見据え、jinjerの緊急連絡先フォームの項目に合わせている)。
-- 1人の内定者につき複数件登録できるため、employeesへの列追加ではなく別テーブルにする。
-- 保存は「全削除→再挿入」の置き換え方式(emergencyContacts.ts)で行うため、履歴保持用の列は持たない。

CREATE TABLE emergency_contacts (
  Id             INTEGER PRIMARY KEY AUTOINCREMENT,
  EmployeeId     TEXT NOT NULL,
  SortOrder      INTEGER NOT NULL DEFAULT 0,
  LastNameKana   TEXT NOT NULL DEFAULT '',
  FirstNameKana  TEXT NOT NULL DEFAULT '',
  LastName       TEXT NOT NULL DEFAULT '',
  FirstName      TEXT NOT NULL DEFAULT '',
  Relationship   TEXT NOT NULL DEFAULT '',
  PostalCode     TEXT NOT NULL DEFAULT '',
  AddressKana    TEXT NOT NULL DEFAULT '',
  Prefecture     TEXT NOT NULL DEFAULT '',
  City           TEXT NOT NULL DEFAULT '',
  AddressLine    TEXT NOT NULL DEFAULT '',
  Building       TEXT NOT NULL DEFAULT '',
  PhoneNumber    TEXT NOT NULL DEFAULT '',
  Email          TEXT NOT NULL DEFAULT '',
  UpdatedAt      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_emergency_contacts_employee ON emergency_contacts(EmployeeId, SortOrder);
