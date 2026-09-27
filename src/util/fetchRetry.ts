// 外部API(jinjer・LINEなど)への通信で、一時的なエラー(429・5xx)が起きた場合に
// 少し間隔を空けて再試行する。恒久的なエラー(4xx、429以外)は再試行しても意味が無いため即座に返す。

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retry-Afterヘッダーがあればそれに従い(秒指定を想定)、無ければ指数的に待ち時間を伸ばす(0.5s, 1s, 2s...)。
function delayForAttempt(res: Response, attempt: number): number {
  const retryAfter = res.headers.get('Retry-After');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1000;
  }
  return 500 * 2 ** attempt;
}

export async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 2): Promise<Response> {
  let lastRes: Response | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);
    if (!RETRYABLE_STATUS.has(res.status)) return res;
    lastRes = res;
    if (attempt < maxRetries) await sleep(delayForAttempt(res, attempt));
  }
  return lastRes!;
}
