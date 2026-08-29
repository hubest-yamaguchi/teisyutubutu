-- 書類マスタに「対象法人」を複数選択できるようにする(法人ごとの提出書類マスタ)。
-- 旧: ConditionType='配属先'/ConditionValue=法人名 という単一条件だった賃貸借契約書などを、
-- CompaniesJson(法人名の配列)に移行する。ConditionType/ConditionValueは通勤手段の条件専用として残す。

ALTER TABLE company_document_config ADD COLUMN CompaniesJson TEXT NOT NULL DEFAULT '[]';

UPDATE company_document_config
SET CompaniesJson = '["' || ConditionValue || '"]', ConditionType = '', ConditionValue = ''
WHERE ConditionType = '配属先';
