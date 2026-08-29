import { Hono } from 'hono';
import type { Env } from './bindings';
import * as liffApi from './api/liff';
import * as adminApi from './api/admin';
import * as authApi from './api/auth';
import { ApiError as LiffApiError } from './api/liff';
import { ApiError as AdminApiError } from './api/admin';
import { AuthError } from './api/auth';
import { getSessionEmail, issueSessionCookie, clearSessionCookie } from './session';
import { getEmployeeFile } from './r2';
import { findAdminByEmail } from './db/admins';

async function nameFor(db: D1Database, email: string | null): Promise<string> {
  if (!email) return '';
  const admin = await findAdminByEmail(db, email);
  return admin?.Name || '';
}

type Variables = { adminEmail: string };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// 動作確認用(D1バインディングの疎通確認)
app.get('/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM employees').first<{ n: number }>();
  return c.json({ ok: true, employees: row?.n ?? 0 });
});

// 静的アセット(public/liff/, public/admin/等)はCloudflareの配信層がWorkerより先に処理するため、
// /liff や /admin のようなパスは明示的なルートを書かなくても該当のindex.htmlが返る。
app.get('/', (c) => c.redirect('/liff/'));

app.get('/api/liff/config', async (c) => c.json(await liffApi.getLiffConfig(c.env)));

// 許可リスト方式のfn->handlerディスパッチ(旧gas-app-liff/Code.gsのAPI_FUNCTIONS_と同じ考え方)。
// bodyの{args}をそのまま関数に展開する。第1引数は常にenv、必要なら呼び出し側でメールアドレス等を差し込む。
function dispatch<TError extends Error>(
  functions: Record<string, (...args: any[]) => Promise<unknown>>,
  errorClass: new (...a: any[]) => TError,
  extraArgsBefore: (c: any) => any[]
) {
  return async (c: any) => {
    const fn = functions[c.req.param('fn')];
    if (!fn) return c.json({ ok: false, error: `不明な操作です: ${c.req.param('fn')}` }, 404);
    let args: unknown[] = [];
    try {
      const body = await c.req.json();
      args = Array.isArray(body?.args) ? body.args : [];
    } catch {
      return c.json({ ok: false, error: 'リクエストの形式が不正です' }, 400);
    }
    try {
      const result = await fn(c.env, ...extraArgsBefore(c), ...args);
      return c.json({ ok: true, result });
    } catch (err) {
      const message = err instanceof errorClass || err instanceof Error ? err.message : String(err);
      const status = err instanceof errorClass ? 400 : 500;
      return c.json({ ok: false, error: message }, status);
    }
  };
}

const LIFF_FUNCTIONS: Record<string, (env: Env, ...args: any[]) => Promise<unknown>> = {
  liffBind: liffApi.liffBind,
  findByKana: liffApi.findByKana,
  confirmBind: liffApi.confirmBind,
  saveCommute: liffApi.saveCommute,
  getMyDocuments: liffApi.getMyDocuments,
  submitDocument: liffApi.submitDocument,
  getMyStatusByLine: liffApi.getMyStatusByLine
};

app.post('/api/liff/:fn', dispatch(LIFF_FUNCTIONS, LiffApiError, () => []));

// ---------- 管理画面: ID/パスワードログイン ----------
// 旧: Cloudflare Access(Zero Trust)。新規管理者ごとにAccessのポリシー編集が必要で運用が煩雑だったため、
// このWorker自身がログインを検証し、セッションCookie(admin_session)を発行する方式に変更した(src/session.ts)。

function authErrorResponse(c: any, err: unknown) {
  const message = err instanceof AuthError || err instanceof Error ? err.message : String(err);
  return c.json({ ok: false, error: message }, err instanceof AuthError ? 400 : 500);
}

app.post('/api/auth/login', async (c) => {
  try {
    const body = await c.req.json();
    const email = await authApi.login(c.env, String(body.email || '').trim(), String(body.password || ''));
    c.header('Set-Cookie', await issueSessionCookie(c.env.DB, email));
    return c.json({ ok: true, result: { email, name: await nameFor(c.env.DB, email) } });
  } catch (err) {
    return authErrorResponse(c, err);
  }
});

// 管理者一覧には登録済みだがパスワード未設定のメールアドレスが、初めてここでパスワードを設定する
// (adminsが1件も無い初回デプロイ直後は、このメールで最初の管理者を全権限で作成する)
app.post('/api/auth/claim', async (c) => {
  try {
    const body = await c.req.json();
    const email = String(body.email || '').trim();
    await authApi.claimAccount(c.env, String(body.name || ''), email, String(body.password || ''));
    c.header('Set-Cookie', await issueSessionCookie(c.env.DB, email));
    return c.json({ ok: true, result: { email, name: await nameFor(c.env.DB, email) } });
  } catch (err) {
    return authErrorResponse(c, err);
  }
});

app.post('/api/auth/logout', async (c) => {
  c.header('Set-Cookie', await clearSessionCookie(c.req.raw, c.env.DB));
  return c.json({ ok: true, result: {} });
});

app.get('/api/auth/me', async (c) => {
  const email = await getSessionEmail(c.req.raw, c.env.DB);
  return c.json({ ok: true, result: { email, name: await nameFor(c.env.DB, email) } });
});

app.post('/api/auth/change-password', async (c) => {
  const email = await getSessionEmail(c.req.raw, c.env.DB);
  if (!email) return c.json({ ok: false, error: '認証が必要です' }, 401);
  try {
    const body = await c.req.json();
    await authApi.changePassword(c.env, email, String(body.currentPassword || ''), String(body.newPassword || ''));
    return c.json({ ok: true, result: {} });
  } catch (err) {
    return authErrorResponse(c, err);
  }
});

// ---------- 管理画面: セッション認証が必要なAPI群 ----------
// ローカル開発(wrangler dev)では、ENVIRONMENT=developmentの間だけ X-Debug-Admin-Email ヘッダーを信頼する
// (本番のENVIRONMENT=productionでは絶対に効かない)。
app.use('/api/admin/*', async (c, next) => {
  let email = await getSessionEmail(c.req.raw, c.env.DB);
  if (!email && c.env.ENVIRONMENT === 'development') {
    email = c.req.header('X-Debug-Admin-Email') || null;
  }
  if (!email) return c.json({ ok: false, error: '認証が必要です' }, 401);
  c.set('adminEmail', email);
  await next();
});

const ADMIN_FUNCTIONS: Record<string, (env: Env, email: string, ...args: any[]) => Promise<unknown>> = {
  adminGetDashboard: adminApi.adminGetDashboard,
  adminGetEmployeeDetail: adminApi.adminGetEmployeeDetail,
  adminApproveDoc: adminApi.adminApproveDoc,
  adminRejectDocsBatch: adminApi.adminRejectDocsBatch,
  adminToggleOriginalReceived: adminApi.adminToggleOriginalReceived,
  adminSaveToDrive: adminApi.adminSaveToDrive,
  adminSendReminder: adminApi.adminSendReminder,
  adminDeleteMyNumber: adminApi.adminDeleteMyNumber,
  adminListNotifications: adminApi.adminListNotifications,
  adminGetTemplates: adminApi.adminGetTemplates,
  adminAddTemplate: adminApi.adminAddTemplate,
  adminRemoveTemplate: adminApi.adminRemoveTemplate,
  settingsGet: adminApi.settingsGet,
  settingsAddEmployee: adminApi.settingsAddEmployee,
  settingsBulkAddEmployees: adminApi.settingsBulkAddEmployees,
  settingsBulkSetHireDate: adminApi.settingsBulkSetHireDate,
  settingsRemoveEmployee: adminApi.settingsRemoveEmployee,
  settingsAddTemplate: adminApi.settingsAddTemplate,
  settingsRemoveTemplate: adminApi.settingsRemoveTemplate,
  settingsAddAdmin: adminApi.settingsAddAdmin,
  settingsRemoveAdmin: adminApi.settingsRemoveAdmin,
  settingsUpdateAdmin: adminApi.settingsUpdateAdmin,
  settingsSaveTabOrder: adminApi.settingsSaveTabOrder,
  settingsSaveLineChannel: adminApi.settingsSaveLineChannel,
  settingsSaveDriveConfig: adminApi.settingsSaveDriveConfig,
  settingsSaveDocConfig: adminApi.settingsSaveDocConfig,
  settingsRemoveDocConfig: adminApi.settingsRemoveDocConfig,
  settingsReorderDocConfig: adminApi.settingsReorderDocConfig,
  settingsSaveJobType: adminApi.settingsSaveJobType,
  settingsRemoveJobType: adminApi.settingsRemoveJobType,
  settingsRunSetup: adminApi.settingsRunSetup
};

app.post('/api/admin/:fn', dispatch(ADMIN_FUNCTIONS, AdminApiError, (c) => [c.get('adminEmail')]));

// 提出書類ファイルの表示(JSONディスパッチではなくバイナリを直接返すため専用ルート)
app.get('/api/admin/file', async (c) => {
  const email = c.get('adminEmail');
  const employeeId = c.req.query('employeeId') || '';
  const docKey = c.req.query('docKey') || '';
  try {
    const info = await adminApi.adminGetFileInfo(c.env, email, employeeId, docKey);
    const obj = await getEmployeeFile(c.env.DOCS, info.key);
    if (!obj) return c.json({ ok: false, error: 'ファイルが見つかりません' }, 404);
    return new Response(obj.body, { headers: { 'Content-Type': info.mimeType } });
  } catch (err) {
    const message = err instanceof AdminApiError || err instanceof Error ? err.message : String(err);
    const status = err instanceof AdminApiError ? 400 : 500;
    return c.json({ ok: false, error: message }, status);
  }
});

// マッチしないルートは静的アセット(public/)にフォールバック
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
