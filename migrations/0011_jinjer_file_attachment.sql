-- ファイル添付(PATCH /v1/async/files)は、type=8(カスタム項目)の場合に
-- customize_menu.id + customize_item.id の2つのIDが必要と判明した(0009で用意した
-- JinjerCustomItemCode列は1つのコードしか持てず対応できないため、新たに列を追加する。
-- JinjerCustomItemCode列は未使用のまま放置してよい(実データが入っていないため削除しなくても支障ない)。
ALTER TABLE company_document_config ADD COLUMN JinjerCustomMenuId TEXT NOT NULL DEFAULT '';
ALTER TABLE company_document_config ADD COLUMN JinjerCustomItemId TEXT NOT NULL DEFAULT '';
-- 「項目追加(横)」形式のカスタム項目の場合のみ必須。「項目羅列」形式の場合は空のままでよい。
ALTER TABLE company_document_config ADD COLUMN JinjerRecordCode TEXT NOT NULL DEFAULT '';
