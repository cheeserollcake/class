/* 학급관리 사이트 — 1단계: 로그인 / 학급 기초설정 / 제출확인 */
(() => {
'use strict';
const CFG = window.APP_CONFIG || {};
const DEMO = new URLSearchParams(location.search).has('demo');   // 주소 뒤에 ?demo 를 붙였을 때만 체험(데모) 모드
const $ = (s, el = document) => el.querySelector(s);
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---------- DOM 도우미 ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
  if (value !== undefined) el.value = value;
  return el;
}
let toastTimer;
function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), isErr ? 4000 : 2200);
}
const ERR = {
  AUTH: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  FORBIDDEN: '이 계정은 사용할 수 없습니다.',
  NOCONFIG: '구글 로그인 설정(클라이언트 ID)이 아직 없어요.',
  GIS: '구글 로그인 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.',
  NOSCOPE: '구글 드라이브 접근을 허용해야 저장할 수 있어요. 로그인 창에서 모든 항목을 체크해 주세요.',
  popup_closed: '로그인 창이 닫혔어요. 다시 눌러 주세요.',
  popup_failed_to_open: '팝업이 막혔어요. 주소창 옆 팝업 차단을 풀고 다시 눌러 주세요.',
  access_denied: '로그인이 허용되지 않았어요. (구글 클라우드의 "테스트 사용자"에 이 계정이 없을 수 있어요)',
  APIOFF: '구글 클라우드에서 "Google Sheets API"와 "Google Drive API"를 사용 설정해 주세요. (설정방법.md 1단계)',
  NOTFOUND: '구글 드라이브에서 파일을 찾지 못했어요.',
  DENIED: '구글이 접근을 허용하지 않았어요. 다시 로그인해 보세요.',
  TOOBIG: '파일이나 내용이 너무 커서 저장할 수 없어요.',
  PW: '비밀번호가 맞지 않습니다.',
  LOCKED: '5번 틀려서 5분간 잠겼습니다. 잠시 후 다시 시도하세요.',
  SHORT: '비밀번호는 6자 이상이어야 합니다.',
  BAD: '저장할 수 없는 데이터입니다.'
};
const errMsg = (e) => ERR[e.message] || ('오류: ' + e.message);

/* ---------- 상태 ---------- */
const defaultSeat = () => ({ cols: 6, rows: 5, cells: Array(30).fill(1), gw: 2, gh: 1, colNames: [], mode: 'mixed', teams: [], teamBalance: false, fixed: [], avoid: [], noRepeat: 0 });
const normSeat = (x) => { const o = Object.assign(defaultSeat(), x || {}); if (o.mode === 'balanced') { o.mode = 'mixed'; o.teamBalance = true; } if (!['mixed', 'same', 'random'].includes(o.mode)) o.mode = 'mixed'; if (!Array.isArray(o.teams)) o.teams = []; return o; };
const S = {
  token: null, email: '', unlocked: false, pw: '', defaultPw: true,
  roster: [], seat: defaultSeat(), boards: [],
  tab: 'submit', setupSub: 'roster',
  rosterDraft: null, rosterDirty: false, showPaste: false, showUpload: false,
  seatDraft: null, seatUi: { editMode: 'move', sel: null, pick: null },
  curBoard: null, saveText: ''
};
const TABS = [
  { id: 'setup', name: '학급 기초설정', pw: true },
  { id: 'student', name: '학생 관리', pw: true },
  { id: 'grade', name: '성적 관리', pw: true },
  { id: 'seat', name: '자리 관리' },
  { id: 'role', name: '역할 관리' },
  { id: 'submit', name: '제출확인' }
];

/* ---------- API (서버 / 데모) ---------- */
let loginResolve = null;
async function api(action, data = {}) {
  if (DEMO) return demoApi(action, { pw: S.pw, ...data });
  for (let i = 0; i < 2; i++) {
    try { return await APP.google.api(action, { pw: S.pw, ...data }); }
    catch (e) { if (e.message === 'AUTH' && i === 0) { await relogin(); continue; } throw e; }
  }
  throw new Error('AUTH');
}
function demoApi(action, d) {
  const db = JSON.parse(localStorage.getItem('demo_db') || 'null') || { pw: '000000', roster: demoRoster(), seat: null, boards: [], defaultPw: true };
  db.kv = db.kv || {}; db.logs = db.logs || []; db.files = db.files || {};
  const prot = (k) => !k || k.indexOf('grade:') === 0 || k.indexOf('survey:') === 0;
  const save = () => localStorage.setItem('demo_db', JSON.stringify(db));
  const pub = (r) => r.map((x) => ({ num: x.num, name: x.name, gender: x.gender }));
  const chk = () => { if (d.pw !== db.pw) throw new Error('PW'); };
  return new Promise((resolve, reject) => setTimeout(() => {
    try {
      let out = { ok: true };
      if (action === 'load') { if (d.pw) chk(); out = { ok: true, email: 'demo', roster: d.pw ? db.roster : pub(db.roster), seat: db.seat, boards: db.boards, defaultPw: db.defaultPw }; }
      else if (action === 'unlock') { chk(); out = { ok: true, roster: db.roster, defaultPw: db.defaultPw }; }
      else if (action === 'saveRoster') { chk(); db.roster = d.rows; }
      else if (action === 'saveSeat') { chk(); db.seat = d.seat; }
      else if (action === 'changePw') { chk(); if (String(d.newPw).length < 6) throw new Error('SHORT'); db.pw = d.newPw; db.defaultPw = false; }
      else if (action === 'saveBoard') { const i = db.boards.findIndex((b) => b.id === d.board.id); if (i >= 0) db.boards[i] = d.board; else db.boards.push(d.board); }
      else if (action === 'deleteBoard') db.boards = db.boards.filter((b) => b.id !== d.id);
      else if (action === 'kvGet') { if (d.keys.some(prot)) chk(); out = { ok: true, values: Object.fromEntries(d.keys.map((k) => [k, db.kv[k] == null ? null : db.kv[k].v])) }; }
      else if (action === 'kvList') { if (prot(d.prefix)) chk(); out = { ok: true, keys: Object.keys(db.kv).filter((k) => k.startsWith(d.prefix)).map((k) => ({ key: k, updated: db.kv[k].t })) }; }
      else if (action === 'kvSet') { if (prot(d.key)) chk(); if (String(d.value).length > 45000) throw new Error('TOOBIG'); db.kv[d.key] = { v: d.value, t: Date.now() }; }
      else if (action === 'kvDel') { if (prot(d.key)) chk(); delete db.kv[d.key]; }
      else if (action === 'logsLoad') { chk(); out = { ok: true, logs: db.logs }; }
      else if (action === 'logSave') { chk(); const i = db.logs.findIndex((l) => l.id === d.log.id); if (i >= 0) db.logs[i] = d.log; else db.logs.push(d.log); }
      else if (action === 'logDel') { chk(); db.logs = db.logs.filter((l) => l.id !== d.id); }
      else if (action === 'writeTable') { chk(); }
      else if (action === 'uploadFile') { const id = 'f' + Date.now().toString(36); db.files[id] = { data: d.data, mime: d.mime, name: d.name }; out = { ok: true, fileId: id }; }
      else if (action === 'getFile') { const f = db.files[d.fileId]; if (!f) throw new Error('FORBIDDEN'); out = { ok: true, ...f }; }
      else if (action === 'delFile') delete db.files[d.fileId];
      save(); resolve(out);
    } catch (e) { reject(e); }
  }, 150));
}
function demoRoster() {
  const names = ['김민준', '이서연', '박지호', '최수아', '정하준', '강지우', '조예준', '윤서윤', '장도윤', '임하은', '한시우', '오지안', '서준서', '신유나', '권지후', '황소율', '안도현', '송채원', '류건우', '홍다은', '전이안', '문나윤', '배현우', '노아린'];
  return names.map((n, i) => ({ num: i + 1, name: n, gender: i % 2 ? '여' : '남', phone: '', birth: '', note: '', title: n.slice(1), b1: '', b2: '', b3: '' }));
}

/* ---------- 로그인 (구글 계정) ---------- */
function showLogin(msg) {
  const root = $('#app'); root.replaceChildren();
  const err = h('div', { class: 'err', style: 'min-height:20px;margin-top:10px' }, msg || '');
  const idIn = h('input', { placeholder: '클라이언트 ID  (…apps.googleusercontent.com)', style: 'width:100%;margin:8px 0' });
  const setup = h('div', { class: 'login-setup', hidden: true },
    h('div', { style: 'font-weight:700;margin-bottom:4px' }, '구글 로그인 설정이 아직 안 되어 있어요'),
    h('div', { class: 'muted', style: 'line-height:1.6' }, '설정방법.md 1단계에서 만든 "클라이언트 ID"를 아래에 붙여넣으면 바로 로그인할 수 있어요. (이 기기·브라우저에만 저장돼요. 모든 기기에서 쓰려면 config.js에 넣어 주세요.)'),
    idIn, h('button', { class: 'primary', onclick: () => { if (!/\.apps\.googleusercontent\.com$/.test(idIn.value.trim())) { err.textContent = '클라이언트 ID가 올바르지 않아요. ".apps.googleusercontent.com"으로 끝나야 해요.'; return; } APP.google.setClientId(idIn.value); setup.hidden = true; doLogin(); } }, '저장하고 로그인'));
  const loginBtn = h('button', { class: 'primary big', onclick: () => doLogin() }, '구글 계정으로 로그인하기');
  const demoBtn = h('button', { class: 'big', onclick: () => { location.href = location.pathname + '?demo'; } }, '로그인 없이 데모 체험하기');
  async function doLogin() {
    err.textContent = '';
    if (!APP.google.clientId()) { setup.hidden = false; return; }
    loginBtn.disabled = true; loginBtn.textContent = '로그인 중…';
    try { await APP.google.login(); S.token = 'ok'; startApp(); return; }
    catch (e) { err.textContent = errMsg(e); }
    loginBtn.disabled = false; loginBtn.textContent = '구글 계정으로 로그인하기';
  }
  root.append(h('div', { class: 'center-screen' }, h('div', { class: 'login-card' },
    h('h1', null, '학급관리'),
    h('p', null, '로그인한 구글 계정의 드라이브에 학급 정보가 저장돼요.'),
    h('div', { class: 'login-btns' }, loginBtn, demoBtn),
    err, setup,
    h('div', { class: 'muted', style: 'margin-top:14px;font-size:12px;line-height:1.6' }, '데모는 연습용이에요. 이 브라우저에만 임시로 저장되고 구글 계정과는 연결되지 않아요.'),
    h('div', { class: 'login-links' }, h('a', { href: 'about.html' }, '앱 소개'), h('a', { href: 'privacy.html' }, '개인정보처리방침'), h('a', { href: 'terms.html' }, '이용약관')))));
}
function relogin() {
  return new Promise((res) => {
    const err = h('div', { class: 'err', style: 'min-height:20px;margin-top:8px' });
    const btn = h('button', { class: 'primary big', onclick: async () => {
      btn.disabled = true; err.textContent = '';
      try { const r = await APP.google.login({ prompt: '', hint: S.email }); if (r.changed) return location.reload(); ov.remove(); res(); }
      catch (e) { err.textContent = errMsg(e); btn.disabled = false; }
    } }, '다시 로그인');
    const ov = h('div', { class: 'overlay', id: 'relogin' }, h('div', { class: 'login-card' }, h('h1', null, '학급관리'), h('p', null, '로그인 시간이 지났어요. 다시 로그인하면 하던 작업이 이어져요.'), btn, err));
    document.body.append(ov);
  });
}

/* 예전에 데모 모드로 저장해 둔 내용을 내 계정으로 가져오기 */
async function maybeImportDemo(j) {
  const raw = localStorage.getItem('demo_db'), flag = 'demo_import_' + j.email;
  if (!raw || localStorage.getItem(flag)) return false;
  let db; try { db = JSON.parse(raw); } catch (e) { return false; }
  const sample = new Set(demoRoster().map((x) => x.name));
  const meaningful = (db.roster || []).some((r) => !sample.has(r.name)) || Object.keys(db.kv || {}).length || (db.logs || []).length || (db.boards || []).length;
  if (!meaningful || (j.roster || []).length || (j.boards || []).length) return false;
  if (!confirm('이 브라우저에 데모 모드로 저장해 둔 학급 정보가 있어요.\n내 구글 계정으로 가져올까요?\n(데모에 있던 내용은 그대로 남아요)')) { localStorage.setItem(flag, 'no'); return false; }
  $('#app').replaceChildren(h('div', { class: 'center-screen' }, h('div', { class: 'muted' }, '데모 내용을 내 계정으로 옮기는 중… (잠시만 기다려 주세요)')));
  try { await APP.google.importDemo(db); localStorage.setItem(flag, 'yes'); return true; }
  catch (e) { toast(errMsg(e), true); return false; }
}

async function startApp() {
  const root = $('#app'); root.replaceChildren(h('div', { class: 'center-screen' }, h('div', { class: 'muted' }, '불러오는 중…')));
  try {
    const j = await api('load');
    if (!DEMO && await maybeImportDemo(j)) return startApp();
    S.email = j.email; S.roster = j.roster || []; S.seat = normSeat(j.seat); S.boards = j.boards || []; S.defaultPw = j.defaultPw;
    if (!S.curBoard && S.boards.length) S.curBoard = S.boards[0].id;
    renderShell();
  } catch (e) {
    if (DEMO) { root.textContent = errMsg(e); return; }
    showLogin(errMsg(e));
  }
}

/* ---------- 껍데기 / 내비게이션 ---------- */
function renderShell() {
  const root = $('#app'); root.replaceChildren();
  const nav = h('nav', { class: 'side' },
    h('div', { class: 'brand' }, '학급관리'),
    TABS.map((t) => h('button', { class: 'nav-btn' + (S.tab === t.id ? ' active' : ''), onclick: () => go(t.id) },
      h('span', null, t.name), t.pw && !S.unlocked ? h('span', { class: 'lock' }, '잠김') : null)),
    h('div', { class: 'spacer' }),
    S.unlocked ? h('button', { class: 'ghost sm', onclick: () => { lock(); toast('잠갔습니다'); } }, '지금 잠그기') : null,
    h('div', { class: 'who' }, DEMO ? '데모 모드' : S.email),
    DEMO ? null : h('button', { class: 'ghost sm', onclick: logout }, '로그아웃'));
  root.append(h('div', { class: 'shell' }, nav, h('main', { class: 'main', id: 'main' })));
  renderPage();
}
function go(id) {
  const leaving = S.tab === 'setup' && id !== 'setup';
  if (leaving && S.rosterDirty && !confirm('저장하지 않은 명렬표 변경이 있습니다. 이동할까요?')) return;
  const t = TABS.find((x) => x.id === id);
  if (t.pw && !S.unlocked) return askPw(() => go(id));
  if (leaving) { S.rosterDraft = null; S.rosterDirty = false; S.seatDraft = null; }
  S.tab = id; renderShell();
}
function renderPage() {
  const main = $('#main'); main.replaceChildren();
  const t = TABS.find((x) => x.id === S.tab);
  main.append(h('h2', { class: 'page-title' }, t.name));
  if (S.tab === 'setup') main.append(pageSetup());
  else if (S.tab === 'submit') main.append(pageSubmit());
  else if (APP.pages[S.tab]) main.append(APP.pages[S.tab]());
  else main.append(h('div', { class: 'card placeholder' }, '이 메뉴는 준비 중입니다.'));
}
function lock() {
  S.unlocked = false; S.pw = ''; S.rosterDraft = null; S.rosterDirty = false; S.seatDraft = null;
  S.roster = S.roster.map((x) => ({ num: x.num, name: x.name, gender: x.gender }));
  APP.onLock.forEach((f) => f());
  if (TABS.find((x) => x.id === S.tab).pw) S.tab = 'submit';
  renderShell();
}
function logout() { S.token = null; location.reload(); }
function askPw(onOk) {
  const err = h('div', { class: 'err' });
  const input = h('input', { type: 'password', placeholder: '비밀번호', autocomplete: 'off' });
  const close = () => ov.remove();
  const submit = async () => {
    err.textContent = ''; btn.disabled = true;
    try {
      const j = await api('unlock', { pw: input.value });
      S.unlocked = true; S.pw = input.value; S.roster = j.roster; S.defaultPw = j.defaultPw; lastAct = Date.now();
      close(); onOk();
    } catch (e) { err.textContent = errMsg(e); btn.disabled = false; input.select(); }
  };
  const btn = h('button', { class: 'primary', onclick: submit }, '확인');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); });
  const ov = h('div', { class: 'overlay' }, h('div', { class: 'modal' },
    h('h3', null, '비밀번호 입력'), h('div', { class: 'muted' }, '이 메뉴는 비밀번호가 필요합니다.'),
    input, err, h('div', { class: 'row' }, h('button', { onclick: close }, '취소'), btn)));
  document.body.append(ov); input.focus();
}
let lastAct = Date.now();
['click', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { lastAct = Date.now(); }));
setInterval(() => { if (S.unlocked && !S.rosterDirty && Date.now() - lastAct > 10 * 60 * 1000) { lock(); toast('10분간 사용이 없어 잠갔습니다'); } }, 30000);

/* =====================================================
   학급 기초설정
   ===================================================== */
function pageSetup() {
  const subs = [['roster', '학생 명렬표'], ['seat', '학급 자리 배치'], ['pw', '비밀번호 변경']];
  const wrap = h('div', null,
    S.defaultPw ? h('div', { class: 'banner warn' }, '초기 비밀번호(000000)를 사용 중입니다. "비밀번호 변경"에서 바꿔 주세요.') : null,
    h('div', { class: 'tabs' }, subs.map(([id, name]) => h('button', { class: 'tab' + (S.setupSub === id ? ' active' : ''), onclick: () => { S.setupSub = id; renderPage(); } }, name))));
  wrap.append(S.setupSub === 'roster' ? rosterEditor() : S.setupSub === 'seat' ? seatEditor() : pwEditor());
  return wrap;
}

/* ---- 명렬표 ---- */
const FIELDS = [
  ['num', '번호'], ['name', '이름'], ['gender', '성별'], ['phone', '연락처'], ['birth', '생년월일'],
  ['note', '특기사항'], ['title', '호칭'], ['b1', '비고1'], ['b2', '비고2'], ['b3', '비고3']
];
const blankRow = (num) => ({ num, name: '', gender: '', phone: '', birth: '', note: '', title: '', b1: '', b2: '', b3: '' });
const byNum = (a, b) => Number(a.num) - Number(b.num);
/* 성별 인식: 남/여, 남성/여성, 남자/여자, M/F, male/female */
const normGender = (v) => { const t = String(v == null ? '' : v).trim().toLowerCase(); return /^(남|m)/.test(t) ? '남' : /^(여|f)/.test(t) ? '여' : ''; };
const ROSTER_HEADS = { num: ['번호', '출석번호', '학번', 'no', 'num', '번'], name: ['이름', '성명', '학생이름', '학생명', 'name'], gender: ['성별', '남녀', 'gender', 'sex'], phone: ['연락처', '전화번호', '전화', '휴대폰', '핸드폰', 'phone', 'tel'],
  birth: ['생년월일', '생일', '생년', 'birth', 'birthday'], note: ['특기사항', '특이사항', '메모', 'note'], title: ['호칭', '별칭', '애칭', '부르는이름'], b1: ['비고1', '비고 1'], b2: ['비고2', '비고 2'], b3: ['비고3', '비고 3'] };
const ROSTER_TEMPLATE_HEAD = ['출석번호', '이름', '성별', '연락처', '생년월일', '특기사항', '호칭', '비고1', '비고2', '비고3'];
const excelDate = (n) => { const d = new Date(Math.round((n - 25569) * 86400000)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };
/* 2차원 표 → 명렬표 행들 (머리글 이름으로 열을 찾고, 없으면 양식 순서대로) */
function rowsToRoster(table) {
  const norm = (x) => String(x == null ? '' : x).replace(/\s+/g, '').toLowerCase();
  const rows = table.filter((r) => r.some((c) => String(c == null ? '' : c).trim() !== ''));
  if (!rows.length) return { list: [], warn: ['내용이 비어 있어요'] };
  const keys = FIELDS.map((f) => f[0]), map = {};
  let start = 0;
  const head = rows[0].map(norm);
  head.forEach((t, ci) => { const k = Object.keys(ROSTER_HEADS).find((key) => ROSTER_HEADS[key].map(norm).includes(t)); if (k && map[k] == null) map[k] = ci; });
  if (map.name != null) start = 1; else { Object.keys(map).forEach((k) => delete map[k]); keys.forEach((k, i) => { map[k] = i; }); if (isNaN(Number(rows[0][0])) && rows[0][0] !== '') start = 1; }
  const warn = [], list = [], seen = new Set();
  rows.slice(start).forEach((r, i) => {
    const o = blankRow(0); keys.forEach((k) => { if (map[k] != null && r[map[k]] != null) o[k] = String(r[map[k]]).trim(); });
    if (!o.name) { if (o.num || o.phone) warn.push(`${i + 1}번째 줄: 이름이 없어 건너뛰었어요`); return; }
    const raw = o.gender; o.gender = normGender(o.gender);
    if (raw && !o.gender) warn.push(`${o.name}: 성별 "${raw}"을(를) 알아보지 못했어요 (비워 둠)`);
    if (!raw) warn.push(`${o.name}: 성별이 비어 있어요`);
    const bn = Number(o.birth); if (map.birth != null && typeof r[map.birth] === 'number' && bn > 10000 && bn < 80000) o.birth = excelDate(bn);
    let n = Number(o.num); if (!n || n < 1 || seen.has(n)) { if (n && seen.has(n)) warn.push(`${o.name}: 번호 ${n}이(가) 겹쳐서 새 번호를 붙였어요`); n = 0; }
    o.num = n; if (n) seen.add(n);
    list.push(o);
  });
  let next = 1; list.forEach((o) => { if (!o.num) { while (seen.has(next)) next++; o.num = next; seen.add(next); } });
  return { list, warn };
}
const gcls = (g) => (g === '남' ? 'm' : g === '여' ? 'f' : '');

function rosterEditor() {
  if (!S.rosterDraft) { S.rosterDraft = clone(S.roster).sort(byNum); S.rosterDirty = false; }
  const rows = S.rosterDraft;
  const dirty = () => { S.rosterDirty = true; dirtyEl.hidden = false; };
  const dirtyEl = h('span', { class: 'muted', hidden: !S.rosterDirty }, '저장되지 않은 변경이 있습니다');

  const tbody = h('tbody', null, rows.map((r, i) => {
    const tr = h('tr', { class: gcls(r.gender) });
    FIELDS.forEach(([k]) => {
      let control;
      if (k === 'gender') {
        control = h('select', { value: r.gender, onchange: (e) => { r.gender = e.target.value; tr.className = gcls(r.gender); dirty(); } },
          h('option', { value: '' }, '-'), h('option', { value: '남' }, '남'), h('option', { value: '여' }, '여'));
      } else {
        control = h('input', { value: r[k], inputmode: k === 'num' ? 'numeric' : null, oninput: (e) => { r[k] = e.target.value; dirty(); } });
      }
      tr.append(h('td', { class: k === 'num' ? 'num' : k === 'gender' ? 'gender' : null }, control));
    });
    tr.append(h('td', { class: 'del' }, h('button', { class: 'sm ghost', title: '삭제', onclick: () => { rows.splice(i, 1); dirty(); renderPage(); } }, '✕')));
    return tr;
  }));
  const table = h('table', { class: 'roster' },
    h('thead', null, h('tr', null, FIELDS.map(([, n]) => h('th', null, n)), h('th', null, ''))), tbody);

  const saveBtn = h('button', { class: 'primary', onclick: async () => {
    const out = rows.filter((r) => String(r.name).trim()).map((r) => ({ ...r, name: String(r.name).trim() }));
    const nums = out.map((r) => Number(r.num));
    if (nums.some((n) => !Number.isInteger(n) || n < 1)) return toast('번호는 1 이상의 숫자로 입력하세요', true);
    if (new Set(nums).size !== nums.length) return toast('번호가 겹치는 학생이 있습니다', true);
    out.sort(byNum);
    saveBtn.disabled = true;
    try {
      await api('saveRoster', { rows: out });
      S.roster = clone(out); S.rosterDraft = clone(out); S.rosterDirty = false;
      toast('명렬표를 저장했습니다'); renderPage();
    } catch (e) { toast(errMsg(e), true); saveBtn.disabled = false; }
  } }, '저장');

  const pasteBox = h('textarea', { class: 'paste', placeholder: '엑셀·한글 표를 복사해 붙여넣으세요.\n열 순서: 번호, 이름, 성별(남/여), 연락처, 생년월일, 특기사항, 호칭, 비고1, 비고2, 비고3' });
  const paste = h('div', { class: 'card', hidden: !S.showPaste },
    h('h3', null, '표 붙여넣기로 일괄 입력'),
    h('div', { class: 'muted' }, '적용하면 현재 표의 내용이 붙여넣은 내용으로 바뀝니다. (저장 버튼을 눌러야 확정)'),
    pasteBox,
    h('div', { class: 'row' }, h('button', { class: 'primary sm', onclick: () => {
      const keys = FIELDS.map((f) => f[0]);
      const lines = pasteBox.value.split(/\r?\n/).filter((l) => l.trim());
      const parsed = [];
      lines.forEach((l, idx) => {
        const c = l.split('\t');
        if (idx === 0 && isNaN(Number(c[0]))) return; // 머리글 줄 건너뜀
        const r = blankRow(parsed.length + 1);
        keys.forEach((k, j) => { if (c[j] !== undefined) r[k] = c[j].trim(); });
        if (!Number(r.num)) r.num = parsed.length + 1;
        r.gender = normGender(r.gender);
        parsed.push(r);
      });
      if (!parsed.length) return toast('붙여넣은 내용이 없습니다', true);
      S.rosterDraft = parsed; S.rosterDirty = true; S.showPaste = false; renderPage();
    } }, '적용'), h('button', { class: 'sm', onclick: () => { S.showPaste = false; renderPage(); } }, '닫기')));

  /* 엑셀·CSV 파일로 일괄 등록 */
  const upMsg = h('div', { class: 'muted', style: 'margin-top:8px;line-height:1.7' });
  const upFile = h('input', { type: 'file', accept: '.xlsx,.csv,.tsv,.txt', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const { list, warn } = rowsToRoster(await APP.xl.readTableFile(f));
      if (!list.length) return toast('등록할 학생을 찾지 못했어요. 양식의 "이름" 열을 확인해 주세요', true);
      confirmUpload(list, warn, f.name);
    } catch (x) { toast(errMsg(x), true); }
  } });
  const confirmUpload = (list, warn, fname) => {
    const mode = { v: 'replace' };
    const close = () => ov.remove();
    const gm = list.filter((x) => x.gender === '남').length, gf = list.filter((x) => x.gender === '여').length;
    const ov = h('div', { class: 'overlay' }, h('div', { class: 'modal xdlg' },
      h('h3', null, '업로드한 명렬표 확인'),
      h('div', null, `${fname} — 학생 ${list.length}명 (남 ${gm} · 여 ${gf}${list.length - gm - gf ? ` · 성별 없음 ${list.length - gm - gf}` : ''})`),
      h('div', { class: 'muted', style: 'margin:6px 0' }, list.slice(0, 6).map((x) => `${x.num} ${x.name}`).join(', ') + (list.length > 6 ? ' …' : '')),
      warn.length ? h('div', { class: 'banner warn', style: 'max-height:130px;overflow:auto' }, warn.slice(0, 20).map((w) => h('div', null, w)), warn.length > 20 ? h('div', null, `…외 ${warn.length - 20}건`) : null) : null,
      h('div', { class: 'radios', style: 'margin:10px 0' },
        h('label', null, h('input', { type: 'radio', name: 'upm', checked: true, onchange: () => { mode.v = 'replace'; } }), '현재 명렬표를 이 내용으로 바꾸기'),
        h('label', null, h('input', { type: 'radio', name: 'upm', onchange: () => { mode.v = 'merge'; } }), '현재 명렬표에 더하기 (번호가 같으면 덮어씀)')),
      h('div', { class: 'muted' }, '적용 후 "저장" 버튼을 눌러야 확정돼요.'),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { onclick: close }, '취소'), h('button', { class: 'primary', onclick: () => {
        if (mode.v === 'replace') S.rosterDraft = list;
        else { const m = new Map(S.rosterDraft.map((r) => [Number(r.num), r])); list.forEach((r) => m.set(Number(r.num), r)); S.rosterDraft = [...m.values()].sort((a, b) => Number(a.num) - Number(b.num)); }
        S.rosterDirty = true; S.showUpload = false; close(); renderPage(); toast(`${list.length}명을 적용했어요. 저장을 눌러 확정하세요`);
      } }, '적용'))));
    document.body.append(ov);
  };
  const tplRows = () => [ROSTER_TEMPLATE_HEAD, ...Array.from({ length: 35 }, (_, i) => [i + 1])];
  const upload = h('div', { class: 'card', hidden: !S.showUpload },
    h('h3', null, '엑셀·CSV 파일로 일괄 등록'),
    h('div', { class: 'muted', style: 'line-height:1.7' }, '1) 양식을 받아서 학생 정보를 채우세요.  2) 엑셀로 저장한 파일(.xlsx)이나 CSV를 올리면 한 번에 등록돼요.  성별은 "남/여", "남성/여성", "남자/여자", M/F 모두 알아봐요. 첫 줄 제목의 순서가 바뀌어도 괜찮아요.'),
    h('div', { class: 'row gap', style: 'margin-top:10px' },
      h('button', { class: 'sm', onclick: () => APP.xl.saveBlob(APP.xl.buildXlsx([
        { name: '명렬표', rows: tplRows(), genderCol: 2, widths: [10, 12, 8, 16, 14, 24, 10, 12, 12, 12] },
        { name: '작성 안내', rows: [['작성 방법'], ['출석번호와 이름은 꼭 채워 주세요. 이름이 없는 줄은 건너뜁니다.'], ['성별은 남 / 여 (남성, 여성, 남자, 여자도 인식해요).'], ['호칭: 친구들이 부르는 이름이에요. 예) 김철수 → 철수'], ['생년월일은 2015-03-02 처럼 적으면 돼요.'], ['작성한 뒤 .xlsx 로 저장해서 올려 주세요.']], widths: [70], header: true }]), '명렬표_업로드양식.xlsx') }, '양식 내려받기 (.xlsx)'),
      DEMO ? null : h('button', { class: 'sm', onclick: async () => {
        try { const j = await api('exportSheet', { title: '명렬표 업로드 양식', sheets: [{ name: '명렬표', rows: tplRows() }] }); upMsg.replaceChildren('양식을 만들었어요. ', h('a', { href: j.url, target: '_blank', rel: 'noopener' }, '구글 스프레드시트 열기'), ' — 작성 후 "파일 → 다운로드 → Microsoft Excel(.xlsx)"로 저장해서 올려 주세요.'); } catch (x) { toast(errMsg(x), true); }
      } }, '구글 스프레드시트 양식 만들기'),
      h('button', { class: 'primary sm', onclick: () => upFile.click() }, '파일 올리기'), upFile),
    upMsg,
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'sm', onclick: () => { S.showUpload = false; renderPage(); } }, '닫기')));

  return h('div', null,
    h('div', { class: 'card' },
      h('div', { class: 'row gap' },
        h('button', { class: 'sm', onclick: () => { rows.push(blankRow((rows.reduce((m, r) => Math.max(m, Number(r.num) || 0), 0)) + 1)); S.rosterDirty = true; renderPage(); } }, '+ 학생 추가'),
        h('button', { class: 'sm', onclick: () => { S.showPaste = !S.showPaste; renderPage(); } }, '표 붙여넣기'),
        h('button', { class: 'sm', onclick: () => { S.showUpload = !S.showUpload; renderPage(); } }, '엑셀·CSV 업로드'),
        h('span', { class: 'legend' }, h('span', null, h('i', { class: 'dot m' }), '남'), h('span', null, h('i', { class: 'dot f' }), '여')),
        h('div', { style: 'flex:1' }), dirtyEl, saveBtn),
      h('div', { class: 'table-wrap' }, table),
      h('div', { class: 'muted', style: 'margin-top:8px' }, '성별을 고르면 줄 색이 자동으로 바뀝니다. 이름 3글자 대신 "철수"처럼 부르는 이름은 "호칭"에 적어 두세요.')),
    upload, paste);
}

/* ---- 비밀번호 변경 ---- */
function pwEditor() {
  const a = h('input', { type: 'password', placeholder: '새 비밀번호 (6자 이상)', autocomplete: 'new-password' });
  const b = h('input', { type: 'password', placeholder: '새 비밀번호 확인', autocomplete: 'new-password' });
  return h('div', { class: 'card', style: 'max-width:420px' },
    h('h3', null, '비밀번호 변경'),
    h('div', { class: 'field' }, a), h('div', { class: 'field' }, b),
    h('button', { class: 'primary', onclick: async () => {
      if (a.value.length < 6) return toast(ERR.SHORT, true);
      if (a.value !== b.value) return toast('비밀번호 확인이 일치하지 않습니다', true);
      try { await api('changePw', { newPw: a.value }); S.pw = a.value; S.defaultPw = false; toast('비밀번호를 바꿨습니다'); renderPage(); }
      catch (e) { toast(errMsg(e), true); }
    } }, '변경'));
}

/* ---- 자리 배치 설정 ---- */
const MODES = [['mixed', '짝은 남녀로'], ['same', '짝은 동성으로'], ['random', '짝 성별 상관 없음']];
const TEAM_COLORS = ['#fde68a', '#a7f3d0', '#fbcfe8', '#bfdbfe', '#fed7aa', '#ddd6fe', '#fecaca', '#99f6e4', '#d9f99d', '#e9d5ff'];
function promptTeamName(def) {
  return new Promise((resolve) => {
    const input = h('input', { value: def, maxlength: 12, style: 'width:100%;margin:12px 0 8px' });
    const close = (v) => { ov.remove(); resolve(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value.trim()); if (e.key === 'Escape') close(null); });
    const ov = h('div', { class: 'overlay' }, h('div', { class: 'modal' }, h('h3', null, '모둠 이름'), h('div', { class: 'muted' }, '이미 있는 이름이면 그 모둠에 자리가 더해져요'), input,
      h('div', { class: 'row' }, h('button', { onclick: () => close(null) }, '취소'), h('button', { class: 'primary', onclick: () => close(input.value.trim()) }, '확인'))));
    document.body.append(ov); input.focus(); input.select();
  });
}
function seatEditor() {
  if (!S.seatDraft) { S.seatDraft = clone(S.seat); S.seatUi = { editMode: 'move', sel: null, pick: null }; }
  const d = S.seatDraft, ui = S.seatUi;
  const stuName = (n) => { const s = S.roster.find((x) => Number(x.num) === Number(n)); return s ? s.name : n + '번'; };
  const rerender = () => renderPage();
  const active = d.cells.filter(Boolean).length;

  const swap = (a, b) => {
    [d.cells[a], d.cells[b]] = [d.cells[b], d.cells[a]];
    d.fixed.forEach((f) => { if (f.idx === a) f.idx = b; else if (f.idx === b) f.idx = a; });
    d.teams.forEach((t) => { t.cells = t.cells.map((i) => (i === a ? b : i === b ? a : i)); });
  };
  if (!ui.teamSel) ui.teamSel = [];
  if (!Array.isArray(d.teams)) d.teams = [];
  const dropFromTeams = (idxs) => { d.teams.forEach((t) => { t.cells = t.cells.filter((i) => !idxs.includes(i)); }); d.teams = d.teams.filter((t) => t.cells.length); };
  const teamOf = new Map(); d.teams.forEach((t, ti) => t.cells.forEach((i) => teamOf.set(i, ti)));
  const nextTeamName = () => { let n = 1; while (d.teams.some((t) => t.name === n + '모둠')) n++; return n + '모둠'; };
  const makeTeam = async () => {
    if (!ui.teamSel.length) return toast('먼저 모둠으로 묶을 자리를 눌러 선택하세요', true);
    const name = await promptTeamName(nextTeamName()); if (!name) return;
    const sel = ui.teamSel.slice(); dropFromTeams(sel);
    const ex = d.teams.find((t) => t.name === name);
    if (ex) ex.cells.push(...sel); else d.teams.push({ name, cells: sel });
    ui.teamSel = []; rerender();
  };
  const onCell = (i) => {
    if (ui.pick != null) {
      if (!d.cells[i]) return toast('사용하지 않는 자리입니다', true);
      d.fixed = d.fixed.filter((f) => f.num !== ui.pick && f.idx !== i);
      d.fixed.push({ num: ui.pick, idx: i }); ui.pick = null; return rerender();
    }
    if (ui.editMode === 'toggle') {
      d.cells[i] = d.cells[i] ? 0 : 1;
      if (!d.cells[i]) { d.fixed = d.fixed.filter((f) => f.idx !== i); dropFromTeams([i]); }
    } else if (ui.editMode === 'team') {
      if (!d.cells[i]) return toast('사용하지 않는 자리입니다', true);
      const k = ui.teamSel.indexOf(i); if (k >= 0) ui.teamSel.splice(k, 1); else ui.teamSel.push(i);
    } else if (ui.sel == null) ui.sel = i;
    else if (ui.sel === i) ui.sel = null;
    else { swap(ui.sel, i); ui.sel = null; }
    rerender();
  };
  const resize = (cols, rows) => {
    cols = Math.max(1, Math.min(12, cols | 0)); rows = Math.max(1, Math.min(12, rows | 0));
    const nc = Array(cols * rows).fill(1), map = (i) => { const r = Math.floor(i / d.cols), c = i % d.cols; return r < rows && c < cols ? r * cols + c : -1; };
    d.cells.forEach((v, i) => { const j = map(i); if (j >= 0) nc[j] = v; });
    d.fixed = d.fixed.map((f) => ({ ...f, idx: map(f.idx) })).filter((f) => f.idx >= 0 && nc[f.idx]);
    d.teams = d.teams.map((t) => ({ ...t, cells: t.cells.map(map).filter((i) => i >= 0 && nc[i]) })).filter((t) => t.cells.length); ui.teamSel = [];
    d.cells = nc; d.cols = cols; d.rows = rows; ui.sel = null; rerender();
  };

  const grid = h('div', { class: 'seat-grid', style: `grid-template-columns:repeat(${d.cols},1fr)` },
    d.cells.map((on, i) => {
      const r = Math.floor(i / d.cols), c = i % d.cols;
      const gi = (Math.floor(c / d.gw) + Math.floor(r / d.gh)) % 2;
      const fx = d.fixed.find((f) => f.idx === i);
      const ti = teamOf.get(i), tsel = ui.teamSel.includes(i);
      return h('div', { class: `seat ${on ? 'on ' + (gi ? 'gb' : 'ga') : 'off'}${ui.sel === i || tsel ? ' sel' : ''}${ui.pick != null && on ? ' pickable' : ''}`, style: on && ti != null ? `background:${TEAM_COLORS[ti % TEAM_COLORS.length]}` : null, onclick: () => onCell(i) },
        on ? [fx ? h('span', { class: 'fixed-mark' }, '고정 ', stuName(fx.num)) : h('span', null, String(i + 1)), ti != null ? h('span', { class: 'tname' }, d.teams[ti].name) : null] : '사용 안 함');
    }));

  const sizeIn = (val, onch) => h('input', { class: 'n', type: 'number', min: 1, max: 12, value: val, onchange: onch });
  const colsIn = sizeIn(d.cols, () => resize(Number(colsIn.value), d.rows));
  const rowsIn = sizeIn(d.rows, () => resize(d.cols, Number(rowsIn.value)));
  const gwIn = sizeIn(d.gw, () => { d.gw = Math.max(1, Math.min(12, Number(gwIn.value) | 0)); rerender(); });
  const ghIn = sizeIn(d.gh, () => { d.gh = Math.max(1, Math.min(12, Number(ghIn.value) | 0)); rerender(); });
  const preset = (name, w, hh) => h('button', { class: 'sm ghost', onclick: () => { d.gw = w; d.gh = hh; rerender(); } }, name);

  const stuOpts = () => S.roster.slice().sort(byNum).map((s) => h('option', { value: s.num }, `${s.num}번 ${s.name}`));
  const fixSel = h('select', null, stuOpts());
  const avA = h('select', null, stuOpts()), avB = h('select', null, stuOpts());
  const avType = h('select', null, h('option', { value: 'group' }, '같은 짝·모둠 금지'), h('option', { value: 'dist' }, 'N칸 이내 금지'));
  const avN = h('input', { class: 'n', type: 'number', min: 1, max: 12, value: 2 });
  const repIn = h('input', { class: 'n', type: 'number', min: 0, max: 20, value: d.noRepeat, onchange: () => { d.noRepeat = Math.max(0, Number(repIn.value) | 0); } });

  const left = h('div', { class: 'card' },
    h('div', { class: 'row gap' },
      h('span', null, '가로'), colsIn, h('span', null, '× 세로'), rowsIn,
      h('span', { class: 'muted' }, `사용 자리 ${active}개 / 학생 ${S.roster.length}명`)),
    active < S.roster.length ? h('div', { class: 'banner warn' }, '사용 자리가 학생 수보다 적습니다.') : null,
    h('div', { class: 'row gap radios' },
      h('label', null, h('input', { type: 'radio', name: 'em', checked: ui.editMode === 'move', onchange: () => { ui.editMode = 'move'; ui.sel = null; rerender(); } }), '자리 이동 (두 자리를 차례로 누르면 서로 바뀜)'),
      h('label', null, h('input', { type: 'radio', name: 'em', checked: ui.editMode === 'toggle', onchange: () => { ui.editMode = 'toggle'; ui.sel = null; rerender(); } }), '사용 안 함 켜고 끄기'),
      h('label', null, h('input', { type: 'radio', name: 'em', checked: ui.editMode === 'team', onchange: () => { ui.editMode = 'team'; ui.sel = null; rerender(); } }), '모둠 지정 (여러 자리를 누른 뒤 "모둠 만들기")')),
    ui.editMode === 'team' ? h('div', { class: 'banner' }, h('div', { class: 'row' }, h('span', null, `선택한 자리 ${ui.teamSel.length}개`),
      h('button', { class: 'sm primary', onclick: makeTeam }, '모둠 만들기'),
      h('button', { class: 'sm', onclick: () => { if (!ui.teamSel.length) return; dropFromTeams(ui.teamSel); ui.teamSel = []; rerender(); } }, '모둠에서 빼기'),
      h('button', { class: 'sm ghost', onclick: () => { ui.teamSel = []; rerender(); } }, '선택 해제'))) : null,
    ui.pick != null ? h('div', { class: 'banner' }, `${stuName(ui.pick)} 학생의 고정 자리를 그림에서 눌러 주세요. `, h('button', { class: 'sm', onclick: () => { ui.pick = null; rerender(); } }, '취소')) : null,
    h('div', { class: 'board-front' }, '칠 판'),
    h('div', { class: 'col-labels', style: `grid-template-columns:repeat(${d.cols},1fr)` },
      Array.from({ length: d.cols }, (_, c) => h('input', { class: 'col-label', value: (d.colNames && d.colNames[c]) || String(c + 1), placeholder: String(c + 1), title: '줄 이름 (바꿀 수 있어요)', maxlength: 8,
        oninput: (e) => { d.colNames = d.colNames || []; d.colNames[c] = e.target.value.trim() === String(c + 1) ? '' : e.target.value; } }))),
    grid,
    h('div', { class: 'row', style: 'margin-top:12px' },
      h('span', { class: 'muted' }, '짝·모둠 묶음'), gwIn, h('span', null, '칸 ×'), ghIn, h('span', null, '칸'),
      preset('개별', 1, 1), preset('짝', 2, 1), preset('4인 모둠', 2, 2), preset('6인 모둠', 3, 2)));

  const right = h('div', null,
    h('div', { class: 'card' }, h('h3', null, '자리 배치 규칙'),
      h('div', { class: 'radios' }, MODES.map(([v, n]) => h('label', null, h('input', { type: 'radio', name: 'mode', checked: d.mode === v, onchange: () => { d.mode = v; } }), n))),
      h('label', { class: 'row', style: 'gap:6px;margin-top:10px;cursor:pointer' }, h('input', { type: 'checkbox', checked: !!d.teamBalance, onchange: (e) => { d.teamBalance = e.target.checked; } }), '모둠에 남녀 최대한 같은 비율로'),
      h('div', { class: 'muted', style: 'margin-top:4px;line-height:1.6' }, '체크하면 위의 짝 규칙을 기본으로 하되, 모든 모둠을 합쳐서 남녀 비율이 최대한 1:1에 가깝도록 맞춰요. (학급 전체 성비가 1:1이 아니면 그 비율에 맞춰요)')),
    h('div', { class: 'card' }, h('h3', null, '모둠 구성'),
      d.teams.length ? d.teams.map((t, ti) => h('div', { class: 'list-item' },
        h('span', { class: 'dot', style: `background:${TEAM_COLORS[ti % TEAM_COLORS.length]}` }),
        h('input', { value: t.name, maxlength: 12, style: 'flex:1;min-width:0', oninput: (e) => { t.name = e.target.value; }, onchange: () => rerender() }),
        h('span', { class: 'muted' }, `${t.cells.length}자리`),
        h('button', { class: 'sm ghost', onclick: () => { d.teams.splice(ti, 1); rerender(); } }, '✕')))
        : h('div', { class: 'muted' }, '왼쪽에서 "모둠 지정"을 고르고 여러 자리를 누른 뒤 "모둠 만들기"를 눌러 주세요.')),
    h('div', { class: 'card' }, h('h3', null, '고정 자리 (학생에게는 보이지 않음)'),
      h('div', { class: 'row' }, fixSel, h('button', { class: 'sm', onclick: () => { ui.pick = Number(fixSel.value); rerender(); } }, '자리 고르기')),
      d.fixed.map((f, i) => h('div', { class: 'list-item' }, h('span', null, `${stuName(f.num)} → ${Math.floor(f.idx / d.cols) + 1}행 ${(f.idx % d.cols) + 1}열`),
        h('button', { class: 'sm ghost', onclick: () => { d.fixed.splice(i, 1); rerender(); } }, '✕')))),
    h('div', { class: 'card' }, h('h3', null, '기피 설정'),
      h('div', { class: 'row' }, avA, h('span', null, '와'), avB), h('div', { class: 'row', style: 'margin-top:6px' }, avType, avN, h('span', { class: 'muted' }, '칸'),
        h('button', { class: 'sm', onclick: () => {
          if (avA.value === avB.value) return toast('서로 다른 학생을 고르세요', true);
          d.avoid.push({ a: Number(avA.value), b: Number(avB.value), type: avType.value, n: Math.max(1, Number(avN.value) | 0) }); rerender();
        } }, '추가')),
      d.avoid.map((x, i) => h('div', { class: 'list-item' }, h('span', null, `${stuName(x.a)} ↔ ${stuName(x.b)} · ${x.type === 'group' ? '같은 짝·모둠 금지' : x.n + '칸 이내 금지'}`),
        h('button', { class: 'sm ghost', onclick: () => { d.avoid.splice(i, 1); rerender(); } }, '✕')))),
    h('div', { class: 'card' }, h('h3', null, '같은 짝·모둠 반복 방지'),
      h('div', { class: 'row' }, h('span', null, '최근'), repIn, h('span', null, '번 동안 같은 짝·모둠이 되지 않게 (0 = 사용 안 함)'))),
    h('button', { class: 'primary', onclick: async () => {
      try { await api('saveSeat', { seat: d }); S.seat = clone(d); toast('자리 설정을 저장했습니다'); }
      catch (e) { toast(errMsg(e), true); }
    } }, '자리 설정 저장'));

  if (!S.roster.length) return h('div', { class: 'card placeholder' }, '먼저 "학생 명렬표"를 입력해 주세요.');
  return h('div', { class: 'seat-layout' }, left, right);
}

/* =====================================================
   제출확인
   ===================================================== */
let saveTimers = {};
function queueBoardSave(b) {
  S.saveText = '저장 중…'; updSave();
  clearTimeout(saveTimers[b.id]);
  saveTimers[b.id] = setTimeout(async () => {
    try { await api('saveBoard', { board: b }); S.saveText = '저장됨'; }
    catch (e) { S.saveText = '저장 실패'; toast(errMsg(e), true); }
    updSave();
  }, 700);
}
function updSave() { const el = $('#saveState'); if (el) el.textContent = S.saveText; }

let relayoutSub = null;
function pageSubmit() {
  const wrap = h('div', { class: 'sub-full' });
  const roster = S.roster.slice().sort(byNum);
  if (!roster.length) { wrap.append(h('div', { class: 'card placeholder' }, '명렬표가 비어 있습니다. 학급 기초설정에서 학생을 먼저 입력해 주세요.')); return wrap; }
  const n = roster.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  const area = h('div', { class: 'sub-area' });
  const saveState = h('span', { class: 'save-state', id: 'saveState' }, S.saveText);
  const entries = [];

  const addBtn = h('button', { class: 'primary', onclick: () => {
    const b = { id: 'b' + Date.now().toString(36), title: '', locked: false, done: [], created: Date.now() };
    S.boards.push(b); addBoard(b); layout(); queueBoardSave(b);
    const inp = entries[entries.length - 1].title; if (inp) inp.focus();
  } }, '+ 제출판 추가');
  const allLock = h('button', { onclick: () => {
    const lockAll = S.boards.some((b) => !b.locked);
    S.boards.forEach((b) => { b.locked = lockAll; queueBoardSave(b); });
    entries.forEach(syncLock);
  } }, '전체 잠금/해제');
  const fsBtn = h('button', { onclick: () => { document.fullscreenElement ? document.exitFullscreen() : (wrap.requestFullscreen && wrap.requestFullscreen()); } }, '전체화면');
  const bar = h('div', { class: 'sub-bar' }, addBtn, allLock, fsBtn, saveState, h('span', { class: 'muted' }, '제출판을 추가하면 한 화면에 맞게 자동으로 나눠 보여요'));
  wrap.append(bar, area);

  function syncLock(e) {
    const b = e.board;
    e.title.disabled = b.locked; e.lockBtn.textContent = b.locked ? '잠김' : '잠금'; e.lockBtn.className = 'sm ' + (b.locked ? 'primary' : '');
    e.del.disabled = b.locked; e.el.classList.toggle('locked', b.locked);
  }
  function addBoard(b) {
    const doneSet = new Set(b.done);
    const count = h('span', { class: 'count' });
    const up = () => { count.textContent = `${doneSet.size}/${n}`; };
    const title = h('input', { class: 'title', value: b.title, placeholder: '과제명', oninput: (ev) => { b.title = ev.target.value; queueBoardSave(b); } });
    const lockBtn = h('button', { onclick: () => { b.locked = !b.locked; queueBoardSave(b); syncLock(e); } });
    const del = h('button', { class: 'sm ghost', title: '삭제', onclick: async () => {
      if (!confirm(`"${b.title || '제목 없음'}" 제출판을 삭제할까요?`)) return;
      try { await api('deleteBoard', { id: b.id }); S.boards = S.boards.filter((x) => x.id !== b.id); entries.splice(entries.indexOf(e), 1); e.el.remove(); syncEmpty(); layout(); }
      catch (x) { toast(errMsg(x), true); }
    } }, '✕');
    const reset = h('button', { class: 'sm ghost', title: '제출 표시 모두 지우기', onclick: () => {
      if (b.locked || !confirm('이 제출판의 제출 표시를 모두 지울까요?')) return;
      doneSet.clear(); b.done = []; grid.querySelectorAll('.scell').forEach((c) => c.classList.remove('done')); up(); queueBoardSave(b);
    } }, '초기화');
    const grid = h('div', { class: 'sbd-grid', style: `grid-template-columns:repeat(${cols},var(--cw))` }, roster.map((st) => {
      const k = st.name.length <= 2 ? 0.42 : st.name.length === 3 ? 0.3 : st.name.length === 4 ? 0.23 : 0.18;
      const cell = h('div', { class: 'scell' + (doneSet.has(st.num) ? ' done' : ''), style: `--k:${k}` }, h('span', { class: 'nm' }, st.name));
      cell.addEventListener('click', () => {
        if (b.locked) return;
        if (doneSet.has(st.num)) doneSet.delete(st.num); else doneSet.add(st.num);
        cell.classList.toggle('done', doneSet.has(st.num));
        b.done = [...doneSet].sort((x, y) => x - y); up(); queueBoardSave(b);
      });
      return cell;
    }));
    const el = h('div', { class: 'sbd' }, h('div', { class: 'sbd-head' }, title, count, reset, lockBtn, del), grid);
    const e = { board: b, el, title, lockBtn, del };
    entries.push(e); area.append(el); up(); syncLock(e); if (typeof syncEmpty === 'function') syncEmpty();
  }

  function layout() {
    const cnt = entries.length;
    if (!cnt) { area.style.height = 'auto'; area.style.gridTemplateRows = ''; area.style.gridTemplateColumns = '1fr'; return; }
    const top = area.getBoundingClientRect().top;
    const H = Math.max(220, window.innerHeight - top - (document.fullscreenElement ? 14 : 52)), W = area.clientWidth, GAP = 12, HEAD = 46, PAD = 18, CG = 4;
    let best = null;
    for (let r = 1; r <= cnt; r++) {
      const c = Math.ceil(cnt / r), slotW = (W - (c - 1) * GAP) / c, slotH = (H - (r - 1) * GAP) / r;
      const narrow = slotW < 400, hd = narrow ? 84 : HEAD;
      const sw = (slotW - PAD - (cols - 1) * CG) / cols, sh = (slotH - hd - PAD - (rows - 1) * CG) / rows;
      const cw = Math.min(sw, sh * 1.6), ch = Math.min(sh, cw);   // 이름이 가로로 길어서 칸을 약간 넓게
      if (!best || cw * ch > best.cw * best.ch) best = { r, c, cw, ch, narrow };
    }
    const cw = Math.max(14, Math.min(220, Math.floor(best.cw))), ch = Math.max(12, Math.min(150, Math.floor(best.ch)));
    area.style.height = H + 'px';
    entries.forEach((e) => e.el.classList.toggle('narrow', best.narrow));
    area.style.setProperty('--cw', cw + 'px'); area.style.setProperty('--ch', ch + 'px');
    area.style.gridTemplateColumns = `repeat(${best.c}, minmax(0, 1fr))`;
    area.style.gridTemplateRows = `repeat(${best.r}, minmax(0, 1fr))`;
  }
  const emptyMsg = h('div', { class: 'card placeholder', style: 'grid-column:1/-1' }, '제출판이 없습니다. "+ 제출판 추가"를 눌러 만들어 보세요.');
  function syncEmpty() { if (entries.length) emptyMsg.remove(); else area.append(emptyMsg); }
  S.boards.forEach(addBoard); syncEmpty();
  relayoutSub = () => { if (wrap.isConnected) layout(); };
  requestAnimationFrame(layout);
  return wrap;
}
window.addEventListener('resize', () => relayoutSub && relayoutSub());
document.addEventListener('fullscreenchange', () => setTimeout(() => relayoutSub && relayoutSub(), 60));

/* ---------- 다른 파일(page_*.js)에서 쓰는 공통 도구 ---------- */
async function kvGet(keys) {
  const j = await api('kvGet', { keys });
  const o = {}; keys.forEach((k) => { o[k] = j.values[k] == null ? null : JSON.parse(j.values[k]); }); return o;
}
const APP = window.APP = {
  S, h, $, api, toast, errMsg, clone, byNum, ERR, gcls, DEMO,
  pages: {}, onLock: [],
  renderPage: () => renderPage(),
  kvGet, kvSet: (key, obj) => api('kvSet', { key, value: JSON.stringify(obj) }),
  kvList: async (prefix) => (await api('kvList', { prefix })).keys,
  kvDel: (key) => api('kvDel', { key }),
  today: () => new Date().toLocaleDateString('sv-SE'),
  roster: () => S.roster.slice().sort(byNum),
  loading: (t) => h('div', { class: 'placeholder' }, t || '불러오는 중…')
};

/* ---------- 시작 ---------- */
window.addEventListener('load', () => { if (DEMO) startApp(); else showLogin(); });
})();
