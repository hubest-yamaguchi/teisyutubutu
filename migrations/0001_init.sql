-- 初期スキーマ。gas-app / gas-app-liff の SHEETS_ 定義(Sheets.gs)を1対1で移植したもの。
-- 真偽値は 0/1 の INTEGER。日時は 'yyyy-MM-dd HH:mm:ss' or 'yyyy-MM-dd' のTEXT(Asia/Tokyo基準、旧nowStr_/todayStr_と同じ書式)。

CREATE TABLE employees (
  EmployeeId TEXT PRIMARY KEY,
  Name       TEXT NOT NULL,
  Kana       TEXT NOT NULL DEFAULT '',
  Company    TEXT NOT NULL DEFAULT '',
  Commute    TEXT NOT NULL DEFAULT '',
  HireDate   TEXT NOT NULL DEFAULT '',
  JobType    TEXT NOT NULL DEFAULT '',
  LineUserId TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX idx_employees_line_user_id ON employees(LineUserId) WHERE LineUserId != '';
CREATE INDEX idx_employees_kana_jobtype ON employees(Kana, JobType);

CREATE TABLE job_type_company_map (
  JobType TEXT PRIMARY KEY,
  Company TEXT NOT NULL
);

CREATE TABLE submissions (
  EmployeeId       TEXT NOT NULL,
  DocKey           TEXT NOT NULL,
  Status           TEXT NOT NULL DEFAULT '未提出',
  SubmittedAt      TEXT NOT NULL DEFAULT '',
  RejectReason     TEXT NOT NULL DEFAULT '',
  RejectedAt       TEXT NOT NULL DEFAULT '',
  ReceivedOriginal INTEGER NOT NULL DEFAULT 0,
  UpdatedAt        TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (EmployeeId, DocKey)
);
CREATE INDEX idx_submissions_employee ON submissions(EmployeeId);

CREATE TABLE submission_history (
  Id         INTEGER PRIMARY KEY AUTOINCREMENT,
  Timestamp  TEXT NOT NULL,
  EmployeeId TEXT NOT NULL,
  DocKey     TEXT NOT NULL DEFAULT '',
  Action     TEXT NOT NULL,
  Detail     TEXT NOT NULL DEFAULT '',
  ActorEmail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_submission_history_employee ON submission_history(EmployeeId);

CREATE TABLE company_document_config (
  DocKey           TEXT PRIMARY KEY,
  Label            TEXT NOT NULL,
  RequiresOriginal INTEGER NOT NULL DEFAULT 0,
  PdfAllowed       INTEGER NOT NULL DEFAULT 0,
  ConditionType    TEXT NOT NULL DEFAULT '',
  ConditionValue   TEXT NOT NULL DEFAULT '',
  Sensitive        INTEGER NOT NULL DEFAULT 0,
  Description      TEXT NOT NULL DEFAULT '',
  SortOrder        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE admins (
  AdminId              TEXT PRIMARY KEY,
  Name                 TEXT NOT NULL,
  Email                TEXT NOT NULL,
  Company              TEXT NOT NULL DEFAULT '',
  LineUserId           TEXT NOT NULL DEFAULT '',
  IsSuperAdmin         INTEGER NOT NULL DEFAULT 0,
  MyNumberCompaniesJson TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX idx_admins_email ON admins(Email);

CREATE TABLE notification_queue (
  Id           INTEGER PRIMARY KEY AUTOINCREMENT,
  Timestamp    TEXT NOT NULL,
  Direction    TEXT NOT NULL,
  ToEmployeeId TEXT NOT NULL DEFAULT '',
  ToAdminId    TEXT NOT NULL DEFAULT '',
  Message      TEXT NOT NULL,
  Status       TEXT NOT NULL,
  SentAt       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE templates (
  TemplateId TEXT PRIMARY KEY,
  Type       TEXT NOT NULL,
  Title      TEXT NOT NULL,
  Text       TEXT NOT NULL
);

CREATE TABLE settings (
  Key   TEXT PRIMARY KEY,
  Value TEXT NOT NULL DEFAULT ''
);
