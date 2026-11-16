/**
 * 학급관리 사이트 서버 (Google Apps Script)
 * - 구글 시트에서 [확장 프로그램 > Apps Script]로 열어 이 코드를 붙여넣으세요.
 * - 아래 CLIENT_ID를 본인의 OAuth 클라이언트 ID로 바꾸세요.
 */
const CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
const DEFAULT_PW = '000000';

const ROSTER_SHEET = '명렬표';
const ROSTER_HEADERS = ['번호', '이름', '성별', '연락처', '생년월일', '특기사항', '호칭', '비고1', '비고2', '비고3'];
const ROSTER_KEYS = ['num', 'name', 'gender', 'phone', 'birth', 'note', 'title', 'b1', 'b2', 'b3'];
const BOARD_SHEET = '제출확인';
const BOARD_HEADERS = ['id', '제목', '잠금', '제출번호', '생성'];
const KV_SHEET = '설정';

function doGet() {
  return ContentService.createTextOutput('학급관리 서버가 동작 중입니다.');
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    verify_(req.token);
    out = handle_(req);
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code) { throw new Error(code); }

/* ---------- 로그인 검증: 본인 구글 계정만 허용 ---------- */
function verify_(token) {
  if (!token) fail_('AUTH');
  const cache = CacheService.getScriptCache();
  const key = 't_' + hash_(token);
  if (cache.get(key)) return;
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) fail_('AUTH');
  const t = JSON.parse(res.getContentText());
  if (t.aud !== CLIENT_ID) fail_('AUTH');
  const left = Number(t.exp) - Math.floor(Date.now() / 1000);
  if (left <= 0) fail_('AUTH');
  const owner = String(Session.getEffectiveUser().getEmail()).toLowerCase();
  if (String(t.email).toLowerCase() !== owner || String(t.email_verified) !== 'true') fail_('FORBIDDEN');
  cache.put(key, '1', Math.min(600, left));
}

/* ---------- 비밀번호 ---------- */
function props_() { return PropertiesService.getScriptProperties(); }
function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function checkPw_(pw) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('fails') || 0);
  if (fails >= 5) fail_('LOCKED');
  const p = props_();
  const stored = p.getProperty('pwHash');
  const ok = stored ? hash_((p.getProperty('salt') || '') + ':' + String(pw)) === stored : String(pw) === DEFAULT_PW;
  if (!ok) { cache.put('fails', String(fails + 1), 300); fail_('PW'); }
  cache.remove('fails');
}
function isDefaultPw_() { return !props_().getProperty('pwHash'); }

/* ---------- 라우팅 ---------- */
function handle_(req) {
  switch (req.action) {
    case 'load': return load_(req);
    case 'unlock':
      checkPw_(req.pw);
      return { ok: true, roster: readRoster_(true), defaultPw: isDefaultPw_() };
    case 'saveRoster':
      checkPw_(req.pw);
      return locked_(function () { saveRoster_(req.rows); return { ok: true }; });
    case 'saveSeat':
      checkPw_(req.pw);
      return locked_(function () { setKV_('seat', JSON.stringify(req.seat)); return { ok: true }; });
    case 'changePw': {
      checkPw_(req.pw);
      const np = String(req.newPw || '');
      if (np.length < 6) fail_('SHORT');
      const salt = Utilities.getUuid();
      props_().setProperties({ salt: salt, pwHash: hash_(salt + ':' + np) });
      return { ok: true };
    }
    case 'saveBoard': return locked_(function () { saveBoard_(req.board); return { ok: true }; });
    case 'deleteBoard': return locked_(function () { deleteBoard_(req.id); return { ok: true }; });

    /* 범용 저장소 (성적·교우조사·자리 기록·역할 기록 등) */
    case 'kvGet': {
      const keys = (req.keys || []).map(String);
      if (keys.some(isProtKey_)) checkPw_(req.pw);
      return { ok: true, values: kvMany_(keys) };
    }
    case 'kvList': {
      const prefix = String(req.prefix || '');
      if (isProtKey_(prefix)) checkPw_(req.pw);
      return { ok: true, keys: kvKeys_(prefix) };
    }
    case 'kvSet': {
      const key = String(req.key || '');
      if (isProtKey_(key)) checkPw_(req.pw);
      return locked_(function () { kvPut_(key, req.value); return { ok: true }; });
    }
    case 'kvDel': {
      const key = String(req.key || '');
      if (isProtKey_(key)) checkPw_(req.pw);
      return locked_(function () { kvRemove_(key); return { ok: true }; });
    }

    /* 누가기록 (읽기 쉬운 시트로 저장) */
    case 'logsLoad': checkPw_(req.pw); return { ok: true, logs: readLogs_() };
    case 'logSave': checkPw_(req.pw); return locked_(function () { saveLog_(req.log); return { ok: true }; });
    case 'logDel': checkPw_(req.pw); return locked_(function () { deleteLog_(req.id); return { ok: true }; });

    /* 성적표를 시트에 보기 좋게 내보내기 */
    case 'writeTable': checkPw_(req.pw); return locked_(function () { writeTable_(req.name, req.rows); return { ok: true }; });

    /* 내보내기: 새 구글 스프레드시트를 만들어 주소를 돌려줌 */
    case 'exportSheet': return exportSheet_(req.title, req.sheets);

    /* 구글 드라이브 파일 (역할 양식 PDF) */
    case 'uploadFile': return uploadFile_(req);
    case 'getFile': return getFile_(String(req.fileId));
    case 'delFile': return delFile_(String(req.fileId));
    default: fail_('UNKNOWN');
  }
}

function load_(req) {
  let full = false;
  if (req.pw) { checkPw_(req.pw); full = true; }
  const seatJson = getKV_('seat');
  return {
    ok: true,
    email: Session.getEffectiveUser().getEmail(),
    roster: readRoster_(full),
    seat: seatJson ? JSON.parse(seatJson) : null,
    boards: readBoards_(),
    defaultPw: isDefaultPw_()
  };
}

function locked_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------- 시트 도우미 ---------- */
function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setNumberFormat('@').setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readRoster_(full) {
  const sh = sheet_(ROSTER_SHEET, ROSTER_HEADERS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, ROSTER_KEYS.length).getValues();
  const out = [];
  vals.forEach(function (r) {
    if (r[0] === '' && r[1] === '') return;
    const o = { num: Number(r[0]) || 0, name: String(r[1]), gender: String(r[2]) };
    if (full) for (let i = 3; i < ROSTER_KEYS.length; i++) o[ROSTER_KEYS[i]] = String(r[i]);
    out.push(o);
  });
  return out;
}

function saveRoster_(rows) {
  if (!Array.isArray(rows) || rows.length > 200) fail_('BAD');
  const sh = sheet_(ROSTER_SHEET, ROSTER_HEADERS);
  const old = sh.getLastRow();
  if (old > 1) sh.getRange(2, 1, old - 1, ROSTER_KEYS.length).clearContent();
  if (!rows.length) return;
  const data = rows.map(function (r) {
    return ROSTER_KEYS.map(function (k) { return r[k] === undefined || r[k] === null ? '' : String(r[k]).slice(0, 500); });
  });
  sh.getRange(2, 1, data.length, ROSTER_KEYS.length).setNumberFormat('@').setValues(data);
}

function getKV_(key) {
  const sh = sheet_(KV_SHEET, ['key', 'value']);
  const last = sh.getLastRow();
  if (last < 2) return null;
  const vals = sh.getRange(2, 1, last - 1, 2).getValues();
  for (let i = 0; i < vals.length; i++) if (vals[i][0] === key) return String(vals[i][1]);
  return null;
}
function setKV_(key, value) {
  const sh = sheet_(KV_SHEET, ['key', 'value']);
  const last = sh.getLastRow();
  if (last >= 2) {
    const keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (keys[i][0] === key) { sh.getRange(i + 2, 2).setNumberFormat('@').setValue(value); return; }
    }
  }
  sh.getRange(last + 1, 1, 1, 2).setNumberFormat('@').setValues([[key, value]]);
}

function readBoards_() {
  const sh = sheet_(BOARD_SHEET, BOARD_HEADERS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 5).getValues().filter(function (r) { return r[0] !== ''; }).map(function (r) {
    let done = [];
    try { done = JSON.parse(r[3] || '[]'); } catch (e) {}
    return { id: String(r[0]), title: String(r[1]), locked: String(r[2]) === 'Y', done: done, created: Number(r[4]) || 0 };
  });
}

function saveBoard_(b) {
  if (!b || !b.id) fail_('BAD');
  const sh = sheet_(BOARD_SHEET, BOARD_HEADERS);
  const row = [String(b.id), String(b.title || '').slice(0, 200), b.locked ? 'Y' : 'N', JSON.stringify(b.done || []), String(b.created || Date.now())];
  const last = sh.getLastRow();
  let target = last + 1;
  if (last >= 2) {
    const ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === row[0]) { target = i + 2; break; }
  }
  sh.getRange(target, 1, 1, 5).setNumberFormat('@').setValues([row]);
}

function deleteBoard_(id) {
  const sh = sheet_(BOARD_SHEET, BOARD_HEADERS);
  const last = sh.getLastRow();
  if (last < 2) return;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) { sh.deleteRow(i + 2); return; }
}

/* ---------- 범용 저장소 ('데이터' 시트) ---------- */
const DATA_SHEET = '데이터';
const LOG_SHEET = '누가기록';
const LOG_HEADERS = ['id', '날짜', '내용', '등장학생', '기록시각'];
const FOLDER_NAME = '학급관리_파일';

function isProtKey_(k) { return !k || k.indexOf('grade:') === 0 || k.indexOf('survey:') === 0; }
function dataSheet_() { return sheet_(DATA_SHEET, ['key', 'value', 'updated']); }
function kvRows_() {
  const sh = dataSheet_(), last = sh.getLastRow();
  return last < 2 ? [] : sh.getRange(2, 1, last - 1, 3).getValues();
}
function kvMany_(keys) {
  const m = {};
  keys.forEach(function (k) { m[k] = null; });
  kvRows_().forEach(function (r) { if (Object.prototype.hasOwnProperty.call(m, r[0])) m[r[0]] = String(r[1]); });
  return m;
}
function kvKeys_(prefix) {
  return kvRows_().filter(function (r) { return String(r[0]).indexOf(prefix) === 0; })
    .map(function (r) { return { key: String(r[0]), updated: Number(r[2]) || 0 }; });
}
function kvPut_(key, value) {
  if (!/^[\w:.\- 가-힣]{1,120}$/.test(key)) fail_('BAD');
  value = String(value);
  if (value.length > 45000) fail_('TOOBIG');
  const sh = dataSheet_(), last = sh.getLastRow();
  let target = last + 1;
  if (last >= 2) {
    const ks = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ks.length; i++) if (ks[i][0] === key) { target = i + 2; break; }
  }
  sh.getRange(target, 1, 1, 3).setNumberFormat('@').setValues([[key, value, String(Date.now())]]);
}
function kvRemove_(key) {
  const sh = dataSheet_(), last = sh.getLastRow();
  if (last < 2) return;
  const ks = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ks.length; i++) if (ks[i][0] === key) { sh.deleteRow(i + 2); return; }
}

/* ---------- 누가기록 ---------- */
function readLogs_() {
  const sh = sheet_(LOG_SHEET, LOG_HEADERS), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 5).getValues().filter(function (r) { return r[0] !== ''; }).map(function (r) {
    return { id: String(r[0]), date: String(r[1]), content: String(r[2]), names: String(r[3]), created: Number(r[4]) || 0 };
  });
}
function saveLog_(l) {
  if (!l || !l.id || !/^\d{4}-\d{2}-\d{2}$/.test(String(l.date))) fail_('BAD');
  const sh = sheet_(LOG_SHEET, LOG_HEADERS), last = sh.getLastRow();
  const row = [String(l.id), String(l.date), String(l.content || '').slice(0, 5000), String(l.names || '').slice(0, 500), String(l.created || Date.now())];
  let target = last + 1;
  if (last >= 2) {
    const ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === row[0]) { target = i + 2; break; }
  }
  sh.getRange(target, 1, 1, 5).setNumberFormat('@').setValues([row]);
  sh.setColumnWidth(3, 480);
}
function deleteLog_(id) {
  const sh = sheet_(LOG_SHEET, LOG_HEADERS), last = sh.getLastRow();
  if (last < 2) return;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) { sh.deleteRow(i + 2); return; }
}

/* ---------- 성적 내보내기 ('성적_' 로 시작하는 시트만) ---------- */
function writeTable_(name, rows) {
  name = String(name || '').replace(/[\\\/?*\[\]:]/g, '_').slice(0, 90);
  if (name.indexOf('성적_') !== 0 || !Array.isArray(rows) || !rows.length || rows.length > 500) fail_('BAD');
  const width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
  const data = rows.map(function (r) {
    const out = [];
    for (let i = 0; i < width; i++) {
      let v = i < r.length ? r[i] : '';
      if (typeof v === 'string' && /^[=+\-@]/.test(v)) v = ' ' + v;
      out.push(v === null || v === undefined ? '' : v);
    }
    return out;
  });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  sh.getRange(1, 1, data.length, width).setValues(data);
  sh.getRange(1, 1, 1, width).setFontWeight('bold');
  sh.setFrozenRows(1);
}

/* ---------- 드라이브 파일 ---------- */
function folder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}
function inFolder_(f) {
  const fid = folder_().getId(), ps = f.getParents();
  while (ps.hasNext()) if (ps.next().getId() === fid) return true;
  return false;
}
function uploadFile_(req) {
  const bytes = Utilities.base64Decode(String(req.data || ''));
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) fail_('TOOBIG');
  const f = folder_().createFile(Utilities.newBlob(bytes, String(req.mime || 'application/octet-stream'), String(req.name || 'file').slice(0, 100)));
  return { ok: true, fileId: f.getId() };
}
function getFile_(id) {
  const f = DriveApp.getFileById(id);
  if (!inFolder_(f)) fail_('FORBIDDEN');
  const b = f.getBlob();
  return { ok: true, data: Utilities.base64Encode(b.getBytes()), mime: b.getContentType(), name: f.getName() };
}
function delFile_(id) {
  const f = DriveApp.getFileById(id);
  if (!inFolder_(f)) fail_('FORBIDDEN');
  f.setTrashed(true);
  return { ok: true };
}


/* 새 스프레드시트를 만들어 시트(탭)마다 표를 채웁니다 */
function exportSheet_(title, sheets) {
  var ss = SpreadsheetApp.create(String(title || '학급관리 내보내기').slice(0, 100));
  var first = ss.getSheets()[0], used = {};
  (sheets || []).slice(0, 40).forEach(function (s) {
    var nm = String(s.name || '시트').replace(/[\[\]\*\?:\/\\]/g, ' ').trim().slice(0, 90) || '시트', base = nm, k = 2;
    while (used[nm]) nm = base.slice(0, 85) + ' ' + (k++);
    used[nm] = 1;
    var sh = ss.insertSheet(nm);
    var rows = (s.rows || []).slice(0, 2000), w = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
    var vals = rows.map(function (r) {
      var o = [];
      for (var i = 0; i < w; i++) { var v = r[i]; if (v == null) v = ''; if (typeof v === 'string' && /^[=+\-@]/.test(v)) v = "'" + v; o.push(v); }
      return o;
    });
    if (vals.length) { sh.getRange(1, 1, vals.length, w).setValues(vals); sh.getRange(1, 1, 1, w).setFontWeight('bold'); }
    sh.autoResizeColumns(1, w);
  });
  if (ss.getSheets().length > 1) ss.deleteSheet(first);
  return { ok: true, url: ss.getUrl() };
}
