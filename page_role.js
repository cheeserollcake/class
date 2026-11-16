/* 역할 관리: PDF(또는 이미지) 양식 올리기 → 입력 칸 자동 검출 → 역할명·설명·담당자 채우기 */
(() => {
'use strict';
const APP = window.APP;
const { S, h, toast, errMsg } = APP;

const RO = { forms: null, sets: null, form: null, pages: null, pending: null, mode: 'fill', sel: null, roles: [{ name: '', desc: '', owner: '' }], setName: '', formName: '', busy: '' };
const KINDS = [['name', '역할명'], ['desc', '역할 설명'], ['owner', '담당자'], ['none', '사용 안 함']];
const KCOLOR = { name: '#2f6fed', desc: '#1baf7a', owner: '#eb6834', none: '#9aa3af' };
const fkey = (n) => 'role:form:' + n, skey = (n) => 'role:set:' + n;
const safeName = (s) => String(s || '양식').replace(/\.[^.]+$/, '').replace(/[^\w:.\- 가-힣]/g, '_').slice(0, 50) || '양식';

/* ---------- 칸 검출 (표의 빈 칸 찾기) ---------- */
function detectCells(cv) {
  const W = cv.width, H = cv.height, d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const dark = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < dark.length; i++, p += 4) dark[i] = d[p + 3] > 128 && 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2] < 225 ? 1 : 0;
  const lab = new Uint8Array(W * H), stack = new Int32Array(W * H);
  const empty = [], text = [], minW = Math.max(24, W * 0.025), minH = Math.max(14, H * 0.011);
  for (let s = 0; s < dark.length; s++) {
    if (dark[s] || lab[s]) continue;
    let sp = 0, minx = W, maxx = 0, miny = H, maxy = 0, area = 0;
    stack[sp++] = s; lab[s] = 1;
    while (sp) {
      const i = stack[--sp], x = i % W, y = (i / W) | 0; area++;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (x > 0 && !dark[i - 1] && !lab[i - 1]) { lab[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < W - 1 && !dark[i + 1] && !lab[i + 1]) { lab[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && !dark[i - W] && !lab[i - W]) { lab[i - W] = 1; stack[sp++] = i - W; }
      if (y < H - 1 && !dark[i + W] && !lab[i + W]) { lab[i + W] = 1; stack[sp++] = i + W; }
    }
    const w = maxx - minx + 1, hh = maxy - miny + 1;
    if (minx === 0 || miny === 0 || maxx === W - 1 || maxy === H - 1) continue; // 바깥 배경
    if (w < minW || hh < minH || area > W * H * 0.5) continue;
    const fill = area / (w * hh);
    const box = { x: minx, y: miny, w, h: hh };
    if (fill >= 0.965) empty.push(box); else if (fill >= 0.45) text.push(box);
  }
  return { empty, text };
}

/* 빈 칸들을 열·행으로 묶고 머리글로 종류(역할명/설명/담당자) 추측 */
function guessFields(det, items, W, H, page) {
  const tol = Math.max(8, W * 0.012), cols = [];
  det.empty.slice().sort((a, b) => a.x - b.x).forEach((c) => {
    let col = cols.find((k) => Math.abs(k.x - c.x) < tol);
    if (!col) { col = { x: c.x, cells: [] }; cols.push(col); }
    col.cells.push(c);
  });
  const useCols = cols.filter((c) => c.cells.length >= 2).sort((a, b) => a.x - b.x);
  const headerOf = (col) => {
    const top = col.cells.reduce((m, c) => (c.y < m.y ? c : m));
    const cand = det.text.filter((t) => t.y + t.h <= top.y + 6 && Math.min(t.x + t.w, top.x + top.w) - Math.max(t.x, top.x) >= 0.5 * Math.min(t.w, top.w));
    if (!cand.length) return '';
    const t = cand.reduce((m, c) => (c.y + c.h > m.y + m.h ? c : m));
    return items.filter((i) => i.x + i.w / 2 >= t.x && i.x + i.w / 2 <= t.x + t.w && i.y + i.h / 2 >= t.y && i.y + i.h / 2 <= t.y + t.h).sort((a, b) => a.x - b.x).map((i) => i.str).join('');
  };
  const kindOf = (s) => (/담당|맡은|학생|누가/.test(s) ? 'owner' : /설명|내용|하는\s*일|업무|활동/.test(s) ? 'desc' : /역할|직책|직업|이름|명칭|항목/.test(s) ? 'name' : null);
  useCols.forEach((c) => { c.head = headerOf(c); c.kind = kindOf(c.head); });
  const used = new Set(useCols.map((c) => c.kind).filter(Boolean));
  const left = ['name', 'desc', 'owner'].filter((k) => !used.has(k));
  useCols.filter((c) => !c.kind).forEach((c) => { c.kind = left.shift() || 'none'; });
  const fields = [];
  const mk = (c, kind, row) => fields.push({ page, x: (c.x + 1) / W, y: (c.y + 1) / H, w: (c.w - 2) / W, h: (c.h - 2) / H, kind, row });
  useCols.forEach((col) => col.cells.sort((a, b) => a.y - b.y).forEach((c, i) => mk(c, col.kind, i + 1)));
  cols.filter((c) => c.cells.length < 2).forEach((col) => col.cells.forEach((c) => mk(c, 'none', 0)));
  return fields;
}

/* ---------- 파일 → 쪽 이미지 ---------- */
async function loadPdfJs() {
  if (window.__pdfjs) return window.__pdfjs;
  const base = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
  const m = await import(base + 'pdf.min.mjs');
  m.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
  window.__pdfjs = m; return m;
}
async function renderFile(bytes, mime) {
  const pages = [];
  if (/pdf/i.test(mime)) {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
    for (let n = 1; n <= Math.min(doc.numPages, 6); n++) {
      const pg = await doc.getPage(n), v1 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: Math.min(2.5, 1300 / v1.width) });
      const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await pg.render({ canvasContext: ctx, canvas: cv, viewport: vp }).promise;
      const tc = await pg.getTextContent(), items = [];
      tc.items.forEach((it) => {
        if (!it.str || !it.str.trim()) return;
        const t = pdfjs.Util.transform(vp.transform, it.transform), hgt = Math.hypot(t[2], t[3]);
        items.push({ str: it.str, x: t[4], y: t[5] - hgt, w: it.width * vp.scale, h: hgt });
      });
      let widgets = [];
      try {
        widgets = (await pg.getAnnotations()).filter((a) => a.subtype === 'Widget' && a.fieldType === 'Tx' && a.rect).map((a) => {
          const r = vp.convertToViewportRectangle(a.rect); return { x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]), w: Math.abs(r[2] - r[0]), h: Math.abs(r[3] - r[1]) };
        });
      } catch (e) { /* 입력란 정보가 없는 PDF */ }
      pages.push({ canvas: cv, items, widgets });
    }
  } else {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('이미지를 열지 못했어요')); i.src = url; });
    const sc = Math.min(1, 1500 / img.naturalWidth), cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * sc); cv.height = Math.round(img.naturalHeight * sc);
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(url); pages.push({ canvas: cv, items: [], widgets: [] });
  }
  return pages;
}
function detectAll(pages) {
  const fields = [];
  pages.forEach((p, i) => {
    const det = detectCells(p.canvas);
    if (p.widgets.length) det.empty = det.empty.concat(p.widgets.filter((w) => !det.empty.some((e) => Math.abs(e.x - w.x) < 6 && Math.abs(e.y - w.y) < 6)));
    guessFields(det, p.items, p.canvas.width, p.canvas.height, i).forEach((f) => fields.push(f));
  });
  fields.forEach((f, i) => { f.id = 'f' + (i + 1); });
  return fields;
}
const b64ToBytes = (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const fileToB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('파일을 읽지 못했어요')); r.readAsDataURL(file); });

/* ---------- 목록 ---------- */
async function loadLists() {
  const [f, s] = await Promise.all([APP.kvList('role:form:'), APP.kvList('role:set:')]);
  RO.forms = f.sort((a, b) => b.updated - a.updated).map((k) => k.key.slice('role:form:'.length));
  RO.sets = s.sort((a, b) => b.updated - a.updated).map((k) => k.key.slice('role:set:'.length));
}
const rowCount = () => (RO.form ? RO.form.fields.reduce((m, f) => Math.max(m, f.kind === 'none' ? 0 : f.row), 0) : 0);
const textFor = (f) => { if (f.kind === 'none' || !f.row) return ''; const r = RO.roles[f.row - 1]; return r ? r[f.kind] || '' : ''; };

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

/* ---------- 화면 ---------- */
APP.pages.role = () => {
  const wrap = h('div');
  const draw = () => { wrap.replaceChildren(view(draw)); fitAll(); };
  if (!RO.forms) { wrap.append(APP.loading()); loadLists().then(draw).catch((e) => { RO.forms = []; RO.sets = []; draw(); toast(errMsg(e), true); }); } else draw();
  return wrap;
};
window.addEventListener('resize', () => fitAll());
function fitAll() {
  requestAnimationFrame(() => document.querySelectorAll('.rbox .rtxt').forEach((sp) => {
    const box = sp.parentElement, hgt = box.clientHeight, wid = box.clientWidth; if (!hgt) return;
    let fs = Math.min(hgt * 0.78, 30); sp.style.fontSize = fs + 'px';
    for (let g = 0; g < 50 && fs > 6 && (sp.offsetHeight > hgt + 1 || sp.offsetWidth > wid + 1); g++) { fs -= 1; sp.style.fontSize = fs + 'px'; }
  }));
  // 같은 종류의 칸은 글자 크기를 맞추기 (가장 작은 크기 기준)
  requestAnimationFrame(() => {
    const min = {};
    document.querySelectorAll('.rbox .rtxt').forEach((sp) => { if (!sp.textContent) return; const k = sp.parentElement.dataset.kind, v = parseFloat(sp.style.fontSize); if (v && (!min[k] || v < min[k])) min[k] = v; });
    document.querySelectorAll('.rbox .rtxt').forEach((sp) => { const k = sp.parentElement.dataset.kind; if (min[k] && sp.textContent) sp.style.fontSize = min[k] + 'px'; });
  });
}

function view(redraw) {
  closePicker();
  const busy = RO.busy ? h('div', { class: 'banner' }, RO.busy) : null;
  const guard = async (msg, fn) => { RO.busy = msg; redraw(); try { await fn(); } catch (e) { toast(errMsg(e), true); } RO.busy = ''; redraw(); };

  const fileIn = h('input', { type: 'file', accept: 'application/pdf,image/png,image/jpeg', hidden: true, onchange: (e) => {
    const f = e.target.files[0]; if (!f) return;
    guard('양식을 읽고 입력 칸을 찾는 중…', async () => {
      const buf = await f.arrayBuffer(); const mime = f.type || (/pdf$/i.test(f.name) ? 'application/pdf' : 'image/png');
      let pages;
      try { pages = await renderFile(new Uint8Array(buf), mime); } catch (x) { throw new Error('PDF를 열지 못했어요. 인터넷 연결을 확인하거나, 양식을 사진(PNG/JPG)으로 올려 보세요. (' + x.message + ')'); }
      const fields = detectAll(pages);
      RO.pages = pages; RO.pending = { b64: await fileToB64(f), mime, name: safeName(f.name) };
      RO.form = { name: '', fileId: null, mime, fields, pageCount: pages.length }; RO.mode = 'edit'; RO.sel = null;
      const filled = fields.filter((x) => x.kind !== 'none').length;
      toast(fields.length ? `입력 칸 ${fields.length}개를 찾았어요 (역할 칸 ${filled}개). 위치와 종류를 확인해 주세요.` : '자동으로 찾은 칸이 없어요. "+ 칸 추가"로 직접 그려 주세요.');
    });
  } });

  const formSel = h('select', { onchange: (e) => {
    const name = e.target.value; if (!name) return;
    guard('양식을 불러오는 중…', async () => {
      const rec = (await APP.kvGet([fkey(name)]))[fkey(name)]; if (!rec) throw new Error('양식을 찾지 못했어요');
      const fj = await APP.api('getFile', { fileId: rec.fileId });
      RO.pages = await renderFile(b64ToBytes(fj.data), fj.mime || rec.mime); RO.form = rec; RO.pending = null; RO.mode = 'fill'; RO.sel = null;
    });
  } }, h('option', { value: '' }, RO.forms.length ? '저장된 양식 선택…' : '저장된 양식이 없습니다'),
  RO.forms.map((n) => h('option', { value: n, selected: RO.form && RO.form.name === n }, n)));

  const setSel = h('select', { onchange: (e) => {
    const name = e.target.value; if (!name) return;
    guard('역할 목록을 불러오는 중…', async () => {
      const rec = (await APP.kvGet([skey(name)]))[skey(name)]; if (!rec) throw new Error('불러오지 못했어요');
      RO.roles = rec.roles && rec.roles.length ? rec.roles : [{ name: '', desc: '', owner: '' }]; RO.setName = name;
      if (rec.form && (!RO.form || RO.form.name !== rec.form) && RO.forms.includes(rec.form)) {
        const f = (await APP.kvGet([fkey(rec.form)]))[fkey(rec.form)];
        if (f) { const fj = await APP.api('getFile', { fileId: f.fileId }); RO.pages = await renderFile(b64ToBytes(fj.data), fj.mime || f.mime); RO.form = f; RO.pending = null; RO.mode = 'fill'; }
      }
    });
  } }, h('option', { value: '' }, RO.sets.length ? '저장된 역할표 불러오기…' : '저장된 역할표가 없습니다'),
  RO.sets.map((n) => h('option', { value: n, selected: n === RO.setName }, n)));

  const top = h('div', { class: 'card' },
    h('div', { class: 'row gap' },
      h('button', { class: 'primary', onclick: () => fileIn.click() }, '+ 새 양식 올리기 (PDF·사진)'), fileIn, formSel,
      RO.form && !RO.form.draft && RO.form.name ? h('button', { class: 'sm ghost', onclick: () => {
        if (!confirm(`양식 "${RO.form.name}"을(를) 삭제할까요? (이 양식으로 저장한 역할표는 남아 있어요)`)) return;
        guard('삭제 중…', async () => { await APP.api('delFile', { fileId: RO.form.fileId }).catch(() => {}); await APP.kvDel(fkey(RO.form.name)); RO.form = null; RO.pages = null; await loadLists(); });
      } }, '양식 삭제') : null),
    h('div', { class: 'muted' }, 'PDF나 사진을 올리면 표의 빈 칸을 자동으로 찾아요. 칸 위치는 직접 고칠 수 있고, 한 번 저장하면 다음부터는 양식을 골라 바로 쓸 수 있어요.'));

  if (!RO.form || !RO.pages) return h('div', null, top, busy, h('div', { class: 'card placeholder' }, '양식을 올리거나 저장된 양식을 선택해 주세요.'));

  /* 쪽 그리기 */
  const edit = RO.mode === 'edit';
  const stage = h('div', { class: 'rstage' });
  RO.pages.forEach((p, pi) => {
    const wrap = h('div', { class: 'rpage', 'data-page': pi });
    p.canvas.className = 'rcanvas'; wrap.append(p.canvas);
    RO.form.fields.filter((f) => f.page === pi).forEach((f) => {
      const box = h('div', { class: 'rbox' + (edit ? ' edit' : '') + (RO.sel === f.id ? ' sel' : ''), style: `left:${f.x * 100}%;top:${f.y * 100}%;width:${f.w * 100}%;height:${f.h * 100}%;${edit ? `border-color:${KCOLOR[f.kind]};background:${KCOLOR[f.kind]}22` : ''}`, 'data-id': f.id, 'data-kind': f.kind });
      const sp = h('span', { class: 'rtxt' });
      sp.textContent = edit ? '' : textFor(f);
      if (!edit && f.kind !== 'none' && f.row > 0) { box.classList.add('live'); sp.dataset.ph = KINDS.find((k) => k[0] === f.kind)[1]; makeEditable(sp, f, box, stage); }
      box.append(sp);
      if (edit) {
        box.append(h('span', { class: 'rtag', style: `background:${KCOLOR[f.kind]}` }, f.kind === 'none' ? '—' : `${KINDS.find((k) => k[0] === f.kind)[1]} ${f.row}`));
        const handle = h('span', { class: 'rhandle' }); box.append(handle);
        const drag = (mode) => (ev) => {
          ev.preventDefault(); ev.stopPropagation(); box.setPointerCapture(ev.pointerId);
          const r = wrap.getBoundingClientRect(), sx = ev.clientX, sy = ev.clientY, o = { x: f.x, y: f.y, w: f.w, h: f.h }; let moved = false;
          const mv = (e) => {
            moved = true; const dx = (e.clientX - sx) / r.width, dy = (e.clientY - sy) / r.height;
            if (mode === 'move') { f.x = Math.max(0, Math.min(1 - f.w, o.x + dx)); f.y = Math.max(0, Math.min(1 - f.h, o.y + dy)); }
            else { f.w = Math.max(0.015, Math.min(1 - f.x, o.w + dx)); f.h = Math.max(0.008, Math.min(1 - f.y, o.h + dy)); }
            box.style.left = f.x * 100 + '%'; box.style.top = f.y * 100 + '%'; box.style.width = f.w * 100 + '%'; box.style.height = f.h * 100 + '%';
          };
          const up = () => { box.removeEventListener('pointermove', mv); box.removeEventListener('pointerup', up); if (RO.sel !== f.id || moved) { RO.sel = f.id; redraw(); } };
          box.addEventListener('pointermove', mv); box.addEventListener('pointerup', up);
        };
        box.addEventListener('pointerdown', drag('move')); handle.addEventListener('pointerdown', drag('size'));
      }
      wrap.append(box);
    });
    stage.append(wrap);
  });

  /* 칸 편집 패널 */
  const selF = RO.form.fields.find((f) => f.id === RO.sel);
  const panel = h('div', { class: 'card' }, h('h3', null, '입력 칸 편집'),
    h('div', { class: 'muted', style: 'margin-bottom:8px' }, '색 칸을 끌어서 옮기고, 오른쪽 아래 모서리를 끌어서 크기를 바꾸세요. 칸을 누르면 종류를 고를 수 있어요.'),
    h('div', { class: 'row gap' }, h('button', { class: 'sm', onclick: () => {
      const id = 'f' + Date.now().toString(36); RO.form.fields.push({ id, page: selF ? selF.page : 0, x: 0.3, y: 0.3, w: 0.3, h: 0.035, kind: 'none', row: 0 }); RO.sel = id; redraw();
    } }, '+ 칸 추가'), h('button', { class: 'sm ghost', onclick: () => { if (!confirm('자동 검출을 다시 하면 지금까지 고친 내용이 사라져요. 계속할까요?')) return; RO.form.fields = detectAll(RO.pages); RO.sel = null; redraw(); } }, '자동 검출 다시')),
    selF ? h('div', { style: 'margin-top:10px' },
      h('div', { class: 'field' }, h('label', null, '종류'), h('select', { value: selF.kind, onchange: (e) => { selF.kind = e.target.value; if (selF.kind !== 'none' && !selF.row) selF.row = 1; redraw(); } }, KINDS.map(([v, n]) => h('option', { value: v }, n)))),
      selF.kind !== 'none' ? h('div', { class: 'field' }, h('label', null, '몇 번째 줄 역할'), h('input', { type: 'number', min: 1, max: 60, class: 'n', value: selF.row, onchange: (e) => { selF.row = Math.max(1, Number(e.target.value) | 0); redraw(); } })) : null,
      h('button', { class: 'sm danger', onclick: () => { RO.form.fields = RO.form.fields.filter((f) => f.id !== selF.id); RO.sel = null; redraw(); } }, '이 칸 삭제'))
      : h('div', { class: 'muted', style: 'margin-top:10px' }, '칸을 눌러 선택하세요.'),
    h('div', { class: 'legend2 row', style: 'margin-top:12px' }, KINDS.map(([k, n]) => h('span', null, h('i', { class: 'dot', style: `background:${KCOLOR[k]}` }), n))),
    h('div', { class: 'row', style: 'margin-top:14px;justify-content:flex-end' }, h('button', { onclick: () => { RO.mode = 'fill'; redraw(); } }, '채우기 화면으로'),
      h('button', { class: 'primary', onclick: async () => {
        let name = RO.form.name;
        if (!name) { name = await askName('양식 이름', RO.pending ? RO.pending.name : '역할 양식'); if (!name) return; name = safeName(name); if (RO.forms.includes(name) && !confirm(`"${name}" 양식이 이미 있어요. 덮어쓸까요?`)) return; }
        guard('양식을 저장하는 중…', async () => {
          if (RO.pending) { const u = await APP.api('uploadFile', { name: name + (/pdf/i.test(RO.pending.mime) ? '.pdf' : '.png'), mime: RO.pending.mime, data: RO.pending.b64 }); RO.form.fileId = u.fileId; RO.pending = null; }
          RO.form.name = name; await APP.kvSet(fkey(name), { name, fileId: RO.form.fileId, mime: RO.form.mime, pageCount: RO.form.pageCount, fields: RO.form.fields, savedAt: Date.now() });
          await loadLists(); RO.mode = 'fill'; toast('양식을 저장했습니다');
        });
      } }, '양식 저장')));

  /* 역할 입력 패널 (입력은 양식 위의 칸에 직접 합니다) */
  const rows = rowCount();
  const fillPanel = h('div', { class: 'card' }, h('h3', null, '역할 입력'),
    h('div', { class: 'muted', style: 'margin-bottom:12px;line-height:1.65' }, '왼쪽 양식의 칸을 눌러 바로 입력하세요. 담당자 칸을 누르면 학생을 여러 명 골라 넣을 수 있어요. 글자 크기는 칸에 맞게 자동으로 조절돼요.'),
    h('div', { class: 'row' }, rows ? h('span', { class: 'muted' }, `입력 칸 ${rows}줄`) : h('span', { class: 'banner warn', style: 'margin:0' }, '역할 칸이 없어요. "입력 칸 수정"에서 칸의 종류를 정해 주세요.'),
      h('div', { style: 'flex:1' }),
      h('button', { class: 'sm ghost', onclick: () => { if (!confirm('입력한 내용을 모두 지울까요?')) return; RO.roles = [{ name: '', desc: '', owner: '' }]; RO.setName = ''; redraw(); } }, '내용 모두 지우기'),
      h('button', { class: 'sm ghost', onclick: () => { RO.mode = 'edit'; redraw(); } }, '입력 칸 수정')),
    h('div', { class: 'row', style: 'margin-top:12px;border-top:1px solid var(--line);padding-top:12px' },
      setSel,
      h('button', { class: 'primary', onclick: async () => {
        const m = new Date().getMonth() + 1; const name = await askName('역할표 이름 (같은 이름이면 덮어써요)', RO.setName || `${m}월`); if (!name) return;
        if (!/^[\w:.\- 가-힣]{1,60}$/.test(name)) return toast('이름에는 글자·숫자·공백·-·. 만 쓸 수 있어요', true);
        if (RO.sets.includes(name) && name !== RO.setName && !confirm(`"${name}"이(가) 이미 있어요. 덮어쓸까요?`)) return;
        guard('저장하는 중…', async () => { await APP.kvSet(skey(name), { name, form: RO.form.name, roles: RO.roles, savedAt: Date.now() }); RO.setName = name; await loadLists(); toast(`"${name}"으로 저장했습니다`); });
      } }, '역할표 저장')),
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { onclick: () => exportPng() }, 'PNG로 저장'), h('button', { onclick: () => window.print() }, '인쇄 / PDF로 저장')));

  return h('div', null, top, busy,
    h('div', { class: 'role-layout' }, h('div', { class: 'role-stage-wrap' }, stage), edit ? panel : fillPanel));
}


/* ---------- 양식 위에서 바로 입력 ---------- */
function setRole(f, v) {
  while (RO.roles.length < f.row) RO.roles.push({ name: '', desc: '', owner: '' });
  RO.roles[f.row - 1][f.kind] = v;
}
let fitTimer;
const scheduleFit = () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitAll, 100); };
const tokens = (t) => t.split(/[,，、/\n]+/).map((x) => x.trim()).filter(Boolean);
function makeEditable(sp, f, box, stage) {
  try { sp.contentEditable = 'plaintext-only'; } catch (e) { /* 일부 브라우저는 아래에서 대체 */ }
  if (sp.contentEditable !== 'plaintext-only') sp.contentEditable = 'true';
  sp.spellcheck = false;
  sp.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text')); });
  sp.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePicker(); sp.blur(); } });
  sp.addEventListener('input', () => {
    let v = sp.innerText.replace(/\n+$/, '');
    if (!v.trim()) { v = ''; if (sp.textContent) sp.textContent = ''; }
    setRole(f, v);
    stage.querySelectorAll('.rbox.live').forEach((b) => {            // 여러 쪽에 같은 칸이 있으면 같이 바꾸기
      const o = RO.form.fields.find((x) => x.id === b.dataset.id);
      if (o && o.id !== f.id && o.kind === f.kind && o.row === f.row) b.querySelector('.rtxt').textContent = v;
    });
    scheduleFit(); if (f.kind === 'owner') refreshPicker();
  });
  if (f.kind === 'owner') sp.addEventListener('focus', () => openPicker(box, f, sp));
}
let picker = null;
function closePicker() { if (picker) { document.removeEventListener('pointerdown', picker.out, true); picker.el.remove(); picker = null; } }
function openPicker(box, f, sp) {
  if (picker && picker.sp === sp) return;
  closePicker();
  const el = h('div', { class: 'picker' });
  const out = (e) => { if (!el.contains(e.target) && !box.contains(e.target)) closePicker(); };
  picker = { el, box, f, sp, out };
  document.body.append(el); document.addEventListener('pointerdown', out, true);
  refreshPicker();
}
function refreshPicker() {
  if (!picker) return;
  const { el, box, sp } = picker, cur = tokens(sp.innerText);
  const toggle = (name) => {
    const c = tokens(sp.innerText), i = c.indexOf(name);
    if (i >= 0) c.splice(i, 1); else c.push(name);
    sp.textContent = c.join(', ');
    if (document.activeElement === sp) { const r = document.createRange(); r.selectNodeContents(sp); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
    sp.dispatchEvent(new Event('input'));
  };
  const keep = (e) => e.preventDefault();
  el.replaceChildren(
    h('div', { class: 'muted', style: 'margin-bottom:8px' }, '눌러서 여러 명을 고를 수 있어요 (직접 입력해도 돼요)'),
    h('div', { class: 'pchips' }, APP.roster().map((s) => h('button', { class: 'pchip ' + APP.gcls(s.gender) + (cur.includes(s.name) ? ' on' : ''), onmousedown: keep, onclick: () => toggle(s.name) }, s.name))),
    h('div', { class: 'row', style: 'margin-top:8px;justify-content:space-between' }, h('span', { class: 'muted' }, cur.length ? `${cur.length}명 선택` : ''), h('button', { class: 'sm', onmousedown: keep, onclick: closePicker }, '닫기')));
  const r = box.getBoundingClientRect(), w = Math.min(400, window.innerWidth - 16);
  el.style.width = w + 'px'; el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  let top = r.bottom + 6; if (top + el.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - el.offsetHeight - 6);
  el.style.top = top + 'px';
}

/* PNG 저장: 양식 이미지 위에 글자를 그려 넣기 */
async function exportPng() {
  const stage = document.querySelector('.rstage'); if (!stage) return;
  try { await Promise.all([document.fonts.load('400 20px Pretendard'), document.fonts.load('700 20px Pretendard')]); } catch (e) { /* 글꼴 없으면 기본 글꼴 */ }
  RO.pages.forEach((p, pi) => {
    const out = document.createElement('canvas'); out.width = p.canvas.width; out.height = p.canvas.height;
    const ctx = out.getContext('2d'); ctx.drawImage(p.canvas, 0, 0);
    stage.querySelectorAll(`.rpage[data-page="${pi}"] .rbox`).forEach((box) => {
      const f = RO.form.fields.find((x) => x.id === box.dataset.id), t = textFor(f); if (!t) return;
      const sp = box.querySelector('.rtxt'), scale = out.width / box.parentElement.clientWidth, fs = parseFloat(sp.style.fontSize || '12') * scale;
      const x = f.x * out.width, y = f.y * out.height, w = f.w * out.width, hh = f.h * out.height;
      ctx.font = `${fs}px Pretendard, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif`; ctx.fillStyle = '#111'; ctx.textBaseline = 'top';
      const lines = []; let line = '';
      for (const ch of t) { if (ctx.measureText(line + ch).width > w - 4 && line) { lines.push(line); line = ch; } else line += ch; }
      lines.push(line);
      const lh = fs * 1.15, top = y + Math.max(0, (hh - lines.length * lh) / 2);
      lines.forEach((l, i) => ctx.fillText(l, x + 2, top + i * lh));
    });
    const a = document.createElement('a'); a.download = `역할표${RO.pages.length > 1 ? '_' + (pi + 1) : ''}.png`; a.href = out.toDataURL('image/png'); a.click();
  });
}
})();
