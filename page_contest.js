/* 대회 관리: 리그 · 토너먼트 만들기, 경기 기록, 순위표, 대진표 (레이아웃은 체육 워크스페이스 대회 운영과 같게) */
(() => {
'use strict';
const APP = window.APP;
const { h, toast, errMsg } = APP;

const C = { index: null, cache: {}, cur: null, pend: false, cv: false, bmode: 'h' };
APP.onClear.push(() => { C.index = null; C.cache = {}; C.cur = null; });
try { const p = JSON.parse(localStorage.getItem('contest_view') || '{}'); C.pend = !!p.pend; C.cv = !!p.cv; C.bmode = p.bmode || 'h'; } catch (e) { /* 기본 */ }
const saveView = () => { try { localStorage.setItem('contest_view', JSON.stringify({ pend: C.pend, cv: C.cv, bmode: C.bmode })); } catch (e) { /* 저장 안 됨 */ } };

const UNIT = { individual: '개인', team: '팀', class: '반대항' };
const SCORING = [['score', '득점·실점'], ['sets', '세트 스코어'], ['wdl', '승·무·패']];
const roster = () => APP.roster();
const stu = (n) => roster().find((s) => s.num === n);
const gcls = (g) => APP.gcls(g);
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const unitWord = (c) => (c.unit === 'team' ? '팀' : c.unit === 'class' ? '반' : '명');

/* ---------- 대진 만들기 ---------- */
/* 리그: 원형 방식. 라운드마다 한 참가자는 한 경기만 (entrant 인덱스) */
function leagueMatches(n, legs) {
  const t = Array.from({ length: n }, (_, i) => i); if (t.length % 2) t.push(null);
  const L = t.length; let arr = t.slice(); const base = [];
  for (let r = 0; r < L - 1; r++) {
    const ms = [];
    for (let i = 0; i < L / 2; i++) { const a = arr[i], b = arr[L - 1 - i]; if (a != null && b != null) ms.push(r % 2 ? [b, a] : [a, b]); }
    base.push(ms); arr = [arr[0], arr[L - 1], ...arr.slice(1, L - 1)];
  }
  const all = legs === 2 ? [...base, ...base.map((ms) => ms.map(([a, b]) => [b, a]))] : base;
  const out = []; all.forEach((ms, r) => ms.forEach(([a, b]) => out.push({ a, b, r })));
  return out;
}
/* 토너먼트: 2의 거듭제곱 칸, 부전승은 위 시드에게 고르게 */
function seedsFor(len) { let size = 2; while (size < len) size *= 2; let s = [1, 2]; while (s.length < size) { const m = s.length * 2 + 1; s = s.flatMap((x) => [x, m - x]); } return s; }
const makeSlots = (ids) => seedsFor(ids.length).map((sd) => (ids[sd - 1] != null ? ids[sd - 1] : null));
const seedOrder = (slots) => { const sd = seedsFor(slots.length); return slots.map((id, k) => ({ id, s: sd[k] })).filter((x) => x.id != null).sort((a, b) => a.s - b.s).map((x) => x.id); };
const arrangeIds = (ids, big) => [...ids.filter((i) => big[i]), ...ids.filter((i) => !big[i])];
const roundName = (cnt) => (cnt === 1 ? '결승' : cnt === 2 ? '준결승' : `${cnt * 2}강`);
function bracket(c) {
  const size = c.slots.length, R = Math.round(Math.log2(size)), rounds = []; let no = 0;
  for (let r = 0; r < R; r++) {
    const cnt = size >> (r + 1), ms = [];
    for (let i = 0; i < cnt; i++) {
      let a, b, bye = false;
      if (r === 0) { a = c.slots[2 * i]; b = c.slots[2 * i + 1]; bye = a == null || b == null; } else { a = rounds[r - 1][2 * i].w; b = rounds[r - 1][2 * i + 1].w; }
      const key = `t${r}-${i}`, res = a != null && b != null ? c.res[key] || null : null;
      const m = { key, r, i, a: a ?? null, b: b ?? null, bye, res, name: roundName(cnt) };
      m.w = bye ? (a ?? b ?? null) : res ? (res.w === 'a' ? a : res.w === 'b' ? b : null) : null;
      m.l = !bye && res ? (res.w === 'a' ? b : res.w === 'b' ? a : null) : null;
      ms.push(m);
    }
    let k = 0, rn = 0; ms.forEach((m) => { if (!m.bye) { m.rn = ++rn; m.no = ++no; m.court = (k++ % c.courts) + 1; } });
    rounds.push(ms);
  }
  let third = null;
  if (c.third && R >= 2) { const sf = rounds[R - 2]; const a = sf[0].l, b = sf[1].l; third = { key: 'third', a, b, res: a != null && b != null ? c.res.third || null : null, name: '3·4위전', court: 1, no: ++no }; }
  return { rounds, third, final: rounds[R - 1][0] };
}
/* 리그 경기 순서: 빅매치는 뒤로, 한 차례(경기장 수만큼)에 같은 참가자가 겹치지 않게 */
function arranged(c) {
  const big = c.big || {}, bm = (m) => big[m.a] && big[m.b];
  const list = c.matches.map((m, idx) => ({ ...m, key: 'm' + idx, res: c.res['m' + idx] || null, bigm: bm(m) }));
  const rest = [...list.filter((m) => !m.bigm), ...list.filter((m) => m.bigm)], out = [];
  while (rest.length) {
    const used = new Set(), slot = [];
    for (let i = 0; i < rest.length && slot.length < c.courts;) { const q = rest[i]; if (used.has(q.a) || used.has(q.b)) { i++; continue; } used.add(q.a); used.add(q.b); slot.push(q); rest.splice(i, 1); }
    slot.forEach((q, k) => { q.court = k + 1; out.push(q); });
  }
  out.forEach((q, i) => { q.no = i + 1; });
  return out;
}
function allGames(c) {
  if (c.format === 'league') return arranged(c);
  const b = bracket(c); return [...b.rounds.flat().filter((x) => !x.bye), ...(b.third ? [b.third] : [])];
}
function progress(c) { const l = allGames(c); const t = l.length, d = l.filter((x) => x.res).length; return { done: d, total: t, pct: t ? Math.round(d / t * 100) : 0 }; }

/* ---------- 순위 ---------- */
function standings(c) {
  const T = c.entrants.map((e, i) => ({ i, p: 0, w: 0, d: 0, l: 0, f: 0, a: 0 }));
  c.matches.forEach((m, idx) => { const r = c.res['m' + idx]; if (!r) return; const A = T[m.a], B = T[m.b]; A.p++; B.p++;
    if (r.sa != null) { A.f += r.sa; A.a += r.sb; B.f += r.sb; B.a += r.sa; }
    if (r.w === 'a') { A.w++; B.l++; } else if (r.w === 'b') { B.w++; A.l++; } else { A.d++; B.d++; } });
  const rows = T.map((x) => ({ ...x, pts: x.w * c.pts.w + x.d * c.pts.d + x.l * c.pts.l, diff: x.f - x.a }));
  const h2h = (x, y) => { let s = 0; c.matches.forEach((m, idx) => { const r = c.res['m' + idx]; if (!r) return; if (m.a === x.i && m.b === y.i) s += r.w === 'a' ? 1 : r.w === 'b' ? -1 : 0; else if (m.a === y.i && m.b === x.i) s += r.w === 'b' ? 1 : r.w === 'a' ? -1 : 0; }); return s; };
  rows.sort((x, y) => y.pts - x.pts || (c.tie === 'h2h' ? h2h(y, x) : 0) || y.diff - x.diff || y.f - x.f || y.w - x.w || (c.tie !== 'h2h' ? h2h(y, x) : 0) || x.i - y.i);
  let rank = 0; rows.forEach((r, k) => { const p = rows[k - 1]; if (!p || p.pts !== r.pts || p.diff !== r.diff || p.f !== r.f || p.w !== r.w) rank = k + 1; r.rank = rank; });
  return rows;
}
const scText = (c, r) => (!r ? 'vs' : c.scoring === 'wdl' ? (r.w === 'a' ? '승 : 패' : r.w === 'b' ? '패 : 승' : '무 : 무') : `${r.sa} : ${r.sb}`);

/* ---------- 저장 (경기·기록을 짧게 줄여서) ---------- */
const keyOf = (id) => 'contest:c:' + id;
const pack = (c) => ({ v: 2, ...c, matches: c.matches ? c.matches.map((m) => [m.a, m.b, m.r]) : undefined, res: Object.fromEntries(Object.entries(c.res || {}).map(([k, r]) => [k, [r.sa ?? null, r.sb ?? null, r.w]])) });
const unpack = (o) => ({ ...o, matches: o.matches ? o.matches.map((m) => ({ a: m[0], b: m[1], r: m[2] })) : undefined, res: Object.fromEntries(Object.entries(o.res || {}).map(([k, r]) => [k, { sa: r[0], sb: r[1], w: r[2] }])), out: o.out || {}, big: o.big || {}, live: o.live || {} });
/* 예전 형식(v1) 대회 옮기기 */
function migrate(o) {
  const ms = (o.matches || []).map((a) => ({ a: a[0] ?? null, b: a[1] ?? null, r: a[2] || 0, sa: a[5] ?? null, sb: a[6] ?? null, w: a[7] || 0, k: a[10] || null, p: a[11] || null }));
  const W = (m) => (m.w === 1 ? 'a' : m.w === 2 ? 'b' : m.w === 3 ? 'd' : null);
  const unit = o.unit === 'solo' ? 'individual' : o.unit;
  const c = { id: o.id, name: o.name, format: o.kind === 'cup' ? 'tournament' : 'league', unit, created: o.created, legs: o.cfg && o.cfg.double ? 2 : 1, draw: true, pts: (o.cfg && o.cfg.pts) || { w: 3, d: 1, l: 0 }, tie: 'diff', third: !!(o.cfg && o.cfg.third),
    scoring: 'score', target: o.cfg && o.cfg.scoring === 'target' ? o.cfg.target : null, sets: 3, courts: (o.cfg && o.cfg.courts) || 1,
    entrants: (o.teams || []).map((t, i) => ({ id: 'e' + i, name: t.name, members: t.members || [] })), res: {}, out: {}, big: {}, live: {} };
  if (c.format === 'league') { c.matches = ms.map((m) => ({ a: m.a, b: m.b, r: m.r })); ms.forEach((m, i) => { if (W(m)) c.res['m' + i] = { sa: m.sa, sb: m.sb, w: W(m) }; }); }
  else {
    const r0 = ms.filter((m) => m.r === 0 && m.k !== 'third'); c.slots = r0.flatMap((m) => [m.a === -1 ? null : m.a, m.b === -1 ? null : m.b]);
    const byR = {}; ms.forEach((m) => { if (m.k === 'third') { if (W(m)) c.res.third = { sa: m.sa, sb: m.sb, w: W(m) }; return; } (byR[m.r] = byR[m.r] || []).push(m); });
    Object.entries(byR).forEach(([r, list]) => list.forEach((m, i) => { const w = m.w ? (m.w === 1 ? 'a' : 'b') : null; if (w && m.a !== -1 && m.b !== -1) c.res[`t${r}-${i}`] = { sa: m.sa, sb: m.sb, w }; }));
  }
  return c;
}
let saveT = null, saveIdxT = null;
function save(c) {
  C.cache[c.id] = c;
  clearTimeout(saveT);
  saveT = setTimeout(() => APP.kvSet(keyOf(c.id), pack(c)).catch((e) => toast(e.message === 'TOOBIG' ? '대회 기록이 너무 커서 저장하지 못했어요.' : errMsg(e), true)), 500);
  const it = C.index.list.find((x) => x.id === c.id);
  if (it) { const p = progress(c); Object.assign(it, { name: c.name, format: c.format, unit: c.unit, done: p.done, total: p.total, archived: !!c.archived }); saveIndex(); }
}
async function saveNow(c) {
  clearTimeout(saveT); clearTimeout(saveIdxT); C.cache[c.id] = c;
  const it = C.index.list.find((x) => x.id === c.id);
  if (it) { const p = progress(c); Object.assign(it, { name: c.name, format: c.format, unit: c.unit, done: p.done, total: p.total, archived: !!c.archived }); }
  try { await APP.kvSet(keyOf(c.id), pack(c)); await APP.kvSet('contest:index', C.index); } catch (e) { toast(errMsg(e), true); }
}
function saveIndex() { clearTimeout(saveIdxT); saveIdxT = setTimeout(() => APP.kvSet('contest:index', C.index).catch((e) => toast(errMsg(e), true)), 400); }
async function loadIndex() {
  const kv = await APP.kvGet(['contest:index']);
  C.index = kv['contest:index'] && Array.isArray(kv['contest:index'].list) ? kv['contest:index'] : { list: [], cur: null };
  C.index.list.forEach((x) => { if (x.kind) { x.format = x.kind === 'cup' ? 'tournament' : 'league'; delete x.kind; } if (x.unit === 'solo') x.unit = 'individual'; });
  C.cur = C.index.cur;
}
async function getContest(id) {
  if (C.cache[id]) return C.cache[id];
  const kv = await APP.kvGet([keyOf(id)]); const o = kv[keyOf(id)];
  if (!o) return null;
  const c = o.v === 2 ? unpack(o) : migrate(o);
  C.cache[id] = c; return c;
}

/* ---------- 작은 부품 ---------- */
const seg = (cur, opts, on) => h('div', { class: 'cz-seg' }, opts.map(([v, n, dis]) => h('button', { type: 'button', class: cur === v ? 'on' : '', disabled: !!dis, onclick: () => on(v) }, n)));
const setRow = (label, sub, ctl) => h('div', { class: 'cz-setrow' }, h('span', null, h('b', null, label), sub ? h('small', null, sub) : null), ctl);
const stepper = (val, min, max, on, cls) => h('div', { class: 'cz-stepper ' + (cls || '') },
  h('button', { type: 'button', onclick: () => on(Math.max(min, val - 1)) }, '−'),
  h('input', { type: 'number', inputmode: 'numeric', value: val, min, max, onchange: (e) => on(Math.max(min, Math.min(max, Number(e.target.value) | 0))) }),
  h('button', { type: 'button', onclick: () => on(Math.min(max, val + 1)) }, '+'));
const bar = (pct) => h('span', { class: 'cz-bar' }, h('i', { style: `width:${pct}%` }));
function dialog(title, body, foot, cls) {
  const ov = h('div', { class: 'overlay' });
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  ov.append(h('div', { class: 'modal cz-dlg ' + (cls || '') }, h('h3', null, title), body, foot ? h('div', { class: 'cz-foot' }, foot) : null));
  ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
  document.addEventListener('keydown', esc); document.body.append(ov);
  return { ov, close };
}

/* ---------- 경기 규칙 (만들 때·고칠 때 같이) ---------- */
function rulesBody(d, rd, isL, lock) {
  const ptIn = (k, n) => h('label', { class: 'cz-pt' }, n, h('input', { type: 'number', min: 0, max: 9, value: d.pts[k], onchange: (e) => { d.pts[k] = Math.max(0, Math.min(9, Number(e.target.value) | 0)); } }));
  return [
    isL ? h('div', { class: 'cz-sec' }, h('b', { class: 'cz-sec-t' }, '리그'),
      setRow('경기 횟수', lock.legs ? '기록이 있어서 바꿀 수 없어요' : '서로 몇 번씩 만나는지', seg(d.legs, [[1, '한 번씩', lock.legs && d.legs !== 1], [2, '두 번씩', lock.legs && d.legs !== 2]], (v) => { d.legs = v; rd(); })),
      setRow('무승부', lock.noDraw ? '무승부 기록이 있어서 끌 수 없어요' : '', seg(d.draw ? 'y' : 'n', [['n', '없음', lock.noDraw], ['y', '있음']], (v) => { d.draw = v === 'y'; rd(); })),
      setRow('승점', '승 · 무 · 패', h('span', { class: 'cz-pts' }, ptIn('w', '승'), d.draw ? ptIn('d', '무') : null, ptIn('l', '패'))),
      setRow('승점이 같을 때', '', seg(d.scoring === 'wdl' ? 'h2h' : d.tie, d.scoring === 'wdl' ? [['h2h', '승자승 먼저']] : [['diff', '득실차 먼저'], ['h2h', '승자승 먼저']], (v) => { d.tie = v; rd(); })))
      : h('div', { class: 'cz-sec' }, h('b', { class: 'cz-sec-t' }, '토너먼트'),
        setRow('3·4위전', '', seg(d.third ? 'y' : 'n', [['n', '없음'], ['y', '진행']], (v) => { d.third = v === 'y'; rd(); })),
        lock.edit ? null : setRow('대진 배치', '', seg(d.seed, [['random', '무작위'], ['order', '고른 순서']], (v) => { d.seed = v; rd(); }))),
    h('div', { class: 'cz-sec' }, h('b', { class: 'cz-sec-t' }, '기록'),
      setRow('기록 방식', lock.scoring ? '기록이 있어서 바꿀 수 없어요' : d.scoring === 'score' ? '양쪽 점수를 모두 적어요' : d.scoring === 'sets' ? '이긴 세트 수만 적어요 (예 2:1)' : '누가 이겼는지만 적어요',
        seg(d.scoring, SCORING.map(([v, n]) => [v, n, lock.scoring && v !== d.scoring]), (v) => { d.scoring = v; if (v === 'wdl') d.tie = 'h2h'; rd(); })),
      d.scoring === 'score' ? setRow('목표 점수', '먼저 이 점수에 닿으면 끝', h('span', { class: 'cz-inline' }, seg(d.useTarget ? 'y' : 'n', [['n', '없음'], ['y', '있음']], (v) => { d.useTarget = v === 'y'; rd(); }), d.useTarget ? stepper(d.target, 1, 99, (v) => { d.target = v; rd(); }) : null)) : null,
      d.scoring === 'sets' ? setRow('세트 수', `${Math.ceil(d.sets / 2)}세트를 먼저 따면 승리`, seg(d.sets, [[1, '단판'], [3, '3세트'], [5, '5세트']].map(([v, n]) => [v, n, lock.scoring && v !== d.sets]), (v) => { d.sets = v; rd(); })) : null),
    h('div', { class: 'cz-sec' }, h('b', { class: 'cz-sec-t' }, '경기장'),
      setRow('경기장 수', '경기를 경기장에 차례로 자동 배치해요', stepper(d.courts, 1, 8, (v) => { d.courts = v; rd(); })))];
}

/* 지난 대회 결과로 학생 실력 점수(0~1) 만들기 — 여러 대회를 고르면 평균 */
async function ratingsFrom(ids) {
  const sum = new Map(), cnt = new Map();
  const add = (num, v) => { sum.set(num, (sum.get(num) || 0) + v); cnt.set(num, (cnt.get(num) || 0) + 1); };
  for (const id of ids) {
    const c = await getContest(id).catch(() => null); if (!c || !Object.keys(c.res || {}).length) continue;
    const score = new Map();
    if (c.format === 'league') {
      const rows = standings(c), n = rows.length;
      rows.forEach((r) => score.set(r.i, n > 1 ? 1 - (r.rank - 1) / (n - 1) : 0.5));
    } else {
      const br = bracket(c), R = br.rounds.length, wins = new Map();
      br.rounds.forEach((ms) => ms.forEach((m) => { if (!m.bye && m.w != null) wins.set(m.w, (wins.get(m.w) || 0) + 1); }));
      c.entrants.forEach((_, i) => { let w = wins.get(i) || 0; if (br.third && br.third.res) { if ((br.third.res.w === 'a' ? br.third.a : br.third.b) === i) w += 0.5; } score.set(i, R ? Math.min(1, w / R) : 0.5); });
    }
    c.entrants.forEach((e, i) => { if (!score.has(i)) return; [...new Set(e.members || [])].forEach((num) => add(num, score.get(i))); });
  }
  const out = new Map(); sum.forEach((v, k) => out.set(k, v / cnt.get(k)));
  return out;
}
/* 팀 짜기: 팀 수 × 팀당 인원. 자리가 학생보다 많으면 몇 명은 두 팀에서 뛰고, 적으면 남는 학생은 미배정 */
function assignTeams(T, ids) {
  const byNum = (n) => roster().find((s) => s.num === n) || {};
  const N = T.teams.length, P = perOf(T, ids.length), slots = N * P;
  const rate = (n) => (T.ratings && T.ratings.has(n) ? T.ratings.get(n) : 0.5);
  const g = (n) => byNum(n).gender;
  const mem = T.teams.map(() => []);
  let order;
  if (T.method === 'random') order = shuffle(ids);
  else order = shuffle(ids).sort((a, b) => rate(b) - rate(a));
  // 성별 조건
  const groups = T.gmode === 'none' ? [order] : [order.filter((n) => g(n) === '남'), order.filter((n) => g(n) === '여'), order.filter((n) => !['남', '여'].includes(g(n)))];
  let left = [];
  if (ids.length > slots) {   // 자리가 모자라면 무작위로 몇 명은 미배정
    const keep = new Set(shuffle(ids).slice(0, slots));
    left = ids.filter((n) => !keep.has(n));
    groups.forEach((gr, k) => { groups[k] = gr.filter((n) => keep.has(n)); });
  }
  let teamsFor = () => Array.from({ length: N }, (_, i) => i);
  if (T.gmode === 'sep' && groups[0].length && groups[1].length && N >= 2) {
    const tm = Math.min(N - 1, Math.max(1, Math.round(N * groups[0].length / (groups[0].length + groups[1].length))));
    teamsFor = (k) => (k === 0 ? Array.from({ length: tm }, (_, i) => i) : k === 1 ? Array.from({ length: N - tm }, (_, i) => tm + i) : Array.from({ length: N }, (_, i) => i));
  }
  const snake = []; let si = 0;   // 상위·하위 섞기: 1→N, N→1 순서를 계속 이어감 (남녀를 나눠도 이어서)
  for (let r = 0; r < 200; r++) for (let i = 0; i < N; i++) snake.push(r % 2 ? N - 1 - i : i);
  groups.forEach((gr, k) => {
    const tset = teamsFor(k), capK = T.gmode === 'equal' ? Math.ceil(gr.length / tset.length) : Infinity, inK = (i) => mem[i].filter((x) => gr.includes(x)).length;
    gr.forEach((n) => {
      let open = tset.filter((i) => mem[i].length < P && (T.method !== 'similar' || inK(i) < capK));
      if (!open.length) open = tset.filter((i) => mem[i].length < P);
      if (!open.length) { const t = tset.slice().sort((a, b) => mem[a].length - mem[b].length)[0]; mem[t].push(n); return; }
      let t;
      if (T.method === 'similar') t = open.slice().sort((a, b) => mem[b].length - mem[a].length || a - b)[0];   // 한 팀씩 채움
      else if (T.method === 'mixed') { while (si < snake.length && !open.includes(snake[si])) si++; t = si < snake.length ? snake[si++] : open[0]; }
      else { const mn = Math.min(...open.map((i) => mem[i].length)); t = shuffle(open.filter((i) => mem[i].length === mn))[0]; }
      mem[t].push(n);
    });
  });
  // 자리가 남으면 두 번 뛰는 학생으로 채움 (한 팀에 같은 학생은 한 번만, 가장 적게 뛴 학생부터)
  const times = new Map(); mem.flat().forEach((n) => times.set(n, (times.get(n) || 0) + 1));
  const avgAll = ids.length ? ids.reduce((a, n) => a + rate(n), 0) / ids.length : 0.5;
  for (let i = 0; i < N; i++) {
    while (mem[i].length < P) {
      const pick = shuffle(ids.filter((n) => !mem[i].includes(n) && !left.includes(n))).sort((a, b) => {
        const ta = times.get(a) || 0, tb = times.get(b) || 0; if (ta !== tb) return ta - tb;
        if (T.method === 'random') return 0;
        const cur = mem[i].reduce((s, n) => s + rate(n), 0), aim = T.method === 'similar' ? cur / Math.max(1, mem[i].length) : avgAll * (mem[i].length + 1) - cur;
        return Math.abs(rate(a) - aim) - Math.abs(rate(b) - aim);
      })[0];
      if (pick == null) break;
      mem[i].push(pick); times.set(pick, (times.get(pick) || 0) + 1);
    }
  }
  // 상위·하위 섞기: 팀 평균이 가장 높은 팀과 낮은 팀 사이에서 같은 성별끼리 바꿔 차이를 줄임
  if (T.method === 'mixed') {
    const avg = (i) => mem[i].reduce((a, n) => a + rate(n), 0) / Math.max(1, mem[i].length);
    for (let it = 0; it < 300; it++) {
      const idx = mem.map((_, i) => i).sort((a, b) => avg(b) - avg(a)), A = idx[0], B = idx[idx.length - 1];
      const gap = avg(A) - avg(B); if (gap < 0.02) break;
      let best = null;
      mem[A].forEach((x, ia) => mem[B].forEach((y, ib) => {
        if (T.gmode !== 'none' && g(x) !== g(y)) return;
        if (mem[B].includes(x) || mem[A].includes(y)) return;
        const d = rate(x) - rate(y); if (d <= 0) return;
        const nA = avg(A) - d / mem[A].length, nB = avg(B) + d / mem[B].length, ng = Math.abs(nA - nB);
        if (ng < gap - 1e-6 && (!best || ng < best.ng)) best = { ia, ib, ng };
      }));
      if (!best) break;
      const t = mem[A][best.ia]; mem[A][best.ia] = mem[B][best.ib]; mem[B][best.ib] = t;
    }
  }
  T.teams.forEach((t, i) => { t.members = mem[i].sort((a, b) => a - b); });
  T.pool = left.sort((a, b) => a - b);
}
const perOf = (T, n) => Math.max(1, T.per || Math.ceil(n / Math.max(1, T.teams.length)));

/* ---------- 팀 나누기 (만들기·팀 수정에서 같이) ---------- */
function teamBoard(T, rd, lockCount) {
  const all = roster(), byNum = (n) => all.find((s) => s.num === n);
  T.method = T.method || 'random'; T.src = T.src || new Set();
  const inTeam = new Set(T.teams.flatMap((t) => t.members));
  T.pool = [...new Set(T.pool)].filter((n) => !inTeam.has(n) && byNum(n));
  const people = [...new Set([...T.teams.flatMap((t) => t.members), ...T.pool])].filter((n) => byNum(n));
  const N = T.teams.length, P = perOf(T, people.length), slots = N * P;
  // 팀 수를 줄이면 빠지는 팀의 학생은 미배정으로 돌아감 (학생이 사라지지 않게)
  const setCount = (k) => {
    if (k > T.teams.length) T.teams = [...T.teams, ...Array.from({ length: k - T.teams.length }, (_, i) => ({ id: uid(), name: `${T.teams.length + i + 1}팀`, members: [] }))];
    else { const gone = T.teams.slice(k); T.teams = T.teams.slice(0, k); const still = new Set(T.teams.flatMap((t) => t.members)); gone.forEach((t) => t.members.forEach((n) => { if (!still.has(n) && !T.pool.includes(n)) T.pool.push(n); })); }
    rd();
  };
  // from: 'pool' 또는 팀 id. 중복 넣기를 켜면 팀→팀이 복사
  const moveTo = (to, n, from) => {
    const src = from || T.pickFrom;
    const tgt = T.teams.find((x) => x.id === to);
    if (tgt && tgt.members.includes(n)) { T.pick = null; return rd(); }
    if (!(T.dup && src !== 'pool' && to !== 'pool')) {
      if (src === 'pool') T.pool = T.pool.filter((x) => x !== n);
      else { const s = T.teams.find((x) => x.id === src); if (s) { const i = s.members.indexOf(n); if (i >= 0) s.members.splice(i, 1); } }
    }
    if (to === 'pool') { if (!T.teams.some((t) => t.members.includes(n)) && !T.pool.includes(n)) T.pool.push(n); }
    else if (tgt) tgt.members.push(n);
    T.pick = null; T.pickFrom = null; rd();
  };
  const runAssign = () => {
    if (T.method !== 'random' && !T.src.size) return toast('실력으로 짜려면 아래에서 지난 대회를 하나 이상 골라 주세요', true);
    assignTeams(T, people); rd();
  };
  const gc = (ids) => { const gg = (k) => ids.filter((n) => (byNum(n) || {}).gender === k).length; return h('span', { class: 'cz-gc' }, h('b', { class: 'm' }, '남 ' + gg('남')), h('b', { class: 'f' }, '여 ' + gg('여'))); };
  const times = new Map(); T.teams.forEach((t) => t.members.forEach((n) => times.set(n, (times.get(n) || 0) + 1)));
  const chip = (n, from) => { const s = byNum(n); if (!s) return null;
    const r = T.ratings && T.ratings.has(n) ? T.ratings.get(n) : null;
    const el = h('span', { class: 'cz-chip ' + gcls(s.gender) + (T.pick === n && T.pickFrom === from ? ' pick' : '') + ((times.get(n) || 0) > 1 ? ' twice' : ''), draggable: 'true', title: (times.get(n) || 0) > 1 ? '두 팀에서 뛰어요' : '',
      onclick: (e) => { e.stopPropagation(); if (T.pick === n && T.pickFrom === from) { T.pick = null; T.pickFrom = null; } else { T.pick = n; T.pickFrom = from; } rd(); } },
      h('small', null, s.num), s.name, r != null && T.method !== 'random' ? h('i', { class: 'cz-rate' }, '★'.repeat(Math.max(1, Math.round(r * 4) + 1))) : null);
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', n + '|' + from); });
    return el; };
  const drop = (el, to) => {
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drop'); const [n, from] = e.dataTransfer.getData('text/plain').split('|'); if (Number(n)) moveTo(to, Number(n), from); });
    el.addEventListener('click', () => { if (T.pick != null) moveTo(to, T.pick); });
    return el; };
  // 지난 대회 목록 (결과가 있는 것)
  const past = (C.index ? C.index.list : []).filter((x) => x.done > 0 && x.unit !== 'class');
  const pickSrc = async (id) => { T.src.has(id) ? T.src.delete(id) : T.src.add(id); T.ratings = T.src.size ? await ratingsFrom([...T.src]) : null; rd(); };
  const dupN = Math.max(0, slots - people.length), leftN = Math.max(0, people.length - slots);
  return h('div', null,
    h('div', { class: 'cz-sizes' },
      lockCount ? h('span', { class: 'muted' }, `팀 ${N}개 (대진이 정해져서 바꿀 수 없어요)`) : setRow('팀 수', '', stepper(N, 2, 32, setCount)),
      setRow('팀당 인원', T.per ? '' : '자동 (학생 수 ÷ 팀 수)', h('span', { class: 'cz-inline' }, stepper(P, 1, 40, (v) => { T.per = v; rd(); }), T.per ? h('button', { class: 'sm ghost', type: 'button', onclick: () => { T.per = null; rd(); } }, '자동') : null))),
    h('div', { class: 'cz-calc' + (dupN ? ' warn' : '') }, `학생 ${people.length}명 · ${N}팀 × ${P}명 = ${slots}자리`,
      dupN ? ` → ${dupN}명은 두 팀에서 뛰어요 (팀 짜기를 누르면 자동으로 정해요)` : leftN ? ` → ${leftN}명은 자리가 없어 미배정으로 남아요` : ' → 딱 맞아요'),
    h('div', { class: 'cz-auto' },
      h('span', { class: 'muted' }, '짜는 방식'), seg(T.method, [['random', '랜덤'], ['similar', '실력 비슷한 끼리'], ['mixed', '상위·하위 섞어서']], async (v) => { T.method = v; rd(); }),
      h('span', { class: 'muted' }, '성별'), seg(T.gmode, [['equal', '남녀 동비율'], ['sep', '남녀 따로'], ['none', '성별 무시']], (v) => { T.gmode = v; rd(); }),
      h('button', { class: 'sm primary', type: 'button', onclick: runAssign, title: '누를 때마다 다시 짜요' }, '🎲 팀 짜기'),
      h('button', { class: 'sm', type: 'button', onclick: () => { T.pool = people.slice(); T.teams.forEach((t) => { t.members = []; }); rd(); } }, '모두 빼기')),
    T.method !== 'random' ? h('div', { class: 'cz-src' }, h('b', null, '실력 기준으로 쓸 지난 대회'),
      past.length ? h('div', { class: 'cz-chips' }, past.map((x) => h('button', { type: 'button', class: 'cz-srcchip' + (T.src.has(x.id) ? ' on' : ''), onclick: () => pickSrc(x.id) }, `${x.name} (${x.format === 'league' ? '리그' : '토너먼트'} · ${x.done}경기)`)))
        : h('span', { class: 'muted' }, '결과가 있는 지난 대회가 없어요. 먼저 대회를 치르고 기록해 주세요.'),
      h('div', { class: 'muted', style: 'font-size:12px;margin-top:4px' }, T.method === 'similar' ? '순위가 비슷한 학생끼리 같은 팀이 돼요. (★가 많을수록 지난 대회 성적이 좋아요)' : '팀마다 상위·중위·하위 학생이 고르게 섞여 팀 실력이 비슷해져요. (★가 많을수록 지난 대회 성적이 좋아요)')) : null,
    h('div', { class: 'cz-auto' }, h('label', { class: 'row', style: 'gap:6px;font-size:13px;cursor:pointer' }, h('input', { type: 'checkbox', checked: !!T.dup, onchange: (e) => { T.dup = e.target.checked; } }), '중복 넣기: 팀에 있는 학생을 다른 팀으로 옮기면 복사돼요 (두 팀에서 뛰기)'),
      h('span', { class: 'muted', style: 'font-size:12px' }, '이름을 누른 뒤 팀 칸을 누르거나 끌어서 놓으면 옮겨져요. (지정 배정)')),
    drop(h('div', { class: 'cz-pool' }, h('div', { class: 'cz-pool-h' }, h('b', null, '미배정'), h('span', { class: 'muted' }, `${T.pool.length}명`), gc(T.pool)),
      T.pool.length ? h('div', { class: 'cz-chips' }, T.pool.map((n) => chip(n, 'pool'))) : h('span', { class: 'muted', style: 'font-size:13px' }, '모두 팀에 들어갔어요')), 'pool'),
    h('div', { class: 'cz-teams' }, T.teams.map((t, i) => drop(h('div', { class: 'cz-team' + (T.pick != null ? ' target' : '') + (t.members.length !== P ? ' off' : '') },
      h('div', { class: 'cz-team-h' }, h('input', { value: t.name, maxlength: 12, 'aria-label': `${i + 1}번째 팀 이름`, onclick: (e) => e.stopPropagation(), oninput: (e) => { t.name = e.target.value; } }), h('span', { class: 'cz-tcnt' + (t.members.length !== P ? ' bad' : '') }, `${t.members.length}/${P}`), gc(t.members),
        T.ratings && T.method !== 'random' && t.members.length ? h('span', { class: 'cz-tavg' }, '평균 ★' + (t.members.reduce((a, n) => a + (T.ratings.has(n) ? T.ratings.get(n) : 0.5), 0) / t.members.length * 4 + 1).toFixed(1)) : null),
      t.members.length ? h('div', { class: 'cz-chips' }, t.members.map((n) => chip(n, t.id))) : h('em', { class: 'muted' }, '여기에 학생을 넣어요')), t.id))));
}

/* ---------- 대회 만들기 ---------- */
function wizard(onCreate) {
  const d = { name: '', format: 'league', legs: 1, pts: { w: 3, d: 1, l: 0 }, draw: true, tie: 'diff', third: false, seed: 'random', scoring: 'score', useTarget: false, target: 11, sets: 3, courts: 1, unit: 'individual', classes: 4, classNames: [] };
  const people = new Set(roster().map((s) => s.num));
  const T = { teams: [1, 2, 3, 4].map((n) => ({ id: uid(), name: `${n}팀`, members: [] })), pool: roster().map((s) => s.num), gmode: 'equal', pick: null };
  let step = 0;
  const STEPS = ['대회 방식', '참가 단위', '경기 규칙', '참가자'];
  const body = h('div'), foot = h('div', { class: 'cz-foot-in' });
  const dl = dialog('대회 만들기', body, foot, 'wide');
  const entrants = () => {
    if (d.unit === 'individual') return roster().filter((s) => people.has(s.num)).map((s) => ({ id: 'e' + s.num, name: s.name, sub: s.num + '번', members: [s.num] }));
    if (d.unit === 'class') return Array.from({ length: d.classes }, (_, i) => ({ id: 'c' + i, name: (d.classNames[i] || '').trim() || `${i + 1}반`, members: [] }));
    return T.teams.map((t) => ({ id: t.id, name: (t.name || '').trim() || '이름 없는 팀', members: t.members.slice() }));
  };
  const rd = () => {
    const isL = d.format === 'league';
    const big = (key, val, title, desc) => h('button', { type: 'button', class: 'cz-opt' + (d[key] === val ? ' on' : ''), onclick: () => { d[key] = val; rd(); } }, h('b', null, title), h('span', null, desc));
    const steps = h('div', { class: 'cz-steps' }, STEPS.map((n, i) => h('span', { class: 'cz-stp' + (i === step ? ' on' : i < step ? ' done' : '') }, h('i', null, i + 1), n)));
    let content;
    if (step === 0) {
      const nm = h('input', { value: d.name, placeholder: '예: 5학년 피구 리그', maxlength: 30, oninput: (e) => { d.name = e.target.value; nextBtn.disabled = !d.name.trim(); } });
      setTimeout(() => nm.focus(), 0);
      content = h('div', null, h('div', { class: 'field' }, h('label', null, '대회 이름 (종목)'), nm),
        h('div', { class: 'cz-opts' }, big('format', 'league', '리그', '모든 참가자가 서로 겨루고 승점으로 순위를 정해요'), big('format', 'tournament', '토너먼트', '지면 탈락, 이기면 다음 경기로 올라가요')));
    } else if (step === 1) {
      content = h('div', null, h('div', { class: 'cz-opts three' }, big('unit', 'individual', '개인', '학생 한 명 한 명이 참가해요'), big('unit', 'team', '팀', '학생들을 모아 팀을 만들어요'), big('unit', 'class', '반대항', '반끼리 겨뤄요')),
        d.unit === 'class' ? setRow('반 숫자', '', stepper(d.classes, 2, 30, (v) => { d.classes = v; rd(); })) : null,
        d.unit !== 'class' && roster().length < 2 ? h('div', { class: 'banner warn' }, '명렬표가 비어 있어요. 학급 기초설정에서 먼저 입력해 주세요.') : null);
    } else if (step === 2) content = h('div', null, rulesBody(d, rd, isL, {}));
    else {
      if (d.unit === 'individual') content = h('div', null, h('div', { class: 'cz-pool-h' }, h('b', null, '참가 학생'), h('span', { class: 'muted' }, `${people.size}명 · 누르면 빠지거나 들어가요`),
        h('button', { class: 'sm', type: 'button', onclick: () => { roster().forEach((s) => people.add(s.num)); rd(); } }, '모두'), h('button', { class: 'sm', type: 'button', onclick: () => { people.clear(); rd(); } }, '없음')),
        h('div', { class: 'cz-chips grid' }, roster().map((s) => h('button', { type: 'button', class: 'cz-chip ' + gcls(s.gender) + (people.has(s.num) ? '' : ' off'), onclick: () => { people.has(s.num) ? people.delete(s.num) : people.add(s.num); rd(); } }, h('small', null, s.num), s.name))));
      else if (d.unit === 'team') content = teamBoard(T, rd, false);
      else { for (let i = 0; i < d.classes; i++) if (!d.classNames[i]) d.classNames[i] = `${i + 1}반`;
        content = h('div', null, h('div', { class: 'muted', style: 'margin-bottom:6px' }, '필요하면 반 이름을 바꿔요. (예: 4-1)'), h('div', { class: 'cz-names' }, d.classNames.slice(0, d.classes).map((n, i) => h('input', { value: n, maxlength: 12, oninput: (e) => { d.classNames[i] = e.target.value; } })))); }
      const es = entrants(), n = es.length, P = n >= 2 ? seedsFor(n).length : 0;
      const games = isL ? (n * (n - 1) / 2) * d.legs : Math.max(0, n - 1) + (d.third && n >= 4 ? 1 : 0);
      const emptyT = d.unit === 'team' && T.teams.some((t) => !t.members.length);
      content.append(h('p', { class: 'cz-note' }, n < 2 ? '참가자를 둘 이상 골라 주세요.' : emptyT ? '빈 팀이 있어요. 학생을 넣거나 팀 수를 줄여 주세요.' : `참가 ${n}${d.unit === 'class' ? '반' : d.unit === 'team' ? '팀' : '명'} · 모두 ${games}경기${!isL && P > n ? ` · 부전승 ${P - n}` : ''}`));
    }
    body.replaceChildren(steps, h('div', { class: 'cz-wbody' }, content));
    const ok = [!!d.name.trim(), true, true, (() => { const es = entrants(); return es.length >= 2 && !(d.unit === 'team' && T.teams.some((t) => !t.members.length)); })()][step];
    var nextBtn = h('button', { class: 'primary', disabled: !ok, onclick: () => { if (step < 3) { step++; rd(); } else create(); } }, step < 3 ? '다음' : '대회 만들기');
    foot.replaceChildren(h('div', null, step > 0 ? h('button', { onclick: () => { step--; rd(); } }, '이전') : null), h('div', { class: 'row', style: 'gap:6px' }, h('button', { onclick: dl.close }, '취소'), nextBtn));
  };
  const create = () => {
    let es = entrants(); const isL = d.format === 'league';
    if (!isL && d.seed === 'random') es = shuffle(es);
    es = es.map((e, i) => ({ ...e, id: 'e' + i }));
    const c = { id: uid(), name: d.name.trim(), format: d.format, unit: d.unit, created: Date.now(), legs: d.legs, pts: { ...d.pts }, draw: isL && d.draw, tie: d.scoring === 'wdl' ? 'h2h' : d.tie, third: d.third,
      scoring: d.scoring, target: d.scoring === 'score' && d.useTarget ? d.target : null, sets: d.sets, courts: d.courts, entrants: es, res: {}, out: {}, big: {}, live: {} };
    const ids = es.map((_, i) => i);
    if (isL) c.matches = leagueMatches(ids.length, d.legs); else c.slots = makeSlots(ids);
    dl.close(); onCreate(c);
  };
  rd();
}

/* ---------- 설정 고치기 ---------- */
function editDialog(c, onSave) {
  const played = Object.keys(c.res).length > 0, isL = c.format === 'league', hasDraw = Object.values(c.res).some((r) => r && r.w === 'd');
  const d = { name: c.name, legs: c.legs, pts: { ...c.pts }, draw: !!c.draw, tie: c.tie, third: !!c.third, scoring: c.scoring, useTarget: !!c.target, target: c.target || 11, sets: c.sets || 3, courts: c.courts };
  const body = h('div'); const foot = h('div', { class: 'cz-foot-in' });
  const dl = dialog('대회 설정', body, foot);
  const rd = () => {
    body.replaceChildren(h('p', { class: 'muted', style: 'margin:0 0 10px' }, played ? '경기 기록이 있어서 일부 항목은 바꿀 수 없어요. 승점 같은 규칙은 바꾸면 지금까지의 기록에도 바로 적용돼요.' : '아직 기록이 없어서 모든 규칙을 바꿀 수 있어요.'),
      h('div', { class: 'field' }, h('label', null, '대회 이름'), h('input', { value: d.name, maxlength: 30, oninput: (e) => { d.name = e.target.value; } })),
      ...rulesBody(d, rd, isL, { edit: true, legs: played, scoring: played, noDraw: hasDraw }));
    foot.replaceChildren(h('div'), h('div', { class: 'row', style: 'gap:6px' }, h('button', { onclick: dl.close }, '취소'), h('button', { class: 'primary', onclick: () => {
      if (!d.name.trim()) return toast('대회 이름을 넣어 주세요', true);
      c.name = d.name.trim(); c.pts = d.pts; c.courts = d.courts; c.tie = (played ? c.scoring : d.scoring) === 'wdl' ? 'h2h' : d.tie;
      if (isL) c.draw = d.draw; else c.third = d.third;
      c.target = (played ? c.scoring : d.scoring) === 'score' && d.useTarget ? d.target : null;
      if (!played) { c.scoring = d.scoring; c.sets = d.sets; if (isL && d.legs !== c.legs) { c.legs = d.legs; c.matches = leagueMatches(c.entrants.length, d.legs); c.live = {}; } }
      dl.close(); onSave();
    } }, '저장')));
  };
  rd();
}

/* ---------- 경기 결과 적기 ---------- */
function resultDialog(c, m, nm, onSave, onDelete) {
  const r = m.res, needWinner = c.format !== 'league' || !c.draw;
  let sa = r && r.sa != null ? r.sa : 0, sb = r && r.sb != null ? r.sb : 0;
  const max = c.scoring === 'sets' ? Math.ceil(c.sets / 2) : 999, goal = c.scoring === 'sets' ? max : c.target || 0;
  const body = h('div'), foot = h('div', { class: 'cz-foot-in' });
  const title = m.name || `${m.r + 1}라운드`;
  const dl = dialog(title, body, foot, 'mid');
  const done = (res) => { dl.close(); onSave(res); };
  const rd = () => {
    const head = h('div', { class: 'row', style: 'gap:6px;margin-bottom:6px;justify-content:flex-start' }, m.no ? h('span', { class: 'cz-badge' }, `${m.no}경기`) : null, c.courts > 1 && m.court ? h('span', { class: 'cz-badge' }, `${m.court}경기장`) : null);
    if (c.scoring === 'wdl') {
      body.replaceChildren(head, h('div', { class: 'cz-wdl' },
        h('button', { type: 'button', class: 'cz-opt' + (r && r.w === 'a' ? ' on' : ''), onclick: () => done({ sa: null, sb: null, w: 'a' }) }, h('b', null, nm(m.a)), h('span', null, '승리')),
        needWinner ? null : h('button', { type: 'button', class: 'cz-opt' + (r && r.w === 'd' ? ' on' : ''), onclick: () => done({ sa: null, sb: null, w: 'd' }) }, h('b', null, '무승부'), h('span', null, ' ')),
        h('button', { type: 'button', class: 'cz-opt' + (r && r.w === 'b' ? ' on' : ''), onclick: () => done({ sa: null, sb: null, w: 'b' }) }, h('b', null, nm(m.b)), h('span', null, '승리'))));
    } else {
      const side = (k) => {
        const v = k === 'a' ? sa : sb, o = k === 'a' ? sb : sa, set = (x) => { if (k === 'a') sa = x; else sb = x; rd(); };
        return h('div', { class: 'cz-rside' }, goal ? h('button', { type: 'button', class: 'cz-winbtn' + (v === goal && o < goal ? ' on' : ''), onclick: () => { if (k === 'a') { sa = goal; if (sb >= goal) sb = goal - 1; } else { sb = goal; if (sa >= goal) sa = goal - 1; } rd(); } }, `${nm(m[k])} 승리`) : h('b', { class: 'cz-rnm' }, nm(m[k])),
          stepper(v, 0, max, set, 'big'));
      };
      body.replaceChildren(...[head, h('div', { class: 'cz-rgrid' }, side('a'), h('span', { class: 'cz-colon' }, ':'), side('b')),
        h('p', { class: 'muted', style: 'text-align:center;margin:10px 0 0;font-size:13px' }, c.scoring === 'sets' ? `${c.sets}세트 경기 · ${max}세트 먼저` : c.target ? `목표 ${c.target}점 · '승리' 버튼을 누르면 이긴 쪽에 목표 점수가 들어가요` : ' '),
        sa === sb && needWinner ? h('p', { class: 'muted', style: 'text-align:center;color:var(--danger);margin:4px 0 0;font-size:13px' }, '비기면 저장할 수 없어요. 이긴 쪽 점수를 더 높게 적어 주세요.') : null].filter(Boolean));
    }
    foot.replaceChildren(h('div', { class: 'row', style: 'gap:6px' }, r ? h('button', { class: 'danger', onclick: () => done(null) }, '기록 지우기') : null,
      onDelete ? h('button', { class: 'ghost', title: '이 경기를 일정에서 아예 빼요', onclick: () => { if (!confirm('이 경기를 일정에서 삭제할까요? 기록도 함께 지워져요.')) return; dl.close(); onDelete(); } }, '경기 삭제') : null),
      h('div', { class: 'row', style: 'gap:6px' }, h('button', { onclick: dl.close }, '취소'), c.scoring === 'wdl' ? null : h('button', { class: 'primary', disabled: sa === sb && needWinner, onclick: () => done({ sa, sb, w: sa > sb ? 'a' : sb > sa ? 'b' : 'd' }) }, '저장')));
  };
  rd();
}
/* 리그 경기 하나를 일정에서 빼기 (기록 번호를 다시 맞춤) */
function deleteMatch(c, key) {
  const idx = Number(String(key).slice(1)); if (!(idx >= 0) || !c.matches[idx]) return;
  const res = {}, live = {};
  c.matches.forEach((m, j) => { if (j === idx) return; const nk = 'm' + (j < idx ? j : j - 1); if (c.res['m' + j]) res[nk] = c.res['m' + j]; if (c.live['m' + j]) live[nk] = true; });
  c.matches.splice(idx, 1); c.res = res; c.live = live;
}
/* 결과 적용 (토너먼트는 이 경기에 달린 다음 라운드 기록 정리) */
function applyRes(c, m, res) {
  const old = c.res[m.key];
  if (res) c.res[m.key] = res; else delete c.res[m.key];
  if (c.format !== 'league' && m.key !== 'third' && (!res || !old || old.w !== res.w)) {
    const R = Math.round(Math.log2(c.slots.length));
    for (let rr = m.r + 1; rr < R; rr++) delete c.res[`t${rr}-${m.i >> (rr - m.r)}`];
    delete c.res.third;
  }
  delete c.live[m.key];
}

/* ---------- 대회 한 개 ---------- */
function compView(c, redraw) {
  const isL = c.format === 'league', out = c.out, big = c.big, live = c.live;
  const nm = (i) => (i != null && c.entrants[i] ? c.entrants[i].name : '미정');
  const list = allGames(c), shown = C.pend ? list.filter((x) => !x.res) : list;
  const total = list.length, played = list.filter((x) => x.res).length, pct = total ? Math.round(played / total * 100) : 0;
  const br = isL ? null : bracket(c), champ = br && br.final.w != null ? nm(br.final.w) : null;
  const upd = () => { save(c); redraw(); };
  const open = (x) => { if (x.a != null && x.b != null && !x.bye) resultDialog(c, x, nm, (res) => { applyRes(c, x, res); upd(); }, isL ? () => { deleteMatch(c, x.key); upd(); toast('경기를 삭제했어요'); } : null); };
  const toggle = (kind, i) => {
    if (c[kind][i]) delete c[kind][i]; else c[kind][i] = true;
    if (kind === 'big' && !isL && !Object.keys(c.res).length) c.slots = makeSlots(arrangeIds(seedOrder(c.slots), c.big));
    upd();
  };
  // 참가자 메뉴 (불참 · 빅매치 · 팀 수정)
  const menu = (e, i) => {
    e.stopPropagation(); document.querySelectorAll('.cz-pop').forEach((p) => p.remove());
    const pop = h('div', { class: 'cz-pop', style: `left:${Math.min(e.clientX, innerWidth - 220)}px;top:${e.clientY + 6}px` }, h('b', null, nm(i)),
      h('div', { class: 'cz-pop-btns' },
        h('button', { type: 'button', class: 'cz-flag out' + (out[i] ? ' on' : ''), onclick: () => { pop.remove(); toggle('out', i); } }, '🚫 불참'),
        h('button', { type: 'button', class: 'cz-flag big' + (big[i] ? ' on' : ''), onclick: () => { pop.remove(); toggle('big', i); } }, '🔥 빅매치'),
        c.unit === 'team' ? h('button', { type: 'button', class: 'cz-flag', onclick: () => { pop.remove(); teamEdit(c, upd); } }, '✏️ 팀 수정') : null));
    document.body.append(pop);
    setTimeout(() => document.addEventListener('pointerdown', function f(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('pointerdown', f); } }), 0);
  };
  const shuffleIt = () => {
    if (isL) { const perm = shuffle(c.entrants.map((_, i) => i)); c.matches = leagueMatches(c.entrants.length, c.legs).map((m) => ({ ...m, a: perm[m.a], b: perm[m.b] })); }
    else c.slots = makeSlots(arrangeIds(shuffle(c.entrants.map((_, i) => i)), big));
    upd(); toast('대진을 다시 짰어요'); };

  // 머리 카드
  const head = h('section', { class: 'card cz-det' },
    h('div', { class: 'cz-dtop' },
      h('div', { class: 'cz-dnm' }, h('h3', null, c.name), h('span', { class: 'muted' }, `${played} / ${total}경기`)),
      h('div', { class: 'cz-meta' },
        h('span', { class: 'cz-badge' }, isL ? (c.legs === 2 ? '리그 · 두 번씩' : '리그') : '토너먼트'), h('span', { class: 'cz-badge' }, UNIT[c.unit]),
        h('span', { class: 'cz-badge' }, SCORING.find((x) => x[0] === c.scoring)[1] + (c.target ? ` · ${c.target}점` : c.scoring === 'sets' ? ` · ${c.sets}세트` : '')),
        isL ? h('span', { class: 'cz-badge' }, `승점 ${c.pts.w}${c.draw ? '·' + c.pts.d : ''}·${c.pts.l}`) : null, h('span', { class: 'cz-badge' }, `경기장 ${c.courts}`),
        h('button', { class: 'sm primary', title: '비밀번호를 넣으면 경기 기록만 할 수 있는 화면이 열려요', onclick: () => recEnter(c.id, redraw) }, '📝 기록 모드'),
        !isL ? h('button', { class: 'sm', title: '대진표 모양 바꾸기', onclick: () => { C.bmode = C.bmode === 'h' ? 'v' : 'h'; saveView(); redraw(); } }, C.bmode === 'h' ? '⇄ 가로' : '⇅ 세로') : null,
        !played ? h('button', { class: 'sm', title: isL ? '경기 순서를 무작위로 다시 짜요' : '대진을 무작위로 다시 짜요', onclick: shuffleIt }, '🔀 대진표 섞기') : null,
        h('button', { class: 'sm', onclick: () => editDialog(c, upd) }, '⚙ 설정'),
        h('button', { class: 'sm', disabled: !played, onclick: () => { if (!confirm('경기 기록을 모두 지울까요? 대진과 참가자는 그대로 두고 결과만 지워요.')) return; c.res = {}; c.live = {}; upd(); } }, '기록 초기화'),
        h('button', { class: 'sm', title: '보관함으로 보내기', onclick: () => { if (!confirm(`'${c.name}' 대회를 보관함으로 보낼까요? 기록은 그대로 남고, 보관함에서 다시 꺼내거나 삭제할 수 있어요.`)) return; c.archived = true; C.cur = null; saveNow(c).then(redraw); } }, '🗄 보관'))),
    h('div', { class: 'cz-prog' }, bar(pct), h('b', { class: 'cz-pct' }, pct + '%'), champ ? h('span', { class: 'cz-champ' }, `🏆 우승 ${champ}`) : null));

  // 참가자 카드
  const ent = isL && c.unit === 'individual' ? null : h('section', { class: 'card' }, h('div', { class: 'cz-ch' }, h('b', null, '참가자'), h('span', { class: 'muted' }, c.entrants.length)),
    h('div', { class: 'cz-ents' + (c.unit === 'team' ? ' team' : '') }, c.entrants.map((e, i) => h('button', { type: 'button', class: 'cz-ent' + (out[i] ? ' out' : '') + (big[i] ? ' big' : ''), onclick: (ev) => menu(ev, i) },
      big[i] ? h('span', { class: 'fire' }, '🔥') : null, e.sub ? h('small', null, e.sub) : null, h('b', null, e.name),
      c.unit === 'team' && e.members.length ? h('span', { class: 'cz-mems' }, e.members.map(stu).filter(Boolean).map((s) => h('i', { class: gcls(s.gender) }, s.name))) : null))),
    h('p', { class: 'muted', style: 'font-size:12px;margin:8px 0 0' }, '이름을 누르면 오늘 불참이나 빅매치를 정할 수 있어요.'));

  // 경기 한 줄
  const mrow = (x, cvm) => {
    const lv = live[x.key] && !x.res, ho = !x.res && (out[x.a] || out[x.b]);
    const pill = h('span', { class: 'cz-live' + (lv ? ' on' : ''), title: '지금 경기 중이면 눌러서 표시해요', onclick: (e) => { e.stopPropagation(); if (live[x.key]) delete live[x.key]; else live[x.key] = true; upd(); } }, `${x.no}경기`);
    const side = (k) => h('b', { class: 'cz-m' + k + (x.res && x.res.w === k ? ' win' : '') + (out[x[k]] ? ' out' : '') }, nm(x[k]));
    return h('div', { class: 'cz-mrow' + (x.res ? ' done' : '') + (cvm ? ' cv' : '') + (x.bigm ? ' bigm' : '') + (lv ? ' live' : '') + (ho ? ' hasout' : ''), onclick: () => open(x) },
      cvm ? h('span', { class: 'cz-mtop' }, pill, x.bigm ? h('span', { class: 'cz-bigtag' }, '🔥 빅매치') : null)
        : h('span', { class: 'cz-mmeta' }, pill, x.bigm ? h('span', { class: 'cz-bigtag' }, '🔥 빅매치') : h('span', { class: 'cz-badge' }, `${x.r + 1}R`), c.courts > 1 ? h('span', { class: 'cz-badge' }, `${x.court}경기장`) : null),
      side('a'), h('span', { class: 'cz-msc' + (x.res ? '' : ' vs') }, scText(c, x.res)), side('b'));
  };

  let main;
  if (isL) {
    const rows = standings(c), showFA = c.scoring !== 'wdl';
    const rankCard = h('section', { class: 'card' }, h('div', { class: 'cz-ch' }, h('b', null, '순위표')),
      h('div', { class: 'cz-scroll' }, h('table', { class: 'cz-rank' },
        h('thead', null, h('tr', null, ['순위', '참가자', '경기', '승', ...(c.draw ? ['무'] : []), '패', ...(showFA ? ['득', '실', '차'] : []), '승점'].map((t, k) => h('th', { class: k === 1 ? 'l' : '' }, t)))),
        h('tbody', null, rows.map((r) => h('tr', { class: r.rank === 1 && r.p > 0 ? 'top' : '' }, h('td', null, r.rank),
          h('td', { class: 'l' }, h('button', { type: 'button', class: 'cz-rk' + (out[r.i] ? ' out' : ''), onclick: (e) => menu(e, r.i) }, nm(r.i), big[r.i] ? ' 🔥' : '')),
          h('td', null, r.p), h('td', null, r.w), c.draw ? h('td', null, r.d) : null, h('td', null, r.l), ...(showFA ? [h('td', null, r.f), h('td', null, r.a), h('td', null, (r.diff > 0 ? '+' : '') + r.diff)] : []), h('td', { class: 'pts' }, r.pts)))))),
      h('p', { class: 'muted', style: 'font-size:12px;margin:10px 0 0;line-height:1.6' }, `승점이 같으면 ${c.scoring === 'wdl' ? '승자승 → 승수' : c.tie === 'h2h' ? '승자승 → 득실차 → 다득점' : '득실차 → 다득점 → 승자승'} 순이에요.`, h('br'), '이름을 누르면 오늘 불참이나 빅매치를 정할 수 있어요.'));
    const sched = h('section', { class: 'card' }, h('div', { class: 'cz-ch' }, h('b', null, '경기 일정'),
      h('div', { class: 'cz-btns' }, seg(C.pend ? 'p' : 'a', [['a', '모든 경기'], ['p', '예정 경기']], (v) => { C.pend = v === 'p'; saveView(); redraw(); }),
        c.courts > 1 ? seg(C.cv ? 'c' : 'a', [['a', '한 줄 보기'], ['c', '경기장 보기']], (v) => { C.cv = v === 'c'; saveView(); redraw(); }) : null)),
      !shown.length ? h('div', { class: 'muted', style: 'padding:16px;text-align:center' }, '남은 경기가 없어요.')
        : C.cv && c.courts > 1 ? h('div', { class: 'cz-courts', style: `--cn:${c.courts}` }, Array.from({ length: c.courts }, (_, i) => h('div', { class: 'cz-court' }, h('b', { class: 'cz-court-h' }, `${i + 1}경기장`), shown.filter((x) => x.court === i + 1).map((x) => mrow(x, true)))))
          : h('div', { class: 'cz-mlist' }, shown.map((x) => mrow(x, false))));
    main = h('div', { class: 'cz-cols' }, rankCard, sched);
  } else {
    const bcard = h('section', { class: 'card' }, h('div', { class: 'cz-ch' }, h('b', null, '대진표')), h('div', { class: 'cz-scroll' }, bracketEl(c, br, nm, open)),
      br.third ? h('div', { class: 'cz-third' }, h('span', { class: 'cz-bname' }, '3·4위전'), bmBox(c, br.third, nm, open)) : null);
    main = bcard;
  }
  return h('div', { class: 'cz-view' }, head, ent, main);
}
/* 토너먼트 경기 상자 */
function bmBox(c, x, nm, open) {
  const out = c.out, big = c.big, r = x.res;
  const line = (id, w, s) => h('div', { class: 'cz-bl' + (w ? ' win' : '') + (id == null ? ' tbd' : '') + (id != null && out[id] ? ' out' : '') }, h('span', null, id != null ? nm(id) : x.bye ? '부전승' : '미정', id != null && big[id] ? ' 🔥' : ''), s != null && s !== '' ? h('b', null, s) : null);
  const sv = (k) => (!r ? null : c.scoring === 'wdl' ? (r.w === k ? '승' : '') : k === 'a' ? r.sa : r.sb);
  return h('button', { type: 'button', class: 'cz-bm' + (x.bye ? ' bye' : '') + (x.a != null && x.b != null && !x.bye ? ' play' : '') + (r ? ' done' : ''), 'data-key': x.key, onclick: () => open(x) },
    x.no ? h('small', null, (x.rn ? (x.name === '결승' ? '결승' : `${x.name} ${x.rn}경기`) : `${x.no}경기`) + (c.courts > 1 && x.court ? ` · ${x.court}경기장` : '')) : null,
    line(x.a, r ? r.w === 'a' : x.bye && x.a != null, sv('a')), line(x.b, r ? r.w === 'b' : x.bye && x.b != null, sv('b')));
}
/* 대진표: 상자를 놓고 선은 SVG로 이어요 (이긴 쪽 선은 색) */
function bracketEl(c, br, nm, open) {
  const vert = C.bmode === 'v';
  const wrap = h('div', { class: 'cz-br ' + (vert ? 'v' : 'h') });
  const cols = br.rounds.map((ms, r) => h('div', { class: 'cz-bcol' }, h('span', { class: 'cz-bname' }, ms[0].name), h('div', { class: 'cz-bms' }, ms.map((x) => h('div', { class: 'cz-bcell' }, bmBox(c, x, nm, open), r === br.rounds.length - 1 && x.w != null ? h('span', { class: 'cz-champtag' }, `우승 · ${nm(x.w)}`) : null)))));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'cz-blines');
  wrap.append(svg, ...cols);
  const draw = () => {
    if (!wrap.isConnected) return;
    const W = wrap.scrollWidth, H = wrap.scrollHeight, o = wrap.getBoundingClientRect();
    svg.setAttribute('width', W); svg.setAttribute('height', H); svg.replaceChildren();
    const box = (k) => { const el = wrap.querySelector(`.cz-bm[data-key="${k}"]`); if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left - o.left + wrap.scrollLeft, t: b.top - o.top + wrap.scrollTop, w: b.width, h: b.height }; };
    for (let r = 1; r < br.rounds.length; r++) br.rounds[r].forEach((m) => {
      const to = box(m.key); if (!to) return;
      [0, 1].forEach((s) => {
        const src = br.rounds[r - 1][m.i * 2 + s], f = box(src.key); if (!f) return;
        const win = src.w != null && !!src.res;
        let d;
        if (vert) { const x1 = f.l + f.w / 2, y1 = f.t + f.h, x2 = to.l + to.w / 2, y2 = to.t, my = (y1 + y2) / 2; d = `M${x1},${y1} V${my} H${x2} V${y2}`; }
        else { const x1 = f.l + f.w, y1 = f.t + f.h / 2, x2 = to.l, y2 = to.t + to.h / 2, mx = (x1 + x2) / 2; d = `M${x1},${y1} H${mx} V${y2} H${x2}`; }
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); p.setAttribute('class', win ? 'win' : '');
        svg.append(p);
      });
    });
  };
  requestAnimationFrame(() => requestAnimationFrame(draw));
  window.addEventListener('resize', function f() { if (!wrap.isConnected) return window.removeEventListener('resize', f); draw(); });
  return wrap;
}
/* 팀 수정 */
function teamEdit(c, onDone) {
  const T = { teams: c.entrants.map((e) => ({ id: e.id, name: e.name, members: (e.members || []).slice() })), pool: [], gmode: 'equal', pick: null };
  const body = h('div'), foot = h('div', { class: 'cz-foot-in' });
  const dl = dialog('팀 수정', body, foot, 'wide');
  const rd = () => {
    body.replaceChildren(teamBoard(T, rd, true), h('p', { class: 'cz-note' }, '팀 수는 대진이 이미 만들어져 있어서 바꿀 수 없어요. 경기 기록은 그대로예요.' + (T.pool.length ? ` 미배정 ${T.pool.length}명은 대회에서 빠져요.` : '')));
    foot.replaceChildren(h('div'), h('div', { class: 'row', style: 'gap:6px' }, h('button', { onclick: dl.close }, '취소'), h('button', { class: 'primary', onclick: () => {
      c.entrants = c.entrants.map((e) => { const t = T.teams.find((y) => y.id === e.id); return t ? { ...e, name: (t.name || '').trim() || e.name, members: t.members } : e; });
      dl.close(); onDone();
    } }, '저장')));
  };
  rd();
}
/* 보관함 */
function archiveBox(redraw) {
  const body = h('div'), foot = h('div', { class: 'cz-foot-in' });
  const dl = dialog('대회 보관함', body, foot, 'mid');
  const rd = () => {
    const kept = C.index.list.filter((x) => x.archived);
    body.replaceChildren(h('p', { class: 'muted', style: 'margin:0 0 10px' }, '보관한 대회는 목록에 나오지 않아요. 삭제는 여기에서만 할 수 있어요.'),
      kept.length ? h('div', { class: 'cz-arch' }, kept.map((x) => h('div', { class: 'cz-arow' },
        h('div', { style: 'flex:1;min-width:0' }, h('b', null, x.name), h('span', { class: 'muted', style: 'font-size:13px' }, ` ${x.format === 'league' ? '리그' : '토너먼트'} · ${UNIT[x.unit] || ''} · ${x.total ? Math.round(x.done / x.total * 100) : 0}%`)),
        h('button', { class: 'sm', onclick: async () => { const c = await getContest(x.id); x.archived = false; if (c) { delete c.archived; await saveNow(c); } else saveIndex(); C.cur = x.id; rd(); redraw(); } }, '꺼내기'),
        h('button', { class: 'sm ghost', onclick: async () => {
          if (!confirm(`'${x.name}' 대회를 삭제할까요? 경기 기록도 함께 삭제되고 되돌릴 수 없어요.`)) return;
          C.index.list = C.index.list.filter((q) => q !== x); delete C.cache[x.id];
          try { await APP.kvDel(keyOf(x.id)); await APP.kvSet('contest:index', C.index); } catch (e) { toast(errMsg(e), true); }
          rd(); redraw();
        } }, '삭제')))) : h('p', { class: 'muted' }, '보관한 대회가 없어요.'));
    foot.replaceChildren(h('div'), h('button', { class: 'primary', onclick: dl.close }, '닫기'));
  };
  rd();
}

/* ---------- 기록 모드: 비밀번호로 들어가고 나감. 경기 일정만 보이고 기록만 할 수 있음 ---------- */
const REC_KEY = 'contest_rec', RW = [560, 720, 900, 1100, 1300, 0];
function pwAsk(title, desc) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'password', placeholder: '비밀번호', autocomplete: 'off' }), err = h('div', { class: 'err' });
    const done = (v) => { ov.remove(); resolve(v); };
    const go = async () => {
      btn.disabled = true; err.textContent = '';
      try { await APP.api('unlock', { pw: input.value }); done(true); } catch (e) { err.textContent = errMsg(e); btn.disabled = false; input.select(); }
    };
    const btn = h('button', { class: 'primary', onclick: go }, '확인');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') done(false); });
    const ov = h('div', { class: 'overlay', style: 'z-index:120' }, h('div', { class: 'modal' }, h('h3', null, title), h('div', { class: 'muted' }, desc), input, err, h('div', { class: 'row' }, h('button', { onclick: () => done(false) }, '취소'), btn)));
    document.body.append(ov); input.focus();
  });
}
async function recEnter(id, redraw) {
  if (!(await pwAsk('기록 모드로 들어가기', '선생님 비밀번호를 넣어 주세요. 기록 모드에서는 경기 결과만 적을 수 있어요.'))) return;
  try { localStorage.setItem(REC_KEY, id); } catch (e) { /* 저장 안 됨 */ }
  recOpen(id, redraw);
}
async function recOpen(id, redraw) {
  document.querySelectorAll('.rec-layer').forEach((x) => x.remove());
  if (!C.index) await loadIndex();
  const c = await getContest(id); if (!c) { try { localStorage.removeItem(REC_KEY); } catch (e) { /* 없음 */ } return; }
  const layer = h('div', { class: 'rec-layer' }); document.body.append(layer); document.body.classList.add('rec-on');
  let wi = 2; try { wi = Math.max(0, Math.min(RW.length - 1, Number(localStorage.getItem('rec_w') ?? 2))); } catch (e) { /* 기본 */ }
  const nm = (i) => (i != null && c.entrants[i] ? c.entrants[i].name : '미정');
  const draw = () => {
    const isL = c.format === 'league', list = allGames(c), p = progress(c);
    const ready = list.filter((x) => !x.res && x.a != null && x.b != null && !x.bye);
    const wait = list.filter((x) => !x.res && (x.a == null || x.b == null));
    const done = list.filter((x) => x.res);
    const open = (x) => { if (x.a == null || x.b == null) return; resultDialog(c, x, nm, (res) => { applyRes(c, x, res); save(c); draw(); }); };
    const row = (x, k, kind) => {
      const lv = c.live[x.key] && !x.res;
      return h('div', { class: 'rec-row ' + kind + (lv ? ' live' : '') + (k === 0 && kind === 'ready' ? ' next' : ''), onclick: () => open(x) },
        h('div', { class: 'rec-meta' }, k === 0 && kind === 'ready' ? h('span', { class: 'rec-next' }, '다음 경기') : null,
          h('span', { class: 'cz-live' + (lv ? ' on' : ''), onclick: (e) => { e.stopPropagation(); if (kind !== 'ready') return; if (c.live[x.key]) delete c.live[x.key]; else c.live[x.key] = true; save(c); draw(); } }, lv ? '경기 중' : `${x.no}경기`),
          h('span', { class: 'cz-badge' }, isL ? `${x.r + 1}R` : x.name), c.courts > 1 && x.court ? h('span', { class: 'cz-badge' }, `${x.court}경기장`) : null),
        h('b', { class: 'rec-a' + (x.res && x.res.w === 'a' ? ' win' : '') + (c.out[x.a] ? ' out' : '') }, nm(x.a)),
        h('span', { class: 'rec-sc' + (x.res ? '' : ' vs') }, scText(c, x.res)),
        h('b', { class: 'rec-b' + (x.res && x.res.w === 'b' ? ' win' : '') + (c.out[x.b] ? ' out' : '') }, nm(x.b)));
    };
    const W = RW[wi];
    layer.replaceChildren(h('div', { class: 'rec-in', style: W ? `max-width:${W}px` : 'max-width:none' },
      h('div', { class: 'rec-head' },
        h('div', { class: 'rec-title' }, h('span', { class: 'cz-badge' }, '📝 기록 모드'), h('b', null, c.name), h('span', { class: 'muted' }, `${p.done} / ${p.total}경기`)),
        h('div', { class: 'rec-tools' },
          h('span', { class: 'muted', style: 'font-size:12px' }, '화면 너비'),
          h('button', { class: 'sm', disabled: wi === 0, onclick: () => { wi--; try { localStorage.setItem('rec_w', wi); } catch (e) { /* 저장 안 됨 */ } draw(); } }, '◀ 좁게'),
          h('button', { class: 'sm', disabled: wi === RW.length - 1, onclick: () => { wi++; try { localStorage.setItem('rec_w', wi); } catch (e) { /* 저장 안 됨 */ } draw(); } }, '넓게 ▶'),
          h('button', { class: 'sm danger', onclick: async () => {
            if (!(await pwAsk('기록 모드 나가기', '나가려면 선생님 비밀번호를 넣어 주세요.'))) return;
            try { localStorage.removeItem(REC_KEY); } catch (e) { /* 없음 */ }
            layer.remove(); document.body.classList.remove('rec-on'); if (redraw) redraw(); else if (APP.renderPage) APP.renderPage();
          } }, '나가기 🔒'))),
      h('div', { class: 'rec-prog' }, bar(p.pct), h('b', null, p.pct + '%')),
      ready.length ? [h('div', { class: 'rec-h' }, `다가올 경기 ${ready.length}`), h('div', { class: 'rec-list' }, ready.map((x, k) => row(x, k, 'ready')))] : h('div', { class: 'rec-empty' }, p.total && p.done === p.total ? '🏁 모든 경기가 끝났어요!' : '지금 할 수 있는 경기가 없어요.'),
      wait.length ? [h('div', { class: 'rec-h' }, `대기 (앞 경기 결과를 기다려요) ${wait.length}`), h('div', { class: 'rec-list' }, wait.map((x, k) => row(x, k, 'wait')))] : null,
      done.length ? [h('div', { class: 'rec-h' }, `끝난 경기 ${done.length}`), h('div', { class: 'rec-list' }, done.slice().reverse().map((x, k) => row(x, k, 'done')))] : null,
      h('p', { class: 'muted', style: 'font-size:12px;text-align:center;margin:16px 0' }, '경기를 누르면 결과를 적을 수 있어요. 끝난 경기는 아래로 내려가요. "N경기"를 누르면 경기 중 표시가 켜져요.')));
  };
  draw();
}
/* 새로고침해도 기록 모드가 풀리지 않게 */
APP.contestRecResume = () => { let id = null; try { id = localStorage.getItem(REC_KEY); } catch (e) { /* 없음 */ } if (id) recOpen(id, null).catch(() => {}); };

/* ---------- 페이지 ---------- */
APP.pages.contest = () => {
  const wrap = h('div', { class: 'cz-page' });
  const redraw = async () => {
    if (!C.index) { wrap.replaceChildren(APP.loading()); try { await loadIndex(); } catch (e) { wrap.replaceChildren(h('div', { class: 'card placeholder' }, errMsg(e))); return; } }
    const live = C.index.list.filter((x) => !x.archived), kept = C.index.list.length - live.length;
    if (!live.some((x) => x.id === C.cur)) C.cur = (live[live.length - 1] || {}).id || null;
    if (C.index.cur !== C.cur) { C.index.cur = C.cur; saveIndex(); }
    const create = () => wizard(async (c) => {
      const p = progress(c); C.cache[c.id] = c;
      C.index.list.push({ id: c.id, name: c.name, format: c.format, unit: c.unit, created: c.created, done: p.done, total: p.total });
      C.cur = C.index.cur = c.id;
      try { await APP.kvSet(keyOf(c.id), pack(c)); await APP.kvSet('contest:index', C.index); toast('대회를 만들었어요'); } catch (e) { toast(errMsg(e), true); }
      redraw();
    });
    const top = h('div', { class: 'cz-top' },
      h('div', { class: 'cz-chips-top' }, live.map((x) => { const pct = x.total ? Math.round(x.done / x.total * 100) : 0;
        return h('button', { type: 'button', class: 'cz-cchip' + (x.id === C.cur ? ' on' : ''), onclick: () => { C.cur = x.id; redraw(); } },
          h('span', { class: 'cz-ctop' }, h('span', { class: 'cz-badge' }, x.format === 'league' ? '리그' : '토너먼트'), h('b', null, x.name)),
          h('span', { class: 'cz-cbar' }, bar(pct), h('em', null, pct + '%'))); })),
      h('div', { class: 'cz-topbtns' }, h('button', { class: 'sm primary', onclick: create }, '+ 대회 만들기'), h('button', { class: 'sm', onclick: () => archiveBox(redraw) }, '🗄 보관함' + (kept ? ` ${kept}` : ''))));
    if (!live.length) return wrap.replaceChildren(top, h('div', { class: 'card cz-empty' }, h('div', { class: 'muted', style: 'margin-bottom:14px' }, '진행 중인 대회가 없어요. 먼저 새 대회를 만들어 주세요.'), h('button', { class: 'primary big', onclick: create }, '+ 대회 만들기')));
    const body = h('div', null, APP.loading());
    wrap.replaceChildren(top, body);
    const c = await getContest(C.cur).catch((e) => { toast(errMsg(e), true); return null; });
    body.replaceChildren(c ? compView(c, redraw) : h('div', { class: 'card placeholder' }, '대회 기록을 불러오지 못했어요.'));
  };
  redraw();
  return wrap;
};
APP._contest = { leagueMatches, makeSlots, bracket, standings, pack, unpack, migrate, arranged };   // 시험용
})();
