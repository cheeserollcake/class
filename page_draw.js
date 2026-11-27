/* 뽑기: 랜덤 뽑기 / 팀 구성 / 마니또 */
(() => {
'use strict';
const APP = window.APP;
const { S, h, toast, errMsg } = APP;

const D = {
  sub: 'pick', step: { pick: 'cfg', team: 'cfg', mani: 'cfg' }, muted: false,
  pick: { n: 1, g: 'all', noRepeat: true, drawn: [], last: null, go: false },
  team: { n: 4, mode: 'none', last: null, go: false },
  mani: { mode: 'mix', res: null },
  cfg: null, hist: null
};

APP.onClear.push(() => { D.cfg = null; D.hist = null; D.mani.res = null; D.step.mani = 'cfg'; });

/* ---------- 공통 ---------- */
const roster = () => APP.roster();
/* 결석생: 오늘 날짜로 이 브라우저에 기억 (뽑기·팀 구성에서 뺌) */
const ABS_KEY = 'draw_absent', DRAWN_KEY = 'draw_drawn';
D.absent = new Set();
try { const a = JSON.parse(localStorage.getItem(ABS_KEY) || 'null'); if (a && a.date === new Date().toDateString()) D.absent = new Set(a.nums); } catch (e) { /* 없음 */ }
try { const d = JSON.parse(localStorage.getItem(DRAWN_KEY) || 'null'); if (Array.isArray(d)) D.pick.drawn = d; } catch (e) { /* 없음 */ }
const saveAbsent = () => { try { localStorage.setItem(ABS_KEY, JSON.stringify({ date: new Date().toDateString(), nums: [...D.absent] })); } catch (e) { /* 저장 안 됨 */ } };
const saveDrawn = () => { try { localStorage.setItem(DRAWN_KEY, JSON.stringify(D.pick.drawn)); } catch (e) { /* 저장 안 됨 */ } };
const present = () => APP.roster().filter((s) => !D.absent.has(s.num));
const stu = (n) => roster().find((s) => s.num === n);
const nm = (n) => { const s = stu(n); return s ? s.name : n + '번'; };
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
const gcls = (g) => APP.gcls(g);
const alive = (el) => el && el.isConnected;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensure() {
  if (D.cfg && D.hist) return;
  const kv = await APP.kvGet(['draw:cfg', 'draw:manito']);
  D.cfg = Object.assign({ teamAvoid: [], maniAvoid: [] }, kv['draw:cfg'] || {});
  D.hist = Array.isArray(kv['draw:manito']) ? kv['draw:manito'] : [];
}
let cfgT = null;
const saveCfgLater = () => { clearTimeout(cfgT); cfgT = setTimeout(() => APP.kvSet('draw:cfg', D.cfg).catch((e) => toast(errMsg(e), true)), 700); };

/* ---------- 화면 꽉 채우기 (데스크톱) ---------- */
const isDesk = () => innerWidth >= 900;
let relayout = null;
window.addEventListener('resize', () => { if (relayout) relayout(); });
/* n개 칸을 W×H에 배치할 때 글자가 가장 크게 들어가는 열 수 찾기 */
function fitCells(n, W, H, gap, score) {
  let best = null;
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c), cw = (W - gap * (c - 1)) / c, ch = (H - gap * (r - 1)) / r;
    if (cw <= 0 || ch <= 0) continue;
    const f = score(cw, ch);
    if (!best || f > best.f + 0.01) best = { c, r, cw, ch, f };
  }
  return best || { c: 1, r: n, cw: W, ch: 60, f: 16 };
}
const maxLen = (arr) => Math.max(2, ...arr.map((x) => [...String(x)].length));
/* 무대(stage)를 화면 아래 끝까지 늘리고, 안쪽 grid의 크기를 돌려줌 */
function stretch(stage, grid) {
  if (!isDesk()) { stage.style.height = ''; return null; }
  const top = stage.getBoundingClientRect().top + window.scrollY - window.scrollY;
  stage.style.height = Math.max(360, innerHeight - top - 16) + 'px';
  const over = document.documentElement.scrollHeight - innerHeight;   // 아래 여백 때문에 넘치면 그만큼 줄이기
  if (over > 0) stage.style.height = Math.max(360, parseFloat(stage.style.height) - over) + 'px';
  return { W: grid.clientWidth, H: grid.clientHeight };
}

/* ---------- 소리 (Web Audio로 직접 만들기) ---------- */
let ac = null;
const actx = () => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) { ac = null; } return ac; };
function tone(f, t0, dur, type, vol, f2) {
  const c = actx(); if (!c || D.muted) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || 'square'; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || 0.08, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}
function noise(t0, dur, vol) {
  const c = actx(); if (!c || D.muted) return;
  const len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 1800; s.buffer = buf; g.gain.value = vol || 0.25;
  s.connect(f).connect(g).connect(c.destination); s.start(t0);
}
let lastTick = 0;
const SND = {
  tick() { const c = actx(); if (!c) return; const now = c.currentTime; if (now - lastTick < 0.045) return; lastTick = now; tone(900 + Math.random() * 500, now, 0.035, 'square', 0.035); },
  roll(sec) { const c = actx(); if (!c) return; const t = c.currentTime; let x = 0; while (x < sec) { const gap = 0.11 - 0.08 * (x / sec); noise(t + x, 0.06, 0.12 + 0.15 * (x / sec)); x += gap; } },
  pop() { const c = actx(); if (!c) return; const t = c.currentTime; tone(520, t, 0.12, 'triangle', 0.15, 1040); noise(t, 0.05, 0.2); },
  fanfare() {
    const c = actx(); if (!c) return; const t = c.currentTime + 0.02;
    [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.38]].forEach(([f, d]) => { tone(f, t + d, 0.22, 'triangle', 0.16); tone(f / 2, t + d, 0.22, 'square', 0.04); });
    [523, 659, 784, 1047].forEach((f) => tone(f, t + 0.55, 0.9, 'triangle', 0.1));
    noise(t + 0.55, 0.4, 0.3);
  },
  whoosh() { const c = actx(); if (!c) return; tone(300, c.currentTime, 0.35, 'sawtooth', 0.03, 1200); }
};

/* ---------- 꽃가루 ---------- */
function confetti() {
  const cv = h('canvas', { class: 'confetti' }); document.body.append(cv);
  const W = cv.width = innerWidth, H = cv.height = innerHeight, ctx = cv.getContext('2d');
  const cols = ['#2f6fed', '#e5484d', '#f5a524', '#1baf7a', '#a855f7', '#ec4899', '#06b6d4'];
  const ps = Array.from({ length: 180 }, (_, i) => {
    const left = i % 2 === 0;
    return { x: left ? 0 : W, y: H * 0.75, vx: (left ? 1 : -1) * (6 + Math.random() * 10), vy: -(10 + Math.random() * 12), w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: pickOne(cols) };
  });
  const t0 = performance.now();
  const step = (t) => {
    const k = (t - t0) / 1000; ctx.clearRect(0, 0, W, H);
    ps.forEach((p) => { p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 2.2)); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); });
    if (k < 3.3) requestAnimationFrame(step); else cv.remove();
  };
  requestAnimationFrame(step);
}

/* ---------- 기피 설정 편집 ---------- */
function avoidEditor(key, redraw, label) {
  const list = D.cfg[key];
  const opts = () => roster().map((s) => h('option', { value: s.num }, `${s.num} ${s.name}`));
  const a = h('select', null, opts()), b = h('select', null, opts());
  if (roster()[1]) b.value = roster()[1].num;
  const add = (x, y) => {
    x = Number(x); y = Number(y);
    if (x === y) return toast('서로 다른 두 학생을 고르세요', true);
    if (list.some(([p, q]) => (p === x && q === y) || (p === y && q === x))) return toast('이미 있는 기피 설정이에요', true);
    list.push([x, y]); saveCfgLater(); redraw();
  };
  const seatAv = (S.seat && S.seat.avoid) || [];
  return h('div', { class: 'field' }, h('label', null, '기피 설정'),
    h('div', { class: 'muted', style: 'margin-bottom:6px' }, label),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, a, h('span', null, '↔'), b, h('button', { class: 'sm', onclick: () => add(a.value, b.value) }, '추가'),
      seatAv.length ? h('button', { class: 'sm ghost', onclick: () => {
        let c = 0; seatAv.forEach((x) => { if (x.a !== x.b && !list.some(([p, q]) => (p === x.a && q === x.b) || (p === x.b && q === x.a))) { list.push([x.a, x.b]); c++; } });
        saveCfgLater(); toast(c ? `자리 기피 설정 ${c}개를 가져왔어요` : '새로 가져올 설정이 없어요'); redraw();
      } }, '자리 기피 설정 가져오기') : null),
    h('div', { class: 'chips', style: 'margin-top:8px' }, list.filter(([x, y]) => stu(x) && stu(y)).map(([x, y]) => h('span', { class: 'chip-s av-chip' }, `${nm(x)} ↔ ${nm(y)}`,
      h('button', { class: 'x', title: '삭제', onclick: () => { D.cfg[key] = list.filter((p) => !(p[0] === x && p[1] === y)); saveCfgLater(); redraw(); } }, '✕'))),
      list.length ? null : h('span', { class: 'muted' }, '없음')));
}
const radios = (name, cur, items, on) => h('div', { class: 'radios' }, items.map(([v, n]) =>
  h('label', null, h('input', { type: 'radio', name, checked: cur === v, onchange: () => on(v) }), n)));
const stepper = (val, min, max, on) => {
  const inp = h('input', { type: 'number', class: 'n', min, max, value: val, style: 'width:72px;text-align:center', onchange: (e) => on(Math.max(min, Math.min(max, Number(e.target.value) | 0 || min))) });
  return h('div', { class: 'row', style: 'gap:4px' }, h('button', { class: 'sm', onclick: () => on(Math.max(min, val - 1)) }, '−'), inp, h('button', { class: 'sm', onclick: () => on(Math.min(max, val + 1)) }, '+'));
};
const soundBox = () => h('label', { class: 'row', style: 'gap:6px;cursor:pointer' }, h('input', { type: 'checkbox', checked: !D.muted, onchange: (e) => { D.muted = !e.target.checked; } }), '효과음 켜기');

/* ---------- 페이지 ---------- */
APP._draw = { makeTeams: (...a) => makeTeams(...a), makeManito: (...a) => makeManito(...a) };   // 시험용
APP.pages.draw = () => {
  const wrap = h('div'), body = h('div'), tabs = h('div', { class: 'tabs' });
  const gear = h('button', { class: 'tabs-gear', title: '조건 설정 (비밀번호 필요)', onclick: async () => {
    if (!D.cfg) return;
    const ask = APP.pwAsk; if (ask && !(await ask('조건 설정', '선생님 비밀번호를 넣어 주세요.'))) return;
    openCfg(draw);
  } }, '설정');
  const drawTabs = () => tabs.replaceChildren(...[['pick', '뽑기'], ['team', '팀 구성'], ['mani', '마니또']].map(([id, n]) =>
    h('button', { class: 'tab' + (D.sub === id ? ' active' : ''), onclick: () => { D.sub = id; drawTabs(); draw(); } }, n)), h('div', { style: 'flex:1' }), gear);
  const draw = () => {
    body.replaceChildren(); document.querySelectorAll('.confetti').forEach((c) => c.remove());
    if (!roster().length) return body.append(h('div', { class: 'card placeholder' }, '먼저 학급 기초설정에서 명렬표를 입력해 주세요.'));
    if (!D.cfg || !D.hist) return body.append(APP.loading());   // 아직 불러오는 중
    body.append(D.sub === 'pick' ? viewPick(draw) : D.sub === 'team' ? viewTeam(draw) : viewMani(draw));
  };
  wrap.append(tabs, body); drawTabs(); body.append(APP.loading());
  ensure().then(draw).catch((e) => { D.cfg = D.cfg || { teamAvoid: [], maniAvoid: [] }; D.hist = D.hist || []; draw(); toast(errMsg(e), true); });
  return wrap;
};

/* =====================================================
   1. 랜덤 뽑기
   ===================================================== */
function pickPool() {
  let p = present();
  if (D.pick.g === 'm') p = p.filter((s) => s.gender === '남');
  if (D.pick.g === 'f') p = p.filter((s) => s.gender === '여');
  if (D.pick.noRepeat) p = p.filter((s) => !D.pick.drawn.includes(s.num));
  return p;
}
/* 결석생 고르기 */
function absentEditor(rd) {
  const all = roster();
  return h('div', { class: 'field' }, h('label', null, `결석생 (${D.absent.size}명)`),
    h('div', { class: 'muted', style: 'margin-bottom:6px' }, '누르면 결석으로 표시되고 뽑기·팀 구성에서 빠져요. 오늘 하루 동안 기억해요.'),
    h('div', { class: 'abs-grid' }, all.map((s) => h('button', { class: 'abs-chip ' + gcls(s.gender) + (D.absent.has(s.num) ? ' off' : ''), onclick: () => { D.absent.has(s.num) ? D.absent.delete(s.num) : D.absent.add(s.num); saveAbsent(); rd(); } }, s.name))),
    D.absent.size ? h('button', { class: 'sm ghost', style: 'margin-top:6px', onclick: () => { D.absent.clear(); saveAbsent(); rd(); } }, '결석 모두 해제') : null);
}
function pickCfg(rd) {
  const P = D.pick, all = present(), m = all.filter((s) => s.gender === '남').length, f = all.filter((s) => s.gender === '여').length;
  const pool = pickPool();
  if (P.n > Math.max(1, pool.length)) P.n = Math.max(1, pool.length);
  return [
    h('div', { class: 'field' }, h('label', null, '대상'), radios('pg', P.g, [['all', `전체 (${all.length}명)`], ['m', `남자만 (${m}명)`], ['f', `여자만 (${f}명)`]], (v) => { P.g = v; rd(); })),
    h('div', { class: 'field' }, h('label', null, '한 번에 뽑을 사람 수'),
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, stepper(P.n, 1, Math.max(1, pool.length), (v) => { P.n = v; rd(); }),
        h('span', { class: 'muted' }, `1 ~ ${pool.length}명`))),
    h('div', { class: 'field' },
      h('label', { class: 'row', style: 'gap:6px;cursor:pointer;font-weight:400' }, h('input', { type: 'checkbox', checked: P.noRepeat, onchange: (e) => { P.noRepeat = e.target.checked; rd(); } }), '이미 뽑힌 학생은 빼고 뽑기'),
      P.noRepeat ? h('div', { class: 'muted', style: 'margin-top:4px' }, `지금까지 ${P.drawn.length}명 뽑힘 · 남은 학생 ${pool.length}명`) : null),
    absentEditor(rd)];
}
function teamCfg(rd) {
  const Tm = D.team, N = present().length;
  Tm.n = Math.max(2, Math.min(Tm.n, Math.max(2, N)));
  const per = N / Tm.n;
  return [
    h('div', { class: 'field' }, h('label', null, '팀 수'),
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, stepper(Tm.n, 2, Math.max(2, N), (v) => { Tm.n = v; rd(); }),
        h('span', { class: 'muted' }, `${N}명 · 팀당 ${Math.floor(per) === Math.ceil(per) ? per : `${Math.floor(per)}~${Math.ceil(per)}`}명`))),
    h('div', { class: 'field' }, h('label', null, '성별'), radios('tm', Tm.mode, [['none', '성별 고려 안 함'], ['equal', '성비 동등하게'], ['sep', '남녀 따로']], (v) => { Tm.mode = v; rd(); }),
      h('div', { class: 'muted', style: 'margin-top:4px' }, { none: '성별과 상관없이 섞어요.', equal: '모든 팀의 남녀 수가 최대한 비슷하도록 나눠요.', sep: '남자끼리, 여자끼리 팀을 만들어요. (팀 수는 남녀 인원 비율대로 나눠요)' }[Tm.mode])),
    avoidEditor('teamAvoid', rd, '같은 팀에 넣지 않을 두 학생을 정해요. 가장 먼저 지키지만, 다른 조건과 함께 도저히 안 되면 일부는 무시될 수 있어요.'),
    absentEditor(rd)];
}
function maniCfg(rd) {
  const M = D.mani;
  return [
    h('div', { class: 'muted', style: 'margin-bottom:12px' }, '모든 학생에게 자기 자신을 뺀 다른 친구가 한 명씩, 겹치지 않게 정해져요.'),
    h('div', { class: 'field' }, h('label', null, '성별'), radios('mm', M.mode, [['mix', '성별 무시'], ['sep', '성별 따로']], (v) => { M.mode = v; rd(); }),
      h('div', { class: 'muted', style: 'margin-top:4px' }, M.mode === 'mix' ? '남녀 상관없이 매칭해요.' : '남자는 남자끼리, 여자는 여자끼리만 매칭해요.')),
    avoidEditor('maniAvoid', rd, '서로 마니또가 되지 않게 할 두 학생을 정해요. 가장 먼저 지키지만, 도저히 안 되면 일부는 무시될 수 있어요.')];
}
/* 제목 옆 설정(⚙) → 지금 탭의 조건 */
function openCfg(redraw) {
  const title = { pick: '뽑기 조건', team: '팀 구성 조건', mani: '마니또 조건' }[D.sub];
  const body = h('div', { class: 'draw-cfg' });
  const rd = () => body.replaceChildren(...(D.sub === 'pick' ? pickCfg(rd) : D.sub === 'team' ? teamCfg(rd) : maniCfg(rd)), h('div', { class: 'field' }, soundBox()));
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc); redraw(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const ov = h('div', { class: 'overlay' }, h('div', { class: 'modal draw-modal' },
    h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:12px' }, h('h3', { style: 'margin:0' }, title), h('button', { class: 'primary', onclick: close }, '확인')), body));
  ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
  document.addEventListener('keydown', esc);
  rd(); document.body.append(ov);
}
function viewPick(redraw) {
  const P = D.pick, pool = pickPool();
  const go = () => { actx(); P.go = true; redraw(); };
  const reset = () => { if (!P.drawn.length && !P.last) return toast('지울 이력이 없어요'); if (!confirm(`지금까지 뽑힌 ${P.drawn.length}명의 이력을 지우고 처음부터 뽑을까요?`)) return; P.drawn = []; P.last = null; saveDrawn(); toast('이력을 지웠어요'); redraw(); };
  const gName = { all: '전체', m: '남자만', f: '여자만' }[P.g];
  const n = Math.max(1, Math.min(P.n, pool.length));
  if (P.go) { P.go = false; if (pool.length) return pickRun(redraw, go, reset); }
  const btn = h('button', { class: 'primary', disabled: !pool.length, onclick: go }, pool.length ? (P.last ? '다음 뽑기' : '뽑기') : '남은 학생 없음');
  const info = [`${n}명 · ${gName}`, D.absent.size ? `결석 ${D.absent.size}명` : null, P.noRepeat ? `남은 학생 ${pool.length}명` : null];
  const rst = P.noRepeat ? h('button', { onclick: reset, title: '이미 뽑힌 학생 이력을 지워요' }, '초기화') : null;
  const stage = h('div', { class: 'draw-stage' });
  if (P.last && P.last.length) {
    const grid = h('div', { class: 'slot-grid' });
    P.last.forEach((num) => { const st = stu(num); grid.append(h('div', { class: 'slot landed ' + gcls(st ? st.gender : '') }, h('span', null, st ? st.name : num + '번'))); });
    stage.append(stageHead(h('div', { class: 'draw-title' }, '지난 결과'), info, [btn, rst]), grid);
    layoutSlots(stage, grid, P.last.length, P.last.map((x) => nm(x)));
  } else stage.append(stageHead(h('div', { class: 'draw-title' }, ''), info, [rst]), h('div', { class: 'draw-ready' }, pool.length ? h('button', { class: 'primary big', onclick: go }, '뽑기 시작') : h('div', { class: 'muted' }, '뽑을 학생이 없어요. 초기화하거나 설정에서 조건을 바꿔 보세요.')));
  return stage;
}
/* 결과창 머리: 왼쪽 정보 · 가운데 제목 · 오른쪽 버튼 */
function stageHead(title, info, btns) {
  return h('div', { class: 'stage-head' },
    h('div', { class: 'sh-info' }, ...info.filter(Boolean).map((t) => h('span', null, t))),
    title,
    h('div', { class: 'sh-btns' }, ...btns.filter(Boolean)));
}
function layoutSlots(stage, grid, n, names) {
  const L = maxLen(names);
  relayout = () => {
    if (!alive(stage)) return;
    const box = stretch(stage, grid), gap = 14; let f;
    if (box) { const b = fitCells(n, box.W, box.H, gap, (cw, ch) => Math.min(ch * 0.42, cw / (L + 0.8), 240)); grid.style.gridTemplateColumns = `repeat(${b.c}, 1fr)`; grid.style.gridTemplateRows = `repeat(${b.r}, 1fr)`; f = b.f; }
    else { const c = Math.min(n, innerWidth < 500 ? 2 : 3), ch = n === 1 ? 180 : 100; grid.style.gridTemplateColumns = `repeat(${c}, 1fr)`; grid.style.gridTemplateRows = `repeat(${Math.ceil(n / c)}, ${ch}px)`; f = Math.min(ch * 0.42, (grid.clientWidth / c) / (L + 0.8)); }
    grid.style.setProperty('--fs', Math.max(14, Math.floor(f)) + 'px');
  };
  setTimeout(relayout, 30);
}
function pickRun(redraw, go, reset) {
  const P = D.pick, pool = pickPool(), n = Math.min(P.n, pool.length);
  const result = shuffle(pool).slice(0, n);
  if (P.noRepeat) { result.forEach((s) => P.drawn.push(s.num)); saveDrawn(); }
  P.last = result.map((s) => s.num);
  const gName = { all: '전체', m: '남자만', f: '여자만' }[P.g];
  const stage = h('div', { class: 'draw-stage' });
  const title = h('div', { class: 'draw-title' }, '두근두근…');
  const grid = h('div', { class: 'slot-grid' });
  const slots = result.map(() => { const el = h('div', { class: 'slot spin' }, h('span', null, '?')); grid.append(el); return el; });
  const remain = pool.length - (P.noRepeat ? n : 0);
  const again = h('button', { class: 'primary', disabled: true, onclick: go }, remain ? '다음 뽑기' : '남은 학생 없음');
  const L = maxLen(pool.map((x) => x.name));
  relayout = () => {
    if (!alive(stage)) return;
    const box = stretch(stage, grid), gap = 14;
    let f;
    if (box) {
      const b = fitCells(n, box.W, box.H, gap, (cw, ch) => Math.min(ch * 0.42, cw / (L + 0.8), 240));
      grid.style.gridTemplateColumns = `repeat(${b.c}, 1fr)`; grid.style.gridTemplateRows = `repeat(${b.r}, 1fr)`; f = b.f;
    } else {
      const c = Math.min(n, innerWidth < 500 ? 2 : 3), ch = n === 1 ? 180 : 100;
      grid.style.gridTemplateColumns = `repeat(${c}, 1fr)`; grid.style.gridTemplateRows = `repeat(${Math.ceil(n / c)}, ${ch}px)`;
      f = Math.min(ch * 0.42, (grid.clientWidth / c) / (L + 0.8));
    }
    grid.style.setProperty('--fs', Math.max(14, Math.floor(f)) + 'px');
  };
  stage.append(stageHead(title, [`${n}명 · ${gName}`, D.absent.size ? `결석 ${D.absent.size}명` : null, P.noRepeat ? `남은 학생 ${remain}명` : null],
    [again, P.noRepeat ? h('button', { onclick: reset, title: '이미 뽑힌 학생 이력을 지워요' }, '초기화') : null]), grid);
  // 애니메이션
  (async () => {
    await wait(30); relayout();
    const gap = Math.min(650, 3000 / n), base = 1800, total = base + gap * (n - 1);
    SND.roll(total / 1000 + 0.2);
    const t0 = performance.now();
    slots.forEach((el, i) => {
      const land = base + gap * i, sp = el.firstChild;
      const spin = () => {
        if (!alive(el)) return;
        const t = performance.now() - t0;
        if (t >= land) {
          const s = result[i]; sp.textContent = s.name; el.className = 'slot landed ' + gcls(s.gender); el.title = `${s.num}번`; SND.pop();
          if (i === n - 1) setTimeout(() => { if (!alive(el)) return; title.textContent = '🎉 축하해요! 🎉'; stage.classList.add('done'); SND.fanfare(); confetti(); again.disabled = !remain; }, 250);
          return;
        }
        sp.textContent = pickOne(pool).name; if (i === Math.min(n - 1, Math.floor(t / land * n))) SND.tick();
        const left = land - t; setTimeout(spin, left < 700 ? 60 + (700 - left) * 0.35 : 55);
      };
      spin();
    });
  })();
  return stage;
}

/* =====================================================
   2. 팀 구성
   ===================================================== */
function makeTeams(T, mode, avoid) {
  const all = shuffle(present()), N = all.length;
  const boys = all.filter((s) => s.gender === '남'), girls = all.filter((s) => s.gender === '여'), etc = all.filter((s) => s.gender !== '남' && s.gender !== '여');
  let sep = mode === 'sep' && boys.length && girls.length;
  let note = '';
  if (mode === 'sep' && !sep) note = '한 성별만 있어서 성별을 나누지 않고 구성했어요.';
  const build = () => {
    const teams = Array.from({ length: T }, () => []);
    if (sep) {
      // 남자 팀 수: 남녀 팀 인원이 가장 비슷해지도록
      let Tb = 1, bs = Infinity;
      for (let k = 1; k < T; k++) { if (k > boys.length || T - k > girls.length) continue; const sc = Math.abs(boys.length / k - girls.length / (T - k)); if (sc < bs - 1e-9) { bs = sc; Tb = k; } }
      const Tg = T - Tb;
      const order = (k, off) => shuffle(Array.from({ length: k }, (_, i) => i + off));
      const ob = order(Tb, 0), og = order(Tg, Tb);
      shuffle(boys).forEach((s, i) => teams[ob[i % Tb]].push(s));
      shuffle(girls).forEach((s, i) => teams[og[i % Tg]].push(s));
      etc.forEach((s) => teams.slice().sort((a, b) => a.length - b.length)[0].push(s));
      teams.forEach((t, i) => { t.kind = i < Tb ? '남' : '여'; });
    } else if (mode === 'equal') {
      const ord = shuffle(Array.from({ length: T }, (_, i) => i)); let k = 0;
      [...shuffle(boys), ...shuffle(girls), ...shuffle(etc)].forEach((s) => { teams[ord[k % T]].push(s); k++; });
    } else {
      const ord = shuffle(Array.from({ length: T }, (_, i) => i));
      shuffle(all).forEach((s, i) => teams[ord[i % T]].push(s));
    }
    return teams;
  };
  const same = (a, b) => (mode === 'none' && !sep) || a.gender === b.gender || (a.gender !== '남' && a.gender !== '여' && b.gender !== '남' && b.gender !== '여');
  const avSet = new Set(avoid.map(([a, b]) => a + '-' + b).concat(avoid.map(([a, b]) => b + '-' + a)));
  const bad = (teams) => { const v = []; teams.forEach((t) => { for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) if (avSet.has(t[i].num + '-' + t[j].num)) v.push([t[i].num, t[j].num]); }); return v; };
  let best = null, bestV = null;
  for (let r = 0; r < 40; r++) {
    const teams = build(); let v = bad(teams);
    for (let it = 0; it < 3000 && v.length; it++) {
      const [x] = pickOne(v), ti = teams.findIndex((t) => t.some((s) => s.num === x)), si = teams[ti].findIndex((s) => s.num === x);
      const tj = Math.floor(Math.random() * T); if (tj === ti || !teams[tj].length) continue;
      const sj = Math.floor(Math.random() * teams[tj].length);
      if (!same(teams[ti][si], teams[tj][sj])) continue;
      [teams[ti][si], teams[tj][sj]] = [teams[tj][sj], teams[ti][si]];
      const nv = bad(teams);
      if (nv.length <= v.length) v = nv; else [teams[ti][si], teams[tj][sj]] = [teams[tj][sj], teams[ti][si]];
    }
    if (!best || v.length < bestV.length) { best = teams; bestV = v; }
    if (!v.length) break;
  }
  best.forEach((t) => t.sort((a, b) => a.num - b.num));
  return { teams: best, broken: bestV, note };
}
function viewTeam(redraw) {
  const Tm = D.team, N = present().length;
  Tm.n = Math.max(2, Math.min(Tm.n, Math.max(2, N)));
  const go = () => { actx(); Tm.go = true; redraw(); };
  if (Tm.go) { Tm.go = false; if (N >= 2) return teamRun(redraw, go); }
  const mname = { none: '성별 고려 안 함', equal: '성비 동등하게', sep: '남녀 따로' }[Tm.mode];
  const info = [`${Tm.n}팀 · ${mname}`, D.absent.size ? `결석 ${D.absent.size}명` : null];
  const stage = h('div', { class: 'draw-stage team' });
  if (Tm.last) { stage.append(stageHead(h('div', { class: 'draw-title' }, '지난 결과'), info, [h('button', { class: 'primary', disabled: N < 2, onclick: go }, '다시 구성')])); const g = teamGrid(Tm.last.teams, true); stage.append(g.grid); layoutTeams(stage, g.grid, Tm.last.teams, null); }
  else stage.append(stageHead(h('div', { class: 'draw-title' }, ''), info, []), h('div', { class: 'draw-ready' }, N >= 2 ? h('button', { class: 'primary big', onclick: go }, '팀 구성 시작') : h('div', { class: 'muted' }, '학생이 2명 이상 있어야 해요.')));
  return stage;
}
function teamGrid(teams, landed) {
  const grid = h('div', { class: 'team-grid' }), cells = [];
  teams.forEach((t, i) => {
    const mc = t.filter((s) => s.gender === '남').length, fc = t.filter((s) => s.gender === '여').length;
    grid.append(h('div', { class: 'team-card ' + (landed ? 'landed' : 'spin') },
      h('div', { class: 'team-head' }, h('b', { class: 'team-no' }, `${i + 1}팀`), h('span', { class: 'team-meta' }, `${t.length}명 · 남${mc} 여${fc}`)),
      h('div', { class: 'team-mem' }, t.map((s) => { const el = h('span', { class: 'mem' + (landed ? ' ' + gcls(s.gender) : '') }, landed ? s.name : '?'); cells.push({ el, s }); return el; }))));
  });
  return { grid, cells };
}
function layoutTeams(stage, grid, teams, note) {
  const T = teams.length, M = Math.max(1, ...teams.map((t) => t.length)), L = maxLen(roster().map((x) => x.name));
  relayout = () => {
    if (!alive(stage)) return;
    const box = stretch(stage, grid), gap = 14;
    const inner = (cw, ch) => {
      const head = Math.min(56, Math.max(30, ch * 0.16)), mw = cw - 24, mh = ch - head - 24;
      let bestM = { mc: 1, f: 0 };
      for (let mc = 1; mc <= M; mc++) { const mr = Math.ceil(M / mc), w = (mw - 6 * (mc - 1)) / mc, hh = (mh - 6 * (mr - 1)) / mr; if (w <= 0 || hh <= 0) continue; const f = Math.min(hh * 0.5, w / (L + 1), 64); if (f > bestM.f + 0.01) bestM = { mc, f, head }; }
      return bestM;
    };
    if (box) {
      const b = fitCells(T, box.W, box.H - ((note && note.offsetHeight) || 0), gap, (cw, ch) => inner(cw, ch).f);
      const m = inner(b.cw, b.ch);
      grid.style.gridTemplateColumns = `repeat(${b.c}, 1fr)`; grid.style.gridTemplateRows = `repeat(${b.r}, 1fr)`;
      grid.style.setProperty('--mc', m.mc); grid.style.setProperty('--mr', Math.ceil(M / m.mc)); grid.style.setProperty('--fs', Math.max(13, Math.floor(m.f)) + 'px'); grid.style.setProperty('--hd', Math.floor(m.head * 0.55) + 'px');
    } else {
      grid.style.gridTemplateColumns = ''; grid.style.gridTemplateRows = ''; grid.style.setProperty('--mc', 2); grid.style.setProperty('--fs', '17px'); grid.style.setProperty('--hd', '20px');
    }
  };
  setTimeout(relayout, 30);
}
function teamRun(redraw, go) {
  const Tm = D.team, res = makeTeams(Tm.n, Tm.mode, D.cfg.teamAvoid), all = present();
  Tm.last = res;
  const stage = h('div', { class: 'draw-stage team' });
  const title = h('div', { class: 'draw-title' }, '팀을 섞는 중…');
  const { grid, cells } = teamGrid(res.teams, false);
  const again = h('button', { class: 'primary', disabled: true, onclick: go }, '다시 구성');
  const note = h('div');
  const mname = { none: '성별 고려 안 함', equal: '성비 동등하게', sep: '남녀 따로' }[Tm.mode];
  stage.append(stageHead(title, [`${Tm.n}팀 · ${mname}`, D.absent.size ? `결석 ${D.absent.size}명` : null], [again]), grid, note);
  layoutTeams(stage, grid, res.teams, note);
  (async () => {
    await wait(30); relayout();
    const dur = 2600; SND.roll(dur / 1000); const t0 = performance.now();
    const spin = () => {
      if (!alive(grid)) return;
      const t = performance.now() - t0;
      if (t >= dur) {
        cells.forEach(({ el, s }) => { el.textContent = s.name; el.className = 'mem ' + gcls(s.gender); el.title = `${s.num}번`; });
        grid.querySelectorAll('.team-card').forEach((c) => c.classList.replace('spin', 'landed'));
        title.textContent = '🎉 팀 완성! 🎉'; stage.classList.add('done'); SND.fanfare(); confetti(); again.disabled = false;
        const msgs = [];
        if (res.note) msgs.push(res.note);
        if (res.broken.length) msgs.push(`기피 설정을 모두 지킬 수 없어 일부를 무시했어요: ${res.broken.map(([a, b]) => `${nm(a)}↔${nm(b)}`).join(', ')}`);
        if (msgs.length) { note.replaceChildren(h('div', { class: 'banner warn', style: 'margin:12px 0 0' }, msgs.join(' '))); relayout(); }
        return;
      }
      cells.forEach(({ el }) => { el.textContent = pickOne(all).name; });
      SND.tick();
      setTimeout(spin, t > dur - 700 ? 70 + (t - (dur - 700)) * 0.25 : 60);
    };
    spin();
  })();
  return stage;
}

/* =====================================================
   3. 마니또
   ===================================================== */
function makeManito(mode, avoid, hist) {
  const all = roster();
  let groups, note = '';
  if (mode === 'sep') {
    const b = all.filter((s) => s.gender === '남'), g = all.filter((s) => s.gender === '여'), e = all.filter((s) => s.gender !== '남' && s.gender !== '여');
    groups = [b, g].filter((x) => x.length);
    if (e.length) { (groups.sort((x, y) => x.length - y.length)[0] || (groups[0] = [])).push(...e); }
    const lone = groups.filter((x) => x.length === 1);
    if (lone.length) { const big = groups.filter((x) => x.length > 1).sort((x, y) => y.length - x.length)[0]; if (big) { lone.forEach((x) => big.push(...x)); groups = groups.filter((x) => x.length > 1); note = '한 명뿐인 성별이 있어서 그 학생은 다른 성별과 매칭했어요.'; } }
  } else groups = [all];
  const avSet = new Set(avoid.flatMap(([a, b]) => [a + '-' + b, b + '-' + a]));
  // 지난 마니또: 최근일수록 무겁게
  const past = new Map();
  hist.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created).forEach((r, k) => {
    const w = Math.max(20, 100 * Math.pow(0.85, k));
    Object.entries(r.pairs || {}).forEach(([g, t]) => { const key = g + '>' + t; past.set(key, (past.get(key) || 0) + w); });
  });
  const pairs = {}; let broken = [], repeats = 0;
  groups.forEach((grp) => {
    const m = grp.length; if (m < 2) return;
    const ids = grp.map((s) => s.num);
    const c1 = (i, t) => (avSet.has(ids[i] + '-' + ids[t]) ? 100000 : 0) + (past.get(ids[i] + '>' + ids[t]) || 0) + (past.get(ids[t] + '>' + ids[i]) || 0) * 0.3;
    const cost = (p) => { let c = 0; for (let i = 0; i < m; i++) { c += c1(i, p[i]); if (m > 2 && p[p[i]] === i) c += 5; } return c; };
    let best = null, bc = Infinity;
    for (let r = 0; r < 25; r++) {
      // 사톨로 알고리즘: 한 바퀴로 이어진 무작위 순열 (자기 자신 없음)
      const p = Array.from({ length: m }, (_, i) => i), ord = shuffle(p.slice());
      for (let i = m - 1; i > 0; i--) { const j = Math.floor(Math.random() * i); [ord[i], ord[j]] = [ord[j], ord[i]]; }
      for (let i = 0; i < m; i++) p[ord[i]] = ord[(i + 1) % m];
      let c = cost(p);
      for (let it = 0; it < 3000 && c > 0; it++) {
        const i = Math.floor(Math.random() * m), j = Math.floor(Math.random() * m);
        if (i === j || p[j] === i || p[i] === j) continue;
        [p[i], p[j]] = [p[j], p[i]];
        const nc = cost(p);
        if (nc <= c) c = nc; else [p[i], p[j]] = [p[j], p[i]];
      }
      if (c < bc) { bc = c; best = p.slice(); }
      if (bc === 0) break;
    }
    best.forEach((t, i) => {
      pairs[ids[i]] = ids[t];
      if (avSet.has(ids[i] + '-' + ids[t])) broken.push([ids[i], ids[t]]);
      if (past.has(ids[i] + '>' + ids[t])) repeats++;
    });
  });
  return { pairs, broken, repeats, note };
}
function viewMani(redraw) {
  const M = D.mani;
  if (D.step.mani === 'run' && M.res) return maniRun(redraw);
  const hist = D.hist.slice().sort((a, b) => b.created - a.created);
  return h('div', null, h('div', { class: 'card draw-cfg' },
    h('div', { class: 'row draw-bar' }, h('b', null, '마니또 · ' + (M.mode === 'mix' ? '성별 무시' : '성별 따로')), D.cfg.maniAvoid.length ? h('span', { class: 'muted' }, `기피 ${D.cfg.maniAvoid.length}쌍`) : null),
    h('div', { class: 'muted', style: 'margin-top:8px' }, hist.length ? `저장된 마니또 ${hist.length}회를 보고, 예전과 같은 마니또가 최대한 나오지 않게 뽑아요.` : '마니또를 저장해 두면, 다음에 뽑을 때 같은 마니또가 최대한 나오지 않게 해요.'),
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' },
      h('button', { class: 'primary big', onclick: () => {
        const r = makeManito(M.mode, D.cfg.maniAvoid, D.hist);
        M.res = { ...r, seen: [], name: '', id: null, mode: M.mode }; D.step.mani = 'run'; redraw();
      } }, '마니또 뽑기'))),
  hist.length ? h('div', { class: 'card' }, h('h3', null, '저장한 마니또'),
    hist.map((r) => h('div', { class: 'list-item' }, h('span', null, h('b', null, r.name), h('span', { class: 'muted' }, `  ${r.date || ''} · ${Object.keys(r.pairs || {}).length}명`)),
      h('span', { class: 'row', style: 'gap:6px' },
        h('button', { class: 'sm', onclick: () => { M.res = { pairs: r.pairs, broken: [], repeats: 0, note: '', seen: [], name: r.name, id: r.id, saved: true }; D.step.mani = 'run'; redraw(); } }, '열기'),
        h('button', { class: 'sm ghost', onclick: async () => {
          if (!confirm(`"${r.name}"을(를) 삭제할까요?`)) return;
          D.hist = D.hist.filter((x) => x.id !== r.id);
          try { await APP.kvSet('draw:manito', D.hist); } catch (e) { toast(errMsg(e), true); }
          redraw();
        } }, '삭제'))))) : null);
}
function askName(title, def) {
  return new Promise((resolve) => {
    const input = h('input', { value: def, style: 'width:100%;margin:12px 0 8px' });
    const close = (v) => { ov.remove(); resolve(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value.trim()); if (e.key === 'Escape') close(null); });
    const ov = h('div', { class: 'overlay' }, h('div', { class: 'modal' }, h('h3', null, title), input,
      h('div', { class: 'row' }, h('button', { onclick: () => close(null) }, '취소'), h('button', { class: 'primary', onclick: () => close(input.value.trim()) }, '확인'))));
    document.body.append(ov); input.focus(); input.select();
  });
}
function maniRun(redraw) {
  const R = D.mani.res, all = roster().filter((s) => R.pairs[s.num] != null);
  const save = async () => {
    const def = R.name || `마니또 ${new Date().getMonth() + 1}월`;
    const name = await askName('이번 마니또 저장 (이름)', def); if (!name) return;
    const dup = D.hist.find((x) => x.name === name && x.id !== R.id);
    if (dup && !confirm(`"${name}"이(가) 이미 있어요. 덮어쓸까요?`)) return;
    const rec = { id: R.id || (dup && dup.id) || 'm' + Date.now().toString(36), name, date: APP.today(), created: Date.now(), pairs: R.pairs, names: Object.fromEntries(all.map((s) => [s.num, s.name])) };
    D.hist = D.hist.filter((x) => x.id !== rec.id && x.name !== name).concat(rec);
    try { await APP.kvSet('draw:manito', D.hist); R.id = rec.id; R.name = name; R.saved = true; toast(`"${name}"으로 저장했어요`); redraw(); } catch (e) { toast(errMsg(e), true); }
  };
  const docName = () => R.name || `마니또 ${new Date().getMonth() + 1}월`;
  const rows = () => all.map((s) => ({ me: s.name, to: nm(R.pairs[s.num]) }));
  const bar = h('div', { class: 'row draw-bar', style: 'flex-wrap:wrap' },
    h('b', null, R.name ? R.name : '이번 마니또'), R.saved ? h('span', { class: 'chip-s' }, '저장됨') : h('span', { class: 'muted' }, '아직 저장 안 됨'),
    h('div', { style: 'flex:1' }),
    h('button', { class: 'primary', onclick: save }, '저장하기'),
    h('button', { onclick: () => APP.maniDoc.hwpx(docName(), rows()) }, '한글 파일(.hwpx)'),
    h('button', { onclick: () => APP.maniDoc.docx(docName(), rows()) }, '워드 파일(.docx)'),
    h('button', { onclick: () => APP.maniDoc.print(docName(), rows()) }, '인쇄'),
    R.saved ? null : h('button', { onclick: () => { if (!confirm('지금 결과를 버리고 다시 뽑을까요?')) return; const r = makeManito(D.mani.mode, D.cfg.maniAvoid, D.hist); D.mani.res = { ...r, seen: [], name: '', id: null }; redraw(); } }, '다시 뽑기'),
    h('button', { onclick: () => { if (!R.saved && !confirm('저장하지 않은 결과가 사라져요. 처음 화면으로 갈까요?')) return; D.step.mani = 'cfg'; D.mani.res = null; redraw(); } }, '처음 화면으로'));
  const msgs = [];
  if (R.note) msgs.push(R.note);
  if (R.broken && R.broken.length) msgs.push(`기피 설정을 모두 지킬 수 없어 ${R.broken.length}쌍은 무시했어요.`);
  if (R.repeats) msgs.push(`예전 마니또와 겹친 학생이 ${R.repeats}명 있어요. (모두 피할 수 없었어요)`);
  const grid = h('div', { class: 'mani-grid' });
  const seen = new Set(R.seen), L = maxLen(all.map((x) => x.name));
  relayout = () => {
    if (!alive(grid)) return;
    if (!isDesk()) { grid.style.cssText = ''; return; }
    const top = grid.getBoundingClientRect().top, H = Math.max(300, innerHeight - top - 16), W = grid.clientWidth;
    const b = fitCells(all.length, W, H, 10, (cw, ch) => Math.min(ch * 0.36, cw / (L + 1), 72));
    grid.style.cssText = `height:${H}px;grid-template-columns:repeat(${b.c},1fr);grid-template-rows:repeat(${b.r},1fr);--fs:${Math.max(14, Math.floor(b.f))}px`;
    const over = document.documentElement.scrollHeight - innerHeight;
    if (over > 0) grid.style.height = Math.max(300, H - over) + 'px';
  };
  setTimeout(relayout, 30);
  all.forEach((s) => {
    const card = h('button', { class: 'mani-card ' + gcls(s.gender) + (seen.has(s.num) ? ' seen' : ''), onclick: () => reveal(card, s) }, h('span', { class: 'mn' }, s.num), h('b', null, s.name));
    grid.append(card);
  });
  function reveal(card, s) {
    const r = card.getBoundingClientRect();
    const fc = h('div', { class: 'flip-card' }, h('div', { class: 'flip-inner' },
      h('div', { class: 'flip-face front' }, h('b', null, s.name)),
      h('div', { class: 'flip-face back' }, h('div', { class: 'fl-me' }, s.name), h('div', { class: 'fl-sub' }, '의 마니또는'), h('div', { class: 'fl-to' }, nm(R.pairs[s.num])))));
    const ov = h('div', { class: 'flip-ov', onclick: () => { ov.classList.add('out'); setTimeout(() => ov.remove(), 250); } }, fc, h('div', { class: 'flip-hint' }, '화면을 누르면 닫혀요'));
    document.body.append(ov);
    const tw = Math.min(innerWidth * 0.86, 520), th = Math.min(innerHeight * 0.6, 340);
    fc.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    requestAnimationFrame(() => requestAnimationFrame(() => { fc.style.cssText = `left:${(innerWidth - tw) / 2}px;top:${(innerHeight - th) / 2}px;width:${tw}px;height:${th}px`; fc.classList.add('open'); }));
    seen.add(s.num); R.seen = [...seen]; card.classList.add('seen');
  }
  return h('div', null, h('div', { class: 'card' }, bar,
    msgs.length ? h('div', { class: 'banner warn', style: 'margin:10px 0 0' }, msgs.join(' ')) : null,
    h('div', { class: 'muted', style: 'margin-top:8px' }, '이름을 누르면 그 학생의 마니또가 나와요. 한 번 본 이름은 회색으로 바뀌어요.')),
  grid);
}
})();
