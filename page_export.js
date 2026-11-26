/* 공통 도구: 엑셀(xlsx) 읽기·만들기, 내보내기 창(구글 스프레드시트 / 이미지 / 엑셀), 표·자리 이미지 그리기 */
(() => {
'use strict';
const APP = window.APP;
const { h, api, toast, errMsg } = APP;
const FONT = "Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
const safeFile = (s) => String(s || '내보내기').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60) || '내보내기';

/* ---------------- zip / xlsx (라이브러리 없이) ---------------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = ~0; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (~c) >>> 0; };

function zipStore(files, mime) {
  const enc = new TextEncoder(), parts = [], cd = []; let off = 0;
  files.forEach((f) => {
    const nm = enc.encode(f.name), data = f.bytes || enc.encode(f.text), crc = crc32(data), sz = data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true); lh.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(lh.buffer), nm, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    cd.push(new Uint8Array(ch.buffer), nm); off += 30 + nm.length + sz;
  });
  const cdSize = cd.reduce((s, a) => s + a.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...cd, new Uint8Array(end.buffer)], { type: mime || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
async function inflate(u8) {
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf), dec = new TextDecoder();
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('엑셀(.xlsx) 파일이 아니에요');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const ent = {};
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + el + cl;
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    ent[name] = { method, raw: u8.subarray(start, start + csz) };
  }
  const norm = (x) => String(x).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  const idx = {}; Object.keys(ent).forEach((k) => { idx[norm(k)] = ent[k]; });
  return {
    names: Object.keys(ent),
    get: async (name) => { const f = ent[name] || idx[norm(name)]; if (!f) return null; return dec.decode(f.method === 0 ? f.raw : await inflate(f.raw)); }
  };
}
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
async function readXlsx(buf) {
  // 엑셀·한셀·구글 시트·넘버스 등 여러 프로그램이 저장한 파일을 모두 읽도록 (태그 앞 접두어, strict 형식 등)
  const z = unzip(buf), parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const tags = (node, name) => [...node.getElementsByTagNameNS('*', name)];
  const attr = (el, local) => { for (const a of el.attributes) if (a.localName === local) return a.value; return null; };
  let path = null;
  const wbx = await z.get('xl/workbook.xml');
  if (wbx) {
    const sh = tags(parse(wbx), 'sheet')[0];
    const rid = sh ? [...sh.attributes].find((a) => a.localName === 'id' && /relationships/i.test(a.namespaceURI || a.name))?.value || attr(sh, 'id') : null;
    const relx = await z.get('xl/_rels/workbook.xml.rels');
    if (rid && relx) {
      const rel = tags(parse(relx), 'Relationship').find((r) => r.getAttribute('Id') === rid);
      if (rel) { const t = rel.getAttribute('Target').replace(/\\/g, '/'); path = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, ''); path = path.replace(/[^/]+\/\.\.\//g, ''); }
    }
  }
  if (!path || !(await z.get(path))) {
    const cand = z.names.filter((n) => /(^|\/)worksheets\/[^/]+\.xml$/i.test(n)).sort();
    if (!cand.length) throw new Error(wbx ? '시트를 찾지 못했어요. 엑셀에서 "다른 이름으로 저장 → Excel 통합 문서(.xlsx)"로 다시 저장해 올려 주세요.' : '엑셀(.xlsx) 파일이 아니에요');
    path = cand.find((n) => /sheet1\.xml$/i.test(n)) || cand[0];
  }
  const shared = [], ss = await z.get('xl/sharedStrings.xml');
  if (ss) for (const si of tags(parse(ss), 'si')) {
    let t = ''; for (const x of tags(si, 't')) { const pn = x.parentNode.localName; if (pn === 'si' || pn === 'r') t += x.textContent; } shared.push(t);
  }
  const sx = await z.get(path); if (!sx) throw new Error('시트를 읽지 못했어요');
  const rows = []; let rAuto = 0;
  for (const row of tags(parse(sx), 'row')) {
    const rv = Number(row.getAttribute('r')), ri = Number.isFinite(rv) && rv > 0 ? rv - 1 : rAuto; rAuto = ri + 1;
    const arr = []; let cAuto = 0;
    for (const c of tags(row, 'c')) {
      const m = /^([A-Z]+)/i.exec(c.getAttribute('r') || '');
      let col = cAuto; if (m) { col = 0; for (const ch of m[1].toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64; col--; }
      cAuto = col + 1;
      const t = c.getAttribute('t'), v = tags(c, 'v')[0];
      let val = '';
      if (t === 's') val = shared[Number(v && v.textContent)] || '';
      else if (t === 'inlineStr') val = tags(c, 't').map((x) => x.textContent).join('');
      else if (v) val = t === 'str' || t === 'e' || t === 'd' ? v.textContent : t === 'b' ? (v.textContent === '1' ? 'TRUE' : 'FALSE') : (isNaN(Number(v.textContent)) ? v.textContent : Number(v.textContent));
      arr[col] = val;
    }
    rows[ri] = Array.from(arr, (x) => (x == null ? '' : x));
  }
  return Array.from(rows, (r) => r || []);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colName = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
/* sheets: [{ name, rows, widths?, genderCol?, genderRows? }] */
function buildXlsx(sheets) {
  const used = new Set();
  const names = sheets.map((s) => { let n = String(s.name || '시트').replace(/[\[\]*?:/\\]/g, ' ').trim().slice(0, 28) || '시트', b = n, k = 2; while (used.has(n)) n = b.slice(0, 24) + ' ' + k++; used.add(n); return n; });
  const sheetXml = sheets.map((s) => {
    const w = (s.rows || []).reduce((m, r) => Math.max(m, r.length), 1);
    const cols = '<cols>' + Array.from({ length: w }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${(s.widths && s.widths[i]) || 14}" customWidth="1"/>`).join('') + '</cols>';
    const data = (s.rows || []).map((r, ri) => `<row r="${ri + 1}">` + Array.from({ length: w }, (_, ci) => {
      const v = r[ci], ref = colName(ci) + (ri + 1), st = ri === 0 && s.header !== false ? ' s="1"' : '';
      if (v == null || v === '') return st ? `<c r="${ref}"${st}/>` : '';
      if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('') + '</row>').join('');
    const lists = (s.lists || []).concat(s.genderCol != null ? [{ col: s.genderCol, values: ['남', '여'] }] : [])
      .map((l) => ({ col: l.col, f: l.values.map((v) => String(v).replace(/[",]/g, ' ')).join(',') })).filter((l) => l.f && l.f.length <= 250);
    const dv = lists.length ? `<dataValidations count="${lists.length}">${lists.map((l) => `<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${colName(l.col)}2:${colName(l.col)}1000"><formula1>"${esc(l.f)}"</formula1></dataValidation>`).join('')}</dataValidations>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${s.header !== false ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews>${cols}<sheetData>${data}</sheetData>${dv}</worksheet>`;
  });
  const files = [
    { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' },
    { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Malgun Gothic"/></font><font><b/><sz val="11"/><name val="Malgun Gothic"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF0F3"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    ...sheetXml.map((text, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text }))
  ];
  return zipStore(files);
}

/* ---------------- CSV ---------------- */
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = [['\t', first.split('\t').length], [',', first.split(',').length], [';', first.split(';').length]].sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
/* 업로드한 파일(.xlsx / .csv / .tsv / .txt)을 2차원 배열로 */
async function readTableFile(file) {
  const buf = await file.arrayBuffer(), u8 = new Uint8Array(buf);
  if (u8[0] === 0x50 && u8[1] === 0x4b) return readXlsx(buf);
  if (u8[0] === 0xD0 && u8[1] === 0xCF) throw new Error('예전 엑셀(.xls)은 읽을 수 없어요. 엑셀에서 "다른 이름으로 저장 → .xlsx"로 저장해서 올려 주세요.');
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { text = new TextDecoder('euc-kr').decode(u8); }
  return parseCsv(text);
}

/* ---------------- 파일 저장 ---------------- */
function saveBlob(blob, name) {
  const a = document.createElement('a'); a.download = name; a.href = URL.createObjectURL(blob); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const saveCanvas = (cv, name) => new Promise((res) => cv.toBlob((b) => { saveBlob(b, name); res(); }, 'image/png'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function loadFonts() { try { await Promise.all([document.fonts.load(`400 16px Pretendard`), document.fonts.load(`700 16px Pretendard`)]); } catch (e) { /* 기본 글꼴 */ } }

/* ---------------- 이미지: 표 / 자리 ---------------- */
async function tableCanvas(title, rows, opt) {
  await loadFonts();
  opt = opt || {};
  const SC = 2, M = 24, RH = 32, FS = 15, pm = 10;
  const pc = document.createElement('canvas').getContext('2d');
  const nc = rows.reduce((m, r) => Math.max(m, r.length), 1);
  const widths = Array.from({ length: nc }, (_, c) => {
    let w = 44; rows.forEach((r, ri) => { pc.font = `${ri === 0 ? 700 : 400} ${FS}px ${FONT}`; w = Math.max(w, pc.measureText(String(r[c] == null ? '' : r[c])).width + pm * 2); });
    return Math.min(w, 280);
  });
  const TH = title ? 46 : 0, W = Math.ceil(widths.reduce((a, b) => a + b, 0) + M * 2), H = M + TH + rows.length * RH + M;
  const cv = document.createElement('canvas'); cv.width = W * SC; cv.height = H * SC;
  const x = cv.getContext('2d'); x.scale(SC, SC); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.textBaseline = 'middle';
  if (title) { x.font = `700 22px ${FONT}`; x.fillStyle = '#111827'; x.textAlign = 'left'; x.fillText(title, M, M + 16); }
  const fit = (t, w) => { t = String(t); if (x.measureText(t).width <= w) return t; while (t.length > 1 && x.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; };
  rows.forEach((r, ri) => {
    let cx = M; const y = M + TH + ri * RH;
    if (ri === 0 && opt.header !== false) { x.fillStyle = '#eef0f3'; x.fillRect(M, y, widths.reduce((a, b) => a + b, 0), RH); }
    for (let c = 0; c < nc; c++) {
      x.strokeStyle = '#cfd4dc'; x.lineWidth = 1; x.strokeRect(cx + 0.5, y + 0.5, widths[c], RH);
      x.font = `${ri === 0 && opt.header !== false ? 700 : 400} ${FS}px ${FONT}`; x.fillStyle = '#111827'; x.textAlign = 'center';
      const v = r[c] == null ? '' : r[c]; if (v !== '') x.fillText(fit(v, widths[c] - pm), cx + widths[c] / 2, y + RH / 2 + 1);
      cx += widths[c];
    }
  });
  return cv;
}

const TEAM_COLORS = ['#fde68a', '#a7f3d0', '#fbcfe8', '#bfdbfe', '#fed7aa', '#ddd6fe', '#fecaca', '#99f6e4', '#d9f99d', '#e9d5ff'];
/* l: { cols, rows, cells, assign, teams, colNames } */
async function seatCanvas(title, l, roster) {
  await loadFonts();
  const by = {}; roster.forEach((s) => { by[s.num] = s; });
  const tm = new Map(); (l.teams || []).forEach((t, ti) => t.cells.forEach((i) => tm.set(i, ti)));
  const SC = 2, M = 28, CW = 150, CH = 86, G = 8, LH = 30;
  const W = M * 2 + l.cols * CW + (l.cols - 1) * G, TH = title ? 44 : 0, H = M + TH + 36 + 10 + LH + 8 + l.rows * (CH + G) + M - G;
  const cv = document.createElement('canvas'); cv.width = W * SC; cv.height = H * SC;
  const x = cv.getContext('2d'); x.scale(SC, SC); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.textBaseline = 'middle'; x.textAlign = 'center';
  let y = M;
  if (title) { x.font = `700 22px ${FONT}`; x.fillStyle = '#111827'; x.textAlign = 'left'; x.fillText(title, M, y + 16); x.textAlign = 'center'; y += TH; }
  x.fillStyle = '#374151'; x.fillRect(M, y, W - M * 2, 36); x.fillStyle = '#fff'; x.font = `700 16px ${FONT}`; x.fillText('칠   판', W / 2, y + 19); y += 46;
  for (let c = 0; c < l.cols; c++) {
    const cx = M + c * (CW + G); x.fillStyle = '#eef0f3'; x.fillRect(cx, y, CW, LH); x.fillStyle = '#111827'; x.font = `700 15px ${FONT}`;
    x.fillText((l.colNames && l.colNames[c]) || String(c + 1), cx + CW / 2, y + LH / 2 + 1);
  }
  y += LH + 8;
  l.cells.forEach((on, i) => {
    const r = Math.floor(i / l.cols), c = i % l.cols, cx = M + c * (CW + G), cy = y + r * (CH + G);
    if (!on) { x.setLineDash([5, 4]); x.strokeStyle = '#d3d7de'; x.lineWidth = 1.5; x.strokeRect(cx + 1, cy + 1, CW - 2, CH - 2); x.setLineDash([]); return; }
    const n = l.assign ? l.assign[i] : null, s = n != null ? by[n] : null;
    x.fillStyle = s ? (s.gender === '남' ? '#dbeafe' : s.gender === '여' ? '#fde2ea' : '#f3f4f6') : '#fff'; x.fillRect(cx, cy, CW, CH);
    x.strokeStyle = '#c7d2fe'; x.lineWidth = 2; x.strokeRect(cx + 1, cy + 1, CW - 2, CH - 2);
    if (n == null) return;
    x.fillStyle = '#6b7280'; x.font = `12px ${FONT}`; x.fillText(String(n), cx + CW / 2, cy + 14);
    let fs = 26; x.font = `700 ${fs}px ${FONT}`; const nm = s ? s.name : n + '번';
    while (fs > 12 && x.measureText(nm).width > CW - 14) { fs--; x.font = `700 ${fs}px ${FONT}`; }
    x.fillStyle = '#111827'; x.fillText(nm, cx + CW / 2, cy + CH / 2 + 1);
    const ti = tm.get(i);
    if (ti != null) {
      const tn = l.teams[ti].name; x.font = `700 12px ${FONT}`; const tw = Math.min(CW - 16, x.measureText(tn).width + 14);
      x.fillStyle = TEAM_COLORS[ti % TEAM_COLORS.length]; x.fillRect(cx + (CW - tw) / 2, cy + CH - 22, tw, 17);
      x.fillStyle = '#374151'; x.fillText(tn, cx + CW / 2, cy + CH - 13);
    }
  });
  return cv;
}

/* ---------------- 내보내기 창 ---------------- */
/* items: [{ id, label, group?, name(시트·파일 이름), rows, image?: async () => canvas | canvas[] }] */
function openExport(opt) {
  const items = opt.items || [];
  if (!items.length) return toast(opt.empty || '내보낼 저장 내용이 아직 없어요', true);
  const state = { fmt: APP.DEMO ? 'xlsx' : 'sheet' };
  const checks = items.map(() => h('input', { type: 'checkbox', checked: true }));
  const allBox = h('input', { type: 'checkbox', checked: true, onchange: (e) => checks.forEach((c) => { c.checked = e.target.checked; }) });
  checks.forEach((c) => c.addEventListener('change', () => { allBox.checked = checks.every((x) => x.checked); }));
  let lastGroup = null;
  const list = h('div', { class: 'xlist' }, items.map((it, i) => {
    const head = it.group && it.group !== lastGroup ? h('div', { class: 'xgroup' }, it.group) : null; lastGroup = it.group;
    return h('div', null, head, h('label', { class: 'xrow' }, checks[i], h('span', null, it.label)));
  }));
  const fmts = [['sheet', '구글 스프레드시트'], ['image', '이미지 (PNG)'], ['xlsx', '엑셀 파일 (.xlsx)']];
  const status = h('div', { class: 'muted', style: 'min-height:20px;margin-top:8px' });
  const goBtn = h('button', { class: 'primary', onclick: run }, '내보내기');
  const cancel = h('button', { onclick: () => close() }, '닫기');
  const box = h('div', { class: 'modal xdlg' },
    h('h3', null, opt.title || '내보내기'),
    h('div', { class: 'radios', style: 'margin:10px 0' }, fmts.map(([v, n]) => h('label', null, h('input', { type: 'radio', name: 'xfmt', checked: state.fmt === v, onchange: () => { state.fmt = v; hint(); } }), n))),
    h('div', { class: 'muted', id: 'xhint', style: 'min-height:20px;margin-bottom:8px' }),
    h('label', { class: 'xrow xall' }, allBox, h('b', null, '전체 선택')), list, status,
    h('div', { class: 'row', style: 'margin-top:14px' }, cancel, goBtn));
  const ov = h('div', { class: 'overlay' }, box);
  const hintEl = box.querySelector('#xhint');
  function hint() {
    hintEl.textContent = state.fmt === 'sheet' ? (APP.DEMO ? '데모 모드에서는 구글 스프레드시트를 만들 수 없어서 엑셀 파일로 받아져요.' : '내 구글 드라이브에 새 스프레드시트를 만들어요. 선택한 항목마다 시트(탭)가 하나씩 생겨요.')
      : state.fmt === 'image' ? '선택한 항목마다 그림 파일(PNG)이 하나씩 저장돼요.' : '선택한 항목을 시트(탭)로 나눠 담은 엑셀 파일 하나로 저장해요.';
  }
  function close() { ov.remove(); if (opt.onClose) opt.onClose(); }
  async function run() {
    const sel = items.filter((_, i) => checks[i].checked);
    if (!sel.length) return toast('내보낼 항목을 선택해 주세요', true);
    goBtn.disabled = true; cancel.disabled = true;
    try {
      if (state.fmt === 'image') {
        let k = 0;
        for (const it of sel) {
          status.textContent = `그림 만드는 중… (${++k}/${sel.length})`;
          const r = it.image ? await it.image() : await tableCanvas(it.label, it.rows);
          const cvs = Array.isArray(r) ? r : [r];
          for (let j = 0; j < cvs.length; j++) { await saveCanvas(cvs[j], `${safeFile(it.name)}${cvs.length > 1 ? '_' + (j + 1) : ''}.png`); await wait(250); }
        }
        status.textContent = `${sel.length}개 항목을 이미지로 저장했어요.`;
      } else if (state.fmt === 'xlsx' || (state.fmt === 'sheet' && APP.DEMO)) {
        saveBlob(buildXlsx(sel.map((it) => ({ name: it.name, rows: it.rows }))), `${safeFile(opt.title || '내보내기')}_${APP.today()}.xlsx`);
        status.textContent = '엑셀 파일로 저장했어요.';
      } else {
        status.textContent = '구글 스프레드시트를 만드는 중…';
        const j = await api('exportSheet', { title: `${opt.title || '내보내기'} ${APP.today()}`, sheets: sel.map((it) => ({ name: it.name, rows: it.rows })) });
        status.replaceChildren('만들었어요. ', h('a', { href: j.url, target: '_blank', rel: 'noopener' }, '스프레드시트 열기'));
      }
    } catch (e) { status.textContent = ''; toast(errMsg(e), true); }
    goBtn.disabled = false; cancel.disabled = false;
  }
  document.body.append(ov); hint();
}

APP.xl = { readTableFile, buildXlsx, saveBlob, parseCsv, zipStore };
APP.exporter = { open: openExport, tableCanvas, seatCanvas, saveCanvas, wait, loadFonts };
})();
