# 영보이엔지 웹사이트 — 인수인계

**갱신:** 2026-08-12 · **라이브:** https://youngboeng.co.kr · **레포:** https://github.com/J7NU/yb_eng (public)

> 이전 판(2026-04-20 기준, P1~P3 작업 목록)은 지금 코드와 무관해져서 통째로 다시 썼다. 옛 내용은 git 이력에 있다.
> 이 레포는 **코드만** 담는다. 프로젝트 진행 상황·결정 이력은 jinu-co 레포 `projects/yb_eng/`(NEXT.md·CHECKLIST.md)가 정본.

---

## 구조

단일 페이지다. 빌드 툴 없음.

| 파일 | 역할 |
|---|---|
| `index.html` | 사이트 전체 (CSS·JS 인라인). 상단바 / 히어로 / 납품실적 8칸 타일 / 찾아오시는 길·문의폼 |
| `404.html` · `privacy.html` | 없는 페이지 · 개인정보처리방침 |
| `tools/sync-blog.mjs` | 네이버 블로그 RSS → 8칸 타일 자동 주입 (아래 참조) |
| `.github/workflows/blog-sync.yml` | 위 스크립트를 6시간마다 실행 |
| `wrangler.jsonc` · `_headers` · `_redirects` · `.assetsignore` | Cloudflare Workers 정적 배포 설정 |
| `sitemap.xml` · `robots.txt` | 색인용. **본문을 실질적으로 고치면 `sitemap.xml` 의 `lastmod` 를 같이 올린다** |
| `favicon.svg` (루트) · `images/` | 파비콘 원본 · 실제 쓰는 자산 4개 (`images/README.md` 참조) |

## 배포

**푸시가 곧 배포다.** main 머지뿐 아니라 브랜치 푸시도 라이브에 반영되는 것을 2026-08-12에 확인했다
(`claude/blog-rss` 브랜치 푸시분이 아펙스에 그대로 떠 있었다). 리뷰 게이트가 사실상 없으므로,
사이트에 바로 나가면 곤란한 변경은 푸시 자체를 미룰 것. 빌드 브랜치 제한은 Cloudflare 대시보드에서만 바꿀 수 있다.

## 블로그 연동 (사이트를 살아있게 하는 축)

사장님이 `blog.naver.com/ybtank1978` 에 시공사진 글을 올리면 6시간 안에 타일이 따라간다.

- `rss.blog.naver.com` 은 CORS 를 안 열어줘 브라우저에서 못 읽는다 → **빌드 시점에 `index.html` 자체를 고친다.**
  글 제목이 정적 HTML에 박히므로 검색엔진이 시공 글을 읽는다.
- 글이 0건이면 8칸은 "시공사진 준비 중" 잠금(`<body data-blog-ready="false">`). 글이 생기면 자동 해제된다 — **손댈 필요 없다.**
- 피드가 빈 응답을 줘도 이미 해제된 사이트를 되잠그지 않는다(가드). 진짜로 글을 다 내렸으면 `ALLOW_RELOCK=1` 로 실행.
- 타일을 손으로 고칠 땐 `data-blog-slot` 속성과 `cap-ready`/`cap-soon` 구조를 유지할 것. 스크립트가 그걸로 칸을 찾는다.
- 제품군 배정 키워드는 `SLOT_KEYWORDS`, 매칭 순서는 `SLOT_ORDER`(좁은 말 먼저).

```bash
node tools/sync-blog.mjs            # 실제 피드로 실행
node tools/sync-blog.mjs --dry      # 저장하지 않고 결과만 출력
RSS_URL=... node tools/sync-blog.mjs  # 다른 피드로 테스트
```

## 외부 의존성

- 카카오 Maps SDK (JS 앱키는 공개되는 값 — 도메인 제한 설정으로 방어)
- **FormSubmit** (`formsubmit.co`, 견적 문의폼·도면 첨부 → `ybeng@hanmail.net`). Formspree 아니다 — `privacy.html` 위탁 고지도 FormSubmit 으로 적혀 있다
- Pretendard Variable (jsDelivr CDN)
- Cloudflare Web Analytics 비콘

## 로컬에서 보기

```bash
git clone https://github.com/J7NU/yb_eng && cd yb_eng
python3 -m http.server 8931   # http://127.0.0.1:8931
```
