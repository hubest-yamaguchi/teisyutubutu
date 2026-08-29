-- 管理者が「Driveに保存」を実行した社員・日時を記録する(未実行ならDriveSavedAtは空のまま)。
ALTER TABLE employees ADD COLUMN DriveSavedAt TEXT NOT NULL DEFAULT '';
