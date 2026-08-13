#!/usr/bin/env node
/**
 * 납품실적 갤러리 정적 생성기
 *
 * 입력  : content/posts/*.md   (Sveltia CMS 가 /admin 에서 커밋한다)
 *          images/posts/*      (같은 CMS 가 올린 사진)
 * 출력  : gallery/index.html            전체 목록
 *          gallery/<카테고리>/index.html  카테고리 목록
 *          gallery/<글>/index.html        글 상세 (사진 + 본문)
 *          images/thumb/*           카드용 축소본
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
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname, basename, extname } from 'node:path';
import { PRODUCT_CATEGORIES, COMPANY_CATEGORIES, ALL_CATEGORIES, labelOf, isKnownCategory } from './categories.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const POSTS_DIR = join(ROOT, 'content/posts');
const IMG_DIR = join(ROOT, 'images/posts');
// 썸네일은 원본과 캐시 정책이 정반대라(해시 파일명 → 영구 캐시) 경로를 분리해 둔다.
// images/posts/ 안에 두면 Cloudflare _headers 가 두 규칙을 병합해 영구 캐시가 깎인다
const THUMB_DIR = join(ROOT, 'images/thumb');
const GALLERY_DIR = join(ROOT, 'gallery');
const INDEX_HTML = join(ROOT, 'index.html');
const DRY = process.argv.includes('--dry');

const MAX_W = 1600; // 원본은 이 폭으로 줄여 저장한다 (레포·전송량)
const THUMB_W = 640;

// ── 유틸 ──

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 파일명에 리터럴 % 가 있으면 decodeURIComponent 가 던진다. 빌드를 세우지 않는다 */
const safeDecode = (v) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

/** 카톡에서 온 사진은 한글·공백 파일명이 흔하다. 링크에 쓸 땐 반드시 인코딩한다 */
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

/** 사이트 안 링크용 — 경로만 인코딩하고 #앵커·?쿼리는 살린다 (/#contact 가 /%23contact 가 되면 안 된다) */
const encHref = (href) => {
  const m = href.match(/^([^#?]*)([#?].*)?$/);
  return encPath(m[1]) + (m[2] || '');
};

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
  // 블록 단위로만 판정하면 '## 제목' 다음 줄에 본문이 이어질 때 통째로 문단이 된다.
  // 줄 단위로 훑으면서 소제목·목록·문단을 각각 닫는다.
  const out = [];
  let para = [];
  let list = [];
  let listOrdered = false;
  let quote = [];
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`);
    quote = [];
  };
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list.length) {
      const tag = listOrdered ? 'ol' : 'ul';
      out.push(`<${tag}>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</${tag}>`);
    }
    list = [];
    listOrdered = false;
  };

  for (const raw of esc(md).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushList();
      flushQuote();
      flushPara();
      continue;
    }
    // '# 제목'(h1)도 받는다. 페이지 h1 은 글 제목이 이미 쓰므로 본문 최상위는 h2 로 낮춘다
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      flushQuote();
      flushPara();
      // 페이지 h1 은 글 제목이 쓰므로 본문 제목은 한 단계씩 내린다 (# → h2, ## → h3)
      const level = Math.min(h[1].length + 1, 4);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    // esc() 를 먼저 태우므로 인용 부호는 이 시점에 '&gt;' 다
    const bq = line.match(/^\s*&gt;\s?(.*)$/);
    if (bq) {
      flushList();
      flushPara();
      quote.push(bq[1]);
      continue;
    }
    if (quote.length) flushQuote();
    const li = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (li) {
      flushQuote();
      flushPara();
      // 순서 목록(1. 2. 3.)과 글머리표를 같은 목록으로 모은다. 시공 순서를 번호로 쓰는 일이 많다
      if (!list.length) listOrdered = /^\s*\d+\./.test(line);
      list.push(li[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushList();
  flushQuote();
  flushPara();
  return out.join('\n');
}

/** 검색 스니펫·공유 미리보기용 순수 텍스트. 마크다운 기호가 그대로 나가면 안 된다 */
const plainText = (md) =>
  md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * 인라인 마크다운.
 * 이미지·링크·코드를 먼저 뽑아 자리표시자로 치워두고 강조를 적용한다.
 * 순서를 안 지키면 파일명 속 밑줄이 강조로 먹혀 src 안에 <em> 이 박힌다
 * (한글은 \w 가 아니라서 '탱크_설치_1.jpg' 가 그대로 걸린다).
 */
const inline = (raw) => {
  const slots = [];
  const hold = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  const imgSrc = (src) => (/^https?:\/\//.test(src) ? src : encPath(src.startsWith('/') ? src : `/${src}`));

  const withEmphasis = raw
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) =>
      hold(`<img class="body-img" src="${imgSrc(src.trim())}" alt="${alt}" loading="lazy">`)
    )
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, href) =>
      hold(`<a href="${href}" target="_blank" rel="noopener noreferrer">${t}</a>`)
    )
    .replace(/\[([^\]]+)\]\((\/[^)]*)\)/g, (_, t, href) => hold(`<a href="${encHref(href.trim())}">${t}</a>`))
    .replace(/`([^`]+)`/g, (_, c) => hold(`<code>${c}</code>`))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // 단어 중간의 * _ 는 강조가 아니다 ('5,000ℓ*2기', '탱크_설치_1')
    .replace(/(^|[\s(])\*(\S[^*\n]*?\S|\S)\*(?=[\s).,!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_(\S[^_\n]*?\S|\S)_(?=[\s).,!?]|$)/g, '$1<em>$2</em>');

  return withEmphasis.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[i]);
};

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

/** 가로·세로(px). 못 재면 {w:0,h:0} — 축소를 건너뛴다 */
function imageSize(tool, src) {
  try {
    if (tool === 'ffmpeg') {
      const out = execFileSync(
        'ffprobe',
        ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', src],
        { encoding: 'utf8' }
      ).trim();
      const [w, h] = out.split('x').map((n) => parseInt(n, 10) || 0);
      return { w, h };
    }
    const [bin, argv] =
      tool === 'magick'
        ? ['magick', ['identify', '-format', '%wx%h', src]]
        : ['identify', ['-format', '%wx%h', src]];
    const [w, h] = execFileSync(bin, argv, { encoding: 'utf8' }).trim().split('x').map((n) => parseInt(n, 10) || 0);
    return { w, h };
  } catch {
    return { w: 0, h: 0 };
  }
}

function resize(tool, src, dest, width) {
  if (!tool) return false;
  try {
    if (tool === 'ffmpeg') {
      execFileSync(tool, ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale='min(${width},iw)':'min(${width},ih)':force_original_aspect_ratio=decrease`, dest], {
        stdio: 'ignore',
      });
    } else {
      execFileSync(tool, [src, '-auto-orient', '-strip', '-resize', `${width}x${width}>`, '-quality', '82', dest], {
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

/**
 * 썸네일 파일명에 원본 내용 해시를 박는다.
 * 같은 파일명으로 사진을 갈아끼워도 URL 이 바뀌므로 _headers 의 1년 immutable 캐시에 물리지 않고,
 * mtime 비교(CI 체크아웃에서 무의미하다)에 의존하지 않는다.
 */
const thumbName = (src) => {
  const h = createHash('sha1').update(readFileSync(src)).digest('hex').slice(0, 8);
  const name = basename(src);
  const ext = extname(name);
  return `${basename(name, ext)}.${h}${ext}`;
};

function prepareImages(tool) {
  if (!existsSync(IMG_DIR)) return { thumbs: 0, shrunk: 0 };
  mkdirSync(THUMB_DIR, { recursive: true });
  let thumbs = 0;
  let shrunk = 0;
  const keepThumbs = new Set();
  for (const name of readdirSync(IMG_DIR)) {
    const src = join(IMG_DIR, name);
    if (name.startsWith('.') || !IMAGE_RE.test(name) || !statSync(src).isFile()) continue;

    // 폰 원본은 5MB 를 넘기도 한다. 레포에도 전송량에도 그대로 둘 이유가 없다.
    // 판정은 '용량'이 아니라 '가로폭'이다 — 용량 기준이면 축소 후에도 900KB 를 넘는 사진이
    // 매 빌드마다 다시 축소·재커밋되는 루프에 빠진다
    const dim = imageSize(tool, src);
    if (!DRY && tool && !dim.w) {
      console.log(`  ⚠ 크기를 못 재 축소를 건너뛴다: ${name}`);
    }
    if (!DRY && tool && (dim.w > MAX_W || dim.h > MAX_W)) {
      const tmp = join(IMG_DIR, `.shrink-${Date.now()}${extname(name)}`);
      if (resize(tool, src, tmp, MAX_W)) {
        renameSync(tmp, src);
        shrunk += 1;
      } else if (existsSync(tmp)) rmSync(tmp, { force: true });
    }

    const thumb = join(THUMB_DIR, thumbName(src));
    keepThumbs.add(basename(thumb));
    if (!existsSync(thumb)) {
      if (DRY) thumbs += 1;
      else if (resize(tool, src, thumb, THUMB_W)) thumbs += 1;
    }
  }

  // 내용이 바뀌면 옛 해시 썸네일은 아무도 안 쓴다 → 쌓이지 않게 지운다
  let pruned = 0;
  for (const f of readdirSync(THUMB_DIR)) {
    if (!IMAGE_RE.test(f) || keepThumbs.has(f)) continue;
    if (!DRY) rmSync(join(THUMB_DIR, f), { force: true });
    pruned += 1;
  }
  return { thumbs, shrunk, pruned };
}

/** 원본이 실제로 있는지 — 없으면 깨진 <img> 를 내보내지 않는다 */
const imageExists = (publicPath) => existsSync(join(ROOT, safeDecode(publicPath).replace(/^\//, '')));

const thumbFor = (publicPath) => {
  const src = join(ROOT, publicPath.replace(/^\//, ''));
  if (!existsSync(src)) return publicPath;
  const name = thumbName(src);
  return existsSync(join(THUMB_DIR, name)) ? `/images/thumb/${name}` : publicPath;
};

// ── 카테고리 정합 검사 ──

/**
 * categories.mjs 와 admin/config.yml 이 어긋나면 그 분류의 글이 갤러리에서 조용히 사라진다.
 * 조용한 유실 대신 빌드를 실패시킨다.
 */
function assertCategoriesInSync() {
  const cfgPath = join(ROOT, 'admin/config.yml');
  if (!existsSync(cfgPath)) return;
  const cfg = readFileSync(cfgPath, 'utf8');
  const block = cfg.match(/name:\s*category[\s\S]*?options:\n([\s\S]*?)(?=\n {6}- label:|\n {4}- name:|$)/);
  if (!block) {
    console.warn('  admin/config.yml 에서 category options 를 못 찾았다 — 정합 검사 건너뜀');
    return;
  }
  const inConfig = [...block[1].matchAll(/value:\s*([A-Za-z0-9-]+)/g)].map((m) => m[1]);
  const inCode = ALL_CATEGORIES.map((c) => c.slug);
  const onlyCode = inCode.filter((v) => !inConfig.includes(v));
  const onlyCfg = inConfig.filter((v) => !inCode.includes(v));
  if (onlyCode.length || onlyCfg.length) {
    throw new Error(
      '카테고리 불일치 — categories.mjs 와 admin/config.yml 을 맞춰라\n' +
        `  코드에만: ${onlyCode.join(', ') || '없음'}\n  설정에만: ${onlyCfg.join(', ') || '없음'}`
    );
  }
}

// ── 글 읽기 ──

const skipped = [];

function loadPosts() {
  if (!existsSync(POSTS_DIR)) return [];
  return readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const { data, body } = parseFrontmatter(readFileSync(join(POSTS_DIR, file), 'utf8'));
      const images = [data.cover, ...(Array.isArray(data.gallery) ? data.gallery : [])]
        .filter(Boolean)
        .map((p) => (p.startsWith('/') ? p : `/${p}`));
      const existing = images.filter(imageExists);
      if (existing.length !== images.length) {
        console.log(
          `::warning file=content/posts/${basename(file)}::참조한 사진 ${images.length - existing.length}장이 없다 — 그 사진은 건너뛴다`
        );
      }
      return {
        id: basename(file, extname(file)),
        title: data.title || basename(file, '.md'),
        category: data.category || '',
        site: data.site || '',
        date: data.date || '',
        cover: existing[0] || '',
        images: [...new Set(existing)],
        body,
      };
    })
    .filter((p) => {
      if (!isKnownCategory(p.category)) {
        // 이 글만 빼고 나머지는 계속 발행한다. 여기서 throw 하면 글 하나 때문에
        // 이후 모든 /admin 저장이 발행되지 않는다 (발행 파이프라인 전체 정지).
        // 대신 Actions 로그에 error 주석으로 남겨 조용한 유실이 되지 않게 한다
        console.log(
          `::error file=content/posts/${p.id}.md::분류 '${p.category}' 가 categories.mjs 에 없어 이 글은 갤러리에 안 나온다. ` +
            `허용값: ${ALL_CATEGORIES.map((c) => c.slug).join(', ')}`
        );
        skipped.push(p.id);
        return false;
      }
      return true;
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.id.localeCompare(b.id));
}

// ── 페이지 템플릿 (사이트 톤 유지: Pretendard · 네이비 · 흰 배경 카드) ──

const HEAD = (title, description, canonical, { image = '/images/og-cover-2026.png', noindex = false } = {}) => `<!DOCTYPE html>
<html lang="ko">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">${noindex ? '\n  <meta name="robots" content="noindex, follow">' : ''}
  <link rel="canonical" href="https://youngboeng.co.kr${canonical}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/images/favicon-32.png" sizes="32x32" type="image/png">
  <meta name="theme-color" content="#1F2E66">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="(주)영보이엔지">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="https://youngboeng.co.kr${canonical}">
  <meta property="og:image" content="https://youngboeng.co.kr${encPath(image)}">
  <meta name="twitter:card" content="summary_large_image">
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
    .post-body ol { margin:0 0 16px 20px; padding:0; }
    .post-body blockquote { margin:0 0 16px; padding:10px 16px; border-left:3px solid var(--navy);
      background:var(--gray-100); color:var(--gray-600); }
    .post-body code { background:var(--gray-100); padding:1px 5px; border-radius:4px; font-size:14px; }
    .body-img { width:100%; height:auto; margin:18px 0; background:var(--gray-100); }
    .shots { display:grid; grid-template-columns:1fr; gap:14px; margin:30px 0 40px; }
    .post-cta { margin:36px 0 60px; padding:24px; border-top:2px solid var(--navy); background:var(--gray-100); max-width:760px; }
    .cta-lead { margin:0; font-size:16px; font-weight:700; color:var(--navy); letter-spacing:-.02em; }
    .cta-sub { margin:4px 0 14px; font-size:14px; color:var(--gray-600); word-break:keep-all; }
    .cta-contact { display:flex; flex-direction:column; gap:4px; }
    .cta-tel { font-size:19px; font-weight:800; color:var(--navy); letter-spacing:.01em; }
    .cta-line { font-size:13.5px; color:var(--gray-600); word-break:keep-all; }
    .cta-note { margin:14px 0 0; font-size:13.5px; color:var(--gray-600); }
    .cta-note a { font-weight:700; color:var(--navy); }
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
  const head = HEAD(title, description, canonical, {
    image: posts[0]?.cover || '/images/og-cover-2026.png',
    noindex: posts.length === 0,
  });
  const body = posts.length
    ? `      <div class="cards">\n${posts.map(card).join('\n')}\n      </div>`
    : `      <p class="empty">아직 등록된 시공사례가 없습니다. 준비되는 대로 올리겠습니다.<br>
        문의는 <a href="tel:031-764-0248" style="color:var(--navy);font-weight:600">031-764-0248</a> 로 주십시오.</p>`;
  return `${head}  <main class="wrap">
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
  const summary = plainText(post.body).slice(0, 110) || meta;
  return `${HEAD(`${post.title} — (주)영보이엔지`, summary, `/gallery/${encPath(post.id)}/`, {
    image: post.cover || '/images/og-cover-2026.png',
  })}  <main class="wrap">
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
${POST_SIGNATURE}
  </main>
${FOOT}`;
}

/**
 * 글 끝에 자동으로 붙는 문의 블록.
 * 글마다 손으로 붙이면 언젠가 빠뜨리고, 전화번호가 바뀌면 전 글을 고쳐야 한다.
 * 문구를 바꾸려면 여기만 고치면 모든 시공사례에 한 번에 반영된다.
 */
const POST_SIGNATURE = `    <section class="post-cta">
      <p class="cta-lead">(주)영보이엔지 · 1981년부터 45년</p>
      <p class="cta-sub">탱크·열교환기 설계부터 제작·현장 설치까지</p>
      <div class="cta-contact">
        <a class="cta-tel" href="tel:031-764-0248">TEL 031-764-0248</a>
        <span class="cta-line">FAX 031-764-0249 · 경기도 광주시 곤지암읍 광여로99번길 7</span>
      </div>
      <p class="cta-note">도면 주시면 견적 회신드립니다. <a href="/#contact">견적 문의하기 →</a></p>
    </section>`;

// ── index.html 8칸 타일 주입 ──

const TILE_RE = (slot) => new RegExp(`<a\\s+class="tile"\\s+data-blog-slot="${slot}"[\\s\\S]*?</a>`);
const CAP_READY_RE = /(<span\s+class="cap-ready"\s*>)([\s\S]*?)(<\/span>)/;
/** 타일 캡션 문구. 건수는 주입 때 만들고, 아래 둘은 고정 문구다 */
const CAP_EMPTY = '준비 중';
const CAP_MORE = '전체 보기 →';

function injectTiles(html, countBySlug, total) {
  const flag = total > 0 ? 'true' : 'false';
  let out = html.replace(
    /(<body[^>]*\sdata-gallery-ready=")[^"]*(")/,
    (_, open, close) => `${open}${flag}${close}`
  );
  // 타일과 똑같이 검증한다 — replace 는 정규식이 안 맞아도 조용히 원본을 돌려준다
  if (!new RegExp(`<body[^>]*\\sdata-gallery-ready="${flag}"`).test(out)) {
    throw new Error(`data-gallery-ready="${flag}" 주입 실패 — <body> 태그 형태가 바뀐 것 같다`);
  }

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

    // 잠금이 풀리면 cap-soon 이 숨으므로, 0건 칸의 cap-ready 에 '준비 중' 을 넣어야
    // 눌리지도 않는 칸이 '시공사례 보기 →' 로 클릭을 유도하지 않는다
    const caption = n === 0 ? CAP_EMPTY : slot === 8 ? CAP_MORE : `시공사례 ${n}건 →`;
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

assertCategoriesInSync();
const { thumbs, shrunk, pruned } = prepareImages(tool);
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
  // 글이 0건이면 /gallery/ 는 noindex 라, sitemap 에 넣으면 '제출된 URL이 noindex' 오류가 난다
  ...(posts.length ? [{ loc: '/gallery/', pri: '0.8', mod: today }] : []),
  // 글 없는 카테고리는 넣지 않는다 (같은 '준비 중' 문구 12장을 색인에 밀어넣는 꼴이 된다)
  ...ALL_CATEGORIES.filter((c) => countBySlug[c.slug] > 0).map((c) => ({
    loc: `/gallery/${c.slug}/`,
    pri: '0.6',
    mod: today,
  })),
  ...posts.map((p) => ({ loc: `/gallery/${encPath(p.id)}/`, pri: '0.7', mod: today })),
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

// 글에서 안 쓰는 업로드 사진은 알려만 준다. 자동 삭제하면 CMS 가 글 저장 전에 먼저 올린
// 사진을 지워버릴 수 있다 (글 작성 중 이탈 시 복구 불가)
if (existsSync(IMG_DIR)) {
  const used = new Set(
    posts.flatMap((p) => [
      ...p.images.map((i) => basename(i)),
      // 본문 마크다운에 박은 사진도 쓰이는 것이다
      ...[...p.body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => basename(safeDecode(m[1].trim()))),
    ])
  );
  const orphans = readdirSync(IMG_DIR).filter(
    (f) => IMAGE_RE.test(f) && statSync(join(IMG_DIR, f)).isFile() && !used.has(f)
  );
  if (orphans.length) {
    console.log(`  글에서 안 쓰는 사진 ${orphans.length}장 (지우려면 직접): ${orphans.slice(0, 5).join(', ')}`);
  }
}

const before = readFileSync(INDEX_HTML, 'utf8');
const after = injectTiles(before, countBySlug, posts.length);
if (before !== after) {
  if (!DRY) writeFileSync(INDEX_HTML, after);
  changed += 1;
}

if (skipped.length) {
  console.log(`  ⚠ 분류가 맞지 않아 빠진 글 ${skipped.length}건: ${skipped.join(', ')}`);
}
console.log(
  `글 ${posts.length}건 · 원본 축소 ${shrunk}장 · 썸네일 ${thumbs}장(정리 ${pruned}) · 페이지 ${1 + ALL_CATEGORIES.length + posts.length}개 · 변경 ${changed}건${
    DRY ? ' (--dry, 저장 안 함)' : ''
  }`
);
for (const c of ALL_CATEGORIES) {
  if (countBySlug[c.slug]) console.log(`  ${c.label}: ${countBySlug[c.slug]}건`);
}
