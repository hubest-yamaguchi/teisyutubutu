-- 「運転免許証をお持ちですか？」の質問(通勤手段に関係なく全員に表示。回答が無いと運転免許証の
-- 書類は対象外のまま)。回答は'あり'/'なし'を想定(空文字は未回答)。
ALTER TABLE employees ADD COLUMN HasLicense TEXT NOT NULL DEFAULT '';

-- 資格証明書のように「対象ではあるが未提出のままでも進捗を止めたくない」書類のための任意フラグ。
-- trueの書類は、未提出(NONE)のままなら進捗率・完了判定(computeStage/progressPct)の対象から除外する
-- (提出済みになった場合は通常の書類と同じく承認が必要)。src/model.tsのrelevantDocTypes参照。
ALTER TABLE company_document_config ADD COLUMN Optional INTEGER NOT NULL DEFAULT 0;
