# images — 사이트가 실제로 쓰는 자산

현재 사이트(`index.html` 단일 페이지)가 참조하는 이미지는 **아래 4개가 전부**다.
2026-08-12 정리에서 제품 누끼·인증마크·거래처 로고·구버전 로고 변형을 전부 지웠다
(해당 섹션이 2026-08-10 단순화 리뉴얼에서 사라져 참조가 끊겼기 때문. 필요하면 git 이력에서 되살린다).

| 파일 | 쓰이는 곳 | 규격 |
|---|---|---|
| `logo-mark-navy.svg` | 상단바 로고 · 히어로 배경 워터마크 | 벡터 |
| `og-cover-2026.png` | 카카오톡·밴드·페이스북 공유 미리보기, JSON-LD `image` | 1200×630 |
| `apple-touch-icon.png` | iOS 홈화면 아이콘 | 180×180 |
| `favicon-32.png` | 브라우저 탭 (SVG 미지원 대비) | 32×32 |

루트 `favicon.svg` 는 이 폴더가 아니라 레포 루트에 있다.

## 새 이미지를 넣기 전에

- **시공사진은 여기 넣지 않는다.** 현장 사진은 네이버 블로그(`blog.naver.com/ybtank1978`)에 올리고,
  `tools/sync-blog.mjs` 가 6시간마다 RSS를 읽어 납품실적 8칸 타일에 썸네일·제목을 자동으로 꽂는다.
- 블로그 썸네일은 네이버 CDN 에서 직접 불러온다(`referrerpolicy="no-referrer"` 필수 — Referer 가 붙으면 403).
  즉 이 폴더에 사진을 복사할 필요가 없다.
- 로고 원본(ai/psd)·카탈로그 PDF 같은 원본 파일은 이 레포가 아니라 jinu-co `projects/yb_eng/` 에 둔다.

## 지운 자산을 되살리려면

2026-08-12 정리로 지운 30개(거래처 로고·구버전 로고 변형·제품 사진·PWA 아이콘)는 두 군데에 남아 있다.

```bash
git show a1a2021:images/logo-mark-white.svg > images/logo-mark-white.svg   # 삭제 직전 커밋
```

사본은 jinu-co `projects/yb_eng/images/retired-2026-08-12/` 에도 복사해 뒀다.
특히 `logo-mark-white.svg`(네이비 배경용 흰 심볼)는 푸터가 네이비라 재디자인 때 다시 찾게 될 가능성이 높다.
