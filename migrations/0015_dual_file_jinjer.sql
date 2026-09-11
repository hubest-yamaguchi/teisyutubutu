-- dualFileの書類(運転免許証など)で、2枚目(裏面)もjinjerへ送信できるようにする。
ALTER TABLE company_document_config ADD COLUMN JinjerCustomItemId2 TEXT NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN JinjerSentStorageKey2 TEXT NOT NULL DEFAULT '';
