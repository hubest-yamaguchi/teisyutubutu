-- 「本人確認済み」の記録。本人がLIFFの確認画面で「はい(この内容で合っています)」を選んだ日時を持つ
-- (空欄=まだ本人確認していない)。管理画面の新入社員一覧のチェックボックスはこの列で判定する。
ALTER TABLE employees ADD COLUMN IdentityConfirmedAt TEXT NOT NULL DEFAULT '';

-- 既に本人確認(LINE連携)を済ませている人は、操作履歴の「LINE連携」の日時で埋める
UPDATE employees SET IdentityConfirmedAt = COALESCE(
  (SELECT MIN(h.Timestamp) FROM submission_history h WHERE h.EmployeeId = employees.EmployeeId AND h.Action = 'LINE連携'),
  '日時不明（連携済み）'
) WHERE LineUserId != '';

-- 配属先は本人確認を待たずに管理側で確認できるよう、登録時点で職種法人マスタから決める方式に変更した。
-- 既存の未設定の人も、職種法人マスタから埋めておく。
UPDATE employees SET Company = (
  SELECT TRIM(m.Company) FROM job_type_company_map m WHERE TRIM(m.JobType) = TRIM(employees.JobType)
) WHERE Company = '' AND EXISTS (
  SELECT 1 FROM job_type_company_map m WHERE TRIM(m.JobType) = TRIM(employees.JobType)
);
