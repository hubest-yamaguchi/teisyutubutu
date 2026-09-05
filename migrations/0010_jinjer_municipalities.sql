-- jinjerの市区町村マスタ(/v1/master/municipalities)のローカルキャッシュ。全国1918件(2026-09時点)と
-- そこそこの件数がある上、ページング必須のAPIのため、緊急連絡先登録のたびに毎回問い合わせるのではなく、
-- 管理画面の「市区町村マスタを同期」ボタンで事前に全件取得してこちらに保存しておく方式にする。
-- 続柄マスタ(全33件・固定リスト)は変更頻度が低いためsrc/jinjer.ts内にハードコードし、テーブル化はしない。

CREATE TABLE jinjer_municipalities (
  NationalLocalGovernmentCode TEXT PRIMARY KEY,
  PrefectureName              TEXT NOT NULL,
  MunicipalityName            TEXT NOT NULL
);
CREATE INDEX idx_jinjer_municipalities_names ON jinjer_municipalities(PrefectureName, MunicipalityName);
