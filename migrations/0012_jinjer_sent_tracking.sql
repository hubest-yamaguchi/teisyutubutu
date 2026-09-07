-- jinjerへのファイル添付(PATCH /v1/async/files)は、同じrecord_code・customize_itemに対して
-- 再送信すると新しい行が増えるのではなく既存のファイルが上書きされることを実機で確認した(2026-09-07)。
-- 差し戻し→再提出→再承認で書類が更新された際、jinjer側にも過去分を残したまま新しい行として送りたいため、
-- 「前回jinjerに送信した時点のStorageKey」を記録しておき、それと現在のStorageKeyが異なる(=再提出により
-- ファイルが変わった)場合だけ新しいレコードを作るかどうかの判定に使う(src/api/admin.tsのadminSendFilesToJinjer参照)。
ALTER TABLE submissions ADD COLUMN JinjerSentStorageKey TEXT NOT NULL DEFAULT '';
