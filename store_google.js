/* 로그인한 구글 계정의 드라이브에 직접 저장하는 저장소
 * - 서버(Apps Script) 없이 브라우저가 구글 시트·드라이브를 직접 사용합니다.
 * - 로그인한 계정마다 그 계정의 드라이브에 "학급관리 데이터" 스프레드시트가 하나씩 만들어져요. (계정별로 완전히 분리)
 * - 권한은 "이 앱이 만든 파일"(drive.file)만 사용해요. 드라이브의 다른 파일은 볼 수 없어요. */
(() => {
'use strict';
const APP = window.APP, CFG = window.APP_CONFIG || {};
const SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.file';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SS_TITLE = '학급관리 데이터', FOLDER = '학급관리_파일', DEFAULT_PW = '000000';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets', DRIVE = 'https://www.googleapis.com/drive/v3/files', UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const CID_KEY = 'classapp_client_id';
const clientId = () => CFG.CLIENT_ID || localStorage.getItem(CID_KEY) || '';

/* ---------------- 로그인 (토큰) ---------------- */
let tc = null, token = '', tokenExp = 0, email = '';
function waitGis() {
  return new Promise((res, rej) => { let n = 0; const t = () => { if (window.google && google.accounts && google.accounts.oauth2) return res(); if (++n > 100) return rej(new Error('GIS')); setTimeout(t, 150); }; t(); });
}
async function login(opts) {
  opts = opts || {};
  const cid = clientId(); if (!cid) throw new Error('NOCONFIG');
  await waitGis();
  await new Promise((res, rej) => {
    tc = google.accounts.oauth2.initTokenClient({
      client_id: cid, scope: SCOPE, hint: opts.hint || undefined,
      callback: (r) => {
        if (r.error) return rej(new Error(r.error));
        if (google.accounts.oauth2.hasGrantedAllScopes && !google.accounts.oauth2.hasGrantedAllScopes(r, DRIVE_SCOPE)) return rej(new Error('NOSCOPE'));
        token = r.access_token; tokenExp = Date.now() + (Number(r.expires_in || 3600) - 90) * 1000; res();
      },
      error_callback: (e) => rej(new Error((e && e.type) || 'popup_closed'))
    });
    tc.requestAccessToken({ prompt: opts.prompt == null ? 'select_account' : opts.prompt });
  });
  const u = await (await gf('https://www.googleapis.com/oauth2/v3/userinfo')).json();
  const prev = email; email = String(u.email || '').toLowerCase();
  return { email, changed: !!prev && prev !== email };
}
const hasToken = () => !!token && Date.now() < tokenExp;
function logout() {
  const t = token; token = ''; tokenExp = 0; email = '';
  try { if (t && window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(t, () => {}); } catch (e) { /* 무시 */ }
}

/* ---------------- 구글 요청 ---------------- */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function gf(url, opt) {
  opt = opt || {};
  if (!hasToken()) throw new Error('AUTH');
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { ...opt, headers: { Authorization: 'Bearer ' + token, ...(opt.headers || {}) } });
    if (r.ok) return r;
    if (r.status === 401) throw new Error('AUTH');
    if ((r.status === 429 || r.status >= 500) && i < 3) { await wait(1200 * (i + 1)); continue; }
    let msg = ''; try { msg = (await r.json()).error.message || ''; } catch (e) { /* 본문 없음 */ }
    const err = new Error(/has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(msg) ? 'APIOFF' : (r.status === 404 ? 'NOTFOUND' : r.status === 403 ? 'DENIED' : '구글 서버 오류 (' + r.status + ') ' + msg.slice(0, 120)));
    err.status = r.status; throw err;
  }
}
const gj = async (url, opt) => (await gf(url, opt)).json();
const jsonOpt = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const A = (name, range) => encodeURIComponent(`'${name}'` + (range ? '!' + range : ''));

/* ---------------- 스프레드시트 준비 ---------------- */
const T = {
  roster: { name: '명렬표', headers: ['번호', '이름', '성별', '연락처', '생년월일', '특기사항', '호칭', '비고1', '비고2', '비고3', '성씨'], cols: 'K' },
  boards: { name: '제출확인', headers: ['id', '제목', '잠금', '제출번호', '생성', '확인번호', '제출시각'], cols: 'G' },
  settings: { name: '설정', headers: ['key', 'value'], cols: 'B' },
  data: { name: '데이터', headers: ['key', 'value', 'updated'], cols: 'C' },
  logs: { name: '누가기록', headers: ['id', '날짜', '내용', '등장학생', '기록시각', '사건 성격', '관계'], cols: 'G' }
};
const ROSTER_KEYS = ['num', 'name', 'gender', 'phone', 'birth', 'note', 'title', 'b1', 'b2', 'b3', 'surname'];
let ssId = '', sheetIds = {}, folderId = '', ready = null, chain = Promise.resolve();
const rows = {};   // 탭별 메모리 사본 (머리글 제외)
const enqueue = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };   // 쓰기는 순서대로 하나씩

const boldReq = (sheetId) => ({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } });
const freezeReq = (sheetId) => ({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });
const setIds = (sheets) => { sheetIds = {}; (sheets || []).forEach((s) => { sheetIds[s.properties.title] = s.properties.sheetId; }); };

async function findOrCreate() {
  const key = 'classapp_ss_' + email;
  const cached = localStorage.getItem(key);
  if (cached) {
    try { const m = await gj(`${SHEETS}/${cached}?fields=spreadsheetId,sheets.properties`); ssId = cached; setIds(m.sheets); return; }
    catch (e) { if (e.message !== 'NOTFOUND' && e.message !== 'DENIED') throw e; localStorage.removeItem(key); }
  }
  const q = encodeURIComponent(`name = '${SS_TITLE}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`);
  const found = await gj(`${DRIVE}?q=${q}&fields=files(id,name)&pageSize=5&orderBy=createdTime`);
  if (found.files && found.files.length) {
    ssId = found.files[0].id; localStorage.setItem(key, ssId);
    const m = await gj(`${SHEETS}/${ssId}?fields=spreadsheetId,sheets.properties`); setIds(m.sheets); return;
  }
  const c = await gj(SHEETS, jsonOpt('POST', { properties: { title: SS_TITLE }, sheets: Object.values(T).map((t) => ({ properties: { title: t.name, gridProperties: { frozenRowCount: 1 } } })) }));
  ssId = c.spreadsheetId; localStorage.setItem(key, ssId); setIds(c.sheets);
  await gf(`${SHEETS}/${ssId}/values:batchUpdate`, jsonOpt('POST', { valueInputOption: 'RAW', data: Object.values(T).map((t) => ({ range: `'${t.name}'!A1`, values: [t.headers] })) }));
  await gf(`${SHEETS}/${ssId}:batchUpdate`, jsonOpt('POST', { requests: Object.values(T).map((t) => boldReq(sheetIds[t.name])) }));
}
async function ensureTabs() {
  const missing = Object.values(T).filter((t) => sheetIds[t.name] == null);
  if (!missing.length) return;
  const r = await gj(`${SHEETS}/${ssId}:batchUpdate`, jsonOpt('POST', { requests: missing.map((t) => ({ addSheet: { properties: { title: t.name, gridProperties: { frozenRowCount: 1 } } } })) }));
  r.replies.forEach((x) => { sheetIds[x.addSheet.properties.title] = x.addSheet.properties.sheetId; });
  await gf(`${SHEETS}/${ssId}/values:batchUpdate`, jsonOpt('POST', { valueInputOption: 'RAW', data: missing.map((t) => ({ range: `'${t.name}'!A1`, values: [t.headers] })) }));
  await gf(`${SHEETS}/${ssId}:batchUpdate`, jsonOpt('POST', { requests: missing.map((t) => boldReq(sheetIds[t.name])) }));
}
async function readAll() {
  const keys = Object.keys(T), qs = keys.map((k) => 'ranges=' + A(T[k].name, `A2:${T[k].cols}`)).join('&');
  const j = await gj(`${SHEETS}/${ssId}/values:batchGet?${qs}&valueRenderOption=FORMATTED_VALUE`);
  keys.forEach((k, i) => { rows[k] = ((j.valueRanges[i] && j.valueRanges[i].values) || []).map((r) => Array.from({ length: T[k].headers.length }, (_, c) => (r[c] == null ? '' : String(r[c])))); });
}
/* 예전에 만든 시트에 새 머리글(예: 누가기록 '사건 성격')을 한 번만 채워 넣기 */
async function fixHeaders() {
  const flag = 'classapp_hdr5_' + ssId;
  if (localStorage.getItem(flag)) return;
  for (const k of ['logs', 'roster', 'boards']) await gf(`${SHEETS}/${ssId}/values/${A(T[k].name, 'A1')}?valueInputOption=RAW`, jsonOpt('PUT', { values: [T[k].headers] }));
  localStorage.setItem(flag, '1');
}
function ensure(fresh) {
  if (!hasToken()) return Promise.reject(new Error('AUTH'));
  const first = !ready;
  if (first) ready = (async () => { await findOrCreate(); await ensureTabs(); await readAll(); await fixHeaders(); })().catch((e) => { ready = null; throw e; });
  return fresh && !first ? ready.then(() => readAll()) : ready;
}

/* ---------------- 탭 읽기/쓰기 ---------------- */
const rowNo = (i) => i + 2;
const upsert = (k, keyCol, row) => enqueue(async () => {
  let i = rows[k].findIndex((r) => r[keyCol] === row[keyCol]);
  if (i < 0) { i = rows[k].length; rows[k].push(row); } else rows[k][i] = row;
  await gf(`${SHEETS}/${ssId}/values/${A(T[k].name, 'A' + rowNo(i))}?valueInputOption=RAW`, jsonOpt('PUT', { values: [row] }));
});
const removeRow = (k, keyCol, key) => enqueue(async () => {
  const i = rows[k].findIndex((r) => r[keyCol] === key); if (i < 0) return;
  rows[k].splice(i, 1);
  await gf(`${SHEETS}/${ssId}:batchUpdate`, jsonOpt('POST', { requests: [{ deleteDimension: { range: { sheetId: sheetIds[T[k].name], dimension: 'ROWS', startIndex: i + 1, endIndex: i + 2 } } }] }));
});
const replaceAll = (k, data) => enqueue(async () => {
  rows[k] = data;
  await gf(`${SHEETS}/${ssId}/values/${A(T[k].name, `A2:${T[k].cols}`)}:clear`, jsonOpt('POST', {}));
  if (data.length) await gf(`${SHEETS}/${ssId}/values/${A(T[k].name, 'A2')}?valueInputOption=RAW`, jsonOpt('PUT', { values: data }));
});
const setting = (key) => { const r = rows.settings.find((x) => x[0] === key); return r ? r[1] : null; };
const setSetting = (key, value) => upsert('settings', 0, [key, String(value)]);

/* ---------------- 비밀번호 (이 브라우저에서 확인) ---------------- */
async function sha256(s) {
  if (window.crypto && crypto.subtle) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
  let h1 = 0x811c9dc5; for (const ch of s) { h1 ^= ch.charCodeAt(0); h1 = Math.imul(h1, 16777619) >>> 0; } return 'f' + h1.toString(16);
}
/* 비밀번호는 PBKDF2(20만 번 반복)로 바꿔서 저장 — 시트를 봐도 원래 비밀번호를 알아내기 어려움 */
const PBKDF2_N = 200000;
async function pbkdf2(pw, salt) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pw)), 'PBKDF2', false, ['deriveBits']);
  const b = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: PBKDF2_N }, k, 256);
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const newSalt = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return [...a].map((x) => x.toString(16).padStart(2, '0')).join(''); };
async function storePw(pw) {
  const salt = newSalt();
  await setSetting('salt', salt); await setSetting('pwAlgo', 'pbkdf2'); await setSetting('pwHash', await pbkdf2(pw, salt));
}
/* 틀린 횟수는 브라우저에 기억 → 새로고침해도 초기화되지 않음. 5번 틀리면 5분, 그 뒤로 틀릴 때마다 2배씩 기다림 */
const LK = 'classapp_pwlock';
const lockState = () => { try { return JSON.parse(localStorage.getItem(LK) || '{}'); } catch (e) { return {}; } };
const setLockState = (o) => { try { localStorage.setItem(LK, JSON.stringify(o)); } catch (e) { /* 저장 안 됨 */ } };
let checking = false, okCache = null;
async function checkPw(pw) {
  const ls = lockState();
  if (ls.until && Date.now() < ls.until) { const e = new Error('LOCKED'); e.wait = Math.ceil((ls.until - Date.now()) / 60000); throw e; }
  const stored = setting('pwHash'), salt = setting('salt') || '', algo = setting('pwAlgo');
  if (okCache && okCache.pw === String(pw) && okCache.hash === stored) return;
  let ok;
  if (!stored) ok = String(pw) === DEFAULT_PW;
  else if (algo === 'pbkdf2') ok = (await pbkdf2(pw, salt)) === stored;
  else ok = (await sha256(salt + ':' + String(pw))) === stored;
  if (!ok) {
    const f = (ls.fails || 0) + 1, o = { fails: f };
    if (f >= 5) o.until = Date.now() + 300000 * Math.pow(2, Math.min(5, f - 5));
    setLockState(o);
    const er = new Error(f >= 5 ? 'LOCKED' : 'PW'); if (o.until) er.wait = Math.ceil((o.until - Date.now()) / 60000); throw er;
  }
  if (ls.fails) setLockState({});
  okCache = { pw: String(pw), hash: stored };
  // 예전 방식으로 저장된 비밀번호는 맞게 입력했을 때 새 방식으로 바꿔 둠
  if (stored && algo !== 'pbkdf2' && !checking) { checking = true; storePw(pw).catch(() => {}).finally(() => { checking = false; }); }
}
const weakPw = (p) => /^(.)\1+$/.test(p) || ['123456', '1234567', '12345678', '123456789', '654321', 'password', 'qwerty', '111111', '000000'].includes(String(p).toLowerCase()) || p === DEFAULT_PW;
const isDefaultPw = () => !setting('pwHash');
const isProt = (k) => !k || k.indexOf('grade:') === 0 || k.indexOf('survey:') === 0;

/* ---------------- 명렬표 / 설정 / 제출판 / 누가기록 / 데이터 ---------------- */
function readRoster(full) {
  const out = [];
  rows.roster.forEach((r) => {
    if (r[0] === '' && r[1] === '') return;
    const o = { num: Number(r[0]) || 0, name: r[1], gender: r[2], surname: r[10] || '' };
    if (full) for (let i = 3; i < ROSTER_KEYS.length; i++) o[ROSTER_KEYS[i]] = r[i];
    out.push(o);
  });
  return out;
}
const readBoards = () => rows.boards.filter((r) => r[0] !== '').map((r) => { let done = []; try { done = JSON.parse(r[3] || '[]'); } catch (e) { /* 빈 값 */ } let green = [], doneAt = {}; try { green = JSON.parse(r[5] || '[]'); } catch (e) { /* 빈 값 */ } try { doneAt = JSON.parse(r[6] || '{}'); } catch (e) { /* 빈 값 */ } return { id: r[0], title: r[1], locked: r[2] === 'Y', done, green, doneAt, created: Number(r[4]) || 0 }; });

const kvRows = () => rows.data;
async function importDemo(db) {
  await ensure();
  const o = { ok: true };
  if (db.pw && db.pw !== DEFAULT_PW) await storePw(db.pw);
  await replaceAll('roster', (db.roster || []).map((r) => ROSTER_KEYS.map((k) => (r[k] == null ? '' : String(r[k]).slice(0, 500)))));
  if (db.seat) await setSetting('seat', JSON.stringify(db.seat));
  for (const b of db.boards || []) await upsert('boards', 0, [String(b.id), String(b.title || ''), b.locked ? 'Y' : 'N', JSON.stringify(b.done || []), String(b.created || Date.now()), JSON.stringify(b.green || []), JSON.stringify(b.doneAt || {})]);
  await replaceAll('logs', (db.logs || []).map((l) => [String(l.id), String(l.date), String(l.content || ''), String(l.names || ''), String(l.created || Date.now()), String(l.tone || ''), JSON.stringify(l.pairs || {})]));
  const idMap = {};
  for (const [id, f] of Object.entries(db.files || {})) { try { idMap[id] = (await upload(f.data, f.mime, f.name)).fileId; } catch (e) { /* 파일 하나 실패해도 계속 */ } }
  const kv = Object.entries(db.kv || {}).map(([k, v]) => {
    let val = v.v; if (k.indexOf('role:form:') === 0) { try { const j = JSON.parse(val); if (j.fileId && idMap[j.fileId]) { j.fileId = idMap[j.fileId]; val = JSON.stringify(j); } } catch (e) { /* 그대로 */ } }
    return [k, String(val), String(v.t || Date.now())];
  });
  await replaceAll('data', kv);
  return o;
}

/* ---------------- 드라이브 파일 ---------------- */
async function getFolder() {
  if (folderId) return folderId;
  const q = encodeURIComponent(`name = '${FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const f = await gj(`${DRIVE}?q=${q}&fields=files(id)&pageSize=1`);
  folderId = f.files && f.files.length ? f.files[0].id : (await gj(`${DRIVE}?fields=id`, jsonOpt('POST', { name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }))).id;
  return folderId;
}
const b64ToBytes = (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const bytesToB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
async function upload(b64, mime, name) {
  const bytes = b64ToBytes(String(b64 || '')); if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('TOOBIG');
  const parent = await getFolder(), bd = 'b' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: String(name || 'file').slice(0, 100), parents: [parent], mimeType: mime || 'application/octet-stream' });
  const body = new Blob([`--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${bd}\r\nContent-Type: ${mime || 'application/octet-stream'}\r\n\r\n`, bytes, `\r\n--${bd}--`]);
  const j = await gj(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${bd}` }, body });
  return { ok: true, fileId: j.id };
}

/* ---------------- 내보내기 (새 스프레드시트) ---------------- */
async function exportSheet(title, sheets) {
  sheets = (sheets || []).slice(0, 150); const used = {}, names = sheets.map((s) => {
    let n = String(s.name || '시트').replace(/[\[\]*?:/\\]/g, ' ').trim().slice(0, 90) || '시트', b = n, k = 2; while (used[n]) n = b.slice(0, 85) + ' ' + k++; used[n] = 1; return n;
  });
  const c = await gj(SHEETS, jsonOpt('POST', { properties: { title: String(title || '학급관리 내보내기').slice(0, 100) }, sheets: names.map((n) => ({ properties: { title: n, gridProperties: { frozenRowCount: 1 } } })) }));
  const data = sheets.map((s, i) => ({ range: `'${names[i]}'!A1`, values: (s.rows || []).slice(0, 20000).map((r) => r.map((v) => (v == null ? '' : v))) })).filter((d) => d.values.length);
  if (data.length) await gf(`${SHEETS}/${c.spreadsheetId}/values:batchUpdate`, jsonOpt('POST', { valueInputOption: 'RAW', data }));
  await gf(`${SHEETS}/${c.spreadsheetId}:batchUpdate`, jsonOpt('POST', { requests: c.sheets.map((s) => boldReq(s.properties.sheetId)) }));
  return { ok: true, url: c.spreadsheetUrl };
}
async function writeTable(name, data) {
  name = String(name || '').replace(/[\\/?*[\]:]/g, '_').slice(0, 90);
  if (name.indexOf('성적_') !== 0 || !Array.isArray(data) || !data.length || data.length > 500) throw new Error('BAD');
  await enqueue(async () => {
    let id = sheetIds[name];
    if (id == null) {
      const r = await gj(`${SHEETS}/${ssId}:batchUpdate`, jsonOpt('POST', { requests: [{ addSheet: { properties: { title: name } } }] }));
      id = sheetIds[name] = r.replies[0].addSheet.properties.sheetId;
    } else await gf(`${SHEETS}/${ssId}/values/${A(name)}:clear`, jsonOpt('POST', {}));
    await gf(`${SHEETS}/${ssId}/values/${A(name, 'A1')}?valueInputOption=RAW`, jsonOpt('PUT', { values: data.map((r) => r.map((v) => (v == null ? '' : v))) }));
    await gf(`${SHEETS}/${ssId}:batchUpdate`, jsonOpt('POST', { requests: [boldReq(id), freezeReq(id)] }));
  });
}

/* ---------------- 데이터 지우기 (학급 기초설정 → 데이터 관리) ---------------- */
async function clearData(targets) {
  const T_ = new Set(targets), plan = APP_CLEAR(T_);
  if (T_.has('roster')) await replaceAll('roster', []);
  if (T_.has('logs')) await replaceAll('logs', []);
  // 역할 양식 파일(드라이브)
  if (plan.files) for (const r of rows.data.filter((x) => x[0].indexOf('role:form:') === 0)) {
    try { const id = JSON.parse(r[1]).fileId; if (id) await gf(`${DRIVE}/${encodeURIComponent(id)}`, jsonOpt('PATCH', { trashed: true })); } catch (e) { /* 이미 없는 파일 */ }
  }
  if (plan.prefixes.length || plan.gradeCfg) {
    const keep = rows.data.filter((r) => r[0] !== '' && !plan.prefixes.some((p) => r[0] === p || r[0].indexOf(p) === 0)).map((r) => {
      if (r[0] !== 'grade:cfg' || !plan.gradeCfg) return r;
      try { const c = JSON.parse(r[1]); if (plan.gradeCfg.perf) c.perf = { '1': [], '2': [] }; if (plan.gradeCfg.evals) c.evals = []; return [r[0], JSON.stringify(c), String(Date.now())]; } catch (e) { return r; }
    });
    await replaceAll('data', keep);
  }
  // 시트에 내보낸 성적 탭(성적_…)도 지우기
  const tabs = Object.keys(sheetIds).filter((n) => n.indexOf('성적_') === 0 && ((plan.gradeCfg && plan.gradeCfg.perf && /^성적_[12]학기_/.test(n)) || (plan.gradeCfg && plan.gradeCfg.evals && !/^성적_[12]학기_/.test(n))));
  if (tabs.length) await enqueue(async () => {
    await gf(`${SHEETS}/${ssId}:batchUpdate`, jsonOpt('POST', { requests: tabs.map((n) => ({ deleteSheet: { sheetId: sheetIds[n] } })) }));
    tabs.forEach((n) => { delete sheetIds[n]; });
  });
  return { ok: true };
}
const APP_CLEAR = (t) => window.APP.clearPlan(t);

/* ---------------- 서버 동작 (예전 Apps Script와 같은 이름) ---------------- */
async function handle(action, d) {
  if (action === 'load') {
    await ensure(true);
    let full = false; if (d.pw) { await checkPw(d.pw); full = true; }
    const seat = setting('seat');
    return { ok: true, email, roster: readRoster(full), seat: seat ? JSON.parse(seat) : null, boards: readBoards(), defaultPw: isDefaultPw() };
  }
  await ensure();
  switch (action) {
    case 'unlock': await checkPw(d.pw); return { ok: true, roster: readRoster(true), defaultPw: isDefaultPw() };
    case 'saveRoster': {
      await checkPw(d.pw); if (!Array.isArray(d.rows) || d.rows.length > 200) throw new Error('BAD');
      await replaceAll('roster', d.rows.map((r) => ROSTER_KEYS.map((k) => (r[k] == null ? '' : String(r[k]).slice(0, 500))))); return { ok: true };
    }
    case 'saveSeat': await checkPw(d.pw); await setSetting('seat', JSON.stringify(d.seat)); return { ok: true };
    case 'changePw': {
      await checkPw(d.pw); const np = String(d.newPw || ''); if (np.length < 6) throw new Error('SHORT');
      if (weakPw(np)) throw new Error('WEAK'); await storePw(np); return { ok: true };
    }
    case 'saveBoard': {
      const b = d.board; if (!b || !b.id) throw new Error('BAD');
      await upsert('boards', 0, [String(b.id), String(b.title || '').slice(0, 200), b.locked ? 'Y' : 'N', JSON.stringify(b.done || []), String(b.created || Date.now()), JSON.stringify(b.green || []), JSON.stringify(b.doneAt || {})]); return { ok: true };
    }
    case 'deleteBoard': await removeRow('boards', 0, String(d.id)); return { ok: true };
    case 'kvGet': {
      const keys = (d.keys || []).map(String); if (keys.some(isProt)) await checkPw(d.pw);
      const m = {}; keys.forEach((k) => { m[k] = null; }); kvRows().forEach((r) => { if (Object.prototype.hasOwnProperty.call(m, r[0])) m[r[0]] = r[1]; });
      return { ok: true, values: m };
    }
    case 'kvList': {
      const p = String(d.prefix || ''); if (isProt(p)) await checkPw(d.pw);
      return { ok: true, keys: kvRows().filter((r) => r[0].indexOf(p) === 0).map((r) => ({ key: r[0], updated: Number(r[2]) || 0 })) };
    }
    case 'kvSet': {
      const key = String(d.key || ''); if (isProt(key)) await checkPw(d.pw);
      if (!/^[\w:.\- 가-힣]{1,120}$/.test(key)) throw new Error('BAD');
      const v = String(d.value); if (v.length > 45000) throw new Error('TOOBIG');
      await upsert('data', 0, [key, v, String(Date.now())]); return { ok: true };
    }
    case 'kvDel': { const key = String(d.key || ''); if (isProt(key)) await checkPw(d.pw); await removeRow('data', 0, key); return { ok: true }; }
    case 'logsLoad': await checkPw(d.pw); return { ok: true, logs: rows.logs.filter((r) => r[0] !== '').map((r) => ({ id: r[0], date: r[1], content: r[2], names: r[3], created: Number(r[4]) || 0, tone: r[5] || '', pairs: (() => { try { return JSON.parse(r[6] || '{}'); } catch (e) { return {}; } })() })) };
    case 'logSave': {
      await checkPw(d.pw); const l = d.log; if (!l || !l.id || !/^\d{4}-\d{2}-\d{2}$/.test(String(l.date))) throw new Error('BAD');
      await upsert('logs', 0, [String(l.id), String(l.date), String(l.content || '').slice(0, 5000), String(l.names || '').slice(0, 500), String(l.created || Date.now()), String(l.tone || ''), JSON.stringify(l.pairs || {}).slice(0, 2000)]); return { ok: true };
    }
    case 'logDel': await checkPw(d.pw); await removeRow('logs', 0, String(d.id)); return { ok: true };
    case 'clearData': await checkPw(d.pw); return clearData(d.targets || []);
    case 'writeTable': await checkPw(d.pw); await writeTable(d.name, d.rows); return { ok: true };
    case 'exportSheet': return exportSheet(d.title, d.sheets);
    case 'uploadFile': return upload(d.data, d.mime, d.name);
    case 'getFile': {
      const id = encodeURIComponent(String(d.fileId));
      const meta = await gj(`${DRIVE}/${id}?fields=name,mimeType`);
      const buf = new Uint8Array(await (await gf(`${DRIVE}/${id}?alt=media`)).arrayBuffer());
      return { ok: true, data: bytesToB64(buf), mime: meta.mimeType, name: meta.name };
    }
    case 'delFile': await gf(`${DRIVE}/${encodeURIComponent(String(d.fileId))}`, jsonOpt('PATCH', { trashed: true })); return { ok: true };
    default: throw new Error('UNKNOWN');
  }
}

APP.google = {
  clientId, setClientId: (v) => localStorage.setItem(CID_KEY, String(v || '').trim()), login, logout, hasToken, importDemo,
  api: (action, data) => handle(action, data || {}),
  email: () => email
};
})();
