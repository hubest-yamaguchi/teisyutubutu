// jinjerの市区町村マスタのローカルキャッシュ(migrations/0010_jinjer_municipalities.sql参照)。

export type JinjerMunicipality = {
  nationalLocalGovernmentCode: string;
  prefectureName: string;
  municipalityName: string;
};

// 全件洗い替え(D1のbatch一括実行には上限があるため100件ずつ分割する)
export async function replaceMunicipalities(db: D1Database, rows: JinjerMunicipality[]): Promise<void> {
  await db.prepare('DELETE FROM jinjer_municipalities').run();
  const stmt = db.prepare(
    'INSERT INTO jinjer_municipalities (NationalLocalGovernmentCode, PrefectureName, MunicipalityName) VALUES (?, ?, ?)'
  );
  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await db.batch(chunk.map((r) => stmt.bind(r.nationalLocalGovernmentCode, r.prefectureName, r.municipalityName)));
  }
}

export async function countMunicipalities(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM jinjer_municipalities').first<{ n: number }>();
  return row?.n ?? 0;
}

// 都道府県名+市区町村名で検索する。まずは完全一致を試し、無ければ「入力された市区町村名が、
// マスタの市区町村名で始まっているか」で再検索する(見つからない場合はnull。呼び出し側は未指定のまま登録を続行する)。
// 後者の再検索は、内定者が「市区町村」欄に大字・字(郷など)まで続けて入力してしまうケースを救うためのもの
// (例: マスタ側は「西彼杵郡時津町」だが、入力が「西彼杵郡時津町左底郷」になっている場合も一致させる)。
// 該当が複数ある場合は、市区町村名が最も長い(=より具体的な)ものを優先する。
export async function findMunicipalityCode(db: D1Database, prefectureName: string, municipalityName: string): Promise<string | null> {
  if (!prefectureName || !municipalityName) return null;
  const prefecture = prefectureName.trim();
  const municipality = municipalityName.trim();

  const exact = await db
    .prepare('SELECT NationalLocalGovernmentCode FROM jinjer_municipalities WHERE PrefectureName = ? AND MunicipalityName = ?')
    .bind(prefecture, municipality)
    .first<{ NationalLocalGovernmentCode: string }>();
  if (exact) return exact.NationalLocalGovernmentCode;

  const prefixMatch = await db
    .prepare(
      `SELECT NationalLocalGovernmentCode FROM jinjer_municipalities
       WHERE PrefectureName = ? AND ? LIKE MunicipalityName || '%'
       ORDER BY LENGTH(MunicipalityName) DESC LIMIT 1`
    )
    .bind(prefecture, municipality)
    .first<{ NationalLocalGovernmentCode: string }>();
  return prefixMatch?.NationalLocalGovernmentCode ?? null;
}
