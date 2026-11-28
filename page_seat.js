/* 자리 관리: 규칙에 맞춰 무작위 배치 + 두근두근 효과 + 저장/불러오기 */
(() => {
'use strict';
const APP = window.APP;
const { S, h, toast, errMsg, clone } = APP;

const SE = { names: null, cur: null, sel: null, token: 0, sound: false, busy: false, loadedName: '' };
APP.onClear.push(() => { SE.names = null; SE.cur = null; SE.loadedName = ''; });
let audio = null;
function thump(v) {
  if (!SE.sound) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.14);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v || 0.35, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.22);
  } catch (e) { /* 소리는 선택 기능 */ }
}

const rosterBy = () => { const m = {}; S.roster.forEach((s) => { m[s.num] = s; }); return m; };
const nameOf = (n) => { const s = rosterBy()[n]; return s ? s.name : n + '번'; };
const lk = (name) => 'seat:layout:' + name;

/* ---------- 배치 알고리즘 ---------- */
function groupOf(geo, i) { return Math.floor(Math.floor(i / geo.cols) / geo.gh) * 1000 + Math.floor((i % geo.cols) / geo.gw); }
function groupsOf(geo, asg) {
  const g = new Map();
  asg.forEach((n, i) => { if (n == null || !geo.cells[i]) return; const k = groupOf(geo, i); if (!g.has(k)) g.set(k, []); g.get(k).push(n); });
  return g;
}
const TEAM_COLORS = ['#fde68a', '#a7f3d0', '#fbcfe8', '#bfdbfe', '#fed7aa', '#ddd6fe', '#fecaca', '#99f6e4', '#d9f99d', '#e9d5ff'];
const pairKey = (a, b) => (a < b ? a + '-' + b : b + '-' + a);
const dark = (hex) => { const n = parseInt(hex.slice(1), 16), f = (v) => Math.round(v * 0.62); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
function teamMap(geo) { if (geo._tm) return geo._tm; const m = new Map(); (geo.teams || []).forEach((t, ti) => t.cells.forEach((i) => m.set(i, ti))); Object.defineProperty(geo, '_tm', { value: m, enumerable: false, writable: true }); return m; }
function teamGroups(geo, asg) {
  const g = (geo.teams || []).map(() => []), tm = teamMap(geo);
  asg.forEach((n, i) => { if (n == null || !geo.cells[i]) return; const t = tm.get(i); if (t != null) g[t].push(n); });
  return g;
}

function costOf(geo, cfg, asg, gender, hist) {
  let cost = 0; const info = { avoid: [], repeat: 0, skew: [] };
  const groups = groupsOf(geo, asg), pos = new Map();
  asg.forEach((n, i) => { if (n != null) pos.set(n, i); });
  const males = [...pos.keys()].filter((n) => gender[n] === '남').length, females = [...pos.keys()].filter((n) => gender[n] === '여').length;
  const ratio = males + females ? males / (males + females) : 0.5;
  const pairs = new Set();
  groups.forEach((mem) => {
    for (let i = 0; i < mem.length; i++) for (let j = i + 1; j < mem.length; j++) {
      const ga = gender[mem[i]], gb = gender[mem[j]];
      if (cfg.mode === 'mixed' && ga && gb && ga === gb) cost += 3;
      if (cfg.mode === 'same' && ga && gb && ga !== gb) cost += 3;
      pairs.add(pairKey(mem[i], mem[j]));
    }
  });
  teamGroups(geo, asg).forEach((mem, ti) => {
    mem.teamName = (geo.teams[ti] || {}).name;
    for (let i = 0; i < mem.length; i++) for (let j = i + 1; j < mem.length; j++) pairs.add(pairKey(mem[i], mem[j]));
    if (cfg.teamBalance) {
      const known = mem.filter((n) => gender[n]), m = known.filter((n) => gender[n] === '남').length;
      const dev = Math.max(0, Math.abs(m - known.length * ratio) - 0.5); cost += dev * 4;
      if (known.length > 1 && Math.abs(m - (known.length - m)) >= 2) info.skew.push({ name: mem.teamName, m, f: known.length - m });
    }
  });
  pairs.forEach((k) => { if (hist.has(k)) { cost += 6; info.repeat++; } });
  (cfg.avoid || []).forEach((r) => {
    const a = pos.get(r.a), b = pos.get(r.b); if (a == null || b == null) return;
    const tm = teamMap(geo), ta = tm.get(a), tb = tm.get(b);
    const bad = r.type === 'group' ? (groupOf(geo, a) === groupOf(geo, b) || (ta != null && ta === tb))
      : Math.max(Math.abs(Math.floor(a / geo.cols) - Math.floor(b / geo.cols)), Math.abs((a % geo.cols) - (b % geo.cols))) <= r.n;
    if (bad) { cost += 50; info.avoid.push(`${nameOf(r.a)}↔${nameOf(r.b)}`); }
  });
  return { cost, info };
}

function arrange(cfg, hist) {
  const geo = { cols: cfg.cols, rows: cfg.rows, gw: cfg.gw, gh: cfg.gh, cells: cfg.cells.slice(), teams: (cfg.teams || []).map((t) => ({ name: t.name, cells: t.cells.slice() })) };
  const roster = APP.roster(), gender = {}; roster.forEach((s) => { gender[s.num] = s.gender; });
  const active = []; geo.cells.forEach((on, i) => on && active.push(i));
  const asg = new Array(geo.cells.length).fill(null);
  const fixedSeats = new Set(), fixedNums = new Set();
  (cfg.fixed || []).forEach((f) => { if (geo.cells[f.idx] && gender[f.num] !== undefined && !fixedSeats.has(f.idx) && !fixedNums.has(f.num)) { asg[f.idx] = f.num; fixedSeats.add(f.idx); fixedNums.add(f.num); } });
  const free = active.filter((i) => !fixedSeats.has(i));
  const pool = roster.filter((s) => !fixedNums.has(s.num)).map((s) => s.num);
  if (pool.length > free.length) return { error: `사용 자리(${active.length}개)가 학생(${roster.length}명)보다 적어요. 학급 기초설정에서 자리를 늘려 주세요.` };
  while (pool.length < free.length) pool.push(null);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  free.forEach((seat, k) => { asg[seat] = pool[k]; });
  let cur = costOf(geo, cfg, asg, gender, hist);
  if (free.length > 1) {
    const iters = 9000;
    for (let it = 0; it < iters; it++) {
      const T = 3 * Math.pow(0.02 / 3, it / iters);
      const a = free[Math.floor(Math.random() * free.length)], b = free[Math.floor(Math.random() * free.length)];
      if (a === b || asg[a] === asg[b]) continue;
      [asg[a], asg[b]] = [asg[b], asg[a]];
      const nx = costOf(geo, cfg, asg, gender, hist);
      if (nx.cost <= cur.cost || Math.random() < Math.exp((cur.cost - nx.cost) / T)) cur = nx; else [asg[a], asg[b]] = [asg[b], asg[a]];
    }
  }
  const notes = [];
  if (cur.info.avoid.length) notes.push('기피 설정을 지키지 못한 학생: ' + cur.info.avoid.join(', '));
  if (cur.info.skew.length) notes.push('남녀 비율이 많이 치우친 모둠: ' + cur.info.skew.map((x) => `${x.name} (남${x.m}:여${x.f})`).join(', '));
  if (cur.info.repeat) notes.push(`최근에 같은 짝·모둠이 된 조합이 ${cur.info.repeat}쌍 있어요`);
  return { geo, asg, notes };
}

/* ---------- 저장 목록 ---------- */
async function loadNames() {
  const keys = await APP.kvList('seat:layout:');
  SE.names = keys.sort((a, b) => b.updated - a.updated).map((k) => ({ name: k.key.slice('seat:layout:'.length), updated: k.updated }));
}
async function recentPairs(n) {
  const set = new Set(); if (!n || !SE.names) return set;
  const keys = SE.names.slice(0, n).map((x) => lk(x.name));
  if (!keys.length) return set;
  const vals = await APP.kvGet(keys);
  keys.forEach((k) => { const l = vals[k]; if (!l) return; [...groupsOf(l, l.assign).values(), ...teamGroups(l, l.assign)].forEach((mem) => { for (let i = 0; i < mem.length; i++) for (let j = i + 1; j < mem.length; j++) set.add(pairKey(mem[i], mem[j])); }); });
  return set;
}
function askName(def) {
  return new Promise((resolve) => {
    const input = h('input', { value: def, style: 'width:100%;margin:12px 0 8px' });
    const close = (v) => { ov.remove(); resolve(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value.trim()); if (e.key === 'Escape') close(null); });
    const ov = h('div', { class: 'overlay' }, h('div', { class: 'modal' }, h('h3', null, '자리 배치 이름'), h('div', { class: 'muted' }, '예) 11월-1 (같은 이름이면 덮어써요)'), input,
      h('div', { class: 'row' }, h('button', { onclick: () => close(null) }, '취소'), h('button', { class: 'primary', onclick: () => close(input.value.trim()) }, '저장'))));
    document.body.append(ov); input.focus(); input.select();
  });
}
function defaultName() {
  const m = new Date().getMonth() + 1, used = (SE.names || []).filter((x) => x.name.startsWith(m + '월-')).length;
  return `${m}월-${used + 1}`;
}

/* ---------- 화면 ---------- */
APP.pages.seat = () => {
  const wrap = h('div');
  const draw = () => {
    wrap.replaceChildren();
    if (!S.roster.length) return wrap.append(h('div', { class: 'card placeholder' }, '먼저 학급 기초설정에서 명렬표와 자리를 설정해 주세요.'));
    wrap.append(view(draw));
  };
  if (!SE.names) { wrap.append(APP.loading()); loadNames().then(draw).catch((e) => { SE.names = []; draw(); toast(errMsg(e), true); }); } else draw();
  return wrap;
};

function ruleText(c) {
  const g = c.gw === 1 && c.gh === 1 ? '개별' : c.gw === 2 && c.gh === 1 ? '짝' : `${c.gw}×${c.gh} 묶음`;
  const m = { mixed: '짝은 남녀로', same: '짝은 동성으로', random: '짝 성별 무관' }[c.mode] || '짝은 남녀로';
  const tm = (c.teams || []).length ? `모둠 ${c.teams.length}개${c.teamBalance ? '(남녀 비율 맞춤)' : ''} · ` : '';
  return `${c.cols}×${c.rows} · ${g} · ${m} · ${tm} 고정 ${c.fixed.length} · 기피 ${c.avoid.length} · 반복 방지 ${c.noRepeat}회`;
}

function view(redraw) {
  const cfg = S.seat;
  const geo = SE.cur || { cols: cfg.cols, rows: cfg.rows, gw: cfg.gw, gh: cfg.gh, cells: cfg.cells, teams: cfg.teams || [], assign: null };
  const tmap = teamMap(geo);
  const asg = SE.cur ? SE.cur.assign : null;
  const banner = h('div', { class: 'drum', hidden: true });
  let showT = true; try { showT = localStorage.getItem('seat_team') !== 'off'; } catch (e) { /* 기본: 보이기 */ }
  const hasT = (geo.teams || []).some((t) => t.cells.length);
  // 모둠 표시: 모둠이 바뀌는 줄·열 사이에 간격을 더 둠 (빈 칸 트랙을 끼워 넣음)
  const TG = hasT && showT, nR = Math.ceil(geo.cells.length / geo.cols);
  const tAt = (r, c) => (geo.cells[r * geo.cols + c] && tmap.has(r * geo.cols + c) ? tmap.get(r * geo.cols + c) : -1);
  const colBr = [], rowBr = [];
  if (TG) {
    for (let c = 0; c < geo.cols - 1; c++) colBr[c] = [...Array(nR).keys()].some((r) => tAt(r, c) !== tAt(r, c + 1) && (tAt(r, c) >= 0 || tAt(r, c + 1) >= 0));
    for (let r = 0; r < nR - 1; r++) rowBr[r] = [...Array(geo.cols).keys()].some((c) => tAt(r, c) !== tAt(r + 1, c) && (tAt(r, c) >= 0 || tAt(r + 1, c) >= 0));
  }
  const colTrack = [], rowTrack = []; let colTpl = '', rowTpl = '';
  for (let c = 0, k = 1; c < geo.cols; c++) { colTrack[c] = k++; colTpl += '1fr '; if (colBr[c]) { colTpl += '10px '; k++; } }
  for (let r = 0, k = 1; r < nR; r++) { rowTrack[r] = k++; rowTpl += 'auto '; if (rowBr[r]) { rowTpl += '10px '; k++; } }
  const gridStyle = TG ? `grid-template-columns:${colTpl};grid-template-rows:${rowTpl}` : `grid-template-columns:repeat(${geo.cols},1fr)`;
  const grid = h('div', { class: 'pgrid' + (TG ? ' teams' : ''), style: gridStyle });
  const tline = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); tline.setAttribute('class', 'tline');
  const gwrap = h('div', { class: 'pgrid-wrap' + (hasT && showT ? ' teams' : '') }, grid, tline);
  const cells = [];
  const by = rosterBy();
  const paint = (c, n, extra) => {
    const s = n != null ? by[n] : null;
    c.el.className = 'pseat ' + (geo.cells[c.idx] ? 'on ' + (((Math.floor(c.idx / geo.cols / geo.gh) + Math.floor((c.idx % geo.cols) / geo.gw)) % 2) ? 'gb' : 'ga') : 'off') + (s ? ' ' + APP.gcls(s.gender) : '') + (extra ? ' ' + extra : '');
    const ti = tmap.get(c.idx);
    c.el.replaceChildren(...(n != null ? [h('span', { class: 'pno' }, n), h('span', { class: 'pnm' }, s ? s.name : n + '번'), ti != null ? h('span', { class: 'tchip', style: `background:${TEAM_COLORS[ti % TEAM_COLORS.length]}` }, geo.teams[ti].name) : null].filter(Boolean) : []));
    if (!geo.cells[c.idx]) c.el.textContent = '';
  };
  geo.cells.forEach((on, i) => {
    const c = { idx: i, el: h('div', { class: 'pseat', style: TG ? `grid-column:${colTrack[i % geo.cols]};grid-row:${rowTrack[Math.floor(i / geo.cols)]}` : null }) };
    paint(c, asg ? asg[i] : null);
    c.el.addEventListener('click', () => {
      if (SE.busy || !asg || !geo.cells[i]) return;
      if (SE.sel == null) { SE.sel = i; c.el.classList.add('sel'); return; }
      if (SE.sel !== i) { [asg[SE.sel], asg[i]] = [asg[i], asg[SE.sel]]; }
      SE.sel = null; redraw();
    });
    cells.push(c); grid.append(c.el);
  });

  /* 모둠 테두리: 같은 모둠 자리를 한 덩어리 선으로 묶기 */
  const drawTeams = () => {
    if (!gwrap.isConnected) return;
    tline.replaceChildren();
    if (!hasT || !showT) return;
    const G = parseFloat(getComputedStyle(grid).columnGap) || 12, e = G / 2, d = 2.5, NS = 'http://www.w3.org/2000/svg';
    tline.setAttribute('width', gwrap.clientWidth); tline.setAttribute('height', gwrap.clientHeight);
    const box = (i) => { const el = cells[i] && cells[i].el; return el ? { l: el.offsetLeft, t: el.offsetTop, r: el.offsetLeft + el.offsetWidth, b: el.offsetTop + el.offsetHeight } : null; };
    // 칸의 테두리 구역: 이웃 칸과의 한가운데까지 (이웃이 없으면 e만큼)
    // 같은 모둠 이웃과는 한가운데에서 만나고, 바깥쪽은 어디서나 같은 간격(M) → 카드가 테두리 안 가운데에 놓임
    const M = G + 5;
    const rect = (i, ti) => {
      const q = box(i); if (!q) return null; const r0 = Math.floor(i / geo.cols), c0 = i % geo.cols;
      const sm = (dr, dc) => tOf(r0 + dr, c0 + dc) === ti;
      const L = sm(0, -1) ? box(i - 1) : null, Rr = sm(0, 1) ? box(i + 1) : null, T = sm(-1, 0) ? box(i - geo.cols) : null, Bb = sm(1, 0) ? box(i + geo.cols) : null;
      return { l: L ? (L.r + q.l) / 2 : q.l - M, r: Rr ? (q.r + Rr.l) / 2 : q.r + M, t: T ? (T.b + q.t) / 2 : q.t - M, b: Bb ? (q.b + Bb.t) / 2 : q.b + M };
    };
    const C = geo.cols, R = Math.ceil(geo.cells.length / C);
    const tOf = (r, c) => (r < 0 || c < 0 || r >= R || c >= C) ? -1 : (tmap.has(r * C + c) ? tmap.get(r * C + c) : -1);
    geo.teams.forEach((tm, ti) => {
      const col = dark(TEAM_COLORS[ti % TEAM_COLORS.length]); let path = '';
      tm.cells.forEach((i) => {
        const r = Math.floor(i / C), c = i % C, q = rect(i, ti); if (!q) return;
        const same = (dr, dc) => tOf(r + dr, c + dc) === ti;
        const bnd = { T: !same(-1, 0), B: !same(1, 0), L: !same(0, -1), Rt: !same(0, 1) };
        // 각 변: 바깥쪽이면 안쪽으로 d만큼 들여서 선을 그림. 끝은 볼록 모서리면 줄이고, 오목 모서리면 늘림
        const endAdj = (perpB, nr, nc, side) => perpB ? d : (same(nr, nc) && tOf(r + nr + (side === 'T' ? -1 : side === 'B' ? 1 : 0), c + nc + (side === 'L' ? -1 : side === 'Rt' ? 1 : 0)) !== ti ? 0 : -d);
        if (bnd.T) { const y = q.t + d; path += `M${q.l + endAdj(bnd.L, 0, -1, 'T')} ${y}H${q.r - endAdj(bnd.Rt, 0, 1, 'T')}`; }
        if (bnd.B) { const y = q.b - d; path += `M${q.l + endAdj(bnd.L, 0, -1, 'B')} ${y}H${q.r - endAdj(bnd.Rt, 0, 1, 'B')}`; }
        if (bnd.L) { const x = q.l + d; path += `M${x} ${q.t + endAdj(bnd.T, -1, 0, 'L')}V${q.b - endAdj(bnd.B, 1, 0, 'L')}`; }
        if (bnd.Rt) { const x = q.r - d; path += `M${x} ${q.t + endAdj(bnd.T, -1, 0, 'Rt')}V${q.b - endAdj(bnd.B, 1, 0, 'Rt')}`; }
      });
      const p = document.createElementNS(NS, 'path'); p.setAttribute('d', path); p.setAttribute('stroke', col); p.setAttribute('stroke-width', '3'); p.setAttribute('fill', 'none'); p.setAttribute('stroke-linecap', 'square');
      tline.append(p);
    });
  };
  setTimeout(drawTeams, 0);
  if (window.ResizeObserver) new ResizeObserver(() => drawTeams()).observe(grid);

  /* 두근두근 연출 */
  const animate = (res, onDone) => {
    const token = ++SE.token; SE.busy = true;
    const act = cells.filter((c) => geo.cells[c.idx] && res.geo.cells[c.idx]);
    const names = APP.roster().map((s) => s.name);
    const done = new Set();
    const finish = () => { clearInterval(roll); clearInterval(beat); SE.busy = false; banner.hidden = true; onDone(); };
    banner.hidden = false; banner.textContent = '두근… 두근… 자리를 섞는 중';
    const roll = setInterval(() => { if (token !== SE.token) return; act.forEach((c) => { if (!done.has(c.idx)) { c.el.className = 'pseat on rolling beating'; c.el.style.setProperty('--beat', (0.9 - 0.5 * Math.min(1, (performance.now() - t0) / 2400)).toFixed(2) + 's'); c.el.replaceChildren(h('span', { class: 'pnm' }, names[Math.floor(Math.random() * names.length)])); } }); }, 90);
    const t0 = performance.now();
    const beat = setInterval(() => { thump(0.35); setTimeout(() => thump(0.22), 150); }, 800);
    SE.skip = () => { SE.token++; finish(); };
    setTimeout(() => {
      if (token !== SE.token) return;
      clearInterval(beat);
      const order = act.slice().sort(() => Math.random() - 0.5); let k = 0;
      const next = () => {
        if (token !== SE.token) return;
        if (k >= order.length) return finish();
        const c = order[k++]; done.add(c.idx);
        paint(c, res.asg[c.idx], 'reveal'); thump(0.3);
        banner.textContent = `${k} / ${order.length}`;
        const left = order.length - k;
        const delay = left === 1 ? 1100 : Math.max(120, 520 * Math.pow(0.9, k));
        if (left === 0) setTimeout(finish, 500); else setTimeout(next, delay);
      };
      banner.textContent = '자, 이제 공개합니다!'; setTimeout(next, 700);
    }, 2400);
  };

  const shuffleBtn = h('button', { class: 'primary big', disabled: SE.busy, onclick: async () => {
    if (SE.busy) return;
    if (SE.cur && (SE.cur.cols !== cfg.cols || SE.cur.rows !== cfg.rows || SE.cur.gw !== cfg.gw || SE.cur.gh !== cfg.gh || SE.cur.cells.join() !== cfg.cells.join())) {
      SE.cur = null; SE.loadedName = ''; redraw(); return toast('저장된 자리와 현재 설정의 모양이 달라 화면을 새로 맞췄어요. 한 번 더 눌러 주세요.');
    }
    const ac = window.AudioContext || window.webkitAudioContext; if (SE.sound && ac) { audio = audio || new ac(); if (audio.state === 'suspended') audio.resume(); }
    shuffleBtn.disabled = true;
    try {
      const hist = await recentPairs(cfg.noRepeat);
      const res = arrange(cfg, hist);
      if (res.error) { shuffleBtn.disabled = false; return toast(res.error, true); }
      SE.sel = null; SE.loadedName = '';
      animate(res, () => { SE.cur = { ...res.geo, teams: res.geo.teams, assign: res.asg, notes: res.notes }; redraw(); });
      skipBtn.hidden = false;
    } catch (e) { shuffleBtn.disabled = false; toast(errMsg(e), true); }
  } }, SE.cur ? '다시 섞기' : '자리 섞기');
  const skipBtn = h('button', { hidden: !SE.busy, onclick: () => SE.skip && SE.skip() }, '건너뛰기');
  const saveBtn = h('button', { disabled: !asg || SE.busy, onclick: async () => {
    const name = await askName(SE.loadedName || defaultName()); if (!name) return;
    if (!/^[\w:.\- 가-힣]{1,60}$/.test(name)) return toast('이름에는 글자·숫자·공백·-·. 만 쓸 수 있어요', true);
    if ((SE.names || []).some((x) => x.name === name) && !await uiConfirm(`"${name}"이(가) 이미 있어요. 덮어쓸까요?`)) return;
    try { await APP.kvSet(lk(name), { name, savedAt: Date.now(), cols: geo.cols, rows: geo.rows, gw: geo.gw, gh: geo.gh, cells: geo.cells, teams: geo.teams || [], colNames: cfg.colNames || [], assign: asg }); SE.loadedName = name; await loadNames(); toast(`"${name}"으로 저장했습니다`); redraw(); } catch (e) { toast(errMsg(e), true); }
  } }, '저장');
  const loadSel = h('select', { onchange: async (e) => {
    const name = e.target.value; if (!name) return;
    try { const j = await APP.kvGet([lk(name)]); const l = j[lk(name)]; if (!l) return toast('불러오지 못했어요', true);
      SE.cur = { cols: l.cols, rows: l.rows, gw: l.gw, gh: l.gh, cells: l.cells, teams: l.teams || [], assign: l.assign, notes: [] }; SE.loadedName = name; SE.sel = null; redraw(); } catch (x) { toast(errMsg(x), true); }
  } }, h('option', { value: '' }, SE.names.length ? '저장된 자리 불러오기…' : '저장된 자리가 없습니다'), SE.names.map((x) => h('option', { value: x.name, selected: x.name === SE.loadedName }, x.name)));
  const delBtn = h('button', { class: 'ghost', hidden: !SE.loadedName, onclick: async () => {
    if (!await uiConfirm(`저장된 "${SE.loadedName}"을(를) 삭제할까요?`)) return;
    try { await APP.kvDel(lk(SE.loadedName)); SE.loadedName = ''; await loadNames(); redraw(); } catch (e) { toast(errMsg(e), true); }
  } }, '이 저장본 삭제');
  const exportBtn = h('button', { onclick: async () => {
    try {
      const names = SE.names || [], keys = names.map((x) => lk(x.name)), vals = keys.length ? await APP.kvGet(keys) : {}, roster = APP.roster(), by = rosterBy();
      const rowsOf = (l) => {
        const cn = (i) => (l.colNames && l.colNames[i]) || String(i + 1), rows = [['칠 판'], Array.from({ length: l.cols }, (_, c) => cn(c))];
        for (let r = 0; r < l.rows; r++) rows.push(Array.from({ length: l.cols }, (_, c) => { const i = r * l.cols + c, n = l.assign ? l.assign[i] : null; return l.cells[i] && n != null ? (by[n] ? by[n].name : n + '번') : ''; }));
        if ((l.teams || []).length) { rows.push([], ['모둠', '구성원']); l.teams.forEach((t) => rows.push([t.name, t.cells.map((i) => l.assign && l.assign[i] != null ? (by[l.assign[i]] ? by[l.assign[i]].name : l.assign[i] + '번') : '').filter(Boolean).join(', ')])); }
        return rows;
      };
      const mk = (label, name, l, group) => { l = { ...l, colNames: l.colNames || cfg.colNames || [] }; return { id: name, label, group, name: '자리_' + name, rows: rowsOf(l), image: () => APP.exporter.seatCanvas(name, l, roster) }; };
      const items = [];
      if (SE.cur && SE.cur.assign) items.push(mk('지금 화면의 자리 (저장 안 한 상태)', '현재 자리', { ...SE.cur, colNames: cfg.colNames }, '현재'));
      names.forEach((x) => { const l = vals[lk(x.name)]; if (l && l.assign) items.push(mk(x.name, x.name, l, '저장된 자리')); });
      APP.exporter.open({ title: '자리 배치', items, empty: '저장된 자리가 아직 없어요. 자리를 섞은 뒤 "저장"을 눌러 주세요' });
    } catch (e) { toast(errMsg(e), true); }
  } }, '내보내기');
  const teamTog = hasT ? h('label', { class: 'muted', style: 'display:inline-flex;gap:6px;align-items:center' }, h('input', { type: 'checkbox', checked: showT, onchange: (e) => { try { localStorage.setItem('seat_team', e.target.checked ? 'on' : 'off'); } catch (x) { /* 저장 안 됨 */ } redraw(); } }), '모둠 표시') : null;
  const sound = h('label', { class: 'muted', style: 'display:inline-flex;gap:6px;align-items:center' }, h('input', { type: 'checkbox', checked: SE.sound, onchange: (e) => { SE.sound = e.target.checked; } }), '두근 소리');

  return h('div', null,
    h('div', { class: 'card seat-tools' },
      h('div', { class: 'row gap' }, shuffleBtn, skipBtn, saveBtn, loadSel, delBtn, exportBtn, teamTog, sound)),
    h('div', { class: 'card seat-view' },
      banner,
      h('div', { class: 'board-front' }, '칠 판'),
      h('div', { class: 'col-labels' + (TG ? ' teams' : ''), style: TG ? `grid-template-columns:${colTpl}` : `grid-template-columns:repeat(${geo.cols},1fr)` }, Array.from({ length: geo.cols }, (_, c) => h('div', { class: 'col-label ro', style: TG ? `grid-column:${colTrack[c]}` : null }, (cfg.colNames && cfg.colNames[c]) || String(c + 1)))),
      gwrap,
      asg && SE.loadedName ? h('div', { class: 'muted', style: 'margin-top:10px' }, `불러온 자리: ${SE.loadedName}`) : null));
}
})();
