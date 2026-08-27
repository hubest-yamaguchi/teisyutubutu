import { Hono } from 'hono';
import type { Env } from './bindings';

const app = new Hono<{ Bindings: Env }>();

// 動作確認用(D1バインディングの疎通確認)。LIFF/管理API本体はフェーズ3以降でここに追加していく。
app.get('/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM employees').first<{ n: number }>();
  return c.json({ ok: true, employees: row?.n ?? 0 });
});

app.get('/', (c) => c.redirect('/liff'));

// マッチしないルートは静的アセット(public/)にフォールバック(LIFF/Admin画面はフェーズ3・5で追加)
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
