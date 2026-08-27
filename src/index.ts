import { Hono } from 'hono';
import type { Env } from './bindings';
import * as liffApi from './api/liff';
import { ApiError } from './api/liff';

const app = new Hono<{ Bindings: Env }>();

// 動作確認用(D1バインディングの疎通確認)。管理API本体はフェーズ4でここに追加する。
app.get('/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM employees').first<{ n: number }>();
  return c.json({ ok: true, employees: row?.n ?? 0 });
});

// 静的アセット(public/liff/, public/admin/等)はCloudflareの配信層がWorkerより先に処理するため、
// /liff や /liff/ のようなパスは明示的なルートを書かなくても public/liff/index.html が返る。
app.get('/', (c) => c.redirect('/liff/'));

app.get('/api/liff/config', async (c) => c.json(await liffApi.getLiffConfig(c.env)));

// 旧gas-app-liff/Code.gsのAPI_FUNCTIONS_と同じ、呼び出せる関数を許可リストで限定するディスパッチ方式
const LIFF_FUNCTIONS: Record<string, (env: Env, ...args: any[]) => Promise<unknown>> = {
  liffBind: liffApi.liffBind,
  identifyAndBind: liffApi.identifyAndBind,
  saveCommute: liffApi.saveCommute,
  getMyDocuments: liffApi.getMyDocuments,
  submitDocument: liffApi.submitDocument,
  getMyStatusByLine: liffApi.getMyStatusByLine,
  getJobTypeOptions: liffApi.getJobTypeOptionsApi
};

app.post('/api/liff/:fn', async (c) => {
  const fn = LIFF_FUNCTIONS[c.req.param('fn')];
  if (!fn) return c.json({ ok: false, error: `不明な操作です: ${c.req.param('fn')}` }, 404);
  let args: unknown[] = [];
  try {
    const body = await c.req.json();
    args = Array.isArray(body?.args) ? body.args : [];
  } catch {
    return c.json({ ok: false, error: 'リクエストの形式が不正です' }, 400);
  }
  try {
    const result = await fn(c.env, ...args);
    return c.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof ApiError || err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 400);
  }
});

// マッチしないルートは静的アセット(public/)にフォールバック(LIFF/Admin画面はフェーズ3・5で追加)
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
