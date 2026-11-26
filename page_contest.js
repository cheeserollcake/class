/* 대회 관리: 리그 / 토너먼트 · 개인 / 팀 / 반대항 */
(() => {
'use strict';
const APP = window.APP;
const { h, toast, errMsg } = APP;

const C = { index: null, cache: {}, cur: null, view: 'bracket', wiz: null, loading: false };
APP.onClear.push(() => { C.index = null; C.cache = {}; C.cur = null; C.wiz = null; });

const KIND = { league: '리그', cup: '토너먼트' };
const UNIT = { solo: '개인', team: '팀', class: '반대항' };
const roster = () => APP.roster();
const stu = (n) => roster().find((s) => s.num === n);
const gcls = (g) => APP.gcls(g);
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));

/* ---------- 저장 (경기는 짧은 배열로 줄여서 저장) ---------- */
const keyOf = (id) => 'contest:c:' + id;
const pack = (c) => ({ ...c, matches: c.matches.map((m) => { const a = [m.a, m.b, m.r, m.s, m.c, m.sa, m.sb, m.w, m.src ? m.src[0] : null, m.src ? m.src[1] : null, m.k || null, m.p || null]; while (a.length && a[a.length - 1] == null) a.pop(); return a; }) });
const unpack = (c) => ({ ...c, matches: (c.matches || []).map((a) => ({ a: a[0] ?? null, b: a[1] ?? null, r: a[2] || 0, s: a[3] || 0, c: a[4] || 0, sa: a[5] ?? null, sb: a[6] ?? null, w: a[7] || 0, src: a[8] != null ? [a[8], a[9]] : null, k: a[10] || null, p: a[11] || null })) });
let saveT = null, saveIdxT = null;
function save(c) {
  clearTimeout(saveT);
  saveT = setTimeout(() => APP.kvSet(keyOf(c.id), pack(c)).catch((e) => toast(e.message === 'TOOBIG' ? '대회 기록이 너무 커서 저장하지 못했어요.' : errMsg(e), true)), 600);
  const it = C.index.list.find((x) => x.id === c.id);
  if (it) { const p = progress(c); if (it.done !== p.done || it.total !== p.total || it.name !== c.name) { Object.assign(it, { name: c.name, done: p.done, total: p.total }); saveIndex(); } }
}
function saveIndex() { clearTimeout(saveIdxT); saveIdxT = setTimeout(() => APP.kvSet('contest:index', C.index).catch((e) => toast(errMsg(e), true)), 400); }
async function loadIndex() {
  const kv = await APP.kvGet(['contest:index']);
  C.index = kv['contest:index'] && Array.isArray(kv['contest:index'].list) ? kv['contest:index'] : { list: [], cur: null };
  C.cur = C.index.cur && C.index.list.some((x) => x.id === C.index.cur) ? C.index.cur : (C.index.list[0] || {}).id || null;
}
async function getContest(id) {
  if (C.cache[id]) return C.cache[id];
  const kv = await APP.kvGet([keyOf(id)]);
  const c = kv[keyOf(id)] ? unpack(kv[keyOf(id)]) : null;
  if (c) C.cache[id] = c;
  return c;
}

/* ---------- 대진 만들기 ---------- */
/* 리그: 원형 방식으로 라운드를 만든 뒤, 경기장 수만큼 한 차례(동시 진행)에 배치 — 같은 사람이 한 차례에 두 번 나오지 않게 */
function leagueMatches(n, double, courts) {
  const ids = Array.from({ length: n }, (_, i) => i);
  if (n % 2) ids.push(null);
  const L = ids.length, rounds = [];
  let arr = ids.slice();
  for (let r = 0; r < L - 1; r++) {
    const ms = [];
    for (let i = 0; i < L / 2; i++) {
      const a = arr[i], b = arr[L - 1 - i];
      if (a != null && b != null) ms.push(r % 2 && i === 0 ? [b, a] : [a, b]);
    }
    rounds.push(ms);
    arr = [arr[0], arr[L - 1], ...arr.slice(1, L - 1)];
  }
  const all = [];
  rounds.forEach((ms, r) => ms.forEach(([a, b]) => all.push({ a, b, r })));
  if (double) rounds.forEach((ms, r) => ms.forEach(([a, b]) => all.push({ a: b, b: a, r: r + rounds.length })));
  // 차례 배치
  const left = all.slice(), out = [];
  let slot = 0;
  const K = Math.max(1, courts);
  while (left.length) {
    const used = new Set(), pick = [];
    for (let i = 0; i < left.length && pick.length < K; i++) {
      const m = left[i];
      if (used.has(m.a) || used.has(m.b)) continue;
      used.add(m.a); used.add(m.b); pick.push(i);
    }
    pick.reverse().forEach((i, j) => { const m = left.splice(i, 1)[0]; m.s = slot; out.push(m); });
    out.slice(-pick.length).sort((x, y) => x.r - y.r).forEach((m, i) => { m.c = i; });
    slot++;
  }
  return out.map((m) => ({ a: m.a, b: m.b, r: m.r, s: m.s, c: m.c, sa: null, sb: null, w: 0, src: null, k: null, p: null }));
}
/* 토너먼트: 2의 거듭제곱 칸에 시드 배치(부전승은 고르게 퍼짐) */
function seedOrder(P) { let o = [1]; while (o.length < P) { const m = o.length * 2 + 1; o = o.flatMap((x) => [x, m - x]); } return o; }
function cupMatches(n, third) {
  let P = 1; while (P < n) P *= 2;
  const order = seedOrder(P), ms = [];
  const slots = order.map((sd) => (sd <= n ? sd - 1 : -1));   // -1 = 부전승
  for (let i = 0; i < P / 2; i++) ms.push({ a: slots[2 * i], b: slots[2 * i + 1], r: 0, src: null });
  let prev = ms.map((_, i) => i), r = 1;
  while (prev.length > 1) {
    const cur = [];
    for (let i = 0; i < prev.length; i += 2) { ms.push({ a: null, b: null, r, src: [prev[i], prev[i + 1]] }); cur.push(ms.length - 1); }
    prev = cur; r++;
  }
  if (third && r >= 3) { const semis = ms.map((m, i) => i).filter((i) => ms[i].r === r - 2); ms.push({ a: null, b: null, r: r - 1, src: semis, k: 'third' }); }
  return ms.map((m) => ({ a: m.a, b: m.b, r: m.r, s: 0, c: 0, sa: null, sb: null, w: 0, src: m.src, k: m.k || null, p: null }));
}
const isBye = (m) => m.a === -1 || m.b === -1;
const real = (m) => !isBye(m) && m.a != null && m.b != null;
function winnerOf(c, m) {
  if (m.a === -1 && m.b != null && m.b !== -1) return m.b;
  if (m.b === -1 && m.a != null && m.a !== -1) return m.a;
  if (m.a === -1 && m.b === -1) return -1;
  return m.w === 1 ? m.a : m.w === 2 ? m.b : null;
}
function loserOf(c, m) { const w = winnerOf(c, m); if (w == null || isBye(m)) return null; return w === m.a ? m.b : m.a; }
/* 결과 반영: 점수 → 승패, 토너먼트는 다음 경기 칸 채우기 + 경기장·차례 다시 정하기 */
function resolve(c) {
  const cup = c.kind === 'cup';
  c.matches.forEach((m) => {
    if (!cup) {
      if (m.sa == null || m.sb == null) m.w = 0;
      else m.w = m.sa > m.sb ? 1 : m.sb > m.sa ? 2 : 3;
    }
  });
  if (!cup) return;
  c.matches.forEach((m) => {
    if (m.src) {
      const f = m.k === 'third' ? (i) => loserOf(c, c.matches[i]) : (i) => winnerOf(c, c.matches[i]);
      const na = f(m.src[0]), nb = f(m.src[1]);
      if (na !== m.a || nb !== m.b) { m.a = na; m.b = nb; m.sa = null; m.sb = null; m.w = 0; m.p = null; }
    }
    if (real(m)) {
      if (m.sa == null || m.sb == null) m.w = 0;
      else if (m.sa !== m.sb) m.w = m.sa > m.sb ? 1 : 2;
      else m.w = m.p === 1 || m.p === 2 ? m.p : 0;   // 동점이면 승자를 직접 고름
    } else if (!isBye(m)) m.w = 0;
  });
  // 경기장·차례: 라운드 순서대로 실제 경기만
  const K = Math.max(1, c.cfg.courts); let slot = 0;
  const maxR = Math.max(...c.matches.map((m) => m.r));
  for (let r = 0; r <= maxR; r++) {
    const rs = c.matches.filter((m) => m.r === r && !isBye(m)).sort((x, y) => (y.k === 'third') - (x.k === 'third'));
    rs.forEach((m, i) => { m.s = slot + Math.floor(i / K); m.c = i % K; });
    slot += Math.ceil(rs.length / K);
  }
}
function progress(c) {
  const ms = c.matches.filter((m) => !isBye(m));
  const total = ms.length, done = ms.filter((m) => m.w).length;
  return { total, done, pct: total ? Math.round(done / total * 100) : 0 };
}

/* ---------- 순위 ---------- */
function leagueTable(c) {
  const T = c.teams.map((t, i) => ({ i, name: t.name, gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }));
  const P = c.cfg.pts;
  c.matches.forEach((m) => {
    if (!m.w) return;
    const A = T[m.a], B = T[m.b];
    A.gp++; B.gp++; A.gf += m.sa; A.ga += m.sb; B.gf += m.sb; B.ga += m.sa;
    if (m.w === 1) { A.w++; B.l++; A.pts += P.w; B.pts += P.l; } else if (m.w === 2) { B.w++; A.l++; B.pts += P.w; A.pts += P.l; } else { A.d++; B.d++; A.pts += P.d; B.pts += P.d; }
  });
  T.forEach((t) => { t.gd = t.gf - t.ga; });
  T.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.i - y.i);
  T.forEach((t, k) => { const p = T[k - 1]; t.rank = p && p.pts === t.pts && p.gd === t.gd && p.gf === t.gf ? p.rank : k + 1; });
  return T;
}
function cupTable(c) {
  const maxR = Math.max(...c.matches.filter((m) => m.k !== 'third').map((m) => m.r));
  const fin = c.matches.find((m) => m.r === maxR && m.k !== 'third'), third = c.matches.find((m) => m.k === 'third');
  const out = new Map(); const set = (i, rank, label) => { if (i != null && i >= 0 && !out.has(i)) out.set(i, { rank, label }); };
  const rname = (r) => roundName(c, r);
  if (fin && fin.w) { set(winnerOf(c, fin), 1, '우승'); set(loserOf(c, fin), 2, '준우승'); }
  if (third && third.w) { set(winnerOf(c, third), 3, '3위'); set(loserOf(c, third), 4, '4위'); }
  for (let r = maxR; r >= 0; r--) {
    const lost = c.matches.filter((m) => m.r === r && m.k !== 'third' && m.w && !isBye(m)).map((m) => loserOf(c, m)).filter((x) => x != null && !out.has(x));
    const n = c.teams.length;
    const rank = Math.pow(2, maxR - r) + 1;
    lost.forEach((x) => set(x, Math.min(rank, n), r === maxR ? '준우승' : `${rname(r)} 탈락`));
  }
  return c.teams.map((t, i) => ({ i, name: t.name, ...(out.get(i) || { rank: null, label: alive(c, i) ? '진행 중' : '' }) }))
    .sort((x, y) => (x.rank || 99) - (y.rank || 99) || x.i - y.i);
}
function alive(c, i) { return !c.matches.some((m) => m.k !== 'third' && m.w && !isBye(m) && loserOf(c, m) === i); }
function roundName(c, r) {
  const maxR = Math.max(...c.matches.filter((m) => m.k !== 'third').map((m) => m.r)), left = Math.pow(2, maxR - r + 1);
  return left === 2 ? '결승' : left === 4 ? '준결승' : `${left}강`;
}

/* ---------- 팀 나누기 ---------- */
function randomTeams(nums, T, mode) {
  const list = nums.map(stu).filter(Boolean);
  const boys = shuffle(list.filter((s) => s.gender === '남')), girls = shuffle(list.filter((s) => s.gender === '여')), etc = shuffle(list.filter((s) => s.gender !== '남' && s.gender !== '여'));
  const teams = Array.from({ length: T }, () => []);
  if (mode === 'sep' && boys.length && girls.length && T >= 2) {
    let Tb = 1, bs = Infinity;
    for (let k = 1; k < T; k++) { const sc = Math.abs(boys.length / k - girls.length / (T - k)); if (sc < bs) { bs = sc; Tb = k; } }
    boys.forEach((s, i) => teams[i % Tb].push(s.num));
    girls.forEach((s, i) => teams[Tb + (i % (T - Tb))].push(s.num));
    etc.forEach((s) => teams.slice().sort((a, b) => a.length - b.length)[0].push(s.num));
  } else if (mode === 'equal') {
    let k = 0; const ord = shuffle(Array.from({ length: T }, (_, i) => i));
    [...boys, ...girls, ...etc].forEach((s) => { teams[ord[k % T]].push(s.num); k++; });
  } else shuffle(list).forEach((s, i) => teams[i % T].push(s.num));
  return teams.map((t) => t.sort((a, b) => a - b));
}

/* ---------- 새 대회 만들기 (단계별) ---------- */
function newWizard() {
  return { step: 1, kind: null, unit: null, classes: 4, classNames: [], name: '', pts: { w: 3, d: 1, l: 0 }, double: false, scoring: 'score', target: 11, courts: 1, third: true,
    sel: roster().map((s) => s.num), teamN: 4, assign: 'random', gmode: 'equal', teams: null, pick: null };
}
function wizardView(redraw) {
  const W = C.wiz;
  const steps = ['대회 방식', '참가 형태', '경기 설정', W.unit === 'team' ? '팀 구성' : W.unit === 'class' ? '반 이름' : '참가자'];
  const head = h('div', { class: 'cz-steps' }, steps.map((n, i) => h('span', { class: 'cz-step' + (W.step === i + 1 ? ' on' : W.step > i + 1 ? ' done' : '') }, `${i + 1}. ${n}`)));
  const card = h('div', { class: 'card cz-wiz' }, h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, h('h3', { style: 'margin:0' }, '새 대회 추가'),
    h('button', { class: 'sm ghost', onclick: () => { C.wiz = null; redraw(); } }, '취소')), head);
  const nav = (back, next, nextLabel, ok) => h('div', { class: 'row', style: 'justify-content:space-between;margin-top:18px' },
    back ? h('button', { onclick: back }, '← 이전') : h('span'), next ? h('button', { class: 'primary', disabled: ok === false, onclick: next }, nextLabel || '다음 →') : null);
  const big = (cur, v, title, desc, on) => h('button', { class: 'cz-big' + (cur === v ? ' on' : ''), onclick: () => on(v) }, h('b', null, title), h('span', null, desc));
  if (W.step === 1) {
    card.append(h('div', { class: 'cz-bigs' },
      big(W.kind, 'league', '리그', '모두가 서로 한 번씩(또는 두 번씩) 경기해서 승점으로 순위를 정해요.', (v) => { W.kind = v; W.step = 2; redraw(); }),
      big(W.kind, 'cup', '토너먼트', '지면 탈락! 이긴 쪽이 다음 경기로 올라가요.', (v) => { W.kind = v; W.step = 2; redraw(); })));
  } else if (W.step === 2) {
    card.append(h('div', { class: 'cz-bigs' },
      big(W.unit, 'solo', '개인 대회', '명렬표의 학생 한 명 한 명이 참가해요.', (v) => { W.unit = v; redraw(); }),
      big(W.unit, 'team', '팀 대회', '명렬표 학생들로 팀을 만들어 참가해요.', (v) => { W.unit = v; redraw(); }),
      big(W.unit, 'class', '반대항', '반끼리 겨뤄요.', (v) => { W.unit = v; redraw(); })));
    if (W.unit === 'class') card.append(h('div', { class: 'field', style: 'margin-top:14px' }, h('label', null, '반 숫자'),
      h('input', { type: 'number', min: 2, max: 30, value: W.classes, class: 'cz-num', onchange: (e) => { W.classes = Math.max(2, Math.min(30, Number(e.target.value) | 0 || 2)); redraw(); } }),
      h('span', { class: 'muted', style: 'margin-left:8px' }, '개 반')));
    if ((W.unit === 'solo' || W.unit === 'team') && !roster().length) card.append(h('div', { class: 'banner warn', style: 'margin-top:12px' }, '명렬표가 비어 있어요. 학급 기초설정에서 먼저 입력해 주세요.'));
    card.append(nav(() => { W.step = 1; redraw(); }, () => { W.step = 3; redraw(); }, null, !!W.unit && (W.unit === 'class' || roster().length >= 2)));
  } else if (W.step === 3) {
    const nameIn = h('input', { value: W.name, placeholder: '예: 피구, 줄넘기, 탁구', maxlength: 30, oninput: (e) => { W.name = e.target.value; nextBtn.disabled = !W.name.trim(); } });
    const ptIn = (k, label) => h('label', { class: 'cz-pt' }, label, h('input', { type: 'number', value: W.pts[k], class: 'cz-num', onchange: (e) => { W.pts[k] = Number(e.target.value) || 0; } }), '점');
    const radio = (name, cur, items, on) => h('div', { class: 'radios' }, items.map(([v, n]) => h('label', null, h('input', { type: 'radio', name, checked: cur === v, onchange: () => on(v) }), n)));
    card.append(...[
      h('div', { class: 'field' }, h('label', null, '종목 이름'), nameIn),
      W.kind === 'league' ? h('div', { class: 'field' }, h('label', null, '승점'), h('div', { class: 'row', style: 'gap:14px;flex-wrap:wrap' }, ptIn('w', '승리'), ptIn('d', '무승부'), ptIn('l', '패배'))) : null,
      W.kind === 'league' ? h('div', { class: 'field' }, h('label', null, '리그 방식'), radio('cz-dbl', W.double, [[false, '싱글 (1회전)'], [true, '더블 (2회전)']], (v) => { W.double = v; redraw(); })) : null,
      h('div', { class: 'field' }, h('label', null, '점수 기록 방식'), radio('cz-sc', W.scoring, [['score', '득점/실점 기록'], ['target', '목표 점수']], (v) => { W.scoring = v; redraw(); }),
        W.scoring === 'target' ? h('div', { class: 'row', style: 'gap:6px;margin-top:6px' }, '먼저', h('input', { type: 'number', min: 1, value: W.target, class: 'cz-num', onchange: (e) => { W.target = Math.max(1, Number(e.target.value) | 0 || 11); } }), '점을 내면 이겨요') : null),
      h('div', { class: 'field' }, h('label', null, '운영 경기장 수'), h('div', { class: 'row', style: 'gap:6px' },
        h('input', { type: 'number', min: 1, max: 20, value: W.courts, class: 'cz-num', onchange: (e) => { W.courts = Math.max(1, Math.min(20, Number(e.target.value) | 0 || 1)); } }), '곳'),
        h('div', { class: 'muted', style: 'margin-top:4px' }, '동시에 경기할 수 있는 곳의 수예요. 경기를 경기장마다 골고루 나눠요.')),
      W.kind === 'cup' ? h('div', { class: 'field' }, h('label', { class: 'row', style: 'gap:6px;font-weight:400;cursor:pointer' }, h('input', { type: 'checkbox', checked: W.third, onchange: (e) => { W.third = e.target.checked; } }), '3·4위전 하기')) : null].filter(Boolean));
    const nextBtn = h('button', { class: 'primary', disabled: !W.name.trim(), onclick: () => { W.name = W.name.trim(); W.step = 4; redraw(); } }, '다음 →');
    card.append(h('div', { class: 'row', style: 'justify-content:space-between;margin-top:18px' }, h('button', { onclick: () => { W.step = 2; redraw(); } }, '← 이전'), nextBtn));
  } else {
    card.append(W.unit === 'solo' ? soloPick(redraw) : W.unit === 'team' ? teamPick(redraw) : classPick(redraw));
    const n = W.unit === 'solo' ? W.sel.length : W.unit === 'team' ? (W.teams || []).filter((t) => t.members.length).length : W.classes;
    const bad = W.unit === 'team' && (!W.teams || W.teams.some((t) => !t.members.length));
    card.append(h('div', { class: 'row', style: 'justify-content:space-between;margin-top:18px' }, h('button', { onclick: () => { W.step = 3; redraw(); } }, '← 이전'),
      h('div', { class: 'row', style: 'gap:8px' }, bad ? h('span', { class: 'muted' }, '빈 팀이 없어야 해요') : null,
        h('button', { class: 'primary', disabled: n < 2 || bad, onclick: () => create(redraw) }, `대회 만들기 (${n}${W.unit === 'solo' ? '명' : W.unit === 'team' ? '팀' : '반'})`))));
  }
  return card;
}
function soloPick(redraw) {
  const W = C.wiz, sel = new Set(W.sel);
  return h('div', null, h('div', { class: 'field' }, h('label', null, `참가 학생 (${sel.size}명)`),
    h('div', { class: 'muted', style: 'margin-bottom:6px' }, '누르면 빠지거나 다시 들어가요.'),
    h('div', { class: 'cz-pool' }, roster().map((s) => h('button', { class: 'cz-chip ' + gcls(s.gender) + (sel.has(s.num) ? '' : ' off'), onclick: () => { sel.has(s.num) ? sel.delete(s.num) : sel.add(s.num); W.sel = [...sel].sort((a, b) => a - b); redraw(); } }, s.name))),
    h('div', { class: 'row', style: 'gap:6px;margin-top:8px' }, h('button', { class: 'sm', onclick: () => { W.sel = roster().map((s) => s.num); redraw(); } }, '모두 넣기'), h('button', { class: 'sm', onclick: () => { W.sel = []; redraw(); } }, '모두 빼기'))));
}
function classPick(redraw) {
  const W = C.wiz;
  for (let i = 0; i < W.classes; i++) if (!W.classNames[i]) W.classNames[i] = `${i + 1}반`;
  W.classNames.length = W.classes;
  return h('div', { class: 'field' }, h('label', null, '반 이름'), h('div', { class: 'muted', style: 'margin-bottom:6px' }, '필요하면 이름을 바꿔요. (예: 4-1)'),
    h('div', { class: 'cz-names' }, W.classNames.map((n, i) => h('input', { value: n, maxlength: 12, oninput: (e) => { W.classNames[i] = e.target.value; } }))));
}
function teamPick(redraw) {
  const W = C.wiz, all = roster();
  const radio = (name, cur, items, on) => h('div', { class: 'radios' }, items.map(([v, n]) => h('label', null, h('input', { type: 'radio', name, checked: cur === v, onchange: () => on(v) }), n)));
  const mk = () => {
    W.teams = Array.from({ length: W.teamN }, (_, i) => ({ name: (W.teams && W.teams[i] && W.teams[i].name) || `${i + 1}팀`, members: [] }));
    if (W.assign === 'random') randomTeams(all.map((s) => s.num).filter((n) => W.sel.includes(n)), W.teamN, W.gmode).forEach((m, i) => { W.teams[i].members = m; });
  };
  if (!W.teams || W.teams.length !== W.teamN) mk();
  const inTeam = new Set(W.teams.flatMap((t) => t.members));
  const pool = all.filter((s) => W.sel.includes(s.num) && !inTeam.has(s.num));
  const moveTo = (ti, n) => { W.teams.forEach((t) => { t.members = t.members.filter((x) => x !== n); }); if (ti >= 0) { W.teams[ti].members.push(n); W.teams[ti].members.sort((a, b) => a - b); } W.pick = null; redraw(); };
  const chip = (s) => {
    const el = h('button', { class: 'cz-chip ' + gcls(s.gender) + (W.pick === s.num ? ' pick' : ''), draggable: 'true', onclick: (e) => { e.stopPropagation(); W.pick = W.pick === s.num ? null : s.num; redraw(); } }, s.name);
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(s.num)); });
    return el;
  };
  const drop = (el, ti) => {
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); const n = Number(e.dataTransfer.getData('text/plain')); if (n) moveTo(ti, n); });
    el.addEventListener('click', () => { if (W.pick != null) moveTo(ti, W.pick); });
    return el;
  };
  const cnt = (t) => { const ss = t.members.map(stu).filter(Boolean); return `${ss.length}명 · 남${ss.filter((s) => s.gender === '남').length} 여${ss.filter((s) => s.gender === '여').length}`; };
  return h('div', null,
    h('div', { class: 'field' }, h('label', null, '팀 수'), h('div', { class: 'row', style: 'gap:6px' },
      h('input', { type: 'number', min: 2, max: Math.max(2, all.length), value: W.teamN, class: 'cz-num', onchange: (e) => { W.teamN = Math.max(2, Math.min(Math.max(2, all.length), Number(e.target.value) | 0 || 2)); W.teams = null; redraw(); } }), '팀')),
    h('div', { class: 'field' }, h('label', null, '팀 배분 방식'), radio('cz-as', W.assign, [['random', '랜덤 배정'], ['manual', '지정 배정']], (v) => { W.assign = v; W.teams = null; redraw(); })),
    W.assign === 'random' ? h('div', { class: 'field' }, h('label', null, '성별 조건'), radio('cz-g', W.gmode, [['equal', '남녀 동비율'], ['sep', '남녀 따로'], ['none', '성별 무시']], (v) => { W.gmode = v; W.teams = null; redraw(); }),
      h('button', { class: 'sm', style: 'margin-top:6px', onclick: () => { mk(); redraw(); } }, '다시 섞기')) : null,
    h('div', { class: 'muted', style: 'margin:4px 0 8px' }, '이름을 누른 뒤 옮길 팀을 누르거나, 끌어서 놓으면 옮겨져요. 팀 이름도 바꿀 수 있어요.'),
    drop(h('div', { class: 'cz-pool cz-unassigned' }, h('div', { class: 'cz-pool-t' }, `팀 없음 (${pool.length}명)`), pool.length ? pool.map(chip) : h('span', { class: 'muted' }, '모두 팀에 들어갔어요')), -1),
    h('div', { class: 'cz-teams' }, W.teams.map((t, i) => drop(h('div', { class: 'cz-team' + (W.pick != null ? ' target' : '') },
      h('div', { class: 'cz-team-h' }, h('input', { value: t.name, maxlength: 12, onclick: (e) => e.stopPropagation(), oninput: (e) => { t.name = e.target.value; } }), h('span', { class: 'muted' }, cnt(t))),
      h('div', { class: 'cz-team-m' }, t.members.map(stu).filter(Boolean).map(chip))), i))));
}
async function create(redraw) {
  const W = C.wiz;
  let teams;
  if (W.unit === 'solo') teams = W.sel.map(stu).filter(Boolean).map((s) => ({ name: s.name, members: [s.num] }));
  else if (W.unit === 'team') teams = W.teams.filter((t) => t.members.length).map((t, i) => ({ name: (t.name || '').trim() || `${i + 1}팀`, members: t.members.slice() }));
  else teams = W.classNames.map((n, i) => ({ name: (n || '').trim() || `${i + 1}반`, members: [] }));
  const order = W.kind === 'cup' ? shuffle(teams) : teams;
  const c = { id: uid(), name: W.name, kind: W.kind, unit: W.unit, created: Date.now(),
    cfg: { pts: { ...W.pts }, double: W.double, scoring: W.scoring, target: W.target, courts: W.courts, third: W.third }, teams: order,
    matches: W.kind === 'league' ? leagueMatches(order.length, W.double, W.courts) : cupMatches(order.length, W.third) };
  resolve(c);
  const p = progress(c);
  C.cache[c.id] = c;
  C.index.list.push({ id: c.id, name: c.name, kind: c.kind, unit: c.unit, created: c.created, done: p.done, total: p.total });
  C.index.cur = C.cur = c.id; C.wiz = null; C.view = 'bracket';
  try { await APP.kvSet(keyOf(c.id), pack(c)); await APP.kvSet('contest:index', C.index); toast('대회를 만들었어요'); } catch (e) { toast(errMsg(e), true); }
  redraw();
}

/* ---------- 대회 화면 ---------- */
function titleBar(c) {
  const p = progress(c);
  const el = h('div', { class: 'cz-title' },
    h('div', { class: 'cz-fill', style: `width:${p.pct}%` }),
    h('div', { class: 'cz-title-in' },
      h('span', { class: 'cz-tags' }, h('span', { class: 'cz-tag' }, KIND[c.kind]), h('span', { class: 'cz-tag' }, UNIT[c.unit])),
      h('b', { class: 'cz-name' }, c.name),
      h('span', { class: 'cz-pct' }, p.total ? `${p.done}/${p.total}경기 · ${p.pct}%` : '')));
  if (p.total && p.done === p.total) el.classList.add('fin');
  return el;
}
function scoreBox(c, m, redraw) {
  const done = !!m.w, target = c.cfg.scoring === 'target' ? c.cfg.target : null;
  const inp = (side) => h('input', { type: 'number', inputmode: 'numeric', min: 0, class: 'cz-sc', value: side === 'a' ? (m.sa ?? '') : (m.sb ?? ''), placeholder: '-',
    onchange: (e) => {
      const v = num(e.target.value);
      if (side === 'a') m.sa = v; else m.sb = v;
      // 목표 점수 방식: 한쪽만 목표 점수를 넣고 다른 쪽이 비어 있으면 그대로 두기
      resolve(c); save(c); redraw();
    } });
  const nm = (i) => (i === -1 ? '부전승' : i == null ? '(대기)' : c.teams[i].name);
  const cls = (side) => 'cz-side' + (m.w === (side === 'a' ? 1 : 2) ? ' win' : m.w && m.w !== 3 ? ' lose' : '');
  const tie = c.kind === 'cup' && real(m) && m.sa != null && m.sb != null && m.sa === m.sb;
  return h('div', { class: 'cz-match' + (done ? ' done' : '') + (m.k === 'third' ? ' third' : '') },
    h('div', { class: cls('a') }, h('span', { class: 'cz-tn' }, nm(m.a)), real(m) ? inp('a') : null),
    h('div', { class: cls('b') }, h('span', { class: 'cz-tn' }, nm(m.b)), real(m) ? inp('b') : null),
    tie ? h('div', { class: 'cz-tie' }, '동점! 이긴 쪽:', h('button', { class: 'sm' + (m.p === 1 ? ' primary' : ''), onclick: () => { m.p = 1; resolve(c); save(c); redraw(); } }, nm(m.a)), h('button', { class: 'sm' + (m.p === 2 ? ' primary' : ''), onclick: () => { m.p = 2; resolve(c); save(c); redraw(); } }, nm(m.b))) : null,
    target && real(m) && !done ? h('div', { class: 'cz-hint' }, `먼저 ${target}점`) : null);
}
function leagueBracket(c, redraw) {
  const K = Math.max(1, c.cfg.courts), slots = [...new Set(c.matches.map((m) => m.s))].sort((a, b) => a - b);
  const curSlot = slots.find((s) => c.matches.some((m) => m.s === s && !m.w));
  return h('div', { class: 'cz-sched' }, slots.map((s) => {
    const ms = c.matches.filter((m) => m.s === s).sort((a, b) => a.c - b.c);
    const all = ms.every((m) => m.w);
    return h('div', { class: 'cz-slot' + (all ? ' done' : '') + (s === curSlot ? ' now' : '') },
      h('div', { class: 'cz-slot-h' }, `${s + 1}차`, s === curSlot ? h('span', { class: 'cz-now' }, '지금') : null),
      h('div', { class: 'cz-slot-ms', style: `--k:${Math.min(K, 4)}` }, ms.map((m) => h('div', null, K > 1 ? h('div', { class: 'cz-court' }, `${m.c + 1}경기장`) : null, scoreBox(c, m, redraw)))));
  }));
}
function cupBracket(c, redraw) {
  const maxR = Math.max(...c.matches.filter((m) => m.k !== 'third').map((m) => m.r));
  const cols = [];
  for (let r = 0; r <= maxR; r++) {
    const ms = c.matches.filter((m) => m.r === r && m.k !== 'third');
    cols.push(h('div', { class: 'cz-col' }, h('div', { class: 'cz-col-h' }, roundName(c, r)),
      h('div', { class: 'cz-col-ms' }, ms.map((m) => h('div', { class: 'cz-cell' }, !isBye(m) && real(m) && c.cfg.courts > 1 ? h('div', { class: 'cz-court' }, `${m.s + 1}차 · ${m.c + 1}경기장`) : null, scoreBox(c, m, redraw))))));
  }
  const third = c.matches.find((m) => m.k === 'third');
  return h('div', null, h('div', { class: 'cz-bracket' }, cols),
    third ? h('div', { class: 'cz-thirdbox' }, h('div', { class: 'cz-col-h' }, '3·4위전'), scoreBox(c, third, redraw)) : null);
}
function standings(c) {
  if (c.kind === 'league') {
    const T = leagueTable(c), P = c.cfg.pts;
    return h('div', { class: 'card' }, h('div', { class: 'muted', style: 'margin-bottom:8px;font-size:13px' }, `승점: 승 ${P.w} · 무 ${P.d} · 패 ${P.l}  |  같으면 득실차 → 득점 순`),
      h('div', { class: 'cz-tbl-wrap' }, h('table', { class: 'cz-tbl' },
        h('thead', null, h('tr', null, ['순위', '이름', '경기', '승', '무', '패', '득점', '실점', '득실차', '승점'].map((x) => h('th', null, x)))),
        h('tbody', null, T.map((t) => h('tr', { class: t.rank <= 3 && t.gp ? 'top' + t.rank : '' }, h('td', null, t.rank), h('td', { class: 'nm' }, t.name), h('td', null, t.gp), h('td', null, t.w), h('td', null, t.d), h('td', null, t.l), h('td', null, t.gf), h('td', null, t.ga), h('td', null, (t.gd > 0 ? '+' : '') + t.gd), h('td', null, h('b', null, t.pts))))))));
  }
  const T = cupTable(c);
  return h('div', { class: 'card' }, h('div', { class: 'cz-tbl-wrap' }, h('table', { class: 'cz-tbl' },
    h('thead', null, h('tr', null, ['순위', '이름', '결과'].map((x) => h('th', null, x)))),
    h('tbody', null, T.map((t) => h('tr', { class: t.rank && t.rank <= 3 ? 'top' + t.rank : '' }, h('td', null, t.rank || '-'), h('td', { class: 'nm' }, t.name), h('td', null, t.label)))))));
}
function members(c) {
  if (c.unit !== 'team') return null;
  return h('div', { class: 'card' }, h('h3', null, '팀 명단'), h('div', { class: 'cz-teams' }, c.teams.map((t) => h('div', { class: 'cz-team' },
    h('div', { class: 'cz-team-h' }, h('b', null, t.name), h('span', { class: 'muted' }, `${t.members.length}명`)),
    h('div', { class: 'cz-team-m' }, t.members.map(stu).filter(Boolean).map((s) => h('span', { class: 'cz-chip ' + gcls(s.gender) }, s.name)))))));
}
function contestView(c, redraw) {
  const tabs = h('div', { class: 'tabs', style: 'margin:12px 0' }, [['bracket', '대진표 보기'], ['table', '순위표 보기']].map(([k, n]) => h('button', { class: 'tab' + (C.view === k ? ' active' : ''), onclick: () => { C.view = k; redraw(); } }, n)));
  return h('div', null, titleBar(c), tabs,
    C.view === 'bracket' ? h('div', { class: 'card cz-board' }, c.kind === 'league' ? leagueBracket(c, redraw) : cupBracket(c, redraw)) : h('div', null, standings(c), members(c)));
}

/* ---------- 페이지 ---------- */
APP.pages.contest = () => {
  const wrap = h('div');
  const redraw = async () => {
    if (!C.index) { wrap.replaceChildren(APP.loading()); try { await loadIndex(); } catch (e) { wrap.replaceChildren(h('div', { class: 'card placeholder' }, errMsg(e))); return; } }
    if (C.wiz) return wrap.replaceChildren(wizardView(redraw));
    const L = C.index.list;
    if (!L.length) return wrap.replaceChildren(h('div', { class: 'card cz-empty' }, h('div', { class: 'muted', style: 'margin-bottom:14px' }, '아직 대회가 없어요. 먼저 새 대회를 추가해 주세요.'),
      h('button', { class: 'primary big', onclick: () => { C.wiz = newWizard(); redraw(); } }, '+ 새 대회 추가하기')));
    const bar = h('div', { class: 'row cz-bar' },
      h('select', { class: 'cz-sel', onchange: (e) => { C.cur = C.index.cur = e.target.value; saveIndex(); redraw(); } },
        L.slice().reverse().map((x) => h('option', { value: x.id, selected: x.id === C.cur }, `${x.name} (${KIND[x.kind]}·${UNIT[x.unit]})${x.total && x.done === x.total ? ' ✓' : ''}`))),
      h('div', { style: 'flex:1' }),
      h('button', { class: 'primary', onclick: () => { C.wiz = newWizard(); redraw(); } }, '+ 새 대회 추가하기'),
      h('button', { class: 'ghost', onclick: async () => {
        const it = L.find((x) => x.id === C.cur); if (!it || !confirm(`"${it.name}" 대회를 지울까요? 기록도 모두 지워져요.`)) return;
        C.index.list = L.filter((x) => x !== it); delete C.cache[it.id]; C.cur = C.index.cur = (C.index.list[C.index.list.length - 1] || {}).id || null;
        try { await APP.kvDel(keyOf(it.id)); await APP.kvSet('contest:index', C.index); } catch (e) { toast(errMsg(e), true); }
        redraw();
      } }, '삭제'));
    const body = h('div', null, APP.loading());
    wrap.replaceChildren(bar, body);
    const c = await getContest(C.cur).catch((e) => { toast(errMsg(e), true); return null; });
    if (!wrap.isConnected && !document.body.contains(wrap)) { /* 다른 메뉴로 이동함 */ }
    body.replaceChildren(c ? contestView(c, redraw) : h('div', { class: 'card placeholder' }, '대회 기록을 불러오지 못했어요.'));
  };
  redraw();
  return wrap;
};
APP._contest = { leagueMatches, cupMatches, resolve, leagueTable, cupTable, unpack, pack };   // 시험용
})();
