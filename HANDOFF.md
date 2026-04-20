# 영보이엔지 웹사이트 — 작업 인수인계 문서

**작성일:** 2026-04-20  
**현재 브랜치:** main  
**마지막 커밋:** `57e9676` — devex P1 완료  
**저장소:** https://github.com/J7NU/yb_eng

---

## 완료된 작업 이력

### 1. 코드 리뷰 수정 (`9b60523`)
- 이메일 평문(`ybeng@hanmail.net`) SITE 객체에서 제거 (보안)
- 폼 6개 필드에 `for`/`id` 접근성 속성 추가
- 팩스 번호 `<a href="tel:...">` → `<span>` 으로 변경 (팩스에 tel: 링크 부적절)
- `.hero-accent-line`의 중복 `left: 0` CSS 속성 제거

### 2. QA 수정 (`0cc8063`)
- 카카오 SDK undefined 충돌 방지: `typeof kakao !== 'undefined'` 가드 추가
- Reveal 애니메이션 점진적 향상: `.reveal { opacity: 0 }` → `.js-loaded .reveal { opacity: 0 }` (JS 미작동 시 콘텐츠 항상 표시)
- `document.documentElement.classList.add('js-loaded')` JS 초기화 추가
- 모달 오버레이 닫기 보강: `e.target === this || e.target.classList.contains('map-modal-overlay')`

### 3. 성능 개선 (`f6d98e1`)
- Google Fonts 비동기 로드: `<link rel="preload" ... onload="this.onload=null;this.rel='stylesheet'">`
- `display=swap` → `display=optional`로 변경 (CLS 방지)
- `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` 추가
- `<noscript>` 폰트 폴백 추가
- 카카오 SDK `<script>` `<head>` → `<body>` 말미로 이동 (LCP 개선)

### 4. DevEx 리뷰 P1 수정 (`57e9676`)
- **인라인 스타일 → CSS 클래스/변수로 이동**
  - `hero-contact-box`: inline `background-color`, `border` → CSS (`--accent-hero` 변수)
  - `hero-trust`, `trust-badge`, `stat-label`: inline font-size → CSS
  - `file-name`, `info-sub`, `footer-biz`: inline 스타일 → CSS 클래스
  - `form-label-optional`: 새 유틸리티 클래스 추가
- **JS 매직 컬러 → CSS 변수화**
  - `#2a8c55` → `var(--color-success)`
  - `#c0392b` → `var(--color-error)`
  - `:root`에 `--accent-hero`, `--color-success`, `--color-error` 추가
- **데드코드 제거**
  - `#tech` CSS 섹션 35줄 삭제 (HTML에 해당 섹션 없음)
  - `tech-bar` IntersectionObserver JS 11줄 삭제

---

## 남은 작업 — P2 (다음 스프린트)

### P2-1: 전화번호 셀렉터 개선
**파일:** `index.html` JS 섹션  
**현재 코드 (취약):**
```js
// DOMContentLoaded 핸들러 안
document.querySelectorAll('[href="tel:031-764-0248"]').forEach(el => {
  el.href = 'tel:' + SITE.phone.replace(/-/g, '');
});
```
**문제:** SITE.phone을 바꾸면 셀렉터 문자열은 바뀌지 않아 조용히 실패.  
**수정 방법:** HTML 전화번호 링크에 `data-phone-link` attribute 추가, JS에서 `[data-phone-link]`로 셀렉.

HTML 변경:
```html
<!-- 현재 -->
<a id="hero-phone-link" href="tel:031-764-0248" class="hero-phone">031-764-0248</a>
<a id="info-phone-link" href="tel:031-764-0248" style="color:inherit; text-decoration:none;">031-764-0248</a>

<!-- 변경 후 -->
<a data-phone-link href="tel:031-764-0248" class="hero-phone">031-764-0248</a>
<a data-phone-link href="tel:031-764-0248" style="color:inherit; text-decoration:none;">031-764-0248</a>
```

JS 변경:
```js
// DOMContentLoaded 핸들러 안
document.querySelectorAll('[data-phone-link]').forEach(el => {
  el.href = 'tel:' + SITE.phone.replace(/-/g, '');
  // 표시 텍스트도 SITE.phone으로 동기화 (선택)
  el.textContent = SITE.phone;
});
```

---

### P2-2: 파일 업로드 용량 제한 + Formspree 첨부 안내
**파일:** `index.html`  
**문제:**
- 현재 파일 첨부 시 크기 제한 없음 — 100MB 파일도 전송 시도
- Formspree 무료 플랜은 파일 첨부 미지원 → 첨부 시 에러 메시지만 나오고 원인 불명

**수정 방법:**

`updateFileName` 함수에 용량 검증 추가:
```js
function updateFileName(input) {
  const nameEl = input.parentElement.querySelector('.file-name');
  const hintEl = input.parentElement.parentElement.querySelector('.file-hint');
  if (input.files && input.files[0]) {
    const file = input.files[0];
    const maxMB = 10;
    if (file.size > maxMB * 1024 * 1024) {
      nameEl.textContent = `파일 크기 초과 (최대 ${maxMB}MB)`;
      nameEl.style.color = 'var(--color-error)';
      input.value = '';
      return;
    }
    nameEl.textContent = file.name;
    nameEl.classList.add('has-file');
    nameEl.style.color = '';
  } else {
    nameEl.textContent = '첨부파일 없음';
    nameEl.classList.remove('has-file');
    nameEl.style.color = '';
  }
}
```

`.file-hint` 텍스트 업데이트:
```html
<!-- 현재 -->
<div class="file-hint">PDF, DWG, DXF, Excel, 이미지 파일 가능</div>

<!-- 변경 후 -->
<div class="file-hint">PDF, DWG, DXF, Excel, 이미지 파일 가능 · 최대 10MB</div>
```

---

## 남은 작업 — P3 (나중에)

### P3-1: README.md 추가
새 개발자가 받았을 때 바로 시작할 수 있는 최소 가이드.
포함 내용:
- 로컬 실행 방법 (`python -m http.server` 또는 VS Code Live Server)
- 카카오 Maps API 키 교체 방법 (SITE.kakaoMapKey + `<script>` src appkey 2곳 동시 변경)
- Formspree 엔드포인트 교체 방법 (SITE.formspreeEndpoint)
- Cloudflare 이메일 난독화 설명
- 이미지 교체 가이드 (placeholder → 실제 이미지)
- GitHub Pages / Netlify 배포 방법

### P3-2: 애널리틱스 설치
**파일:** `index.html` line 11 (현재 TODO 주석 위치)  
선택지:
- **Google Analytics 4**: GA4 스니펫 삽입
- **Naver Analytics**: 네이버 웹마스터도구 통계 스크립트 삽입

---

## 환경 정보

- **파일 구조:** 단일 `index.html` (CSS + JS 모두 인라인)
- **외부 의존성:**
  - 카카오 Maps SDK: `//dapi.kakao.com/v2/maps/sdk.js?appkey=c51341751710462b11216ff297ef1c8c`
  - Google Fonts: Gowun Dodum, Bebas Neue
  - Formspree: `https://formspree.io/f/mdayddod`
  - Cloudflare Email Protection (자동 적용)
- **빌드 툴:** 없음 (순수 HTML/CSS/JS)
- **배포:** GitHub → (추정) Cloudflare Pages 또는 GitHub Pages

---

## 다음 세션 시작 방법

```bash
# 저장소 클론 (이미 있으면 생략)
git clone https://github.com/J7NU/yb_eng
cd yb_eng

# 현재 상태 확인
git log --oneline -5

# P2 작업 시작
# 위의 P2-1, P2-2 섹션 참고
```

Claude + gstack 재설치 후 이 파일을 읽고 시작하면 됩니다.
