/**
 * 本番移行(フェーズ6)用の一回限りのデータ移行スクリプト。
 * gas-app/gas-app-liffが使っているGoogleスプレッドシート・Google Driveから、
 * Cloudflare D1・R2へデータを一括コピーする。
 *
 * 【実行前提】
 * - 移行中はHRにgas-app(管理画面)の操作を止めてもらうこと(移行後にGAS側で加えた変更は
 *   Cloudflare側に反映されない。詳しくはteisyutubutuのCHANGELOG/会話ログ参照)。
 * - 既定では --dry-run 相当(実際の書き込みをしない)。本当に書き込むには --apply を渡す。
 * - マイナンバー確認書類を含む個人情報を扱うため、実行者・実行環境の取り扱いに注意すること。
 *
 * 【必要な環境変数】
 *   GOOGLE_SERVICE_ACCOUNT_KEY_PATH  サービスアカウントの鍵(JSON)のパス
 *                                    (対象スプレッドシート・Driveフォルダに閲覧権限を付与しておくこと)
 *   SPREADSHEET_ID                   移行元スプレッドシートのID
 *   DRIVE_ROOT_FOLDER_ID             移行元Driveルートフォルダ(新入社員別フォルダの親)のID
 *   CF_ACCOUNT_ID                    CloudflareアカウントID
 *   CF_API_TOKEN                     D1:Edit 権限を持つAPIトークン
 *   CF_D1_DATABASE_ID                移行先D1データベースのID(wrangler.tomlのdatabase_idと同じもの)
 *   CF_R2_BUCKET                     移行先R2バケット名
 *   CF_R2_ACCOUNT_ID                 R2用アカウントID(通常CF_ACCOUNT_IDと同じ)
 *   CF_R2_ACCESS_KEY_ID              R2 APIトークン(S3互換)のAccess Key ID
 *   CF_R2_SECRET_ACCESS_KEY          R2 APIトークン(S3互換)のSecret Access Key
 *
 * 【実行方法】
 *   npx tsx scripts/migrate-from-sheets.ts            (dry-run: 件数・サンプルの確認のみ)
 *   npx tsx scripts/migrate-from-sheets.ts --apply     (実際にD1・R2へ書き込む)
 *   npx tsx scripts/migrate-from-sheets.ts --apply --skip-files  (Driveファイルの移行はスキップ)
 */

import { google } from 'googleapis';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const SKIP_FILES = process.argv.includes('--skip-files');

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が設定されていません`);
  return v;
}

// ---------- Google Sheets/Drive読み込み ----------

const SHEETS_SCHEMA = {
  Employees: { name: '新入社員', cols: [['EmployeeId', '社員ID'], ['Name', '氏名'], ['Kana', 'フリガナ'], ['Company', '配属先企業'], ['Commute', '通勤手段'], ['HireDate', '入社予定日'], ['JobType', '職種'], ['LineUserId', 'LINEユーザーID']] },
  JobTypeCompanyMap: { name: '職種法人マスタ', cols: [['JobType', '職種'], ['Company', '法人']] },
  Submissions: { name: '提出状況', cols: [['EmployeeId', '社員ID'], ['DocKey', '書類キー'], ['Status', 'ステータス'], ['SubmittedAt', '提出日'], ['RejectReason', '差し戻し理由'], ['RejectedAt', '差し戻し日'], ['ReceivedOriginal', '原本受領'], ['UpdatedAt', '更新日時']] },
  SubmissionHistory: { name: '操作履歴', cols: [['Timestamp', '日時'], ['EmployeeId', '社員ID'], ['DocKey', '書類キー'], ['Action', '操作'], ['Detail', '内容'], ['ActorEmail', '操作者']] },
  CompanyDocumentConfig: { name: '書類マスタ', cols: [['DocKey', '書類キー'], ['Label', '書類名'], ['RequiresOriginal', '原本が必要'], ['PdfAllowed', 'PDF提出可'], ['ConditionType', '条件の種類'], ['ConditionValue', '条件の値'], ['Sensitive', '機微情報'], ['Description', '説明']] },
  Admins: { name: '管理者', cols: [['AdminId', '管理者ID'], ['Name', '氏名'], ['Email', 'メールアドレス'], ['Company', '担当法人'], ['LineUserId', 'LINEユーザーID']] },
  NotificationQueue: { name: '通知ログ', cols: [['Timestamp', '日時'], ['Direction', '宛先種別'], ['ToEmployeeId', '宛先社員ID'], ['ToAdminId', '宛先管理者ID'], ['Message', 'メッセージ'], ['Status', '状態'], ['SentAt', '送信日時']] },
  Templates: { name: 'テンプレート', cols: [['TemplateId', 'テンプレートID'], ['Type', '種類'], ['Title', 'タイトル'], ['Text', '本文']] }
} as const;

function toBool(v: unknown): boolean {
  if (v === true) return true;
  if (v === false || v == null || v === '') return false;
  return ['TRUE', 'true', 'はい', '要', '可', '○', '〇', '1', 'あり'].includes(String(v).trim());
}

async function readSheetAsObjects(sheets: any, spreadsheetId: string, logical: keyof typeof SHEETS_SCHEMA): Promise<Record<string, any>[]> {
  const schema = SHEETS_SCHEMA[logical];
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: schema.name });
  const values: any[][] = res.data.values || [];
  if (values.length < 2) return [];
  const headers = values[0];
  const keyByLabel: Record<string, string> = {};
  schema.cols.forEach(([key, label]) => { keyByLabel[label] = key; keyByLabel[key] = key; });
  const keys = headers.map((h) => keyByLabel[h] || null);

  const out: Record<string, any>[] = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row.every((c) => c === '' || c == null)) continue;
    const obj: Record<string, any> = {};
    keys.forEach((k, i) => { if (k) obj[k] = row[i]; });
    out.push(obj);
  }
  return out;
}

// ---------- Cloudflare D1 (HTTP API) ----------

async function d1Query(sql: string, params: unknown[] = []): Promise<void> {
  if (!APPLY) return;
  const accountId = requireEnv('CF_ACCOUNT_ID');
  const dbId = requireEnv('CF_D1_DATABASE_ID');
  const token = requireEnv('CF_API_TOKEN');
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params })
  });
  const body: any = await res.json();
  if (!res.ok || !body.success) throw new Error(`D1書き込み失敗: ${JSON.stringify(body.errors || body)}`);
}

async function insertRows(table: string, columns: string[], rows: Record<string, unknown>[]): Promise<void> {
  console.log(`  -> ${table}: ${rows.length}件`);
  if (!rows.length) return;
  const placeholders = `(${columns.map(() => '?').join(',')})`;
  for (const row of rows) {
    const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders} ON CONFLICT DO NOTHING`;
    await d1Query(sql, columns.map((c) => row[c] ?? ''));
  }
}

// ---------- Cloudflare R2(S3互換API) ----------

function makeR2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${requireEnv('CF_R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv('CF_R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('CF_R2_SECRET_ACCESS_KEY')
    }
  });
}

// ---------- メイン処理 ----------

async function main() {
  console.log(`移行スクリプト開始 (mode=${APPLY ? '本番書き込み' : 'dry-run(件数確認のみ)'})`);

  const keyPath = requireEnv('GOOGLE_SERVICE_ACCOUNT_KEY_PATH');
  const spreadsheetId = requireEnv('SPREADSHEET_ID');
  const credentials = JSON.parse(readFileSync(keyPath, 'utf-8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.readonly']
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });

  console.log('スプレッドシートを読み込み中...');
  const employees = await readSheetAsObjects(sheets, spreadsheetId, 'Employees');
  const jobTypeMap = await readSheetAsObjects(sheets, spreadsheetId, 'JobTypeCompanyMap');
  const submissions = await readSheetAsObjects(sheets, spreadsheetId, 'Submissions');
  const history = await readSheetAsObjects(sheets, spreadsheetId, 'SubmissionHistory');
  const docConfig = await readSheetAsObjects(sheets, spreadsheetId, 'CompanyDocumentConfig');
  const admins = await readSheetAsObjects(sheets, spreadsheetId, 'Admins');
  const notifications = await readSheetAsObjects(sheets, spreadsheetId, 'NotificationQueue');
  const templates = await readSheetAsObjects(sheets, spreadsheetId, 'Templates');

  console.log(`件数: employees=${employees.length} jobTypeMap=${jobTypeMap.length} submissions=${submissions.length} ` +
    `history=${history.length} docConfig=${docConfig.length} admins=${admins.length} notifications=${notifications.length} templates=${templates.length}`);

  console.log('D1へ書き込み中...');
  await insertRows('employees', ['EmployeeId', 'Name', 'Kana', 'Company', 'Commute', 'HireDate', 'JobType', 'LineUserId'], employees);
  await insertRows('job_type_company_map', ['JobType', 'Company'], jobTypeMap);
  await insertRows(
    'submissions',
    ['EmployeeId', 'DocKey', 'Status', 'SubmittedAt', 'RejectReason', 'RejectedAt', 'ReceivedOriginal', 'UpdatedAt'],
    submissions.map((s) => ({ ...s, ReceivedOriginal: toBool(s.ReceivedOriginal) ? 1 : 0 }))
  );
  await insertRows('submission_history', ['Timestamp', 'EmployeeId', 'DocKey', 'Action', 'Detail', 'ActorEmail'], history);
  await insertRows(
    'company_document_config',
    ['DocKey', 'Label', 'RequiresOriginal', 'PdfAllowed', 'ConditionType', 'ConditionValue', 'Sensitive', 'Description', 'SortOrder'],
    docConfig.map((d, i) => ({
      ...d,
      RequiresOriginal: toBool(d.RequiresOriginal) ? 1 : 0,
      PdfAllowed: toBool(d.PdfAllowed) ? 1 : 0,
      Sensitive: toBool(d.Sensitive) ? 1 : 0,
      SortOrder: i
    }))
  );
  // 注意: 旧GASのAdmins(管理者)シートには「代表管理者かどうか」「マイナンバー閲覧可否」の情報が無い
  // (それらはPropertiesServiceの別設定(HR_ADMIN_GROUP_EMAIL等)で管理されていたため、Sheets APIからは読めない)。
  // 移行後、新しい管理画面の「管理者一覧」で誰を代表管理者/マイナンバー閲覧可にするか、手動で再設定すること。
  await insertRows(
    'admins',
    ['AdminId', 'Name', 'Email', 'Company', 'LineUserId', 'IsSuperAdmin', 'MyNumberCompaniesJson'],
    admins.map((a) => ({ ...a, IsSuperAdmin: 0, MyNumberCompaniesJson: '[]' }))
  );
  await insertRows('notification_queue', ['Timestamp', 'Direction', 'ToEmployeeId', 'ToAdminId', 'Message', 'Status', 'SentAt'], notifications);
  await insertRows('templates', ['TemplateId', 'Type', 'Title', 'Text'], templates);

  if (SKIP_FILES) {
    console.log('--skip-files が指定されたため、Driveファイルの移行はスキップします');
  } else {
    console.log('Driveの書類ファイルを移行中...');
    await migrateFiles(drive, employees, submissions, docConfig);
  }

  console.log(APPLY ? '移行完了。' : 'dry-run完了。実際に書き込むには --apply を付けて再実行してください。');
}

async function migrateFiles(drive: any, employees: Record<string, any>[], submissions: Record<string, any>[], docConfigRows: Record<string, any>[]) {
  const rootFolderId = requireEnv('DRIVE_ROOT_FOLDER_ID');
  const bucket = requireEnv('CF_R2_BUCKET');
  const r2 = APPLY ? makeR2Client() : null;

  // 書類の並び順(旧submitDocument_の seq = docTypes配列内のindex+1 と同じ考え方)
  const docKeys = docConfigRows.length ? docConfigRows.map((d) => String(d.DocKey)) : [];
  const labelByKey: Record<string, string> = {};
  docConfigRows.forEach((d) => { labelByKey[String(d.DocKey)] = String(d.Label); });

  const submittedByEmployee: Record<string, Record<string, any>> = {};
  submissions.forEach((s) => {
    const id = String(s.EmployeeId);
    if (!submittedByEmployee[id]) submittedByEmployee[id] = {};
    submittedByEmployee[id][String(s.DocKey)] = s;
  });

  let migrated = 0;
  let missing = 0;

  for (const employee of employees) {
    const employeeId = String(employee.EmployeeId);
    const subs = submittedByEmployee[employeeId] || {};
    const submittedKeys = Object.keys(subs).filter((k) => subs[k].Status && subs[k].Status !== '未提出');
    if (!submittedKeys.length) continue;

    const folderName = `${employee.Name}_${employeeId}`;
    const folderRes = await drive.files.list({
      q: `'${rootFolderId}' in parents and name = '${folderName.replace(/'/g, "\\'")}' and trashed = false`,
      fields: 'files(id, name)'
    });
    const folder = folderRes.data.files?.[0];
    if (!folder) { console.log(`  [警告] フォルダが見つかりません: ${folderName}`); missing += submittedKeys.length; continue; }

    const filesRes = await drive.files.list({ q: `'${folder.id}' in parents and trashed = false`, fields: 'files(id, name)' });
    const driveFiles: { id: string; name: string }[] = filesRes.data.files || [];

    for (const docKey of submittedKeys) {
      const seq = docKeys.indexOf(docKey) + 1 || submittedKeys.indexOf(docKey) + 1;
      const label = labelByKey[docKey] || docKey;
      const prefix = `${employee.Name}_${seq}_${label}`;
      const match = driveFiles.find((f) => f.name.startsWith(prefix));
      if (!match) { console.log(`  [警告] ファイルが見つかりません: ${folderName}/${prefix}.*`); missing++; continue; }

      const ext = match.name.includes('.') ? match.name.split('.').pop() : '';
      const r2Key = `${employeeId}/${seq}_${label.replace(/[\\/]/g, '_')}${ext ? '.' + ext : ''}`;

      if (APPLY && r2) {
        const content = await drive.files.get({ fileId: match.id, alt: 'media' }, { responseType: 'arraybuffer' });
        await r2!.send(new PutObjectCommand({ Bucket: bucket, Key: r2Key, Body: Buffer.from(content.data as ArrayBuffer) }));
      }
      migrated++;
    }
  }
  console.log(`  -> ファイル移行: ${migrated}件成功 / ${missing}件見つからず`);
}

main().catch((err) => {
  console.error('移行中にエラーが発生しました:', err);
  process.exit(1);
});
