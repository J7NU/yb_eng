/**
 * 유입 경로 기록 — 홈과 갤러리 모든 페이지가 함께 쓴다.
 *
 * 광고 랜딩 URL 에 ?src=naver&kw=온수탱크 처럼 붙여두면 그 값이 문의 메일에 함께 찍힌다.
 * 네이버 전환 스크립트 없이도 '어느 키워드가 문의를 만들었는지' 를 건별로 알 수 있다.
 *
 * 첫 유입 기준으로 기억한다 — 사이트 안에서 페이지를 옮겨다녀도 최초 경로가 유지된다.
 *
 * ⚠️ 이 파일이 홈에만 걸려 있으면, 광고 랜딩을 갤러리로 잡는 순간 추적이 죽는다.
 *    (갤러리에서 파라미터를 못 받고, 홈으로 넘어올 땐 내부 referrer 라 '직접 방문' 이 된다)
 *    그래서 갤러리 페이지 템플릿(tools/build-gallery.mjs 의 FOOT)에서도 같이 불러온다.
 */
(function () {
  var KEY = 'yb_referral';
  var CALL_KEY = 'yb_called';

  function fromQuery() {
    var q = new URLSearchParams(location.search);

    // 우리가 광고 소재에 직접 붙이는 값이 1순위다.
    // 네이버가 자동으로 붙이는 n_* 파라미터는 그게 없을 때만 쓴다
    // (프리미엄 로그분석을 켜면 랜딩 URL 에 n_keyword·n_query 등이 따라 붙는다).
    //
    // ⚠️ n_* 가 실제로 어떤 이름으로 오는지는 광고를 한 번 눌러보고 주소창으로 확인할 것.
    //    이름이 다르면 아래 목록에 추가하면 된다. 없는 파라미터는 그냥 무시된다.
    var src = q.get('src') || q.get('utm_source') || q.get('n_media');
    var kw = q.get('kw') || q.get('utm_term') || q.get('n_keyword') || q.get('n_query');
    var camp = q.get('campaign') || q.get('utm_campaign') || q.get('n_ad_group');

    if (!src && !kw && !camp) return '';
    return [src && '출처 ' + src, camp && '캠페인 ' + camp, kw && '키워드 ' + kw].filter(Boolean).join(' · ');
  }

  function fromReferrer() {
    if (!document.referrer) return '';
    try {
      var h = new URL(document.referrer).hostname;
      if (h.indexOf(location.hostname) !== -1) return ''; // 사이트 내부 이동
      if (h.indexOf('naver') !== -1) return '네이버에서 유입 (' + h + ')';
      if (h.indexOf('google') !== -1) return '구글에서 유입';
      if (h.indexOf('daum') !== -1 || h.indexOf('kakao') !== -1) return '다음·카카오에서 유입';
      return h + ' 에서 유입';
    } catch (e) {
      return '';
    }
  }

  function get(k) {
    try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } // 사파리 사생활 모드
  }
  function set(k, v) {
    try { sessionStorage.setItem(k, v); } catch (e) { /* 저장 못 해도 이번 페이지에선 쓴다 */ }
  }

  var saved = get(KEY);
  var found = fromQuery() || saved || fromReferrer();
  if (found && found !== saved) set(KEY, found);

  /**
   * 폼이 있는 페이지(홈)에서만 숨은 필드를 채운다. 갤러리에선 기록만 하고 지나간다.
   *
   * 전화 버튼을 먼저 누른 뒤 폼까지 넣는 사람이 있다. 그 경우 메일에 표시를 남겨서
   * 사장님이 '이미 통화한 건인지' 를 알 수 있게 한다 — 그래서 클릭 후에도 다시 부른다.
   */
  function fill() {
    var field = document.getElementById('referral');
    if (!field) return;
    var v = found || '직접 방문';
    if (get(CALL_KEY)) v += ' · 전화 버튼 누름';
    field.value = v;
  }

  fill();

  /**
   * 전화 걸기 클릭 기록 (2026-08-26 신설)
   *
   * 산업용 탱크 문의는 대부분 전화로 온다. 그런데 전화는 광고 보고서에 안 잡혀서
   * '광고비를 썼는데 문의가 있었는지' 를 영영 모르는 상태가 된다.
   *
   * 여기서 두 가지를 한다.
   *   1) 눌렀다는 사실을 세션에 남긴다 — 폼까지 쓰면 메일에 함께 찍힌다 (위 fill 참조)
   *   2) 네이버 전환 스크립트가 붙어 있으면 전환을 하나 쏜다
   *
   * ⚠️ 2번은 지금 아무 일도 하지 않는다. 프리미엄 로그분석(도구 → 프리미엄 로그 분석)을
   *    신청해 공통 스크립트를 넣기 전까지 window.wcs 가 없기 때문이다. 스크립트를 붙이는
   *    순간 이 훅이 저절로 살아난다 — 이 파일은 다시 손대지 않아도 된다.
   *
   * ⚠️ NAVER_CONV_TYPE 은 네이버 콘솔 [전환 설정] 에서 정한 전환 유형 번호와 맞춰야 한다.
   *    기본값 '2'(신청·예약) 로 두었으니, 스크립트를 붙일 때 실제 설정과 대조할 것.
   */
  var NAVER_CONV_TYPE = '2';
  var NAVER_CONV_VALUE = '0';

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (!t.closest('a[href^="tel:"]')) return;

    set(CALL_KEY, '1');
    fill();

    // 네이버 전환 스크립트가 있을 때만 쏜다. 없으면 조용히 지나간다.
    if (!window.wcs || typeof window.wcs_do !== 'function') return;
    try {
      var _nasa = {};
      _nasa.cnv = window.wcs.cnv(NAVER_CONV_TYPE, NAVER_CONV_VALUE);
      window.wcs_do(_nasa);
    } catch (err) {
      /* 전환 기록 실패가 전화 걸기를 막으면 안 된다 */
    }
  }, true);
})();
