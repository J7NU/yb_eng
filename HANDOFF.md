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
| `admin/` | `/admin` 글쓰기 화면 (Sveltia CMS). 사진·글을 여기서 올린다 |
| `content/posts/` | 시공사례 글 원본(md). CMS 가 커밋한다 |
| `images/posts/` | 시공사례 사진. `thumb/` 은 빌드가 만든다 |
| `gallery/` | **생성물.** 손으로 고치지 말 것 — 빌드가 덮어쓴다 |
| `tools/build-gallery.mjs`·`tools/categories.mjs` | 갤러리 생성기 + 카테고리 단일 출처 |
| `.github/workflows/gallery.yml` | 글이 커밋되면 갤러리를 다시 만든다 |
| `wrangler.jsonc` · `_headers` · `_redirects` · `.assetsignore` | Cloudflare Workers 정적 배포 설정 |
| `sitemap.xml` · `robots.txt` | 색인용. **본문을 실질적으로 고치면 `sitemap.xml` 의 `lastmod` 를 같이 올린다** |
| `favicon.svg` (루트) · `images/` | 파비콘 원본 · 실제 쓰는 자산 4개 (`images/README.md` 참조) |

## 배포

**푸시가 곧 배포다.** main 머지뿐 아니라 브랜치 푸시도 라이브에 반영되는 것을 2026-08-12에 확인했다
(`claude/blog-rss` 브랜치 푸시분이 아펙스에 그대로 떠 있었다). 리뷰 게이트가 사실상 없으므로,
사이트에 바로 나가면 곤란한 변경은 푸시 자체를 미룰 것. 빌드 브랜치 제한은 Cloudflare 대시보드에서만 바꿀 수 있다.

## 시공사례 갤러리 (사이트를 살아있게 하는 축)

`/admin` 에서 사진과 글을 올리면 갤러리가 자동으로 생긴다. **코드를 손댈 일이 없다.**

```
/admin 에서 글 저장
   → CMS 가 content/posts/*.md + images/posts/* 를 main 에 커밋
   → Actions(.github/workflows/gallery.yml)가 tools/build-gallery.mjs 실행
   → gallery/*.html 생성 + 홈 8칸 타일 링크·잠금 해제 + sitemap 갱신 → 배포 (2~3분)
```

- 카테고리 단일 출처 = `tools/categories.mjs`. **여기와 `admin/config.yml` 의 선택 목록은 반드시 같아야 한다** — 한쪽만 고치면 그 분류의 글이 갤러리에서 사라진다.
- 품목 7종은 홈 타일 1~7번과 1:1 대응. 공장 전경·자재·제작 공정·인증은 품목이 아닌 "회사" 분류로 들어가며 갤러리에서만 보인다.
- 글이 0건이면 타일은 잠금(`data-gallery-ready="false"`), 1건이라도 생기면 해당 칸만 풀린다.
- 사진은 빌드가 640px 썸네일을 만들어 목록에 쓴다(파일명에 내용 해시가 붙는다). 원본은 가로 1600px 로 줄인다.
- 이미지 도구(magick/convert/ffmpeg)가 없으면 축소를 건너뛰고 원본을 그대로 쓴다 — 스크립트도 CI 도 **발행은 계속된다**.
  CI 는 도구 설치를 시도하고 실패하면 경고만 남긴다 (사진이 안 줄어든 채 나가므로 그 실행 뒤 용량 확인).
- 분류가 `tools/categories.mjs` 에 없는 글은 **그 글만 빠지고** 나머지는 정상 발행된다. Actions 로그에 error 주석이 남는다.
- 로그인은 GitHub 계정 + Cloudflare 의 `sveltia-cms-auth` Worker 를 거친다. Worker 주소를 `admin/config.yml` 의 `base_url` 에 넣어야 동작한다.

```bash
node tools/build-gallery.mjs         # 갤러리 다시 만들기
node tools/build-gallery.mjs --dry   # 저장하지 않고 결과만
```

### 글 올린 뒤 눈으로 확인할 것

1. `/gallery/` 에 카드가 뜨는가 2. 카드 클릭 → 상세에 사진·본문이 제대로 나오는가
3. 홈 해당 품목 타일이 풀리고 눌리는가 4. 모바일(390px)에서 안 깨지는가
5. Actions '갤러리 빌드' 가 초록인가 (실패 사유는 한국어로 찍힌다)

### 본문에 쓸 수 있는 것

제목(`#`·`##`) · **굵게** · *기울임* · `코드` · 인용(`>`) · 글머리표 · 번호목록 ·
사진 `![설명](/images/posts/파일.jpg)` · 링크(사이트 안 `/#contact`, 바깥 `https://…`).
표·코드블록은 편집기에서 만들어도 사이트에선 안 그려진다.

> 2026-08-12 이전에는 네이버 블로그 RSS 를 6시간마다 읽어 타일을 채우는 방식(`tools/sync-blog.mjs`)이었다.
> 사진과 글을 우리 사이트에 직접 올리기로 하면서 폐기했다. 이력은 git 에 남아 있다.

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
