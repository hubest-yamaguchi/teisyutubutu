// ジンジャー(jinjer)人事労務APIとの連携。
//
// 【重要】このファイルには、まだ確定していない仕様が含まれる。確定しているのはユーザーが実際に確認した
// 「ファイル添付」APIのリクエストボディの形(employee_id/type/customize_menu/record_code/file)のみで、
// それ以外(認証方式・ベースURL・従業員マスタ登録/更新のエンドポイントとフィールド名・fileオブジェクトの
// 実際の中身)は未確認。ジンジャーAPI利用契約発行後、開発者ガイド(https://doc.api.jinjer.biz/index.html)
// を見ながら「要確認」と書いた箇所を実仕様に合わせて調整すること。
//
// [drive.ts]と同じ方針で、Workers環境向けにfetchで直接REST APIを叩く(SDKは使わない)。

export type JinjerEmployeeMaster = {
  code: string; // 社員番号。jinjer側のフィールド名は要確認(employee_idかemployee_codeか等)
  name: string;
  kana: string;
  company: string;
  hireDate: string;
  jobType: string;
};

export type JinjerFileAttachment = {
  employeeId: string; // 社員番号
  customItemCode: string; // jinjer側で事前に作成した「カスタム項目(詳細項目・ファイル形式)」のコード
  recordCode?: string; // カスタム項目が「項目追加(横)」形式の場合のみ必須(要確認)
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
};

// 要確認: Bearerトークンなのか、専用ヘッダー(例: X-Api-Key)なのか。ひとまずBearerで組んでおく。
function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
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
  apiKey: string,
  payload: JinjerEmployeeMaster
): Promise<{ jinjerEmployeeId: string }> {
  const res = await fetch(`${baseUrl}/v1/employees`, {
    method: 'POST',
    headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`jinjerへの従業員登録に失敗しました: ${await res.text()}`);
  const data = await res.json<{ id: string }>();
  return { jinjerEmployeeId: data.id };
}

// (B) ファイル添付。employee_id/type/customize_menu/record_code はユーザーが確認した仕様に沿っているが、
// customize_menuの中身のキー名・fileオブジェクトの形式(base64かmultipartか)は要確認。
export async function attachFile(baseUrl: string, apiKey: string, params: JinjerFileAttachment): Promise<void> {
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

  const res = await fetch(`${baseUrl}/v1/employees/files`, {
    method: 'POST',
    headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`jinjerへのファイル添付に失敗しました: ${await res.text()}`);
}
