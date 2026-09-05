// gas-app/Api.gs + gas-app/Settings.gs の移植。
// requireAdmin/requirePermissionは、セッションCookieで検証済みのメールアドレス(src/session.ts)を受け取り、
// admins テーブル(db/admins.ts)で認可判定する(GroupsApp判定は廃止)。

import type { Env } from '../bindings';
import { COMMUTES, COMPANIES, computeStage, progressPct, isApplicable, applicableDocTypes, STATUS, DocType } from '../model';
import {
  findEmployeeById,
  listEmployees,
  saveEmployee,
  saveEmployees,
  nextEmployeeId,
  nextEmployeeIds,
  bulkSetHireDate,
  deleteEmployee,
  markDriveSaved,
  markJinjerSynced,
  setJinjerEmployeeId,
  Employee
} from '../db/employees';
import { getSubmissionsMap, getAllSubmissions, upsertSubmission } from '../db/submissions';
import { listEmergencyContacts } from '../db/emergencyContacts';
import { appendHistory } from '../db/history';
import { loadDocTypes, seedCompanyDocumentConfigIfEmpty, upsertDocConfig, removeDocConfig } from '../db/docConfig';
import { getJobTypeCompanyMap, setJobTypeCompany, removeJobType } from '../db/jobTypeMap';
import {
  listAdmins,
  addAdmin as addAdminRow,
  removeAdmin as removeAdminRow,
  isHrAdmin,
  hasCategoryPermission,
  canViewMyNumber,
  updateAdmin as updateAdminRow
} from '../db/admins';
import {
  listTemplates,
  addTemplate as addTemplateRow,
  removeTemplate as removeTemplateRow,
  seedTemplatesIfEmpty,
  TemplateType
} from '../db/templates';
import { listRecentNotifications } from '../db/notifications';
import { getSetting, setSetting, setSettings, SETTINGS_KEYS } from '../db/settings';
import { notifyEmployee, sendChatReply } from '../line';
import { todayStr, nowStr } from '../util/date';
import { SettingsCategory, SETTINGS_CATEGORIES, sanitizePermissions } from '../permissions';
import { getEmployeeFile } from '../r2';
import { getDriveAccessToken, ensureFolder, uploadFileToDrive, syncFolderPermissions } from '../drive';
import { getAccessToken, attachFile, syncEmergencyContact, resolveRelationshipId, listMunicipalities } from '../jinjer';
import { replaceMunicipalities, findMunicipalityCode, countMunicipalities } from '../db/jinjerMunicipalities';
import { listMessages, insertOutboundMessage, findMessageById, LineMessageRow } from '../db/lineMessages';

class ApiError extends Error {}

async function requireAdmin(env: Env, email: string): Promise<string> {
  if (!(await isHrAdmin(env.DB, email))) throw new ApiError('アクセス権限がありません（管理者として登録されていません）');
  return email;
}

// カテゴリ単位の権限チェック(旧: requireSuperAdmin_)。管理者一覧のチェックボックスで管理者ごとに設定する。
async function requirePermission(env: Env, email: string, category: SettingsCategory): Promise<string> {
  await requireAdmin(env, email);
  if (!(await hasCategoryPermission(env.DB, email, category))) {
    throw new ApiError('この操作を行う権限がありません（管理者一覧の権限設定をご確認ください）');
  }
  return email;
}

async function getTabOrder(db: D1Database): Promise<SettingsCategory[]> {
  const raw = await getSetting(db, SETTINGS_KEYS.SETTINGS_TAB_ORDER);
  if (!raw) return [...SETTINGS_CATEGORIES];
  try {
    const parsed = sanitizePermissions(JSON.parse(raw));
    // 保存後に新しいカテゴリが追加された場合に備え、含まれていないものは末尾に補う
    const missing = SETTINGS_CATEGORIES.filter((c) => !parsed.includes(c));
    return [...parsed, ...missing];
  } catch {
    return [...SETTINGS_CATEGORIES];
  }
}

function publicEmployee(employee: Employee) {
  return {
    id: employee.EmployeeId,
    name: employee.Name,
    company: employee.Company,
    commute: employee.Commute,
    hireDate: employee.HireDate,
    pictureUrl: employee.PictureUrl || '',
    driveSavedAt: employee.DriveSavedAt || '',
    jinjerSyncedAt: employee.JinjerSyncedAt || '',
    jinjerEmployeeId: employee.JinjerEmployeeId || ''
  };
}

function subsToStatusMap(subs: Record<string, { Status: string }>) {
  const map: Record<string, { status: string }> = {};
  for (const k of Object.keys(subs)) map[k] = { status: subs[k].Status };
  return map;
}

// ---------- ダッシュボード ----------

export async function adminGetDashboard(env: Env, email: string, companyFilter?: string) {
  await requireAdmin(env, email);
  const docTypes = await loadDocTypes(env.DB);
  const employees = await listEmployees(env.DB);
  const allSubs = await getAllSubmissions(env.DB);

  const rows = employees
    .filter((e) => !companyFilter || companyFilter === 'すべて' || e.Company === companyFilter)
    .map((e) => {
      const subs = allSubs[String(e.EmployeeId)] || {};
      const statusMap = subsToStatusMap(subs as any);
      const applicable = applicableDocTypes(e, docTypes);
      const submittedCount = applicable.filter((d) => (statusMap[d.key]?.status || STATUS.NONE) !== STATUS.NONE).length;
      return {
        id: e.EmployeeId,
        name: e.Name,
        kana: e.Kana,
        company: e.Company,
        commute: e.Commute,
        hireDate: e.HireDate,
        pictureUrl: e.PictureUrl || '',
        stage: computeStage(e, statusMap, docTypes),
        progressPct: progressPct(e, statusMap, docTypes),
        docsSubmitted: submittedCount,
        docsTotal: applicable.length
      };
    });

  const kpi: Record<string, number> = {
    total: rows.length,
    avgProgress: rows.length ? Math.round(rows.reduce((s, r) => s + r.progressPct, 0) / rows.length) : 0
  };
  for (const stage of ['未提出', '確認中', '差し戻し', '原本待ち', '受入準備完了']) {
    kpi[stage] = rows.filter((r) => r.stage === stage).length;
  }

  const companies = Array.from(new Set(employees.map((e) => e.Company).filter(Boolean)));
  return { companies, rows, kpi };
}

export async function adminGetEmployeeDetail(env: Env, email: string, employeeId: string) {
  await requireAdmin(env, email);
  const employee = await findEmployeeById(env.DB, employeeId);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  const docTypes = await loadDocTypes(env.DB);
  const subs = await getSubmissionsMap(env.DB, employeeId);
  const canViewMyNumberFlag = await canViewMyNumber(env.DB, email, employee.Company);

  const docs = docTypes.map((d: DocType) => {
    const applicableFlag = isApplicable(d, employee);
    const s = subs[d.key] || ({} as any);
    const isMyNumber = d.key === 'myNumber';
    return {
      key: d.key,
      label: d.label,
      requiresOriginal: !!d.requiresOriginal,
      sensitive: !!d.sensitive,
      status: applicableFlag ? s.Status || STATUS.NONE : STATUS.NA,
      submittedAt: s.SubmittedAt || '',
      rejectReason: s.RejectReason || '',
      rejectedAt: s.RejectedAt || '',
      receivedOriginal: !!s.ReceivedOriginal,
      restrictedView: isMyNumber && !canViewMyNumberFlag,
      hasFile: !!s.StorageKey && !(isMyNumber && !canViewMyNumberFlag)
    };
  });

  const emergencyContacts = await listEmergencyContacts(env.DB, employeeId);

  return {
    employee: publicEmployee(employee),
    docs,
    emergencyContacts,
    stage: computeStage(employee, subsToStatusMap(subs as any), docTypes)
  };
}

export async function adminApproveDoc(env: Env, email: string, employeeId: string, docKey: string) {
  await requireAdmin(env, email);
  const docTypes = await loadDocTypes(env.DB);
  const meta = docTypes.find((d) => d.key === docKey);
  if (!meta) throw new ApiError(`不明な書類種別です: ${docKey}`);
  const newStatus = docKey === 'guarantor' ? STATUS.ORIGINAL_WAIT : STATUS.APPROVED;
  await upsertSubmission(env.DB, employeeId, docKey, { Status: newStatus, RejectReason: '' });
  await appendHistory(env.DB, employeeId, docKey, '承認', `${meta.label}を確認・承認`, email);
  return adminGetEmployeeDetail(env, email, employeeId);
}

// 複数の書類を選んでまとめて差し戻す。LINEの無料プランには月間送信数の上限があるため、
// 書類ごとに個別送信していたのを、1回の操作につき通知1通にまとめられるようにしたもの。
export async function adminRejectDocsBatch(env: Env, email: string, employeeId: string, items: { docKey: string; reason: string }[]) {
  await requireAdmin(env, email);
  const employee = await findEmployeeById(env.DB, employeeId);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  if (!items || !items.length) throw new ApiError('差し戻す書類を選択してください');

  const docTypes = await loadDocTypes(env.DB);
  const lines: string[] = [];
  for (const item of items) {
    const meta = docTypes.find((d) => d.key === item.docKey);
    if (!meta) throw new ApiError(`不明な書類種別です: ${item.docKey}`);
    const reason = String(item.reason || '').trim();
    if (!reason) throw new ApiError(`${meta.label}の差し戻し理由を入力してください`);
    await upsertSubmission(env.DB, employeeId, item.docKey, { Status: STATUS.REJECTED, RejectReason: reason, RejectedAt: todayStr() });
    await appendHistory(env.DB, employeeId, item.docKey, '差し戻し', reason, email);
    lines.push(`・${meta.label}\n${reason}`);
  }
  await notifyEmployee(env.DB, employee, `以下の書類について差し戻しがあります。\n\n${lines.join('\n\n')}`);
  return adminGetEmployeeDetail(env, email, employeeId);
}

export async function adminToggleOriginalReceived(env: Env, email: string, employeeId: string, received: boolean) {
  await requireAdmin(env, email);
  await upsertSubmission(env.DB, employeeId, 'guarantor', {
    ReceivedOriginal: received,
    Status: received ? STATUS.APPROVED : STATUS.ORIGINAL_WAIT
  });
  await appendHistory(env.DB, employeeId, 'guarantor', received ? '原本受領' : '原本受領取消', '', email);
  return adminGetEmployeeDetail(env, email, employeeId);
}

export async function adminSendReminder(env: Env, email: string, employeeId: string, message: string) {
  await requireAdmin(env, email);
  const employee = await findEmployeeById(env.DB, employeeId);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  const result = await notifyEmployee(env.DB, employee, message);
  await appendHistory(env.DB, employeeId, '', 'リマインダー送信', message, email);
  return result;
}

export async function adminDeleteMyNumber(env: Env, email: string, employeeId: string) {
  const employee = await findEmployeeById(env.DB, employeeId);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  if (!(await canViewMyNumber(env.DB, email, employee.Company))) {
    throw new ApiError('この操作にはマイナンバー閲覧権限が必要です');
  }
  await upsertSubmission(env.DB, employeeId, 'myNumber', { Status: '破棄済み' });
  await appendHistory(env.DB, employeeId, 'myNumber', '削除', 'マイナンバー確認書類を管理者操作により削除', email);
  return adminGetEmployeeDetail(env, email, employeeId);
}

// StorageKeyの拡張子部分(employeeFileKeyの命名規則 `{EmployeeId}/{連番}_{書類名}.{拡張子}` に準拠)
function extFromStorageKey(key: string): string {
  const m = key.match(/\.([^./]+)$/);
  return m ? `.${m[1]}` : '';
}

// 管理画面から提出ファイルを表示・ダウンロードするための認可付きファイル情報取得(実体の取得はindex.ts側でR2から行う)
export async function adminGetFileInfo(env: Env, email: string, employeeId: string, docKey: string) {
  await requireAdmin(env, email);
  const employee = await findEmployeeById(env.DB, employeeId);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  if (docKey === 'myNumber' && !(await canViewMyNumber(env.DB, email, employee.Company))) {
    throw new ApiError('この操作にはマイナンバー閲覧権限が必要です');
  }
  const docTypes = await loadDocTypes(env.DB);
  const meta = docTypes.find((d) => d.key === docKey);
  if (!meta) throw new ApiError(`不明な書類種別です: ${docKey}`);
  const subs = await getSubmissionsMap(env.DB, employeeId);
  const sub = subs[docKey];
  if (!sub || !sub.StorageKey) throw new ApiError('ファイルが見つかりません');
  return {
    key: sub.StorageKey,
    mimeType: sub.MimeType || 'application/octet-stream',
    fileName: `${employee.Name}_${meta.label}${extFromStorageKey(sub.StorageKey)}`
  };
}

// 社員の提出済み書類をまとめてZIPダウンロードするための対象ファイル一覧(実体の取得・zip化はindex.ts側で行う)。
// 表示中の詳細画面(adminGetEmployeeDetail)で hasFile === true な書類、つまりマイナンバー等の
// 閲覧権限が無ければ最初から一覧に出ない書類と同じ範囲に揃える。
export async function adminGetZipManifest(env: Env, email: string, employeeId: string) {
  await requireAdmin(env, email);
  const employee = await findEmployeeById(env.DB, employeeId);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  const docTypes = await loadDocTypes(env.DB);
  const canViewMyNumberFlag = await canViewMyNumber(env.DB, email, employee.Company);
  const subs = await getSubmissionsMap(env.DB, employeeId);

  const files = docTypes
    .filter((d) => isApplicable(d, employee))
    .filter((d) => d.key !== 'myNumber' || canViewMyNumberFlag)
    .map((d) => ({ d, sub: subs[d.key] }))
    .filter(({ sub }) => sub && sub.StorageKey)
    .map(({ d, sub }) => ({
      key: sub.StorageKey,
      fileName: `${d.label}${extFromStorageKey(sub.StorageKey)}`
    }));

  if (!files.length) throw new ApiError('ダウンロードできる書類がありません');
  return { zipName: `${employee.Name}_提出書類.zip`, files };
}

// ---------- LINEメッセージ(公式アカウントに届いたメッセージを管理画面内で閲覧・返信) ----------
// 受信自体はindex.tsのWebhookハンドラがline_messagesテーブルへ書き込む。ここでは読み取りと返信のみ扱う。

function publicMessage(m: LineMessageRow) {
  return {
    id: m.Id,
    direction: m.Direction,
    messageType: m.MessageType,
    text: m.Text,
    hasImage: m.MessageType === 'image' && !!m.StorageKey,
    adminEmail: m.AdminEmail,
    createdAt: m.CreatedAt
  };
}

// メッセージ中の画像実体(R2)を取得するための認可付き情報取得(実体の取得はindex.ts側でR2から行う)
export async function adminGetMessageImageInfo(env: Env, email: string, messageId: number) {
  await requireAdmin(env, email);
  const message = await findMessageById(env.DB, messageId);
  if (!message || message.MessageType !== 'image' || !message.StorageKey) throw new ApiError('画像が見つかりません');
  return { key: message.StorageKey, mimeType: message.MimeType || 'application/octet-stream' };
}

export async function adminGetMessages(env: Env, email: string, employeeId: string) {
  await requireAdmin(env, email);
  const employee = await findEmployeeById(env.DB, employeeId);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  const messages = await listMessages(env.DB, employeeId);
  return { linked: !!employee.LineUserId, messages: messages.map(publicMessage) };
}

export async function adminSendMessage(env: Env, email: string, employeeId: string, text: string) {
  await requireAdmin(env, email);
  const employee = await findEmployeeById(env.DB, employeeId);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new ApiError('メッセージを入力してください');
  if (!employee.LineUserId) throw new ApiError('この新入社員はまだLINEと連携していません');

  const result = await sendChatReply(env.DB, employee.LineUserId, trimmed);
  if (!result.sent) throw new ApiError(`LINEへの送信に失敗しました（${result.reason || '不明なエラー'}）`);
  await insertOutboundMessage(env.DB, employeeId, trimmed, email);
  return adminGetMessages(env, email, employeeId);
}

// 法人ごとのマイナンバー閲覧権限(admin.MyNumberCompanies)を、その法人フォルダのDrive閲覧権限として
// 反映する対象を決める。誰も割り当てられていない法人は、代表管理者相当('admin'権限を持つ管理者)にのみ見せる。
function resolveCompanyFolderTargetEmails(admins: Awaited<ReturnType<typeof listAdmins>>, company: string): string[] {
  const withMyNumber = admins.filter((a) => a.MyNumberCompanies.includes(company)).map((a) => a.Email);
  if (withMyNumber.length) return withMyNumber;
  return admins.filter((a) => a.Permissions.includes('admin')).map((a) => a.Email);
}

async function ensureCompanyFolder(accessToken: string, rootFolderId: string, admins: Awaited<ReturnType<typeof listAdmins>>, company: string) {
  const companyFolderId = await ensureFolder(accessToken, rootFolderId, company || '配属先未設定');
  await syncFolderPermissions(accessToken, companyFolderId, resolveCompanyFolderTargetEmails(admins, company));
  return companyFolderId;
}

// 承認済み書類を社員単位でまとめてGoogle Driveへ保存する(アップロード時の自動保存ではなく、管理者がこの操作を
// 選択した時だけ実行する)。保存先フォルダは「{法人名}/{入社年度}卒/{氏名}_{社員ID}/」の3階層にし、
// ファイル名にも氏名・書類名を含めることで、ファイル単体でも「誰の・いつの・どの書類か」がわかるようにする
// (社員フォルダ以下の命名規則は旧gas-app/Drive.gsを踏襲)。
// 法人フォルダの閲覧権限は、マイナンバー閲覧権限と同じ管理者だけに絞る(resolveCompanyFolderTargetEmails)。
// 【重要】この権限同期はフォルダ単位の明示的な共有のみを操作する。共有ドライブ自体の「メンバー」に
// 追加されている管理者は、この設定に関わらず全フォルダを閲覧できてしまうため、法人単位で本当に絞りたい
// 場合は、共有ドライブのメンバーからは外し、フォルダ単位の共有だけで運用すること。
export async function adminSaveToDrive(env: Env, email: string, employeeId: string) {
  await requireAdmin(env, email);
  const employee = await findEmployeeById(env.DB, employeeId);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');

  const rootFolderId = await getSetting(env.DB, SETTINGS_KEYS.DRIVE_ROOT_FOLDER_ID);
  if (!rootFolderId) throw new ApiError('Driveの保存先フォルダが未設定です（設定 > Google Drive連携設定で指定してください）');

  const docTypes = await loadDocTypes(env.DB);
  const subs = await getSubmissionsMap(env.DB, employeeId);
  const targets = applicableDocTypes(employee, docTypes).filter(
    (d) => subs[d.key]?.Status === STATUS.APPROVED && subs[d.key]?.StorageKey
  );
  if (!targets.length) throw new ApiError('Driveに保存できる承認済み書類がありません');

  const accessToken = await getDriveAccessToken(env);
  const admins = await listAdmins(env.DB);
  const companyFolderId = await ensureCompanyFolder(accessToken, rootFolderId, admins, employee.Company);
  const yearMatch = employee.HireDate.match(/^(\d{4})/);
  const yearFolderName = yearMatch ? `${yearMatch[1]}卒` : '入社年度未設定';
  const yearFolderId = await ensureFolder(accessToken, companyFolderId, yearFolderName);
  const folderName = `${employee.Name}_${employee.EmployeeId}`;
  const folderId = await ensureFolder(accessToken, yearFolderId, folderName);

  let savedCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const d = targets[i];
    const sub = subs[d.key];
    const obj = await getEmployeeFile(env.DOCS, sub.StorageKey);
    if (!obj) continue;
    const extMatch = sub.StorageKey.match(/\.([^./]+)$/);
    const ext = extMatch ? `.${extMatch[1]}` : '';
    const fileName = `${employee.Name}_${i + 1}_${d.label}${ext}`;
    await uploadFileToDrive(accessToken, folderId, fileName, sub.MimeType || 'application/octet-stream', await obj.arrayBuffer());
    savedCount++;
  }
  if (!savedCount) throw new ApiError('保存対象のファイル実体が見つかりませんでした');

  const timestamp = nowStr();
  await markDriveSaved(env.DB, employeeId, timestamp);
  await appendHistory(env.DB, employeeId, '', 'Drive保存', `承認済み書類${savedCount}件をDriveに保存`, email);
  return adminGetEmployeeDetail(env, email, employeeId);
}

// ---------- jinjer連携 ----------
// 【重要】従業員マスタのエンドポイント・fileオブジェクトの形式など、一部は未確認(src/jinjer.tsの「要確認」コメント参照)。
// 認証(APIキー/シークレットキー→アクセストークン取得→Bearer)・緊急連絡先の取得/登録は動作確認済み。

async function requireJinjerConfig(env: Env): Promise<{ baseUrl: string; accessToken: string }> {
  const baseUrl = await getSetting(env.DB, SETTINGS_KEYS.JINJER_API_BASE_URL);
  if (!baseUrl) throw new ApiError('jinjerのAPIベースURLが未設定です（設定 > jinjer連携設定で指定してください）');
  const apiKey = await getSetting(env.DB, SETTINGS_KEYS.JINJER_API_KEY);
  const secretKey = await getSetting(env.DB, SETTINGS_KEYS.JINJER_API_SECRET_KEY);
  if (!apiKey || !secretKey) throw new ApiError('jinjerのAPIキー/シークレットキーが未設定です（設定 > jinjer連携設定で指定してください）');
  const accessToken = await getAccessToken(baseUrl, apiKey, secretKey);
  return { baseUrl, accessToken };
}

// 接続テスト用: アクセストークンの取得だけを行い、社員データには一切触れない(読み取りも書き込みも無し)。
export async function adminTestJinjerConnection(env: Env, email: string) {
  await requirePermission(env, email, 'jinjer');
  await requireJinjerConfig(env);
  return { ok: true };
}

// jinjerの市区町村マスタ(全国約1900件)をこちらのDBにキャッシュし直す。緊急連絡先の住所(都道府県/市区町村)を
// jinjerの全国地方公共団体コードに変換するために使う(src/jinjer.ts先頭のコメント参照)。
// 市区町村の統廃合はごく稀にしか起きないため、初回セットアップ時に1回実行すれば基本的には十分な想定。
export async function adminSyncJinjerMunicipalities(env: Env, email: string) {
  await requirePermission(env, email, 'jinjer');
  const { baseUrl, accessToken } = await requireJinjerConfig(env);
  const rows = await listMunicipalities(baseUrl, accessToken);
  await replaceMunicipalities(env.DB, rows);
  return { count: rows.length };
}

// 緊急連絡先をjinjerに登録する。Driveへの保存と同じく、自動送信ではなく管理者がこのボタンを押した時だけ実行する。
// 続柄・都道府県/市区町村は分かる範囲でコードを引き当てて送る(見つからない場合は未指定のまま)。
//
// 【重要な前提】
// - jinjer側の社員番号(employee_id)は、このシステムのEmployeeId(例:E0001)とは別物で、こちらで採番するもの
//   ではない。内定者が書類提出を始める時点ではまだ決まっておらず、jinjerへの反映タイミングになって初めて
//   決まる運用のため、HRが「設定 > 新入社員登録」の個別編集で事前に入力しておく必要がある
//   (employee.JinjerEmployeeId。未入力ならこの関数はエラーで止める)
// - 「従業員マスタ情報(氏名・配属先等)をjinjerに登録/更新する」エンドポイントは、実際に本番で動作確認できて
//   いない(src/jinjer.tsのupsertEmployeeMaster参照)。社員はjinjer側で登録済みの前提のため、素性不明な
//   "登録"系APIを本番の既存社員に対して呼ぶリスクを避け、現時点では呼び出さない(動作確認が取れ次第対応する)
// - jinjerの緊急連絡先の登録APIは「登録」専用で、同じ人に何度送っても新規追加されてしまい、更新・上書きの
//   手段が無いことを確認済み(src/jinjer.ts先頭のコメント参照)。そのため、employee.JinjerSyncedAtが
//   未設定(＝このボタンを押すのが初めて)の場合にのみ送信する(重複登録の防止)
export async function adminSyncToJinjer(env: Env, email: string, employeeId: string) {
  await requireAdmin(env, email);
  const employee = await findEmployeeById(env.DB, employeeId);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  if (!employee.JinjerEmployeeId) {
    throw new ApiError('jinjerの社員番号が未設定です（設定 > 新入社員登録の個別編集で入力してください）');
  }
  if (employee.JinjerSyncedAt) {
    throw new ApiError('この方の緊急連絡先は送信済みです（jinjer側は重複登録防止のため再送信できません）');
  }
  const { baseUrl, accessToken } = await requireJinjerConfig(env);

  const contacts = await listEmergencyContacts(env.DB, employeeId);
  if (!contacts.length) throw new ApiError('緊急連絡先が登録されていません');

  for (const c of contacts) {
    const nationalLocalGovernmentCode = (await findMunicipalityCode(env.DB, c.Prefecture, c.City)) ?? undefined;
    await syncEmergencyContact(baseUrl, accessToken, employee.JinjerEmployeeId, {
      lastName: c.LastName,
      firstName: c.FirstName,
      lastNameKana: c.LastNameKana,
      firstNameKana: c.FirstNameKana,
      phoneNumber: c.PhoneNumber,
      postalCode: c.PostalCode,
      addressKana: c.AddressKana,
      addressLine: c.AddressLine,
      building: c.Building,
      email: c.Email,
      relationshipId: resolveRelationshipId(c.Relationship),
      nationalLocalGovernmentCode
    });
  }

  await markJinjerSynced(env.DB, employeeId, nowStr());
  await appendHistory(env.DB, employeeId, '', 'jinjer同期', `緊急連絡先${contacts.length}件をjinjerに登録`, email);
  return adminGetEmployeeDetail(env, email, employeeId);
}

// (B) 承認済み書類のうち、書類マスタでjinjerカスタム項目コードが設定されているものだけをjinjerに送信する
// (未設定の書類種別は、jinjer側にまだ対応するカスタム項目が無いとみなして対象外にする)。
export async function adminSendFilesToJinjer(env: Env, email: string, employeeId: string) {
  await requireAdmin(env, email);
  const employee = await findEmployeeById(env.DB, employeeId);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  if (!employee.JinjerEmployeeId) {
    throw new ApiError('jinjerの社員番号が未設定です（設定 > 新入社員登録の個別編集で入力してください）');
  }
  const { baseUrl, accessToken } = await requireJinjerConfig(env);

  const docTypes = await loadDocTypes(env.DB);
  const subs = await getSubmissionsMap(env.DB, employeeId);
  const targets = applicableDocTypes(employee, docTypes).filter(
    (d) => d.jinjerCustomItemCode && subs[d.key]?.Status === STATUS.APPROVED && subs[d.key]?.StorageKey
  );
  if (!targets.length) {
    throw new ApiError('jinjerに送信できる承認済み書類がありません（書類マスタでjinjerカスタム項目コードを設定した書類のみが対象です）');
  }

  let sentCount = 0;
  for (const d of targets) {
    const sub = subs[d.key];
    const obj = await getEmployeeFile(env.DOCS, sub.StorageKey);
    if (!obj) continue;
    await attachFile(baseUrl, accessToken, {
      employeeId: employee.JinjerEmployeeId,
      customItemCode: d.jinjerCustomItemCode!,
      fileName: `${employee.Name}_${d.label}`,
      mimeType: sub.MimeType || 'application/octet-stream',
      bytes: await obj.arrayBuffer()
    });
    sentCount++;
  }
  if (!sentCount) throw new ApiError('送信対象のファイル実体が見つかりませんでした');

  await appendHistory(env.DB, employeeId, '', 'jinjerファイル送信', `承認済み書類${sentCount}件をjinjerに送信`, email);
  return adminGetEmployeeDetail(env, email, employeeId);
}

export async function adminListNotifications(env: Env, email: string) {
  await requireAdmin(env, email);
  return listRecentNotifications(env.DB, 100);
}

export async function adminGetTemplates(env: Env, email: string) {
  await requireAdmin(env, email);
  return { rejectTemplates: await listTemplates(env.DB, 'reject'), reminderTemplates: await listTemplates(env.DB, 'reminder') };
}

export async function adminAddTemplate(env: Env, email: string, type: TemplateType, title: string, text: string) {
  await requireAdmin(env, email);
  await addTemplateRow(env.DB, type, title, text);
  return adminGetTemplates(env, email);
}

export async function adminRemoveTemplate(env: Env, email: string, templateId: string) {
  await requireAdmin(env, email);
  await removeTemplateRow(env.DB, templateId);
  return adminGetTemplates(env, email);
}

// ---------- 設定 ----------

export async function settingsGet(env: Env, email: string) {
  await requireAdmin(env, email);
  const token = await getSetting(env.DB, SETTINGS_KEYS.LINE_CHANNEL_ACCESS_TOKEN);
  const secret = await getSetting(env.DB, SETTINGS_KEYS.LINE_CHANNEL_SECRET);
  const jinjerApiKey = await getSetting(env.DB, SETTINGS_KEYS.JINJER_API_KEY);
  const jinjerSecretKey = await getSetting(env.DB, SETTINGS_KEYS.JINJER_API_SECRET_KEY);
  const admins = await listAdmins(env.DB);
  const me = admins.find((a) => a.Email === email);
  return {
    myName: me ? me.Name : '',
    myPermissions: me ? me.Permissions : [...SETTINGS_CATEGORIES],
    tabOrder: await getTabOrder(env.DB),
    lineChannelAccessTokenMasked: token ? `設定済み（末尾: …${token.slice(-4)}）` : '未設定',
    lineChannelSecretMasked: secret ? `設定済み（末尾: …${secret.slice(-4)}）` : '未設定',
    liffChannelId: await getSetting(env.DB, SETTINGS_KEYS.LIFF_CHANNEL_ID),
    driveRootFolderId: await getSetting(env.DB, SETTINGS_KEYS.DRIVE_ROOT_FOLDER_ID),
    jinjerApiBaseUrl: await getSetting(env.DB, SETTINGS_KEYS.JINJER_API_BASE_URL),
    jinjerCompanyId: await getSetting(env.DB, SETTINGS_KEYS.JINJER_COMPANY_ID),
    jinjerApiKeyMasked: jinjerApiKey ? `設定済み（末尾: …${jinjerApiKey.slice(-4)}）` : '未設定',
    jinjerApiSecretKeyMasked: jinjerSecretKey ? `設定済み（末尾: …${jinjerSecretKey.slice(-4)}）` : '未設定',
    jinjerMunicipalityCount: await countMunicipalities(env.DB),
    admins,
    rejectTemplates: await listTemplates(env.DB, 'reject'),
    reminderTemplates: await listTemplates(env.DB, 'reminder'),
    jobTypeCompanyMap: await getJobTypeCompanyMap(env.DB),
    docTypes: await loadDocTypes(env.DB),
    employees: (await listEmployees(env.DB)).map((e) => ({
      id: e.EmployeeId,
      name: e.Name,
      kana: e.Kana,
      jobType: e.JobType,
      company: e.Company,
      hireDate: e.HireDate,
      linked: !!e.LineUserId,
      jinjerEmployeeId: e.JinjerEmployeeId || '',
      jinjerSyncedAt: e.JinjerSyncedAt || ''
    })),
    companies: COMPANIES,
    commutes: COMMUTES
  };
}

// ---------- 新入社員登録 ----------

export async function settingsAddEmployee(env: Env, email: string, name: string, kana: string, jobType: string) {
  await requirePermission(env, email, 'emp');
  if (!name || !String(name).trim()) throw new ApiError('氏名を入力してください');
  if (!jobType || !String(jobType).trim()) throw new ApiError('職種を入力してください（本人確認・配属先の自動決定に使用します）');
  const id = await nextEmployeeId(env.DB);
  await saveEmployee(env.DB, {
    EmployeeId: id,
    Name: String(name).trim(),
    Kana: (kana || '').toString().trim(),
    Company: '',
    Commute: '',
    HireDate: '',
    JobType: String(jobType).trim(),
    LineUserId: ''
  });
  return { employeeId: id };
}

// 氏名・フリガナ・職種・入社予定日を社員ごとに個別編集する(一括設定と異なり、この社員だけを更新する)。
// 職種を変更した場合は、confirmBind時と同じロジックで配属先(Company)も職種法人マスタから再算出する。
export async function settingsUpdateEmployee(
  env: Env,
  email: string,
  employeeId: string,
  name: string,
  kana: string,
  jobType: string,
  hireDate: string,
  jinjerEmployeeId?: string
) {
  await requirePermission(env, email, 'emp');
  const existing = await findEmployeeById(env.DB, employeeId);
  if (!existing) throw new ApiError('新入社員情報が見つかりません');
  if (!name || !String(name).trim()) throw new ApiError('氏名を入力してください');
  if (!jobType || !String(jobType).trim()) throw new ApiError('職種を入力してください（本人確認・配属先の自動決定に使用します）');

  const trimmedJobType = String(jobType).trim();
  const companyMap = await getJobTypeCompanyMap(env.DB);
  await saveEmployee(env.DB, {
    ...existing,
    Name: String(name).trim(),
    Kana: (kana || '').toString().trim(),
    JobType: trimmedJobType,
    Company: companyMap[trimmedJobType] || existing.Company,
    HireDate: (hireDate || '').toString().trim()
  });
  await setJinjerEmployeeId(env.DB, employeeId, (jinjerEmployeeId || '').toString().trim());
  return settingsGet(env, email);
}

type BulkEmployeeRow = { 氏名?: string; Name?: string; フリガナ?: string; Kana?: string; 職種?: string; JobType?: string };

export async function settingsBulkAddEmployees(env: Env, email: string, rows: BulkEmployeeRow[]) {
  await requirePermission(env, email, 'emp');
  const valid: Omit<Employee, 'EmployeeId'>[] = [];
  const errors: { row: number; reason: string }[] = [];
  (rows || []).forEach((row, i) => {
    const name = (row['氏名'] || row['Name'] || '').toString().trim();
    const kana = (row['フリガナ'] || row['Kana'] || '').toString().trim();
    const jobType = (row['職種'] || row['JobType'] || '').toString().trim();
    if (!name) { errors.push({ row: i + 2, reason: '氏名が空です' }); return; }
    if (!jobType) { errors.push({ row: i + 2, reason: '職種が空です（本人確認・配属先の自動決定に使用するため必須です）' }); return; }
    valid.push({ Name: name, Kana: kana, Company: '', Commute: '', HireDate: '', JobType: jobType, LineUserId: '' });
  });

  const ids = await nextEmployeeIds(env.DB, valid.length);
  const withIds: Employee[] = valid.map((e, i) => ({ ...e, EmployeeId: ids[i] }));
  if (withIds.length) await saveEmployees(env.DB, withIds);

  return { added: withIds.map((e) => ({ employeeId: e.EmployeeId, name: e.Name })), errors };
}

// CSV/Excelから「社員番号(jinjer側)」と「氏名」の組を読み込み、氏名の完全一致で新入社員一覧と紐付ける。
// 名前が一致しない/複数一致する行はエラーとして報告し、個別編集での対応を促す(誤った相手に紐付けないため)。
type BulkJinjerLinkRow = { 社員番号?: string | number; JinjerEmployeeId?: string | number; 氏名?: string; Name?: string };

export async function settingsBulkLinkJinjerEmployees(env: Env, email: string, rows: BulkJinjerLinkRow[]) {
  await requirePermission(env, email, 'emp');
  const employees = await listEmployees(env.DB);
  const linked: { name: string; jinjerEmployeeId: string }[] = [];
  const errors: { row: number; reason: string }[] = [];

  for (let i = 0; i < (rows || []).length; i++) {
    const row = rows[i];
    const name = (row['氏名'] || row['Name'] || '').toString().trim();
    const jinjerEmployeeId = (row['社員番号'] || row['JinjerEmployeeId'] || '').toString().trim();
    if (!name) { errors.push({ row: i + 2, reason: '氏名が空です' }); continue; }
    if (!jinjerEmployeeId) { errors.push({ row: i + 2, reason: '社員番号が空です' }); continue; }
    const matches = employees.filter((e) => e.Name.trim() === name);
    if (matches.length === 0) { errors.push({ row: i + 2, reason: `「${name}」に一致する新入社員が見つかりません` }); continue; }
    if (matches.length > 1) { errors.push({ row: i + 2, reason: `「${name}」に一致する新入社員が複数いるため、個別編集で設定してください` }); continue; }
    await setJinjerEmployeeId(env.DB, matches[0].EmployeeId, jinjerEmployeeId);
    linked.push({ name, jinjerEmployeeId });
  }

  return { linked, errors };
}

export async function settingsBulkSetHireDate(env: Env, email: string, hireDate: string) {
  await requirePermission(env, email, 'emp');
  if (!hireDate || !String(hireDate).trim()) throw new ApiError('入社予定日を入力してください');
  const updated = await bulkSetHireDate(env.DB, String(hireDate).trim());
  return { updated };
}

// テスト登録などを削除するため。提出済みの書類・履歴も合わせて削除される
export async function settingsRemoveEmployee(env: Env, email: string, employeeId: string) {
  await requirePermission(env, email, 'emp');
  await deleteEmployee(env.DB, employeeId);
  return settingsGet(env, email);
}

// ---------- テンプレート編集(設定ページからも同じ関数を使う) ----------

export async function settingsAddTemplate(env: Env, email: string, type: TemplateType, title: string, text: string) {
  await requirePermission(env, email, 'tpl');
  await addTemplateRow(env.DB, type, title, text);
  return settingsGet(env, email);
}

export async function settingsRemoveTemplate(env: Env, email: string, templateId: string) {
  await requirePermission(env, email, 'tpl');
  await removeTemplateRow(env.DB, templateId);
  return settingsGet(env, email);
}

// ---------- 管理者(GroupsApp代替。adminsテーブルの列で権限を直接管理する) ----------

export async function settingsAddAdmin(
  env: Env,
  email: string,
  name: string,
  adminEmail: string,
  company: string,
  lineUserId: string,
  permissions: string[],
  myNumberCompanies: string[]
) {
  await requirePermission(env, email, 'admin');
  if (!name || !adminEmail) throw new ApiError('氏名とメールアドレスを入力してください');
  await addAdminRow(env.DB, {
    Name: name,
    Email: adminEmail,
    Company: company || '',
    LineUserId: lineUserId || '',
    Permissions: sanitizePermissions(permissions || []),
    MyNumberCompanies: myNumberCompanies || []
  });
  return settingsGet(env, email);
}

export async function settingsRemoveAdmin(env: Env, email: string, adminId: string) {
  await requirePermission(env, email, 'admin');
  await removeAdminRow(env.DB, adminId);
  return settingsGet(env, email);
}

export async function settingsUpdateAdmin(
  env: Env,
  email: string,
  adminId: string,
  name: string,
  adminEmail: string,
  company: string,
  lineUserId: string,
  permissions: string[],
  myNumberCompanies: string[]
) {
  await requirePermission(env, email, 'admin');
  if (!name || !adminEmail) throw new ApiError('氏名とメールアドレスを入力してください');
  await updateAdminRow(env.DB, adminId, {
    Name: name,
    Email: adminEmail,
    Company: company || '',
    LineUserId: lineUserId || '',
    Permissions: sanitizePermissions(permissions || []),
    MyNumberCompanies: myNumberCompanies || []
  });
  return settingsGet(env, email);
}

// ---------- サイドタブの並び順 ----------

export async function settingsSaveTabOrder(env: Env, email: string, order: string[]) {
  await requirePermission(env, email, 'admin');
  await setSetting(env.DB, SETTINGS_KEYS.SETTINGS_TAB_ORDER, JSON.stringify(sanitizePermissions(order || [])));
  return settingsGet(env, email);
}

// ---------- API設定(LINE / Liny) ----------

export async function settingsSaveLineChannel(env: Env, email: string, liffChannelId: string, token: string, channelSecret?: string) {
  await requirePermission(env, email, 'line');
  await setSettings(env.DB, {
    [SETTINGS_KEYS.LIFF_CHANNEL_ID]: liffChannelId || '',
    ...(token ? { [SETTINGS_KEYS.LINE_CHANNEL_ACCESS_TOKEN]: token } : {}),
    ...(channelSecret ? { [SETTINGS_KEYS.LINE_CHANNEL_SECRET]: channelSecret } : {})
  });
  return settingsGet(env, email);
}

// ---------- Google Drive連携設定 ----------
// サービスアカウントの秘密鍵はここでは扱わない(wrangler secretで別途設定)。ここは保存先フォルダIDのみ。

export async function settingsSaveDriveConfig(env: Env, email: string, rootFolderId: string) {
  await requirePermission(env, email, 'drive');
  await setSetting(env.DB, SETTINGS_KEYS.DRIVE_ROOT_FOLDER_ID, (rootFolderId || '').trim());
  return settingsGet(env, email);
}

// ---------- jinjer連携設定 ----------
// LINEチャネルアクセストークンと同じ扱いで、APIキーもsettingsテーブルに保存する(空欄で保存した場合は
// 既存の値を維持する。マスク表示中に誤って空欄のまま上書き保存してしまうのを防ぐため)。

export async function settingsSaveJinjerConfig(
  env: Env,
  email: string,
  baseUrl: string,
  companyId: string,
  apiKey?: string,
  secretKey?: string
) {
  await requirePermission(env, email, 'jinjer');
  await setSettings(env.DB, {
    [SETTINGS_KEYS.JINJER_API_BASE_URL]: (baseUrl || '').trim(),
    [SETTINGS_KEYS.JINJER_COMPANY_ID]: (companyId || '').trim(),
    ...(apiKey ? { [SETTINGS_KEYS.JINJER_API_KEY]: apiKey.trim() } : {}),
    ...(secretKey ? { [SETTINGS_KEYS.JINJER_API_SECRET_KEY]: secretKey.trim() } : {})
  });
  return settingsGet(env, email);
}

// 管理者一覧のマイナンバー閲覧権限(法人ごと)を変更した後などに、Drive上の法人フォルダの閲覧権限を
// 今の設定に合わせて手動で揃え直すためのボタン用API。フォルダが無い法人は新規作成する。
export async function adminSyncDrivePermissions(env: Env, email: string) {
  await requirePermission(env, email, 'drive');
  const rootFolderId = await getSetting(env.DB, SETTINGS_KEYS.DRIVE_ROOT_FOLDER_ID);
  if (!rootFolderId) throw new ApiError('Driveの保存先フォルダが未設定です（設定 > Google Drive連携設定で指定してください）');

  const accessToken = await getDriveAccessToken(env);
  const admins = await listAdmins(env.DB);
  const results: { company: string; granted: string[]; revoked: string[] }[] = [];
  for (const company of COMPANIES) {
    const companyFolderId = await ensureFolder(accessToken, rootFolderId, company);
    const diff = await syncFolderPermissions(accessToken, companyFolderId, resolveCompanyFolderTargetEmails(admins, company));
    results.push({ company, ...diff });
  }
  return { results };
}

// ---------- 書類マスタ(旧: スプレッドシート直接編集 → 新設のCRUD) ----------

export async function settingsSaveDocConfig(env: Env, email: string, doc: DocType, sortOrder: number) {
  await requirePermission(env, email, 'doc');
  if (!doc.key || !doc.label) throw new ApiError('書類キーと書類名を入力してください');
  await upsertDocConfig(env.DB, doc, sortOrder);
  return settingsGet(env, email);
}

export async function settingsRemoveDocConfig(env: Env, email: string, docKey: string) {
  await requirePermission(env, email, 'doc');
  await removeDocConfig(env.DB, docKey);
  return settingsGet(env, email);
}

// ドラッグ&ドロップで並び替えた後の書類マスタの順序をまとめて保存する
export async function settingsReorderDocConfig(env: Env, email: string, orderedKeys: string[]) {
  await requirePermission(env, email, 'doc');
  const docTypes = await loadDocTypes(env.DB);
  const byKey = new Map(docTypes.map((d) => [d.key, d]));
  for (let i = 0; i < orderedKeys.length; i++) {
    const doc = byKey.get(orderedKeys[i]);
    if (doc) await upsertDocConfig(env.DB, doc, i);
  }
  return settingsGet(env, email);
}

// ---------- 職種法人マスタ(旧: スプレッドシート直接編集 → 新設のCRUD) ----------

export async function settingsSaveJobType(env: Env, email: string, jobType: string, company: string) {
  await requirePermission(env, email, 'job');
  if (!jobType || !company) throw new ApiError('職種と法人を入力してください');
  await setJobTypeCompany(env.DB, jobType, company);
  return settingsGet(env, email);
}

export async function settingsRemoveJobType(env: Env, email: string, jobType: string) {
  await requirePermission(env, email, 'job');
  await removeJobType(env.DB, jobType);
  return settingsGet(env, email);
}

// ---------- 初期セットアップ ----------
// D1のスキーマ自体はmigrationsで作成済み。ここでは書類マスタ・テンプレートの初期データ投入だけ行う
// (旧setupSystemのスプレッドシート整形・Driveフォルダ作成に相当する処理は不要)。

export async function settingsRunSetup(env: Env, email: string) {
  await requirePermission(env, email, 'setup');
  await seedCompanyDocumentConfigIfEmpty(env.DB);
  await seedTemplatesIfEmpty(env.DB);
  return settingsGet(env, email);
}

export { ApiError, COMMUTES };
