/**
 * 카테고리 단일 출처.
 *
 * 홈 8칸 타일 · CMS 선택 목록 · 갤러리 출력 디렉토리가 전부 이 파일을 본다.
 * 여기 없는 값이 어딘가에 하드코딩되면 세 군데가 반드시 어긋난다.
 *
 * slot = index.html 의 data-blog-slot 번호 (1~7). 8번은 "더보기" 라 품목이 아니다.
 */

/** 제품 카테고리 — 홈 8칸 타일 1~7번과 1:1 대응 */
export const PRODUCT_CATEGORIES = [
  { slug: 'hot-water-storage', label: '온수저장탱크', slot: 1 },
  { slug: 'hot-water-heater', label: '온수가열탱크', slot: 2 },
  { slug: 'heat-exchanger', label: '열교환기', slot: 3 },
  { slug: 'header', label: '헤더', slot: 4 },
  { slug: 'diesel-tank', label: '경유저장탱크', slot: 5 },
  { slug: 'sts-water-tank', label: '스테인리스 물탱크', slot: 6 },
  { slug: 'expansion-vessel', label: '밀폐형 압력용기', slot: 7 },
];

/**
 * 회사 카테고리 — 품목에 안 들어가는 사진.
 * 사장님 요구("공장 전경·자재 쌓인 모습을 보여줘야 회사구나 한다")가 여기로 간다.
 */
export const COMPANY_CATEGORIES = [
  { slug: 'factory', label: '공장 전경' },
  { slug: 'material', label: '자재·재고' },
  { slug: 'process', label: '제작 공정' },
  { slug: 'certificate', label: '인증·허가' },
];

export const ALL_CATEGORIES = [...PRODUCT_CATEGORIES, ...COMPANY_CATEGORIES];

export const labelOf = (slug) => ALL_CATEGORIES.find((c) => c.slug === slug)?.label ?? slug;

export const isKnownCategory = (slug) => ALL_CATEGORIES.some((c) => c.slug === slug);
