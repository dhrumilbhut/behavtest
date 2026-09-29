/**
 * The `behavtest serve` dashboard: one HTML page (the report's styles and UI library plus the app below)
 * that reads the JSON API. Same rules as the report assets: no backticks or `${` inside the CSS/JS
 * strings, and run data is only ever inserted as text.
 */
import { CSS, EARLY_THEME_JS } from "../report/html/assets.js";
import { UI_LIB } from "../report/html/ui.js";

const DASH_CSS = String.raw`
.wrap { max-width: 1180px; }
.nav { display: flex; align-items: center; gap: 6px 18px; flex-wrap: wrap; padding: 14px 0 18px; margin-bottom: 24px; border-bottom: 1px solid var(--grid); }
.nav .brand { margin-right: 10px; text-decoration: none; }
.nav a.tab { color: var(--ink2); text-decoration: none; font-weight: 500; font-size: 14px; padding: 4px 2px; border-bottom: 2px solid transparent; }
.nav a.tab:hover { color: var(--ink); }
.nav a.tab[aria-current="page"] { color: var(--ink); border-bottom-color: var(--accent); }
.nav .spacer { flex: 1; }
.nav .db { font-size: 12.5px; color: var(--muted); }
a { color: var(--accent); }
.top h1 { margin-top: 0; }
.row-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
a.btn { text-decoration: none; display: inline-block; }
select.pick {
  font: inherit; font-size: 14px; color: var(--ink); background: var(--surface);
  border: 1px solid var(--border); border-radius: 10px; padding: 7px 10px; max-width: 100%;
}
.pickers { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 12px; align-items: center; margin-bottom: 18px; }
.pickers label { font-size: 13px; font-weight: 600; color: var(--ink2); }
tr.link { cursor: pointer; }
tr.link:hover td { background: var(--wash); }
td a.rid { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; }
.runs-table table { min-width: 860px; }
.charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; margin-bottom: 28px; }
.chart-card h3 { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.chart-card .csub { font-size: 12.5px; color: var(--ink2); margin: 2px 0 8px; }
.chart { position: relative; }
.chart svg { display: block; width: 100%; overflow: visible; }
.chart svg:focus { outline: none; }
.chart svg:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 6px; }
.chart .gridline { stroke: var(--grid); stroke-width: 1; }
.chart .axis { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.chart .band { fill: var(--accent); fill-opacity: 0.1; }
.chart .line { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.chart .dot { fill: var(--accent); stroke: var(--surface); stroke-width: 2; }
.chart .dot.on { r: 6; }
.chart .endlabel { fill: var(--ink); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.chart .cross { stroke: var(--muted); stroke-width: 1; }
.chart .hit { fill: transparent; cursor: pointer; }
.matrix { border-collapse: separate; border-spacing: 4px; width: auto; font-size: 13px; }
.matrix th, .matrix td { border: 0; padding: 6px 10px; }
.matrix td { background: var(--wash); border-radius: 8px; text-align: right; font-variant-numeric: tabular-nums; min-width: 84px; }
.matrix td.agree { background: color-mix(in srgb, var(--good) 12%, transparent); }
.matrix td.miss { background: color-mix(in srgb, var(--critical) 10%, transparent); }
.cal-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; margin-bottom: 28px; }
.cal-card h3 { font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.cal-card .rubric { color: var(--ink2); font-size: 13px; margin: 2px 0 12px; overflow-wrap: anywhere; }
.kappa { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
.kappa small { font-size: 13px; font-weight: 500; color: var(--ink2); letter-spacing: 0; margin-left: 6px; }
.info { color: var(--ink2); font-size: 14px; max-width: 720px; }
.info code, .empty code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; background: var(--code); border: 1px solid var(--border); border-radius: 6px; padding: 1px 6px; }
.loading { color: var(--ink2); padding: 24px 0; }
.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 5; max-width: calc(100% - 32px);
  background: var(--ink); color: var(--page); border-radius: 10px; padding: 10px 14px; font-size: 14px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25);
}
@media (max-width: 640px) {
  .pickers { grid-template-columns: 1fr; }
  .charts, .cal-grid { grid-template-columns: 1fr; }
  .nav .db { display: none; }
}
`;

const DASH_APP = String.raw`
(function () {
  'use strict';
  var U = BehavTestUI, h = U.h;
  var app = document.getElementById('app');
  var CFG = {};
  try { CFG = JSON.parse(document.getElementById('behavtest-config').textContent); } catch (e) {}
  var enc = encodeURIComponent;
  var SVGNS = 'http://www.w3.org/2000/svg';

  // ---- API ----
  function api(path, init) {
    init = init || {};
    var headers = { Accept: 'application/json' };
    if (init.body) headers['Content-Type'] = 'application/json';
    return fetch('/api/v1' + path, { method: init.method || 'GET', headers: headers, body: init.body, credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error((j && j.error && j.error.message) || ('HTTP ' + r.status));
          return j;
        });
      });
  }

  var toastTimer = null;
  function toast(msg) {
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var t = h('div', { class: 'toast', role: 'status', text: msg });
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, 4000);
  }

  // ---- layout ----
  function nav(current) {
    function tab(href, label, key) { return h('a', { class: 'tab', href: href, 'aria-current': current === key ? 'page' : null, text: label }); }
    return h('nav', { class: 'nav', 'aria-label': 'Dashboard' },
      h('a', { class: 'brand', href: '#/', text: 'BehavTest' }),
      tab('#/', 'Runs', 'runs'), tab('#/compare', 'Compare', 'compare'), tab('#/matrices', 'Matrix', 'matrices'), tab('#/calibration', 'Calibration', 'calibration'),
      h('span', { class: 'spacer' }),
      CFG.db ? h('span', { class: 'db', title: 'Results database', text: CFG.db }) : null,
      U.themeButton());
  }
  function page(current, kids) {
    var wrap = h('div', { class: 'wrap' }, nav(current), kids,
      h('footer', { text: 'BehavTest ' + (CFG.version || '') + ' dashboard · serving your results database from this machine. Runs start from the CLI: behavtest run <suite>.' }));
    app.textContent = '';
    app.appendChild(wrap);
    return wrap;
  }
  function title(text, meta, actions) {
    return h('header', { class: 'top' },
      h('div', null, h('h1', { text: text }), meta ? h('p', { class: 'meta', text: meta }) : null),
      actions || null);
  }
  function loading() { return h('p', { class: 'loading', text: 'Loading…' }); }
  function failed(err) { return h('div', { class: 'card' }, h('p', { class: 'err', text: 'Could not load this page: ' + (err && err.message ? err.message : err) })); }

  // ---- run outcome ----
  function outcomeOf(r) {
    if (!r.summary) return ['…', 'Running', '--neutral'];
    var c = r.summary.cases;
    if (c.errored) return U.ST.errored;
    if (c.failed) return U.ST.failed;
    if (c.flaky) return U.ST.flaky;
    return U.ST.passed;
  }
  // axis labels: the date, or the time when the chart spans a single day
  function shortDate(iso, sameDay) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return sameDay ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function dayOf(iso) { return new Date(iso).toDateString(); }

  // ---- trend chart: one series (attempt pass rate), Wilson band, crosshair + tooltip ----
  function svg(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function trendChart(points, height) {
    var box = h('div', { class: 'chart' });
    var tip = null;
    function draw() {
      var W = Math.max(260, box.clientWidth || 600), H = height;
      var m = { l: 40, r: 44, t: 10, b: 24 };
      var iw = W - m.l - m.r, ih = H - m.t - m.b;
      var n = points.length;
      var x = function (i) { return m.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1)); };
      var y = function (v) { return m.t + (1 - v) * ih; };
      var last = null;
      for (var j = n - 1; j >= 0; j--) if (points[j].attemptRate) { last = j; break; }
      var s = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', tabindex: '0',
        'aria-label': 'Attempt pass rate over the last ' + n + ' run' + (n === 1 ? '' : 's') + (last !== null ? ', latest ' + U.pct(points[last].attemptRate.rate) : '') + '. Use the arrow keys to step through runs and Enter to open one.' });
      [0, 0.5, 1].forEach(function (v) {
        s.appendChild(svg('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
        var t = svg('text', { class: 'axis', x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' });
        t.textContent = U.pct(v);
        s.appendChild(t);
      });
      // x labels: first and last run date
      var sameDay = n > 1 && dayOf(points[0].startedAt) === dayOf(points[n - 1].startedAt);
      if (n) {
        var t0 = svg('text', { class: 'axis', x: x(0), y: H - 6, 'text-anchor': n === 1 ? 'middle' : 'start' });
        t0.textContent = shortDate(points[0].startedAt, sameDay);
        s.appendChild(t0);
        if (n > 1) {
          var t1 = svg('text', { class: 'axis', x: x(n - 1), y: H - 6, 'text-anchor': 'end' });
          t1.textContent = shortDate(points[n - 1].startedAt, sameDay);
          s.appendChild(t1);
        }
      }
      // band and line, broken where a run has no scored attempts
      var segs = [], cur = [];
      points.forEach(function (p, i) {
        if (p.attemptRate) cur.push(i); else if (cur.length) { segs.push(cur); cur = []; }
      });
      if (cur.length) segs.push(cur);
      segs.forEach(function (seg) {
        if (seg.length > 1) {
          var up = seg.map(function (i) { return x(i) + ',' + y(points[i].attemptRate.hi); });
          var lo = seg.slice().reverse().map(function (i) { return x(i) + ',' + y(points[i].attemptRate.lo); });
          s.appendChild(svg('polygon', { class: 'band', points: up.concat(lo).join(' ') }));
          s.appendChild(svg('polyline', { class: 'line', points: seg.map(function (i) { return x(i) + ',' + y(points[i].attemptRate.rate); }).join(' ') }));
        }
      });
      var dots = [];
      points.forEach(function (p, i) {
        if (!p.attemptRate) { dots.push(null); return; }
        var d = svg('circle', { class: 'dot', cx: x(i), cy: y(p.attemptRate.rate), r: 4 });
        s.appendChild(d);
        dots.push(d);
      });
      if (last !== null) {
        var el = svg('text', { class: 'endlabel', x: x(last) + 10, y: y(points[last].attemptRate.rate) + 4 });
        el.textContent = U.pct(points[last].attemptRate.rate);
        s.appendChild(el);
      }
      var cross = svg('line', { class: 'cross', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
      s.appendChild(cross);
      var hit = svg('rect', { class: 'hit', x: m.l - 12, y: 0, width: iw + 24, height: H });
      s.appendChild(hit);

      var active = -1;
      function show(i) {
        if (i < 0 || i >= n) return;
        if (active >= 0 && dots[active]) dots[active].classList.remove('on');
        active = i;
        var p = points[i];
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
        if (dots[i]) dots[i].classList.add('on');
        if (!tip) { tip = h('div', { class: 'tip' }); box.appendChild(tip); }
        tip.textContent = '';
        tip.appendChild(h('div', null, h('b', { text: p.attemptRate ? U.pct(p.attemptRate.rate) : 'no scored attempts' }),
          p.attemptRate ? h('span', { class: 'tm', text: '  [' + U.pct(p.attemptRate.lo) + '–' + U.pct(p.attemptRate.hi) + ']' }) : null));
        tip.appendChild(h('div', { text: p.cases.passed + ' of ' + p.cases.total + ' cases passed' }));
        tip.appendChild(h('div', { class: 'tm', text: [p.runId.slice(0, 8), U.when(p.startedAt)].concat(p.label ? [p.label] : []).concat(p.gitSha ? [p.gitSha.slice(0, 7)] : []).join(' · ') }));
        var left = x(i) + 12;
        tip.style.left = '0px';
        var tw = tip.offsetWidth;
        if (left + tw > W) left = Math.max(0, x(i) - 12 - tw);
        tip.style.left = left + 'px';
        tip.style.top = m.t + 'px';
      }
      function hide() {
        if (active >= 0 && dots[active]) dots[active].classList.remove('on');
        active = -1;
        cross.setAttribute('visibility', 'hidden');
        if (tip) { tip.remove(); tip = null; }
      }
      function nearest(evt) {
        var r = s.getBoundingClientRect();
        var px = (evt.clientX - r.left) * (W / r.width);
        return n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
      }
      hit.addEventListener('pointermove', function (e) { show(nearest(e)); });
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('click', function (e) { location.hash = '#/runs/' + enc(points[nearest(e)].runId); });
      s.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          show(active < 0 ? n - 1 : Math.max(0, Math.min(n - 1, active + (e.key === 'ArrowRight' ? 1 : -1))));
        } else if (e.key === 'Enter' && active >= 0) {
          location.hash = '#/runs/' + enc(points[active].runId);
        } else if (e.key === 'Escape') hide();
      });
      s.addEventListener('blur', hide);
      box.textContent = '';
      tip = null;
      box.appendChild(s);
    }
    var lastW = 0;
    if (window.ResizeObserver) {
      new ResizeObserver(function () { var w = box.clientWidth; if (w && w !== lastW) { lastW = w; draw(); } }).observe(box);
    } else setTimeout(draw, 0);
    return box;
  }
  function trendCard(suite, big, variant) {
    var card = h('section', { class: 'card chart-card' },
      h('h3', null, h('a', { href: '#/?suite=' + enc(suite), text: suite }), variant ? h('span', { class: 'tag', text: variant }) : null),
      h('p', { class: 'csub', text: variant ? 'Variant ' + variant + ': attempt pass rate per run, with its 95% interval' : 'Attempt pass rate per run, with its 95% interval' }),
      loading());
    api('/trend?suite=' + enc(suite) + '&limit=' + (big ? 100 : 30) + (variant ? '&variant=' + enc(variant) : '')).then(function (t) {
      card.removeChild(card.lastChild);
      if (t.points.length < 2) {
        card.appendChild(h('p', { class: 'empty', text: t.points.length ? 'One finished run so far: the trend appears after the next.' : 'No finished runs yet.' }));
        return;
      }
      card.appendChild(trendChart(t.points, big ? 240 : 170));
    }, function (err) { card.removeChild(card.lastChild); card.appendChild(h('p', { class: 'err', text: err.message })); });
    return card;
  }

  // ---- pages ----
  function runsPage(q, live) {
    var suite = q.get('suite') || '';
    var root = page('runs', [title(suite || 'Runs', suite ? 'Runs of this suite, newest first' : 'Every saved run, newest first'), loading()]);
    Promise.all([api('/suites'), api('/runs?limit=200' + (suite ? '&suite=' + enc(suite) : ''))]).then(function (res) {
      if (!live()) return;
      var suites = res[0].suites, runs = res[1].runs;
      root.removeChild(root.querySelector('.loading'));
      var after = root.querySelector('footer');
      if (!suites.length) {
        root.insertBefore(h('div', { class: 'card empty' },
          h('p', null, 'No runs in this database yet. Run a suite, then refresh: '), h('p', null, h('code', { text: 'behavtest run <suite>' }))), after);
        return;
      }
      var sel = h('select', { class: 'pick', 'aria-label': 'Suite' },
        h('option', { value: '', text: 'All suites (' + suites.length + ')' }),
        suites.map(function (s) { return h('option', { value: s.suiteName, selected: s.suiteName === suite ? true : null, text: s.suiteName + ' (' + s.runs + ')' }); }));
      sel.addEventListener('change', function () { location.hash = sel.value ? '#/?suite=' + enc(sel.value) : '#/'; });
      root.insertBefore(h('div', { class: 'tools' }, sel), after);

      // one chart per series: a suite's runs outside any matrix, and each of its variants
      var series = [];
      suites.filter(function (s) { return !suite || s.suiteName === suite; }).forEach(function (s) {
        if (s.plainRuns) series.push([s.suiteName, null]);
        (s.variants || []).forEach(function (v) { series.push([s.suiteName, v.variant]); });
      });
      var cap = suite ? 12 : 6;
      root.insertBefore(h('div', { class: 'charts' }, series.slice(0, cap).map(function (x) { return trendCard(x[0], !!suite && series.length === 1, x[1]); })), after);
      if (series.length > cap) root.insertBefore(h('p', { class: 'meta', style: 'margin:-16px 0 24px', text: 'Showing ' + cap + ' of ' + series.length + ' trends (a suite’s variants each have their own); ' + (suite ? 'the rest are in the table below.' : 'pick a suite to see more.') }), after);

      var rows = runs.map(function (r) {
        var S = r.summary, href = '#/runs/' + enc(r.runId);
        var tr = h('tr', { class: 'link' },
          h('td', null, U.statusOf(outcomeOf(r))),
          h('td', null, h('a', { class: 'rid', href: href, text: r.runId.slice(0, 8) }),
            r.variant || r.label ? h('span', { class: 'note', text: [r.variant ? '[' + r.variant + ']' : '', r.label || ''].filter(Boolean).join(' ') }) : null),
          suite ? null : h('td', { text: r.suiteName }),
          h('td', { class: 'num', text: U.when(r.startedAt) }),
          h('td', { class: 'num', text: r.gitSha ? r.gitSha.slice(0, 7) + (r.gitDirty ? '*' : '') : '–' }),
          h('td', { class: 'num', text: S ? S.cases.passed + ' / ' + S.cases.total : '–' }),
          h('td', { class: 'num', text: r.attemptRate ? U.pct(r.attemptRate.rate) : '–' }),
          h('td', { class: 'num', text: S ? String(S.cases.flaky) : '–' }),
          h('td', { class: 'num', text: !S ? '–' : (S.attempts.total && S.costUsd.unknownAttempts === S.attempts.total ? 'unknown' : U.usd(S.costUsd.pipeline + S.costUsd.judge)) }),
          h('td', null, r.status === 'completed' ? '' : r.status));
        tr.addEventListener('click', function (e) { if (e.target.tagName !== 'A') location.hash = href; });
        return tr;
      });
      root.insertBefore(h('section', { class: 'block' },
        h('h2', { class: 'sec', text: suite ? 'Runs' : 'All runs' }),
        h('div', { class: 'card scroll runs-table', style: 'padding:6px 10px' },
          h('table', null,
            h('thead', null, h('tr', null,
              h('th', { text: 'Outcome' }), h('th', { text: 'Run' }), suite ? null : h('th', { text: 'Suite' }),
              h('th', { class: 'num', text: 'Started' }), h('th', { class: 'num', text: 'Git' }),
              h('th', { class: 'num', text: 'Cases passed' }), h('th', { class: 'num', text: 'Attempt pass rate' }),
              h('th', { class: 'num', text: 'Flaky' }), h('th', { class: 'num', text: 'Cost' }), h('th', { text: 'Status' }))),
            h('tbody', null, rows))),
        runs.length >= 200 ? h('p', { class: 'meta', style: 'margin-top:8px', text: 'Showing the latest 200 runs.' }) : null), after);
    }, function (err) { if (live()) { root.replaceChild(failed(err), root.querySelector('.loading')); } });
  }

  function labelStore(runId, list) {
    var m = {}, queue = {};
    var key = function (c, a, s) { return JSON.stringify([c, a, s]); };
    list.forEach(function (l) { m[key(l.caseId, l.attempt, l.scorer)] = l.label; });
    var store = {
      count: function () { return Object.keys(m).length; },
      onChange: function () {},
      get: function (c, a, s) { return m[key(c, a, s)]; },
      set: function (c, a, s, v) {
        var k = key(c, a, s), prev = m[k];
        if (v === undefined) delete m[k]; else m[k] = v;
        store.onChange();
        var send = function () {
          return v === undefined
            ? api('/labels?run=' + enc(runId) + '&case=' + enc(c) + '&attempt=' + a + '&scorer=' + enc(s), { method: 'DELETE' })
            : api('/labels', { method: 'PUT', body: JSON.stringify({ run: runId, case: c, attempt: a, scorer: s, label: v }) });
        };
        // one request at a time per verdict, so quick clicks land in order
        var p = (queue[k] || Promise.resolve()).then(send, send);
        queue[k] = p.catch(function () {});
        return p.then(function () {}, function (err) {
          if (prev === undefined) delete m[k]; else m[k] = prev;
          store.onChange();
          toast('Could not save the label: ' + err.message);
          throw err;
        });
      }
    };
    return store;
  }

  function runPage(id, q, live) {
    var root = page('runs', [loading()]);
    api('/runs/' + enc(id)).then(function (D) {
      if (!live()) return;
      var run = D.run;
      var meta = ['run ' + run.runId.slice(0, 8), U.when(run.startedAt)];
      if (run.variant) meta.push('variant ' + run.variant);
      if (run.label) meta.push(run.label);
      if (run.gitSha) meta.push(run.gitSha.slice(0, 7) + (run.gitDirty ? '*' : ''));
      if (run.status !== 'completed') meta.push(run.status);
      var actions = h('div', { class: 'row-actions' },
        run.matrixId ? h('a', { class: 'btn', href: '#/matrices/' + enc(run.matrixId), text: 'Matrix' }) : null,
        h('a', { class: 'btn', href: '#/compare?head=' + enc(run.runId), text: 'Compare with previous' }),
        h('a', { class: 'btn', href: '#/?suite=' + enc(run.suiteName), text: 'All runs of this suite' }));
      var labels = labelStore(run.runId, D.labels || []);
      var bar = null;
      if (U.hasJudged(D.cases)) {
        var count = h('span', { class: 'lcount' });
        labels.onChange = function () { count.textContent = labels.count() + ' labelled in this run'; };
        labels.onChange();
        bar = h('div', { class: 'labels' },
          h('span', { class: 'lh', text: 'Check the judge: mark judged answers Pass or Fail yourself. Labels save to the results database as you click; behavtest calibrate reads them.' }),
          count, h('a', { class: 'btn', href: '#/calibration', text: 'Calibration' }));
      }
      var cases = U.casesSection(D.cases, {
        labels: labels,
        openCase: q.get('case') || null,
        load: function (c) { return api('/runs/' + enc(run.runId) + '/cases/' + enc(c.caseId)).then(function (r) { return r.case; }); }
      }, bar);
      root.replaceChild(h('div', null, title(run.suiteName, meta.join('  ·  '), actions), U.tiles(D.summary, D.attemptRate), cases), root.querySelector('.loading'));
    }, function (err) { if (live()) root.replaceChild(failed(err), root.querySelector('.loading')); });
  }

  function comparePage(q, live) {
    var root = page('compare', [title('Compare runs', 'What regressed, what improved, and whether it is real or noise'), loading()]);
    api('/runs?limit=500').then(function (res) {
      if (!live()) return;
      var runs = res.runs.filter(function (r) { return r.status !== 'running'; });
      var holder = root.querySelector('.loading');
      if (runs.length < 2) { root.replaceChild(h('div', { class: 'card empty', text: 'Comparing needs at least two finished runs.' }), holder); return; }
      var head = q.get('head'), base = q.get('base');
      var find = function (ref) { return ref ? runs.filter(function (r) { return r.runId.indexOf(ref) === 0; })[0] : undefined; };
      var H = find(head) || runs[0];
      var B = find(base) || runs.filter(function (r) { return r.suiteName === H.suiteName && r.startedAt < H.startedAt; })[0];
      function picker(label, chosen, key) {
        var s = h('select', { class: 'pick', id: 'pick-' + key },
          chosen ? null : h('option', { value: '', text: 'Choose a run' }),
          runs.map(function (r) { return h('option', { value: r.runId, selected: chosen && r.runId === chosen.runId ? true : null, text: r.suiteName + ' · ' + U.runLabel(r) }); }));
        s.addEventListener('change', function () {
          var nb = key === 'base' ? s.value : (B ? B.runId : ''), nh = key === 'head' ? s.value : H.runId;
          location.hash = '#/compare?' + (nb ? 'base=' + enc(nb) + '&' : '') + 'head=' + enc(nh);
        });
        return [h('label', { for: 'pick-' + key, text: label }), s];
      }
      var swap = h('button', { class: 'btn', type: 'button', text: 'Swap base and head', disabled: B ? null : true });
      swap.addEventListener('click', function () { location.hash = '#/compare?base=' + enc(H.runId) + '&head=' + enc(B.runId); });
      var out = h('div', null, B ? loading() : h('div', { class: 'card empty', text: 'There is no earlier run of ' + H.suiteName + ' to compare with: choose a base run.' }));
      root.replaceChild(h('div', null, h('div', { class: 'pickers' }, picker('Base', B, 'base'), picker('Head', H, 'head')), h('div', { class: 'tools' }, swap), out), holder);
      if (!B) return;
      api('/compare?base=' + enc(B.runId) + '&head=' + enc(H.runId)).then(function (r) {
        if (!live()) return;
        out.textContent = '';
        out.appendChild(U.comparison(r.comparison));
        out.appendChild(h('p', { class: 'meta', text: 'Open a run to see its cases: ' },
          h('a', { href: '#/runs/' + enc(B.runId), text: 'base ' + B.runId.slice(0, 8) }), ' · ',
          h('a', { href: '#/runs/' + enc(H.runId), text: 'head ' + H.runId.slice(0, 8) })));
      }, function (err) { if (live()) { out.textContent = ''; out.appendChild(failed(err)); } });
    }, function (err) { if (live()) root.replaceChild(failed(err), root.querySelector('.loading')); });
  }

  function matricesPage(live) {
    var root = page('matrices', [title('Matrix runs', 'One suite run several ways (models, prompts), side by side'), loading()]);
    api('/matrices').then(function (res) {
      if (!live()) return;
      var holder = root.querySelector('.loading');
      if (!res.matrices.length) {
        root.replaceChild(h('div', { class: 'card' },
          h('h2', { class: 'sec', text: 'No matrix runs yet' }),
          h('p', { class: 'info', text: 'Add "variants" to a suite, each changing the pipeline config (a model, a prompt), and run it: every variant becomes one run of the matrix, with the same cases and the same judge.' })), holder);
        return;
      }
      var rows = res.matrices.map(function (m) {
        var href = '#/matrices/' + enc(m.matrixId);
        var tr = h('tr', { class: 'link' },
          h('td', null, h('a', { class: 'rid', href: href, text: m.matrixId.slice(0, 8) })),
          h('td', { text: m.suiteName }),
          h('td', { class: 'num', text: U.when(m.startedAt) }),
          h('td', { text: m.variants.map(function (v) { return v.variant; }).join(', ') }),
          h('td', null, m.variants.every(function (v) { return v.status === 'completed'; }) ? '' : 'incomplete'));
        tr.addEventListener('click', function (e) { if (e.target.tagName !== 'A') location.hash = href; });
        return tr;
      });
      root.replaceChild(h('div', { class: 'card scroll', style: 'padding:6px 10px' },
        h('table', null,
          h('thead', null, h('tr', null, h('th', { text: 'Matrix' }), h('th', { text: 'Suite' }), h('th', { class: 'num', text: 'Started' }), h('th', { text: 'Variants' }), h('th', { text: 'Status' }))),
          h('tbody', null, rows))), holder);
    }, function (err) { if (live()) root.replaceChild(failed(err), root.querySelector('.loading')); });
  }

  function matrixPage(id, q, live) {
    var root = page('matrices', [loading()]);
    var ref = q.get('reference');
    api('/matrices/' + enc(id) + (ref ? '?reference=' + enc(ref) : '')).then(function (res) {
      if (!live()) return;
      var M = res.matrix;
      var pick = h('select', { class: 'pick', 'aria-label': 'Reference variant' },
        M.variants.map(function (v) { return h('option', { value: v.variant, selected: v.variant === M.reference ? true : null, text: 'Compare with ' + v.variant }); }));
      pick.addEventListener('change', function () { location.hash = '#/matrices/' + enc(M.matrixId) + '?reference=' + enc(pick.value); });
      var meta = M.variants.length + ' variants  ·  matrix ' + M.matrixId.slice(0, 8) + '  ·  ' + U.when(M.startedAt);
      root.replaceChild(h('div', null,
        title(M.suiteName, meta, h('div', { class: 'row-actions' }, pick)),
        U.matrixView(M, {
          runHref: function (runId) { return '#/runs/' + enc(runId); },
          caseHref: function (runId, caseId) { return '#/runs/' + enc(runId) + '?case=' + enc(caseId); }
        })), root.querySelector('.loading'));
    }, function (err) { if (live()) root.replaceChild(failed(err), root.querySelector('.loading')); });
  }

  function kappaWords(k) {
    if (k === null) return 'cannot be computed';
    if (k < 0.2) return 'slight agreement beyond chance';
    if (k < 0.4) return 'fair agreement';
    if (k < 0.6) return 'moderate agreement';
    if (k < 0.8) return 'substantial agreement';
    return 'almost perfect agreement';
  }
  function calibrationPage(live) {
    var root = page('calibration', [title('Judge calibration', 'How often each LLM judge agrees with your own pass/fail labels'), loading()]);
    api('/calibration').then(function (res) {
      if (!live()) return;
      var C = res.calibration, holder = root.querySelector('.loading');
      if (!C.labels) {
        root.replaceChild(h('div', { class: 'card' },
          h('h2', { class: 'sec', text: 'No labels yet' }),
          h('p', { class: 'info', text: 'Open a run whose suite uses an LLM judge (llmJudge, faithfulness or contextRelevance) and mark judged answers Pass or Fail yourself. Each label is saved here as you click. With 30 or more labels per judge, the numbers are solid enough to act on.' })), holder);
        return;
      }
      var k2 = function (v) { return (Math.abs(v) < 0.005 ? 0 : v).toFixed(2); }; // never "-0.00"
      var cards = C.groups.map(function (g) {
        var cf = g.confusion;
        return h('section', { class: 'card cal-card' },
          h('h3', { text: g.scorer + ' · ' + g.judge }),
          h('p', { class: 'rubric', text: g.rubric ? 'Rubric: ' + g.rubric : 'Default rubric' }),
          h('div', { class: 'kappa' }, g.kappa === null ? 'κ undefined' : 'κ ' + k2(g.kappa),
            h('small', { text: (g.kappaInterval ? '95% CI ' + k2(g.kappaInterval.lo) + ' to ' + k2(g.kappaInterval.hi) + ' · ' : '') + kappaWords(g.kappa) })),
          h('dl', { class: 'facts', style: 'margin-top:12px' },
            h('dt', { text: 'Labels' }), h('dd', { text: String(g.n) }),
            h('dt', { text: 'Agreement' }), h('dd', { text: U.pctI(g.agreement) }),
            h('dt', { text: 'False pass' }), h('dd', { text: g.falsePassRate === null ? '– (you failed none)' : U.pct(g.falsePassRate) + ' · judge passed ' + cf.falsePass + ' of ' + (cf.falsePass + cf.agreeFail) + ' answers you failed' }),
            h('dt', { text: 'False fail' }), h('dd', { text: g.falseFailRate === null ? '– (you passed none)' : U.pct(g.falseFailRate) + ' · judge failed ' + cf.falseFail + ' of ' + (cf.falseFail + cf.agreePass) + ' you passed' })),
          h('table', { class: 'matrix', 'aria-label': 'Judge verdict against your label' },
            h('thead', null, h('tr', null, h('th', null), h('th', { text: 'You: pass' }), h('th', { text: 'You: fail' }))),
            h('tbody', null,
              h('tr', null, h('th', { text: 'Judge: pass' }), h('td', { class: 'agree', text: String(cf.agreePass) }), h('td', { class: 'miss', text: String(cf.falsePass) })),
              h('tr', null, h('th', { text: 'Judge: fail' }), h('td', { class: 'miss', text: String(cf.falseFail) }), h('td', { class: 'agree', text: String(cf.agreeFail) })))),
          g.enoughLabels ? null : h('div', { class: 'warn', style: 'margin-top:12px', text: 'Only ' + g.n + ' labels: with fewer than 30, these numbers are too uncertain to act on.' }));
      });
      var skipped = [];
      if (C.unmatched.length) skipped.push(C.unmatched.length + ' label' + (C.unmatched.length === 1 ? '' : 's') + ' match no stored verdict');
      if (C.onErrored) skipped.push(C.onErrored + ' on errored verdicts');
      var dis = res.disagreements || [];
      var disTable = dis.length ? h('div', { class: 'card scroll', style: 'padding:6px 10px' },
        h('table', null,
          h('thead', null, h('tr', null, h('th', { text: 'Case' }), h('th', { text: 'Run' }), h('th', { class: 'num', text: 'Attempt' }), h('th', { text: 'Scorer' }), h('th', { text: 'Judge' }), h('th', { text: 'You' }))),
          h('tbody', null, dis.map(function (d) {
            return h('tr', null,
              h('td', { class: 'id' }, h('a', { href: '#/runs/' + enc(d.runId) + '?case=' + enc(d.caseId), text: d.caseId })),
              h('td', null, h('a', { class: 'rid', href: '#/runs/' + enc(d.runId), text: d.runId.slice(0, 8) })),
              h('td', { class: 'num', text: String(d.attempt) }),
              h('td', { text: d.scorer }),
              h('td', null, U.statusOf(d.judgePass ? U.ST.passed : U.ST.failed)),
              h('td', null, U.statusOf(d.label === 'pass' ? U.ST.passed : U.ST.failed)));
          })))) : h('p', { class: 'meta', text: 'The judge agreed with every label.' });
      root.replaceChild(h('div', null,
        h('p', { class: 'meta', style: 'margin:-12px 0 20px', text: C.labels + ' labels, ' + C.used + ' matched to stored verdicts' + (skipped.length ? ' · ' + skipped.join(' · ') : '') }),
        h('div', { class: 'cal-grid' }, cards),
        h('section', { class: 'block' }, h('h2', { class: 'sec', text: 'Where the judge disagreed with you' }), disTable),
        h('p', { class: 'info' }, 'Gate on it in CI: ', h('code', { text: 'behavtest calibrate --min-kappa 0.6' }), ' exits 1 unless every judge has at least 30 labels and kappa at or above 0.6.')), holder);
    }, function (err) { if (live()) root.replaceChild(failed(err), root.querySelector('.loading')); });
  }

  // ---- router ----
  var token = 0;
  function route() {
    var mine = ++token;
    var live = function () { return mine === token; };
    var raw = location.hash.replace(/^#/, '') || '/';
    var qi = raw.indexOf('?');
    var path = qi < 0 ? raw : raw.slice(0, qi);
    var q = new URLSearchParams(qi < 0 ? '' : raw.slice(qi + 1));
    var parts = path.split('/').filter(Boolean);
    var id;
    try { id = parts[1] === undefined ? undefined : decodeURIComponent(parts[1]); } catch (e) { id = parts[1]; }
    window.scrollTo(0, 0);
    if (parts[0] === 'runs' && id) runPage(id, q, live);
    else if (parts[0] === 'compare') comparePage(q, live);
    else if (parts[0] === 'matrices' && id) matrixPage(id, q, live);
    else if (parts[0] === 'matrices') matricesPage(live);
    else if (parts[0] === 'calibration') calibrationPage(live);
    else runsPage(q, live);
    var t = { runs: 'Run', compare: 'Compare', matrices: 'Matrix', calibration: 'Calibration' }[parts[0]];
    document.title = 'BehavTest' + (t ? ' · ' + t : ' · Runs');
  }
  window.addEventListener('hashchange', route);
  route();
})();
`;

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface DashboardPageOptions {
  version: string;
  /** Shown in the header so you know which database you are looking at. */
  db?: string;
}

/** The dashboard page. Config is embedded as JSON with `<`, `>` and `&` escaped. */
export function renderDashboard(opts: DashboardPageOptions): string {
  const config = JSON.stringify({ version: opts.version, db: opts.db ?? null })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">
<title>BehavTest</title>
<script>${EARLY_THEME_JS}</script>
<style>${CSS}${DASH_CSS}</style>
</head>
<body>
<div id="app"><div class="wrap"><p class="meta">Loading the BehavTest ${escapeHtml(opts.version)} dashboard…</p><noscript><p class="meta">The dashboard needs JavaScript.</p></noscript></div></div>
<script type="application/json" id="behavtest-config">${config}</script>
<script>${UI_LIB}${DASH_APP}</script>
</body>
</html>
`;
}

/** Exposed for tests. */
export const DASHBOARD_JS = DASH_APP;
