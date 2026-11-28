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
  LOCKED: '비밀번호를 여러 번 틀려서 잠시 잠겼습니다.',
  SHORT: '비밀번호는 6자 이상이어야 합니다.',
  FORMSOFF: '구글 클라우드에서 "Google Forms API"를 사용 설정해 주세요. (설정방법.md 참고)',
  WEAK: '너무 쉬운 비밀번호예요. (같은 글자 반복, 123456 같은 것은 안 돼요)',
  BAD: '저장할 수 없는 데이터입니다.'
};
const errMsg = (e) => (e.message === 'LOCKED' && e.wait ? `비밀번호를 여러 번 틀려서 잠겼습니다. ${e.wait}분 뒤에 다시 해 보세요.` : ERR[e.message] || ('오류: ' + e.message));

/* ---------- 상태 ---------- */
const defaultSeat = () => ({ cols: 6, rows: 5, cells: Array(30).fill(1), gw: 2, gh: 1, colNames: [], mode: 'mixed', teams: [], teamBalance: false, fixed: [], avoid: [], noRepeat: 0 });
const normSeat = (x) => { const o = Object.assign(defaultSeat(), x || {}); if (o.mode === 'balanced') { o.mode = 'mixed'; o.teamBalance = true; } if (!['mixed', 'same', 'random'].includes(o.mode)) o.mode = 'mixed'; if (!Array.isArray(o.teams)) o.teams = []; return o; };
const S = {
  token: null, email: '', unlocked: false, pw: '', defaultPw: true,
  roster: [], seat: defaultSeat(), boards: [],
  tab: 'board', setupSub: 'roster',
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
  { id: 'contest', name: '대회 관리' },
  { id: 'draw', name: '뽑기' },
  { id: 'submit', name: '제출확인' },
  { id: 'board', name: '학급보드판' }
];

/* ---------- 데이터 관리: 지울 수 있는 항목 ---------- */
const CLEAR_ITEMS = [
  ['roster', '학생 명렬표', '번호·이름·성별·연락처 등 명렬표 전체'],
  ['logs', '학생 관리 - 누가기록', '입력한 누가기록 전체'],
  ['survey', '학생 관리 - 교우관계 조사 입력', '모든 회차의 교우관계 조사 결과'],
  ['perf', '성적 관리 - 수행평가 관리', '1·2학기 과목·평가기준과 입력한 점수'],
  ['evals', '성적 관리 - 기타 평가 관리', '만든 평가와 입력한 점수·응답'],
  ['seat', '자리 관리 - 저장된 자리', '저장해 둔 자리 배치 전체'],
  ['role', '역할 관리 - 저장된 역할', '저장한 역할표 전체'],
  ['roleForm', '역할 관리 - 역할 양식', '올려 둔 양식(PDF·사진) 파일과 칸 설정'],
  ['manito', '뽑기 - 마니또 내역', '저장한 마니또 기록 전체']
];
function clearPlan(t) {
  const prefixes = [];
  if (t.has('survey')) prefixes.push('survey:');
  if (t.has('perf')) prefixes.push('grade:perf:');
  if (t.has('evals')) prefixes.push('grade:eval:');
  if (t.has('seat')) prefixes.push('seat:layout:');
  if (t.has('role')) prefixes.push('role:set:');
  if (t.has('roleForm')) prefixes.push('role:form:');
  if (t.has('manito')) prefixes.push('draw:manito');
  return { prefixes, files: t.has('roleForm'), gradeCfg: t.has('perf') || t.has('evals') ? { perf: t.has('perf'), evals: t.has('evals') } : null };
}

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
  const pub = (r) => r.map((x) => ({ num: x.num, name: x.name, gender: x.gender, surname: x.surname || '' }));
  const chk = () => { if (d.pw !== db.pw) throw new Error('PW'); };
  return new Promise((resolve, reject) => setTimeout(() => {
    try {
      let out = { ok: true };
      if (action === 'load') { if (d.pw) chk(); out = { ok: true, email: 'demo', roster: d.pw ? db.roster : pub(db.roster), seat: db.seat, boards: db.boards, defaultPw: db.defaultPw }; }
      else if (action === 'unlock') { chk(); out = { ok: true, roster: db.roster, defaultPw: db.defaultPw }; }
      else if (action === 'saveRoster') { chk(); db.roster = d.rows; }
      else if (action === 'saveSeat') { chk(); db.seat = d.seat; }
      else if (action === 'changePw') { chk(); if (String(d.newPw).length < 6) throw new Error('SHORT'); if (/^(.)\1+$/.test(d.newPw) || ['123456', '654321', '000000', '111111', '12345678'].includes(String(d.newPw))) throw new Error('WEAK'); db.pw = d.newPw; db.defaultPw = false; }
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
      else if (action === 'clearData') {
        chk(); const t = new Set(d.targets || []), plan = clearPlan(t);
        if (t.has('roster')) db.roster = [];
        if (t.has('logs')) db.logs = [];
        if (plan.files) Object.keys(db.kv).filter((k) => k.indexOf('role:form:') === 0).forEach((k) => { try { delete db.files[JSON.parse(db.kv[k].v).fileId]; } catch (e) { /* 없음 */ } });
        Object.keys(db.kv).forEach((k) => { if (plan.prefixes.some((p) => k === p || k.indexOf(p) === 0)) delete db.kv[k]; });
        if (plan.gradeCfg && db.kv['grade:cfg']) { const c = JSON.parse(db.kv['grade:cfg'].v); if (plan.gradeCfg.perf) c.perf = { '1': [], '2': [] }; if (plan.gradeCfg.evals) c.evals = []; db.kv['grade:cfg'].v = JSON.stringify(c); }
      }
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
  if (!await uiConfirm('이 브라우저에 데모 모드로 저장해 둔 학급 정보가 있어요.\n내 구글 계정으로 가져올까요?\n(데모에 있던 내용은 그대로 남아요)')) { localStorage.setItem(flag, 'no'); return false; }
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
    // 주소 뒤 #board 처럼 메뉴를 적으면 그 메뉴로 열기 (학급보드판 "새 창으로")
    const ht = location.hash.slice(1); const tt = TABS.find((x) => x.id === ht); if (tt && !tt.pw) S.tab = ht;
    renderShell(); loadIcon();
    if (APP.contestRecResume) APP.contestRecResume();
  } catch (e) {
    if (DEMO) { root.textContent = errMsg(e); return; }
    showLogin(errMsg(e));
  }
}

/* ---------- 사이트 아이콘 (데이터 관리에서 바꾸기) ---------- */
const ICON_DEF = {};
function applyIcon(url) {
  document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach((l, i) => {
    if (!(i in ICON_DEF)) ICON_DEF[i] = { href: l.getAttribute('href'), type: l.getAttribute('type') };
    if (url) { l.href = url; l.removeAttribute('type'); l.removeAttribute('sizes'); }
    else { l.setAttribute('href', ICON_DEF[i].href); if (ICON_DEF[i].type) l.setAttribute('type', ICON_DEF[i].type); }
  });
}
function cacheIcon(url) { try { url ? localStorage.setItem('site_icon', url) : localStorage.removeItem('site_icon'); } catch (e) { /* 저장 안 됨 */ } }
try { const c = localStorage.getItem('site_icon'); if (c && /^data:image\//.test(c)) applyIcon(c); } catch (e) { /* 없음 */ }
async function loadIcon() {
  try { const v = await kvGet(['site:icon']); const u = v['site:icon'] && v['site:icon'].url; if (u && /^data:image\//.test(u)) { applyIcon(u); cacheIcon(u); } else { applyIcon(null); cacheIcon(null); } } catch (e) { /* 기본 아이콘 */ }
}
async function makeIcon(file) {
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const s = Math.min(img.naturalWidth, img.naturalHeight), cv = document.createElement('canvas'); cv.width = cv.height = 192;   // 가운데를 정사각형으로 잘라 192px
  const cx = cv.getContext('2d'); cx.imageSmoothingQuality = 'high';
  cx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 192, 192);
  let out = cv.toDataURL('image/png');
  if (out.length > 40000) out = cv.toDataURL('image/webp', 0.9);
  if (out.length > 40000) out = cv.toDataURL('image/jpeg', 0.9);
  return out;
}
function iconEditor() {
  const box = h('div', { class: 'card icon-card', style: 'max-width:760px;margin-bottom:12px' });
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    if (!/^image\//.test(f.type)) return toast('이미지 파일만 쓸 수 있어요', true);
    try { const u = await makeIcon(f); await APP.kvSet('site:icon', { url: u, at: Date.now() }); applyIcon(u); cacheIcon(u); toast('사이트 아이콘을 바꿨어요'); draw(); }
    catch (er) { toast(errMsg(er), true); }
  } });
  const draw = () => {
    let cur = ''; try { cur = localStorage.getItem('site_icon') || ''; } catch (e) { /* 없음 */ }
    box.replaceChildren(h('h3', null, '사이트 아이콘'),
      h('div', { class: 'icon-row' },
        h('img', { class: 'icon-prev', src: cur || 'icons/icon-192.png', alt: '지금 아이콘' }),
        h('div', { class: 'muted', style: 'flex:1;line-height:1.6;font-size:13px' }, '정사각형 이미지가 가장 좋아요(아니면 가운데를 잘라 써요). 브라우저 탭과 즐겨찾기 아이콘이 바로 바뀌어요. 홈 화면에 이미 추가한 아이콘은 지우고 다시 추가해야 바뀌어요.'),
        h('div', { class: 'row', style: 'gap:6px' },
          h('button', { class: 'primary', onclick: () => fileIn.click() }, '이미지 고르기'),
          cur ? h('button', { onclick: async () => { try { await APP.kvSet('site:icon', { url: '' }); applyIcon(null); cacheIcon(null); toast('기본 아이콘으로 돌렸어요'); draw(); } catch (er) { toast(errMsg(er), true); } } }, '기본 아이콘') : null)),
      fileIn);
  };
  draw();
  return box;
}

/* ---------- 껍데기 / 내비게이션 ---------- */
function renderShell() {
  const root = $('#app'); root.replaceChildren();
  let closed = false; try { closed = localStorage.getItem('side_closed') === '1'; } catch (e) { /* 저장 안 됨 */ }
  const setClosed = (c) => {
    nav.classList.toggle('closed', c); fab.classList.toggle('show', c); document.body.classList.toggle('nav-off', c);
    try { localStorage.setItem('side_closed', c ? '1' : '0'); } catch (e) { /* 저장 안 됨 */ }
    window.dispatchEvent(new Event('resize'));
  };
  const tog = h('button', { class: 'side-toggle', title: '메뉴 숨기기', onclick: () => setClosed(true) }, '«');
  const togM = h('button', { class: 'side-toggle-m', title: '메뉴 숨기기', onclick: () => setClosed(true) }, '▲ 숨기기');
  const fab = h('button', { class: 'menu-fab' + (closed ? ' show' : ''), title: '메뉴 보이기', onclick: () => setClosed(false) }, '☰');
  const nav = h('nav', { class: 'side' + (closed ? ' closed' : '') },
    h('div', { class: 'brand' }, h('span', null, '학급관리'), tog),
    TABS.map((t) => h('button', { class: 'nav-btn' + (S.tab === t.id ? ' active' : ''), onclick: () => go(t.id) },
      h('span', null, t.name), t.pw ? h('span', { class: 'lock', title: S.unlocked ? '열려 있음' : '잠김' }, APP.lockIc(!S.unlocked)) : null)),
    h('div', { class: 'spacer' }),
    S.unlocked ? h('button', { class: 'ghost sm', onclick: () => { lock(); toast('잠갔습니다'); } }, APP.lockIc(true), ' 지금 잠그기') : null,
    DEMO ? h('div', { class: 'who' }, '데모 모드') : null,
    DEMO ? null : h('button', { class: 'ghost sm', onclick: logout }, '로그아웃'), togM);
  root.append(h('div', { class: 'shell' }, nav, h('main', { class: 'main', id: 'main' })), fab);
  document.body.classList.toggle('nav-off', closed);
  renderPage();
}
async function go(id) {
  const leaving = S.tab === 'setup' && id !== 'setup';
  if (leaving && S.rosterDirty && !await uiConfirm('저장하지 않은 명렬표 변경이 있습니다. 이동할까요?')) return;
  const t = TABS.find((x) => x.id === id);
  if (t.pw && !S.unlocked) return askPw(() => go(id));
  // 초기 비밀번호(000000)로는 다른 잠긴 메뉴를 쓸 수 없게 → 먼저 바꾸게 함
  if (t.pw && S.defaultPw && !DEMO && !(id === 'setup' && S.setupSub === 'data')) { S.setupSub = 'data'; S.tab = 'setup'; toast('초기 비밀번호(000000)를 먼저 바꿔 주세요'); renderShell(); return; }
  if (leaving) { S.rosterDraft = null; S.rosterDirty = false; S.seatDraft = null; }
  S.tab = id; renderShell();
}
/* 페이지 너비 4단계 (좁게·보통·넓게·기본) — 페이지마다 이 브라우저에 기억 */
const PW = [760, 1000, 1280, 0];
function renderPage() {
  const main = $('#main'); main.replaceChildren();
  const t = TABS.find((x) => x.id === S.tab);
  document.title = t.name + ' · 학급관리';
  let wi = 3; try { const v = localStorage.getItem('pw_' + S.tab); if (v != null) wi = Math.max(0, Math.min(3, Number(v) || 0)); } catch (e) { /* 기본 */ }
  const body = h('div', { class: 'page-body', style: PW[wi] && !['board', 'draw', 'submit', 'seat'].includes(S.tab) ? `max-width:${PW[wi]}px` : null });
  const tools = h('div', { class: 'pt-r' });
  const NOW = ['board', 'draw', 'submit', 'seat'];   // 너비 버튼을 두지 않는 페이지
  const wbtn = APP.widthCtl && !NOW.includes(S.tab) ? APP.widthCtl(wi, 4, (k) => { try { localStorage.setItem('pw_' + S.tab, k); } catch (e) { /* 저장 안 됨 */ } renderPage(); }) : null;
  if (wbtn) tools.append(wbtn);
  const center = h('div', { class: 'pt-c' });
  const top = h('div', { class: 'page-top' }, h('div', { class: 'pt-l' }), center, tools);
  S._tools = tools; S._wbtn = wbtn;
  let page;
  if (S.tab === 'setup') page = pageSetup();
  else if (S.tab === 'submit') page = pageSubmit();
  else if (APP.pages[S.tab]) page = APP.pages[S.tab]();
  else page = h('div', { class: 'card placeholder' }, '이 메뉴는 준비 중입니다.');
  body.append(page); main.append(top, body);
  // 페이지 맨 위 하위 메뉴(탭)는 가운데 줄로 옮김 (너비 버튼은 오른쪽 고정)
  const tabs = page && page.querySelector && [...page.children].find((x) => x.classList && x.classList.contains('tabs'));
  if (tabs) center.append(tabs);
}
/* 페이지 오른쪽 위(너비 버튼 왼쪽)에 버튼 붙이기 */
/* 너비 버튼을 페이지 안 원하는 곳으로 옮기기 (대회 관리 등) */
function takeWidthBtn() { return S._wbtn || null; }
function pageTool(el) { if (S._tools && el) S._tools.insertBefore(el, S._wbtn || null); }
function lock() {
  S.unlocked = false; S.pw = ''; S.rosterDraft = null; S.rosterDirty = false; S.seatDraft = null;
  S.roster = S.roster.map((x) => ({ num: x.num, name: x.name, gender: x.gender, surname: x.surname || '' }));
  APP.onLock.forEach((f) => f());
  if (TABS.find((x) => x.id === S.tab).pw) S.tab = 'board';
  renderShell();
}
function logout() { S.token = null; S.pw = ''; try { APP.google && APP.google.logout && APP.google.logout(); } catch (e) { /* 무시 */ } setTimeout(() => location.reload(), 150); }
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
// 이 페이지 안에서의 조작만 셈. 조작이 들어오면 먼저 "그동안 5분 넘게 비었는지" 확인해서 잠근 뒤에 시각을 갱신
['pointerdown', 'touchstart', 'mousedown', 'keydown', 'wheel', 'click'].forEach((ev) => document.addEventListener(ev, () => { autoLockSubmit(); lastAct = Date.now(); }, { passive: true, capture: true }));
// 다른 탭·앱으로 2분 넘게 나가 있다 돌아오면 비밀번호 메뉴를 잠금
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (S.unlocked && !S.rosterDirty && hiddenAt && Date.now() - hiddenAt > 2 * 60 * 1000) { lock(); toast('자리를 비워서 잠갔습니다'); }
});
// 제출확인 페이지·학급보드판에서 5분 동안 조작이 없으면 제출확인판을 모두 잠금
function autoLockSubmit() {
  if (!['submit', 'board'].includes(S.tab) || Date.now() - lastAct < 5 * 60 * 1000) return;
  let n = 0;
  (S.boards || []).forEach((b) => { if (!b.locked) { b.locked = true; n++; try { queueBoardSave(b); } catch (e) { /* 다음에 */ } } });
  const w = APP.classBoard && APP.classBoard.lockWidgets ? APP.classBoard.lockWidgets() : 0;
  if (n || w) { if (S.tab === 'submit') renderPage(); toast('5분 동안 조작이 없어 제출확인판을 잠갔어요'); }
}
setInterval(autoLockSubmit, 15000);
// 다른 창·앱에 있다가 돌아왔을 때도 바로 확인 (멈춰 있던 타이머 대비)
document.addEventListener('visibilitychange', () => { if (!document.hidden) autoLockSubmit(); });
window.addEventListener('focus', autoLockSubmit);
window.addEventListener('pageshow', autoLockSubmit);
setInterval(() => { if (S.unlocked && !S.rosterDirty && Date.now() - lastAct > 10 * 60 * 1000) { lock(); toast('10분간 사용이 없어 잠갔습니다'); } }, 30000);

/* =====================================================
   학급 기초설정
   ===================================================== */
function pageSetup() {
  const subs = [['roster', '학생 명렬표'], ['seat', '학급 자리 배치'], ['data', '데이터 관리']];
  if (S.defaultPw && !DEMO) S.setupSub = 'data';
  if (S.setupSub === 'pw') S.setupSub = 'data';
  const wrap = h('div', null,
    S.defaultPw ? h('div', { class: 'banner warn' }, DEMO ? '초기 비밀번호(000000)를 사용 중입니다. "데이터 관리"의 비밀번호 변경에서 바꿔 주세요.' : '안전을 위해 초기 비밀번호(000000)를 먼저 바꿔야 다른 메뉴를 쓸 수 있어요.') : null,
    h('div', { class: 'tabs' }, subs.map(([id, name]) => h('button', { class: 'tab' + (S.setupSub === id ? ' active' : ''), onclick: () => { S.setupSub = id; renderPage(); } }, name))));
  wrap.append(S.setupSub === 'roster' ? rosterEditor() : S.setupSub === 'seat' ? seatEditor() : h('div', { class: 'data-page' }, h('div', { class: 'data-top' }, iconEditor(), pwEditor()), dataEditor()));
  return wrap;
}

/* ---- 데이터 관리 ---- */
/* 체크한 항목을 시트 목록 [{ name, rows }]으로 모으기 (백업용) */
async function collectBackup(sel) {
  const out = [], R = (S.roster || []).slice().sort((a, b) => a.num - b.num), nmOf = (n, names) => { const s = R.find((x) => Number(x.num) === Number(n)); return s ? s.name : (names && names[n]) || n + '번'; };
  const kv1 = async (k) => (await APP.kvGet([k]))[k];
  const kvAll = async (prefix) => { const ks = (await APP.kvList(prefix)).map((x) => x.key); return ks.length ? APP.kvGet(ks) : {}; };
  if (sel.has('roster')) out.push({ name: '명렬표', rows: [FIELDS.map((f) => f[1]), ...R.map((r) => FIELDS.map(([k]) => (r[k] == null ? '' : r[k])))] });
  if (sel.has('logs')) {
    const logs = (await api('logsLoad')).logs.slice().sort((a, b) => (a.date === b.date ? a.created - b.created : a.date < b.date ? -1 : 1));
    out.push({ name: '누가기록', rows: [['날짜', '내용', '등장 학생', '사건 성격'], ...logs.map((l) => [l.date, l.content, l.names, l.tone || '자동'])] });
  }
  if (sel.has('survey')) {
    const main = await kv1('survey:main'), LV = { 4: '좋음', 3: '친해지고 싶음', 2: '그저 그럼', 1: '싫음' };
    if (main && main.v === 2 && main.rounds.length) {
      const vals = await APP.kvGet(main.rounds.map((r) => 'survey:r:' + r.id));
      main.rounds.forEach((r) => { const d = vals['survey:r:' + r.id] || {};
        out.push({ name: `교우관계_${r.name}`, rows: [[`${r.name} ${r.date || ''}`.trim() + ' (행: 평가한 학생, 열: 친구)', ...R.map((x) => x.name)], ...R.map((a) => [a.name, ...R.map((b) => (a.num === b.num ? '-' : LV[(d[a.num] || {})[b.num]] || ''))])] }); });
      const nv = await APP.kvGet(main.rounds.map((r) => 'survey:n:' + r.id)), CT = [['learn', '학습'], ['perf', '수행'], ['lunch', '점심'], ['out', '학교 밖']];
      main.rounds.forEach((r) => { const d = nv['survey:n:' + r.id]; if (!d || !Object.keys(d).length) return;
        const L = (m, c, p) => ((c === 'lead' ? m.lead : (m[c] || {})[p]) || []).map((n) => nmOf(n)).join(', ');
        out.push({ name: `지명_${r.name}`, rows: [['학생', ...CT.flatMap(([, n]) => [n + ' 함께', n + ' 싫음'])], ...R.map((a) => { const m = d[a.num] || {}; return [a.name, ...CT.flatMap(([c]) => [L(m, c, 'y'), L(m, c, 'n')])]; })] }); });
    } else if (main && (main.likes || main.dislikes)) {
      out.push({ name: '교우관계_예전 조사', rows: [['학생', '함께하고 싶은 친구', '어려운 친구'], ...R.map((a) => [a.name, ((main.likes || {})[a.num] || []).filter(Boolean).map((n) => nmOf(n)).join(', '), ((main.dislikes || {})[a.num] || []).filter(Boolean).map((n) => nmOf(n)).join(', ')])] });
    }
  }
  if (sel.has('perf') || sel.has('evals')) {
    const cfg = await kv1('grade:cfg');
    if (cfg) {
      const labels = cfg.labels || ['매우잘함', '잘함', '보통', '노력요함'], num = (v) => (v === '' || v == null || isNaN(Number(v)) ? '' : Number(v));
      if (sel.has('perf')) for (const sem of ['1', '2']) for (const sb of (cfg.perf || {})[sem] || []) {
        const d = (await kv1(`grade:perf:${sem}:${sb.id}`)) || { scores: {} }, sc = (n, it) => num(d.scores && d.scores[n] && d.scores[n][it.id]);
        const band = (it, v) => (v === '' ? '' : labels[v >= it.cuts[0] ? 0 : v >= it.cuts[1] ? 1 : v >= it.cuts[2] ? 2 : 3]);
        out.push({ name: `수행_${sem}학기_${sb.name || '과목'}`, rows: [['번호', '이름', ...sb.items.map((i) => `${i.name}(${i.max}점)`), ...sb.items.map((i) => `${i.name} 평어`)],
          ...R.map((s) => [s.num, s.name, ...sb.items.map((it) => sc(s.num, it)), ...sb.items.map((it) => band(it, sc(s.num, it)))]),
          [], ['기준 점수', '', ...sb.items.map((it) => labels.slice(0, 3).map((l, k) => `${l} ${it.cuts[k]}`).join(' / '))]] });
      }
      if (sel.has('evals')) for (const ev of cfg.evals || []) {
        const d = (await kv1('grade:eval:' + ev.id)) || {}, norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
        if (ev.type === 'answers') {
          const max = ev.items.reduce((a, i) => a + (Number(i.pts) || 0), 0);
          out.push({ name: `기타_${ev.name}`, rows: [['번호', '이름', ...ev.items.map((_, i) => `${i + 1}번`), `총점(${max}점)`], ['', '정답', ...ev.items.map((i) => i.ans), ''],
            ...R.map((s) => { const r = (d.answers || {})[s.num] || []; const has = r.some((x) => norm(x) !== ''); return [s.num, s.name, ...ev.items.map((_, i) => r[i] || ''), has ? ev.items.reduce((a, it, i) => a + (norm(r[i]) !== '' && norm(r[i]) === norm(it.ans) ? Number(it.pts) || 0 : 0), 0) : '']; })] });
        } else {
          const cols = ev.cols && ev.cols.length ? ev.cols : [{ id: 'c1', name: '점수' }];
          const rowOf = (n) => { const o = (d.scores || {})[n]; return o == null ? {} : typeof o === 'object' ? o : { c1: o }; };
          out.push({ name: `기타_${ev.name}`, rows: [['번호', '이름', ...cols.map((c) => `${c.name}(${ev.max}점)`), '평균', ev.cut != null ? `기준 ${ev.cut}점 도달` : ''], ...R.map((s) => {
            const r = rowOf(s.num), v = cols.map((c) => num(r[c.id])), ok = v.filter((x) => x !== ''), avg = ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length * 10) / 10 : '';
            return [s.num, s.name, ...v, avg, ev.cut != null && avg !== '' ? (avg >= ev.cut ? '도달' : '미도달') : ''];
          })] });
        }
      }
    }
  }
  if (sel.has('seat')) {
    const vals = await kvAll('seat:layout:');
    Object.values(vals).filter(Boolean).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0)).forEach((l) => {
      const rows = [[`${l.name} (위쪽이 칠판)`]], cn = l.colNames || [];
      if (cn.some(Boolean)) rows.push(Array.from({ length: l.cols }, (_, c) => cn[c] || ''));
      for (let r = 0; r < l.rows; r++) rows.push(Array.from({ length: l.cols }, (_, c) => { const i = r * l.cols + c, n = l.assign ? l.assign[i] : null; return l.cells[i] && n != null ? nmOf(n) : ''; }));
      if ((l.teams || []).length) { rows.push([], ['모둠', '구성원']); l.teams.forEach((t) => rows.push([t.name, t.cells.map((i) => (l.assign && l.assign[i] != null ? nmOf(l.assign[i]) : '')).filter(Boolean).join(', ')])); }
      out.push({ name: `자리_${l.name}`, rows });
    });
  }
  if (sel.has('role')) {
    const vals = await kvAll('role:set:'), rows = [['역할표', '양식', '줄', '역할명', '역할 설명', '담당자']];
    Object.values(vals).filter(Boolean).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0)).forEach((st) => (st.roles || []).forEach((r, i) => { if (r.name || r.desc || r.owner) rows.push([st.name, st.form || '', i + 1, r.name || '', r.desc || '', r.owner || '']); }));
    if (rows.length > 1) out.push({ name: '역할표', rows });
  }
  if (sel.has('roleForm')) {
    const vals = await kvAll('role:form:'), rows = [['양식 이름', '쪽 수', '입력 칸 수', '저장한 날짜']];
    Object.values(vals).filter(Boolean).forEach((f) => rows.push([f.name, f.pageCount || 1, (f.fields || []).length, f.savedAt ? new Date(f.savedAt).toLocaleDateString('ko-KR') : '']));
    if (rows.length > 1) { rows.push([], ['※ 양식 파일(PDF·사진)은 구글 드라이브의 "학급관리_파일" 폴더에 있어요.']); out.push({ name: '역할 양식 목록', rows }); }
  }
  if (sel.has('manito')) {
    const hist = (await kv1('draw:manito')) || [];
    if (hist.length) {
      const rows = [['회차', '날짜', '번호', '학생', '마니또']];
      hist.slice().sort((a, b) => (a.created || 0) - (b.created || 0)).forEach((m) => Object.entries(m.pairs || {}).sort((a, b) => a[0] - b[0]).forEach(([g, t]) => rows.push([m.name, m.date || '', Number(g), nmOf(g, m.names), nmOf(t, m.names)])));
      out.push({ name: '마니또 내역', rows });
    }
  }
  return out.filter((x) => x.rows.length > 1);
}

const clearSel = new Set();
function dataEditor() {
  const box = h('div', { class: 'card', style: 'max-width:760px' });
  const draw = () => {
    const btn = h('button', { class: 'danger', disabled: !clearSel.size, onclick: run }, clearSel.size ? `선택한 ${clearSel.size}개 삭제` : '삭제');
    const bk = h('button', { class: 'primary', disabled: !clearSel.size, onclick: backup }, clearSel.size ? `선택한 ${clearSel.size}개 백업` : '백업');
    box.replaceChildren(h('h3', null, '데이터 관리'),
      h('div', { class: 'muted', style: 'margin-bottom:12px;line-height:1.6' }, '데이터를 체크한 뒤 백업 또는 삭제를 누르세요. 백업은 지금 로그인한 구글 계정의 드라이브에 새 스프레드시트로 저장돼요. 삭제한 데이터는 되살릴 수 없으니 먼저 백업해 두세요.'),
      h('label', { class: 'clear-row all' }, h('input', { type: 'checkbox', checked: clearSel.size === CLEAR_ITEMS.length, onchange: (e) => { CLEAR_ITEMS.forEach(([k]) => (e.target.checked ? clearSel.add(k) : clearSel.delete(k))); draw(); } }), h('b', null, '전체 선택')),
      ...CLEAR_ITEMS.map(([k, n, desc]) => h('label', { class: 'clear-row' + (clearSel.has(k) ? ' on' : '') },
        h('input', { type: 'checkbox', checked: clearSel.has(k), onchange: (e) => { e.target.checked ? clearSel.add(k) : clearSel.delete(k); draw(); } }),
        h('span', null, h('b', null, n), h('span', { class: 'muted' }, ' · ' + desc)))),
      h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px;gap:8px' }, bkMsg, h('div', { style: 'flex:1' }), bk, btn));
  };
  const bkMsg = h('div', { class: 'muted' });
  async function backup() {
    box.querySelectorAll('button').forEach((b) => { b.disabled = true; }); bkMsg.textContent = '데이터를 모으는 중…';
    try {
      const sheets = await collectBackup(clearSel);
      if (!sheets.length) { toast('백업할 데이터가 없어요', true); return; }
      const title = `학급관리 백업 ${APP.today()}`;
      if (DEMO) { APP.xl.saveBlob(APP.xl.buildXlsx(sheets), title + '.xlsx'); bkMsg.textContent = '데모 모드라서 엑셀 파일로 내려받았어요.'; }
      else {
        bkMsg.textContent = '스프레드시트를 만드는 중…';
        const j = await api('exportSheet', { title, sheets });
        bkMsg.replaceChildren(`드라이브에 "${title}"을(를) 만들었어요 (시트 ${sheets.length}개). `, h('a', { href: j.url, target: '_blank', rel: 'noopener' }, '열기'));
      }
      toast('백업했어요');
    } catch (e) { bkMsg.textContent = ''; toast(errMsg(e), true); }
    finally { box.querySelectorAll('button').forEach((b) => { b.disabled = false; }); if (!clearSel.size) draw(); }
  }
  async function run() {
    const names = CLEAR_ITEMS.filter(([k]) => clearSel.has(k)).map(([, n]) => '· ' + n).join('\n');
    const typed = await uiPrompt(`아래 데이터를 삭제할까요? 되살릴 수 없어요.\n\n${names}\n\n계속하려면 "삭제"라고 입력하세요.`);
    if (typed == null) return;
    if (typed.trim() !== '삭제') return toast('"삭제"라고 입력해야 지워져요', true);
    box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      await api('clearData', { targets: [...clearSel] });
      if (clearSel.has('roster')) { S.roster = []; S.rosterDraft = null; S.rosterDirty = false; }
      APP.onLock.forEach((f) => f()); APP.onClear.forEach((f) => f());
      toast('선택한 데이터를 삭제했어요'); clearSel.clear(); draw();
    } catch (e) { toast(errMsg(e), true); draw(); }
  }
  draw();
  return box;
}

/* ---- 명렬표 ---- */
const FIELDS = [
  ['num', '번호'], ['name', '이름'], ['gender', '성별'], ['phone', '연락처'], ['birth', '생년월일'],
  ['note', '특기사항'], ['surname', '성씨'], ['title', '호칭'], ['b1', '비고1'], ['b2', '비고2'], ['b3', '비고3']
];
/* 붙여넣기·머리글 없는 파일의 열 순서 (예전 순서 + 성씨는 맨 끝) */
const ORDER_KEYS = ['num', 'name', 'gender', 'phone', 'birth', 'note', 'title', 'b1', 'b2', 'b3', 'surname'];
/* 성씨: 따로 적은 값이 있으면 그것, 없으면 이름이 2~3글자일 때 첫 글자 */
const autoSurname = (name) => { const n = String(name || '').trim(); return n.length >= 2 && n.length <= 3 ? n[0] : ''; };
const surnameOf = (st) => (st && String(st.surname || '').trim()) || autoSurname(st && st.name);
const givenName = (st) => { const n = String(st.name || '').trim(), sn = surnameOf(st); return sn && n.startsWith(sn) && n.length > sn.length ? n.slice(sn.length) : n; };
const blankRow = (num) => ({ num, name: '', gender: '', phone: '', birth: '', note: '', surname: '', title: '', b1: '', b2: '', b3: '' });
const byNum = (a, b) => Number(a.num) - Number(b.num);
/* 성별 인식: 남/여, 남성/여성, 남자/여자, M/F, male/female */
const normGender = (v) => { const t = String(v == null ? '' : v).trim().toLowerCase(); return /^(남|m)/.test(t) ? '남' : /^(여|f)/.test(t) ? '여' : ''; };
const ROSTER_HEADS = { num: ['번호', '출석번호', '학번', 'no', 'num', '번'], name: ['이름', '성명', '학생이름', '학생명', 'name'], gender: ['성별', '남녀', 'gender', 'sex'], phone: ['연락처', '전화번호', '전화', '휴대폰', '핸드폰', 'phone', 'tel'],
  birth: ['생년월일', '생일', '생년', 'birth', 'birthday'], note: ['특기사항', '특이사항', '메모', 'note'], title: ['호칭', '별칭', '애칭', '부르는이름'], surname: ['성씨', '성'], b1: ['비고1', '비고 1'], b2: ['비고2', '비고 2'], b3: ['비고3', '비고 3'] };
const ROSTER_TEMPLATE_HEAD = ['출석번호', '이름', '성별', '연락처', '생년월일', '특기사항', '성씨', '호칭', '비고1', '비고2', '비고3'];
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
  if (map.name != null) start = 1; else { Object.keys(map).forEach((k) => delete map[k]); ORDER_KEYS.forEach((k, i) => { map[k] = i; }); if (isNaN(Number(rows[0][0])) && rows[0][0] !== '') start = 1; }
  const warn = [], list = [], seen = new Set();
  rows.slice(start).forEach((r, i) => {
    const o = blankRow(0); keys.forEach((k) => { if (map[k] != null && r[map[k]] != null) o[k] = String(r[map[k]]).trim(); });
    if (!o.name) { if (o.num || o.phone) warn.push(`${i + 1}번째 줄: 이름이 없어 건너뛰었어요`); return; }
    const raw = o.gender; o.gender = normGender(o.gender);
    if (raw && !o.gender) warn.push(`${o.name}: 성별 "${raw}"을(를) 알아보지 못했어요 (비워 둠)`);
    if (!raw) warn.push(`${o.name}: 성별이 비어 있어요`);
    if (!o.surname) o.surname = autoSurname(o.name);
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
        if (k === 'surname' && !String(r.surname || '').trim() && autoSurname(r.name)) r.surname = autoSurname(r.name);
        control = h('input', { value: r[k] == null ? '' : r[k], inputmode: k === 'num' ? 'numeric' : null, class: k === 'surname' ? 'sn' : null, oninput: (e) => {
          r[k] = e.target.value; dirty();
          if (k === 'name') { const sn = tr.querySelector('input.sn'); if (sn && (!sn.value || sn.dataset.auto === '1')) { sn.value = autoSurname(r.name); r.surname = sn.value; sn.dataset.auto = '1'; } }
          if (k === 'surname') e.target.dataset.auto = '';
        } });
      }
      tr.append(h('td', { class: k === 'num' ? 'num' : k === 'gender' ? 'gender' : k === 'surname' ? 'surname' : null }, control));
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
        S.rosterDirty = true; closeUp(); close(); renderPage(); toast(`${list.length}명을 적용했어요. 저장을 눌러 확정하세요`);
      } }, '적용'))));
    document.body.append(ov);
  };
  const tplRows = () => [ROSTER_TEMPLATE_HEAD, ...Array.from({ length: 35 }, (_, i) => [i + 1])];
  let upOv = null;
  const closeUp = () => { if (upOv) { upOv.remove(); upOv = null; } };
  const openUpload = () => { closeUp(); upMsg.replaceChildren(); upOv = h('div', { class: 'overlay', onclick: (e) => { if (e.target === upOv) closeUp(); } }, h('div', { class: 'modal xdlg' }, ...uploadBody())); document.body.append(upOv); };
  const uploadBody = () => [
    h('h3', null, '엑셀·CSV 파일로 일괄 등록'),
    h('div', { class: 'muted', style: 'line-height:1.7' }, '1) 양식을 받아서 학생 정보를 채우세요.  2) 엑셀로 저장한 파일(.xlsx)이나 CSV를 올리면 한 번에 등록돼요.  성별은 "남/여", "남성/여성", "남자/여자", M/F 모두 알아봐요. 첫 줄 제목의 순서가 바뀌어도 괜찮아요.'),
    h('div', { class: 'row gap', style: 'margin-top:10px' },
      h('button', { class: 'sm', onclick: () => APP.xl.saveBlob(APP.xl.buildXlsx([
        { name: '명렬표', rows: tplRows(), genderCol: 2, widths: [10, 12, 8, 16, 14, 24, 8, 10, 12, 12, 12] },
        { name: '작성 안내', rows: [['작성 방법'], ['출석번호와 이름은 꼭 채워 주세요. 이름이 없는 줄은 건너뜁니다.'], ['성별은 남 / 여 (남성, 여성, 남자, 여자도 인식해요).'], ['호칭: 친구들이 부르는 이름이에요. 예) 김철수 → 철수'], ['생년월일은 2015-03-02 처럼 적으면 돼요.'], ['작성한 뒤 .xlsx 로 저장해서 올려 주세요.']], widths: [70], header: true }]), '명렬표_업로드양식.xlsx') }, '양식 내려받기 (.xlsx)'),
      DEMO ? null : h('button', { class: 'sm', onclick: async () => {
        try { const j = await api('exportSheet', { title: '명렬표 업로드 양식', sheets: [{ name: '명렬표', rows: tplRows() }] }); upMsg.replaceChildren('양식을 만들었어요. ', h('a', { href: j.url, target: '_blank', rel: 'noopener' }, '구글 스프레드시트 열기'), ' — 작성 후 "파일 → 다운로드 → Microsoft Excel(.xlsx)"로 저장해서 올려 주세요.'); } catch (x) { toast(errMsg(x), true); }
      } }, '구글 스프레드시트 양식 만들기'),
      h('button', { class: 'primary sm', onclick: () => upFile.click() }, '파일 올리기'), upFile),
    upMsg,
    h('div', { class: 'row', style: 'margin-top:12px;justify-content:flex-end' }, h('button', { onclick: closeUp }, '닫기'))];

  return h('div', null,
    h('div', { class: 'card' },
      h('div', { class: 'row gap' },
        h('button', { class: 'sm', onclick: () => { rows.push(blankRow((rows.reduce((m, r) => Math.max(m, Number(r.num) || 0), 0)) + 1)); S.rosterDirty = true; renderPage(); } }, '+ 학생 추가'),
        h('button', { class: 'sm', onclick: openUpload }, '엑셀·CSV 업로드'),
        h('span', { class: 'legend' }, h('span', null, h('i', { class: 'dot m' }), '남'), h('span', null, h('i', { class: 'dot f' }), '여')),
        h('div', { style: 'flex:1' }), dirtyEl, saveBtn),
      h('div', { class: 'table-wrap' }, table),
      h('div', { class: 'muted', style: 'margin-top:8px' }, '성별을 고르면 줄 색이 자동으로 바뀝니다. 이름 3글자 대신 "철수"처럼 부르는 이름은 "호칭"에 적어 두세요.')));
}

/* ---- 비밀번호 변경 ---- */
function pwEditor() {
  const a = h('input', { type: 'password', placeholder: '새 비밀번호 (6자 이상)', autocomplete: 'new-password' });
  const b = h('input', { type: 'password', placeholder: '새 비밀번호 확인', autocomplete: 'new-password' });
  return h('div', { class: 'card', style: 'max-width:420px' },
    h('h3', null, '비밀번호 변경'),
    h('div', { class: 'muted', style: 'font-size:13px;margin-bottom:8px' }, '학생이 짐작하기 어려운 6자 이상으로 정해 주세요. 같은 숫자 반복이나 123456은 안 돼요.'),
    h('div', { class: 'pw-row' }, a, b,
    h('button', { class: 'primary', onclick: async () => {
      if (a.value.length < 6) return toast(ERR.SHORT, true);
      if (a.value !== b.value) return toast('비밀번호 확인이 일치하지 않습니다', true);
      try { await api('changePw', { newPw: a.value }); S.pw = a.value; S.defaultPw = false; toast('비밀번호를 바꿨습니다'); renderPage(); }
      catch (e) { toast(errMsg(e), true); }
    } }, '변경')));
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

  const seatSave = h('button', { class: 'primary', onclick: async () => {
    try { await api('saveSeat', { seat: d }); S.seat = clone(d); toast('자리 설정을 저장했습니다'); }
    catch (e) { toast(errMsg(e), true); }
  } }, '자리 설정 저장');
  const left = h('div', { class: 'card' },
    h('div', { class: 'row gap' },
      h('span', null, '가로'), colsIn, h('span', null, '× 세로'), rowsIn,
      h('span', { class: 'muted' }, `사용 자리 ${active}개 / 학생 ${S.roster.length}명`), h('div', { style: 'flex:1' }), seatSave),
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
    h('div', { class: 'seat-rt' }, h('div', { class: 'seat-rt-l' },
    h('div', { class: 'card' }, h('h3', null, '자리 배치 규칙'),
      h('div', { class: 'radios' }, MODES.map(([v, n]) => h('label', null, h('input', { type: 'radio', name: 'mode', checked: d.mode === v, onchange: () => { d.mode = v; } }), n))),
      h('label', { class: 'row', style: 'gap:6px;margin-top:10px;cursor:pointer' }, h('input', { type: 'checkbox', checked: !!d.teamBalance, onchange: (e) => { d.teamBalance = e.target.checked; } }), '모둠에 남녀 최대한 같은 비율로'),
      h('div', { class: 'muted', style: 'margin-top:4px;line-height:1.6' }, '체크하면 위의 짝 규칙을 기본으로 하되, 모든 모둠을 합쳐서 남녀 비율이 최대한 1:1에 가깝도록 맞춰요. (학급 전체 성비가 1:1이 아니면 그 비율에 맞춰요)')),
    h('div', { class: 'card' }, h('h3', null, '같은 짝·모둠 반복 방지'),
      h('div', { class: 'row' }, h('span', null, '최근'), repIn, h('span', null, '번 동안 같은 짝·모둠이 되지 않게 (0 = 사용 안 함)')))),
    h('div', { class: 'card seat-teams' }, h('h3', null, '모둠 구성'),
      d.teams.length ? d.teams.map((t, ti) => h('div', { class: 'list-item' },
        h('span', { class: 'dot', style: `background:${TEAM_COLORS[ti % TEAM_COLORS.length]}` }),
        h('input', { value: t.name, maxlength: 12, style: 'flex:1;min-width:0', oninput: (e) => { t.name = e.target.value; }, onchange: () => rerender() }),
        h('span', { class: 'muted' }, `${t.cells.length}자리`),
        h('button', { class: 'sm ghost', onclick: () => { d.teams.splice(ti, 1); rerender(); } }, '✕')))
        : h('div', { class: 'muted' }, '왼쪽에서 "모둠 지정"을 고르고 여러 자리를 누른 뒤 "모둠 만들기"를 눌러 주세요.'))),
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
        h('button', { class: 'sm ghost', onclick: () => { d.avoid.splice(i, 1); rerender(); } }, '✕'))))
    );

  if (!S.roster.length) return h('div', { class: 'card placeholder' }, '먼저 "학생 명렬표"를 입력해 주세요.');
  return h('div', { class: 'seat-layout' }, left, right);
}

/* =====================================================
   제출확인
   ===================================================== */
let saveTimers = {};
const subPer = () => { try { const v = Number(localStorage.getItem('sub_per')); return v >= 1 && v <= 4 ? v : 0; } catch (e) { return 0; } };
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
  loadSubCfg();
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
  } }, APP.lockIc(true), ' 전체 잠금/해제');
  const fsBtn = h('button', { onclick: () => { document.fullscreenElement ? document.exitFullscreen() : (wrap.requestFullscreen && wrap.requestFullscreen()); } }, '전체화면');
  const cfgBtn = h('button', { onclick: () => subSettings() }, '설정');
  // 한 줄에 제출확인판 몇 개 (누를 때마다 1→2→3→4→3→2→1)
  const perBtn = h('button', { class: 'has-ic per-btn', 'data-noic': '1', onclick: () => {
    let v = subPer() || 2; if (v >= 4) S.perDir = -1; else if (v <= 1) S.perDir = 1; v += S.perDir || 1;
    try { localStorage.setItem('sub_per', v); } catch (e) { /* 저장 안 됨 */ } drawPer(); layout();
  } });
  const drawPer = () => { const v = subPer(); perBtn.replaceChildren(APP.icon('grid4'), h('b', null, v ? String(v) : '자동')); perBtn.title = `한 줄에 제출확인판 ${v || '자동'}개 (누를 때마다 바뀌어요)`; };
  drawPer();
  const bar = h('div', { class: 'sub-bar' }, addBtn, allLock, fsBtn, cfgBtn, perBtn, saveState, h('span', { class: 'muted' }, '한 번 누르면 제출(회색), 두 번 빠르게 누르면 확인(연두색)'));
  const C = subCfg();
  const shownName = (st) => (C.mode === 'given' ? givenName(st) : st.name);
  if (C.num) area.classList.add('with-num');
  wrap.append(bar, area);

  function syncLock(e) {
    const b = e.board;
    e.title.disabled = b.locked; e.lockBtn.replaceChildren(APP.lockIc(b.locked)); e.lockBtn.title = b.locked ? '잠김 (눌러서 풀기)' : '열림 (눌러서 잠그기)'; e.lockBtn.className = 'sm has-ic ic-only' + (b.locked ? ' primary' : '');
    e.del.disabled = b.locked; e.el.classList.toggle('locked', b.locked);
  }
  function addBoard(b) {
    const doneSet = new Set(b.done), greenSet = new Set(b.green || []); b.doneAt = b.doneAt || {};
    const stamp = (num, on) => { if (on) b.doneAt[num] = Date.now(); else delete b.doneAt[num]; };
    const count = h('span', { class: 'count' });
    const up = () => { count.textContent = `${doneSet.size + greenSet.size}/${n}`; };
    const paint = (cell, num) => {
      cell.classList.toggle('done', doneSet.has(num)); cell.classList.toggle('green', greenSet.has(num));
      const t = cell.querySelector('.ts'); if (t) t.textContent = doneSet.has(num) && b.doneAt[num] ? mdw(b.doneAt[num]) : '';
    };
    const commit = () => { b.done = [...doneSet].sort((x, y) => x - y); b.green = [...greenSet].sort((x, y) => x - y); up(); queueBoardSave(b); if (APP.classBoard) APP.classBoard.refresh(); };
    const title = h('input', { class: 'title', value: b.title, placeholder: '과제명', oninput: (ev) => { b.title = ev.target.value; queueBoardSave(b); if (APP.classBoard) APP.classBoard.refresh(); } });
    const lockBtn = h('button', { 'data-noic': '1', onclick: () => { b.locked = !b.locked; queueBoardSave(b); syncLock(e); } });
    const del = h('button', { class: 'sm ghost', title: '삭제', onclick: async () => {
      if (!await uiConfirm(`"${b.title || '제목 없음'}" 제출판을 삭제할까요?`)) return;
      try { await api('deleteBoard', { id: b.id }); S.boards = S.boards.filter((x) => x.id !== b.id); entries.splice(entries.indexOf(e), 1); e.el.remove(); syncEmpty(); layout(); if (APP.classBoard) APP.classBoard.refresh(); }
      catch (x) { toast(errMsg(x), true); }
    } }, '✕');
    const reset = h('button', { class: 'sm ghost', title: '제출 표시 모두 지우기', onclick: async () => {
      if (b.locked || !await uiConfirm('이 제출판의 제출 표시를 모두 지울까요?')) return;
      doneSet.clear(); greenSet.clear(); b.doneAt = {}; grid.querySelectorAll('.scell').forEach((c) => { c.classList.remove('done', 'green'); const t = c.querySelector('.ts'); if (t) t.textContent = ''; }); commit();
    } }, '초기화');
    const grid = h('div', { class: 'sbd-grid', style: `grid-template-columns:repeat(${cols},var(--cw))` }, roster.map((st) => {
      // 글자 크기: 3글자 기준. 1~3글자는 같은 크기, 4글자부터 줄이고, 너무 작아지면 두 줄로
      const nm = shownName(st), L = [...nm].length;
      let r = 1, wrapCls = '';
      if (L > 3) { r = 3 / L; if (r < 0.62) { r = Math.min(1, 3 / Math.ceil(L / 2)); wrapCls = ' wrap2'; } }
      const cell = h('div', { class: 'scell' + wrapCls, style: `--r:${r.toFixed(3)}` }, C.num ? h('span', { class: 'no' }, st.num) : null, h('span', { class: 'nm' }, nm), C.ts ? h('span', { class: 'ts' }) : null);
      paint(cell, st.num);
      let tapTimer = null;
      cell.addEventListener('click', () => {
        if (b.locked) return;
        if (tapTimer) {   // 두 번 빠르게 → 연두색(확인)
          clearTimeout(tapTimer); tapTimer = null;
          doneSet.delete(st.num); stamp(st.num, false); greenSet.add(st.num); paint(cell, st.num); commit(); return;
        }
        tapTimer = setTimeout(() => {   // 한 번 → 노랑↔회색, 연두색이면 회색
          tapTimer = null;
          if (greenSet.has(st.num)) { greenSet.delete(st.num); doneSet.add(st.num); stamp(st.num, true); }
          else if (doneSet.has(st.num)) { doneSet.delete(st.num); stamp(st.num, false); } else { doneSet.add(st.num); stamp(st.num, true); }
          paint(cell, st.num); commit();
        }, 260);
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
    const per = subPer();
    const pc = per ? Math.min(per, cnt) : 0;   // 한 줄에 보여 줄 개수를 정했으면 그것만
    for (let r = pc ? Math.ceil(cnt / pc) : 1; r <= (pc ? Math.ceil(cnt / pc) : cnt); r++) {
      const c = pc || Math.ceil(cnt / r);
      const slotW = (W - (c - 1) * GAP) / c, slotH = (H - (r - 1) * GAP) / r;
      const narrow = slotW < 400, hd = narrow ? 84 : HEAD;
      const sw = (slotW - PAD - (cols - 1) * CG) / cols, sh = (slotH - hd - PAD - (rows - 1) * CG) / rows;
      const cw = Math.min(sw, sh * 1.6), ch = Math.min(sh, cw);   // 이름이 가로로 길어서 칸을 약간 넓게
      if (!best || cw * ch > best.cw * best.ch) best = { r, c, cw, ch, narrow };
    }
    const cw = Math.max(14, Math.min(220, Math.floor(best.cw))), ch = Math.max(12, Math.min(150, Math.floor(best.ch)));
    area.style.height = H + 'px';
    entries.forEach((e) => e.el.classList.toggle('narrow', best.narrow));
    area.style.setProperty('--cw', cw + 'px'); area.style.setProperty('--ch', ch + 'px');
    // 3글자 이름이 칸에 꼭 맞는 글자 크기 (번호를 함께 쓰면 조금 작게)
    const lines = (C.num ? 1 : 0) + (C.ts ? 1 : 0);
    area.style.setProperty('--fsb', Math.max(8, Math.floor(Math.min(cw * 0.28, ch * [0.46, 0.36, 0.3][lines]))) + 'px');
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
/* 학급보드판의 제출확인 상자에서 쓰는 이름 (제출확인판 설정과 같게) */
const subDisplayName = (st) => (subCfg().mode === 'given' ? givenName(st) : st.name);
/* 11월 26일 (목) */
const mdw = (t) => { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`; };
/* 제출확인판 설정: 표기할 이름(성+이름 / 이름만), 번호 표시 */
function subCfg() {
  if (!S.subCfg) { try { S.subCfg = JSON.parse(localStorage.getItem('sub_cfg') || 'null'); } catch (e) { /* 없음 */ } }
  return Object.assign({ mode: 'full', num: false, ts: false }, S.subCfg || {});
}
let subCfgLoaded = false;
async function loadSubCfg() {
  if (subCfgLoaded) return; subCfgLoaded = true;
  try { const v = await kvGet(['submit:cfg']); if (v['submit:cfg']) { S.subCfg = v['submit:cfg']; localStorage.setItem('sub_cfg', JSON.stringify(S.subCfg)); if (S.tab === 'submit') renderPage(); } } catch (e) { /* 기본값 */ }
}
function subSettings() {
  const c = subCfg();
  const close = () => ov.remove();
  const radio = (v, label) => h('label', { class: 'opt' }, h('input', { type: 'radio', name: 'sbm', checked: c.mode === v, onchange: () => { c.mode = v; } }), h('span', null, label));
  const ov = h('div', { class: 'overlay' }, h('div', { class: 'modal sub-cfg' }, h('h3', null, '제출확인판 설정'),
    h('div', { class: 'opt-title' }, '카드에 표기할 이름'),
    radio('full', '성+이름 (예: 김민준)'), radio('given', '이름만 (예: 민준)'),
    h('div', { class: 'opt-title' }, '표시 형식'),
    h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: c.num, onchange: (e) => { c.num = e.target.checked; } }), h('span', null, '번호 표시')),
    h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: c.ts, onchange: (e) => { c.ts = e.target.checked; } }), h('span', null, '타임스탬프 (제출한 날짜)')),
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' }, h('button', { onclick: close }, '취소'),
      h('button', { class: 'primary', onclick: async () => {
        S.subCfg = c; try { localStorage.setItem('sub_cfg', JSON.stringify(c)); } catch (e) { /* 저장 안 됨 */ }
        close(); renderPage();
        try { await api('kvSet', { key: 'submit:cfg', value: JSON.stringify(c) }); } catch (e) { /* 이 기기에는 저장됨 */ }
      } }, '적용'))));
  document.body.append(ov);
}
document.addEventListener('fullscreenchange', () => setTimeout(() => relayoutSub && relayoutSub(), 60));

/* ---------- 다른 파일(page_*.js)에서 쓰는 공통 도구 ---------- */
async function kvGet(keys) {
  const j = await api('kvGet', { keys });
  const o = {}; keys.forEach((k) => { o[k] = j.values[k] == null ? null : JSON.parse(j.values[k]); }); return o;
}
const APP = window.APP = {
  S, h, $, api, toast, errMsg, clone, byNum, ERR, gcls, DEMO,
  pages: {}, onLock: [], onClear: [], clearPlan, subDisplayName: (st) => subDisplayName(st), byNum, queueBoardSave: (b) => queueBoardSave(b),
  renderPage: () => renderPage(), pageTool: (el) => pageTool(el), takeWidthBtn: () => takeWidthBtn(),
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

/* 숫자 입력칸에 커서가 있을 때 마우스 휠로 값이 바뀌지 않게 (화면 스크롤만) */
document.addEventListener('wheel', (e) => {
  const t = e.target;
  if (t && t.tagName === 'INPUT' && t.type === 'number' && document.activeElement === t) {
    e.preventDefault();
    window.scrollBy({ top: e.deltaY, left: e.deltaX });
  }
}, { passive: false });
