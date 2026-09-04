-- jinjer連携(Phase 2)用の追加列。認証方式・エンドポイント・fileオブジェクトの実際の形式は
-- ジンジャーAPI利用契約発行後、開発者ガイド(https://doc.api.jinjer.biz/index.html)を見ながら
-- src/jinjer.ts側で確定させる前提で、先に用意できるスキーマ部分だけをここに定義する。

-- (A) 従業員マスタ同期用: jinjer側の従業員ID・最終同期日時
ALTER TABLE employees ADD COLUMN JinjerEmployeeId TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN JinjerSyncedAt TEXT NOT NULL DEFAULT '';

-- (B) ファイル添付用: 書類種別ごとに対応させるjinjer側「カスタム項目」のコード(customize_menu)。
-- 空のままの書類種別はjinjerへのファイル送信対象外として扱う(jinjer側でカスタム項目を用意していない場合のため)。
ALTER TABLE company_document_config ADD COLUMN JinjerCustomItemCode TEXT NOT NULL DEFAULT '';
