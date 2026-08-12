#!/usr/bin/env node
/**
 * 네이버 블로그 RSS → index.html 납품실적 타일 자동 주입
 *
 * 왜 빌드 시점에 HTML 을 고치나:
 *   - rss.blog.naver.com 은 CORS 헤더를 주지 않아 브라우저에서 직접 못 읽는다.
 *   - 정적 HTML 에 글 제목이 박혀야 검색엔진이 시공 글을 읽는다 (클라이언트 JS 주입은 색인 이득이 약함).
 *
 * 동작:
 *   1. RSS 를 읽어 item 을 뽑는다.
 *   2. 타일 9칸의 제품군 키워드로 글을 배정한다 (한 글은 한 칸에만).
 *   3. index.html 을 정규화(이전 주입 제거)한 뒤 새 상태를 다시 주입한다 → 몇 번 돌려도 결과 동일.
 *   4. 글이 1건이라도 있으면 body[data-blog-ready] 를 true 로 올려 잠금을 푼다.
 *
 * 사용: node tools/sync-blog.mjs [--dry]
 *   RSS_URL 환경변수로 피드를 바꿔 테스트할 수 있다.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const RSS_URL = process.env.RSS_URL || 'https://rss.blog.naver.com/ybtank1978.xml';
const BLOG_HOME = 'https://blog.naver.com/ybtank1978';
const HTML_PATH = new URL('../index.html', import.meta.url).pathname;
const DRY = process.argv.includes('--dry');

/** 타일 슬롯별 매칭 키워드. 위에서부터 먼저 가져간다 (좁은 키워드가 앞) */
const SLOT_KEYWORDS = {
  1: ['팽창탱크', '팽창 탱크', '팽창수조'],
  2: ['열교환기', '스파이럴', '스파이랄'],
  3: ['온수가열', '온수 가열', '가열기', '급탕'],
  4: ['온수저장', '버퍼탱크', '버퍼 탱크', '축열조'],
  5: ['판넬탱크', '판넬 탱크', '패널탱크', '패널 탱크'],
  6: ['SMC', 'smc'],
  7: ['압력용기', '검사품'],
  8: ['태양열', '축열탱크'],
  9: ['저유조', '유류탱크', '경유탱크', '기름탱크'],
};

const CAP_DEFAULT = '블로그에서 보기 →';
// 제목은 HTML 에 되도록 통째로 남긴다 (검색엔진이 읽는 게 이 연동의 목적).
// 화면에서 넘치는 건 CSS 2줄 클램프가 처리하고, 아래 값은 비정상적으로 긴 제목만 막는 안전선이다.
const CAP_MAX = 46;

// ── RSS 파싱 (의존성 없이 정규식으로. 네이버 피드는 구조가 단순하고 CDATA 로 감싸 나온다) ──

const unwrap = (s) => (s ?? '').replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

function pick(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? unwrap(m[1]) : '';
}

function parseFeed(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, block]) => {
    const description = pick(block, 'description');
    const thumb = description.match(/<img[^>]+src=["']([^"']+)["']/i);
    return {
      title: decode(pick(block, 'title')),
      link: pick(block, 'link').split('?')[0],
      category: decode(pick(block, 'category')),
      pubDate: pick(block, 'pubDate'),
      thumb: thumb ? thumb[1] : '',
      // 제목만으로 못 잡는 글이 있어 본문 발췌·분류까지 합쳐 매칭한다
      haystack: `${decode(pick(block, 'title'))} ${decode(pick(block, 'category'))} ${decode(description).slice(0, 400)}`,
    };
  });
}

/** 슬롯 → 글 배정. 한 글이 여러 칸에 겹치지 않도록 이미 쓴 링크는 건너뛴다 */
function assign(posts) {
  const used = new Set();
  const bySlot = {};
  for (const [slot, keywords] of Object.entries(SLOT_KEYWORDS)) {
    const hit = posts.find((p) => !used.has(p.link) && keywords.some((k) => p.haystack.includes(k)));
    if (hit) {
      used.add(hit.link);
      bySlot[slot] = hit;
    }
  }
  return bySlot;
}

// ── HTML 주입 ──

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const truncate = (s) => (s.length > CAP_MAX ? `${s.slice(0, CAP_MAX - 1)}…` : s);

// index.html 은 포매터가 속성 사이에 줄바꿈을 넣어둔다 (`<span\n  class="cap-ready">`).
// 태그를 찾을 땐 반드시 \s+ 를 써야 한다 — 공백 하나로 고정하면 조용히 아무것도 안 바뀐다.
const CAP_READY_RE = /(<span\s+class="cap-ready"\s*>)([\s\S]*?)(<\/span>)/;
const TILE_MEDIA_RE = /(<span\s+class="tile-media"[^>]*>)/;
const THUMB_RE = /<img\s+class="tile-thumb"[^>]*>/g;

/** 이전 실행이 넣어둔 것을 걷어내 "잠금 상태 원본"으로 되돌린다 (멱등성) */
function normalizeTile(tile) {
  return tile
    .replace(THUMB_RE, '')
    .replace(CAP_READY_RE, `$1${CAP_DEFAULT}$3`)
    .replace(/\s(?:aria-disabled="true"|tabindex="-1"|data-has-post="true")/g, '')
    .replace(/\shref="[^"]*"/, ` href="${BLOG_HOME}"`);
}

function renderTile(tile, post) {
  let out = normalizeTile(tile);

  if (!post) {
    // 이 제품군 글이 아직 없다 → 블로그 홈으로. 잠금 해제 여부는 body 속성이 정한다
    return out;
  }

  out = out.replace(/\shref="[^"]*"/, ` href="${esc(post.link)}"`);
  // 글이 붙은 칸은 제품 스펙 줄을 숨긴다 (제품명 + 글 제목까지 3단이면 모바일에서 넘친다)
  out = out.replace(/(<a\s+class="tile"\s+data-blog-slot="\d")/, '$1 data-has-post="true"');
  out = out.replace(CAP_READY_RE, `$1${esc(truncate(post.title))} →$3`);
  if (post.thumb) {
    // referrerpolicy 필수 — 네이버 CDN 은 외부 도메인 Referer 가 붙으면 403 을 준다
    out = out.replace(
      TILE_MEDIA_RE,
      `$1<img class="tile-thumb" src="${esc(post.thumb)}" referrerpolicy="no-referrer" alt="" loading="lazy" decoding="async">`
    );
  }
  return out;
}

function inject(html, bySlot, hasAnyPost) {
  let out = html.replace(
    /(<body[^>]*\sdata-blog-ready=")[^"]*(")/,
    `$1${hasAnyPost ? 'true' : 'false'}$2`
  );

  for (let slot = 1; slot <= 9; slot += 1) {
    const re = new RegExp(`<a class="tile" data-blog-slot="${slot}"[\\s\\S]*?</a>`);
    const found = out.match(re);
    if (!found) throw new Error(`타일 슬롯 ${slot} 을 index.html 에서 못 찾았다`);
    let tile = renderTile(found[0], bySlot[slot]);
    // 정규식이 안 맞아도 replace 는 조용히 통과한다 → 주입됐는지 직접 확인하고 아니면 실패시킨다
    if (bySlot[slot]) {
      if (!tile.includes(esc(bySlot[slot].link))) throw new Error(`슬롯 ${slot}: 링크 주입 실패`);
      if (tile.includes(CAP_DEFAULT)) throw new Error(`슬롯 ${slot}: 글 제목 주입 실패`);
    }
    // 글이 하나도 없으면 9칸 전부 다시 잠근다
    if (!hasAnyPost) {
      tile = tile.replace(
        /(<a class="tile"[^>]*?)(\s*>)/,
        '$1 aria-disabled="true" tabindex="-1"$2'
      );
    }
    out = out.replace(re, () => tile);
  }
  return out;
}

// ── main ──

const res = await fetch(RSS_URL, { headers: { 'user-agent': 'youngboeng-site-sync/1.0' } });
if (!res.ok) {
  console.error(`RSS 응답 ${res.status} — 중단 (index.html 손대지 않음)`);
  process.exit(1);
}

const posts = parseFeed(await res.text());
const bySlot = assign(posts);
const hasAnyPost = posts.length > 0;

const before = readFileSync(HTML_PATH, 'utf8');
const after = inject(before, bySlot, hasAnyPost);

console.log(`피드 글 ${posts.length}건 · 타일 배정 ${Object.keys(bySlot).length}칸 · 잠금해제 ${hasAnyPost}`);
for (const [slot, post] of Object.entries(bySlot)) console.log(`  ${slot}번 ← ${post.title}`);

if (before === after) {
  console.log('변경 없음');
  process.exit(0);
}
if (DRY) {
  console.log('--dry 라 저장하지 않음');
  process.exit(0);
}
writeFileSync(HTML_PATH, after);
console.log('index.html 갱신');
