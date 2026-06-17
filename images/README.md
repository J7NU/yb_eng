# 영보이엔지 이미지 자산 — 받을 사진 목록

> 진우가 아래 파일명으로 사진 주면 이 폴더에 떨궈서 목업에 바로 반영.
> 사진 없으면 목업은 점선 placeholder로 계속 렌더(깨지지 않음).
> 촬영: 아이폰17 일반. 누끼=흰 배경 분산광, 작업장면=대낮 자연광. WebP/JPG 변환 권장.

## 필수
| 파일명 | 용도 | 촬영 가이드 |
|---|---|---|
| `logo.svg` (또는 logo.png) | 네비·푸터 로고 | 로고 받는 대로. 투명배경 PNG/SVG |
| `hero-main.jpg` | Hero 대표 이미지 | 대표 탱크/열교환기. 누끼 or 현장 |
| `product-expansion-tank.jpg` | 제품①: 밀폐형 팽창탱크 | 흰 배경 누끼 |
| `product-heat-exchanger.jpg` | 제품②: 열교환기 | 흰 배경 누끼 |
| `product-hot-water-tank.jpg` | 제품③: 온수가열 탱크 | 흰 배경 누끼 |
| `product-sts-tank.jpg` | 제품④: STS 물탱크 | 흰 배경 누끼 |
| `factory.jpg` | 회사소개: 공장/작업장면 | 작업자 안전장구·제작 현장 |

## 선택 (있으면 신뢰감 ↑)
| 파일명 | 용도 |
|---|---|
| `cert-ks.png` `cert-iso9001.png` `cert-pressure.png` `cert-welding.png` | 인증마크 (홈페이지 파일 이전 받으면 거기 것으로 교체) |
| `client-1.png` ~ `client-6.png` | 거래처 로고 (그레이스케일 처리됨) — **채워둠** ↓ |

### 거래처 로고 (2026-06-17 채움)
기존 사이트 `results.html`(납품실적) 11장 스캔표에서 유명·대형 납품 현장 추출 → 대표 로고 Wikimedia Commons에서 수급.
| 슬롯 | 회사 | 근거(공사명) | 로고 출처 |
|---|---|---|---|
| client-1 | 삼성 | 삼성생명·삼성서울병원·삼성제일병원·기흥삼성車 등 | Commons Samsung Logo.svg |
| client-2 | LG | 파주 LG화학·오창 LG화학 | Commons LG logo (2014).svg |
| client-3 | 포스코 POSCO | 광양제철소 | Commons POSCO logo.svg |
| client-4 | 현대 HYUNDAI | 압구정현대백화점·현대아파트·현대아산모비스 | Commons Hyundai Motor Company logo.svg |
| client-5 | 롯데 LOTTE | 롯데호텔 본점·롯데김포공항 | Commons Lotte logo.svg |
| client-6 | 한국전력공사 KEPCO | 한전 충주지점 | Commons Kepco logo en.svg |
> 원본 SVG = `../client-logos-src/`. 재렌더: `cairosvg <svg> -o client-N.png -H 96` (rembg venv).
> ⚠️ **주의(진우 확인)**: 이들은 *납품 현장(end-site)*이고 직거래는 대부분 중간 설비사. 로고는 각 사 상표 → 실사이트 게시 전 (1)실제 납품 사실 부모님 확인 (2)상표 사용 리스크 판단. 헤딩 "주요 납품처"는 사실 부합(직거래처 아님). 교체 후보: 한국도로공사·KT&G·기아·한국은행·KAIST·한국에너지기술연구원(모두 실적표 존재).
| `app-power.jpg` 등 | (적용분야 섹션 삭제됨 — 불필요) |

## 규칙
- 가로 권장. 제품 누끼는 정사각(1:1) 깔끔.
- 용량: 긴 변 ~1600px, JPG 80% or WebP.
- 로고는 받는 대로 전체 한 번 정리(네비·푸터·favicon).
