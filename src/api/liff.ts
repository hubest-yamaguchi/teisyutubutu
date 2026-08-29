// gas-app-liff/Api.gs の移植。関数名・挙動は極力そのまま揃える。

import type { Env } from '../bindings';
import { COMMUTES, computeStage, progressPct, isApplicable, STATUS, DocType } from '../model';
import { findEmployeeById, findEmployeeByLineUserId, findUnlinkedEmployeesByKana, normalizeKana, saveEmployee, Employee } from '../db/employees';
import { getJobTypeCompanyMap } from '../db/jobTypeMap';
import { getSubmissionsMap, upsertSubmission } from '../db/submissions';
import { appendHistory } from '../db/history';
import { loadDocTypes } from '../db/docConfig';
import { saveEmployeeFile } from '../r2';
import { notifyAllAdmins } from '../line';
import { getSetting } from '../db/settings';
import { SETTINGS_KEYS } from '../db/settings';
import { todayStr } from '../util/date';

class ApiError extends Error {}

function publicEmployee(employee: Employee) {
  return {
    id: employee.EmployeeId,
    name: employee.Name,
    company: employee.Company || '',
    commute: employee.Commute || '',
    hireDate: employee.HireDate || ''
  };
}

function subsToStatusMap(subs: Record<string, { Status: string }>) {
  const map: Record<string, { status: string }> = {};
  for (const k of Object.keys(subs)) map[k] = { status: subs[k].Status };
  return map;
}

async function buildDocumentsPayload(db: D1Database, employee: Employee) {
  // 配属先(Company)は職種法人マスタから自動決定されるため、ここでは通勤手段の未回答だけを見る
  const needsCommute = !employee.Commute;
  const base: any = {
    employee: publicEmployee(employee),
    needsCommute,
    companies: [], // COMPANIESはconditionのcompany判定にのみ使う内部値。画面はJobType経由なのでここでは空でよい
    commutes: COMMUTES
  };
  if (needsCommute) {
    base.docs = [];
    base.progressPct = 0;
    base.stage = '未提出';
    return base;
  }

  const docTypes = await loadDocTypes(db);
  const subs = await getSubmissionsMap(db, employee.EmployeeId);

  base.docs = docTypes.map((d: DocType) => {
    const applicableFlag = isApplicable(d, employee);
    const s = subs[d.key] || ({} as any);
    return {
      key: d.key,
      label: d.label,
      description: d.description || '',
      requiresOriginal: !!d.requiresOriginal,
      pdfAllowed: !!d.pdfAllowed,
      sensitive: !!d.sensitive,
      status: applicableFlag ? s.Status || STATUS.NONE : STATUS.NA,
      submittedAt: s.SubmittedAt || '',
      rejectReason: s.RejectReason || '',
      rejectedAt: s.RejectedAt || ''
    };
  });
  base.progressPct = progressPct(employee, subsToStatusMap(subs), docTypes);
  base.stage = computeStage(employee, subsToStatusMap(subs), docTypes);
  return base;
}

export async function getLiffConfig(env: Env) {
  return { liffId: await getSetting(env.DB, SETTINGS_KEYS.LIFF_CHANNEL_ID) };
}

export async function liffBind(env: Env, eid: string, lineUserId: string, _displayName: string, pictureUrl?: string) {
  const employee = await findEmployeeById(env.DB, eid);
  if (!employee) {
    return { ok: false, error: 'このリンクに対応する新入社員情報が見つかりません。人事担当者にご確認ください。' };
  }
  if (!employee.LineUserId) {
    employee.LineUserId = lineUserId;
    employee.PictureUrl = pictureUrl || '';
    await saveEmployee(env.DB, employee);
  } else if (employee.LineUserId !== lineUserId) {
    return { ok: false, error: 'このリンクは別の方のLINEアカウントで既に登録されています。人事担当者にご確認ください。' };
  }
  const payload = await buildDocumentsPayload(env.DB, employee);
  payload.ok = true;
  return payload;
}

// 共通URLを開いた時点で、このLINEアカウントが既に紐付き済みかを調べる
export async function getMyStatusByLine(env: Env, lineUserId: string) {
  const employee = await findEmployeeByLineUserId(env.DB, lineUserId);
  if (!employee) return { ok: true, matched: false };
  const payload = await buildDocumentsPayload(env.DB, employee);
  payload.ok = true;
  payload.matched = true;
  return payload;
}

// フリガナだけで本人を特定し、まだ紐付けはせず氏名・職種・配属先を確認用に返す(確認画面「この内容で合っていますか？」用)。
export async function findByKana(env: Env, kana: string) {
  if (!kana || !String(kana).trim()) throw new ApiError('フリガナを入力してください');
  const candidates = await findUnlinkedEmployeesByKana(env.DB, kana);
  if (candidates.length === 0) {
    throw new ApiError('入力内容と一致する新入社員情報が見つかりませんでした。フリガナをご確認のうえ、正しい場合はお手数ですが総務課へご連絡ください。');
  }
  if (candidates.length > 1) {
    throw new ApiError('入力内容だけでは特定できませんでした。お手数ですが総務課へご連絡ください。');
  }
  const employee = candidates[0];
  const company = (await getJobTypeCompanyMap(env.DB))[String(employee.JobType).trim()];
  if (!company) {
    throw new ApiError('この職種に対応する配属先が見つかりませんでした。お手数ですが総務課へご連絡ください。');
  }
  return {
    employeeId: employee.EmployeeId,
    name: employee.Name,
    kana: employee.Kana,
    jobType: employee.JobType,
    company
  };
}

// 確認画面で「はい」を選んだ後に呼ぶ。kanaを再度渡し、findByKanaで特定した本人と一致するか再検証してから紐付ける
// (employeeIdだけを信頼すると、他人のIDを推測して紐付けられてしまうため)。
export async function confirmBind(env: Env, employeeId: string, kana: string, lineUserId: string, displayName: string, pictureUrl?: string) {
  const employee = await findEmployeeById(env.DB, employeeId);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  if (normalizeKana(employee.Kana) !== normalizeKana(kana)) {
    throw new ApiError('確認情報が一致しませんでした。お手数ですが最初からやり直してください。');
  }
  if (employee.LineUserId && employee.LineUserId !== lineUserId) {
    throw new ApiError('このアカウントは別の方のLINEアカウントで既に登録されています。お手数ですが総務課へご連絡ください。');
  }
  const company = (await getJobTypeCompanyMap(env.DB))[String(employee.JobType).trim()];
  if (!company) {
    throw new ApiError('この職種に対応する配属先が見つかりませんでした。お手数ですが総務課へご連絡ください。');
  }
  employee.LineUserId = lineUserId;
  employee.Company = company;
  employee.PictureUrl = pictureUrl || '';
  await saveEmployee(env.DB, employee);
  await appendHistory(env.DB, employee.EmployeeId, '', 'LINE連携', `LINE表示名: ${displayName || ''} / 職種: ${employee.JobType} / 配属先: ${company}`, '');

  const payload = await buildDocumentsPayload(env.DB, employee);
  payload.ok = true;
  payload.matched = true;
  return payload;
}

export async function saveCommute(env: Env, eid: string, lineUserId: string, commute: string) {
  const employee = await findEmployeeById(env.DB, eid);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  if (!employee.LineUserId || employee.LineUserId !== lineUserId) {
    throw new ApiError('本人確認ができませんでした。LINEアプリから開き直してください。');
  }
  if (!(COMMUTES as readonly string[]).includes(commute)) throw new ApiError('通勤手段を選択してください');

  employee.Commute = commute;
  await saveEmployee(env.DB, employee);
  await appendHistory(env.DB, eid, '', '通勤手段回答', `通勤手段: ${commute}`, '');

  const payload = await buildDocumentsPayload(env.DB, employee);
  payload.ok = true;
  return payload;
}

export async function getMyDocuments(env: Env, eid: string) {
  const employee = await findEmployeeById(env.DB, eid);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  return buildDocumentsPayload(env.DB, employee);
}

// 書類のアップロード(新規提出・再提出とも同じ経路。ファイルは上書き)。完了後の最新一覧も返す
export async function submitDocument(
  env: Env,
  eid: string,
  docKey: string,
  base64Data: string,
  mimeType: string,
  fileExt: string
) {
  const employee = await findEmployeeById(env.DB, eid);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  if (!employee.Company || !employee.Commute) throw new ApiError('先に配属先・通勤手段を回答してください');
  const docTypes = await loadDocTypes(env.DB);
  const meta = docTypes.find((d) => d.key === docKey);
  if (!meta) throw new ApiError(`不明な書類種別です: ${docKey}`);
  if (!isApplicable(meta, employee)) throw new ApiError('この書類は対象外です');

  const seq = docTypes.findIndex((d) => d.key === docKey) + 1;
  const storageKey = await saveEmployeeFile(env.DOCS, employee.EmployeeId, meta.label, seq, base64Data, mimeType, fileExt);

  await upsertSubmission(env.DB, eid, docKey, {
    Status: STATUS.REVIEW,
    SubmittedAt: todayStr(),
    RejectReason: '',
    RejectedAt: '',
    StorageKey: storageKey,
    MimeType: mimeType
  });
  await appendHistory(env.DB, eid, docKey, '提出', `${meta.label}を提出`, '');
  await notifyAllAdmins(env.DB, `${employee.Name}さんが「${meta.label}」を提出しました。`);

  const payload = await buildDocumentsPayload(env.DB, employee);
  payload.ok = true;
  return payload;
}

export { ApiError };
