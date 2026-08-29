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
  Employee
} from '../db/employees';
import { getSubmissionsMap, getAllSubmissions, upsertSubmission } from '../db/submissions';
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
import { notifyEmployee } from '../line';
import { todayStr } from '../util/date';
import { SettingsCategory, SETTINGS_CATEGORIES, sanitizePermissions } from '../permissions';

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
    pictureUrl: employee.PictureUrl || ''
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

  return { employee: publicEmployee(employee), docs, stage: computeStage(employee, subsToStatusMap(subs as any), docTypes) };
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

export async function adminRejectDoc(env: Env, email: string, employeeId: string, docKey: string, reason: string) {
  await requireAdmin(env, email);
  const employee = await findEmployeeById(env.DB, employeeId);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  const docTypes = await loadDocTypes(env.DB);
  const meta = docTypes.find((d) => d.key === docKey);
  if (!meta) throw new ApiError(`不明な書類種別です: ${docKey}`);
  await upsertSubmission(env.DB, employeeId, docKey, { Status: STATUS.REJECTED, RejectReason: reason, RejectedAt: todayStr() });
  await appendHistory(env.DB, employeeId, docKey, '差し戻し', reason, email);
  await notifyEmployee(env.DB, employee, `${meta.label}について差し戻しがありました。理由：${reason}`);
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

// 管理画面から提出ファイルを表示するための認可付きファイル情報取得(実体の取得はindex.ts側でR2から行う)
export async function adminGetFileInfo(env: Env, email: string, employeeId: string, docKey: string) {
  await requireAdmin(env, email);
  const employee = await findEmployeeById(env.DB, employeeId);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  if (docKey === 'myNumber' && !(await canViewMyNumber(env.DB, email, employee.Company))) {
    throw new ApiError('この操作にはマイナンバー閲覧権限が必要です');
  }
  const subs = await getSubmissionsMap(env.DB, employeeId);
  const sub = subs[docKey];
  if (!sub || !sub.StorageKey) throw new ApiError('ファイルが見つかりません');
  return { key: sub.StorageKey, mimeType: sub.MimeType || 'application/octet-stream' };
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
  const admins = await listAdmins(env.DB);
  const me = admins.find((a) => a.Email === email);
  return {
    myName: me ? me.Name : '',
    myPermissions: me ? me.Permissions : [...SETTINGS_CATEGORIES],
    tabOrder: await getTabOrder(env.DB),
    lineChannelAccessTokenMasked: token ? `設定済み（末尾: …${token.slice(-4)}）` : '未設定',
    liffChannelId: await getSetting(env.DB, SETTINGS_KEYS.LIFF_CHANNEL_ID),
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
      linked: !!e.LineUserId
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

export async function settingsSaveLineChannel(env: Env, email: string, liffChannelId: string, token: string) {
  await requirePermission(env, email, 'line');
  await setSettings(env.DB, {
    [SETTINGS_KEYS.LIFF_CHANNEL_ID]: liffChannelId || '',
    ...(token ? { [SETTINGS_KEYS.LINE_CHANNEL_ACCESS_TOKEN]: token } : {})
  });
  return settingsGet(env, email);
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
