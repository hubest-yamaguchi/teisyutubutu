-- LINEメッセージの「対応済み」記録。返信しないで済むメッセージ(お礼だけ等)でも、管理者が「対応済み」を
-- 押せば未返信バッジを消せるようにするため、社員ごとに「どのメッセージIDまで対応済みにしたか」を持つ。
-- 未返信件数は「最後の返信」と「最後の対応済み」のうち新しい方より後に届いた受信メッセージで数える。
CREATE TABLE line_message_handled (
  EmployeeId    TEXT PRIMARY KEY,
  HandledUpToId INTEGER NOT NULL DEFAULT 0,
  HandledBy     TEXT NOT NULL DEFAULT '',
  HandledAt     TEXT NOT NULL DEFAULT ''
);
