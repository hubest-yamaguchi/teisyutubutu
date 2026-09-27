-- 緊急連絡先のjinjer送信を1件ずつ記録するためのテーブル。
-- emergency_contactsは編集のたびに「全削除→再挿入」される(IDが安定しない)ため、
-- 行IDではなく連絡先の内容そのもの(ContactFingerprint)をキーにして送信済みを判定する。
-- これにより、複数件送信中に一部が失敗しても、再実行時に送信済みの分だけ重複登録を避けられる。
CREATE TABLE jinjer_synced_contacts (
  EmployeeId         TEXT NOT NULL,
  ContactFingerprint TEXT NOT NULL,
  SyncedAt           TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (EmployeeId, ContactFingerprint)
);
