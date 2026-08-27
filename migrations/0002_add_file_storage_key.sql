-- 提出ファイルのR2キー・MIMEタイプをsubmissionsに記録する(管理画面からファイルを表示するために必要)。
-- 移行前のデータ(StorageKeyが空)は表示リンクを出さないだけで、他の機能には影響しない。
ALTER TABLE submissions ADD COLUMN StorageKey TEXT NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN MimeType TEXT NOT NULL DEFAULT '';
