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
    if (!['b', 'strong', 'span', 'br', 'div', 'font', 'p', 'u', 'i', 'em', 'a'].includes(tag)) { c.replaceWith(...c.childNodes); walk(n); return; }
    const st = c.getAttribute('style') || '', color = c.getAttribute('color'), href = c.getAttribute('href') || '';
    [...c.attributes].forEach((a) => c.removeAttribute(a.name));
    if (tag === 'a') { if (!safeUrl(href)) { c.replaceWith(...c.childNodes); walk(n); return; } c.setAttribute('href', href); c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener'); }
    const keep = st.split(';').map((x) => x.trim()).filter((x) => /^(color|font-size|font-weight|font-style|text-decoration|text-decoration-line)\s*:\s*[#\w(),.\s%-]+$/i.test(x)).join(';');
    if (keep) c.setAttribute('style', keep);
    if (tag === 'font' && color) c.setAttribute('style', (keep ? keep + ';' : '') + 'color:' + color.replace(/[^#\w]/g, ''));
    walk(c);
  });
  walk(t.content);
  return t.innerHTML.slice(0, 6000);
}

/* ---------- 링크 ---------- */
const URL_RE = /https?:\/\/[^\s<>"']+/g;
const safeUrl = (u) => /^https?:\/\/[^\s<>"']+$/i.test(String(u || '').trim());
const trimUrl = (u) => u.replace(/[.,!?)\]}'"’”。、]+$/, '');
function openLink(u) { if (safeUrl(u)) window.open(u, '_blank', 'noopener'); }
/* 글상자 안의 https:// 로 시작하는 글을 링크로 바꾸기 (이미 있는 링크는 글과 주소를 맞춤) */
function linkify(root) {
  root.querySelectorAll('a').forEach((a) => {
    const t = (a.textContent || '').trim();
    if (safeUrl(t) && trimUrl(t) === t) { a.setAttribute('href', t); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); } else a.replaceWith(...a.childNodes);
  });
  root.normalize();
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
  while (tw.nextNode()) if (!tw.currentNode.parentElement.closest('a')) nodes.push(tw.currentNode);
  nodes.forEach((tn) => {
    const v = tn.nodeValue; URL_RE.lastIndex = 0; if (!URL_RE.test(v)) return;
    const frag = document.createDocumentFragment(); let last = 0; URL_RE.lastIndex = 0; let m;
    while ((m = URL_RE.exec(v))) {
      const u = trimUrl(m[0]); if (!u.replace(/^https?:\/\//, '')) continue;
      frag.append(v.slice(last, m.index));
      const a = document.createElement('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener'; a.textContent = u; frag.append(a);
      last = m.index + u.length;
    }
    frag.append(v.slice(last)); tn.replaceWith(frag);
  });
  return root;
}
const linkHtml = (html) => { const t = document.createElement('div'); t.innerHTML = cleanHtml(html); linkify(t); return t.innerHTML; };

/* ---------- QR 코드 읽기 (브라우저 기능 → 없으면 jsQR) ---------- */
let jsqrP = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!jsqrP) jsqrP = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'; sc.onload = () => (window.jsQR ? res(window.jsQR) : rej(new Error('jsQR'))); sc.onerror = () => { jsqrP = null; rej(new Error('jsQR')); }; document.head.append(sc); });
  return jsqrP;
}
async function readQR(cv) {
  try {
    if ('BarcodeDetector' in window) {
      const f = await window.BarcodeDetector.getSupportedFormats();
      if (f.includes('qr_code')) { const r = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(cv); if (r[0] && r[0].rawValue) return r[0].rawValue.trim(); }
    }
  } catch (e) { /* 다음 방법 */ }
  try {
    const jsQR = await loadJsQR(), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
    const r = jsQR(d.data, cv.width, cv.height); if (r && r.data) return String(r.data).trim();
  } catch (e) { /* 못 읽음 */ }
  return '';
}

const boxStyle = (st) => `color:${st.color || '#1f2937'};font-size:${st.size || 20}px;font-weight:${st.bold ? 700 : 400};font-style:${st.italic ? 'italic' : 'normal'};text-decoration:${st.underline ? 'underline' : 'none'}`;

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
    el.style.width = w + 'px'; el.style.height = '';
    if (it.type === 'widget') fitSub(el, false);
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
  if (auto) {   // 자동 정렬: 열 수를 늘려 가며 한 화면(세로)에 다 들어가게
    z = 1; pos = autoLayout(W);
    const hOf = (ps) => Math.max(0, ...Object.keys(ps).map((id) => { const e = B.inner.querySelector(`[data-id="${id}"]`); return ps[id].y + (e ? e.offsetHeight : 0); }));
    for (let i = 0; i < 12 && H > 120 && hOf(pos) * z > H && z > 0.4; i++) { z = Math.max(0.4, z * 0.9); pos = autoLayout(W / z); }
  }
  // 새로 생긴 상자는 지금 보이는 화면의 왼쪽 위에
  const els = {}; B.inner.querySelectorAll('.bi').forEach((e) => { els[e.dataset.id] = e; });
  const cur = {}; let nNew = 0;
  B.data.items.forEach((it) => {
    const el = els[it.id]; if (!el) return;
    let p = pos[it.id];
    if (!p) { const w = Math.min(240, W / z); p = { x: B.canvas.scrollLeft / z + 10 + nNew * 20, y: B.canvas.scrollTop / z + 10 + nNew * 20, w }; nNew++; }
    el.style.width = p.w + 'px'; el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    el.style.height = p.h && it.type !== 'image' ? p.h + 'px' : '';
    if (it.type === 'widget') fitSub(el, !!p.h);
    cur[it.id] = { x: p.x, y: p.y, w: p.w, ...(p.h ? { h: p.h } : {}) };
  });
  z = Math.max(0.35, Math.min(z, 1.6));
  B.inner.style.zoom = z;
  B.cur = cur; B.z = z; B.auto = auto;
  sizeInner();
}
/* 보드는 끝없이 넓음: 화면 밖으로 치운 상자까지 스크롤(또는 바탕을 끌어서)로 볼 수 있게 크기 맞추기 */
function sizeInner(extraX, extraY) {
  const z = B.z || 1; let r = 0, b = 0;
  B.inner.querySelectorAll('.bi').forEach((e) => { r = Math.max(r, e.offsetLeft + e.offsetWidth); b = Math.max(b, e.offsetTop + e.offsetHeight); });
  const cw = B.canvas.clientWidth / z, ch = B.canvas.clientHeight / z;
  const fit = (v, c, ex) => Math.floor((v <= c + 2 ? c - 1 : v + 20) + (ex || 0));
  B.inner.style.width = fit(r, cw, extraX) + 'px';
  B.inner.style.height = fit(b, ch, extraY) + 'px';
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
    const go = (e) => { e.stopPropagation(); settings('events'); };
    return h('div', { class: 'bw-events', title: '눌러서 일정 고치기', onclick: go }, h('div', { class: 'bw-title' }, '다가오는 일정', h('span', { class: 'bw-edit' }, '✎ 일정')),
      list.length ? list.map((e) => h('div', { class: 'bw-ev' + (e.notice ? ' notice' : '') },
        h('div', { class: 'bw-ev-date' }, (e.notice ? '📌 ' : '') + mdw(e.date) + (e.periods.length ? ` · ${e.periods.join(',')}교시` : '')),
        h('div', { class: 'bw-ev-text' }, e.text))) : h('div', { class: 'muted' }, '1주일 안에 일정이 없어요.'));
  }
  const b = APP.S.boards.find((x) => 'w-sub-' + x.id === it.id);
  if (!b) return h('div', { class: 'muted' }, '제출확인판이 없어요.');
  const roster = ctx.roster();
  B.wOpen = B.wOpen || new Set();
  const wl = b.locked || !B.wOpen.has(b.id);   // 보드에서는 열 때마다 잠긴 채로 시작
  const done = new Set(b.done || []), green = new Set(b.green || []);
  const count = h('span', { class: 'bw-count' });
  const upCount = () => { count.textContent = ` ${done.size + green.size}/${roster.length}`; };
  const commit = () => { b.done = [...done].sort((x, y) => x - y); b.green = [...green].sort((x, y) => x - y); upCount(); APP.queueBoardSave(b); };
  const paint = (c, n) => { c.classList.toggle('done', done.has(n)); c.classList.toggle('green', green.has(n)); };
  const cells = roster.map((st) => {
    const c = h('span', { class: 'bw-cell' }, h('span', null, ctx.name(st)));
    paint(c, st.num);
    let t = null;
    c.addEventListener('click', (e) => {
      e.stopPropagation();
      if (b.locked || !B.wOpen.has(b.id)) return toast('잠금을 풀어야 누를 수 있어요');
      b.doneAt = b.doneAt || {};
      if (t) { clearTimeout(t); t = null; done.delete(st.num); delete b.doneAt[st.num]; green.add(st.num); paint(c, st.num); commit(); return; }   // 두 번 → 연두색
      t = setTimeout(() => {
        t = null;
        if (green.has(st.num)) { green.delete(st.num); done.add(st.num); b.doneAt[st.num] = Date.now(); }
        else if (done.has(st.num)) { done.delete(st.num); delete b.doneAt[st.num]; } else { done.add(st.num); b.doneAt[st.num] = Date.now(); }
        paint(c, st.num); commit();
      }, 260);
    });
    return c;
  });
  upCount();
  const lockBtn = h('button', { class: 'bw-lock' + (wl ? ' on' : ''), title: wl ? '잠금 풀기' : '잠그기 (누르지 못하게)', onclick: (e) => {
    e.stopPropagation();
    if (wl) { B.wOpen.add(b.id); if (b.locked) { b.locked = false; APP.queueBoardSave(b); } } else B.wOpen.delete(b.id);
    refresh();
  } }, wl ? '잠김' : '잠금');
  return h('div', { class: 'bw-sub' + (wl ? ' locked' : '') }, h('div', { class: 'bw-title' }, h('span', null, b.title || '제목 없는 제출판'), count, h('span', { style: 'flex:1' }), lockBtn),
    h('div', { class: 'bw-cells' }, cells));
}
/* 제출판 이름 카드: 모두 같은 크기로, 상자 크기에 맞게 */
function fitSub(el, hasH) {
  const grid = el.querySelector('.bw-cells'); if (!grid) return;
  const n = grid.children.length; if (!n) return;
  const L = Math.max(2, ...[...grid.children].map((c) => [...c.textContent].length)), W = grid.clientWidth, gap = 4;
  let best = null;
  if (hasH) {
    const H = el.clientHeight - grid.offsetTop - 12;
    for (let c = 1; c <= n; c++) { const r = Math.ceil(n / c), cw = (W - gap * (c - 1)) / c, ch = (H - gap * (r - 1)) / r; if (cw <= 0 || ch <= 0) continue; const f = Math.min(ch * 0.5, cw / (L + 0.8), 60); if (!best || f > best.f) best = { c, ch, f }; }
  }
  if (!best) { const f = 13, cw = f * (L + 0.8) + 4, c = Math.max(1, Math.floor((W + gap) / (cw + gap))); best = { c, ch: 28, f }; }
  grid.style.gridTemplateColumns = `repeat(${best.c}, 1fr)`; grid.style.gridAutoRows = Math.max(18, Math.floor(best.ch)) + 'px'; grid.style.fontSize = Math.max(10, Math.floor(best.f)) + 'px';
}
function itemEl(it, ctx) {
  const locked = B.data.locked;
  const el = h('div', { class: 'bi bi-' + it.type, 'data-id': it.id });
  let body;
  if (it.type === 'text') {
    const st = it.style || {};
    body = h('div', { class: 'bt-text', contenteditable: locked ? 'false' : 'true', style: boxStyle(st), 'data-ph': '글을 쓰세요' });
    body.innerHTML = linkHtml(it.html || '');
    body.addEventListener('input', () => { it.html = cleanHtml(body.innerHTML); save(); });
    // 링크 누르기: 글을 고치는 중이 아니면 새 창으로 열기
    body.addEventListener('pointerdown', (e) => {
      const a = e.target.closest('a'); if (!a || document.activeElement === body) return;
      e.preventDefault(); e.stopPropagation(); select(it.id); openLink(a.getAttribute('href'));
    });
    body.addEventListener('click', (e) => { if (e.target.closest('a') && document.activeElement !== body) e.preventDefault(); });
    body.addEventListener('focus', () => { B.focus = { it, body }; drawTools(); });
    body.addEventListener('blur', () => {
      const nh = linkHtml(body.innerHTML); if (nh !== body.innerHTML) { body.innerHTML = nh; }
      if (cleanHtml(body.innerHTML) !== it.html) { it.html = cleanHtml(body.innerHTML); save(); }
      setTimeout(() => { if (B.focus && B.focus.body === body && !document.activeElement.closest('.bt-tools')) { B.focus = null; drawTools(); } place(); }, 150); });
    body.addEventListener('paste', (e) => { e.preventDefault(); const tx = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, tx); });
  } else if (it.type === 'image') {
    const img = h('img', { alt: '' });
    if (B.imgs[it.fileId]) img.src = B.imgs[it.fileId];
    else APP.api('getFile', { fileId: it.fileId }).then((f) => { B.imgs[it.fileId] = `data:${f.mime};base64,${f.data}`; img.src = B.imgs[it.fileId]; img.onload = () => place(); }).catch(() => { img.alt = '이미지를 불러오지 못했어요'; });
    img.onload = () => place();
    body = h('div', { class: 'bi-img' + (it.link ? ' has-link' : ''), title: it.link ? it.link + ' (누르면 열려요)' : null }, img, it.link ? h('span', { class: 'bi-link' }, '🔗') : null);
    if (it.link) {
      let sx = 0, sy = 0;
      img.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
      img.addEventListener('click', (e) => { if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) < 8) openLink(it.link); });
    }
  } else body = widgetBody(it, ctx);
  el.append(body);
  if (!locked) {
    const grip = h('div', { class: 'bi-grip', title: '끌어서 옮기기' }, '⠿');
    const tools = h('div', { class: 'bi-tools' },
      it.type === 'image' ? [h('button', { title: '링크 걸기', onclick: () => editLink(it) }, '🔗'), h('button', { title: '작게', onclick: () => resize(it, el, 0.85) }, '−'), h('button', { title: '크게', onclick: () => resize(it, el, 1.18) }, '+')] : null,
      it.type === 'widget' ? null : h('button', { title: '삭제', onclick: () => { if (it.type === 'text' && (it.html || '').trim() && !confirm('이 글상자를 지울까요?')) return; removeItem(it); } }, '✕'));
    const rz = h('div', { class: 'bi-resize', title: '끌어서 크기 바꾸기' });
    el.append(grip, tools, rz);
    grip.addEventListener('pointerdown', (ev) => { if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur(); select(it.id); drag(ev, el, it); });
    rz.addEventListener('pointerdown', (ev) => { select(it.id); resizeDrag(ev, el, it); });
  }
  el.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('button')) return;
    // 글상자 안이 아닌 곳(테두리·손잡이)을 누르면 글쓰기를 끝내고 상자를 고른 상태로 → 단축키 사용
    if (!ev.target.closest('.bt-text') && document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
    select(it.id);
  });
  if (B.sel === it.id) el.classList.add('sel');
  return el;
}
function editLink(it) {
  const v = prompt('이미지를 누르면 열릴 주소 (https://…)\n비우면 링크를 없애요', it.link || 'https://');
  if (v === null) return;
  const u = v.trim();
  if (u && u !== 'https://' && !safeUrl(u)) return toast('https:// 로 시작하는 주소를 넣어 주세요', true);
  pushUndo();
  if (u && u !== 'https://') it.link = u; else delete it.link;
  save(); render(); toast(it.link ? '링크를 걸었어요' : '링크를 없앴어요');
}
function resize(it, el, k) {
  const L = pin(), z = L._z || 1, Wu = B.canvas.clientWidth / z, p = L[it.id] || { x: 0, y: 0, w: el.offsetWidth };
  const w = Math.max(60, Math.min(Wu, p.w * k));
  it.w = w; L[it.id] = { ...p, w };
  save(); place();
}
function removeItem(it) {
  pushUndo();
  B.data.items = B.data.items.filter((x) => x !== it);
  Object.values(B.data.layouts).forEach((L) => { delete L[it.id]; });
  if (B.sel === it.id) B.sel = null;
  save(); render();
}
/* 모서리를 끌어서 크기 바꾸기 (이미지는 비율 그대로) */
function resizeDrag(ev, el, it) {
  ev.preventDefault(); ev.stopPropagation(); pushUndo();
  const L = pin(), z = L._z || 1, Wu = B.canvas.clientWidth / z;
  const p0 = { ...(L[it.id] || { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth }) }, h0 = p0.h || el.offsetHeight, sx = ev.clientX, sy = ev.clientY;
  ev.target.setPointerCapture(ev.pointerId); el.classList.add('dragging');
  let p = { ...p0 };
  const mv = (e) => {
    const w = Math.max(60, Math.min(Math.max(Wu, 3000), p0.w + (e.clientX - sx) / z));
    p = { ...p0, w };
    if (it.type !== 'image') { p.h = Math.max(40, h0 + (e.clientY - sy) / z); el.style.height = p.h + 'px'; }
    el.style.width = w + 'px';
    if (it.type === 'widget') fitSub(el, !!p.h);
  };
  const up = () => { ev.target.removeEventListener('pointermove', mv); ev.target.removeEventListener('pointerup', up); el.classList.remove('dragging'); if (it.type === 'image') it.w = p.w; L[it.id] = p; save(); place(); };
  ev.target.addEventListener('pointermove', mv); ev.target.addEventListener('pointerup', up);
}
/* ---------- 고르기 · 단축키 (Ctrl+C / X / V / Z) ---------- */
function select(id) {
  B.sel = id;
  if (B.inner) B.inner.querySelectorAll('.bi').forEach((e) => e.classList.toggle('sel', e.dataset.id === id));
}
function pushUndo() {
  if (!B.data) return;
  B.hist = B.hist || []; B.hist.push(JSON.stringify({ items: B.data.items, layouts: B.data.layouts }));
  if (B.hist.length > 40) B.hist.shift();
}
function undo() {
  if (!B.hist || !B.hist.length) return toast('되돌릴 작업이 없어요');
  const o = JSON.parse(B.hist.pop()); B.data.items = o.items; B.data.layouts = o.layouts; save(); render();
}
function copySel(cut) {
  const it = B.data.items.find((x) => x.id === B.sel); if (!it) return;
  const pos = (B.cur || {})[it.id];
  if (it.type === 'widget' && !cut) return toast('불러온 상자는 복사할 수 없어요. Ctrl+X → Ctrl+V로 맨 위로 올릴 수는 있어요.');
  B.clip = { item: JSON.parse(JSON.stringify(it)), pos: pos ? { ...pos } : null, cut, layouts: JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(B.data.layouts).map(([k, L]) => [k, L[it.id] || null])))) };
  if (cut) {
    if (it.type === 'widget') { B.clip.moveId = it.id; toast('붙여넣으면(Ctrl+V) 맨 위로 올라와요'); return; }
    pushUndo();
    B.data.items = B.data.items.filter((x) => x !== it); B.sel = null; save(); render();
  } else toast('복사했어요. Ctrl+V로 붙여넣으세요');
}
function pasteClip() {
  const c = B.clip; if (!c) return false;
  pushUndo();
  if (c.moveId) {   // 불러온 상자: 맨 위(맨 뒤 순서)로
    const it = B.data.items.find((x) => x.id === c.moveId);
    if (it) { B.data.items = B.data.items.filter((x) => x !== it).concat(it); B.sel = it.id; }
    B.clip = null; save(); render(); return true;
  }
  const it = { ...JSON.parse(JSON.stringify(c.item)), id: c.cut ? c.item.id : uid() };
  if (B.data.items.some((x) => x.id === it.id)) it.id = uid();
  B.data.items.push(it);   // 가장 나중에 붙인 것이 맨 위
  const d = c.cut ? 0 : 20;
  Object.entries(c.layouts || {}).forEach(([k, p]) => { if (p && B.data.layouts[k]) B.data.layouts[k][it.id] = { ...p, x: p.x + d, y: p.y + d }; });
  if (c.pos) { const L = pin(); L[it.id] = { ...c.pos, x: c.pos.x + d, y: c.pos.y + d }; }
  if (c.cut) B.clip = null; else c.pos = c.pos ? { ...c.pos, x: c.pos.x + d, y: c.pos.y + d } : null;
  B.sel = it.id; save(); render(); return true;
}
let pasteT = null;
const boardActive = () => B.panel && B.panel.isConnected && B.data && !B.data.locked && !document.querySelector('.overlay');
const editing = () => { const a = document.activeElement; return a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
document.addEventListener('keydown', (e) => {
  if (!boardActive() || editing()) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z') { e.preventDefault(); undo(); }
  else if (mod && k === 'c' && B.sel) { e.preventDefault(); copySel(false); }
  else if (mod && k === 'x' && B.sel) { e.preventDefault(); copySel(true); }
  else if (mod && k === 'v' && B.clip) {
    // 붙여넣기 이벤트가 안 오는 브라우저도 있어서, 잠깐 기다렸다가 직접 붙여넣기 (이미지를 복사해 둔 경우는 이미지 우선)
    clearTimeout(pasteT); pasteT = setTimeout(() => { pasteT = null; pasteClip(); }, 120);
  }
  else if ((k === 'delete' || k === 'backspace') && B.sel) { const it = B.data.items.find((x) => x.id === B.sel); if (it && it.type !== 'widget') { e.preventDefault(); removeItem(it); } }
});
document.addEventListener('paste', (e) => {
  if (!boardActive() || editing()) return;
  const f = [...((e.clipboardData || {}).items || [])].find((x) => x.kind === 'file' && /^image\//.test(x.type));
  if (f) { e.preventDefault(); clearTimeout(pasteT); pasteT = null; addImage(f.getAsFile()); return; }
  if (B.clip) { e.preventDefault(); if (pasteT) { clearTimeout(pasteT); pasteT = null; } pasteClip(); }
});
function drag(ev, el, it) {
  ev.preventDefault(); pushUndo();
  const L = pin(), z = L._z || 1;   // 이때부터 이 화면 크기는 자유 배치
  const p0 = L[it.id] || { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth }, sx = ev.clientX, sy = ev.clientY;
  el.classList.add('dragging'); el.setPointerCapture(ev.pointerId);
  let p = { ...p0 };
  const C = B.canvas, sl0 = C.scrollLeft, st0 = C.scrollTop;
  let lastE = ev, timer = null, vx = 0, vy = 0;
  const mv = (e) => {
    if (e) lastE = e;
    const dx = (lastE.clientX - sx + C.scrollLeft - sl0) / z, dy = (lastE.clientY - sy + C.scrollTop - st0) / z;
    p = { ...p0, x: Math.max(0, p0.x + dx), y: Math.max(0, p0.y + dy) };
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    // 화면 가장자리로 끌면 보드가 따라 움직임 (보드는 끝없이 넓음)
    const r = C.getBoundingClientRect(), edge = 30;
    vx = lastE.clientX > r.right - edge ? 14 : lastE.clientX < r.left + edge ? -14 : 0; vy = lastE.clientY > r.bottom - edge ? 14 : lastE.clientY < r.top + edge ? -14 : 0;
    if ((vx || vy) && !timer) timer = setInterval(() => { sizeInner(vx > 0 ? 400 : 0, vy > 0 ? 400 : 0); C.scrollLeft += vx; C.scrollTop += vy; mv(); }, 30);
    else if (!vx && !vy && timer) { clearInterval(timer); timer = null; }
  };
  const up = () => {
    if (timer) clearInterval(timer);
    el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.classList.remove('dragging');
    L[it.id] = p; save(); sizeInner();
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
    else if (kind === 'underline') document.execCommand('underline');
    else if (kind === 'italic') document.execCommand('italic');
    else if (kind === 'size') { document.execCommand('fontSize', false, '7'); f.body.querySelectorAll('font[size="7"], span[style*="xxx-large"]').forEach((n) => { const s = document.createElement('span'); s.style.fontSize = v + 'px'; s.append(...n.childNodes); n.replaceWith(s); }); }
    f.it.html = cleanHtml(f.body.innerHTML);
  } else {       // 글상자 전체
    const st = (f.it.style = f.it.style || {});
    pushUndo();
    if (kind === 'color') st.color = v; else if (kind === 'bold') st.bold = !st.bold; else if (kind === 'size') st.size = v;
    else if (kind === 'underline') st.underline = !st.underline; else if (kind === 'italic') st.italic = !st.italic;
    f.body.setAttribute('style', boxStyle(st));
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
    h('button', { class: 'bt-bold bt-i' + (st.italic ? ' on' : ''), title: '기울임', onmousedown: keep, onclick: () => { applyStyle('italic'); drawTools(); } }, 'I'),
    h('button', { class: 'bt-bold bt-u' + (st.underline ? ' on' : ''), title: '밑줄', onmousedown: keep, onclick: () => { applyStyle('underline'); drawTools(); } }, 'U'),
    h('span', { class: 'muted', style: 'font-size:11px' }, '글자를 고르면 고른 부분만 바뀌어요'));
}

/* ---------- 새 상자 ---------- */
function addText() {
  const it = { id: uid(), type: 'text', html: '', style: { size: 24, color: '#1f2937' } };
  pushUndo(); B.data.items.push(it); B.sel = it.id; save(); render();
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
    let qr = await readQR(cv);
    if (qr && !safeUrl(qr)) qr = '';
    const nit = { id: uid(), type: 'image', fileId: j.fileId, w: Math.min(260, cv.width) };
    if (qr) nit.link = qr;
    pushUndo(); B.data.items.push(nit);
    save(); render(); toast(qr ? 'QR 코드를 읽어 링크를 걸었어요' : '이미지를 붙였어요');
  } catch (e) { toast(errMsg(e), true); }
}

/* ---------- 설정 ---------- */
function settings(startTab) {
  const d = B.data, c = JSON.parse(JSON.stringify(d.cfg)), evs = d.events.map((e) => ({ ...e }));
  const curB = B.index.boards.find((b) => b.id === B.index.cur);
  const nameIn = h('input', { value: curB ? curB.name : '', style: 'flex:1;margin:0;width:auto', maxlength: 20 });
  const box = h('div');
  let tab = startTab === 'events' ? 'events' : 'basic';
  const draw = () => {
    const boards = APP.S.boards;
    const dateIn = h('input', { type: 'date', value: ymd(new Date()) }), textIn = h('input', { placeholder: '일정 내용 (예: 현장체험학습)', style: 'flex:1;min-width:160px' });
    const per = new Set(), notice = { v: false };
    const tabs = h('div', { class: 'tabs', style: 'margin-bottom:6px' }, [['basic', '기본 설정'], ['events', `일정 (${evs.length})`]].map(([k, n]) => h('button', { class: 'tab sm' + (tab === k ? ' active' : ''), onclick: () => { tab = k; draw(); } }, n)));
    if (tab === 'events') return box.replaceChildren(tabs,
      h('div', { class: 'opt-title' }, '일정 추가'),
      h('div', { class: 'bd-evform' },
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, dateIn, textIn),
        h('div', { class: 'row', style: 'gap:4px;flex-wrap:wrap;margin-top:6px' }, PERIODS.map((p) => h('label', { class: 'bd-per' }, h('input', { type: 'checkbox', onchange: (e) => { e.target.checked ? per.add(p) : per.delete(p); } }), `${p}교시`)),
          h('label', { class: 'bd-per notice' }, h('input', { type: 'checkbox', onchange: (e) => { notice.v = e.target.checked; } }), '📌 공지'),
          h('button', { class: 'sm primary', onclick: () => {
            if (!dateIn.value) return toast('날짜를 고르세요', true); if (!textIn.value.trim()) return toast('일정 내용을 적어 주세요', true);
            evs.push({ id: uid(), date: dateIn.value, periods: [...per].sort((a, b) => a - b), text: textIn.value.trim().slice(0, 100), notice: notice.v }); draw();
          } }, '추가'))),
      h('div', { class: 'opt-title' }, `추가된 일정 ${evs.length}개`),
      h('div', { class: 'bd-evlist' }, evs.length ? evs.slice().sort((a, b) => a.date.localeCompare(b.date)).map((e) => h('div', { class: 'list-item' + (e.date < ymd(new Date()) ? ' past' : '') },
        h('span', null, (e.notice ? '📌 ' : '') + mdw(e.date) + (e.periods.length ? ` · ${e.periods.join(',')}교시` : '') + ' · ' + e.text),
        h('button', { class: 'sm ghost', onclick: () => { evs.splice(evs.indexOf(e), 1); draw(); } }, '✕'))) : h('div', { class: 'muted' }, '등록한 일정이 없어요.')));
    box.replaceChildren(tabs,
      h('div', { class: 'opt-title' }, '보드 이름'),
      h('div', { class: 'row', style: 'gap:6px;justify-content:flex-start' }, nameIn,
        B.index.boards.length > 1 ? h('button', { class: 'sm danger', onclick: () => { ov.remove(); removeBoard(); } }, '이 보드 삭제') : null),
      h('div', { class: 'opt-title' }, '불러올 내용'),
      h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: c.showSubmit, onchange: (e) => { c.showSubmit = e.target.checked; draw(); } }), h('span', null, '제출확인판')),
      c.showSubmit ? h('div', { class: 'bd-sublist' }, boards.length ? boards.map((b) => h('label', { class: 'opt sm' }, h('input', { type: 'checkbox', checked: c.submitIds.includes(b.id), onchange: (e) => { c.submitIds = e.target.checked ? [...c.submitIds, b.id] : c.submitIds.filter((x) => x !== b.id); } }), h('span', null, b.title || '제목 없는 제출판'))) : h('div', { class: 'muted' }, '제출판이 없어요.')) : null,
      h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: c.showEvents, onchange: (e) => { c.showEvents = e.target.checked; } }), h('span', null, '다가오는 일정 (오늘부터 1주일, 공지는 날짜 전까지 항상)')));
  };
  draw();
  const close = () => ov.remove();
  const ov = h('div', { class: 'overlay' }, h('div', { class: 'modal sub-cfg bd-cfg' }, h('h3', null, '학급보드판 설정'), box,
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' }, h('button', { onclick: close }, '취소'),
      h('button', { class: 'primary', onclick: () => {
        pushUndo(); d.cfg = c; d.events = evs; syncWidgets(); save();
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
    ...(d.locked ? [] : [h('button', { class: 'sm', onclick: settings }, '설정'), h('button', { class: 'sm', title: '열에 맞춰 다시 정렬', onclick: () => { pushUndo(); d.layouts = {}; save(); render(); } }, '자동정렬'),
      h('button', { class: 'sm', title: '빈 보드를 새로 만들어요 (지금 보드는 그대로 남아요)', onclick: addBoard }, '+ 보드 추가')]),
    h('button', { class: 'sm', title: '전체화면', onclick: () => { const w = B.panel.closest('.bd-page') || B.panel; document.fullscreenElement ? document.exitFullscreen() : (w.requestFullscreen && w.requestFullscreen()); } }, document.fullscreenElement ? '전체화면 끝' : '전체화면'),
    h('button', { class: 'sm' + (d.locked ? ' primary' : ''), title: '잠그면 학생이 보드를 고칠 수 없어요', onclick: () => { d.locked = !d.locked; save(); render(); } }, d.locked ? '🔒 잠김' : '잠금'));
}
function mount(ctx) {
  CTX = ctx; B.wOpen = new Set();
  headEl = h('div', { class: 'bd-head' });
  toolsEl = h('div', { class: 'bt-tools', hidden: true });
  B.inner = h('div', { class: 'bd-inner' });
  B.canvas = h('div', { class: 'bd-canvas' }, B.inner);
  B.panel = h('div', { class: 'bd-panel' }, headEl, toolsEl, B.canvas);
  B.canvas.addEventListener('pointerdown', (e) => {
    if (e.target !== B.canvas && e.target !== B.inner) return;
    select(null);
    if (e.pointerType !== 'mouse' || e.button !== 0) return;   // 손가락은 원래대로 밀어서 이동
    const C = B.canvas, sx = e.clientX, sy = e.clientY, l0 = C.scrollLeft, t0 = C.scrollTop;
    C.classList.add('panning');
    const mv = (m) => { C.scrollLeft = l0 - (m.clientX - sx); C.scrollTop = t0 - (m.clientY - sy); };
    const up = () => { C.classList.remove('panning'); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
  B.panel.tabIndex = -1;
  headEl.append(h('span', { class: 'muted' }, '불러오는 중…'));
  load().then(render);
  return B.panel;
}
function relayout() { if (B.data) place(); }
function refresh() { if (!B.data || !B.canvas || !B.canvas.isConnected) return; const n = B.data.items.length; syncWidgets(); if (B.data.items.length !== n) return render(); B.inner.querySelectorAll('.bi-widget').forEach((el) => { const it = B.data.items.find((x) => x.id === el.dataset.id); if (it) { el.firstChild.replaceWith(widgetBody(it, CTX)); } }); place(); }
function lockWidgets() {
  if (!B.wOpen || !B.wOpen.size) return 0;
  const n = B.wOpen.size; B.wOpen.clear(); refresh(); return n;
}
APP.classBoard = { mount, relayout, refresh, lockWidgets };

/* 메인 메뉴: 학급보드판 */
APP.pages.board = () => {
  const panel = mount({ roster: () => APP.S.roster.slice().sort((a, b) => a.num - b.num), name: (st) => APP.subDisplayName(st) });
  const wrap = h('div', { class: 'bd-page' }, panel);
  const fit = () => {
    if (!panel.isConnected) return;
    const top = panel.getBoundingClientRect().top;
    panel.style.height = Math.max(360, window.innerHeight - top - (document.fullscreenElement ? 12 : 24)) + 'px';
    relayout();
  };
  fitPanel = fit;
  requestAnimationFrame(fit);
  return wrap;
};
let fitPanel = null;
window.addEventListener('pagehide', () => { flush(); });
window.addEventListener('resize', () => { if (fitPanel) fitPanel(); });
document.addEventListener('fullscreenchange', () => setTimeout(() => { if (fitPanel) fitPanel(); }, 60));
})();
