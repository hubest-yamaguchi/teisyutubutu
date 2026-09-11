// gas-app-liff/Api.gs の移植。関数名・挙動は極力そのまま揃える。

import type { Env } from '../bindings';
import { COMMUTES, HIRE_TYPES, computeStage, progressPct, isApplicable, STATUS, DocType } from '../model';
import { findEmployeeById, findEmployeeByLineUserId, findUnlinkedEmployeesByKana, normalizeKana, saveEmployee, Employee } from '../db/employees';
import { getJobTypeCompanyMap } from '../db/jobTypeMap';
import { getSubmissionsMap, upsertSubmission } from '../db/submissions';
import { appendHistory } from '../db/history';
import { loadDocTypes } from '../db/docConfig';
import { listEmergencyContacts, saveEmergencyContacts, EmergencyContact } from '../db/emergencyContacts';
import { saveEmployeeFile } from '../r2';
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
    hasLicense: employee.HasLicense || '',
    hireType: employee.HireType || '',
    hireDate: employee.HireDate || ''
  };
}

function subsToStatusMap(subs: Record<string, { Status: string; RequiredOverride?: number | null }>) {
  const map: Record<string, { status: string; requiredOverride?: number | null }> = {};
  for (const k of Object.keys(subs)) map[k] = { status: subs[k].Status, requiredOverride: subs[k].RequiredOverride ?? null };
  return map;
}

async function buildDocumentsPayload(db: D1Database, employee: Employee) {
  // 配属先(Company)は職種法人マスタから自動決定されるため、ここでは通勤手段・運転免許証の有無・区分の
  // 未回答だけを見る。運転免許証の有無・区分は通勤手段に関係なく全員必須の質問のため、いずれか1つでも
  // 未回答なら通勤手段と同じ扱いで書類一覧をブロックする(1つの質問フォームでまとめて回答してもらう)。
  const needsCommute = !employee.Commute;
  const needsLicenseAnswer = !employee.HasLicense;
  const needsHireType = !employee.HireType;
  const base: any = {
    employee: publicEmployee(employee),
    needsCommute,
    needsLicenseAnswer,
    needsHireType,
    companies: [], // COMPANIESはconditionのcompany判定にのみ使う内部値。画面はJobType経由なのでここでは空でよい
    commutes: COMMUTES,
    hireTypes: HIRE_TYPES
  };
  if (needsCommute || needsLicenseAnswer || needsHireType) {
    base.docs = [];
    base.progressPct = 0;
    base.stage = '未提出';
    return base;
  }

  // 緊急連絡先(最低1件)。別画面でブロックはせず、書類一覧画面の下部に組み込んで表示するための情報として渡す
  const emergencyContacts = await listEmergencyContacts(db, employee.EmployeeId);
  base.needsEmergencyContact = emergencyContacts.length === 0;
  base.emergencyContacts = emergencyContacts;

  const docTypes = await loadDocTypes(db);
  const subs = await getSubmissionsMap(db, employee.EmployeeId);

  base.docs = docTypes.map((d: DocType) => {
    const s = subs[d.key] || ({} as any);
    const applicableFlag = isApplicable(d, employee, s.RequiredOverride ?? null);
    return {
      key: d.key,
      label: d.label,
      description: d.description || '',
      requiresOriginal: !!d.requiresOriginal,
      pdfAllowed: !!d.pdfAllowed,
      wordAllowed: !!d.wordAllowed,
      textAllowed: !!d.textAllowed,
      photoAllowed: d.photoAllowed !== false,
      sensitive: !!d.sensitive,
      optional: !!d.optional,
      status: applicableFlag ? s.Status || STATUS.NONE : STATUS.NA,
      submittedAt: s.SubmittedAt || '',
      rejectReason: s.RejectReason || '',
      rejectedAt: s.RejectedAt || '',
      textContent: s.TextContent || ''
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

// 通勤手段・運転免許証の有無・区分(新卒/中途)をまとめて回答する。いずれも通勤手段に関係なく全員必須のため、
// 通勤手段と同じ1つの質問フォームでまとめて答えてもらう(buildDocumentsPayloadのブロック条件と対応)。
export async function saveProfile(
  env: Env,
  eid: string,
  lineUserId: string,
  commute: string,
  hasLicense: string,
  hireType: string
) {
  const employee = await findEmployeeById(env.DB, eid);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  if (!employee.LineUserId || employee.LineUserId !== lineUserId) {
    throw new ApiError('本人確認ができませんでした。LINEアプリから開き直してください。');
  }
  if (!(COMMUTES as readonly string[]).includes(commute)) throw new ApiError('通勤手段を選択してください');
  if (hasLicense !== 'あり' && hasLicense !== 'なし') throw new ApiError('運転免許証の有無を選択してください');
  if (!(HIRE_TYPES as readonly string[]).includes(hireType)) throw new ApiError('区分（新卒／中途）を選択してください');

  employee.Commute = commute;
  employee.HasLicense = hasLicense;
  employee.HireType = hireType;
  await saveEmployee(env.DB, employee);
  await appendHistory(
    env.DB,
    eid,
    '',
    '通勤手段・運転免許証・区分回答',
    `通勤手段: ${commute} / 運転免許証: ${hasLicense} / 区分: ${hireType}`,
    ''
  );

  const payload = await buildDocumentsPayload(env.DB, employee);
  payload.ok = true;
  return payload;
}

// 緊急連絡先の保存(初回登録・再編集とも同じ経路。既存内容は全て置き換わる)。
// 最低1件必須で、1件目のみ 姓・名・続柄・電話番号 を必須項目とする(2件目以降・フリガナ・住所・E-mailは任意)。
export async function saveEmergencyContactsApi(env: Env, eid: string, lineUserId: string, contacts: EmergencyContact[]) {
  const employee = await findEmployeeById(env.DB, eid);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  if (!employee.LineUserId || employee.LineUserId !== lineUserId) {
    throw new ApiError('本人確認ができませんでした。LINEアプリから開き直してください。');
  }
  if (!Array.isArray(contacts) || contacts.length === 0) throw new ApiError('緊急連絡先を1件以上入力してください');
  const first = contacts[0];
  if (!first.LastName || !first.FirstName || !first.Relationship || !first.PhoneNumber) {
    throw new ApiError('1件目の緊急連絡先は、姓・名・続柄・電話番号を入力してください');
  }

  await saveEmergencyContacts(env.DB, eid, contacts);
  await appendHistory(env.DB, eid, '', '緊急連絡先登録', `${contacts.length}件登録`, '');

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
  const existingSub = await getSubmissionsMap(env.DB, eid);
  if (!isApplicable(meta, employee, existingSub[docKey]?.RequiredOverride ?? null)) throw new ApiError('この書類は対象外です');
  if (meta.photoAllowed === false && mimeType.indexOf('image/') === 0) {
    throw new ApiError('この書類は写真での提出に対応していません。Word・PDFファイルを添付するか、テキストで提出してください。');
  }

  const seq = docTypes.findIndex((d) => d.key === docKey) + 1;
  const storageKey = await saveEmployeeFile(env.DOCS, employee.EmployeeId, meta.label, seq, base64Data, mimeType, fileExt);

  await upsertSubmission(env.DB, eid, docKey, {
    Status: STATUS.REVIEW,
    SubmittedAt: todayStr(),
    RejectReason: '',
    RejectedAt: '',
    StorageKey: storageKey,
    MimeType: mimeType,
    TextContent: ''
  });
  await appendHistory(env.DB, eid, docKey, '提出', `${meta.label}を提出`, '');

  const payload = await buildDocumentsPayload(env.DB, employee);
  payload.ok = true;
  return payload;
}

// テキストを直接入力しての提出(textAllowedの書類のみ)。ファイル添付と同じステータス遷移を使う
export async function submitDocumentText(env: Env, eid: string, docKey: string, text: string) {
  const employee = await findEmployeeById(env.DB, eid);
  if (!employee) throw new ApiError('新入社員情報が見つかりません');
  if (!employee.Company || !employee.Commute) throw new ApiError('先に配属先・通勤手段を回答してください');
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new ApiError('内容を入力してください');

  const docTypes = await loadDocTypes(env.DB);
  const meta = docTypes.find((d) => d.key === docKey);
  if (!meta) throw new ApiError(`不明な書類種別です: ${docKey}`);
  const existingSub = await getSubmissionsMap(env.DB, eid);
  if (!isApplicable(meta, employee, existingSub[docKey]?.RequiredOverride ?? null)) throw new ApiError('この書類は対象外です');
  if (!meta.textAllowed) throw new ApiError('この書類はテキストでの提出に対応していません');

  await upsertSubmission(env.DB, eid, docKey, {
    Status: STATUS.REVIEW,
    SubmittedAt: todayStr(),
    RejectReason: '',
    RejectedAt: '',
    StorageKey: '',
    MimeType: '',
    TextContent: trimmed
  });
  await appendHistory(env.DB, eid, docKey, '提出', `${meta.label}をテキストで提出`, '');

  const payload = await buildDocumentsPayload(env.DB, employee);
  payload.ok = true;
  return payload;
}

export { ApiError };
