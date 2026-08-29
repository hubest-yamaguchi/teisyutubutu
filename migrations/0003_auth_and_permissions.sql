-- Cloudflare AccessからID/パスワードログインへの移行、および代表管理者フラグ(単一ON/OFF)から
-- カテゴリ単位の権限チェックボックスへの移行。

ALTER TABLE admins ADD COLUMN PasswordHash TEXT NOT NULL DEFAULT '';
ALTER TABLE admins ADD COLUMN PermissionsJson TEXT NOT NULL DEFAULT '[]';

-- 既存データの移行: IsSuperAdmin=1だった行は全カテゴリ、0だった行は従来どおり誰でも使えていた
-- 3カテゴリ(新入社員登録/テンプレート/職種法人マスタ)を初期値として与える。
UPDATE admins SET PermissionsJson = '["emp","tpl","job","admin","line","notify","liny","doc","setup"]' WHERE IsSuperAdmin = 1;
UPDATE admins SET PermissionsJson = '["emp","tpl","job"]' WHERE IsSuperAdmin = 0;

CREATE TABLE admin_sessions (
  SessionHash TEXT PRIMARY KEY,
  Email       TEXT NOT NULL,
  CreatedAt   TEXT NOT NULL,
  ExpiresAt   TEXT NOT NULL
);
CREATE INDEX idx_admin_sessions_expires ON admin_sessions(ExpiresAt);
