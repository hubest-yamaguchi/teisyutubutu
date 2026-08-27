// Auth.gs の移植。GroupsAppによる判定を廃止し、Cloudflare Access(Zero Trust)で本人確認、
// 認可はD1のadminsテーブルで行う(src/db/admins.ts)。
//
// Cloudflare AccessをWorkerの手前に構成すると、検証済みのJWTが Cf-Access-Jwt-Assertion ヘッダーで
// 渡ってくる。ここではそのJWTをAccessの公開鍵(JWKS)で改めて検証し、なりすまし(workers.dev直アクセス等で
// Accessをバイパスされるケース)を防ぐ。

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from './bindings';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string) {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

// 検証に成功したら管理者のメールアドレスを返す。失敗/未設定なら null。
export async function getVerifiedAdminEmail(request: Request, env: Env): Promise<string | null> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return null;

  try {
    const jwks = getJwks(env.CF_ACCESS_TEAM_DOMAIN);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://${env.CF_ACCESS_TEAM_DOMAIN}`,
      audience: env.CF_ACCESS_AUD
    });
    const email = typeof payload.email === 'string' ? payload.email : null;
    return email;
  } catch (e) {
    console.log('Access JWT verification failed:', e);
    return null;
  }
}
