/* 학생 관리: 누가기록 입력 / 사건 검색 / 교우관계도 */
(() => {
'use strict';
const APP = window.APP;
const { S, h, api, toast, errMsg, kvGet } = APP;

const ST = { sub: 'input', logs: null, survey: null, date: null, text: '', editId: null,
  kw: '', stu: '', order: 'desc', gsub: 'graph', layers: { co: true, like: true, dislike: true }, minCo: 1, sel: null };
APP.onLock.push(() => { ST.logs = null; ST.survey = null; ST.text = ''; ST.editId = null; });

/* ---------- 이름 찾기 (성 없이 "철수", 호칭도 인식) ---------- */
function buildAliases() {
  const map = new Map();
  const add = (alias, num) => {
    alias = String(alias || '').trim();
    if (alias.length < 2) return;
    if (!map.has(alias)) map.set(alias, new Set());
    map.get(alias).add(num);
  };
  S.roster.forEach((s) => {
    add(s.name, s.num);
    if (s.name.length >= 3) add(s.name.slice(1), s.num);
    String(s.title || '').split(/[,，、/\s]+/).forEach((t) => add(t, s.num));
  });
  return [...map.entries()].sort((a, b) => b[0].length - a[0].length);
}
function findStudents(text, aliases) {
  const used = new Array(text.length).fill(false);
  const spans = [], nums = new Set(), ambiguous = [];
  aliases.forEach(([alias, set]) => {
    let i = text.indexOf(alias);
    while (i !== -1) {
      const end = i + alias.length;
      if (!used.slice(i, end).some(Boolean)) {
        for (let k = i; k < end; k++) used[k] = true;
        spans.push({ start: i, end, nums: [...set], alias });
        set.forEach((n) => nums.add(n));
        if (set.size > 1 && !ambiguous.includes(alias)) ambiguous.push(alias);
      }
      i = text.indexOf(alias, i + 1);
    }
  });
  spans.sort((a, b) => a.start - b.start);
  return { nums: [...nums].sort((a, b) => a - b), spans, ambiguous };
}
const stuName = (n) => { const s = S.roster.find((x) => Number(x.num) === Number(n)); return s ? s.name : n + '번'; };
const stuOf = (n) => S.roster.find((x) => Number(x.num) === Number(n));

/* 본문 + 이름 강조 + 검색어 강조 */
function highlighted(text, spans, kw) {
  const out = [];
  let pos = 0;
  const plain = (t) => {
    if (!kw) return out.push(t);
    const low = t.toLowerCase(), k = kw.toLowerCase();
    let p = 0, i;
    while ((i = low.indexOf(k, p)) !== -1) {
      if (i > p) out.push(t.slice(p, i));
      out.push(h('mark', { class: 'kw' }, t.slice(i, i + k.length)));
      p = i + k.length;
    }
    if (p < t.length) out.push(t.slice(p));
  };
  spans.forEach((sp) => {
    if (sp.start > pos) plain(text.slice(pos, sp.start));
    const st = stuOf(sp.nums[0]);
    out.push(h('mark', { class: 'nm ' + (sp.nums.length === 1 && st ? APP.gcls(st.gender) : ''), title: sp.nums.map(stuName).join(', ') }, text.slice(sp.start, sp.end)));
    pos = sp.end;
  });
  if (pos < text.length) plain(text.slice(pos));
  return out;
}

/* ---------- 데이터 불러오기 ---------- */
async function ensure() {
  if (ST.logs && ST.survey) return;
  const [lj, kv] = await Promise.all([api('logsLoad'), kvGet(['survey:main'])]);
  ST.logs = lj.logs;
  ST.survey = kv['survey:main'] || { likes: {}, dislikes: {} };
}
function annotate() {
  const al = buildAliases();
  ST.logs.forEach((l) => { const r = findStudents(l.content, al); l._nums = r.nums; l._spans = r.spans; l._amb = r.ambiguous; });
}
const sortedLogs = (dir) => ST.logs.slice().sort((a, b) => (a.date === b.date ? a.created - b.created : a.date < b.date ? -1 : 1) * (dir === 'asc' ? 1 : -1));

/* ---------- 페이지 ---------- */
APP.pages.student = () => {
  const wrap = h('div');
  const body = h('div');
  const tabs = h('div', { class: 'tabs' });
  const drawTabs = () => {
    tabs.replaceChildren(...[['input', '누가기록 입력'], ['search', '사건 검색'], ['graph', '교우관계도']].map(([id, n]) =>
      h('button', { class: 'tab' + (ST.sub === id ? ' active' : ''), onclick: () => { ST.sub = id; drawTabs(); draw(); } }, n)));
  };
  const draw = () => {
    body.replaceChildren();
    if (!S.roster.length) return body.append(h('div', { class: 'card placeholder' }, '먼저 학급 기초설정에서 명렬표를 입력해 주세요.'));
    annotate();
    body.append(ST.sub === 'input' ? viewInput(draw) : ST.sub === 'search' ? viewSearch(draw) : viewGraph(draw));
  };
  wrap.append(tabs, body);
  drawTabs();
  body.append(APP.loading());
  ensure().then(draw).catch((e) => { body.replaceChildren(h('div', { class: 'banner warn' }, errMsg(e))); });
  return wrap;
};

/* ---------- 1. 누가기록 입력 ---------- */
function viewInput(redraw) {
  if (!ST.date) ST.date = APP.today();
  const dateIn = h('input', { type: 'date', value: ST.date, onchange: (e) => { ST.date = e.target.value; } });
  const chips = h('div', { class: 'row', style: 'min-height:34px;margin-top:8px' });
  const warn = h('div', { class: 'muted' });
  const al = buildAliases();
  const upd = () => {
    const r = findStudents(ta.value, al);
    chips.replaceChildren(h('span', { class: 'muted' }, r.nums.length ? '인식된 학생:' : '인식된 학생이 없습니다'),
      ...r.nums.map((n) => h('span', { class: 'chip-s ' + APP.gcls(stuOf(n)?.gender) }, `${n} ${stuName(n)}`)));
    warn.textContent = r.ambiguous.length ? `※ "${r.ambiguous.join('", "')}"은(는) 이름이 같은 학생이 여러 명이라 모두 연결돼요. 성까지 쓰면 정확해요.` : '';
  };
  const ta = h('textarea', { class: 'log-ta', placeholder: '예) 쉬는 시간에 철수와 영희가 블록을 두고 다퉜다. 서로 사과하고 화해함.', value: ST.text, oninput: (e) => { ST.text = e.target.value; upd(); } });
  const saveBtn = h('button', { class: 'primary', onclick: async () => {
    const content = ta.value.trim();
    if (!content) return toast('내용을 입력하세요', true);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ST.date)) return toast('날짜를 확인하세요', true);
    const r = findStudents(content, al);
    const old = ST.editId ? ST.logs.find((l) => l.id === ST.editId) : null;
    const log = { id: old ? old.id : 'l' + Date.now().toString(36), date: ST.date, content, names: r.nums.map(stuName).join(', '), created: old ? old.created : Date.now() };
    saveBtn.disabled = true;
    try {
      await api('logSave', { log });
      if (old) Object.assign(old, log); else ST.logs.push(log);
      ST.text = ''; ST.editId = null; toast('누가기록을 저장했습니다 (구글 시트에도 기록됨)'); redraw();
    } catch (e) { toast(errMsg(e), true); saveBtn.disabled = false; }
  } }, ST.editId ? '수정 저장' : '기록하기');

  const recent = sortedLogs('desc').slice(0, 12);
  return h('div', null,
    h('div', { class: 'card' },
      h('div', { class: 'row gap' }, h('label', { class: 'muted' }, '날짜'), dateIn,
        h('button', { class: 'sm ghost', onclick: () => { ST.date = APP.today(); redraw(); } }, '오늘'),
        ST.editId ? h('span', { class: 'banner', style: 'margin:0;padding:4px 10px' }, '기록을 수정하는 중입니다') : null),
      ta, chips, warn,
      h('div', { class: 'row', style: 'margin-top:10px;justify-content:flex-end' },
        ST.editId ? h('button', { onclick: () => { ST.editId = null; ST.text = ''; redraw(); } }, '수정 취소') : null, saveBtn)),
    h('div', { class: 'card' }, h('h3', null, `최근 기록 (${ST.logs.length}건 중 ${recent.length}건)`),
      recent.length ? recent.map((l) => logItem(l, '', redraw, true)) : h('div', { class: 'muted' }, '아직 기록이 없습니다.')),
    (upd(), null));
}
function logItem(l, kw, redraw, editable) {
  return h('div', { class: 'log-item' },
    h('div', { class: 'row', style: 'justify-content:space-between' },
      h('span', { class: 'log-date' }, l.date),
      h('span', { class: 'row' }, (l._nums || []).map((n) => h('span', { class: 'chip-s ' + APP.gcls(stuOf(n)?.gender) }, `${n} ${stuName(n)}`)),
        editable ? [
          h('button', { class: 'sm ghost', onclick: () => { ST.editId = l.id; ST.text = l.content; ST.date = l.date; ST.sub = 'input'; redraw(); window.scrollTo(0, 0); } }, '수정'),
          h('button', { class: 'sm ghost', onclick: async () => {
            if (!confirm('이 기록을 삭제할까요?')) return;
            try { await api('logDel', { id: l.id }); ST.logs = ST.logs.filter((x) => x.id !== l.id); redraw(); } catch (e) { toast(errMsg(e), true); }
          } }, '삭제')] : null)),
    h('div', { class: 'log-text' }, highlighted(l.content, l._spans || [], kw)));
}

/* ---------- 2. 사건 검색 ---------- */
function viewSearch(redraw) {
  const kwIn = h('input', { placeholder: '검색어', value: ST.kw, style: 'min-width:160px', oninput: (e) => { ST.kw = e.target.value.trim(); list(); } });
  const sel = h('select', { value: ST.stu, onchange: (e) => { ST.stu = e.target.value; list(); } },
    h('option', { value: '' }, '모든 학생'), APP.roster().map((s) => h('option', { value: s.num }, `${s.num}번 ${s.name}`)));
  const radios = h('div', { class: 'radios' }, [['desc', '최신순'], ['asc', '오래된순'], ['num', '학생 번호순']].map(([v, n]) =>
    h('label', null, h('input', { type: 'radio', name: 'ord', checked: ST.order === v, onchange: () => { ST.order = v; list(); } }), n)));
  const out = h('div');
  const list = () => {
    let logs = sortedLogs(ST.order === 'asc' ? 'asc' : 'desc');
    if (ST.kw) logs = logs.filter((l) => l.content.toLowerCase().includes(ST.kw.toLowerCase()));
    if (ST.stu) logs = logs.filter((l) => l._nums.includes(Number(ST.stu)));
    out.replaceChildren();
    out.append(h('div', { class: 'muted', style: 'margin-bottom:8px' }, `${logs.length}건`));
    if (!logs.length) return out.append(h('div', { class: 'card placeholder' }, '조건에 맞는 기록이 없습니다.'));
    if (ST.order !== 'num') return out.append(h('div', { class: 'card' }, logs.map((l) => logItem(l, ST.kw, redraw, true))));
    const groups = new Map();
    logs.forEach((l) => { const ns = l._nums.length ? l._nums : [0]; ns.forEach((n) => { if (ST.stu && n !== Number(ST.stu)) return; if (!groups.has(n)) groups.set(n, []); groups.get(n).push(l); }); });
    [...groups.keys()].sort((a, b) => (a || 9999) - (b || 9999)).forEach((n) => {
      const items = groups.get(n).sort((a, b) => (a.date < b.date ? -1 : 1));
      out.append(h('div', { class: 'card' }, h('h3', null, n ? `${n}번 ${stuName(n)} (${items.length}건)` : `학생 미지정 (${items.length}건)`), items.map((l) => logItem(l, ST.kw, redraw, false))));
    });
  };
  const box = h('div', null,
    h('div', { class: 'card' }, h('div', { class: 'row' }, kwIn, sel, radios),
      h('div', { class: 'muted', style: 'margin-top:6px' }, '"철수"처럼 성을 빼고 써도, 명렬표의 호칭으로 써도 그 학생의 기록으로 찾아요.')), out);
  list();
  return box;
}

/* ---------- 3. 교우관계도 ---------- */
function viewGraph(redraw) {
  const sub = h('div', { class: 'tabs' }, [['graph', '관계도 보기'], ['survey', '교우관계 조사 입력']].map(([id, n]) =>
    h('button', { class: 'tab sm' + (ST.gsub === id ? ' active' : ''), onclick: () => { ST.gsub = id; redraw(); } }, n)));
  return h('div', null, sub, ST.gsub === 'survey' ? viewSurvey() : viewSociogram(redraw));
}

function viewSurvey() {
  const sv = ST.survey; const roster = APP.roster();
  const opts = () => [h('option', { value: '' }, '-'), ...roster.map((s) => h('option', { value: s.num }, `${s.num} ${s.name}`))];
  const mk = (kind, num, i) => h('select', { value: (sv[kind][num] || [])[i] || '', onchange: (e) => {
    const arr = (sv[kind][num] = sv[kind][num] || []); arr[i] = e.target.value ? Number(e.target.value) : null;
    sv[kind][num] = arr.filter((x, j) => x != null || j < arr.length);
  } }, opts());
  const rows = roster.map((s) => h('tr', { class: APP.gcls(s.gender) },
    h('td', { class: 'sv-name' }, `${s.num} ${s.name}`),
    [0, 1, 2].map((i) => h('td', null, mk('likes', s.num, i))),
    [0, 1].map((i) => h('td', null, mk('dislikes', s.num, i)))));
  return h('div', { class: 'card' },
    h('h3', null, '교우관계 조사 입력'),
    h('div', { class: 'muted', style: 'margin-bottom:10px' }, '조사지 결과를 학생별로 옮겨 적어 주세요. 선호 친구는 최대 3명, 어려운 친구는 최대 2명입니다. (자기 자신은 선택하지 마세요)'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'roster survey' },
      h('thead', null, h('tr', null, h('th', null, '학생'), h('th', null, '함께하고 싶은 친구 1'), h('th', null, '2'), h('th', null, '3'), h('th', null, '어려운 친구 1'), h('th', null, '2'))),
      h('tbody', null, rows))),
    h('div', { class: 'row', style: 'margin-top:12px;justify-content:flex-end' }, h('button', { class: 'primary', onclick: async () => {
      ['likes', 'dislikes'].forEach((k) => Object.keys(sv[k]).forEach((n) => { sv[k][n] = [...new Set((sv[k][n] || []).filter((x) => x && x !== Number(n)))]; }));
      try { await APP.kvSet('survey:main', sv); toast('조사 결과를 저장했습니다'); } catch (e) { toast(errMsg(e), true); }
    } }, '저장')));
}

/* 힘 기반 배치 (Fruchterman–Reingold) */
function forceLayout(ids, edges, W, H) {
  const n = ids.length, pos = {}, k = Math.sqrt((W * H) / Math.max(n, 1)) * 0.8;
  ids.forEach((id, i) => { const a = (2 * Math.PI * i) / n; pos[id] = { x: W / 2 + Math.cos(a) * W * 0.32, y: H / 2 + Math.sin(a) * H * 0.32 }; });
  let t = W / 8;
  for (let it = 0; it < 320; it++) {
    const disp = {}; ids.forEach((id) => (disp[id] = { x: 0, y: 0 }));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = pos[ids[i]], b = pos[ids[j]]; let dx = a.x - b.x, dy = a.y - b.y; let d = Math.hypot(dx, dy) || 0.01;
      const f = (k * k) / d; dx /= d; dy /= d;
      disp[ids[i]].x += dx * f; disp[ids[i]].y += dy * f; disp[ids[j]].x -= dx * f; disp[ids[j]].y -= dy * f;
    }
    edges.forEach((e) => {
      const a = pos[e.a], b = pos[e.b]; let dx = a.x - b.x, dy = a.y - b.y; const d = Math.hypot(dx, dy) || 0.01;
      const f = ((d * d) / k) * (0.6 + Math.min(e.w, 4) * 0.25); dx /= d; dy /= d;
      disp[e.a].x -= dx * f; disp[e.a].y -= dy * f; disp[e.b].x += dx * f; disp[e.b].y += dy * f;
    });
    ids.forEach((id) => {
      const p = pos[id], dd = disp[id];
      dd.x += (W / 2 - p.x) * 0.05; dd.y += (H / 2 - p.y) * 0.05; // 가운데로 모으기
      const d = Math.hypot(dd.x, dd.y) || 0.01, m = Math.min(d, t);
      p.x = Math.max(34, Math.min(W - 34, p.x + (dd.x / d) * m));
      p.y = Math.max(34, Math.min(H - 34, p.y + (dd.y / d) * m));
    });
    t *= 0.985;
  }
  return pos;
}

function viewSociogram(redraw) {
  const roster = APP.roster(), W = 920, H = 600;
  const ids = roster.map((s) => s.num);
  // 사건 속 함께 언급 횟수
  const co = new Map();
  ST.logs.forEach((l) => { const ns = l._nums; for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) { const key = ns[i] + '-' + ns[j]; co.set(key, (co.get(key) || 0) + 1); } });
  const coEdges = [...co.entries()].map(([key, c]) => { const [a, b] = key.split('-').map(Number); return { a, b, w: c }; });
  const likes = [], dislikes = [];
  Object.entries(ST.survey.likes).forEach(([a, arr]) => (arr || []).forEach((b) => b && likes.push({ a: Number(a), b })));
  Object.entries(ST.survey.dislikes).forEach(([a, arr]) => (arr || []).forEach((b) => b && dislikes.push({ a: Number(a), b })));
  const likeSet = new Set(likes.map((e) => e.a + '>' + e.b));
  const mutual = (e) => likeSet.has(e.b + '>' + e.a);

  const visCo = ST.layers.co ? coEdges.filter((e) => e.w >= ST.minCo) : [];
  const forceEdges = [...visCo, ...(ST.layers.like ? likes.map((e) => ({ ...e, w: mutual(e) ? 3 : 1 })) : [])]
    .filter((e) => ids.includes(e.a) && ids.includes(e.b));
  // 연결된 학생은 가운데에 힘 배치, 연결 없는 학생은 아래쪽에 가지런히 놓기
  const touched = new Set(); forceEdges.forEach((e) => { touched.add(e.a); touched.add(e.b); });
  const conIds = ids.filter((i) => touched.has(i)), isoIds = ids.filter((i) => !touched.has(i));
  const perRow = Math.max(1, Math.floor((W - 40) / 58)), isoRows = Math.ceil(isoIds.length / perRow);
  const mainH = H - (isoRows ? isoRows * 56 + 24 : 0);
  const pos = conIds.length ? forceLayout(conIds, forceEdges, W, mainH) : {};
  isoIds.forEach((id, i) => { pos[id] = { x: 40 + (i % perRow) * 58, y: mainH + 30 + Math.floor(i / perRow) * 56 }; });

  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, ...kids) => { const e = document.createElementNS(NS, tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); kids.forEach((c) => e.append(c)); return e; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sg' });
  const defs = el('defs', null,
    ...[['ar-like', '#2f6fed'], ['ar-dis', '#e5484d']].map(([id, c]) => el('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, el('path', { d: 'M0,0 L10,5 L0,10 z', fill: c }))));
  svg.append(defs);
  const sel = ST.sel;
  const rel = (e) => sel == null || e.a === sel || e.b === sel;
  const line = (e, attrs) => {
    const a = pos[e.a], b = pos[e.b]; if (!a || !b) return;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, r = 22;
    svg.append(el('line', { x1: a.x + (dx / d) * r, y1: a.y + (dy / d) * r, x2: b.x - (dx / d) * (r + 2), y2: b.y - (dy / d) * (r + 2), opacity: rel(e) ? 1 : 0.12, ...attrs }));
  };
  visCo.forEach((e) => line(e, { stroke: '#9aa3af', 'stroke-width': 1 + Math.min(e.w, 6) * 1.2 }));
  if (ST.layers.like) likes.forEach((e) => line(e, { stroke: '#2f6fed', 'stroke-width': mutual(e) ? 3 : 1.6, 'marker-end': 'url(#ar-like)' }));
  if (ST.layers.dislike) dislikes.forEach((e) => line(e, { stroke: '#e5484d', 'stroke-width': 1.6, 'stroke-dasharray': '6 4', 'marker-end': 'url(#ar-dis)' }));

  const linked = new Set([sel]);
  [...visCo, ...(ST.layers.like ? likes : []), ...(ST.layers.dislike ? dislikes : [])].forEach((e) => { if (e.a === sel) linked.add(e.b); if (e.b === sel) linked.add(e.a); });
  roster.forEach((s) => {
    const p = pos[s.num];
    const g = el('g', { class: 'sg-node', opacity: sel == null || linked.has(s.num) ? 1 : 0.25, style: 'cursor:pointer' },
      el('circle', { cx: p.x, cy: p.y, r: 22, fill: s.gender === '남' ? '#bcd6ff' : s.gender === '여' ? '#fbc3d3' : '#e5e7eb', stroke: sel === s.num ? '#1f2937' : '#fff', 'stroke-width': sel === s.num ? 3 : 2 }),
      (() => { const t = el('text', { x: p.x, y: p.y + 4, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600, fill: '#1f2937' }); t.textContent = s.name.length > 3 ? s.name.slice(0, 3) : s.name; return t; })(),
      (() => { const t = el('text', { x: p.x, y: p.y - 26, 'text-anchor': 'middle', 'font-size': 10, fill: '#6b7280' }); t.textContent = s.num; return t; })());
    g.addEventListener('click', () => { ST.sel = ST.sel === s.num ? null : s.num; redraw(); });
    svg.append(g);
  });

  const cb = (key, label, color) => h('label', null, h('input', { type: 'checkbox', checked: ST.layers[key], onchange: (e) => { ST.layers[key] = e.target.checked; redraw(); } }), h('i', { class: 'dot', style: `background:${color}` }), label);
  const controls = h('div', { class: 'card' }, h('div', { class: 'row radios' },
    cb('co', '사건에서 함께 언급', '#9aa3af'), cb('like', '함께하고 싶은 친구(화살표)', '#2f6fed'), cb('dislike', '어려운 친구(점선)', '#e5484d'),
    h('span', null, '언급 ', h('select', { value: String(ST.minCo), onchange: (e) => { ST.minCo = Number(e.target.value); redraw(); } },
      [1, 2, 3, 4, 5].map((n) => h('option', { value: n }, `${n}회 이상`)))),
  ), h('div', { class: 'muted', style: 'margin-top:6px' }, '동그라미를 누르면 그 학생과 연결된 관계만 진하게 보이고, 아래에 관련 사건이 나옵니다. 굵은 파란 화살표는 서로 선택한 관계입니다.'));

  // 분석표
  const recv = {}, give = {}, mutN = {}, mention = {}, disRecv = {};
  ids.forEach((i) => { recv[i] = 0; give[i] = 0; mutN[i] = 0; mention[i] = 0; disRecv[i] = 0; });
  likes.forEach((e) => { if (e.a in give && e.b in recv) { give[e.a]++; recv[e.b]++; if (mutual(e)) mutN[e.a]++; } });
  dislikes.forEach((e) => { if (e.b in disRecv) disRecv[e.b]++; });
  ST.logs.forEach((l) => l._nums.forEach((n) => { if (n in mention) mention[n]++; }));
  const surveyed = Object.values(ST.survey.likes).filter((a) => (a || []).some(Boolean)).length;
  const hasSurvey = surveyed >= Math.ceil(ids.length / 2); // 절반 이상 입력해야 판단
  const rows = roster.map((s) => {
    const flag = hasSurvey && recv[s.num] === 0 ? '선택받지 못함' : (hasSurvey && mutN[s.num] === 0 ? '짝 관계 없음' : (disRecv[s.num] >= 2 ? '어려워하는 친구 많음' : ''));
    return h('tr', { class: APP.gcls(s.gender) }, h('td', null, `${s.num} ${s.name}`), h('td', null, recv[s.num]), h('td', null, give[s.num]), h('td', null, mutN[s.num]), h('td', null, disRecv[s.num]), h('td', null, mention[s.num]),
      h('td', null, flag ? h('b', { style: 'color:var(--danger)' }, flag) : ''));
  });
  const table = h('div', { class: 'card' }, h('h3', null, '관계 요약'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'roster survey' }, h('thead', null, h('tr', null, ['학생', '받은 선택', '한 선택', '서로 선택', '기피 받음', '사건 언급', '살펴볼 점'].map((t) => h('th', null, t)))), h('tbody', null, rows))),
    h('div', { class: 'muted', style: 'margin-top:6px' }, hasSurvey ? '표시는 참고용이에요. 판단은 선생님이 직접 해 주세요.' : '교우관계 조사를 절반 이상 입력하면 "살펴볼 점"이 표시돼요.'));

  // 선택한 학생의 사건
  let detail = null;
  if (sel != null) {
    const evs = sortedLogs('desc').filter((l) => l._nums.includes(sel));
    const names = (arr) => (arr.length ? arr.map(stuName).join(', ') : '없음');
    detail = h('div', { class: 'card' }, h('h3', null, `${sel}번 ${stuName(sel)} 학생`),
      h('div', { class: 'muted', style: 'margin-bottom:8px' }, `이 학생을 선택한 친구: ${names(likes.filter((e) => e.b === sel).map((e) => e.a))} / 이 학생이 선택한 친구: ${names(likes.filter((e) => e.a === sel).map((e) => e.b))}`),
      evs.length ? evs.map((l) => logItem(l, '', redraw, false)) : h('div', { class: 'muted' }, '관련 사건이 없습니다.'));
  }
  return h('div', null, controls, h('div', { class: 'card' }, svg), detail, table);
}
})();
