-- マイナンバー確認書類(表/裏)のように、1つの書類項目で2枚の画像を提出できるようにする。
-- 承認・差し戻し・提出日時などのステータスは1件の書類として共通のまま、ファイルの実体だけ2つ持てるようにする。
ALTER TABLE submissions ADD COLUMN StorageKey2 TEXT NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN MimeType2 TEXT NOT NULL DEFAULT '';
ALTER TABLE company_document_config ADD COLUMN DualFile INTEGER NOT NULL DEFAULT 0;
