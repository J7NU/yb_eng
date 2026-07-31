/**
 * 공사 중 접근 잠금 (HTTP Basic 인증)
 *
 * 사이트 완성 전까지 지정한 사용자만 열람할 수 있게 한다.
 * 공개 시점에 이 파일과 wrangler.jsonc 의 main/run_worker_first 만 지우면
 * 다시 순수 정적 자산 배포로 돌아간다.
 *
 * 자격 정보는 코드에 두지 않는다 — Cloudflare 시크릿(BASIC_AUTH_USER/PASS)에서 읽는다.
 */

const REALM = 'YEONGBO ENGINEERING — 공사 중';

/** 타이밍 공격을 피하기 위해 길이와 무관하게 전체를 비교한다 */
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function unauthorized() {
  return new Response('인증이 필요합니다.', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export default {
  async fetch(request, env) {
    const header = request.headers.get('Authorization') || '';
    if (!header.startsWith('Basic ')) return unauthorized();

    let decoded;
    try {
      decoded = atob(header.slice(6));
    } catch {
      return unauthorized();
    }

    // 비밀번호에 콜론이 들어갈 수 있으므로 첫 콜론에서만 나눈다
    const sep = decoded.indexOf(':');
    if (sep < 0) return unauthorized();
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);

    const okUser = safeEqual(user, env.BASIC_AUTH_USER || '');
    const okPass = safeEqual(pass, env.BASIC_AUTH_PASS || '');
    if (!okUser || !okPass) return unauthorized();

    // 통과 — 정적 자산을 그대로 내보낸다.
    // 잠금 중에는 공용 캐시 저장을 금지한다. _headers 의 1년 캐시 규칙이
    // 그대로 적용되면 보호 대상 파일이 엣지에 공개 사본으로 남아, 인증 없이도
    // 캐시 적중으로 응답돼 잠금이 사실상 뚫린다.
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'private, no-store, max-age=0');
    out.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return out;
  },
};
