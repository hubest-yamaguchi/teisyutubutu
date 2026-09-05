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

// 都道府県名+市区町村名の完全一致で検索する(見つからない場合はnull。呼び出し側は未指定のまま登録を続行する)。
export async function findMunicipalityCode(db: D1Database, prefectureName: string, municipalityName: string): Promise<string | null> {
  if (!prefectureName || !municipalityName) return null;
  const row = await db
    .prepare('SELECT NationalLocalGovernmentCode FROM jinjer_municipalities WHERE PrefectureName = ? AND MunicipalityName = ?')
    .bind(prefectureName.trim(), municipalityName.trim())
    .first<{ NationalLocalGovernmentCode: string }>();
  return row?.NationalLocalGovernmentCode ?? null;
}
