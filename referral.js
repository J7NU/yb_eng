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

  function fromQuery() {
    var q = new URLSearchParams(location.search);
    var src = q.get('src') || q.get('utm_source');
    var kw = q.get('kw') || q.get('utm_term');
    var camp = q.get('campaign') || q.get('utm_campaign');
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

  var saved = '';
  try { saved = sessionStorage.getItem(KEY) || ''; } catch (e) { /* 사파리 사생활 모드 */ }

  var found = fromQuery() || saved || fromReferrer();
  if (found && found !== saved) {
    try { sessionStorage.setItem(KEY, found); } catch (e) { /* 저장 못 해도 이번 페이지에선 쓴다 */ }
  }

  // 폼이 있는 페이지(홈)에서만 숨은 필드를 채운다. 갤러리에선 기록만 하고 지나간다.
  var field = document.getElementById('referral');
  if (field) field.value = found || '직접 방문';
})();
