/* 학급보드판 (제출확인 화면 오른쪽)
   - 글상자(글씨 색·크기·굵기), 이미지(QR코드 등 붙여넣기/올리기), 제출확인판·다가오는 일정 불러오기
   - 기본은 열 맞춤 배치, 끌어서 옮기면 자유 배치. 화면 크기마다 배치를 따로 기억 */
(() => {
'use strict';
const APP = window.APP;
const { h, toast, errMsg } = APP;

/* 보드가 여러 개: 'board:index' = { boards:[{id,name}], cur }, 보드 내용 = 'board:main'(첫 보드) 또는 'board:b:<id>' */
const keyOf = (id) => (id === 'main' ? 'board:main' : 'board:b:' + id);
const B = { data: null, loading: null, imgs: {}, panel: null, canvas: null, focus: null, H: 0, index: null, cache: {} };
const def = () => ({ items: [], layouts: {}, cfg: { showSubmit: false, submitIds: [], showEvents: false }, events: [], locked: false });
const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const PERIODS = [1, 2, 3, 4, 5, 6];
const COLORS = ['#1f2937', '#e5484d', '#2f6fed', '#16a34a', '#f59e0b', '#9333ea', '#ec4899', '#ffffff'];
const SIZES = [14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80];
const norm = (v) => { const d = Object.assign(def(), v || {}); d.cfg = Object.assign(def().cfg, d.cfg); return d; };

async function load() {
  if (B.data) return B.data;
  if (!B.loading) B.loading = (async () => {
    try {
      const v = await APP.kvGet(['board:index']);
      B.index = v['board:index'] && Array.isArray(v['board:index'].boards) && v['board:index'].boards.length ? v['board:index'] : { boards: [{ id: 'main', name: '보드 1' }], cur: 'main' };
      if (!B.index.boards.some((b) => b.id === B.index.cur)) B.index.cur = B.index.boards[0].id;
      const k = keyOf(B.index.cur), d = await APP.kvGet([k]);
      B.data = B.cache[B.index.cur] = norm(d[k]);
    } catch (e) { B.index = B.index || { boards: [{ id: 'main', name: '보드 1' }], cur: 'main' }; B.data = norm(null); }
    return B.data;
  })();
  return B.loading;
}
let saveT = null;
function save() {
  clearTimeout(saveT);
  const id = B.index.cur, data = B.data;
  saveT = setTimeout(async () => {
    try { await APP.api('kvSet', { key: keyOf(id), value: JSON.stringify(data) }); }
    catch (e) { toast(e.message === 'TOOBIG' ? '학급보드판 내용이 너무 많아요. 글상자를 조금 지워 주세요.' : errMsg(e), true); }
  }, 700);
}
const saveIndex = () => APP.api('kvSet', { key: 'board:index', value: JSON.stringify(B.index) }).catch((e) => toast(errMsg(e), true));
async function flush() { if (saveT) { clearTimeout(saveT); saveT = null; try { await APP.api('kvSet', { key: keyOf(B.index.cur), value: JSON.stringify(B.data) }); } catch (e) { /* 다음에 */ } } }
async function switchTo(id) {
  await flush();
  B.index.cur = id; saveIndex(); B.focus = null;
  if (!B.cache[id]) { try { const k = keyOf(id), d = await APP.kvGet([k]); B.cache[id] = norm(d[k]); } catch (e) { B.cache[id] = norm(null); } }
  B.data = B.cache[id]; render();
}
async function addBoard() {
  const name = prompt('새 보드 이름', `보드 ${B.index.boards.length + 1}`); if (!name || !name.trim()) return;
  const id = 'b' + Date.now().toString(36);
  B.index.boards.push({ id, name: name.trim().slice(0, 20) });
  B.cache[id] = norm(null);
  await switchTo(id); save();
  toast(`"${name.trim()}" 보드를 만들었어요`);
}
async function removeBoard() {
  if (B.index.boards.length < 2) return toast('보드가 하나뿐이라 지울 수 없어요', true);
  const cur = B.index.boards.find((b) => b.id === B.index.cur);
  if (!confirm(`"${cur.name}" 보드를 지울까요? 안의 글상자·이미지도 모두 지워져요.`)) return;
  clearTimeout(saveT); saveT = null;
  B.data.items.filter((it) => it.type === 'image' && it.fileId).forEach((it) => APP.api('delFile', { fileId: it.fileId }).catch(() => {}));
  try { await APP.api('kvDel', { key: keyOf(cur.id) }); } catch (e) { /* 이미 없음 */ }
  B.index.boards = B.index.boards.filter((b) => b !== cur); delete B.cache[cur.id];
  await switchTo(B.index.boards[0].id);
}

/* ---------- 날짜 ---------- */
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const mdw = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`; };
function upcoming() {
  const t = new Date(), today = ymd(t), end = ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 7));
  return (B.data.events || []).filter((e) => e.date >= today && (e.date <= end || e.notice)).sort((a, b) => a.date.localeCompare(b.date) || (a.periods[0] || 0) - (b.periods[0] || 0));
}

/* ---------- 글상자 HTML 정리 (허용: b, strong, span[style], br, div) ---------- */
function cleanHtml(html) {
  const t = document.createElement('template'); t.innerHTML = html;
  const walk = (n) => [...n.childNodes].forEach((c) => {
    if (c.nodeType === 3) return;
    if (c.nodeType !== 1) { c.remove(); return; }
    const tag = c.tagName.toLowerCase();
    if (!['b', 'strong', 'span', 'br', 'div', 'font', 'p'].includes(tag)) { c.replaceWith(...c.childNodes); walk(n); return; }
    const st = c.getAttribute('style') || '', color = c.getAttribute('color');
    [...c.attributes].forEach((a) => c.removeAttribute(a.name));
    const keep = st.split(';').map((x) => x.trim()).filter((x) => /^(color|font-size|font-weight)\s*:\s*[#\w(),.\s%-]+$/i.test(x)).join(';');
    if (keep) c.setAttribute('style', keep);
    if (tag === 'font' && color) c.setAttribute('style', (keep ? keep + ';' : '') + 'color:' + color.replace(/[^#\w]/g, ''));
    walk(c);
  });
  walk(t.content);
  return t.innerHTML.slice(0, 6000);
}

/* ---------- 위젯 목록 맞추기 (설정에 따라 제출확인판·일정 상자 추가/제거) ---------- */
function syncWidgets() {
  const d = B.data, want = [];
  if (d.cfg.showEvents) want.push('w-events');
  if (d.cfg.showSubmit) (d.cfg.submitIds || []).forEach((id) => { if (APP.S.boards.some((b) => b.id === id)) want.push('w-sub-' + id); });
  d.items = d.items.filter((it) => it.type !== 'widget' || want.includes(it.id));
  want.forEach((id) => { if (!d.items.some((it) => it.id === id)) d.items.unshift({ id, type: 'widget' }); });
}

/* ---------- 배치 ---------- */
const bucketOf = (W) => String(Math.round(W / 60) * 60);
function autoLayout(W) {
  const gap = 10, cols = Math.max(1, Math.floor((W + gap) / (230 + gap))), cw = (W - gap * (cols - 1)) / cols, colY = Array(cols).fill(0), pos = {};
  B.data.items.forEach((it) => {
    const el = B.inner.querySelector(`[data-id="${it.id}"]`); if (!el) return;
    const w = it.type === 'image' ? Math.min(cw, it.w || cw) : cw;
    el.style.width = w + 'px';
    const c = colY.indexOf(Math.min(...colY));
    pos[it.id] = { x: c * (cw + gap) + (cw - w) / 2, y: colY[c], w };
    colY[c] += el.offsetHeight + gap;
  });
  return pos;
}
/* 배치 정하기
   - 이 화면 크기에 저장한 배치가 있으면 그대로
   - 없고 다른 크기의 배치가 있으면, 그 배치를 통째로 비율에 맞게 줄이거나 늘려서(모양 그대로) 화면 안에 모으기
   - 아무 배치도 없으면 열 맞춤 자동 정렬 */
function place() {
  if (!B.canvas || !B.canvas.isConnected) return;
  const W = B.canvas.clientWidth, H = B.canvas.clientHeight, bk = bucketOf(W), L = B.data.layouts;
  const has = (k) => L[k] && Object.keys(L[k]).some((x) => x !== '_z');
  let pos, z = 1;
  B.inner.style.zoom = 1;
  if (has(bk)) { pos = L[bk]; z = L[bk]._z || 1; }
  else {
    const keys = Object.keys(L).filter(has).map(Number);
    if (keys.length) {
      const src = keys.sort((a, b) => Math.abs(a - W) - Math.abs(b - W))[0], sz = L[src]._z || 1;
      pos = L[src]; z = sz * (W / src);
    }
  }
  const auto = !pos;
  if (auto) pos = autoLayout(W);
  // 새로 생긴 상자는 맨 아래 빈자리에
  const els = {}; B.inner.querySelectorAll('.bi').forEach((e) => { els[e.dataset.id] = e; });
  let bottom = 0; const cur = {};
  B.data.items.forEach((it) => { const p = pos[it.id], el = els[it.id]; if (p && el) { el.style.width = p.w + 'px'; bottom = Math.max(bottom, p.y + el.offsetHeight); } });
  B.data.items.forEach((it) => {
    const el = els[it.id]; if (!el) return;
    let p = pos[it.id];
    if (!p) { const w = Math.min(240, W / z); p = { x: 0, y: bottom + 10, w }; el.style.width = w + 'px'; bottom = p.y + el.offsetHeight; }
    el.style.width = p.w + 'px'; el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    cur[it.id] = { x: p.x, y: p.y, w: p.w };
  });
  if (!auto) {   // 세로로 넘치면 더 줄여서 한 화면에
    const maxB = Math.max(1, ...Object.keys(cur).map((id) => cur[id].y + els[id].offsetHeight));
    if (maxB * z > H && H > 120) z = Math.max(0.35, H / maxB);
    z = Math.max(0.35, Math.min(z, 1.6));
  }
  B.inner.style.zoom = z;
  B.cur = cur; B.z = z; B.auto = auto;
}
/* 이 화면 크기의 배치로 지금 모습을 저장 (끌기·크기 바꾸기 시작할 때) */
function pin() {
  const bk = bucketOf(B.canvas.clientWidth);
  if (!B.data.layouts[bk] || !Object.keys(B.data.layouts[bk]).some((x) => x !== '_z')) B.data.layouts[bk] = { ...JSON.parse(JSON.stringify(B.cur || {})), _z: B.z || 1 };
  return B.data.layouts[bk];
}

/* ---------- 상자 그리기 ---------- */
function widgetBody(it, ctx) {
  if (it.id === 'w-events') {
    const list = upcoming();
    return h('div', { class: 'bw-events' }, h('div', { class: 'bw-title' }, '다가오는 일정'),
      list.length ? list.map((e) => h('div', { class: 'bw-ev' + (e.notice ? ' notice' : '') },
        h('div', { class: 'bw-ev-date' }, (e.notice ? '📌 ' : '') + mdw(e.date) + (e.periods.length ? ` · ${e.periods.join(',')}교시` : '')),
        h('div', { class: 'bw-ev-text' }, e.text))) : h('div', { class: 'muted' }, '1주일 안에 일정이 없어요.'));
  }
  const b = APP.S.boards.find((x) => 'w-sub-' + x.id === it.id);
  if (!b) return h('div', { class: 'muted' }, '제출확인판이 없어요.');
  const done = new Set(b.done || []), green = new Set(b.green || []), roster = ctx.roster();
  return h('div', { class: 'bw-sub' }, h('div', { class: 'bw-title' }, b.title || '제목 없는 제출판', h('span', { class: 'bw-count' }, ` ${done.size + green.size}/${roster.length}`)),
    h('div', { class: 'bw-cells' }, roster.map((st) => h('span', { class: 'bw-cell' + (done.has(st.num) ? ' done' : green.has(st.num) ? ' green' : '') }, ctx.name(st)))));
}
function itemEl(it, ctx) {
  const locked = B.data.locked;
  const el = h('div', { class: 'bi bi-' + it.type, 'data-id': it.id });
  let body;
  if (it.type === 'text') {
    const st = it.style || {};
    body = h('div', { class: 'bt-text', contenteditable: locked ? 'false' : 'true', style: `color:${st.color || '#1f2937'};font-size:${st.size || 20}px;font-weight:${st.bold ? 700 : 400}`, 'data-ph': '글을 쓰세요' });
    body.innerHTML = cleanHtml(it.html || '');
    body.addEventListener('input', () => { it.html = cleanHtml(body.innerHTML); save(); });
    body.addEventListener('focus', () => { B.focus = { it, body }; drawTools(); });
    body.addEventListener('blur', () => { setTimeout(() => { if (B.focus && B.focus.body === body && !document.activeElement.closest('.bt-tools')) { B.focus = null; drawTools(); } place(); }, 150); });
    body.addEventListener('paste', (e) => { e.preventDefault(); const tx = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, tx); });
  } else if (it.type === 'image') {
    const img = h('img', { alt: '' });
    if (B.imgs[it.fileId]) img.src = B.imgs[it.fileId];
    else APP.api('getFile', { fileId: it.fileId }).then((f) => { B.imgs[it.fileId] = `data:${f.mime};base64,${f.data}`; img.src = B.imgs[it.fileId]; img.onload = () => place(); }).catch(() => { img.alt = '이미지를 불러오지 못했어요'; });
    img.onload = () => place();
    body = h('div', { class: 'bi-img' }, img);
  } else body = widgetBody(it, ctx);
  el.append(body);
  if (!locked) {
    const grip = h('div', { class: 'bi-grip', title: '끌어서 옮기기' }, '⠿');
    const tools = h('div', { class: 'bi-tools' },
      it.type === 'image' ? [h('button', { title: '작게', onclick: () => resize(it, el, 0.85) }, '−'), h('button', { title: '크게', onclick: () => resize(it, el, 1.18) }, '+')] : null,
      it.type === 'widget' ? null : h('button', { title: '삭제', onclick: () => { if (it.type === 'text' && (it.html || '').trim() && !confirm('이 글상자를 지울까요?')) return; removeItem(it); } }, '✕'));
    el.append(grip, tools);
    grip.addEventListener('pointerdown', (ev) => drag(ev, el, it));
  }
  return el;
}
function resize(it, el, k) {
  const L = pin(), z = L._z || 1, Wu = B.canvas.clientWidth / z, p = L[it.id] || { x: 0, y: 0, w: el.offsetWidth };
  const w = Math.max(60, Math.min(Wu, p.w * k));
  it.w = w; L[it.id] = { x: Math.min(p.x, Wu - w), y: p.y, w };
  save(); place();
}
function removeItem(it) {
  B.data.items = B.data.items.filter((x) => x !== it);
  Object.values(B.data.layouts).forEach((L) => { delete L[it.id]; });
  if (it.type === 'image' && it.fileId) APP.api('delFile', { fileId: it.fileId }).catch(() => {});
  save(); render();
}
function drag(ev, el, it) {
  ev.preventDefault();
  const L = pin(), z = L._z || 1, Wu = B.canvas.clientWidth / z;   // 이때부터 이 화면 크기는 자유 배치
  const p0 = L[it.id] || { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth }, sx = ev.clientX, sy = ev.clientY;
  el.classList.add('dragging'); el.setPointerCapture(ev.pointerId);
  let p = { ...p0 };
  const mv = (e) => {
    p = { x: Math.max(0, Math.min(Wu - p0.w, p0.x + (e.clientX - sx) / z)), y: Math.max(0, p0.y + (e.clientY - sy) / z), w: p0.w };
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
  };
  const up = () => {
    el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.classList.remove('dragging');
    L[it.id] = p; save();
  };
  el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
}

/* ---------- 글씨 도구 ---------- */
let toolsEl = null;
function applyStyle(kind, v) {
  const f = B.focus; if (!f) return;
  const sel = window.getSelection(), inBox = sel.rangeCount && !sel.isCollapsed && f.body.contains(sel.anchorNode) && f.body.contains(sel.focusNode);
  if (inBox) {   // 고른 글자만
    document.execCommand('styleWithCSS', false, true);
    if (kind === 'color') document.execCommand('foreColor', false, v);
    else if (kind === 'bold') document.execCommand('bold');
    else if (kind === 'size') { document.execCommand('fontSize', false, '7'); f.body.querySelectorAll('font[size="7"], span[style*="xxx-large"]').forEach((n) => { const s = document.createElement('span'); s.style.fontSize = v + 'px'; s.append(...n.childNodes); n.replaceWith(s); }); }
    f.it.html = cleanHtml(f.body.innerHTML);
  } else {       // 글상자 전체
    const st = (f.it.style = f.it.style || {});
    if (kind === 'color') st.color = v; else if (kind === 'bold') st.bold = !st.bold; else if (kind === 'size') st.size = v;
    f.body.style.color = st.color || '#1f2937'; f.body.style.fontSize = (st.size || 20) + 'px'; f.body.style.fontWeight = st.bold ? 700 : 400;
  }
  save(); setTimeout(place, 0);
}
function drawTools() {
  if (!toolsEl) return;
  const f = B.focus;
  toolsEl.hidden = !f;
  if (!f) return;
  const st = f.it.style || {};
  const keep = (e) => e.preventDefault();   // 누를 때 글상자의 선택이 풀리지 않게
  toolsEl.replaceChildren(
    ...COLORS.map((c) => h('button', { class: 'bt-color' + ((st.color || '#1f2937') === c ? ' on' : ''), style: `background:${c}`, title: '글씨 색', onmousedown: keep, onclick: () => { applyStyle('color', c); drawTools(); } })),
    h('select', { title: '글씨 크기', onmousedown: (e) => e.stopPropagation(), onchange: (e) => { applyStyle('size', Number(e.target.value)); } }, SIZES.map((s) => h('option', { value: s, selected: s === (st.size || 20) }, s + 'px'))),
    h('button', { class: 'bt-bold' + (st.bold ? ' on' : ''), title: '굵게', onmousedown: keep, onclick: () => { applyStyle('bold'); drawTools(); } }, 'B'),
    h('span', { class: 'muted', style: 'font-size:11px' }, '글자를 고르면 고른 부분만 바뀌어요'));
}

/* ---------- 새 상자 ---------- */
function addText() {
  const it = { id: uid(), type: 'text', html: '', style: { size: 24, color: '#1f2937' } };
  B.data.items.push(it); save(); render();
  setTimeout(() => { const b = B.inner.querySelector(`[data-id="${it.id}"] .bt-text`); if (b) b.focus(); }, 30);
}
async function addImage(file) {
  if (!file || !/^image\//.test(file.type)) return toast('이미지 파일만 붙일 수 있어요', true);
  try {
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight)), cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.imageSmoothingEnabled = k < 1; cx.drawImage(img, 0, 0, cv.width, cv.height);
    const png = /png|gif/.test(file.type), out = cv.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88), mime = png ? 'image/png' : 'image/jpeg';
    toast('이미지를 올리는 중…');
    const j = await APP.api('uploadFile', { name: '학급보드_' + Date.now() + (png ? '.png' : '.jpg'), mime, data: out.split(',')[1] });
    B.imgs[j.fileId] = out;
    B.data.items.push({ id: uid(), type: 'image', fileId: j.fileId, w: Math.min(260, cv.width) });
    save(); render(); toast('이미지를 붙였어요');
  } catch (e) { toast(errMsg(e), true); }
}

/* ---------- 설정 ---------- */
function settings() {
  const d = B.data, c = JSON.parse(JSON.stringify(d.cfg)), evs = d.events.map((e) => ({ ...e }));
  const curB = B.index.boards.find((b) => b.id === B.index.cur);
  const nameIn = h('input', { value: curB ? curB.name : '', style: 'flex:1;margin:0;width:auto', maxlength: 20 });
  const box = h('div');
  const draw = () => {
    const boards = APP.S.boards;
    const dateIn = h('input', { type: 'date', value: ymd(new Date()) }), textIn = h('input', { placeholder: '일정 내용 (예: 현장체험학습)', style: 'flex:1;min-width:160px' });
    const per = new Set(), notice = { v: false };
    box.replaceChildren(
      h('div', { class: 'opt-title' }, '보드 이름'),
      h('div', { class: 'row', style: 'gap:6px;justify-content:flex-start' }, nameIn,
        B.index.boards.length > 1 ? h('button', { class: 'sm danger', onclick: () => { ov.remove(); removeBoard(); } }, '이 보드 삭제') : null),
      h('div', { class: 'opt-title' }, '불러올 내용'),
      h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: c.showSubmit, onchange: (e) => { c.showSubmit = e.target.checked; draw(); } }), h('span', null, '제출확인판')),
      c.showSubmit ? h('div', { class: 'bd-sublist' }, boards.length ? boards.map((b) => h('label', { class: 'opt sm' }, h('input', { type: 'checkbox', checked: c.submitIds.includes(b.id), onchange: (e) => { c.submitIds = e.target.checked ? [...c.submitIds, b.id] : c.submitIds.filter((x) => x !== b.id); } }), h('span', null, b.title || '제목 없는 제출판'))) : h('div', { class: 'muted' }, '제출판이 없어요.')) : null,
      h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: c.showEvents, onchange: (e) => { c.showEvents = e.target.checked; } }), h('span', null, '다가오는 일정 (오늘부터 1주일, 공지는 날짜 전까지 항상)')),
      h('div', { class: 'opt-title' }, '일정 추가'),
      h('div', { class: 'bd-evform' },
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, dateIn, textIn),
        h('div', { class: 'row', style: 'gap:4px;flex-wrap:wrap;margin-top:6px' }, PERIODS.map((p) => h('label', { class: 'bd-per' }, h('input', { type: 'checkbox', onchange: (e) => { e.target.checked ? per.add(p) : per.delete(p); } }), `${p}교시`)),
          h('label', { class: 'bd-per notice' }, h('input', { type: 'checkbox', onchange: (e) => { notice.v = e.target.checked; } }), '📌 공지'),
          h('button', { class: 'sm primary', onclick: () => {
            if (!dateIn.value) return toast('날짜를 고르세요', true); if (!textIn.value.trim()) return toast('일정 내용을 적어 주세요', true);
            evs.push({ id: uid(), date: dateIn.value, periods: [...per].sort((a, b) => a - b), text: textIn.value.trim().slice(0, 100), notice: notice.v }); draw();
          } }, '추가'))),
      h('div', { class: 'bd-evlist' }, evs.length ? evs.slice().sort((a, b) => a.date.localeCompare(b.date)).map((e) => h('div', { class: 'list-item' + (e.date < ymd(new Date()) ? ' past' : '') },
        h('span', null, (e.notice ? '📌 ' : '') + mdw(e.date) + (e.periods.length ? ` · ${e.periods.join(',')}교시` : '') + ' · ' + e.text),
        h('button', { class: 'sm ghost', onclick: () => { evs.splice(evs.indexOf(e), 1); draw(); } }, '✕'))) : h('div', { class: 'muted' }, '등록한 일정이 없어요.')));
  };
  draw();
  const close = () => ov.remove();
  const ov = h('div', { class: 'overlay' }, h('div', { class: 'modal sub-cfg bd-cfg' }, h('h3', null, '학급보드판 설정'), box,
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' }, h('button', { onclick: close }, '취소'),
      h('button', { class: 'primary', onclick: () => {
        d.cfg = c; d.events = evs; syncWidgets(); save();
        if (curB && nameIn.value.trim() && nameIn.value.trim() !== curB.name) { curB.name = nameIn.value.trim().slice(0, 20); saveIndex(); }
        close(); render();
      } }, '적용'))));
  document.body.append(ov);
}

/* ---------- 패널 ---------- */
let CTX = null;
function render() {
  if (!B.panel || !B.panel.isConnected || !B.data) return;
  syncWidgets();
  const d = B.data;
  B.inner.replaceChildren(...d.items.map((it) => itemEl(it, CTX)),
    d.items.length ? null : h('div', { class: 'bd-empty muted' }, d.locked ? '보드가 비어 있어요.' : '"+ 글상자"나 "+ 이미지"를 눌러 보세요. 이미지는 복사해서 이 보드에 붙여넣어도(Ctrl+V) 돼요.'));
  drawHead();
  requestAnimationFrame(place);
}
let headEl = null;
function drawHead() {
  const d = B.data, fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => { addImage(e.target.files[0]); e.target.value = ''; } });
  const bs = B.index.boards;
  headEl.replaceChildren(bs.length > 1
      ? h('select', { class: 'bd-sel', title: '보드 고르기', onchange: (e) => switchTo(e.target.value) }, bs.map((b) => h('option', { value: b.id, selected: b.id === B.index.cur }, b.name)))
      : h('b', { class: 'bd-name' }, '학급보드판'),
    ...(d.locked ? [] : [h('button', { class: 'sm', onclick: addText }, '+ 글상자'), h('button', { class: 'sm', onclick: () => fileIn.click() }, '+ 이미지'), fileIn]),
    h('div', { style: 'flex:1' }),
    ...(d.locked ? [] : [h('button', { class: 'sm', onclick: settings }, '설정'), h('button', { class: 'sm', title: '열에 맞춰 다시 정렬', onclick: () => { d.layouts = {}; save(); render(); } }, '자동정렬'),
      h('button', { class: 'sm', title: '빈 보드를 새로 만들어요 (지금 보드는 그대로 남아요)', onclick: addBoard }, '+ 보드 추가')]),
    h('button', { class: 'sm' + (d.locked ? ' primary' : ''), title: '잠그면 학생이 보드를 고칠 수 없어요', onclick: () => { d.locked = !d.locked; save(); render(); } }, d.locked ? '🔒 잠김' : '잠금'));
}
function mount(ctx) {
  CTX = ctx;
  headEl = h('div', { class: 'bd-head' });
  toolsEl = h('div', { class: 'bt-tools', hidden: true });
  B.inner = h('div', { class: 'bd-inner' });
  B.canvas = h('div', { class: 'bd-canvas' }, B.inner);
  B.panel = h('div', { class: 'bd-panel' }, headEl, toolsEl, B.canvas);
  // 이미지 붙여넣기
  B.panel.addEventListener('paste', (e) => {
    if (B.data && B.data.locked) return;
    const f = [...(e.clipboardData || {}).items || []].find((x) => x.kind === 'file' && /^image\//.test(x.type));
    if (f) { e.preventDefault(); addImage(f.getAsFile()); }
  });
  B.panel.tabIndex = -1;
  headEl.append(h('span', { class: 'muted' }, '불러오는 중…'));
  load().then(render);
  return B.panel;
}
function relayout() { if (B.data) place(); }
function refresh() { if (!B.data || !B.canvas || !B.canvas.isConnected) return; const n = B.data.items.length; syncWidgets(); if (B.data.items.length !== n) return render(); B.inner.querySelectorAll('.bi-widget').forEach((el) => { const it = B.data.items.find((x) => x.id === el.dataset.id); if (it) { el.firstChild.replaceWith(widgetBody(it, CTX)); } }); place(); }
APP.classBoard = { mount, relayout, refresh };
})();
