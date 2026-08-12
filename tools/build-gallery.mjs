#!/usr/bin/env node
/**
 * 납품실적 갤러리 정적 생성기
 *
 * 입력  : content/posts/*.md   (Sveltia CMS 가 /admin 에서 커밋한다)
 *          images/posts/*      (같은 CMS 가 올린 사진)
 * 출력  : gallery/index.html            전체 목록
 *          gallery/<카테고리>/index.html  카테고리 목록
 *          gallery/<글>/index.html        글 상세 (사진 + 본문)
 *          images/posts/thumb/*           카드용 축소본
 *          index.html 의 8칸 타일 링크·잠금 상태 갱신
 *
 * 원칙:
 *   - 글이 0건이어도 성립한다 (빈 갤러리 + 타일 잠금 유지).
 *   - 몇 번 돌려도 결과가 같다. 주입 후 자기검증해서 조용한 실패를 막는다.
 *   - 의존성 0. 이미지 축소는 있으면 쓰고 없으면 건너뛴다.
 *
 * 사용: node tools/build-gallery.mjs [--dry]
 */

import {
  readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync, renameSync, rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname, basename, extname } from 'node:path';
import { PRODUCT_CATEGORIES, COMPANY_CATEGORIES, ALL_CATEGORIES, labelOf, isKnownCategory } from './categories.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const POSTS_DIR = join(ROOT, 'content/posts');
const IMG_DIR = join(ROOT, 'images/posts');
const THUMB_DIR = join(IMG_DIR, 'thumb');
const GALLERY_DIR = join(ROOT, 'gallery');
const INDEX_HTML = join(ROOT, 'index.html');
const DRY = process.argv.includes('--dry');

const MAX_W = 1600; // 원본은 이 폭으로 줄여 저장한다 (레포·전송량)
const THUMB_W = 640;

// ── 유틸 ──

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 카톡에서 온 사진은 한글·공백 파일명이 흔하다. 링크에 쓸 땐 반드시 인코딩한다 */
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

const write = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  const prev = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (prev === content) return false;
  if (!DRY) writeFileSync(path, content);
  return true;
};

// ── frontmatter (필요한 만큼만 파싱. YAML 전체를 지원하지 않는다) ──

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw.trim() };
  const data = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && key) {
      if (!Array.isArray(data[key])) data[key] = [];
      data[key].push(unquote(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    key = kv[1];
    // 빈 값을 배열로 만들면 (cover: 처럼) 뒤에서 문자열 메서드가 터진다
    data[key] = kv[2].trim() === '' ? '' : unquote(kv[2]);
  }
  return { data, body: m[2].trim() };
}

const unquote = (v) => v.replace(/^['"]/, '').replace(/['"]$/, '').trim();

// ── 마크다운 (문단·굵게·목록·링크만. CMS 본문이 이 이상 복잡할 일이 없다) ──

function renderMarkdown(md) {
  const blocks = esc(md)
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        const items = lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('');
        return `<ul>${items}</ul>`;
      }
      const h = block.match(/^(#{2,3})\s+(.*)$/);
      if (h) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    });
  return blocks.join('\n');
}

const inline = (s) =>
  s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

// ── 이미지 축소 (있으면 쓰고 없으면 원본 그대로. 빌드를 멈추지 않는다) ──

function detectResizer() {
  for (const [cmd, args] of [
    ['magick', ['-version']],
    ['convert', ['-version']],
    ['ffmpeg', ['-version']],
  ]) {
    try {
      execFileSync(cmd, args, { stdio: 'ignore' });
      return cmd;
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

function resize(tool, src, dest, width) {
  if (!tool) return false;
  try {
    if (tool === 'ffmpeg') {
      execFileSync(tool, ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale='min(${width},iw)':-2`, dest], {
        stdio: 'ignore',
      });
    } else {
      const argv = tool === 'magick' ? [src] : [src];
      execFileSync(tool, [...argv, '-auto-orient', '-strip', '-resize', `${width}>`, '-quality', '82', dest], {
        stdio: 'ignore',
      });
    }
    return true;
  } catch (e) {
    console.warn(`  이미지 처리 실패(원본 유지): ${basename(src)} — ${e.message.split('\n')[0]}`);
    return false;
  }
}

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

function prepareImages(tool) {
  if (!existsSync(IMG_DIR)) return { thumbs: 0, shrunk: 0 };
  mkdirSync(THUMB_DIR, { recursive: true });
  let thumbs = 0;
  let shrunk = 0;
  for (const name of readdirSync(IMG_DIR)) {
    const src = join(IMG_DIR, name);
    if (!IMAGE_RE.test(name) || !statSync(src).isFile()) continue;

    // 폰 원본은 5MB 를 넘기도 한다. 레포에도 전송량에도 그대로 둘 이유가 없다
    if (!DRY && tool && statSync(src).size > 900 * 1024) {
      const tmp = join(IMG_DIR, `.shrink-${Date.now()}${extname(name)}`);
      if (resize(tool, src, tmp, MAX_W)) {
        renameSync(tmp, src);
        shrunk += 1;
      } else if (existsSync(tmp)) rmSync(tmp, { force: true });
    }

    const thumb = join(THUMB_DIR, name);
    // 같은 파일명으로 사진을 교체하면 썸네일도 다시 만들어야 한다 (캐시가 1년이라 더 그렇다)
    const stale = !existsSync(thumb) || statSync(thumb).mtimeMs < statSync(src).mtimeMs;
    if (stale) {
      if (DRY) thumbs += 1;
      else if (resize(tool, src, thumb, THUMB_W)) thumbs += 1;
    }
  }
  return { thumbs, shrunk };
}

const thumbFor = (publicPath) => {
  const name = basename(publicPath);
  return existsSync(join(THUMB_DIR, name)) ? `/images/posts/thumb/${name}` : publicPath;
};

// ── 글 읽기 ──

function loadPosts() {
  if (!existsSync(POSTS_DIR)) return [];
  return readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const { data, body } = parseFrontmatter(readFileSync(join(POSTS_DIR, file), 'utf8'));
      const images = [data.cover, ...(Array.isArray(data.gallery) ? data.gallery : [])]
        .filter(Boolean)
        .map((p) => (p.startsWith('/') ? p : `/${p}`));
      return {
        id: basename(file, extname(file)),
        title: data.title || basename(file, '.md'),
        category: data.category || '',
        site: data.site || '',
        date: data.date || '',
        cover: images[0] || '',
        images: [...new Set(images)],
        body,
      };
    })
    .filter((p) => {
      if (!isKnownCategory(p.category)) {
        console.warn(`  건너뜀 — 카테고리 '${p.category}' 는 categories.mjs 에 없다: ${p.id}`);
        return false;
      }
      return true;
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.id.localeCompare(b.id));
}

// ── 페이지 템플릿 (사이트 톤 유지: Pretendard · 네이비 · 흰 배경 카드) ──

const HEAD = (title, description, canonical) => `<!DOCTYPE html>
<html lang="ko">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="https://youngboeng.co.kr${canonical}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/images/favicon-32.png" sizes="32x32" type="image/png">
  <meta name="theme-color" content="#1F2E66">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="(주)영보이엔지">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="https://youngboeng.co.kr${canonical}">
  <link rel="stylesheet"
    href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@latest/dist/web/variable/pretendardvariable.css">
  <style>
    :root { --navy:#1F2E66; --gray-900:#1C2233; --gray-600:#5B6378; --gray-400:#9AA1B5; --gray-100:#F4F5F8; --border:#E4E6ED; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:"Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,sans-serif;
           color:var(--gray-900); background:#fff; line-height:1.6; -webkit-text-size-adjust:100%; }
    img { max-width:100%; display:block; }
    a { color:inherit; text-decoration:none; }
    .wrap { max-width:1180px; margin:0 auto; padding:0 20px; }
    .topbar { position:sticky; top:0; z-index:10; display:flex; align-items:center; justify-content:space-between;
              padding:14px 20px; background:rgba(255,255,255,.94); backdrop-filter:blur(6px); border-bottom:1px solid var(--border); }
    .topbar-logo { display:flex; align-items:center; gap:10px; font-weight:700; font-size:17px; letter-spacing:-.02em; }
    .topbar-logo img { height:34px; width:auto; }
    .topbar-phone { font-weight:700; font-size:14.5px; color:var(--navy); white-space:nowrap; }
    .page-head { padding:44px 0 22px; }
    .page-head h1 { margin:0; font-size:28px; font-weight:800; letter-spacing:-.03em; }
    .page-head p { margin:8px 0 0; color:var(--gray-600); font-size:15px; }
    .crumb { font-size:13.5px; color:var(--gray-400); margin-bottom:10px; }
    .crumb a:hover { color:var(--navy); }
    .chips { display:flex; flex-wrap:wrap; gap:8px; padding:6px 0 28px; }
    .chip { border:1px solid var(--border); border-radius:999px; padding:7px 14px; font-size:13.5px; font-weight:600; color:var(--gray-600); }
    .chip[aria-current="page"] { background:var(--navy); border-color:var(--navy); color:#fff; }
    .cards { display:grid; grid-template-columns:1fr; gap:24px; padding-bottom:64px; }
    .card-media { aspect-ratio:4/3; background:var(--gray-100); overflow:hidden; }
    .card-media img { width:100%; height:100%; object-fit:cover; }
    .card-body { background:var(--gray-100); padding:16px 18px; }
    .card-title { font-size:15.5px; font-weight:600; letter-spacing:-.02em; }
    .card-meta { margin-top:5px; font-size:13px; color:var(--gray-600); }
    .empty { padding:60px 0 90px; color:var(--gray-600); font-size:15px; }
    .post-cover { margin:0 0 26px; background:var(--gray-100); }
    .post-cover img { width:100%; max-height:620px; object-fit:cover; }
    .post-body { font-size:16px; max-width:760px; }
    .post-body p { margin:0 0 16px; }
    .post-body ul { margin:0 0 16px 18px; padding:0; }
    .post-body h2 { font-size:20px; margin:28px 0 10px; }
    .post-body h3 { font-size:17px; margin:22px 0 8px; }
    .shots { display:grid; grid-template-columns:1fr; gap:14px; margin:30px 0 60px; }
    .foot { border-top:1px solid var(--border); padding:26px 0 60px; font-size:13.5px; color:var(--gray-600); }
    .foot a { font-weight:600; color:var(--navy); }
    @media (min-width:640px) {
      .cards { grid-template-columns:repeat(2,1fr); gap:28px; }
      .shots { grid-template-columns:repeat(2,1fr); }
      .page-head h1 { font-size:34px; }
    }
    @media (min-width:1024px) {
      .cards { grid-template-columns:repeat(3,1fr); }
      .page-head { padding:56px 0 26px; }
    }
  </style>
</head>

<body>
  <header class="topbar">
    <a class="topbar-logo" href="/"><img src="/images/logo-mark-navy.svg" alt=""><span>(주)영보이엔지</span></a>
    <a class="topbar-phone" href="tel:031-764-0248">031-764-0248</a>
  </header>
`;

const FOOT = `  <footer class="foot">
    <div class="wrap">(주)영보이엔지 · 경기도 광주시 곤지암읍 광여로99번길 7 · <a href="tel:031-764-0248">031-764-0248</a> ·
      <a href="/">홈으로</a></div>
  </footer>
</body>

</html>
`;

const chips = (current) => {
  const one = (href, label, slug) =>
    `<a class="chip" href="${href}"${slug === current ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  return `      <nav class="chips">
${one('/gallery/', '전체', 'all')}
${PRODUCT_CATEGORIES.map((c) => one(`/gallery/${c.slug}/`, c.label, c.slug)).join('\n')}
${COMPANY_CATEGORIES.map((c) => one(`/gallery/${c.slug}/`, c.label, c.slug)).join('\n')}
      </nav>`;
};

const card = (post) => `        <a class="card" href="/gallery/${encPath(post.id)}/">
          <div class="card-media">${
            post.cover ? `<img src="${encPath(thumbFor(post.cover))}" alt="${esc(post.title)}" loading="lazy">` : ''
          }</div>
          <div class="card-body">
            <div class="card-title">${esc(post.title)}</div>
            <div class="card-meta">${[labelOf(post.category), post.site, post.date].filter(Boolean).map(esc).join(' · ')}</div>
          </div>
        </a>`;

function listPage({ title, description, canonical, current, posts, lead }) {
  const body = posts.length
    ? `      <div class="cards">\n${posts.map(card).join('\n')}\n      </div>`
    : `      <p class="empty">아직 등록된 시공사례가 없습니다. 준비되는 대로 올리겠습니다.<br>
        문의는 <a href="tel:031-764-0248" style="color:var(--navy);font-weight:600">031-764-0248</a> 로 주십시오.</p>`;
  return `${HEAD(title, description, canonical)}  <main class="wrap">
    <div class="page-head">
      <div class="crumb"><a href="/">홈</a> › <a href="/gallery/">납품실적</a></div>
      <h1>${esc(lead || title)}</h1>
      <p>${esc(description)}</p>
    </div>
${chips(current)}
${body}
  </main>
${FOOT}`;
}

function postPage(post) {
  const shots = post.images
    .slice(1)
    .map((src) => `      <img src="${encPath(src)}" alt="${esc(post.title)}" loading="lazy">`)
    .join('\n');
  const meta = [labelOf(post.category), post.site, post.date].filter(Boolean).join(' · ');
  const summary = post.body.replace(/\s+/g, ' ').slice(0, 110) || meta;
  return `${HEAD(`${post.title} — (주)영보이엔지`, summary, `/gallery/${post.id}/`)}  <main class="wrap">
    <div class="page-head">
      <div class="crumb"><a href="/">홈</a> › <a href="/gallery/">납품실적</a> ›
        <a href="/gallery/${encPath(post.category)}/">${esc(labelOf(post.category))}</a></div>
      <h1>${esc(post.title)}</h1>
      <p>${esc(meta)}</p>
    </div>
${post.cover ? `    <figure class="post-cover"><img src="${encPath(post.cover)}" alt="${esc(post.title)}"></figure>` : ''}
    <div class="post-body">
${renderMarkdown(post.body)}
    </div>
${shots ? `    <div class="shots">\n${shots}\n    </div>` : ''}
  </main>
${FOOT}`;
}

// ── index.html 8칸 타일 주입 ──

const TILE_RE = (slot) => new RegExp(`<a\\s+class="tile"\\s+data-blog-slot="${slot}"[\\s\\S]*?</a>`);
const CAP_READY_RE = /(<span\s+class="cap-ready"\s*>)([\s\S]*?)(<\/span>)/;
/** 글이 없을 때 캡션이 되돌아갈 자리. 건수 문구가 영구 잔류하는 것을 막는다 */
const CAP_DEFAULT = { product: '시공사례 보기 →', more: '전체 보기 →' };

function injectTiles(html, countBySlug, total) {
  let out = html.replace(
    /(<body[^>]*\sdata-blog-ready=")[^"]*(")/,
    (_, open, close) => `${open}${total > 0 ? 'true' : 'false'}${close}`
  );

  const targets = [
    ...PRODUCT_CATEGORIES.map((c) => ({ slot: c.slot, href: `/gallery/${c.slug}/`, n: countBySlug[c.slug] || 0 })),
    { slot: 8, href: '/gallery/', n: total }, // 더보기
  ];

  for (const { slot, href, n } of targets) {
    const re = TILE_RE(slot);
    const found = out.match(re);
    if (!found) throw new Error(`타일 슬롯 ${slot} 을 index.html 에서 못 찾았다`);

    let tile = found[0]
      .replace(/\shref="[^"]*"/, () => ` href="${href}"`)
      .replace(/\s(?:aria-disabled="true"|tabindex="-1"|target="_blank"|rel="noopener noreferrer")/g, '');

    const caption = slot === 8 ? CAP_DEFAULT.more : n === 0 ? CAP_DEFAULT.product : `시공사례 ${n}건 →`;
    tile = tile.replace(CAP_READY_RE, (_, o, __, c) => `${o}${caption}${c}`);

    if (n === 0) {
      // 이 칸에 보여줄 게 없다 → 잠금 유지
      tile = tile.replace(
        /(<a\s+class="tile"[^>]*?)(\s*>)/,
        (_, open, close) => `${open} aria-disabled="true" tabindex="-1"${close}`
      );
    }

    // replace 는 안 맞아도 조용히 통과한다 → 주입됐는지 직접 확인한다
    if (!tile.includes(`href="${href}"`)) throw new Error(`슬롯 ${slot}: 링크 주입 실패`);
    if (n > 0 && tile.includes('aria-disabled')) throw new Error(`슬롯 ${slot}: 잠금 해제 실패`);
    if (n === 0 && !tile.includes('aria-disabled')) throw new Error(`슬롯 ${slot}: 잠금 유지 실패`);
    if (!tile.includes(`>${caption}<`)) throw new Error(`슬롯 ${slot}: 캡션 주입 실패 (기대 '${caption}')`);

    out = out.replace(re, () => tile);
  }
  return out;
}

// ── main ──

const tool = detectResizer();
console.log(tool ? `이미지 축소: ${tool}` : '이미지 축소 도구 없음 — 원본을 그대로 쓴다');

const { thumbs, shrunk } = prepareImages(tool);
const posts = loadPosts();
const countBySlug = Object.fromEntries(
  ALL_CATEGORIES.map((c) => [c.slug, posts.filter((p) => p.category === c.slug).length])
);

let changed = 0;

changed += write(
  join(GALLERY_DIR, 'index.html'),
  listPage({
    title: '납품실적 — (주)영보이엔지',
    description: '현장에 직접 제작·설치한 탱크와 열교환기, 그리고 공장·자재 사진입니다.',
    canonical: '/gallery/',
    current: 'all',
    posts,
    lead: '납품실적',
  })
) ? 1 : 0;

for (const c of ALL_CATEGORIES) {
  const list = posts.filter((p) => p.category === c.slug);
  changed += write(
    join(GALLERY_DIR, c.slug, 'index.html'),
    listPage({
      title: `${c.label} 납품실적 — (주)영보이엔지`,
      description: `${c.label} 제작·설치 사례입니다.`,
      canonical: `/gallery/${c.slug}/`,
      current: c.slug,
      posts: list,
      lead: c.label,
    })
  ) ? 1 : 0;
}

for (const post of posts) {
  changed += write(join(GALLERY_DIR, post.id, 'index.html'), postPage(post)) ? 1 : 0;
}

// sitemap — 홈·개인정보 + 갤러리 전체
// 글 날짜가 아니라 빌드 날짜다 — 옛 현장을 과거 날짜로 올렸다고 홈 lastmod 가 역행하면 안 된다
const today = new Date().toISOString().slice(0, 10);
const urls = [
  { loc: '/', pri: '1.0', mod: today },
  { loc: '/privacy', pri: '0.3', mod: '2026-07-31' },
  { loc: '/gallery/', pri: '0.8', mod: today },
  // 글 없는 카테고리는 넣지 않는다 (같은 '준비 중' 문구 12장을 색인에 밀어넣는 꼴이 된다)
  ...ALL_CATEGORIES.filter((c) => countBySlug[c.slug] > 0).map((c) => ({
    loc: `/gallery/${c.slug}/`,
    pri: '0.6',
    mod: today,
  })),
  ...posts.map((p) => ({ loc: `/gallery/${encPath(p.id)}/`, pri: '0.7', mod: p.date || today })),
];
changed += write(
  join(ROOT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url>\n    <loc>https://youngboeng.co.kr${u.loc}</loc>\n    <lastmod>${u.mod}</lastmod>\n` +
          `    <changefreq>monthly</changefreq>\n    <priority>${u.pri}</priority>\n  </url>`
      )
      .join('\n') +
    `\n</urlset>\n`
) ? 1 : 0;

// 지운 글의 페이지가 200 으로 계속 살아 있으면 안 된다
const keep = new Set([...ALL_CATEGORIES.map((c) => c.slug), ...posts.map((p) => p.id)]);
if (existsSync(GALLERY_DIR)) {
  for (const name of readdirSync(GALLERY_DIR)) {
    const dir = join(GALLERY_DIR, name);
    if (!statSync(dir).isDirectory() || keep.has(name)) continue;
    if (!DRY) rmSync(dir, { recursive: true, force: true });
    console.log(`  삭제된 글 정리: gallery/${name}/`);
    changed += 1;
  }
}

const before = readFileSync(INDEX_HTML, 'utf8');
const after = injectTiles(before, countBySlug, posts.length);
if (before !== after) {
  if (!DRY) writeFileSync(INDEX_HTML, after);
  changed += 1;
}

console.log(
  `글 ${posts.length}건 · 원본 축소 ${shrunk}장 · 썸네일 ${thumbs}장 · 페이지 ${1 + ALL_CATEGORIES.length + posts.length}개 · 변경 ${changed}건${
    DRY ? ' (--dry, 저장 안 함)' : ''
  }`
);
for (const c of ALL_CATEGORIES) {
  if (countBySlug[c.slug]) console.log(`  ${c.label}: ${countBySlug[c.slug]}건`);
}
