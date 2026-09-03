-- 内定者⇔管理者間のLINEメッセージ履歴(公式アカウントで直接やり取りする代わりに、管理画面内で
-- 閲覧・返信できるようにするため)。Direction: 'in'=内定者から受信 / 'out'=管理者から送信。
-- LineMessageIdはLINE側のメッセージID。Webhookの再送(LINEはタイムアウト時に同じイベントを再送する)で
-- 二重登録しないよう、一意制約を付けて INSERT OR IGNORE で受ける。

CREATE TABLE line_messages (
  Id            INTEGER PRIMARY KEY AUTOINCREMENT,
  EmployeeId    TEXT NOT NULL,
  Direction     TEXT NOT NULL,               -- 'in' | 'out'
  MessageType   TEXT NOT NULL DEFAULT 'text', -- 'text' | 'image'
  Text          TEXT NOT NULL DEFAULT '',
  StorageKey    TEXT NOT NULL DEFAULT '',    -- 画像の場合、R2(DOCSバケット)上のキー
  MimeType      TEXT NOT NULL DEFAULT '',
  LineMessageId TEXT NOT NULL DEFAULT '',
  AdminEmail    TEXT NOT NULL DEFAULT '',    -- 送信した管理者(Direction='out'の場合のみ)
  CreatedAt     TEXT NOT NULL
);
CREATE INDEX idx_line_messages_employee ON line_messages(EmployeeId, Id);
CREATE UNIQUE INDEX idx_line_messages_line_message_id ON line_messages(LineMessageId) WHERE LineMessageId != '';
