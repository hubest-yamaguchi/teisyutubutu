-- ダッシュボードの内定者リストにLINEプロフィール画像を表示するため、本人確認時に取得したURLを保存する。
ALTER TABLE employees ADD COLUMN PictureUrl TEXT NOT NULL DEFAULT '';
