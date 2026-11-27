/* 성적 관리: 수행평가 관리 / 기타 평가 관리 / 성적 추이 / 성적 조회 */
(() => {
'use strict';
const APP = window.APP;
const { S, h, api, toast, errMsg, clone, kvGet } = APP;

const curSem = () => { const m = new Date().getMonth() + 1; return m >= 2 && m <= 7 ? '1' : '2'; };
const GR = { cfg: null, data: {}, tab: 'perf', ptab: 'base', sem: curSem(), subId: null, evalId: null, dirty: false,
  creating: false, editing: false, tmode: 'student', tStu: null, tAsm: null, tSel: null, vStu: null, vSel: null, vDetail: true };
APP.onLock.push(() => { GR.cfg = null; GR.data = {}; GR.dirty = false; });

const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const defCfg = () => ({ labels: ['매우잘함', '잘함', '보통', '노력요함'], perf: { '1': [], '2': [] }, evals: [] });
const autoCuts = (max) => [0.7, 0.3, 0.1].map((r) => Math.floor(max * r + 1e-9));
const LV_CLASS = ['lv0', 'lv1', 'lv2', 'lv3'];
const perfKey = (sem, sid) => `grade:perf:${sem}:${sid}`;
const evalKey = (id) => `grade:eval:${id}`;
const stuName = (n) => (S.roster.find((x) => Number(x.num) === Number(n)) || {}).name || n + '번';
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const fmt = (n) => (n == null ? '-' : Math.floor(n + 1e-9));   // 소수점 아래는 버림
const bandIdx = (cuts, sc) => (sc == null ? -1 : sc >= cuts[0] ? 0 : sc >= cuts[1] ? 1 : sc >= cuts[2] ? 2 : 3);
const norm = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/[①-⑩]/g, (c) => String('①②③④⑤⑥⑦⑧⑨⑩'.indexOf(c) + 1));
const evMax = (ev) => {
  if (ev.type !== 'answers') return Number(ev.max) || 0;
  const sum = ev.items.reduce((s, i) => s + (Number(i.pts) || 0), 0);
  return ev.total && Math.abs(sum - ev.total) < 0.01 ? Number(ev.total) : Math.round(sum * 100) / 100;
};
/* 점수 직접 입력 평가의 열(1회, 2회 …) */
const colsOf = (ev) => (ev.cols && ev.cols.length ? ev.cols : [{ id: 'c1', name: '점수' }]);
const rowOf = (d, n) => { const o = d.scores && d.scores[n]; return o == null ? {} : typeof o === 'object' ? o : { c1: o }; };

function evalTotal(ev, d, n) {
  if (ev.type === 'score') {   // 여러 회의 평균
    const r = rowOf(d, n), v = colsOf(ev).map((c) => num(r[c.id])).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  const resp = d.answers && d.answers[n];
  if (!resp || !resp.some((r) => String(r || '').trim() !== '')) return null;
  return ev.items.reduce((s, it, i) => s + (norm(resp[i]) !== '' && norm(resp[i]) === norm(it.ans) ? Number(it.pts) || 0 : 0), 0);
}
const evalCols = (ev) => (ev.type === 'answers' ? ev.items.map((_, i) => `${i + 1}번`) : colsOf(ev).map((c) => c.name));
const evalCells = (ev, d, n) => (ev.type === 'answers' ? ev.items.map((_, i) => ((d.answers || {})[n] || [])[i] || '') : colsOf(ev).map((c) => { const v = rowOf(d, n)[c.id]; return v == null ? '' : v; }));
/* 기본 평가: 기초학력평가 (삭제 불가, 문항 응답 자동 채점) */
const BASE_ID = 'base', BASE2_ID = 'base2', DICT_ID = 'dict';
const baseItems = () => Array.from({ length: 20 }, () => ({ ans: '', pts: 5 }));
function ensureBaseEval() {
  const E = GR.cfg.evals;
  let b = E.find((e) => e.id === BASE_ID);
  if (!b) { b = { id: BASE_ID, type: 'answers', total: 100, items: baseItems(), cut: null, created: 0 }; E.unshift(b); }
  Object.assign(b, { fixed: true, group: 'base', sub: b.sub || '국어' }); b.name = `기초학력평가 ${b.sub}`;
  let b2 = E.find((e) => e.id === BASE2_ID);
  if (!b2) { b2 = { id: BASE2_ID, type: 'answers', total: 100, items: baseItems(), cut: null, created: 0 }; E.splice(E.indexOf(b) + 1, 0, b2); }
  Object.assign(b2, { fixed: true, group: 'base', sub: b2.sub || '수학' }); b2.name = `기초학력평가 ${b2.sub}`;
  let dc = E.find((e) => e.id === DICT_ID) || E.find((e) => e.type === 'score' && e.name.trim() === '받아쓰기');
  if (!dc) { dc = { id: DICT_ID, name: '받아쓰기', type: 'score', max: 100, cut: null, items: [], cols: [{ id: 'c1', name: '1회' }], created: 0 }; E.splice(E.indexOf(b2) + 1, 0, dc); }
  dc.fixed = true;
}
async function ensure() {
  if (GR.cfg) return;
  const j = await kvGet(['grade:cfg']);
  GR.cfg = Object.assign(defCfg(), j['grade:cfg'] || {});
  GR.cfg.perf = Object.assign({ '1': [], '2': [] }, GR.cfg.perf);
  ensureBaseEval();
}
async function loadKeys(keys) {
  const need = keys.filter((k) => !(k in GR.data));
  if (!need.length) return;
  const j = await kvGet(need);
  need.forEach((k) => { GR.data[k] = j[k] || (k.startsWith('grade:perf') ? { scores: {} } : { scores: {}, answers: {} }); });
}
const saveCfg = () => APP.kvSet('grade:cfg', GR.cfg);

/* 모든 평가를 한 줄로 */
function assessments() {
  const out = [];
  ['1', '2'].forEach((sem) => GR.cfg.perf[sem].forEach((sub) => sub.items.forEach((it) => out.push({
    id: `p:${sem}:${sub.id}:${it.id}`, label: `${sem}학기 ${sub.name} - ${it.name}`, short: `${sem}학기 ${sub.name.slice(0, 4)}·${it.name.slice(0, 5)}`,
    max: Number(it.max) || 0, kind: 'perf', sub, it, cuts: it.cuts, key: perfKey(sem, sub.id) }))));
  GR.cfg.evals.forEach((ev) => out.push({ id: 'e:' + ev.id, label: ev.name, short: ev.name.slice(0, 9), max: evMax(ev), kind: 'eval', ev, key: evalKey(ev.id) }));
  return out;
}
function scoreOf(a, n) {
  const d = GR.data[a.key]; if (!d) return null;
  return a.kind === 'perf' ? num(d.scores && d.scores[n] && d.scores[n][a.it.id]) : evalTotal(a.ev, d, n);
}
async function loadAll() { await loadKeys([...new Set(assessments().map((a) => a.key))]); }

async function exportSheet(name, rows) {
  try { await api('writeTable', { name: '성적_' + name, rows }); } catch (e) { toast('저장은 됐지만 시트 내보내기에 실패했어요: ' + errMsg(e), true); }
}

/* ---------- 페이지 ---------- */
APP.gradeCore = { GR, ensure, loadKeys, perfKey, bandIdx, semToggle: (r) => semToggle(r), num, fmt, saveCfg: () => saveCfg(), exportSheet: (n, r) => exportSheet(n, r) };
APP.pages.grade = () => {
  const wrap = h('div', { class: 'gr-page' }), body = h('div'), tabs = h('div', { class: 'tabs' });
  // 표 너비: 맞춤(내용만큼) / 좁게 / 보통 / 꽉 차게 — 이 브라우저에 기억
  const TW = [['fit', '맞춤'], ['s', '좁게'], ['m', '보통'], ['full', '꽉 차게']];
  let tw = 'full'; try { tw = localStorage.getItem('grade_tw') || 'full'; } catch (e) { /* 기본 */ }
  wrap.dataset.tw = tw;
  const twCtl = () => h('div', { class: 'tw-seg', title: '성적 관리 표의 너비' }, h('span', null, '표 너비'), TW.map(([v, n]) => h('button', { class: 'sm' + (wrap.dataset.tw === v ? ' on' : ''), onclick: () => { wrap.dataset.tw = v; try { localStorage.setItem('grade_tw', v); } catch (e) { /* 저장 안 됨 */ } drawTabs(); } }, n)));
  const drawTabs = () => tabs.replaceChildren(...[['perf', '수행평가 관리'], ['etc', '기타 평가 관리'], ['trend', '성적 추이'], ['view', '성적 조회'], ['cmt', '평어 관리'], ['gen', '평어 생성']].map(([id, n]) =>
    h('button', { class: 'tab' + (GR.tab === id ? ' active' : ''), onclick: () => { GR.tab = id; drawTabs(); draw(); } }, n)), h('div', { style: 'flex:1' }), twCtl(), h('button', { class: 'sm', onclick: exportGrades }, '내보내기'));
  const draw = async () => {
    body.replaceChildren(APP.loading());
    try {
      await ensure();
      if (!S.roster.length) return body.replaceChildren(h('div', { class: 'card placeholder' }, '먼저 학급 기초설정에서 명렬표를 입력해 주세요.'));
      let v;
      if (GR.tab === 'perf') v = await viewPerf(draw);
      else if (GR.tab === 'etc') v = await viewEtc(draw);
      else if (GR.tab === 'cmt') v = await APP.comment.manage(draw);
      else if (GR.tab === 'gen') v = await APP.comment.generate(draw);
      else { await loadAll(); v = GR.tab === 'trend' ? viewTrend(draw) : viewLookup(draw); }
      body.replaceChildren(v);
    } catch (e) { body.replaceChildren(h('div', { class: 'banner warn' }, errMsg(e))); }
  };
  wrap.append(tabs, body); drawTabs(); draw();
  return wrap;
};

async function exportGrades() {
  try { await ensure(); await loadAll(); } catch (e) { return toast(errMsg(e), true); }
  const roster = APP.roster(), asm = assessments(), items = [];
  const bandName = (cuts, sc) => { const b = bandIdx(cuts, sc); return b < 0 ? '' : GR.cfg.labels[b]; };
  if (asm.length) items.push({ id: 'all', group: '종합', label: '전체 성적표 (학생 × 평가)', name: '성적_전체', rows: [['번호', '이름', ...asm.map((a) => a.label)], ...roster.map((s) => [s.num, s.name, ...asm.map((a) => scoreOf(a, s.num))])] });
  ['1', '2'].forEach((sem) => GR.cfg.perf[sem].forEach((sb) => {
    const d = GR.data[perfKey(sem, sb.id)] || { scores: {} }, sc = (s, it) => num(d.scores && d.scores[s.num] && d.scores[s.num][it.id]);
    items.push({ id: `p${sem}${sb.id}`, group: '수행평가', label: `${sem}학기 ${sb.name}`, name: `성적_${sem}학기_${sb.name}`,
      rows: [['번호', '이름', ...sb.items.map((i) => `${i.name}(${i.max})`), ...sb.items.map((i) => `${i.name} 평어`)], ...roster.map((s) => [s.num, s.name, ...sb.items.map((it) => sc(s, it)), ...sb.items.map((it) => bandName(it.cuts, sc(s, it)))])] });
  }));
  GR.cfg.evals.forEach((ev) => {
    const d = GR.data[evalKey(ev.id)] || { scores: {}, answers: {} }, ans = ev.type === 'answers', max = evMax(ev);
    const head = ['번호', '이름', ...evalCols(ev), ans ? '총점' : '평균', ev.cut != null ? '기준 도달' : ''];
    const body = roster.map((s) => { const t = evalTotal(ev, d, s.num); return [s.num, s.name, ...evalCells(ev, d, s.num), t == null ? '' : Math.round(t * 10) / 10, ev.cut != null && t != null ? (t >= ev.cut ? '도달' : '미도달') : '']; });
    items.push({ id: 'e' + ev.id, group: '기타 평가', label: ev.name, name: `성적_${ev.name}`, rows: [head, ...(ans ? [['', '정답', ...ev.items.map((i) => i.ans), max, '']] : []), ...body] });
  });
  APP.exporter.open({ title: '성적', items, empty: '내보낼 평가가 아직 없어요' });
}

const semToggle = (redraw) => h('div', { class: 'tabs' }, ['1', '2'].map((s) =>
  h('button', { class: 'tab sm' + (GR.sem === s ? ' active' : ''), onclick: () => { GR.sem = s; GR.subId = null; redraw(); } }, s + '학기')));
/* 표 안의 입력칸을 화살표로 이동 (data-r: 학생, data-c: 칸) */
function gridNav(wrap) {
  wrap.addEventListener('keydown', (e) => {
    const t = e.target; if (!t.classList || !t.classList.contains('gcell')) return;
    const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const r = Number(t.dataset.r) + d[0], c = Number(t.dataset.c) + d[1];
    const nx = wrap.querySelector(`.gcell[data-r="${r}"][data-c="${c}"]`);
    if (nx) { nx.focus(); if (nx.select) nx.select(); }
  });
  return wrap;
}
const dirtyNote = () => (GR.dirty ? h('span', { class: 'muted' }, '저장하지 않은 변경이 있습니다') : null);

/* =====================================================
   수행평가 관리
   ===================================================== */
async function viewPerf(redraw) {
  const sub = h('div', { class: 'tabs' }, [['base', '기초작업'], ['eval', '평가']].map(([id, n]) =>
    h('button', { class: 'tab sm' + (GR.ptab === id ? ' active' : ''), onclick: () => { GR.ptab = id; redraw(); } }, n)));
  return h('div', null, sub, GR.ptab === 'base' ? perfBase(redraw) : await perfEval(redraw));
}

function perfBase(redraw) {
  const cfg = GR.cfg, labels = cfg.labels, subs = cfg.perf[GR.sem];
  const dirty = () => { GR.dirty = true; };
  const labelRow = h('div', { class: 'row' }, h('span', { class: 'muted' }, '평어 이름'),
    labels.map((l, i) => h('input', { value: l, style: 'width:96px', onchange: (e) => { labels[i] = e.target.value.trim() || l; dirty(); redraw(); } })));
  const cards = subs.map((sb, si) => h('div', { class: 'card' },
    h('div', { class: 'row gap' }, h('input', { value: sb.name, placeholder: '과목명', style: 'font-weight:700;width:180px', onchange: (e) => { sb.name = e.target.value; dirty(); } }),
      h('button', { class: 'sm ghost', onclick: () => { if (confirm(`"${sb.name}" 과목을 삭제할까요? (입력한 점수는 시트에 남아 있어요)`)) { subs.splice(si, 1); dirty(); redraw(); } } }, '과목 삭제')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'roster survey' },
      h('thead', null, h('tr', null, h('th', null, '평가기준'), h('th', null, '만점'), [0, 1, 2].map((i) => h('th', null, `${labels[i]} 기준(이상)`)), h('th', null, `${labels[3]}`), h('th', null, ''))),
      h('tbody', null, sb.items.map((it, ii) => h('tr', null,
        h('td', null, h('input', { value: it.name, placeholder: '예) 발표하기', style: 'min-width:180px;width:100%', onchange: (e) => { it.name = e.target.value; dirty(); } })),
        h('td', null, h('input', { type: 'number', value: it.max, style: 'width:70px;text-align:center', onchange: (e) => { it.max = num(e.target.value) || 0; it.cuts = autoCuts(it.max); dirty(); redraw(); } })),
        [0, 1, 2].map((i) => h('td', null, h('input', { type: 'number', step: 'any', value: it.cuts[i], style: 'width:78px;text-align:center', onchange: (e) => { it.cuts[i] = num(e.target.value) || 0; dirty(); } }))),
        h('td', { class: 'muted' }, `그 미만`),
        h('td', { class: 'del' }, h('button', { class: 'sm ghost', onclick: () => { sb.items.splice(ii, 1); dirty(); redraw(); } }, '✕'))))))),
    h('div', { style: 'margin-top:8px' }, h('button', { class: 'sm', onclick: () => { sb.items.push({ id: uid('i'), name: '', max: 5, cuts: autoCuts(5) }); dirty(); redraw(); } }, '+ 평가기준 추가'))));
  return h('div', null, semToggle(redraw),
    h('div', { class: 'card' }, labelRow, h('div', { class: 'muted', style: 'margin-top:6px' }, '기준 점수는 만점의 70%·30%·10%로 자동 채워져요. (만점 100점이면 70·30·10점) 직접 고쳐도 됩니다.')),
    cards,
    h('div', { class: 'row' }, h('button', { onclick: () => { subs.push({ id: uid('s'), name: '', items: [{ id: uid('i'), name: '', max: 5, cuts: autoCuts(5) }] }); dirty(); redraw(); } }, '+ 과목 추가'),
      h('div', { style: 'flex:1' }), dirtyNote(),
      h('button', { class: 'primary', onclick: async () => {
        for (const sb of subs) for (const it of sb.items) {
          const nm = `${sb.name || '(과목)'} - ${it.name || '(평가기준)'}`;
          if (!(it.max > 0)) return toast(`${nm}: 만점은 0보다 커야 해요`, true);
          if (it.cuts.some((c) => c > it.max)) return toast(`${nm}: 기준 점수가 만점(${it.max}점)보다 클 수 없어요`, true);
          if (!(it.cuts[0] >= it.cuts[1] && it.cuts[1] >= it.cuts[2])) return toast(`${nm}: 기준 점수는 ${labels[0]} ≥ ${labels[1]} ≥ ${labels[2]} 순서여야 해요`, true);
        }
        try { await saveCfg(); GR.dirty = false; toast('기초작업을 저장했습니다'); redraw(); } catch (e) { toast(errMsg(e), true); } } }, '저장')));
}

async function perfEval(redraw) {
  const subs = GR.cfg.perf[GR.sem].filter((s) => s.items.length);
  if (!subs.length) return h('div', null, semToggle(redraw), h('div', { class: 'card placeholder' }, `${GR.sem}학기 과목이 없습니다. "기초작업"에서 과목과 평가기준을 먼저 만들어 주세요.`));
  const sb = subs.find((s) => s.id === GR.subId) || subs[0]; GR.subId = sb.id;
  const key = perfKey(GR.sem, sb.id); await loadKeys([key]);
  const d = GR.data[key], labels = GR.cfg.labels;
  const sel = h('select', { value: sb.id, onchange: (e) => { GR.subId = e.target.value; redraw(); } }, subs.map((s) => h('option', { value: s.id }, s.name || '(이름 없음)')));
  const rows = APP.roster().map((s, ri) => {
    const tds = sb.items.map((it, ci) => {
      const chip = h('span', { class: 'lvchip' });
      const upd = () => {
        const v = num(d.scores[s.num] && d.scores[s.num][it.id]), bi = bandIdx(it.cuts, v);
        chip.textContent = bi < 0 ? '' : labels[bi]; chip.className = 'lvchip ' + (bi < 0 ? '' : LV_CLASS[bi]);
      };
      const inp = h('input', { type: 'number', step: 'any', min: 0, max: it.max, class: 'gcell', 'data-r': ri, 'data-c': ci, value: d.scores[s.num] && d.scores[s.num][it.id] != null ? d.scores[s.num][it.id] : '',
        oninput: (e) => {
          const v = e.target.value; d.scores[s.num] = d.scores[s.num] || {};
          if (v === '') delete d.scores[s.num][it.id]; else d.scores[s.num][it.id] = Number(v);
          inp.classList.toggle('bad', Number(v) > it.max || Number(v) < 0); GR.dirty = true; upd();
        } });
      upd();
      return h('td', { class: 'sc' }, inp, chip);
    });
    return h('tr', { class: APP.gcls(s.gender) }, h('td', { class: 'sv-name' }, `${s.num} ${s.name}`), tds);
  });
  return h('div', null, semToggle(redraw),
    h('div', { class: 'card' },
      h('div', { class: 'row gap' }, sel, h('span', { class: 'muted' }, '점수를 입력하면 평어가 자동으로 나와요.'), h('div', { style: 'flex:1' }), dirtyNote(),
        h('button', { class: 'primary', onclick: async () => {
          const bad = sb.items.some((it) => APP.roster().some((s) => { const v = num(d.scores[s.num] && d.scores[s.num][it.id]); return v != null && (v > it.max || v < 0); }));
          if (bad) return toast('만점을 넘거나 0보다 작은 점수가 있습니다', true);
          try {
            await APP.kvSet(key, d); GR.dirty = false; toast('점수를 저장했습니다');
            const head = ['번호', '이름', ...sb.items.map((i) => `${i.name}(${i.max})`), ...sb.items.map((i) => `${i.name} 평어`)];
            const body = APP.roster().map((s) => [s.num, s.name, ...sb.items.map((it) => num(d.scores[s.num] && d.scores[s.num][it.id])), ...sb.items.map((it) => { const b = bandIdx(it.cuts, num(d.scores[s.num] && d.scores[s.num][it.id])); return b < 0 ? '' : labels[b]; })]);
            exportSheet(`${GR.sem}학기_${sb.name}`, [head, ...body]);
          } catch (e) { toast(errMsg(e), true); }
        } }, '저장')),
      h('div', { class: 'muted', style: 'margin:4px 0 8px' }, '↑↓ 이전·다음 학생, ←→ 같은 학생의 다른 평가로 이동해요.'),
      gridNav(h('div', { class: 'table-wrap' }, h('table', { class: 'roster survey' },
        h('thead', null, h('tr', null, h('th', null, '학생'), sb.items.map((it) => h('th', null, `${it.name || '(기준)'} / ${it.max}점`)))),
        h('tbody', null, rows))))));
}

/* =====================================================
   기타 평가 관리
   ===================================================== */
async function viewEtc(redraw) {
  const evs = GR.cfg.evals;
  const curEv = evs.find((e) => e.id === GR.evalId);
  const chips = h('div', { class: 'chips' }, evs.filter((e) => !(e.group === 'base' && e.id !== BASE_ID)).map((e) => {
    const on = !GR.creating && (e.id === GR.evalId || (e.group === 'base' && curEv && curEv.group === 'base'));
    return h('button', { class: 'chip' + (on ? ' active' : ''), onclick: () => { GR.evalId = e.group === 'base' && curEv && curEv.group === 'base' ? curEv.id : e.id; GR.creating = false; GR.editing = false; redraw(); } }, e.group === 'base' ? '기초학력평가' : e.name || '(이름 없음)', e.fixed ? h('span', { class: 'chip-lock', title: '기본 평가 (삭제 불가)' }, ' 🔒') : null);
  }),
    h('button', { class: 'chip add', onclick: () => { GR.creating = true; GR.editing = false; redraw(); } }, '+ 평가 추가'));
  if (GR.creating) return h('div', null, chips, evalForm(null, redraw));
  const ev = evs.find((e) => e.id === GR.evalId) || evs[0];
  if (!ev) return h('div', null, chips, h('div', { class: 'card placeholder' }, '평가가 없습니다. "+ 평가 추가"로 만들어 보세요.'));
  GR.evalId = ev.id;
  if (GR.editing) return h('div', null, chips, evalForm(ev, redraw));
  return h('div', null, chips, await evalEntry(ev, redraw));
}

function evalForm(ev, redraw) {
  const isNew = !ev;
  const e = ev || { id: uid('e'), name: '', type: 'score', max: 100, cut: 80, items: [], cols: [{ id: 'c1', name: '1회' }], created: Date.now() };
  const box = h('div', { class: 'card' });
  // 만점 ÷ 문항 수 = 모든 문항의 기본 배점
  const equalPts = () => { if (!e.total || !e.items.length) return; const p = e.total / e.items.length; e.items.forEach((it) => { it.pts = Math.round(p * 10000) / 10000; }); };
  const fmtPts = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const draw = () => {
    box.replaceChildren(
      h('h3', null, isNew ? '새 평가 만들기' : '평가 설정 수정'),
      e.group === 'base'
        ? h('div', { class: 'field' }, h('label', null, '과목 이름'), h('input', { value: e.sub, placeholder: '예) 국어', style: 'width:100%;max-width:200px', oninput: (x) => { e.sub = x.target.value.trim().slice(0, 12) || e.sub; e.name = `기초학력평가 ${e.sub}`; } }),
          h('div', { class: 'muted', style: 'margin-top:4px' }, '기초학력평가는 기본 평가라서 삭제할 수 없어요. 과목 이름만 바꿀 수 있어요.'))
        : h('div', { class: 'field' }, h('label', null, '평가 이름'), h('input', { value: e.name, disabled: !!e.fixed, placeholder: '예) 단원평가 3단원', style: 'width:100%;max-width:360px', oninput: (x) => { e.name = x.target.value; } }),
          e.fixed ? h('div', { class: 'muted', style: 'margin-top:4px' }, '기본 평가라서 이름을 바꾸거나 삭제할 수 없어요.') : null),
      h('div', { class: 'field' }, h('label', null, '입력 방식'), h('div', { class: 'radios' },
        [['score', '점수를 직접 입력'], ['answers', '학생별 문항 응답을 입력하면 자동 채점']].map(([v, n]) =>
          h('label', null, h('input', { type: 'radio', name: 'etype', checked: e.type === v, disabled: !isNew, onchange: () => { e.type = v; if (v === 'answers' && !e.items.length) { e.items = Array.from({ length: 10 }, () => ({ ans: '', pts: 10 })); e.total = 100; } draw(); } }), n)))),
      e.type === 'score'
        ? h('div', { class: 'field' }, h('label', null, '만점 (한 회의 만점)'), h('input', { type: 'number', class: 'n', value: e.max, onchange: (x) => { e.max = num(x.target.value) || 0; } }),
          h('div', { class: 'muted', style: 'margin-top:4px' }, '여러 번 보는 평가(예: 받아쓰기)는 점수 입력 화면에서 "+ 열 추가"로 1회, 2회 … 를 늘릴 수 있어요. 마지막 열에 평균이 나와요.'))
        : h('div', { class: 'field' }, h('label', null, '문항 정답과 배점'),
          h('div', { class: 'row gap' }, h('span', null, '문항 수'), h('input', { type: 'number', class: 'n', min: 1, max: 60, value: e.items.length, onchange: (x) => {
            const n = Math.max(1, Math.min(60, Number(x.target.value) | 0)); while (e.items.length < n) e.items.push({ ans: '', pts: 1 }); e.items.length = n; equalPts(); draw(); } }),
            h('span', null, '만점'), h('input', { type: 'number', class: 'n', min: 1, step: 'any', value: e.total || evMax(e), onchange: (x) => { e.total = num(x.target.value) || 0; equalPts(); draw(); } }),
            h('span', { class: 'muted' }, `문항당 ${fmtPts(e.items.length ? (e.total || 0) / e.items.length : 0)}점 · 문항별 배점을 따로 고칠 수도 있어요 · 정답은 숫자, ①~⑤, O/X, 글자 모두 가능`)),
          h('div', { class: 'qgrid' }, e.items.map((it, i) => h('div', { class: 'q' }, h('b', null, i + 1),
            h('input', { value: it.ans, placeholder: '정답', oninput: (x) => { it.ans = x.target.value; } }),
            h('input', { type: 'number', step: 'any', value: fmtPts(it.pts), title: '배점', oninput: (x) => { it.pts = num(x.target.value) || 0; e.total = Math.round(e.items.reduce((a, q) => a + (Number(q.pts) || 0), 0) * 100) / 100; } }))))),
      h('div', { class: 'field' }, h('label', null, '기준 점수 (이 점수 이상이면 "기준 도달")'), h('input', { type: 'number', step: 'any', class: 'n', value: e.cut == null ? '' : e.cut, onchange: (x) => { e.cut = num(x.target.value); } })),
      h('div', { class: 'row', style: 'justify-content:flex-end' },
        h('button', { onclick: () => { GR.creating = false; GR.editing = false; redraw(); } }, '취소'),
        !isNew && !e.fixed ? h('button', { class: 'danger', onclick: async () => {
          if (!confirm(`"${e.name}" 평가를 삭제할까요? 입력한 점수도 사라집니다.`)) return;
          try { GR.cfg.evals = GR.cfg.evals.filter((x) => x.id !== e.id); await saveCfg(); await APP.kvDel(evalKey(e.id)); delete GR.data[evalKey(e.id)]; GR.evalId = null; GR.editing = false; redraw(); } catch (x) { toast(errMsg(x), true); }
        } }, '평가 삭제') : null,
        h('button', { class: 'primary', onclick: async () => {
          if (!e.name.trim()) return toast('평가 이름을 입력하세요', true);
          if (evMax(e) <= 0) return toast('만점이 0보다 커야 합니다', true);
          if (e.cut != null && e.cut > evMax(e)) return toast(`기준 점수(${e.cut}점)가 만점(${evMax(e)}점)보다 클 수 없어요. 기준 점수를 고쳐 주세요.`, true);
          if (e.cut != null && e.cut < 0) return toast('기준 점수는 0 이상이어야 해요', true);
          if (isNew) GR.cfg.evals.push(e);
          try { await saveCfg(); GR.evalId = e.id; GR.creating = false; GR.editing = false; toast('평가를 저장했습니다'); redraw(); } catch (x) { toast(errMsg(x), true); }
        } }, '저장')));
  };
  draw();
  return box;
}

async function evalEntry(ev, redraw) {
  const key = evalKey(ev.id); await loadKeys([key]);
  const d = GR.data[key]; d.scores = d.scores || {}; d.answers = d.answers || {};
  const max = evMax(ev), roster = APP.roster();
  const cols = ev.type === 'score' ? colsOf(ev) : [];
  if (ev.type === 'score') { if (!ev.cols || !ev.cols.length) ev.cols = cols; roster.forEach((s) => { if (typeof d.scores[s.num] === 'number') d.scores[s.num] = { c1: d.scores[s.num] }; }); }
  const stats = h('div', { class: 'row muted', style: 'margin-bottom:10px' });
  const upStats = () => {
    const vals = roster.map((s) => evalTotal(ev, d, s.num)).filter((v) => v != null);
    stats.textContent = vals.length ? `입력 ${vals.length}명 · 평균 ${fmt(vals.reduce((a, b) => a + b, 0) / vals.length)}점 · 최고 ${fmt(Math.max(...vals))} · 최저 ${fmt(Math.min(...vals))}${ev.cut != null ? ` · 기준 도달 ${vals.filter((v) => v >= ev.cut).length}명` : ''}` : '아직 입력된 점수가 없습니다';
  };
  const rows = roster.map((s, ri) => {
    const res = h('td', { class: 'sc-res' }), tot = h('td', { class: 'sc-tot' });
    const upd = () => {
      const t = evalTotal(ev, d, s.num);
      tot.textContent = t == null ? '' : `${fmt(t)}점`;
      res.replaceChildren(t == null || ev.cut == null ? '' : h('span', { class: 'lvchip ' + (t >= ev.cut ? 'lv0' : 'lv3') }, t >= ev.cut ? '기준 도달' : '미도달'));
      upStats();
    };
    let cells;
    if (ev.type === 'score') {
      cells = cols.map((c, ci) => { const r = rowOf(d, s.num);
        return h('td', null, h('input', { type: 'number', step: 'any', min: 0, max, class: 'gcell' + (c.locked ? ' locked' : ''), disabled: !!c.locked, 'data-r': ri, 'data-c': ci, value: r[c.id] != null ? r[c.id] : '', style: 'width:76px;text-align:center', oninput: (e) => {
          const v = e.target.value, o = (d.scores[s.num] = typeof d.scores[s.num] === 'object' && d.scores[s.num] ? d.scores[s.num] : {});
          if (v === '') delete o[c.id]; else o[c.id] = Number(v);
          if (!Object.keys(o).length) delete d.scores[s.num];
          e.target.classList.toggle('bad', Number(v) > max || Number(v) < 0); GR.dirty = true; upd(); } })); });
    } else {
      cells = ev.items.map((it, i) => {
        const inp = h('input', { class: 'ans gcell', 'data-r': ri, 'data-c': i, value: (d.answers[s.num] || [])[i] || '', oninput: (e) => {
          const arr = (d.answers[s.num] = d.answers[s.num] || []); arr[i] = e.target.value; GR.dirty = true; mark(); upd(); } });
        const mark = () => { const r = norm(inp.value); inp.classList.toggle('ok', r !== '' && r === norm(it.ans)); inp.classList.toggle('no', r !== '' && r !== norm(it.ans)); };
        mark(); return h('td', null, inp);
      });
    }
    upd();
    return h('tr', { class: APP.gcls(s.gender) }, h('td', { class: 'sv-name' }, `${s.num} ${s.name}`), cells, ev.type === 'score' ? h('td') : null, tot, res);
  });
  upStats();
  const colHead = (c) => h('th', { class: 'col-th' + (c.locked ? ' locked' : '') },
    h('button', { class: 'col-name', title: c.locked ? '눌러서 잠금 풀기' : '눌러서 잠그기', onclick: async () => { c.locked = !c.locked; try { await saveCfg(); } catch (x) { toast(errMsg(x), true); } redraw(); } }, (c.locked ? '🔒 ' : '') + c.name),
    h('button', { class: 'col-edit', title: '열 이름 바꾸기', onclick: async () => { const n = prompt('열 이름', c.name); if (!n || !n.trim()) return; c.name = n.trim().slice(0, 20); try { await saveCfg(); } catch (x) { toast(errMsg(x), true); } redraw(); } }, '✎'),
    cols.length > 1 ? h('button', { class: 'col-edit', title: '열 삭제', onclick: async () => {
      if (!confirm(`"${c.name}" 열을 삭제할까요? 이 열에 입력한 점수도 지워져요.`)) return;
      ev.cols = cols.filter((x) => x !== c); Object.values(d.scores).forEach((o) => { if (o && typeof o === 'object') delete o[c.id]; });
      try { await saveCfg(); await APP.kvSet(key, d); } catch (x) { toast(errMsg(x), true); } redraw();
    } }, '✕') : null);
  const addCol = async () => {
    const n = prompt('새 열 이름', `${cols.length + 1}회`); if (!n || !n.trim()) return;
    cols.forEach((c) => { c.locked = true; });   // 새 열을 만들면 앞의 열은 잠가서 실수로 고치지 않게
    ev.cols = [...cols, { id: uid('c'), name: n.trim().slice(0, 20) }];
    try { await saveCfg(); } catch (x) { toast(errMsg(x), true); } redraw();
  };
  const head = h('tr', null, h('th', null, '학생'),
    ev.type === 'score' ? [cols.map(colHead), h('th', null, h('button', { class: 'sm', onclick: addCol }, '+ 열 추가'))] : ev.items.map((it, i) => h('th', { title: `정답 ${it.ans} / ${Math.round(it.pts * 100) / 100}점` }, i + 1)),
    h('th', null, ev.type === 'score' ? '평균' : '총점'), h('th', null, ev.cut != null ? `기준 ${ev.cut}점` : '결과'));
  const subTabs = ev.group === 'base' ? h('div', { class: 'tabs', style: 'margin-bottom:10px' }, GR.cfg.evals.filter((x) => x.group === 'base').map((x) =>
    h('button', { class: 'tab' + (x.id === ev.id ? ' active' : ''), onclick: () => { if (GR.dirty && !confirm('저장하지 않은 입력이 있어요. 다른 과목으로 갈까요?')) return; GR.dirty = false; GR.evalId = x.id; redraw(); } }, x.sub))) : null;
  const delBtn = ev.fixed ? null : h('button', { class: 'sm danger', onclick: async () => {
    if (!confirm(`"${ev.name}" 평가를 삭제할까요? 입력한 점수도 모두 사라져요.`)) return;
    try { GR.cfg.evals = GR.cfg.evals.filter((x) => x.id !== ev.id); await saveCfg(); await APP.kvDel(key); delete GR.data[key]; GR.evalId = null; GR.dirty = false; toast('평가를 삭제했어요'); redraw(); } catch (x) { toast(errMsg(x), true); }
  } }, '평가 삭제');
  const pdfBtn = ev.type === 'answers' ? h('button', { class: 'sm', onclick: () => pdfGrade(ev, d, key, redraw) }, '📄 PDF로 정답·답안 불러오기') : null;
  return h('div', { class: 'card' }, subTabs,
    h('div', { class: 'row gap' }, h('b', null, ev.name), h('span', { class: 'muted' }, `${ev.type === 'score' ? `점수 직접 입력 · 한 회 만점 ${max}점` : `문항 응답 입력(자동 채점) · 만점 ${max}점`}`),
      h('div', { style: 'flex:1' }), dirtyNote(), pdfBtn, h('button', { class: 'sm', onclick: () => { GR.editing = true; redraw(); } }, '설정 수정'), delBtn,
      h('button', { class: 'primary', onclick: async () => {
        if (ev.type === 'score' && roster.some((s) => Object.values(rowOf(d, s.num)).some((v) => v > max || v < 0))) return toast('만점을 넘거나 0보다 작은 점수가 있습니다', true);
        try {
          await APP.kvSet(key, d); GR.dirty = false; toast('저장했습니다');
          const hd = ['번호', '이름', ...evalCols(ev), ev.type === 'score' ? '평균' : '총점', ev.cut != null ? '기준 도달' : ''];
          const body = roster.map((s) => { const t = evalTotal(ev, d, s.num); return [s.num, s.name, ...evalCells(ev, d, s.num), t == null ? '' : Math.round(t * 10) / 10, ev.cut != null && t != null ? (t >= ev.cut ? '도달' : '미도달') : '']; });
          const answerRow = ev.type === 'answers' ? [['', '정답', ...ev.items.map((i) => i.ans), max, '']] : [];
          exportSheet(ev.name, [hd, ...answerRow, ...body]);
        } catch (e) { toast(errMsg(e), true); }
      } }, '저장')),
    stats,
    h('div', { class: 'muted', style: 'margin:-4px 0 8px' }, ev.type === 'answers' ? '←→ 옆 문항, ↑↓ 위아래 학생으로 이동해요. (Tab도 됩니다)' : '↑↓ 이전·다음 학생, ←→ 옆 열로 이동해요. 열 제목을 누르면 잠금/풀림, ✎로 이름 바꾸기. 열을 새로 만들면 앞의 열은 잠겨요.'),
    gridNav(h('div', { class: 'table-wrap' }, h('table', { class: 'roster survey' }, h('thead', null, head), h('tbody', null, rows)))));
}

/* =====================================================
   PDF로 정답·학생 답안 불러오기
   - 평가기준 PDF: 글자를 읽어 "번호 → 정답"을 찾음 (표 모양 / 1. ③ 모양 모두)
   - 답안지 모음 PDF: 쪽마다 학생 이름·번호와 답을 찾음. 손글씨 스캔처럼 글자가 없는 쪽은 그림을 보며 직접 입력
   ===================================================== */
async function loadPdf() {
  if (window.__pdfjs) return window.__pdfjs;
  const base = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
  const m = await import(base + 'pdf.min.mjs');
  m.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
  window.__pdfjs = m; return m;
}
async function readPdf(file, opt) {
  const pdfjs = await loadPdf();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let n = 1; n <= Math.min(doc.numPages, opt.max || 60); n++) {
    const pg = await doc.getPage(n), vp = pg.getViewport({ scale: 1 });
    const tc = await pg.getTextContent();
    const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({ str: it.str, x: it.transform[4], y: vp.height - it.transform[5], h: Math.hypot(it.transform[2], it.transform[3]) }));
    let canvas = null;
    if (opt.render) {
      const sc = Math.min(2, 900 / vp.width), v2 = pg.getViewport({ scale: sc });
      canvas = document.createElement('canvas'); canvas.width = Math.round(v2.width); canvas.height = Math.round(v2.height);
      const cx = canvas.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, canvas.width, canvas.height);
      await pg.render({ canvasContext: cx, canvas, viewport: v2 }).promise;
    }
    pages.push({ n, items, canvas });
    if (opt.onPage) opt.onPage(n, doc.numPages);
  }
  return pages;
}
/* 글자 조각을 줄로 묶기 */
function pdfLines(items) {
  const rows = [];
  items.slice().sort((a, b) => a.y - b.y || a.x - b.x).forEach((it) => {
    const r = rows.find((q) => Math.abs(q.y - it.y) <= Math.max(3, (it.h || 10) * 0.45));
    if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] });
  });
  return rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.str).join(' '));
}
const LABEL = /^(문항|번호|문제|정답|답|배점|점수|번|해설|정답표|채점기준|평가기준|과목|이름|성명)$/;
const toks = (line) => line.replace(/([①-⑩])/g, ' $1 ').replace(/[|,·]/g, ' ').split(/\s+/).map((t) => t.replace(/^[(\[]|[.)\]:번]+$/g, '')).filter(Boolean);
const isInt = (t) => /^\d{1,2}$/.test(t);
/* 번호 → 정답 찾기. want: 문항 수(알면) */
function parseAnswers(lines, want) {
  const ans = {}, L = lines.map(toks), used = new Set();
  // ① 표 모양: 한 줄에 연속 번호(1 2 3 …)가 3개 이상 → 다음 줄(또는 그다음 줄)의 답을 차례로
  for (let li = 0; li < L.length; li++) {
    const t = L[li], nums = t.filter(isInt).map(Number);
    if (nums.length < 3 || t.filter((x) => !isInt(x) && !LABEL.test(x)).length > 1) continue;
    let ok = true; for (let k = 1; k < nums.length; k++) if (nums[k] !== nums[k - 1] + 1) { ok = false; break; }
    if (!ok) continue;
    for (let nx = li + 1; nx <= Math.min(li + 2, L.length - 1); nx++) {
      const a2 = L[nx].filter((x) => !LABEL.test(x));
      if (a2.length >= nums.length && !(a2.filter(isInt).length === a2.length && a2.map(Number).every((v, k) => k === 0 || v === Number(a2[k - 1]) + 1))) {
        nums.forEach((nn, k) => { ans[nn] = a2[k]; }); used.add(li); used.add(nx); li = nx; break;
      }
    }
  }
  // ② "1. ③ 2. ④" 모양: 줄이 바뀌어도 이어서, 번호를 1~2개 건너뛰어도 다시 맞춤
  const flat = L.filter((_, i) => !used.has(i)).flat();
  let expect = 1;
  for (let k = 0; k < flat.length - 1; k++) {
    const t = flat[k]; if (!isInt(t)) continue;
    const v = Number(t); if (v < expect || v > expect + 2) continue;
    let a2 = flat[k + 1]; if (LABEL.test(a2)) a2 = flat[k + 2]; if (a2 == null) continue;
    if (isInt(a2) && Number(a2) === v + 1 && flat[k + 2] != null && !isInt(flat[k + 2])) continue;   // 번호만 이어진 경우
    if (ans[v] == null) ans[v] = a2;
    expect = v + 1; k++;
    if (want && expect > want) break;
  }
  const n = want || Math.max(0, ...Object.keys(ans).map(Number));
  return Array.from({ length: n }, (_, i) => (ans[i + 1] == null ? '' : ans[i + 1]));
}
function findStudent(text) {
  const R = APP.roster().slice().sort((a, b) => b.name.length - a.name.length);
  const byName = R.find((s) => s.name && text.includes(s.name));
  if (byName) return byName.num;
  const m = text.match(/(\d{1,2})\s*번/); if (m && R.some((s) => s.num === Number(m[1]))) return Number(m[1]);
  return null;
}
function pdfGrade(ev, d, key, redraw) {
  const roster = APP.roster();
  const body = h('div');
  const close = () => { ov.remove(); redraw(); };
  const ov = h('div', { class: 'overlay' }, h('div', { class: 'modal pdfg' }, h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, h('h3', { style: 'margin:0' }, `📄 PDF로 불러오기 · ${ev.name}`), h('button', { onclick: close }, '닫기')), body));
  document.body.append(ov);
  const S = { key: null, pages: null, per: 1, rows: null, busy: '' };
  const fileBtn = (label, on) => { const inp = h('input', { type: 'file', accept: 'application/pdf', hidden: true, onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) on(f); } }); return [inp, h('button', { class: 'primary', onclick: () => inp.click() }, label)]; };
  const buildRows = () => {
    const per = S.per, groups = [];
    for (let i = 0; i < S.pages.length; i += per) groups.push(S.pages.slice(i, i + per));
    const used = new Set();
    S.rows = groups.map((g) => {
      const lines = g.flatMap((p) => pdfLines(p.items)), text = lines.join('\n');
      let who = findStudent(text); if (who != null && used.has(who)) who = null; if (who != null) used.add(who);
      const a = text.trim() ? parseAnswers(lines.filter((l) => !roster.some((s) => s.name && l.includes(s.name)) && !/(이름|성명|학번|반\s*\d|\d+\s*반)/.test(l)), ev.items.length) : Array(ev.items.length).fill('');
      return { pages: g, who, ans: a, hasText: !!text.trim() };
    });
  };
  const draw = () => {
    const keyBox = h('div', { class: 'pdfg-sec' }, h('h4', null, '① 평가기준(정답) PDF'),
      h('div', { class: 'muted', style: 'font-size:13px;margin-bottom:8px' }, '정답표가 있는 PDF를 올리면 문항 번호와 정답을 찾아요. 틀린 곳은 고친 뒤 "정답 등록"을 눌러요.'),
      S.key ? h('div', null,
        h('div', { class: 'qgrid' }, S.key.map((a, i) => h('div', { class: 'q' }, h('b', null, i + 1), h('input', { value: a, oninput: (e) => { S.key[i] = e.target.value; } })))),
        h('div', { class: 'row gap', style: 'margin-top:8px;justify-content:flex-start' },
          h('span', { class: 'muted' }, `${S.key.length}문항을 찾았어요`), h('button', { class: 'sm', onclick: () => { S.key.push(''); draw(); } }, '+ 문항'), S.key.length > 1 ? h('button', { class: 'sm', onclick: () => { S.key.pop(); draw(); } }, '− 문항') : null,
          h('button', { class: 'sm primary', onclick: async () => {
            const n = S.key.length; if (!n) return;
            const total = ev.total || evMax(ev) || 100;
            ev.items = S.key.map((a, i) => ({ ans: String(a).trim(), pts: (ev.items[i] && n === ev.items.length) ? ev.items[i].pts : Math.round(total / n * 10000) / 10000 }));
            ev.total = total;
            try { await saveCfg(); toast(`정답 ${n}문항을 등록했어요`); if (S.pages) { buildRows(); } draw(); } catch (x) { toast(errMsg(x), true); }
          } }, '정답 등록'))) : null,
      ...fileBtn(S.key ? '다른 PDF 올리기' : '평가기준 PDF 올리기', async (f) => {
        S.busy = '평가기준 PDF를 읽는 중…'; draw();
        try {
          const pages = await readPdf(f, { max: 20 });
          const lines = pages.flatMap((p) => pdfLines(p.items));
          if (!lines.join('').trim()) { S.busy = ''; toast('글자가 없는 PDF(스캔본)라서 정답을 읽지 못했어요. 정답은 "설정 수정"에서 직접 적어 주세요.', true); draw(); return; }
          S.key = parseAnswers(lines, 0); if (!S.key.length) S.key = ev.items.map((i) => i.ans);
          if (!S.key.some((x) => x)) toast('정답을 찾지 못했어요. 칸에 직접 적어 주세요.', true);
        } catch (x) { toast('PDF를 열지 못했어요: ' + (x.message || x), true); }
        S.busy = ''; draw();
      }));
    const ansBox = h('div', { class: 'pdfg-sec' }, h('h4', null, '② 학생 답안지 모음 PDF'),
      h('div', { class: 'muted', style: 'font-size:13px;margin-bottom:8px;line-height:1.6' }, '학생 한 명의 답안지가 몇 쪽인지 고른 뒤 PDF를 올려요. 쪽마다 학생 이름·번호와 답을 찾아 채워요. 손글씨를 스캔한 PDF는 글자를 읽을 수 없어서, 왼쪽 그림을 보며 답을 직접 적으면 돼요.'),
      h('div', { class: 'row gap', style: 'justify-content:flex-start;margin-bottom:8px' }, h('span', null, '학생 한 명당'), h('select', { onchange: (e) => { S.per = Number(e.target.value); if (S.pages) buildRows(); draw(); } }, [1, 2, 3, 4].map((v) => h('option', { value: v, selected: S.per === v }, v + '쪽'))),
        ...fileBtn(S.pages ? '다른 PDF 올리기' : '답안지 PDF 올리기', async (f) => {
          S.busy = '답안지 PDF를 읽는 중…'; draw();
          try { S.pages = await readPdf(f, { render: true, max: 160, onPage: (n, t) => { const b = body.querySelector('.pdfg-busy'); if (b) b.textContent = `답안지 PDF를 읽는 중… ${n}/${t}쪽`; } }); buildRows(); }
          catch (x) { toast('PDF를 열지 못했어요: ' + (x.message || x), true); }
          S.busy = ''; draw();
        })),
      S.rows ? h('div', null,
        h('div', { class: 'muted', style: 'margin-bottom:6px' }, `${S.rows.length}명 분량 · 학생을 찾은 답안지 ${S.rows.filter((r) => r.who != null).length}장 · 글자를 읽은 답안지 ${S.rows.filter((r) => r.hasText).length}장`),
        h('div', { class: 'pdfg-list' }, S.rows.map((r, ri) => {
          const sel = h('select', { onchange: (e) => { r.who = e.target.value ? Number(e.target.value) : null; } }, h('option', { value: '' }, '학생 선택'), roster.map((s) => h('option', { value: s.num, selected: r.who === s.num }, `${s.num} ${s.name}`)));
          const score = h('b', { class: 'pdfg-sc' });
          const upd = () => { const t = ev.items.reduce((acc, it, i) => acc + (norm(r.ans[i]) !== '' && norm(r.ans[i]) === norm(it.ans) ? Number(it.pts) || 0 : 0), 0); score.textContent = `${fmt(t)}점`; };
          const cells = ev.items.map((it, i) => { const inp = h('input', { value: r.ans[i] || '', oninput: (e) => { r.ans[i] = e.target.value; mark(); upd(); } });
            const mark = () => { const v = norm(inp.value); inp.classList.toggle('ok', v !== '' && v === norm(it.ans)); inp.classList.toggle('no', v !== '' && v !== norm(it.ans)); };
            mark(); return h('div', { class: 'q' }, h('b', null, i + 1), inp); });
          upd();
          return h('div', { class: 'pdfg-row' },
            h('div', { class: 'pdfg-img' }, r.pages.map((p) => { const c = p.canvas; c.classList.add('pdfg-cv'); c.onclick = () => c.classList.toggle('big'); return c; })),
            h('div', { class: 'pdfg-form' }, h('div', { class: 'row gap', style: 'justify-content:flex-start' }, h('span', { class: 'muted' }, `${ri + 1}번째`), sel, score, r.hasText ? null : h('span', { class: 'chip-s' }, '글자 없음 · 직접 입력')),
              h('div', { class: 'qgrid' }, cells)));
        })),
        h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:10px;position:sticky;bottom:0;background:var(--surface);padding:8px 0' },
          h('button', { class: 'primary', onclick: async () => {
            const ok = S.rows.filter((r) => r.who != null);
            if (!ok.length) return toast('학생을 고른 답안지가 없어요', true);
            const dup = ok.map((r) => r.who).filter((v, i, a) => a.indexOf(v) !== i);
            if (dup.length) return toast(`같은 학생이 두 번 골라졌어요: ${dup.map((n) => (roster.find((s) => s.num === n) || {}).name).join(', ')}`, true);
            const over = ok.filter((r) => d.answers[r.who] && d.answers[r.who].some((x) => String(x || '').trim())).length;
            if (over && !confirm(`이미 답이 입력된 학생 ${over}명은 새 답으로 바뀌어요. 계속할까요?`)) return;
            ok.forEach((r) => { d.answers[r.who] = ev.items.map((_, i) => String(r.ans[i] || '').trim()); });
            try { await APP.kvSet(key, d); GR.dirty = false; toast(`${ok.length}명의 답을 넣고 채점했어요`); close(); } catch (x) { toast(errMsg(x), true); }
          } }, '채점 결과 반영'))) : null);
    body.replaceChildren(...[S.busy ? h('div', { class: 'banner pdfg-busy' }, S.busy) : null, keyBox, ansBox].filter(Boolean));
  };
  draw();
}

/* =====================================================
   성적 추이 (SVG 그래프)
   ===================================================== */
const C1 = '#2a78d6', C2 = '#eb6834', C3 = '#1baf7a', GRID = '#e5e7eb', INK = '#52514e';
const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs, ...kids) => { const e = document.createElementNS(NS, tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); kids.forEach((c) => e.append(c)); return e; };
const txt = (attrs, s) => { const t = sv('text', attrs); t.textContent = s; return t; };

function chartFrame(W, H, m) {
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sg', role: 'img' });
  [0, 25, 50, 75, 100].forEach((v) => {
    const y = m.t + (1 - v / 100) * (H - m.t - m.b);
    svg.append(sv('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: GRID, 'stroke-width': 1 }), txt({ x: m.l - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: INK }, v + '%'));
  });
  return svg;
}
function legend(items) {
  return h('div', { class: 'row legend2' }, items.map(([c, n, dash]) => h('span', null, h('i', { class: 'dot', style: `background:${c};${dash ? 'opacity:.7' : ''}` }), n)));
}
function lineChart(labels, series, titles) {
  const W = 920, H = 340, m = { l: 104, r: 90, t: 14, b: 92 }, svg = chartFrame(W, H, m);
  const n = labels.length, x = (i) => m.l + (n === 1 ? (W - m.l - m.r) / 2 : (i * (W - m.l - m.r)) / (n - 1)), y = (v) => m.t + (1 - v / 100) * (H - m.t - m.b);
  labels.forEach((l, i) => { const t = txt({ x: x(i), y: H - m.b + 14, 'text-anchor': 'end', 'font-size': 11, fill: INK, transform: `rotate(-30 ${x(i)} ${H - m.b + 14})` }, l); svg.append(t); });
  series.forEach((s) => {
    let d = '', pen = false;
    s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i)},${y(v)}`; pen = true; });
    svg.append(sv('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-dasharray': s.dash ? '6 4' : '' }));
    let last = -1;
    s.values.forEach((v, i) => {
      if (v == null) return; last = i;
      svg.append(sv('circle', { cx: x(i), cy: y(v), r: 4.5, fill: s.color, stroke: '#fff', 'stroke-width': 2 }, (() => { const t = sv('title'); t.textContent = `${s.name} · ${titles[i]}: ${fmt(v)}%`; return t; })()));
    });
    if (last >= 0) svg.append(txt({ x: x(last) + 9, y: y(s.values[last]) + 4, 'font-size': 11, 'font-weight': 600, fill: INK }, s.name));
  });
  return svg;
}
function barChart(names, vals, avg, title) {
  const W = 920, H = 320, m = { l: 48, r: 20, t: 14, b: 46 }, svg = chartFrame(W, H, m);
  const n = names.length, bw = (W - m.l - m.r) / n, y = (v) => m.t + (1 - v / 100) * (H - m.t - m.b);
  vals.forEach((v, i) => {
    const cx = m.l + bw * i + bw / 2;
    if (v != null) {
      const h0 = y(0) - y(v);
      svg.append(sv('path', { d: `M${cx - bw * 0.3},${y(0)} v${-Math.max(h0 - 4, 0)} q0,-4 4,-4 h${bw * 0.6 - 8} q4,0 4,4 v${Math.max(h0 - 4, 0)} z`, fill: C1 }, (() => { const t = sv('title'); t.textContent = `${names[i]}: ${fmt(v)}%`; return t; })()));
    }
    svg.append(txt({ x: cx, y: H - m.b + 16, 'text-anchor': 'middle', 'font-size': bw < 26 ? 9 : 11, fill: INK }, names[i].length > 3 ? names[i].slice(0, 3) : names[i]));
  });
  if (avg != null) svg.append(sv('line', { x1: m.l, x2: W - m.r, y1: y(avg), y2: y(avg), stroke: C2, 'stroke-width': 2, 'stroke-dasharray': '6 4' }), txt({ x: W - m.r, y: y(avg) - 6, 'text-anchor': 'end', 'font-size': 11, 'font-weight': 600, fill: INK }, `학급 평균 ${fmt(avg)}%`));
  return svg;
}
const pct = (a, v) => (v == null || !a.max ? null : (v / a.max) * 100);

/* 평가 고르기 체크박스 (GR[key]: 고른 id 배열, null이면 전체) */
const chosenOf = (key, list) => (GR[key] == null ? list : list.filter((a) => GR[key].includes(a.id)));
function asmPicker(key, list, redraw) {
  const on = new Set(chosenOf(key, list).map((a) => a.id));
  const set = (ids) => { GR[key] = ids.length === list.length ? null : ids; redraw(); };
  const groups = new Map();
  list.forEach((a) => { const g = a.kind === 'perf' ? a.id.split(':')[1] + '학기 수행평가' : '기타 평가'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(a); });
  return h('details', { class: 'asm-pick', open: GR[key + 'Open'] ? '' : null, ontoggle: (e) => { GR[key + 'Open'] = e.target.open; } },
    h('summary', null, `평가 고르기 (${on.size}/${list.length}개 선택)`),
    h('div', { class: 'row', style: 'gap:6px;margin:8px 0' },
      h('button', { class: 'sm', onclick: () => set(list.map((a) => a.id)) }, '전체 선택'),
      h('button', { class: 'sm', onclick: () => set([]) }, '전체 해제')),
    [...groups.entries()].map(([g, arr]) => h('div', { class: 'asm-group' },
      h('label', { class: 'asm-gname' }, h('input', { type: 'checkbox', checked: arr.every((a) => on.has(a.id)), onchange: (e) => { arr.forEach((a) => (e.target.checked ? on.add(a.id) : on.delete(a.id))); set(list.filter((a) => on.has(a.id)).map((a) => a.id)); } }), g),
      h('div', { class: 'asm-items' }, arr.map((a) => h('label', null, h('input', { type: 'checkbox', checked: on.has(a.id), onchange: (e) => { e.target.checked ? on.add(a.id) : on.delete(a.id); set(list.filter((x) => on.has(x.id)).map((x) => x.id)); } }), a.label.replace(/^\d학기 /, '')))))));
}

function viewTrend(redraw) {
  const asm = assessments(), roster = APP.roster();
  if (!asm.length) return h('div', { class: 'card placeholder' }, '아직 평가가 없습니다. 수행평가나 기타 평가를 먼저 입력해 주세요.');
  const withData = asm.filter((a) => roster.some((s) => scoreOf(a, s.num) != null));
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const classVals = (a) => roster.map((s) => pct(a, scoreOf(a, s.num))).filter((v) => v != null);
  const modes = [['student', '학생별'], ['asm', '평가별'], ['class', '학급별']];
  const bar = h('div', { class: 'card' }, h('div', { class: 'row radios' }, modes.map(([v, n]) =>
    h('label', null, h('input', { type: 'radio', name: 'tm', checked: GR.tmode === v, onchange: () => { GR.tmode = v; redraw(); } }), n))));
  let chart, table;
  if (!withData.length) return h('div', null, bar, h('div', { class: 'card placeholder' }, '입력된 점수가 없습니다.'));
  const pickTrend = () => asmPicker('tSel', withData, redraw);
  const use = chosenOf('tSel', withData);
  const none = () => h('div', null, bar, h('div', { class: 'card' }, pickTrend(), h('div', { class: 'placeholder' }, '볼 평가를 하나 이상 골라 주세요.')));
  if (GR.tmode === 'student') {
    if (!use.length) return none();
    const sel = h('select', { value: GR.tStu || roster[0].num, onchange: (e) => { GR.tStu = Number(e.target.value); redraw(); } }, roster.map((s) => h('option', { value: s.num }, `${s.num}번 ${s.name}`)));
    const sn = Number(GR.tStu || roster[0].num);
    const mine = use.map((a) => pct(a, scoreOf(a, sn))), avg = use.map((a) => mean(classVals(a)));
    chart = h('div', null, h('div', { class: 'row gap' }, sel, legend([[C1, stuName(sn)], [C2, '학급 평균', true]])), pickTrend(),
      lineChart(use.map((a) => a.short), [{ name: '학급 평균', values: avg, color: C2, dash: true }, { name: stuName(sn), values: mine, color: C1 }], use.map((a) => a.label)));
    table = [['평가', stuName(sn), '학급 평균'], ...use.map((a, i) => [a.label, fmt(mine[i]) + '%', fmt(avg[i]) + '%'])];
  } else if (GR.tmode === 'asm') {
    const cur = withData.find((a) => a.id === GR.tAsm) || withData[0];
    const sel = h('select', { value: cur.id, onchange: (e) => { GR.tAsm = e.target.value; redraw(); } }, withData.map((a) => h('option', { value: a.id }, a.label)));
    const vals = roster.map((s) => pct(cur, scoreOf(cur, s.num))), avg = mean(vals.filter((v) => v != null));
    chart = h('div', null, h('div', { class: 'row gap' }, sel, legend([[C1, '학생 점수(만점 대비 %)'], [C2, '학급 평균', true]])), barChart(roster.map((s) => s.name), vals, avg, cur.label));
    table = [['학생', '점수', '%'], ...roster.map((s, i) => [`${s.num} ${s.name}`, fmt(scoreOf(cur, s.num)), fmt(vals[i]) + '%'])];
  } else {
    if (!use.length) return none();
    const avg = use.map((a) => mean(classVals(a))), mx = use.map((a) => Math.max(...classVals(a))), mn = use.map((a) => Math.min(...classVals(a)));
    chart = h('div', null, h('div', { class: 'row gap' }, legend([[C1, '평균'], [C3, '최고'], [C2, '최저']])), pickTrend(),
      lineChart(use.map((a) => a.short), [{ name: '최고', values: mx, color: C3 }, { name: '최저', values: mn, color: C2 }, { name: '평균', values: avg, color: C1 }], use.map((a) => a.label)));
    table = [['평가', '평균', '최고', '최저'], ...use.map((a, i) => [a.label, fmt(avg[i]) + '%', fmt(mx[i]) + '%', fmt(mn[i]) + '%'])];
  }
  return h('div', null, bar, h('div', { class: 'card' }, chart,
    h('details', { style: 'margin-top:12px' }, h('summary', null, '표로 보기'),
      h('div', { class: 'table-wrap', style: 'margin-top:8px' }, h('table', { class: 'roster survey' }, h('thead', null, h('tr', null, table[0].map((t) => h('th', null, t)))), h('tbody', null, table.slice(1).map((r) => h('tr', null, r.map((c, i) => h('td', { style: i ? '' : 'text-align:left;padding:6px 10px' }, c))))))))));
}

/* =====================================================
   성적 조회
   ===================================================== */
function viewLookup(redraw) {
  const asm = assessments(), roster = APP.roster();
  if (!asm.length) return h('div', { class: 'card placeholder' }, '아직 평가가 없습니다.');
  const sn = Number(GR.vStu || roster[0].num), labels = GR.cfg.labels;
  const ss = h('select', { value: sn, onchange: (e) => { GR.vStu = Number(e.target.value); redraw(); } }, roster.map((s) => h('option', { value: s.num, selected: s.num === sn }, `${s.num}번 ${s.name}`)));
  const use = chosenOf('vSel', asm);
  const hasAns = use.some((a) => a.kind === 'eval' && a.ev.type === 'answers');
  const radios = h('div', { class: 'radios' }, [[true, '문항별 맞고 틀림 보기'], [false, '점수만 보기']].map(([v, n]) =>
    h('label', null, h('input', { type: 'radio', name: 'vd', checked: GR.vDetail === v, onchange: () => { GR.vDetail = v; redraw(); } }), n)));
  const resultOf = (a) => {
    const sc = scoreOf(a, sn);
    if (sc == null) return '입력 없음';
    if (a.kind === 'perf') { const b = bandIdx(a.cuts, sc); return h('span', null, `${fmt(sc)} / ${a.max}점 `, h('span', { class: 'lvchip ' + LV_CLASS[b] }, labels[b])); }
    return h('span', null, `${fmt(sc)} / ${a.max}점 `, a.ev.cut != null ? h('span', { class: 'lvchip ' + (sc >= a.ev.cut ? 'lv0' : 'lv3') }, sc >= a.ev.cut ? '기준 도달' : '미도달') : null);
  };
  const out = h('div');
  if (!use.length) out.append(h('div', { class: 'placeholder' }, '볼 평가를 하나 이상 골라 주세요.'));
  else {
    out.append(h('div', { class: 'table-wrap' }, h('table', { class: 'roster survey' }, h('thead', null, h('tr', null, ['평가', '결과', '만점 대비'].map((t) => h('th', null, t)))),
      h('tbody', null, use.map((a) => { const sc = scoreOf(a, sn); return h('tr', null, h('td', { style: 'text-align:left;padding:8px 10px' }, a.label), h('td', null, resultOf(a)), h('td', null, sc == null ? '' : fmt(pct(a, sc)) + '%')); })))));
    if (GR.vDetail) use.filter((a) => a.kind === 'eval' && a.ev.type === 'answers' && scoreOf(a, sn) != null).forEach((a) => {
      const resp = (GR.data[a.key].answers || {})[sn] || [];
      out.append(h('h3', { style: 'margin:18px 0 8px' }, a.label, ' — ', resultOf(a)),
        h('div', { class: 'table-wrap' }, h('table', { class: 'roster survey' }, h('thead', null, h('tr', null, ['문항', '학생 응답', '정답', '배점', '결과'].map((t) => h('th', null, t)))),
          h('tbody', null, a.ev.items.map((it, i) => {
            const ok = norm(resp[i]) !== '' && norm(resp[i]) === norm(it.ans), blank = norm(resp[i]) === '';
            return h('tr', null, h('td', null, i + 1), h('td', null, resp[i] || ''), h('td', null, it.ans), h('td', null, it.pts),
              h('td', null, blank ? '' : h('span', { class: 'lvchip ' + (ok ? 'lv0' : 'lv3') }, ok ? 'O' : 'X')));
          })))));
    });
  }
  return h('div', null, h('div', { class: 'card' }, h('div', { class: 'row gap' }, ss, hasAns ? radios : null), asmPicker('vSel', asm, redraw)), h('div', { class: 'card' }, out));
}
})();
