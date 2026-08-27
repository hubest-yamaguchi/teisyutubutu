import { Hono } from 'hono';
import type { Env } from './bindings';
import * as liffApi from './api/liff';
import * as adminApi from './api/admin';
import { ApiError as LiffApiError } from './api/liff';
import { ApiError as AdminApiError } from './api/admin';
import { getVerifiedAdminEmail } from './auth';

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
  identifyAndBind: liffApi.identifyAndBind,
  saveCommute: liffApi.saveCommute,
  getMyDocuments: liffApi.getMyDocuments,
  submitDocument: liffApi.submitDocument,
  getMyStatusByLine: liffApi.getMyStatusByLine,
  getJobTypeOptions: liffApi.getJobTypeOptionsApi
};

app.post('/api/liff/:fn', dispatch(LIFF_FUNCTIONS, LiffApiError, () => []));

// ---------- 管理画面: Cloudflare Access認証 ----------
// 本番はCloudflare Access(Zero Trust)が/admin配下を保護し、検証済みJWTをCf-Access-Jwt-Assertionで渡してくる。
// ここではそのJWTをAccessの公開鍵で再検証し、メールアドレスをc.set('adminEmail', email)で後続に渡す。
// ローカル開発(wrangler dev)ではAccessが前段に無くCF_ACCESS_*も未設定のため、
// ENVIRONMENT=development の間だけ X-Debug-Admin-Email ヘッダーを信頼する(本番では絶対に効かない)。
app.use('/api/admin/*', async (c, next) => {
  let email = await getVerifiedAdminEmail(c.req.raw, c.env);
  if (!email && c.env.ENVIRONMENT === 'development') {
    email = c.req.header('X-Debug-Admin-Email') || null;
  }
  if (!email) return c.json({ ok: false, error: '認証情報が確認できませんでした' }, 401);
  c.set('adminEmail', email);
  await next();
});

const ADMIN_FUNCTIONS: Record<string, (env: Env, email: string, ...args: any[]) => Promise<unknown>> = {
  adminGetDashboard: adminApi.adminGetDashboard,
  adminGetEmployeeDetail: adminApi.adminGetEmployeeDetail,
  adminApproveDoc: adminApi.adminApproveDoc,
  adminRejectDoc: adminApi.adminRejectDoc,
  adminToggleOriginalReceived: adminApi.adminToggleOriginalReceived,
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
  settingsAddTemplate: adminApi.settingsAddTemplate,
  settingsRemoveTemplate: adminApi.settingsRemoveTemplate,
  settingsAddAdmin: adminApi.settingsAddAdmin,
  settingsRemoveAdmin: adminApi.settingsRemoveAdmin,
  settingsSaveLineChannel: adminApi.settingsSaveLineChannel,
  settingsSaveNotifyProvider: adminApi.settingsSaveNotifyProvider,
  settingsSaveLiny: adminApi.settingsSaveLiny,
  settingsSaveDocConfig: adminApi.settingsSaveDocConfig,
  settingsRemoveDocConfig: adminApi.settingsRemoveDocConfig,
  settingsSaveJobType: adminApi.settingsSaveJobType,
  settingsRemoveJobType: adminApi.settingsRemoveJobType,
  settingsRunSetup: adminApi.settingsRunSetup
};

app.post('/api/admin/:fn', dispatch(ADMIN_FUNCTIONS, AdminApiError, (c) => [c.get('adminEmail')]));

// マッチしないルートは静的アセット(public/)にフォールバック
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
