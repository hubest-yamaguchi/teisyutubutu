// ジンジャー(jinjer)人事労務APIとの連携。
//
// 【重要】このファイルには、まだ確定していない仕様が含まれる。開発者ガイド(https://doc.api.jinjer.biz/index.html)
// で確認できたのは以下のみで、それ以外(従業員マスタ登録/更新のエンドポイントとフィールド名、
// ファイル添付のfileオブジェクトの実際の中身)は未確認。「要確認」と書いた箇所は、確認でき次第調整すること。
//
// 確認済み(本番環境に対して実際にAPIを叩いて動作確認済み。2026-09-05):
// - ベースURLは`https://api.jinjer.biz`固定(パス構成: https://api.jinjer.biz/{バージョン}/{リソース})
// - 認証は2段階。まず`GET /v2/token`にヘッダー`X-API-KEY`・`X-SECRET-KEY`(管理画面の「設定」で発行される
//   APIキー/シークレットキー)を付けて呼ぶと、短命(確認時点で約4時間)なアクセストークン(JWT)が
//   `{ results: "success", data: { access_token: "..." } }`の形で返る。以降の全APIはこの
//   アクセストークンを`Authorization: Bearer <access_token>`ヘッダーで送る(getAccessToken()/authHeaders())
//   ※APIキーには権限(用途スコープ)があり、このAPI連携専用に発行されたキーを使うこと
//   (勤怠チェック用など他用途のキーでは、読み取りはできても登録が権限エラーで拒否されることを確認済み)
// - レスポンスは共通で`{ results: "success", data: ... }`または`{ results: "failure", errors: [{code,reason,message}] }`
//   の形の封筒に包まれている(jinjerFetch()でここを吸収し、失敗時はerrorsのmessageをそのままthrowする)
// - GET /v1/employees/emergency-contacts?employee-ids=... … 緊急連絡先の取得。
//   レスポンスは `data: [{ employee_id, emergency_contacts: [{id, ...}] }]` の形(社員ごとの配列の中に、
//   その人の緊急連絡先の配列が入る。1人に複数件登録されていることがある)
// - POST /v1/employees/emergency-contacts … 緊急連絡先の登録。ボディ: { employee_id, emergency_contacts: {...} }
//   (このボディ側のemergency_contactsは単一object)。実際に送ると、送るたびに新しいid(1件目→id:"1"等)が
//   割り振られて追加登録される動作を確認した。**更新・上書きの手段は未確認**なので、同じ人に対して
//   何度も呼ぶと重複登録される可能性が高い(呼び出し側で「初回登録のみ」等のガードを検討すること)
//   フィールド対応: LastName→last_name, FirstName→first_name, LastNameKana→last_name_phonetic,
//   FirstNameKana→first_name_phonetic, PhoneNumber→phone_number, PostalCode→zip_code,
//   AddressKana→address_phonetic, AddressLine→street, Building→building, Email→email
//   ※phone_numberは`^0\d{1,4}-\d{1,4}-\d{3,5}$`(ハイフン区切り。ハイフン抜きの桁数は11桁以内)、
//     zip_codeは`^\d{3}-\d{4}$`(ハイフン区切り)の形式である必要があることをバリデーションエラーで確認した
//     (ハイフンを除去して送ると400エラーになる。うちのDB上の値がハイフン付き前提であることが必須条件になる)
//   ※続柄(relationship)は{ id: "4" }のようにIDで指定する。GET /v1/master/relationships で全33件の
//     固定マスタ(本人・妻・夫・母・父…)が取れることを確認したので、RELATIONSHIP_ID_BY_NAMEにハードコードする
//   ※都道府県/市区町村は`national_local_government_code`という全国地方公共団体コードで指定する。
//     GET /v1/master/municipalities で全国1918件(2026-09時点)を100件区切りのページングで取得できることを
//     確認した。件数が多いため都度APIを叩くのではなく、jinjer_municipalitiesテーブルに事前キャッシュしておき
//     (管理画面の「市区町村マスタを同期」ボタン)、都道府県名+市区町村名の完全一致で引き当てる方式にする
//     (一致しない場合は未指定のまま登録する。フリー入力の住所と完全一致しない可能性があるため)
//   ※どちらのマスタ参照エンドポイントも、書き込み用とは別に読み取り権限をAPIキーに追加しないと
//     403(Request to this endpoint or method is not allowed)になることを確認した
//
// [drive.ts]と同じ方針で、Workers環境向けにfetchで直接REST APIを叩く(SDKは使わない)。

// 続柄マスタ(GET /v1/master/relationships、全33件・固定)。変更頻度が低いためハードコードする。
const RELATIONSHIP_ID_BY_NAME: Record<string, string> = {
  本人: '1', 妻: '2', 夫: '3', 母: '4', 父: '5', 長男: '6', 長女: '7', 次男: '8', 次女: '9',
  兄: '10', 姉: '11', 弟: '12', 妹: '13', 祖父: '14', 祖母: '15', 孫息子: '16', 孫娘: '17',
  叔父: '18', 叔母: '19', 甥: '20', 姪: '21', 伯父: '22', 伯母: '23', 曾祖父: '24', 曾祖母: '25',
  曾孫: '26', 知人: '27', 三男: '28', 三女: '29', 四男: '30', 四女: '31', 義父: '32', 義母: '33'
};

// 続柄の名称(例: "父")からjinjerのIDを引く。一致しなければundefined(その場合は未指定のまま登録する)。
export function resolveRelationshipId(name: string): string | undefined {
  return RELATIONSHIP_ID_BY_NAME[name.trim()];
}

export type JinjerEmployeeMaster = {
  code: string; // 社員番号。jinjer側のフィールド名は要確認(employee_idかemployee_codeか等)
  name: string;
  kana: string;
  company: string;
  hireDate: string;
  jobType: string;
};

export type JinjerEmergencyContact = {
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  phoneNumber: string; // 例: "090-1234-5678"。jinjer側はハイフン区切り必須(ハイフン無しだと400エラー)
  postalCode: string;
  addressKana: string;
  addressLine: string;
  building: string;
  email: string;
  relationshipId?: string; // resolveRelationshipId()で解決した値。未指定なら送らない
  nationalLocalGovernmentCode?: string; // jinjer_municipalitiesで引き当てた値。未指定なら送らない
};

export type JinjerMunicipalityRow = {
  nationalLocalGovernmentCode: string;
  prefectureName: string;
  municipalityName: string;
};

export type JinjerFileAttachment = {
  employeeId: string; // 社員番号
  customItemCode: string; // jinjer側で事前に作成した「カスタム項目(詳細項目・ファイル形式)」のコード
  recordCode?: string; // カスタム項目が「項目追加(横)」形式の場合のみ必須(要確認)
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
};

type JinjerEnvelope<T> = { results: 'success'; data: T } | { results: 'failure'; errors: { code: string; reason: string; message: string }[] };

// jinjer共通のレスポンス封筒({results, data|errors})を解いて、失敗時はerrorsのmessageをそのまま例外にする
async function jinjerFetch<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json<JinjerEnvelope<T>>().catch(() => null);
  if (json && json.results === 'success') return json.data;
  const message = json && json.results === 'failure' ? json.errors.map((e) => e.message).join(' / ') : `HTTPステータス ${res.status}`;
  throw new Error(`jinjer APIエラー: ${message}`);
}

// アクセストークンの取得(GET /v2/token)。APIキー/シークレットキーは管理画面の「設定」で発行されたもの。
// トークンは短命(約4時間)なため、都度取得する運用でよい(呼び出し頻度が低いため)。
export async function getAccessToken(baseUrl: string, apiKey: string, secretKey: string): Promise<string> {
  const data = await jinjerFetch<{ access_token: string }>(`${baseUrl}/v2/token`, {
    method: 'GET',
    headers: { 'X-API-KEY': apiKey, 'X-SECRET-KEY': secretKey }
  });
  return data.access_token;
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// (A) 従業員マスタの登録・更新。
// 要確認: エンドポイントパス、リクエストボディのフィールド名、レスポンスから従業員IDを取り出すキー名。
export async function upsertEmployeeMaster(
  baseUrl: string,
  accessToken: string,
  payload: JinjerEmployeeMaster
): Promise<{ jinjerEmployeeId: string }> {
  const data = await jinjerFetch<{ id: string }>(`${baseUrl}/v1/employees`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return { jinjerEmployeeId: data.id };
}

// 緊急連絡先の登録。1件ずつ呼び出す想定(ファイル先頭のコメント参照)。
export async function syncEmergencyContact(
  baseUrl: string,
  accessToken: string,
  employeeId: string,
  contact: JinjerEmergencyContact
): Promise<void> {
  const emergencyContacts: Record<string, unknown> = {
    last_name: contact.lastName,
    first_name: contact.firstName,
    last_name_phonetic: contact.lastNameKana,
    first_name_phonetic: contact.firstNameKana,
    phone_number: contact.phoneNumber,
    zip_code: contact.postalCode,
    address_phonetic: contact.addressKana,
    street: contact.addressLine,
    building: contact.building,
    email: contact.email
  };
  if (contact.relationshipId) emergencyContacts.relationship = { id: contact.relationshipId };
  if (contact.nationalLocalGovernmentCode) emergencyContacts.national_local_government_code = contact.nationalLocalGovernmentCode;

  const body = { employee_id: employeeId, emergency_contacts: emergencyContacts };
  await jinjerFetch(`${baseUrl}/v1/employees/emergency-contacts`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// 市区町村マスタの全件取得(100件区切りのページングをこちらで回収する)。管理者が「市区町村マスタを同期」を
// 押した時だけ呼ぶ想定(全国1918件・約20ページ分のリクエストが発生するため)。
export async function listMunicipalities(baseUrl: string, accessToken: string): Promise<JinjerMunicipalityRow[]> {
  type RawRow = { national_local_government_code: string; prefecture: { name: string }; municipality: { name: string } };
  const rows: JinjerMunicipalityRow[] = [];
  for (let page = 1; ; page++) {
    const data = await jinjerFetch<RawRow[]>(`${baseUrl}/v1/master/municipalities?page=${page}`, {
      method: 'GET',
      headers: authHeaders(accessToken)
    });
    if (!data.length) break;
    for (const r of data) {
      rows.push({
        nationalLocalGovernmentCode: r.national_local_government_code,
        prefectureName: r.prefecture.name,
        municipalityName: r.municipality.name
      });
    }
    if (data.length < 100) break; // 100件未満なら最終ページ
  }
  return rows;
}

// (B) ファイル添付。employee_id/type/customize_menu/record_code はユーザーが確認した仕様に沿っているが、
// customize_menuの中身のキー名・fileオブジェクトの形式(base64かmultipartか)は要確認。
export async function attachFile(baseUrl: string, accessToken: string, params: JinjerFileAttachment): Promise<void> {
  const body: Record<string, unknown> = {
    employee_id: params.employeeId,
    type: 8, // カスタム項目(詳細項目・ファイル形式)。本システムの書類は標準カテゴリ(5/6/7)と対応しないため常に8を使う
    customize_menu: { code: params.customItemCode } // 要確認: 実際のキー名
  };
  if (params.recordCode) body.record_code = params.recordCode;
  body.file = {
    // 要確認: filename/mime_type等のキー名、base64かmultipartか
    filename: params.fileName,
    mime_type: params.mimeType,
    content_base64: arrayBufferToBase64(params.bytes)
  };

  await jinjerFetch(`${baseUrl}/v1/employees/files`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}
