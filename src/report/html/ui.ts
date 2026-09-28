// Browser code shared by the single-file HTML report and the `regrade serve` dashboard.
// Plain JavaScript (ES5 style, no dependencies), kept as strings and inlined into the pages.
// Every value from a run is inserted with textContent, never as HTML.

/** The shared library: defines the global `RegradeUI`. */
export const UI_LIB = String.raw`
var RegradeUI = (function () {
  'use strict';
  var root = document.documentElement;

  // ---- tiny DOM helper: strings become text nodes, never HTML ----
  function add(node, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (x) { add(node, x); }); return; }
    node.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
  }
  function h(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) add(node, arguments[i]);
    return node;
  }

  // ---- formatting ----
  function pct(r, d) { return (r * 100).toFixed(d || 0) + '%'; }
  function pctI(p) { return pct(p.rate) + ' [' + pct(p.lo) + '–' + pct(p.hi) + ']'; }
  function pts(d) { var v = d * 100; var s = Math.abs(v) < 0.05 ? '0.0' : Math.abs(v).toFixed(1); return (v < 0 ? '-' : v > 0 ? '+' : '') + s + ' pts'; }
  function ms(x) { return Math.round(x).toLocaleString('en-US') + ' ms'; }
  function usd(n) { return n === 0 ? '$0' : n < 0.0001 ? '<$0.0001' : '$' + n.toFixed(4); }
  function when(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString(); }
  function runLabel(m) {
    var p = [m.runId.slice(0, 8), when(m.startedAt)];
    if (m.variant) p.push('[' + m.variant + ']');
    if (m.label) p.push(m.label);
    if (m.gitSha) p.push(m.gitSha.slice(0, 7) + (m.gitDirty ? '*' : ''));
    if (m.status !== 'completed') p.push(m.status);
    return p.join(' · ');
  }

  // ---- status vocabulary: colour is never the only channel (icon + label always) ----
  var ST = {
    passed:  ['✓', 'Passed',  '--good'],
    failed:  ['✗', 'Failed',  '--critical'],
    flaky:   ['~', 'Flaky',   '--warning'],
    errored: ['!', 'Errored', '--serious']
  };
  var CH = {
    regressed: ['✗', 'Regressed', '--critical'],
    improved:  ['✓', 'Improved',  '--good'],
    flaky:     ['~', 'Flaky',     '--warning'],
    errored:   ['!', 'Errored',   '--serious'],
    unchanged: ['·', 'Unchanged', '--neutral'],
    modified:  ['·', 'Modified',  '--neutral'],
    'new':     ['+', 'New',       '--neutral'],
    removed:   ['−', 'Removed',   '--neutral']
  };
  function badgeOf(meta) { return h('span', { class: 'badge', style: '--c:var(' + meta[2] + ')', 'aria-hidden': 'true', text: meta[0] }); }
  function statusOf(meta) { return h('span', { class: 'status' }, badgeOf(meta), h('span', { text: meta[1] })); }

  // ---- theme (auto / light / dark, shared with the documentation site) ----
  function themeButton() {
    var modes = ['auto', 'light', 'dark'];
    var cur = 'auto';
    try { cur = localStorage.getItem('regrade-theme') || 'auto'; } catch (e) {}
    var btn = h('button', { class: 'btn', type: 'button', 'aria-label': 'Change colour theme' });
    function apply() {
      if (cur === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', cur);
      btn.textContent = 'Theme: ' + cur;
    }
    btn.addEventListener('click', function () {
      cur = modes[(modes.indexOf(cur) + 1) % modes.length];
      try { localStorage.setItem('regrade-theme', cur); } catch (e) {}
      apply();
    });
    apply();
    return btn;
  }

  // ---- summary tiles ----
  function statusBar(c) {
    var order = ['passed', 'flaky', 'failed', 'errored'];
    var label = order.map(function (k) { return c[k] + ' ' + k; }).join(', ');
    var bar = h('div', { class: 'bar', role: 'img', 'aria-label': 'Cases by outcome: ' + label });
    var legend = h('ul', { class: 'legend' });
    order.forEach(function (k) {
      if (!c[k]) return;
      bar.appendChild(h('span', { class: 'seg', style: 'flex:' + c[k] + ';background:var(' + ST[k][2] + ')', title: c[k] + ' ' + k }));
      legend.appendChild(h('li', null, badgeOf(ST[k]), ST[k][1], h('b', { text: String(c[k]) })));
    });
    return h('div', null, bar, legend);
  }
  function tile(label, value, sub, extra) {
    return h('section', { class: 'card' },
      h('h2', { class: 'tlabel', text: label }),
      h('div', { class: 'tvalue', text: value }),
      sub ? h('div', { class: 'tsub', text: sub }) : null,
      extra);
  }
  /** Summary tiles for a run: S is its summary, rate its attempt pass rate (Wilson) or null. */
  function tiles(S, rate) {
    var c = S.cases, t = [];
    t.push(tile('Cases passed', c.passed + ' / ' + c.total, c.total ? pct(c.passed / c.total) + ' of cases' : '', statusBar(c)));
    if (rate && rate.attempts > 0) {
      t.push(tile('Attempt pass rate', pct(rate.rate),
        '95% Wilson interval ' + pct(rate.lo) + '–' + pct(rate.hi) + ' · ' + S.attempts.total + ' attempt' + (S.attempts.total === 1 ? '' : 's')));
    }
    if (S.latency) t.push(tile('Latency', ms(S.latency.avgMs), 'average · p95 ' + ms(S.latency.p95Ms)));
    var unknown = S.costUsd.unknownAttempts, total = S.attempts.total;
    var costValue = (total > 0 && unknown === total) ? 'unknown' : usd(S.costUsd.pipeline);
    var costSub = [];
    if (unknown > 0 && unknown < total) costSub.push(unknown + ' attempt' + (unknown === 1 ? '' : 's') + ' with unknown cost');
    if (S.costUsd.judge > 0) costSub.push('judge ' + usd(S.costUsd.judge));
    t.push(tile('Pipeline cost', costValue, costSub.join(' · ') || (costValue === 'unknown' ? 'the pipeline reported no usage or price' : '')));
    return h('div', { class: 'grid' }, t);
  }

  // ---- comparison ----
  var VERDICT = {
    'significant-regression': 'significant regression',
    'significant-improvement': 'significant improvement',
    'not-significant': 'not significant',
    'no-comparable-cases': 'no comparable cases'
  };
  function comparison(C) {
    if (!C) return null;
    var reg = C.counts.regressed, o = C.overall;
    var facts = h('dl', { class: 'facts' },
      h('dt', { text: 'Base' }), h('dd', { text: runLabel(C.base) }),
      h('dt', { text: 'Head' }), h('dd', { text: runLabel(C.head) }));
    if (o.base && o.head) {
      facts.appendChild(h('dt', { text: 'Attempt pass rate' }));
      facts.appendChild(h('dd', { text: pctI(o.base) + ' → ' + pctI(o.head) + '  (' + o.comparableCases + ' comparable case' + (o.comparableCases === 1 ? '' : 's') + '; descriptive)' }));
    }
    if (o.meanDelta !== null) {
      var ci = o.ci ? ', 95% CI [' + pts(o.ci.lo) + ', ' + pts(o.ci.hi) + ']' : '';
      var pv = o.pValue === null ? '' : ', p=' + (o.pValue < 0.0001 ? '<0.0001' : o.pValue.toFixed(4));
      facts.appendChild(h('dt', { text: 'Overall change' }));
      facts.appendChild(h('dd', { text: 'mean per case ' + pts(o.meanDelta) + ci + pv + ' → ' + VERDICT[o.verdict] + '  (case-stratified permutation test; interval from a within-case bootstrap)' }));
    }
    var bl = C.metrics.base.latency, hl = C.metrics.head.latency;
    if (bl && hl) {
      facts.appendChild(h('dt', { text: 'Latency' }));
      facts.appendChild(h('dd', { text: 'avg ' + ms(bl.avgMs) + ' → ' + ms(hl.avgMs) + ' · p95 ' + ms(bl.p95Ms) + ' → ' + ms(hl.p95Ms) }));
    }
    var counts = Object.keys(CH).map(function (k) { return k + ' ' + C.counts[k]; }).join(' · ');
    facts.appendChild(h('dt', { text: 'Cases' }));
    facts.appendChild(h('dd', { text: counts }));

    var shown = C.cases.filter(function (c) { return c.change !== 'unchanged'; });
    var table = null;
    if (shown.length) {
      var rows = shown.map(function (c) {
        var evidence = [];
        if (c.change === 'regressed' || c.change === 'improved') {
          evidence.push('p = ' + (c.pValue === undefined ? '–' : c.pValue.toFixed(3)) + (c.significant ? ' · significant' : ''));
        }
        return h('tr', null,
          h('td', null, statusOf(CH[c.change])),
          h('td', { class: 'id', text: c.caseId }),
          h('td', { class: 'num', text: c.base ? c.base.passed + '/' + c.base.attempts : '–' }),
          h('td', { class: 'num', text: c.head ? c.head.passed + '/' + c.head.attempts : '–' }),
          h('td', { class: 'num', text: c.base && c.head ? pct(c.base.rate) + ' → ' + pct(c.head.rate) : '' }),
          h('td', null, evidence.join(''), c.note ? h('span', { class: 'note', text: c.note }) : null));
      });
      table = h('div', { class: 'scroll' },
        h('table', null,
          h('caption', { class: 'meta', style: 'text-align:left;padding-bottom:6px', text: 'Cases that changed between the two runs' }),
          h('thead', null, h('tr', null,
            h('th', { text: 'Change' }), h('th', { text: 'Case' }),
            h('th', { class: 'num', text: 'Base' }), h('th', { class: 'num', text: 'Head' }),
            h('th', { class: 'num', text: 'Pass rate' }), h('th', { text: 'Evidence' }))),
          h('tbody', null, rows)));
    }
    var unchanged = C.counts.unchanged;
    return h('section', { class: 'block card' },
      h('div', { class: 'cmp-head' },
        badgeOf(reg > 0 ? ST.failed : ST.passed),
        h('div', null,
          h('h2', { text: reg > 0 ? reg + ' regressed case' + (reg === 1 ? '' : 's') : 'No regressed cases' }),
          h('p', { class: 'meta', text: 'Compared with ' + runLabel(C.base) }))),
      C.warnings.map(function (w) { return h('div', { class: 'warn', text: 'Warning: ' + w }); }),
      facts,
      table,
      unchanged ? h('p', { class: 'meta', style: 'margin-top:8px', text: unchanged + ' unchanged case' + (unchanged === 1 ? '' : 's') + ' not listed.' }) : null);
  }

  // ---- labels: your own pass/fail on judged answers ----
  // A label store is { get(caseId, attempt, scorer) -> 'pass'|'fail'|undefined, set(caseId, attempt, scorer, value|undefined) }.
  // set may return a Promise (the dashboard saves to its API); a rejected save reverts the buttons.
  function labelButtons(store, caseId, attempt, scorer) {
    var pass = h('button', { type: 'button', class: 'lb', 'data-v': 'pass', text: 'Pass' });
    var fail = h('button', { type: 'button', class: 'lb', 'data-v': 'fail', text: 'Fail' });
    function sync() {
      var v = store.get(caseId, attempt, scorer);
      pass.setAttribute('aria-pressed', v === 'pass' ? 'true' : 'false');
      fail.setAttribute('aria-pressed', v === 'fail' ? 'true' : 'false');
    }
    function set(v) {
      var next = store.get(caseId, attempt, scorer) === v ? undefined : v;
      var saving = store.set(caseId, attempt, scorer, next);
      sync();
      if (saving && saving.then) saving.then(sync, function () { sync(); });
    }
    pass.addEventListener('click', function () { set('pass'); });
    fail.addEventListener('click', function () { set('fail'); });
    sync();
    return h('div', { class: 'lab', role: 'group', 'aria-label': 'Your label for this answer (' + scorer + ')' },
      h('span', { class: 'lt', text: 'Your label:' }), pass, fail);
  }

  // ---- cases ----
  function kv(k, v) { return h('div', { class: 'kv' }, h('div', { class: 'k', text: k }), h('pre', { text: v })); }
  function attemptBlock(a, caseId, labels) {
    var head = h('div', { class: 'ahead' }, statusOf(ST[a.status]), h('span', { class: 'cnum', text: 'Attempt ' + a.attempt }));
    if (a.latencyMs !== null) head.appendChild(h('span', { class: 'cnum', text: ms(a.latencyMs) }));
    head.appendChild(h('span', { class: 'cnum', text: a.costUsd === null ? 'cost unknown' : usd(a.costUsd) }));
    var block = h('div', { class: 'attempt' }, head);
    if (a.error) block.appendChild(h('p', { class: 'err', text: 'Error: ' + a.error }));
    if (a.output !== null && a.output !== undefined) block.appendChild(kv('Output', a.output));
    if (a.scores.length) {
      var list = h('ul', { class: 'scores' });
      a.scores.forEach(function (s) {
        var m = s.error ? ST.errored : (s.pass ? ST.passed : ST.failed);
        list.appendChild(h('li', null, badgeOf(m), h('span', { class: 'sn', text: s.scorerName }),
          h('div', null,
            h('span', { class: 'sr', text: s.error ? 'error: ' + s.error : (s.reasoning || (s.pass ? 'passed' : 'failed')) }),
            s.note ? h('div', { class: 'sm', text: s.note }) : null,
            s.judged && labels ? labelButtons(labels, caseId, a.attempt, s.scorerName) : null)));
      });
      block.appendChild(list);
    }
    if (a.trace && a.trace.length) block.appendChild(traceBlock(a.trace));
    return block;
  }
  function flatSteps(steps, depth, out) {
    steps.forEach(function (s) { out.push({ s: s, depth: depth }); flatSteps(s.children || [], depth + 1, out); });
    return out;
  }
  function traceBlock(steps) {
    var rows = flatSteps(steps, 0, []);
    var end = 0;
    rows.forEach(function (r) { if (r.s.start !== null && r.s.duration !== null) end = Math.max(end, r.s.start + r.s.duration); });
    var list = h('div', { class: 'steps' });
    rows.forEach(function (r) {
      var s = r.s;
      var bar = h('div', { class: 'bar' });
      if (end > 0 && s.start !== null && s.duration !== null) {
        var fill = h('span', { class: 'fill' });
        fill.style.left = (s.start / end * 100) + '%';
        fill.style.width = Math.max(0.5, s.duration / end * 100) + '%';
        bar.appendChild(fill);
      }
      var name = h('span', { class: 'sname', text: s.name });
      name.style.paddingLeft = (r.depth * 14) + 'px';
      var line = h('div', { class: 'step' + (s.error ? ' serr' : '') },
        h('span', { class: 'kind', text: s.kind }), name, bar,
        h('span', { class: 'cnum', text: s.duration === null ? '' : ms(s.duration) }));
      if (s.error || s.input !== null || s.output !== null) {
        list.appendChild(h('details', { class: 'srow' }, h('summary', null, line),
          s.error ? h('p', { class: 'err', text: 'Error: ' + s.error }) : null,
          s.input !== null ? kv('Step input', s.input) : null,
          s.output !== null ? kv('Step output', s.output) : null));
      } else {
        list.appendChild(h('div', { class: 'srow' }, line));
      }
    });
    return h('details', { class: 'trace' }, h('summary', { text: 'Trace · ' + rows.length + (rows.length === 1 ? ' step' : ' steps') }), list);
  }
  function caseBody(c, labels) {
    var body = h('div', { class: 'cbody' }, kv('Input', c.inputText));
    if (c.expected !== null && c.expected !== undefined) body.appendChild(kv('Expected', c.expected));
    c.attempts.forEach(function (a) { body.appendChild(attemptBlock(a, c.caseId, labels)); });
    return body;
  }
  /**
   * One case. opts.labels: a label store (buttons on judged verdicts). opts.load: function returning a
   * Promise of the full case (with traces), fetched the first time the case is opened.
   */
  function caseItem(c, open, opts) {
    opts = opts || {};
    var passed = c.attempts.filter(function (a) { return a.status === 'passed'; }).length;
    var lat = c.attempts.filter(function (a) { return a.latencyMs !== null; });
    var avg = lat.length ? lat.reduce(function (s, a) { return s + a.latencyMs; }, 0) / lat.length : null;
    var tags = (c.tags && c.tags.length) ? h('span', { class: 'tags' }, c.tags.map(function (t) { return h('span', { class: 'tag', text: t }); })) : null;
    var body = opts.load ? h('div', { class: 'cbody' }, h('p', { class: 'meta', text: 'Loading…' })) : caseBody(c, opts.labels);
    var details = h('details', { class: 'case', open: open ? true : false },
      h('summary', null,
        statusOf(ST[c.verdict]),
        h('span', null, h('span', { class: 'cid', text: c.caseId }), tags),
        h('span', { class: 'cnum', text: passed + '/' + c.attempts.length + ' passed' }),
        h('span', { class: 'cnum', text: avg === null ? '' : ms(avg) })),
      body);
    if (opts.load) {
      var loaded = false;
      var fill = function () {
        if (loaded || !details.open) return;
        loaded = true;
        opts.load(c).then(function (full) { details.replaceChild(caseBody(full, opts.labels), body); body = null; },
          function (err) { loaded = false; body.textContent = ''; body.appendChild(h('p', { class: 'err', text: 'Could not load this case: ' + (err && err.message ? err.message : err) })); });
      };
      details.addEventListener('toggle', fill);
      if (open) setTimeout(fill, 0);
    }
    return details;
  }
  var RANK = { errored: 0, failed: 1, flaky: 2, passed: 3 };
  /** The case list with outcome filters and search. extra: an element shown above the list (or null). opts.openCase: open that case (else the first failing one). */
  function casesSection(allCases, opts, extra) {
    var cases = allCases.slice().sort(function (a, b) { return RANK[a.verdict] - RANK[b.verdict]; });
    var state = { f: 'all', q: '' };
    var list = h('div', { class: 'cases' });
    var chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter cases by outcome' });
    var firstBad = -1;
    cases.forEach(function (c, i) { if (firstBad < 0 && c.verdict !== 'passed') firstBad = i; });

    function draw() {
      list.textContent = '';
      var n = 0;
      cases.forEach(function (c, i) {
        if (state.f !== 'all' && c.verdict !== state.f) return;
        if (state.q && (c.caseId + ' ' + (c.tags || []).join(' ')).toLowerCase().indexOf(state.q) < 0) return;
        var open = opts.openCase ? c.caseId === opts.openCase : (i === firstBad && state.f === 'all' && !state.q);
        var item = caseItem(c, open, opts);
        list.appendChild(item);
        if (open && opts.openCase) setTimeout(function () { item.scrollIntoView({ block: 'start' }); }, 0);
        n++;
      });
      if (!n) list.appendChild(h('div', { class: 'empty', text: 'No cases match.' }));
    }
    function chip(key, label, count) {
      var b = h('button', { class: 'chip', type: 'button', 'aria-pressed': state.f === key ? 'true' : 'false', text: label + ' ' + count });
      b.addEventListener('click', function () {
        state.f = key;
        Array.prototype.forEach.call(chips.children, function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        draw();
      });
      return b;
    }
    chips.appendChild(chip('all', 'All', cases.length));
    ['errored', 'failed', 'flaky', 'passed'].forEach(function (k) {
      var n = cases.filter(function (c) { return c.verdict === k; }).length;
      if (n) chips.appendChild(chip(k, ST[k][1], n));
    });
    var search = h('input', { class: 'search', type: 'search', placeholder: 'Search cases', 'aria-label': 'Search cases' });
    search.addEventListener('input', function () { state.q = search.value.toLowerCase(); draw(); });
    draw();
    var section = h('section', { class: 'block' }, h('h2', { class: 'sec', text: 'Cases' }), h('div', { class: 'tools' }, chips, search), extra, list);
    section.redraw = draw;
    return section;
  }
  function hasJudged(cases) {
    return cases.some(function (c) { return c.attempts.some(function (a) { return a.scores.some(function (s) { return s.judged; }); }); });
  }

  // ---- matrix: variants side by side ----
  var MVERDICT = {
    'significant-regression': 'significantly worse',
    'significant-improvement': 'significantly better',
    'not-significant': 'not significant',
    'no-comparable-cases': 'no comparable cases'
  };
  function vsText(v) {
    var r = v.vsReference;
    if (!r) return 'reference';
    if (r.meanDelta === null) return MVERDICT[r.verdict];
    var ci = r.ci ? ' [' + pts(r.ci.lo) + ', ' + pts(r.ci.hi) + ']' : '';
    var p = r.pValue === null ? '' : ', p=' + (r.pValue < 0.0001 ? '<0.0001' : r.pValue.toFixed(3));
    return pts(r.meanDelta) + ci + p + ' · ' + MVERDICT[r.verdict];
  }
  function costOf(S) {
    if (S.attempts.total && S.costUsd.unknownAttempts === S.attempts.total) return 'unknown';
    return usd(S.costUsd.pipeline + S.costUsd.judge) + (S.costUsd.unknownAttempts ? '+' : '');
  }
  /** Dot-and-interval rows: each variant's attempt pass rate and its 95% interval, a hairline at the reference. */
  function intervalChart(M) {
    var ref = M.variants.filter(function (v) { return v.variant === M.reference; })[0];
    var refRate = ref && ref.attemptRate ? ref.attemptRate.rate : null;
    var tip = null;
    var box = h('div', { class: 'ichart', role: 'list', 'aria-label': 'Attempt pass rate per variant, with 95% intervals' });
    function at(x) { return (x * 100) + '%'; }
    function track(v) {
      var t = h('div', { class: 'itrack' });
      [0, 0.25, 0.5, 0.75, 1].forEach(function (g) { var l = h('span', { class: 'igrid' }); l.style.left = at(g); t.appendChild(l); });
      if (refRate !== null) { var rl = h('span', { class: 'iref' }); rl.style.left = at(refRate); t.appendChild(rl); }
      if (v.attemptRate) {
        var span = h('span', { class: 'ispan' });
        span.style.left = at(v.attemptRate.lo);
        span.style.width = at(Math.max(0, v.attemptRate.hi - v.attemptRate.lo));
        var dot = h('span', { class: 'idot' });
        dot.style.left = at(v.attemptRate.rate);
        t.appendChild(span); t.appendChild(dot);
      }
      return t;
    }
    function show(row, v) {
      if (!tip) { tip = h('div', { class: 'tip' }); box.appendChild(tip); }
      tip.textContent = '';
      tip.appendChild(h('div', null, h('b', { text: v.variant }), h('span', { class: 'tm', text: '  ' + v.pipeline })));
      tip.appendChild(h('div', { text: v.attemptRate ? pctI(v.attemptRate) + ' of attempts passed' : 'no scored attempts' }));
      tip.appendChild(h('div', { text: v.summary.cases.passed + ' of ' + v.summary.cases.total + ' cases passed · ' + v.summary.cases.flaky + ' flaky · ' + costOf(v.summary) }));
      tip.appendChild(h('div', { class: 'tm', text: 'vs ' + M.reference + ': ' + vsText(v) }));
      tip.style.top = (row.offsetTop + row.offsetHeight) + 'px';
    }
    function hide() { if (tip) { tip.remove(); tip = null; } }
    M.variants.forEach(function (v) {
      var row = h('div', { class: 'irow', role: 'listitem', tabindex: '0',
        'aria-label': v.variant + ': ' + (v.attemptRate ? pctI(v.attemptRate) : 'no scored attempts') + '; vs ' + M.reference + ' ' + vsText(v) },
        h('div', { class: 'ilabel' }, h('span', { class: 'iname', text: v.variant }), v.variant === M.reference ? h('span', { class: 'tag', text: 'reference' }) : null,
          v.pipeline !== v.variant ? h('span', { class: 'ipipe', text: v.pipeline }) : null),
        track(v),
        h('div', { class: 'ival', text: v.attemptRate ? pct(v.attemptRate.rate) : '–' }));
      row.addEventListener('pointerenter', function () { show(row, v); });
      row.addEventListener('pointerleave', hide);
      row.addEventListener('focus', function () { show(row, v); });
      row.addEventListener('blur', hide);
      box.appendChild(row);
    });
    var axis = h('div', { class: 'irow iaxis', 'aria-hidden': 'true' }, h('div', { class: 'ilabel' }), h('div', { class: 'itrack' }), h('div', { class: 'ival' }));
    [0, 0.5, 1].forEach(function (g) { var l = h('span', { class: 'itick', text: pct(g) }); l.style.left = at(g); axis.children[1].appendChild(l); });
    box.appendChild(axis);
    return box;
  }
  /** A matrix: the chart, the variant table and the case grid. opts.runHref(runId), opts.caseHref(runId, caseId): optional links. */
  function matrixView(M, opts) {
    opts = opts || {};
    var rows = M.variants.map(function (v) {
      var worse = v.vsReference && v.vsReference.verdict === 'significant-regression';
      var better = v.vsReference && v.vsReference.verdict === 'significant-improvement';
      return h('tr', null,
        h('td', null, opts.runHref ? h('a', { href: opts.runHref(v.runId), text: v.variant }) : v.variant, v.variant === M.reference ? h('span', { class: 'note', text: 'reference' }) : null),
        h('td', { class: 'id', text: v.pipeline }),
        h('td', { class: 'num', text: v.attemptRate ? pctI(v.attemptRate) : '–' }),
        h('td', { class: 'num', text: v.summary.cases.passed + ' / ' + v.summary.cases.total }),
        h('td', { class: 'num', text: String(v.summary.cases.flaky) }),
        h('td', { class: 'num', text: v.summary.latency ? ms(v.summary.latency.p95Ms) : '–' }),
        h('td', { class: 'num', text: costOf(v.summary) }),
        h('td', null, worse ? statusOf(['✗', 'Worse', '--critical']) : better ? statusOf(['✓', 'Better', '--good']) : null,
          h('span', { class: 'note', text: vsText(v) })));
    });
    var variantTable = h('div', { class: 'card scroll', style: 'padding:6px 10px' },
      h('table', null,
        h('thead', null, h('tr', null, h('th', { text: 'Variant' }), h('th', { text: 'Pipeline' }), h('th', { class: 'num', text: 'Attempt pass rate' }),
          h('th', { class: 'num', text: 'Cases passed' }), h('th', { class: 'num', text: 'Flaky' }), h('th', { class: 'num', text: 'p95 latency' }),
          h('th', { class: 'num', text: 'Cost' }), h('th', { text: 'vs ' + M.reference }))),
        h('tbody', null, rows)));

    var differs = function (k) { var s = {}; k.cells.forEach(function (c) { s[c ? c.verdict : 'none'] = 1; }); return Object.keys(s).length > 1; };
    var nDiff = M.cases.filter(differs).length;
    var state = { onlyDiff: nDiff > 0 && M.cases.length > 12 };
    var body = h('tbody');
    function drawGrid() {
      body.textContent = '';
      var shown = M.cases.filter(function (k) { return !state.onlyDiff || differs(k); });
      shown.forEach(function (k) {
        body.appendChild(h('tr', { class: differs(k) ? 'diff' : null },
          h('td', { class: 'id', text: k.caseId }),
          k.cells.map(function (c, i) {
            if (!c) return h('td', { class: 'num', text: '–' });
            var label = c.passed + '/' + c.attempts;
            var inner = h('span', { class: 'status' }, badgeOf(ST[c.verdict]), h('span', { class: 'cnum', text: label }));
            var v = M.variants[i];
            return h('td', { class: 'cell', title: v.variant + ': ' + ST[c.verdict][1] + ', ' + label + ' attempts passed' },
              opts.caseHref ? h('a', { href: opts.caseHref(v.runId, k.caseId), class: 'plain' }, inner) : inner);
          })));
      });
      if (!shown.length) body.appendChild(h('tr', null, h('td', { colspan: String(M.variants.length + 1), class: 'empty', text: 'Every case has the same outcome in every variant.' })));
    }
    var toggle = h('button', { class: 'chip', type: 'button', 'aria-pressed': state.onlyDiff ? 'true' : 'false', text: 'Only cases that differ (' + nDiff + ')' });
    toggle.addEventListener('click', function () { state.onlyDiff = !state.onlyDiff; toggle.setAttribute('aria-pressed', state.onlyDiff ? 'true' : 'false'); drawGrid(); });
    drawGrid();
    var grid = h('div', { class: 'card scroll', style: 'padding:6px 10px' },
      h('table', { class: 'mgrid' },
        h('thead', null, h('tr', null, h('th', { text: 'Case' }), M.variants.map(function (v) { return h('th', { class: 'num', text: v.variant }); }))),
        body));

    return h('div', null,
      M.warnings.map(function (w) { return h('div', { class: 'warn', text: 'Warning: ' + w }); }),
      h('section', { class: 'block card' },
        h('h2', { class: 'sec', text: 'Attempt pass rate by variant' }),
        h('p', { class: 'meta', style: 'margin:-8px 0 12px', text: 'Dots are the pass rate, bars its 95% Wilson interval; the thin line marks the reference (' + M.reference + ').' }),
        intervalChart(M)),
      h('section', { class: 'block' }, h('h2', { class: 'sec', text: 'Variants' }), variantTable,
        h('p', { class: 'meta', style: 'margin-top:8px', text: '"vs" is the mean change in pass rate per case against the reference, with a 95% interval and a case-stratified permutation test (the same statistics as regrade compare).' })),
      h('section', { class: 'block' }, h('h2', { class: 'sec', text: 'Cases' }), h('div', { class: 'tools' }, h('div', { class: 'chips' }, toggle)), grid));
  }

  return {
    matrixView: matrixView, intervalChart: intervalChart, vsText: vsText,
    h: h, pct: pct, pctI: pctI, pts: pts, ms: ms, usd: usd, when: when, runLabel: runLabel,
    ST: ST, CH: CH, badgeOf: badgeOf, statusOf: statusOf, themeButton: themeButton,
    tiles: tiles, tile: tile, statusBar: statusBar, comparison: comparison,
    labelButtons: labelButtons, kv: kv, attemptBlock: attemptBlock, traceBlock: traceBlock,
    caseItem: caseItem, casesSection: casesSection, hasJudged: hasJudged
  };
})();
`;

/** The single-file report: reads the embedded data; labels live in this browser and are exported as JSONL. */
export const REPORT_APP = String.raw`
(function () {
  'use strict';
  var U = RegradeUI, h = U.h;
  var D;
  try { D = JSON.parse(document.getElementById('regrade-data').textContent); } catch (e) { return; }
  var app = document.getElementById('app');
  var run = D.run;

  function header() {
    var meta = ['run ' + run.runId.slice(0, 8), U.when(run.startedAt)];
    if (run.variant) meta.push('variant ' + run.variant);
    if (run.label) meta.push(run.label);
    if (run.gitSha) meta.push(run.gitSha.slice(0, 7) + (run.gitDirty ? '*' : ''));
    if (run.status !== 'completed') meta.push(run.status);
    return h('header', { class: 'top' },
      h('div', null,
        h('div', { class: 'brand', text: 'Regrade' }),
        h('h1', { text: run.suiteName }),
        h('p', { class: 'meta', text: meta.join('  ·  ') })),
      U.themeButton());
  }

  // ---- labels kept in this browser, exported for regrade calibrate ----
  var LKEY = 'regrade-labels:' + run.runId;
  var labels = {};
  try { labels = JSON.parse(localStorage.getItem(LKEY) || '{}') || {}; } catch (e) { labels = {}; }
  var onLabelsChanged = function () {};
  var key = function (caseId, attempt, scorer) { return JSON.stringify([caseId, attempt, scorer]); };
  var store = {
    get: function (caseId, attempt, scorer) { return labels[key(caseId, attempt, scorer)]; },
    set: function (caseId, attempt, scorer, v) {
      var k = key(caseId, attempt, scorer);
      if (v === undefined) delete labels[k]; else labels[k] = v;
      try { localStorage.setItem(LKEY, JSON.stringify(labels)); } catch (e) {}
      onLabelsChanged();
    }
  };
  function labelsJsonl() {
    return Object.keys(labels).map(function (k) {
      var p = JSON.parse(k);
      return JSON.stringify({ run: run.runId, case: p[0], attempt: p[1], scorer: p[2], label: labels[k] });
    }).join('\n') + '\n';
  }
  function labelBar(redraw) {
    if (!U.hasJudged(D.cases)) return null;
    var count = h('span', { class: 'lcount' });
    var exp = h('button', { type: 'button', class: 'btn', text: 'Export labels' });
    var copy = h('button', { type: 'button', class: 'btn', text: 'Copy' });
    var clear = h('button', { type: 'button', class: 'btn', text: 'Clear' });
    var armed = null;
    exp.addEventListener('click', function () {
      var url = URL.createObjectURL(new Blob([labelsJsonl()], { type: 'application/x-ndjson' }));
      var a = h('a', { href: url, download: 'regrade-labels-' + run.runId.slice(0, 8) + '.jsonl' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    copy.addEventListener('click', function () {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(labelsJsonl()).then(function () { copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy'; }, 1400); }, function () {});
    });
    clear.addEventListener('click', function () {
      if (!armed) { // two clicks, no browser dialog
        clear.textContent = 'Click again to clear';
        armed = setTimeout(function () { armed = null; clear.textContent = 'Clear'; }, 3000);
        return;
      }
      clearTimeout(armed); armed = null; clear.textContent = 'Clear';
      labels = {};
      try { localStorage.setItem(LKEY, '{}'); } catch (e) {}
      sync(); redraw();
    });
    function sync() {
      var n = Object.keys(labels).length;
      count.textContent = n + ' labelled';
      exp.disabled = copy.disabled = clear.disabled = n === 0;
    }
    onLabelsChanged = sync;
    sync();
    return h('div', { class: 'labels' },
      h('span', { class: 'lh', text: 'Check the judge: mark judged answers Pass or Fail yourself, export the labels, then run regrade calibrate --labels <file>. Labels are kept in this browser.' }),
      count, exp, copy, clear);
  }

  function footer() {
    return h('footer', { text: 'Generated by Regrade ' + D.version + ' on ' + U.when(D.generatedAt) + '. This report is a single self-contained file: it loads nothing from the network. Outputs are shown exactly as the pipeline returned them.' });
  }

  var redraw = function () {};
  var bar = labelBar(function () { redraw(); });
  var cases = U.casesSection(D.cases, { labels: store }, bar);
  redraw = cases.redraw;
  var wrap = h('div', { class: 'wrap' }, header(), U.tiles(D.summary, D.attemptRate), U.comparison(D.comparison), cases, footer());
  app.textContent = '';
  app.appendChild(wrap);
})();
`;

/** Everything the single-file report runs. */
export const JS = UI_LIB + REPORT_APP;
