// ジンジャー(jinjer)人事労務APIとの連携。
//
// 【重要】このファイルには、まだ確定していない仕様が含まれる。開発者ガイド(https://doc.api.jinjer.biz/index.html)
// で確認できたのは以下のみで、それ以外(従業員マスタ登録/更新のエンドポイントとフィールド名)は未確認。
// 「要確認」と書いた箇所は、確認でき次第調整すること。
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
//     zip_codeは`^\d{3}-\d{4}$`(ハイフン区切り)の形式である必要があることをバリデーションエラーで確認した。
//     内定者側の入力はハイフン無しでも許容しているため、normalizePhoneNumber()/normalizeZipCode()で
//     10桁/11桁/7桁の数字列にハイフンを自動で補ってから送信する(元々ハイフン付きの値もそのまま通る)
//   ※続柄(relationship)は{ id: "4" }のようにIDで指定する。GET /v1/master/relationships で全33件の
//     固定マスタ(本人・妻・夫・母・父…)が取れることを確認したので、RELATIONSHIP_ID_BY_NAMEにハードコードする
//   ※都道府県/市区町村は`national_local_government_code`という全国地方公共団体コードで指定する。
//     GET /v1/master/municipalities で全国1918件(2026-09時点)を100件区切りのページングで取得できることを
//     確認した。件数が多いため都度APIを叩くのではなく、jinjer_municipalitiesテーブルに事前キャッシュしておき
//     (管理画面の「市区町村マスタを同期」ボタン)、都道府県名+市区町村名の完全一致で引き当てる方式にする
//     (一致しない場合は未指定のまま登録する。フリー入力の住所と完全一致しない可能性があるため)
//   ※どちらのマスタ参照エンドポイントも、書き込み用とは別に読み取り権限をAPIキーに追加しないと
//     403(Request to this endpoint or method is not allowed)になることを確認した
// - ファイル添付は `PATCH /v1/async/files`(POSTではなくPATCH。パスも/v1/employees/filesではない)。ボディ:
//     { employee_id, type: { id: "8" }, customize_menu: { id, customize_item: { id } }, record_code?,
//       file: { name, encoded_string(base64) } }
//   ※customize_itemはcustomize_menuの中にネストする(トップレベルに置くと400エラー"customize_item is not
//     allowed"になることを実際のエラーで確認した)
//   type.idは文字列("8"=カスタム項目・詳細項目・ファイル形式。他に5:資格証明書/6:研修添付/7:労働契約書等がある)。
//   カスタム項目の場合、customize_menu.id(カスタムメニューのID)とcustomize_item.id(メニュー内の項目のID)の
//   **両方**が必要(1つのコードではなく2段階のID)。この2つのIDは`GET /v1/master/custom-menus`(要:別途読み取り
//   権限)で調べられる(各メニューのdata[].idと、その中のcustomize_item[].id)。record_codeは対象のカスタム項目が
//   「項目追加(横)」形式の場合のみ必須(「項目羅列」形式なら逆に指定不可)。jinjer側の社員ごとの一覧画面で
//   「No」として表示されている番号がrecord_codeに相当する。
//   file.encoded_stringはBase64。**file.nameの拡張子はPNG/JPG/JPEG/PDFのみ**(それ以外は400エラー)。
//   **重要**: このエンドポイントは非同期。200が返っても「受付」の意味でしかなく、実際に登録できたかは
//   登録先の各情報のエンドポイント側で別途確認する必要がある(ジンジャー側の説明では、15分経っても反映が
//   確認できない場合は失敗とみなし再送信する、とされている)。呼び出し側もこの前提でエラーメッセージを表示すること
//   実際に本番で確認: 社員番号50002・「資料」メニュー(id=3)・「健康診断書」項目(id=6)・record_code="1"で
//   テストファイルを送信し、約1分後にjinjer側の画面で実際にファイルが反映されていることを確認できた
// - 「項目追加(横)」形式のメニューは、社員にレコード(行)が1件も無い状態だとファイル添付が
//   「No resources are registered for this employee. Please register the resource first.」(400)で
//   失敗することを確認した。レコードの存在確認・新規作成は以下のAPIで行う(要:別途読み取り/書き込み権限):
//   - GET /v1/employees/addible-custom-items?customize-menu-id=&employee-ids= … 既存レコード一覧の取得。
//     `data[0].customize_menu.customize_data[0].id`がrecord_code相当(実際に確認済み)
//   - POST /v1/employees/addible-custom-items … 新規レコードの作成。ボディ:
//     { employee_id, customize_menu: { id, customize_item: [{ id, value }, ...] } }
//     (customize_itemは配列。作成時は最低1項目の値が必要で、ファイル形式の項目には値を設定できないため、
//     日付項目(id="1"という前提。実際に確認できた唯一の例に基づく暫定ルール)に本日の日付を入れて作成する)
//     レスポンスは`{employee_id, customize_menu:{id}}`のみで、作成されたレコード自体のidは返らないため、
//     作成後に上記GETで改めて取得する必要がある(ensureAddibleCustomItemRecordCode()で実装)
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
  customMenuId: string; // jinjer側で事前に作成した「カスタムメニュー」のID
  customItemId: string; // 上記メニュー内の「カスタム項目」のID
  recordCode?: string; // カスタム項目が「項目追加(横)」形式の場合のみ必須。「項目羅列」形式なら指定しない
  fileName: string;
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

// jinjer側のバリデーション(^0\d{1,4}-\d{1,4}-\d{3,5}$、ハイフン抜きで11桁以内)に合わせて、
// 内定者がハイフン無しで入力した場合でも通るようにハイフンを補う。携帯番号(11桁)は3-4-4、
// 一般的な10桁は2-4-4で区切る(実際の市外局番の正しい桁数とは限らないが、jinjer側は正規表現での
// 形式チェックのみなので、この分割で問題なく通ることを確認済み)。既にハイフンが入っている場合や
// 10/11桁以外の場合はそのまま渡す(要フォーマット確認をログではなく呼び出し結果のエラーに委ねる)。
function normalizePhoneNumber(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  return raw;
}

// jinjer側のバリデーション(^\d{3}-\d{4}$)に合わせて、ハイフン無し7桁の入力にハイフンを補う。
function normalizeZipCode(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return raw;
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
    phone_number: normalizePhoneNumber(contact.phoneNumber),
    zip_code: normalizeZipCode(contact.postalCode),
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

// 「項目追加(横)」形式のメニュー(例: 資料)は、社員にレコード(行)が1件も無いとファイル添付が
// 「No resources are registered for this employee. Please register the resource first.」で失敗することを
// 実際に確認した。既存レコードのrecord_codeを取得し、無ければ「日付」項目(id=1という前提。実際に確認できた
// 唯一の例に基づく暫定ルールで、他のメニューで異なる場合は要調整)に本日の日付を入れて新規作成する。
// 同じメニューを共有する複数の書類は、この関数を1回だけ呼んで結果を使い回すこと(呼び出しごとに
// 新しい行を作ってしまわないため)。
export async function ensureAddibleCustomItemRecordCode(
  baseUrl: string,
  accessToken: string,
  employeeId: string,
  menuId: string
): Promise<string> {
  const existing = await getAddibleCustomItemRecordCode(baseUrl, accessToken, employeeId, menuId);
  if (existing) return existing;

  const today = new Date().toISOString().slice(0, 10);
  await jinjerFetch(`${baseUrl}/v1/employees/addible-custom-items`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      employee_id: employeeId,
      customize_menu: { id: menuId, customize_item: [{ id: '1', value: today }] }
    })
  });

  const created = await getAddibleCustomItemRecordCode(baseUrl, accessToken, employeeId, menuId);
  if (!created) throw new Error('jinjerに新しいレコードを作成しましたが、record_codeの取得に失敗しました');
  return created;
}

async function getAddibleCustomItemRecordCode(
  baseUrl: string,
  accessToken: string,
  employeeId: string,
  menuId: string
): Promise<string | null> {
  type RawRow = { customize_menu: { customize_data?: { id: string }[] } };
  const data = await jinjerFetch<RawRow[]>(
    `${baseUrl}/v1/employees/addible-custom-items?customize-menu-id=${menuId}&employee-ids=${employeeId}`,
    { method: 'GET', headers: authHeaders(accessToken) }
  );
  return data[0]?.customize_menu?.customize_data?.[0]?.id ?? null;
}

// (B) ファイル添付(PATCH /v1/async/files)。非同期処理のため、200が返っても「受付」の意味でしかない
// (ファイル先頭のコメント参照)。呼び出し側にもその旨を伝えること。
export async function attachFile(baseUrl: string, accessToken: string, params: JinjerFileAttachment): Promise<void> {
  const body: Record<string, unknown> = {
    employee_id: params.employeeId,
    type: { id: '8' }, // カスタム項目(詳細項目・ファイル形式)。本システムの書類は標準カテゴリ(5/6/7)と対応しないため常に8を使う
    // customize_itemはcustomize_menuの中にネストする(トップレベルに置くと400エラーになることを確認済み)
    customize_menu: { id: params.customMenuId, customize_item: { id: params.customItemId } },
    file: {
      name: params.fileName,
      encoded_string: arrayBufferToBase64(params.bytes)
    }
  };
  if (params.recordCode) body.record_code = params.recordCode;

  await jinjerFetch(`${baseUrl}/v1/async/files`, {
    method: 'PATCH',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}
