/**
 * 납품실적 이어보기 (reel)
 *
 * 글 상세 맨 아래에 닿으면 다음 실적을 받아 이어 붙인다. 계속 내리면 계속 붙는다.
 * 붙일 목록은 빌드가 페이지에 심어둔 <script id="reel-chain"> 이다 (같은 품목 먼저, 그다음 최신순).
 *
 * 원칙
 *   - 의존성 0. 빌드 도구도 안 탄다 (정적 파일 그대로 나간다).
 *   - JS 가 없거나 죽으면 아래 '다음 납품실적 →' 링크가 그대로 남는다. 못 보게 되는 글이 없다.
 *   - 붙는 글마다 견적 CTA 가 통째로 따라온다. 전화번호가 스크롤에 묻히면 이 페이지의 존재 이유가 사라진다.
 *   - 지금은 체인 끝까지 자동으로 붙인다 (BATCH = 0). 실적이 몇 건뿐이라 '더 보기'로 끊으면
 *     오히려 흐름만 끊긴다. 체인 자체가 12건에서 끝나므로 무한정 붙지는 않는다.
 *     글이 늘거나 사진이 무거워지면 BATCH 를 4 로 올려 '더 보기'를 되살린다 (아래 BATCH 주석 참고).
 */
(function () {
  'use strict';

  var chainEl = document.getElementById('reel-chain');
  var sentinel = document.getElementById('reel-sentinel');
  var fallback = document.querySelector('.reel-fallback');
  var statusEl = document.querySelector('.reel-status');
  var main = document.querySelector('main.wrap');
  if (!chainEl || !sentinel || !main || !('IntersectionObserver' in window)) return;

  var queue;
  try {
    queue = JSON.parse(chainEl.textContent) || [];
  } catch (e) {
    return; // JSON 이 깨졌으면 조용히 정적 링크만 남긴다
  }
  if (!queue.length) return;

  // 이미 화면에 있는 글은 다시 붙이지 않는다
  var seen = Object.create(null);
  seen[location.pathname] = true;

  /**
   * 몇 건까지 자동으로 이어 붙이고 '더 보기'에서 멈출지.
   *   0  = 멈추지 않는다 (체인 끝까지 자동). 실적이 적은 지금의 설정.
   *   4  = 4건마다 버튼에서 한 번 끊는다.
   * 아래 중 하나라도 걸리면 4 로 올린다:
   *   - 글이 25건을 넘어 체인(12건)이 늘 가득 찬다
   *   - 글 하나에 사진이 평균 4장을 넘는다 (12건 연속 = 사진 50장)
   *   - 영상이 들어간다
   *   - 실제 휴대폰에서 아래로 내릴 때 끊김이 느껴진다
   */
  var BATCH = 0;
  var loading = false;
  var done = false;
  var paused = false;
  var inBatch = 0;
  var moreBtn = null;

  // JS 가 살아 있으니 정적 링크는 감춘다 (두 개의 '다음'이 보이면 헷갈린다)
  if (fallback) fallback.hidden = true;

  var say = function (msg) {
    if (statusEl) statusEl.textContent = msg || '';
  };

  var finish = function () {
    done = true;
    io.disconnect();
    say('');
    if (moreBtn) moreBtn.hidden = true;
    var end = document.createElement('p');
    end.className = 'reel-end';
    end.innerHTML = '<a href="/gallery/">← 전체 납품실적 보기</a>';
    main.insertBefore(end, sentinel);
  };

  /** BATCH 건을 붙였으면 멈추고 버튼을 내민다. 남은 건수를 적어 눌러야 할 이유를 준다 */
  var pause = function () {
    paused = true;
    if (!moreBtn) {
      moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'reel-more';
      moreBtn.addEventListener('click', function () {
        paused = false;
        inBatch = 0;
        moreBtn.hidden = true;
        maybeLoad();
      });
      main.insertBefore(moreBtn, sentinel);
    }
    moreBtn.textContent = '납품실적 더 보기 (' + queue.length + '건 남음)';
    moreBtn.hidden = false;
  };

  /** 받아온 문서에서 본문 한 덩어리만 떼어 온다. head·topbar·footer 는 버린다 */
  var extract = function (html, item) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var article = doc.querySelector('.reel-item');
    if (!article) return null;

    // 빵부스러기('홈 › 납품실적 › 열교환기')는 글마다 반복되면 시끄럽다.
    // 이어붙은 글에선 품목 태그 하나로 줄인다. 어느 품목인지는 여전히 보이고 눌러서 목록으로 갈 수 있다
    var crumb = article.querySelector('.crumb');
    if (crumb) {
      var links = crumb.querySelectorAll('a');
      var cat = links[links.length - 1];
      if (cat) {
        var tag = document.createElement('a');
        tag.className = 'reel-tag';
        tag.href = cat.getAttribute('href');
        tag.textContent = cat.textContent.trim();
        crumb.parentNode.replaceChild(tag, crumb);

        // 태그로 올라온 품목이 아래 메타줄('온수저장탱크 · STS316 5000L · 2025-06-10')에
        // 또 나오면 같은 말이 두 번이다. 메타줄에서 뺀다
        var metaEl = article.querySelector('.page-head p');
        if (metaEl) {
          var parts = metaEl.textContent.split(' · ');
          if (parts[0].trim() === tag.textContent) metaEl.textContent = parts.slice(1).join(' · ');
        }
      } else {
        crumb.remove();
      }
    }

    // 문서에 h1 은 하나만 있어야 한다. 이어붙인 글의 제목은 h2 로 낮춘다
    var h1 = article.querySelector('h1');
    if (h1) {
      var h2 = document.createElement('h2');
      h2.className = 'reel-title';
      h2.textContent = h1.textContent;
      h1.parentNode.replaceChild(h2, h1);
    }

    // 새로 붙는 사진은 전부 늦게 받는다 (스크롤이 안 닿은 글의 사진까지 받으면 안 된다)
    var imgs = article.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) imgs[i].loading = 'lazy';

    article.dataset.reelUrl = item.url;
    article.dataset.reelTitle = doc.title || item.title;

    var rule = document.createElement('div');
    rule.className = 'reel-rule';
    rule.textContent = '다음 납품실적';

    var frag = document.createDocumentFragment();
    frag.appendChild(rule);
    frag.appendChild(article);
    return frag;
  };

  var load = function () {
    if (loading || done || paused) return;
    var item = queue.shift();
    while (item && seen[item.url]) item = queue.shift();
    if (!item) return finish();

    loading = true;
    seen[item.url] = true;
    say('다음 실적 불러오는 중…');

    fetch(item.url, { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.text();
      })
      .then(function (html) {
        var frag = extract(html, item);
        if (!frag) throw new Error('본문 없음');
        main.insertBefore(frag, moreBtn || sentinel);
        watchAddress();
        say('');
        loading = false;
        inBatch += 1;
        if (!queue.length) finish();
        else if (BATCH > 0 && inBatch >= BATCH) pause();
        else maybeLoad();
      })
      .catch(function () {
        // 한 건 실패했다고 이어보기를 죽이지 않는다. 다음 글로 넘어간다
        loading = false;
        say('');
        if (!queue.length) finish();
        else maybeLoad();
      });
  };

  /**
   * 센티널이 이미 화면 안에 있으면 옵저버는 다시 안 울린다.
   * (짧은 글이 붙어 바닥이 그대로 보일 때, '더 보기'를 누른 직후)
   * 그래서 붙인 뒤엔 직접 한 번 더 재본다.
   */
  var maybeLoad = function () {
    requestAnimationFrame(function () {
      if (done || paused || loading) return;
      var r = sentinel.getBoundingClientRect();
      if (r.top < window.innerHeight + 600) load();
    });
  };

  var io = new IntersectionObserver(
    function (entries) {
      if (entries[0].isIntersecting) load();
    },
    { rootMargin: '600px 0px' } // 바닥에 닿기 전에 미리 받아 끊김을 없앤다
  );
  io.observe(sentinel);

  // ── 주소창을 화면에 걸린 글에 맞춘다 (새로고침·공유하면 그 글이 나온다) ──

  var addressIo = new IntersectionObserver(
    function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e.isIntersecting) continue;
        var el = e.target;
        if (location.pathname === el.dataset.reelUrl) continue;
        history.replaceState(null, '', el.dataset.reelUrl);
        document.title = el.dataset.reelTitle;
      }
    },
    { rootMargin: '-45% 0px -45% 0px' } // 화면 한가운데를 지나는 글이 '지금 보는 글'이다
  );

  var watched = 'reelWatched';
  var watchAddress = function () {
    var items = document.querySelectorAll('.reel-item');
    for (var i = 0; i < items.length; i++) {
      if (items[i].dataset[watched]) continue;
      items[i].dataset[watched] = '1';
      addressIo.observe(items[i]);
    }
  };
  watchAddress();
})();
