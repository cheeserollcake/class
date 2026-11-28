/* 성적 관리 → 평어 관리 / 평어 생성
   평어 관리: 교과 평어(기초작업의 과목·평가기준·평어별), 창체 평어(과목·날짜), 행발 평어(긍정/부정·교과/행동) — 학기별, 입력 즉시 저장
   평어 생성: 입력한 평어(+ 행발은 누가기록·교우관계 분석)로 학생마다 문장을 조합. 학급 전체에서 같은 문장이 겹치지 않게 배치 */
(() => {
'use strict';
const APP = window.APP;
const { h, api, toast, errMsg } = APP;
const G = () => APP.gradeCore;
const GR = () => APP.gradeCore.GR;

const CM = { sub: 'subj', gsub: 'subj', kv: {}, timers: {}, n: { subj: 3, cc: 3, beh: 3 }, subjF: '', ccF: '', behF: '', genSubj: null, genCC: null, ccDate: '', dirty: {} };
APP.onLock.push(() => { CM.kv = {}; CM.dirty = {}; });
APP.onClear.push(() => { CM.kv = {}; CM.dirty = {}; });

const sem = () => GR().sem;
const K = {
  subj: (s) => `grade:cmt:subj:${s}`, cc: (s) => `grade:cmt:cc:${s}`, beh: (s) => `grade:cmt:beh:${s}`,
  gSubj: (s, id) => `grade:gen:subj:${s}:${id}`, gCC: (s, n) => `grade:gen:cc:${s}:${n}`, gBeh: (s) => `grade:gen:beh:${s}`
};
const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const roster = () => APP.roster();
const DEF = (k) => (k.indexOf('grade:cmt:cc:') === 0 ? { subjects: ['자율', '동아리', '진로'], rows: [] } : k.indexOf('grade:cmt:') === 0 ? [] : null);
async function load(keys) {
  const need = keys.filter((k) => !(k in CM.kv));
  if (!need.length) return;
  const j = await APP.kvGet(need);
  need.forEach((k) => { CM.kv[k] = j[k] != null ? j[k] : DEF(k); });
}
const status = h('span', { class: 'muted cm-status' });
function saveLater(key, ms) {
  clearTimeout(CM.timers[key]); status.textContent = '저장 중…';
  CM.timers[key] = setTimeout(async () => {
    try { await APP.kvSet(key, CM.kv[key]); status.textContent = '자동 저장됨'; }
    catch (e) { status.textContent = ''; toast(e.message === 'TOOBIG' ? '평어가 너무 많아 저장할 수 없어요. 일부를 지워 주세요.' : errMsg(e), true); }
  }, ms == null ? 600 : ms);
}
const autosize = (ta) => { ta.style.height = 'auto'; ta.style.height = Math.max(38, ta.scrollHeight + 2) + 'px'; };
const textCell = (row, key) => {
  const ta = h('textarea', { class: 'cm-text', rows: 1, value: row.text || '', placeholder: '평어 내용을 입력하세요', oninput: (e) => { row.text = e.target.value; autosize(ta); saveLater(key); } });
  setTimeout(() => autosize(ta), 0);
  return ta;
};
const delBtn = (onDel) => h('button', { class: 'sm ghost cm-x', title: '삭제', onclick: onDel }, '✕');
const subTabs = (cur, items, on) => h('div', { class: 'tabs' }, items.map(([id, n]) => h('button', { class: 'tab sm' + (cur === id ? ' active' : ''), onclick: () => on(id) }, n)));

/* =====================================================
   평어 관리
   ===================================================== */
async function manage() {
  const wrap = h('div');
  // 이 화면 안에서만 다시 그리기 (로딩 화면 깜빡임 없이)
  const render = async () => {
    const s = sem();
    await load([K.subj(s), K.cc(s), K.beh(s)]);
    const tabs = subTabs(CM.sub, [['subj', '교과 평어'], ['cc', '창체 평어'], ['beh', '행발 평어']], (id) => { CM.sub = id; render(); });
    const body = CM.sub === 'subj' ? manageSubj(render) : CM.sub === 'cc' ? manageCC(render) : manageBeh(render);
    wrap.replaceChildren(tabs, G().semToggle(render), body);
  };
  status.textContent = '';
  await render();
  return wrap;
}

function manageSubj(redraw) {
  const s = sem(), key = K.subj(s), list = CM.kv[key], subs = GR().cfg.perf[s] || [], labels = GR().cfg.labels;
  if (!subs.length) return h('div', { class: 'card placeholder' }, `${s}학기 수행평가 과목이 없어요. "수행평가 관리 → 기초작업"에서 과목과 평가기준을 먼저 만들어 주세요.`);
  const subOf = (id) => subs.find((x) => x.id === id), itemOf = (sb, id) => sb && sb.items.find((x) => x.id === id);
  const order = (r) => { const si = subs.findIndex((x) => x.id === r.subId), sb = subs[si], ii = sb ? sb.items.findIndex((x) => x.id === r.itemId) : 99; return (si < 0 ? 999 : si) * 100000 + (ii < 0 ? 999 : ii) * 10 + (r.band || 0); };
  const shown = list.filter((r) => !CM.subjF || r.subId === CM.subjF).sort((a, b) => order(a) - order(b));
  const add = () => { const sb = subOf(CM.subjF) || subs[0]; const r = { id: uid(), subId: sb.id, itemId: (sb.items[0] || {}).id || '', band: 0, text: '' }; list.push(r); saveLater(key); CM.focus = r.id; redraw(); };
  const importBase = () => {
    let c = 0;
    subs.filter((sb) => !CM.subjF || sb.id === CM.subjF).forEach((sb) => sb.items.forEach((it) => labels.forEach((_, b) => {
      if (!list.some((r) => r.subId === sb.id && r.itemId === it.id && r.band === b)) { list.push({ id: uid(), subId: sb.id, itemId: it.id, band: b, text: '' }); c++; }
    })));
    saveLater(key); toast(c ? `기초작업에서 ${c}칸을 만들었어요. 내용을 채워 주세요.` : '이미 모든 평가기준·평어 칸이 있어요.'); redraw();
  };
  const rows = shown.map((r) => {
    const sb = subOf(r.subId);
    const sSel = h('select', { onchange: (e) => { r.subId = e.target.value; const nb = subOf(r.subId); r.itemId = nb && nb.items[0] ? nb.items[0].id : ''; saveLater(key); redraw(); } },
      sb ? null : h('option', { value: r.subId, selected: true }, '(삭제된 과목)'), subs.map((x) => h('option', { value: x.id, selected: x.id === r.subId }, x.name || '(이름 없음)')));
    const iSel = h('select', { onchange: (e) => { r.itemId = e.target.value; saveLater(key); } },
      sb && !itemOf(sb, r.itemId) ? h('option', { value: r.itemId, selected: true }, '(삭제된 평가기준)') : null,
      (sb ? sb.items : []).map((x) => h('option', { value: x.id, selected: x.id === r.itemId }, x.name || '(이름 없음)')));
    const bSel = h('select', { onchange: (e) => { r.band = Number(e.target.value); saveLater(key); } }, labels.map((l, i) => h('option', { value: i, selected: i === r.band }, l)));
    const ta = textCell(r, key); if (CM.focus === r.id) { setTimeout(() => ta.focus(), 30); CM.focus = null; }
    sSel.className = 'w-subj'; iSel.className = 'w-item'; bSel.className = 'w-band';
    return h('tr', null, h('td', { class: 'cm-sel' }, sSel), h('td', { class: 'cm-sel' }, iSel), h('td', { class: 'cm-sel' }, bSel), h('td', { class: 'cm-tcell' }, ta),
      h('td', null, delBtn(async () => { if (r.text && !await uiConfirm('이 평어를 삭제할까요?')) return; CM.kv[key] = list.filter((x) => x !== r); saveLater(key, 0); redraw(); })));
  });
  return h('div', { class: 'card' },
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin-bottom:10px' },
      h('select', { onchange: (e) => { CM.subjF = e.target.value; redraw(); } }, h('option', { value: '' }, '모든 과목'), subs.map((x) => h('option', { value: x.id, selected: x.id === CM.subjF }, x.name || '(이름 없음)'))),
      h('button', { class: 'sm primary', onclick: add }, '+ 평어 추가'), ...bulkButtons('subj', redraw),
      h('button', { class: 'sm', onclick: importBase, title: '기초작업의 과목 × 평가기준 × 평어마다 빈 칸을 만들어요' }, '기초작업에서 불러오기'),
      h('div', { style: 'flex:1' }), status),
    h('div', { class: 'muted', style: 'margin-bottom:8px' }, `${s}학기 수행평가 기초작업의 과목·평가기준·평어를 골라 문장을 적어요. 같은 칸에 여러 문장을 넣을수록 평어 생성 때 학생마다 다른 문장을 고르기 쉬워요.`),
    shown.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'roster cm-table' },
      h('thead', null, h('tr', null, ['과목', '평가기준', '평어', '내용', ''].map((t) => h('th', null, t)))), h('tbody', null, rows)))
      : h('div', { class: 'placeholder' }, '아직 평어가 없어요. "+ 평어 추가"나 "기초작업에서 불러오기"를 눌러 보세요.'));
}

function manageCC(redraw) {
  const s = sem(), key = K.cc(s), d = CM.kv[key], subs = d.subjects;
  const rename = async (i) => {
    const n = await uiPrompt('과목 이름', subs[i]); if (!n || !n.trim() || n.trim() === subs[i]) return;
    if (subs.includes(n.trim())) return toast('이미 있는 과목이에요', true);
    d.rows.forEach((r) => { if (r.subj === subs[i]) r.subj = n.trim(); }); subs[i] = n.trim(); saveLater(key); redraw();
  };
  const remove = async (i) => {
    const c = d.rows.filter((r) => r.subj === subs[i]).length;
    if (!await uiConfirm(`"${subs[i]}" 과목을 삭제할까요?${c ? ` 이 과목의 평어 ${c}개도 함께 지워져요.` : ''}`)) return;
    d.rows = d.rows.filter((r) => r.subj !== subs[i]); if (CM.ccF === subs[i]) CM.ccF = ''; subs.splice(i, 1); saveLater(key); redraw();
  };
  const chips = h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, h('b', null, '과목'),
    subs.map((n, i) => h('span', { class: 'chip-s cm-subj' }, n, h('button', { class: 'x', title: '이름 바꾸기', onclick: () => rename(i) }, '✎'), h('button', { class: 'x', title: '삭제', onclick: () => remove(i) }, '✕'))),
    h('button', { class: 'sm', onclick: async () => { const n = await uiPrompt('추가할 과목 이름', ''); if (!n || !n.trim()) return; if (subs.includes(n.trim())) return toast('이미 있는 과목이에요', true); subs.push(n.trim()); saveLater(key); redraw(); } }, '+ 과목 추가'));
  if (!subs.length) return h('div', { class: 'card' }, chips, h('div', { class: 'placeholder' }, '과목을 먼저 추가해 주세요.'));
  const shown = d.rows.filter((r) => !CM.ccF || r.subj === CM.ccF).sort((a, b) => (subs.indexOf(a.subj) - subs.indexOf(b.subj)) || String(a.date || '9').localeCompare(String(b.date || '9')));
  const rows = shown.map((r) => {
    const sSel = h('select', { onchange: (e) => { r.subj = e.target.value; saveLater(key); } }, subs.map((n) => h('option', { value: n, selected: n === r.subj }, n)));
    const dIn = h('input', { type: 'date', value: r.date || '', onchange: (e) => { r.date = e.target.value; saveLater(key, 0); } });
    const ta = textCell(r, key); if (CM.focus === r.id) { setTimeout(() => ta.focus(), 30); CM.focus = null; }
    sSel.className = 'w-subj'; dIn.className = 'w-date';
    return h('tr', null, h('td', { class: 'cm-sel' }, sSel), h('td', { class: 'cm-sel' }, dIn), h('td', { class: 'cm-tcell' }, ta),
      h('td', null, delBtn(async () => { if (r.text && !await uiConfirm('이 평어를 삭제할까요?')) return; d.rows = d.rows.filter((x) => x !== r); saveLater(key, 0); redraw(); })));
  });
  return h('div', { class: 'card' }, chips,
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin:12px 0 10px' },
      h('select', { onchange: (e) => { CM.ccF = e.target.value; redraw(); } }, h('option', { value: '' }, '모든 과목'), subs.map((n) => h('option', { value: n, selected: n === CM.ccF }, n))),
      h('button', { class: 'sm primary', onclick: () => { const r = { id: uid(), subj: CM.ccF || subs[0], date: APP.today(), text: '' }; d.rows.push(r); CM.focus = r.id; saveLater(key); redraw(); } }, '+ 평어 추가'), ...bulkButtons('cc', redraw),
      h('div', { style: 'flex:1' }), status),
    shown.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'roster cm-table' },
      h('thead', null, h('tr', null, ['과목', '날짜', '내용', ''].map((t) => h('th', null, t)))), h('tbody', null, rows)))
      : h('div', { class: 'placeholder' }, '아직 평어가 없어요. "+ 평어 추가"를 눌러 보세요.'));
}

function manageBeh(redraw) {
  const s = sem(), key = K.beh(s), list = CM.kv[key];
  const f = CM.behF;
  const shown = list.filter((r) => !f || (f === 'pos' || f === 'neg' ? r.pol === f : r.kind === f));
  const rows = shown.map((r) => {
    const pSel = h('select', { class: 'cm-pol ' + r.pol, onchange: (e) => { r.pol = e.target.value; e.target.className = 'cm-pol w-pol ' + r.pol; saveLater(key); } }, [['pos', '긍정'], ['neg', '부정']].map(([v, n]) => h('option', { value: v, selected: r.pol === v }, n)));
    const kSel = h('select', { onchange: (e) => { r.kind = e.target.value; saveLater(key); } }, [['subj', '교과'], ['act', '행동']].map(([v, n]) => h('option', { value: v, selected: r.kind === v }, n)));
    const ta = textCell(r, key); if (CM.focus === r.id) { setTimeout(() => ta.focus(), 30); CM.focus = null; }
    pSel.classList.add('w-pol'); kSel.className = 'w-pol';
    return h('tr', null, h('td', { class: 'cm-sel' }, pSel), h('td', { class: 'cm-sel' }, kSel), h('td', { class: 'cm-tcell' }, ta),
      h('td', null, delBtn(async () => { if (r.text && !await uiConfirm('이 평어를 삭제할까요?')) return; CM.kv[key] = list.filter((x) => x !== r); saveLater(key, 0); redraw(); })));
  });
  const cnt = (fn) => list.filter((r) => r.text && fn(r)).length;
  return h('div', { class: 'card' },
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin-bottom:10px' },
      h('select', { onchange: (e) => { CM.behF = e.target.value; redraw(); } }, [['', '전체'], ['pos', '긍정만'], ['neg', '부정만'], ['subj', '교과만'], ['act', '행동만']].map(([v, n]) => h('option', { value: v, selected: v === f }, n))),
      h('button', { class: 'sm primary', onclick: () => { const r = { id: uid(), pol: f === 'neg' ? 'neg' : 'pos', kind: f === 'act' ? 'act' : 'subj', text: '' }; list.push(r); CM.focus = r.id; saveLater(key); redraw(); } }, '+ 평어 추가'), ...bulkButtons('beh', redraw),
      h('span', { class: 'muted' }, `교과 긍정 ${cnt((r) => r.kind === 'subj' && r.pol === 'pos')} · 행동 긍정 ${cnt((r) => r.kind === 'act' && r.pol === 'pos')} · 부정 ${cnt((r) => r.pol === 'neg')}`),
      h('div', { style: 'flex:1' }), status),
    h('div', { class: 'muted', style: 'margin-bottom:8px' }, '행동특성 및 종합의견에 쓸 문장이에요. 다른 학생의 이름은 넣지 마세요. (이름이 들어간 문장은 평어 생성에서 빠져요)'),
    shown.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'roster cm-table' },
      h('thead', null, h('tr', null, ['긍정/부정', '교과/행동', '내용', ''].map((t) => h('th', null, t)))), h('tbody', null, rows)))
      : h('div', { class: 'placeholder' }, '아직 평어가 없어요. "+ 평어 추가"를 눌러 보세요.'));
}

/* ---------- 엑셀 일괄 업로드 / 양식 ---------- */
const HEAD = { subj: ['과목', '평가기준', '평어', '내용'], cc: ['과목', '날짜', '내용'], beh: ['긍정/부정', '교과/행동', '내용'] };
const NAME = { subj: '교과 평어', cc: '창체 평어', beh: '행발 평어' };
function bulkButtons(kind, redraw) {
  const fileIn = h('input', { type: 'file', accept: '.xlsx,.csv', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const rows = await APP.xl.readTableFile(f); const r = importRows(kind, rows); saveLater(kind === 'subj' ? K.subj(sem()) : kind === 'cc' ? K.cc(sem()) : K.beh(sem()), 0);
      toast(`${r.added}개를 추가했어요` + (r.dup ? ` · 이미 있는 ${r.dup}개는 건너뜀` : '') + (r.bad.length ? ` · ${r.bad.length}줄은 읽지 못함` : ''), !r.added && r.bad.length > 0);
      if (r.bad.length) setTimeout(() => uiAlert('읽지 못한 줄:\n' + r.bad.slice(0, 15).join('\n') + (r.bad.length > 15 ? `\n…외 ${r.bad.length - 15}줄` : '')), 50);
      redraw();
    } catch (x) { toast(errMsg(x), true); }
  } });
  return [fileIn, h('button', { class: 'sm', onclick: () => fileIn.click() }, '엑셀 일괄 업로드'), h('button', { class: 'sm ghost', onclick: () => template(kind) }, '업로드 양식 받기')];
}
function template(kind) {
  const s = sem(), labels = GR().cfg.labels, rows = [HEAD[kind]], sheet = { name: NAME[kind], widths: kind === 'subj' ? [14, 22, 12, 70] : kind === 'cc' ? [14, 14, 70] : [12, 12, 70], lists: [] };
  if (kind === 'subj') {
    const subs = GR().cfg.perf[s] || [];
    subs.forEach((sb) => sb.items.forEach((it) => labels.forEach((l) => rows.push([sb.name, it.name, l, '']))));
    if (rows.length === 1) rows.push(['국어', '발표하기', labels[0], '(예) 자신의 생각을 근거를 들어 자신 있게 발표함.']);
    sheet.lists = [{ col: 0, values: subs.map((x) => x.name) }, { col: 1, values: [...new Set(subs.flatMap((x) => x.items.map((i) => i.name)))] }, { col: 2, values: labels }];
  } else if (kind === 'cc') {
    const subs = CM.kv[K.cc(s)].subjects;
    rows.push([subs[0] || '자율', APP.today(), '(예) 학급 회의에 참여하여 학급 규칙을 정하는 데 의견을 냄.']);
    sheet.lists = [{ col: 0, values: subs }];
  } else {
    rows.push(['긍정', '교과', '(예) 수업 시간에 바른 자세로 집중하여 학습함.'], ['긍정', '행동', '(예) 친구들과 사이좋게 지내며 배려하는 마음을 지님.'], ['부정', '행동', '(예) 정리 정돈하는 습관을 기를 필요가 있음.']);
    sheet.lists = [{ col: 0, values: ['긍정', '부정'] }, { col: 1, values: ['교과', '행동'] }];
  }
  sheet.rows = rows;
  APP.xl.saveBlob(APP.xl.buildXlsx([sheet]), `${s}학기 ${NAME[kind]} 업로드 양식.xlsx`);
  toast(kind === 'subj' ? '양식을 내려받았어요. 내용 칸을 채우고, 문장을 더 넣으려면 줄을 복사해 늘리세요. (예) 줄은 지우고 올려 주세요.' : '양식을 내려받았어요. (예) 줄은 지우고 올려 주세요.');
}
/* 날짜: 2026-09-03, 2026.9.3, 2026/9/3, 9/3, 9월 3일, 엑셀 날짜 숫자 */
function toDate(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
  const t = String(v || '').trim(); if (!t) return '';
  const p = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  let m = /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/.exec(t); if (m) return p(m[1], m[2], m[3]);
  m = /^(\d{1,2})\s*[-./월]\s*(\d{1,2})/.exec(t); if (m) return p(new Date().getFullYear(), m[1], m[2]);
  return null;
}
function importRows(kind, rows) {
  rows = rows.map((r) => (r || []).map((c) => (typeof c === 'string' ? c.trim() : c)));
  const hi = rows.findIndex((r) => r.some((c) => String(c).replace(/\s/g, '') === '내용'));
  if (hi < 0) throw new Error('"내용" 머리글이 있는 줄을 찾지 못했어요. 업로드 양식을 받아 그대로 채워 주세요.');
  const head = rows[hi].map((c) => String(c).replace(/\s/g, '')), col = (n) => head.findIndex((x) => x === n.replace(/\s/g, '') || x.replace('/', '') === n.replace(/[\s/]/g, ''));
  const s = sem(), out = { added: 0, dup: 0, bad: [] };
  const body = rows.slice(hi + 1).map((r, i) => ({ r, line: hi + i + 2 })).filter(({ r }) => r.some((c) => String(c).trim() !== ''));
  const ci = col('내용'), skipEx = (t) => /^\(예\)/.test(t);
  if (kind === 'subj') {
    const list = CM.kv[K.subj(s)], subs = GR().cfg.perf[s] || [], labels = GR().cfg.labels, [c0, c1, c2] = [col('과목'), col('평가기준'), col('평어')];
    body.forEach(({ r, line }) => {
      const text = String(r[ci] || '').trim(); if (!text || skipEx(text)) return;
      const sb = subs.find((x) => x.name.trim() === String(r[c0] || '').trim()); if (!sb) return out.bad.push(`${line}줄: 과목 "${r[c0] || ''}"이(가) ${s}학기 기초작업에 없어요`);
      const it = sb.items.find((x) => x.name.trim() === String(r[c1] || '').trim()); if (!it) return out.bad.push(`${line}줄: 평가기준 "${r[c1] || ''}"이(가) ${sb.name}에 없어요`);
      const b = labels.findIndex((l) => l === String(r[c2] || '').trim()); if (b < 0) return out.bad.push(`${line}줄: 평어 "${r[c2] || ''}"을(를) 알 수 없어요 (${labels.join('/')})`);
      if (list.some((x) => x.subId === sb.id && x.itemId === it.id && x.band === b && clean(x.text) === clean(text))) { out.dup++; return; }
      const empty = list.find((x) => x.subId === sb.id && x.itemId === it.id && x.band === b && !String(x.text || '').trim());
      if (empty) empty.text = text; else list.push({ id: uid(), subId: sb.id, itemId: it.id, band: b, text });
      out.added++;
    });
  } else if (kind === 'cc') {
    const d = CM.kv[K.cc(s)], [c0, c1] = [col('과목'), col('날짜')];
    body.forEach(({ r, line }) => {
      const text = String(r[ci] || '').trim(); if (!text || skipEx(text)) return;
      const subj = String(r[c0] || '').trim(); if (!subj) return out.bad.push(`${line}줄: 과목이 비어 있어요`);
      const date = toDate(r[c1]); if (date === null) return out.bad.push(`${line}줄: 날짜 "${r[c1]}"을(를) 읽지 못했어요 (예: 2026-09-03)`);
      if (!d.subjects.includes(subj)) d.subjects.push(subj);
      if (d.rows.some((x) => x.subj === subj && x.date === date && clean(x.text) === clean(text))) { out.dup++; return; }
      d.rows.push({ id: uid(), subj, date, text }); out.added++;
    });
  } else {
    const list = CM.kv[K.beh(s)], [c0, c1] = [col('긍정/부정'), col('교과/행동')];
    body.forEach(({ r, line }) => {
      const text = String(r[ci] || '').trim(); if (!text || skipEx(text)) return;
      const pv = String(r[c0] || '').trim(), kv = String(r[c1] || '').trim();
      const pol = /^(긍정|\+|o|좋음)$/i.test(pv) ? 'pos' : /^(부정|-|x|나쁨)$/i.test(pv) ? 'neg' : null;
      const kd = /^교과/.test(kv) ? 'subj' : /^(행동|생활)/.test(kv) ? 'act' : null;
      if (!pol) return out.bad.push(`${line}줄: 긍정/부정 "${pv}"을(를) 알 수 없어요`);
      if (!kd) return out.bad.push(`${line}줄: 교과/행동 "${kv}"을(를) 알 수 없어요`);
      if (list.some((x) => x.pol === pol && x.kind === kd && clean(x.text) === clean(text))) { out.dup++; return; }
      list.push({ id: uid(), pol, kind: kd, text }); out.added++;
    });
  }
  return out;
}

/* =====================================================
   문장 다듬기 (규칙 기반)
   ===================================================== */
const clean = (t) => { t = String(t || '').replace(/\s+/g, ' ').trim(); if (!t) return ''; if (!/[.!?。]$/.test(t)) t += '.'; return t; };
const POS_V = [
  (t) => t,
  (t) => (/(필요|요|노력)함\.$/.test(t) ? null : t.replace(/([가-힣])함\.$/, '$1하는 모습을 보임.')),
  (t) => (/(필요|요|노력)함\.$/.test(t) ? null : t.replace(/([가-힣])함\.$/, '$1하는 태도가 돋보임.')),
  (t) => (/(필요|요|노력)함\.$/.test(t) ? null : t.replace(/([가-힣])함\.$/, '$1하는 모습이 인상적임.'))
];
const NEG_V = [
  (t) => t,
  (t) => t.replace(/노력이 필요함\.$/, '노력을 기울인다면 더욱 성장할 것으로 기대됨.'),
  (t) => t.replace(/필요함\.$/, '필요해 보임.'),
  (t) => t.replace(/필요가 있음\.$/, '필요함.')
];
function vary(text, k, neg) {
  const base = clean(text), V = neg ? NEG_V : POS_V;
  if (!k) return base;
  for (let i = 0; i < V.length; i++) { const v = V[(k + i) % V.length](base); if (v && v !== base) return v; }
  return base;
}
const CONNECT = ['또한 ', '특히 ', '아울러 '];
const joinParts = (parts) => parts.map((p) => p.text).join(' ');
const charLen = (s) => [...s].length;
/* 다른 학생 이름이 들어간 문장 거르기 */
function nameCheck(me) {
  const ns = [];
  roster().forEach((s) => { if (s.num === me) return; if (s.name.length >= 2) ns.push(s.name); if (s.name.length >= 3) ns.push(s.name.slice(1)); });
  return (t) => !ns.some((n) => t.includes(n));
}
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
/* 가장 적게 쓴 후보 고르기 (같으면 무작위) */
function pickMin(cands, used, skip) {
  const c = cands.filter((x) => !skip.has(x.id));
  if (!c.length) return null;
  const m = Math.min(...c.map((x) => used.get(x.id) || 0));
  const best = shuffle(c.filter((x) => (used.get(x.id) || 0) === m))[0];
  const k = used.get(best.id) || 0; used.set(best.id, k + 1);
  return { cand: best, reuse: k };
}

/* ---------- 행발용 자동 문장 (누가기록 · 교우관계에서) ---------- */
const AUTO = [
  { key: 'help', kind: 'act', pol: 1, re: /도와|도왔|도움|돌봐|가르쳐|알려 ?주|챙겨/, t: ['어려움을 겪는 친구를 먼저 도와주는 따뜻한 마음을 지님.', '주변 친구들을 세심하게 챙기며 도움을 주는 배려심이 돋보임.', '친구가 곤란해할 때 먼저 다가가 도움을 주는 모습을 자주 보임.'] },
  { key: 'share', kind: 'act', pol: 1, re: /양보|나눠|나누어|빌려 ?주/, t: ['친구에게 기꺼이 양보하고 나누는 너그러운 마음을 지님.', '자신의 것을 친구와 나누며 배려하는 태도가 몸에 배어 있음.'] },
  { key: 'sorry', kind: 'act', pol: 1, re: /사과|화해/, t: ['갈등이 생겼을 때 먼저 사과하고 화해하려는 성숙한 태도를 보임.', '다툼이 있은 뒤에도 진심으로 사과하며 관계를 회복하려고 노력함.'] },
  { key: 'duty', kind: 'act', pol: 1, re: /청소|정리|당번|맡은|1인 ?1역/, t: ['맡은 역할을 끝까지 책임감 있게 해내는 성실함을 보임.', '학급의 궂은일도 묵묵히 해내며 공동체에 기여함.'] },
  { key: 'cheer', kind: 'act', pol: 1, re: /칭찬|격려|응원|축하/, t: ['친구를 칭찬하고 격려하는 긍정적인 언어 습관을 지님.', '친구의 성공을 진심으로 축하하고 응원하는 따뜻한 마음을 지님.'] },
  { key: 'speak', kind: 'subj', pol: 1, re: /발표|질문|토의|토론/, t: ['수업 시간에 적극적으로 발표하며 자신의 생각을 자신 있게 표현함.', '토의 활동에서 자신의 의견을 조리 있게 말하고 친구의 의견도 경청함.'] },
  { key: 'fight', kind: 'act', pol: -1, re: /다투|다퉜|다툼|싸우|싸웠|싸움|갈등|말다툼|시비/, t: ['친구와 갈등이 생겼을 때 감정을 조절하고 대화로 해결하려는 노력이 필요함.', '의견이 다를 때 상대의 입장을 먼저 생각해 보는 연습이 필요함.'] },
  { key: 'words', kind: 'act', pol: -1, re: /욕|놀리|놀렸|놀려|비웃|험담|뒷담/, t: ['친구를 존중하는 바른 언어 습관을 기르려는 노력이 필요함.', '말 한마디가 친구에게 주는 영향을 생각하며 고운 말을 쓰려는 노력이 필요함.'] },
  { key: 'hands', kind: 'act', pol: -1, re: /때리|때렸|때려|밀치|밀쳤|밀쳐|발로 차|꼬집|던졌/, t: ['장난이 지나치지 않도록 친구와의 신체 접촉에 조심하는 태도를 기를 필요가 있음.'] },
  { key: 'focus', kind: 'subj', pol: -1, re: /방해|떠들|딴짓|집중하지/, t: ['수업 시간에 바른 자세로 집중하려는 노력이 필요함.'] }
];
const REL = {
  wide: ['교우들과 두루 원만한 관계를 맺으며 친구들에게 신뢰를 받음.', '밝고 친근한 성격으로 여러 친구와 고루 어울리며 학급 분위기를 즐겁게 만듦.'],
  deep: ['마음이 맞는 친구와 깊이 있는 우정을 쌓아 가며 서로 의지하는 관계를 맺음.', '가까운 친구와 꾸준히 신뢰를 쌓아 가는 진실한 교우 관계를 보임.'],
  low: ['다양한 친구들과 어울리며 교우 관계의 폭을 넓혀 가려는 노력이 필요함.', '친구들에게 먼저 다가가 마음을 나누는 경험을 늘려 간다면 더욱 성장할 것으로 기대됨.']
};
/* 기록 속 문장에서 이 학생이 주인공(…이/가/는)인지 — "서연이를 도와줌"처럼 도움을 받은 쪽은 빼기 */
function actorRe(num) {
  const s = roster().find((x) => x.num === num); if (!s) return null;
  const ns = [s.name]; if (s.name.length >= 3) ns.push(s.name.slice(1));
  return { main: new RegExp(`(${ns.join('|')})(이가|이는|이도|이랑|가|는|은|이|도)(\\s|$|,)`), mutual: new RegExp(`(${ns.join('|')})(이와|이랑|와|과|랑|하고)`) };
}
function autoCands(info, num) {
  const out = [];
  if (!info) return out;
  const add = (key, kind, pol, list) => list.forEach((t, i) => out.push({ id: `auto:${key}:${i}`, kind, pol, text: t, auto: true }));
  const A = actorRe(num);
  const sents = info.logs.flatMap((l) => String(l.text).split(/(?<=[.!?。\n])|(?<=[가-힣][함음됨임다])\s+/).map((t) => ({ t, tone: l.tone })));
  const hit = (a) => sents.some((x) => (a.pol > 0 ? x.tone > 0 : x.tone < 0) && a.re.test(x.t) && (!A || A.main.test(x.t) || (a.key === 'fight' && A.mutual.test(x.t))));
  AUTO.forEach((a) => { if (hit(a)) add(a.key, a.kind, a.pol, a.t); });
  const half = info.raters >= 3;
  if (half && (info.good >= Math.max(4, info.raters * 0.3) || info.close >= 3)) add('rel-wide', 'act', 1, REL.wide);
  else if (half && info.mutual >= 1) add('rel-deep', 'act', 1, REL.deep);
  if (half && (info.mutual === 0 || (info.received != null && info.received < 0))) add('rel-low', 'act', -1, REL.low);
  if ((info.conflict >= 2 || (info.neg >= 2 && info.neg > info.pos)) && !out.some((x) => x.id.startsWith('auto:fight'))) add('fight', 'act', -1, AUTO.find((a) => a.key === 'fight').t);
  return out;
}

/* =====================================================
   평어 생성
   ===================================================== */
async function generate() {
  const wrap = h('div');
  const render = async () => {
    const s = sem();
    await load([K.subj(s), K.cc(s), K.beh(s)]);
    const tabs = subTabs(CM.gsub, [['subj', '교과목'], ['cc', '창체'], ['beh', '행동발달']], (id) => { CM.gsub = id; CM.ccDate = ''; render(); });
    let body;
    try {
      if (CM.gsub === 'subj') body = await genSubjView(render);
      else if (CM.gsub === 'cc') body = await genCCView(render);
      else body = await genBehView(render);
    } catch (e) { body = h('div', { class: 'banner warn' }, errMsg(e)); }
    wrap.replaceChildren(tabs, G().semToggle(render), body);
  };
  await render();
  return wrap;
}

/* ---------- 교과목 ---------- */
async function subjContext(sb) {
  const s = sem(), pk = G().perfKey(s, sb.id); await G().loadKeys([pk]);
  const d = GR().data[pk] || { scores: {} }, labels = GR().cfg.labels;
  const pool = CM.kv[K.subj(s)].filter((r) => r.subId === sb.id && clean(r.text));
  const scoreOf = (n, it) => G().num(d.scores && d.scores[n] && d.scores[n][it.id]);
  const avgOf = (n) => { const v = sb.items.filter((it) => it.max > 0 && scoreOf(n, it) != null).map((it) => (scoreOf(n, it) / it.max) * 100); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const bandOf = (n, it) => {
    const sc = scoreOf(n, it); if (sc != null) return G().bandIdx(it.cuts, sc);
    const a = avgOf(n); if (a == null || !it.max) return -1;
    return G().bandIdx(it.cuts.map((c) => (c / it.max) * 100), a);
  };
  return { pool, avgOf, bandOf, scoreOf, labels };
}
function subjOne(num, n, ctx, sb, used) {
  const ok = nameCheck(num), parts = [], skip = new Set(), why = []; let reused = 0;
  const L = ctx.labels;
  // 평가기준마다 이 학생 성적에 맞는 평어 후보
  const items = sb.items.map((it, idx) => {
    const b = ctx.bandOf(num, it), all = b < 0 ? [] : ctx.pool.filter((r) => r.itemId === it.id && r.band === b);
    const list = all.filter((r) => ok(r.text)).map((r) => ({ id: r.id, text: r.text, idx }));
    let reason = '';
    if (b < 0) reason = `'${it.name}' 성적 없음`;
    else if (!all.length) reason = `'${it.name}'의 '${L[b]}' 평어가 입력되지 않음`;
    else if (!list.length) reason = `'${it.name}'의 '${L[b]}' 평어에 다른 학생 이름이 들어 있어 쓸 수 없음`;
    return { it, idx, list, reason };
  });
  const hasScore = sb.items.some((it) => ctx.scoreOf(num, it) != null);
  // 과목의 모든 평가기준을 섞어서, 한 바퀴 안에서는 같은 평가기준을 다시 쓰지 않고, 학급 전체에서 덜 쓴 문장부터
  let round = new Set();
  while (parts.length < n) {
    let avail = items.filter((x) => !round.has(x.idx) && x.list.some((c) => !skip.has(c.id)));
    if (!avail.length) { round = new Set(); avail = items.filter((x) => x.list.some((c) => !skip.has(c.id))); if (!avail.length) break; }
    const p = pickMin(avail.flatMap((x) => x.list), used, skip); if (!p) break;
    skip.add(p.cand.id); round.add(p.cand.idx); if (p.reuse) reused++;
    parts.push({ id: p.cand.id, idx: p.cand.idx, text: vary(p.cand.text, p.reuse + (parts.length && Math.random() < 0.35 ? 1 : 0)) });
  }
  parts.sort((a, b) => a.idx - b.idx);   // 평가기준 순서대로 놓기
  parts.forEach((p) => { delete p.idx; });
  if (parts.length < n) {
    if (!hasScore && ctx.avgOf(num) == null) why.push(`${sb.name} 성적이 입력되지 않음`);
    else {
      items.filter((x) => x.reason).forEach((x) => why.push(x.reason));
      const total = items.reduce((a, x) => a + x.list.length, 0);
      if (total && total < n) why.push(`쓸 수 있는 평어가 ${total}개뿐이라 ${n}문장을 채우지 못함`);
    }
  }
  // 이어 주는 말은 한 문단에 한 번만
  if (parts.length > 1 && Math.random() < 0.4) { const i = 1 + Math.floor(Math.random() * (parts.length - 1)); if (!/^(또한|특히|아울러|다만)/.test(parts[i].text)) parts[i].text = CONNECT[Math.floor(Math.random() * CONNECT.length)] + parts[i].text; }
  return { parts, reused, short: parts.length < n, why };
}
async function genSubjView(redraw) {
  const s = sem(), subs = (GR().cfg.perf[s] || []).filter((x) => x.items.length);
  if (!subs.length) return h('div', { class: 'card placeholder' }, `${s}학기 수행평가 과목이 없어요.`);
  const sb = subs.find((x) => x.id === CM.genSubj) || subs[0]; CM.genSubj = sb.id;
  const key = K.gSubj(s, sb.id); await load([key]);
  const ctx = await subjContext(sb);
  const subjSel = h('select', { onchange: (e) => { CM.genSubj = e.target.value; redraw(); } }, subs.map((x) => h('option', { value: x.id, selected: x.id === sb.id }, x.name || '(이름 없음)')));
  return genTable({
    key, redraw, kind: 'subj', head: [subjSel], extraCol: ['평균 성적', (num) => { const a = ctx.avgOf(num); return a == null ? '-' : `${G().fmt(a)}점`; }],
    empty: ctx.pool.length ? '' : `"${sb.name}" 과목의 교과 평어가 없어요. "평어 관리 → 교과 평어"에서 먼저 입력해 주세요.`,
    one: (num, n, used) => subjOne(num, n, ctx, sb, used),
    cands: (num) => { const ok = nameCheck(num); return ctx.pool.filter((r) => ok(r.text)).map((r) => { const it = sb.items.find((x) => x.id === r.itemId); return { id: r.id, text: r.text, label: `${it ? it.name : '?'}·${ctx.labels[r.band]}` }; }); },
    exportHead: ['번호', '이름', '평균 성적', '평어', '글자 수'], exportRow: (st, row) => [st.num, st.name, ctx.avgOf(st.num) == null ? '' : G().fmt(ctx.avgOf(st.num)), joinParts(row.parts), charLen(joinParts(row.parts))],
    title: `${s}학기 교과 평어_${sb.name}`
  });
}

/* ---------- 창체 ---------- */
function ccOne(num, n, pool, used) {
  const ok = nameCheck(num), cands = pool.filter((r) => ok(r.text)), parts = [], skip = new Set(), dates = new Set(); let reused = 0;
  for (let i = 0; i < n; i++) {
    // 날짜가 겹치지 않는 것을 먼저
    let p = pickMin(cands.filter((c) => !dates.has(c.date)), used, skip) || pickMin(cands, used, skip);
    if (!p) break;
    skip.add(p.cand.id); dates.add(p.cand.date); if (p.reuse) reused++;
    parts.push({ id: p.cand.id, date: p.cand.date || '', text: vary(p.cand.text, p.reuse) });
  }
  parts.sort((a, b) => String(a.date || '9').localeCompare(String(b.date || '9')));
  const why = [];
  if (parts.length < n) {
    if (!pool.length) why.push('이 과목에 입력된 창체 평어가 없음');
    else if (!cands.length) why.push('평어에 다른 학생 이름이 들어 있어 쓸 수 없음');
    else why.push(`쓸 수 있는 평어가 ${cands.length}개뿐이라 ${n}문장을 채우지 못함`);
  }
  return { parts, reused, short: parts.length < n, why };
}
async function genCCView(redraw) {
  const s = sem(), d = CM.kv[K.cc(s)], subs = d.subjects;
  if (!subs.length) return h('div', { class: 'card placeholder' }, '창체 과목이 없어요. "평어 관리 → 창체 평어"에서 과목을 추가해 주세요.');
  const subj = subs.includes(CM.genCC) ? CM.genCC : subs[0]; CM.genCC = subj;
  const key = K.gCC(s, subj); await load([key]);
  const pool = d.rows.filter((r) => r.subj === subj && clean(r.text)).map((r) => ({ id: r.id, date: r.date || '', text: r.text }));
  const subjSel = h('select', { onchange: (e) => { CM.genCC = e.target.value; CM.ccDate = ''; redraw(); } }, subs.map((n) => h('option', { value: n, selected: n === subj }, n)));
  const g = CM.kv[key];
  const dates = [...new Set([...(g ? Object.values(g.rows).flatMap((r) => r.parts.map((p) => p.date)) : []), ...pool.map((p) => p.date)].filter(Boolean))].sort();
  if (CM.ccDate && !dates.includes(CM.ccDate)) CM.ccDate = '';
  const dateSel = h('select', { title: '날짜로 모아 보기', onchange: (e) => { CM.ccDate = e.target.value; redraw(); } }, h('option', { value: '' }, '모든 날짜'), dates.map((x) => h('option', { value: x, selected: x === CM.ccDate }, x)));
  const md = (x) => (x ? `${Number(x.slice(5, 7))}/${Number(x.slice(8, 10))}` : '-');
  return genTable({
    key, redraw, kind: 'cc', head: [subjSel, h('span', { class: 'muted' }, '날짜'), dateSel],
    extraCol: ['날짜', (num, row) => (row && row.parts.length ? row.parts.map((p) => h('span', { class: 'cm-date' + (CM.ccDate && p.date === CM.ccDate ? ' hit' : '') }, md(p.date))) : '-')],
    filter: (row) => !CM.ccDate || (row && row.parts.some((p) => p.date === CM.ccDate)), bold: (p) => CM.ccDate && p.date === CM.ccDate,
    empty: pool.length ? '' : `"${subj}" 과목의 창체 평어가 없어요. "평어 관리 → 창체 평어"에서 먼저 입력해 주세요.`,
    one: (num, n, used) => ccOne(num, n, pool, used),
    cands: (num) => { const ok = nameCheck(num); return pool.filter((r) => ok(r.text)).map((r) => ({ ...r, label: md(r.date) })); },
    exportHead: ['번호', '이름', '날짜', '평어', '글자 수'], exportRow: (st, row) => [st.num, st.name, row.parts.map((p) => p.date).join(', '), joinParts(row.parts), charLen(joinParts(row.parts))],
    title: `${s}학기 창체 평어_${subj}`
  });
}

/* ---------- 행동발달 ---------- */
let INS = null, insAt = 0;
async function insights() { if (!INS || Date.now() - insAt > 60000) { try { INS = await APP.studentInsights(); } catch (e) { INS = {}; } insAt = Date.now(); } return INS; }
function behPlan(n) {
  if (n <= 1) return ['act'];
  if (n === 2) return ['subj', 'act'];
  const subj = n === 3 ? 1 : 1 + Math.floor(Math.random() * Math.max(1, Math.floor(n / 2)));
  return [...Array(subj).fill('subj'), ...Array(n - subj).fill('act')];
}
function behOne(num, n, pool, ins, used) {
  const ok = nameCheck(num), auto = autoCands(ins[num], num).filter((c) => ok(c.text));
  const P = pool.filter((r) => ok(r.text)).map((r) => ({ id: r.id, kind: r.kind, pol: r.pol === 'neg' ? -1 : 1, text: r.text }));
  const all = [...auto, ...P], plan = behPlan(n), parts = [], skip = new Set(); let reused = 0;
  // 부정 문장: 이 학생의 기록·관계에 근거가 있을 때만, 한 개만
  const negAuto = auto.filter((c) => c.pol < 0);
  let negSlot = -1;
  if (negAuto.length && n >= 2) { const kinds = new Set(negAuto.map((c) => c.kind)); negSlot = plan.lastIndexOf(kinds.has('act') ? 'act' : 'subj'); if (negSlot < 0) negSlot = plan.length - 1; }
  let autoPosUsed = 0;
  plan.forEach((kind, i) => {
    let p = null;
    if (i === negSlot) p = pickMin(negAuto.filter((c) => c.kind === kind), used, skip) || pickMin(negAuto, used, skip) || pickMin(P.filter((c) => c.pol < 0), used, skip);
    if (!p && autoPosUsed < 2) { p = pickMin(auto.filter((c) => c.pol > 0 && c.kind === kind), used, skip); if (p) autoPosUsed++; }
    if (!p) p = pickMin(P.filter((c) => c.pol > 0 && c.kind === kind), used, skip) || pickMin(all.filter((c) => c.pol > 0), used, skip);
    if (!p) return;
    skip.add(p.cand.id); if (p.reuse) reused++;
    parts.push({ id: p.cand.id, kind: p.cand.kind, pol: p.cand.pol, text: vary(p.cand.text, p.reuse, p.cand.pol < 0) });
  });
  // 순서: 교과 → 행동 → 부정(맨 끝, "다만")
  parts.sort((a, b) => (a.pol < 0) - (b.pol < 0) || (a.kind === 'subj' ? 0 : 1) - (b.kind === 'subj' ? 0 : 1));
  parts.forEach((p) => { if (p.pol < 0 && !/^(다만|하지만|그러나)/.test(p.text)) p.text = '다만, ' + p.text; });
  const why = [];
  if (parts.length < n || !parts.some((p) => p.kind === 'subj') || !parts.some((p) => p.kind === 'act')) {
    const posS = all.filter((c) => c.pol > 0 && c.kind === 'subj').length, posA = all.filter((c) => c.pol > 0 && c.kind === 'act').length;
    if (!pool.length && !auto.length) why.push('입력된 행발 평어가 없고 누가기록·교우관계 자료도 없음');
    else {
      if (!posS) why.push('교과 긍정 평어가 입력되지 않음');
      if (!posA) why.push('행동 긍정 평어가 입력되지 않음 (누가기록·교우관계에서도 찾지 못함)');
      if (parts.length < n && posS && posA) why.push(`쓸 수 있는 평어가 ${posS + posA + (negSlot >= 0 ? 1 : 0)}개뿐이라 ${n}문장을 채우지 못함`);
      if (pool.some((r) => !ok(r.text))) why.push('일부 평어에 다른 학생 이름이 들어 있어 뺌');
    }
  }
  return { parts, reused, short: parts.length < n, why };
}
async function genBehView(redraw) {
  const s = sem(), key = K.gBeh(s); await load([key]);
  const pool = CM.kv[K.beh(s)].filter((r) => clean(r.text));
  const ins = await insights();
  return genTable({
    key, redraw, kind: 'beh', head: [h('span', { class: 'muted' }, '교과 1문장 이상 · 행동 1문장 이상 · 부정 문장은 근거가 있을 때만 1개')],
    empty: pool.length || Object.keys(ins).length ? '' : '행발 평어가 없어요. "평어 관리 → 행발 평어"에서 먼저 입력해 주세요.',
    minN: 2,
    one: (num, n, used) => behOne(num, n, pool, ins, used),
    cands: (num) => { const ok = nameCheck(num); return [...autoCands(ins[num], num).map((c) => ({ ...c, label: (c.pol < 0 ? '부정·' : '') + (c.kind === 'subj' ? '교과' : '행동') + '·기록에서' })), ...pool.map((r) => ({ id: r.id, kind: r.kind, pol: r.pol === 'neg' ? -1 : 1, text: r.text, label: (r.pol === 'neg' ? '부정·' : '') + (r.kind === 'subj' ? '교과' : '행동') }))].filter((c) => ok(c.text)); },
    exportHead: ['번호', '이름', '행동특성 및 종합의견', '글자 수'], exportRow: (st, row) => [st.num, st.name, joinParts(row.parts), charLen(joinParts(row.parts))],
    title: `${s}학기 행동특성 및 종합의견`
  });
}

/* ---------- 공통 표 ---------- */
function genTable(o) {
  const key = o.key, R = roster(), nKind = o.kind;
  let g = CM.kv[key];
  const usedFrom = (except) => { const u = new Map(); if (g) Object.entries(g.rows).forEach(([num, r]) => { if (Number(num) === except) return; r.parts.forEach((p) => u.set(p.id, (u.get(p.id) || 0) + 1)); }); return u; };
  const runAll = (n) => {
    const used = new Map(), rows = {}; let reused = 0, short = 0;
    shuffle(R).forEach((st) => { const r = o.one(st.num, n, used); rows[st.num] = { parts: r.parts, why: r.why || [] }; reused += r.reused; if (r.short) short++; });
    g = CM.kv[key] = { n, rows, savedAt: 0 }; CM.dirty[key] = true;
    CM.lastNote = [reused ? `평어가 부족해 ${reused}개 문장은 다른 학생과 같은 문장을 끝맺음만 바꿔 다시 썼어요.` : '', short ? `${short}명은 정한 문장 수만큼 채우지 못했어요. (이유는 그 학생 평어 아래 빨간 글씨로 보여요)` : ''].filter(Boolean).join(' ');
  };
  if (!g && !o.empty) { runAll(CM.n[nKind]); }
  const n = g ? g.n : CM.n[nKind];
  const nSel = h('select', { onchange: async (e) => {
    const v = Number(e.target.value);
    if (g && !await uiConfirm(`문장 수를 ${v}개로 바꾸면 모든 학생의 평어를 새로 조합해요. 계속할까요?`)) { e.target.value = n; return; }
    CM.n[nKind] = v; runAll(v); o.redraw();
  } }, Array.from({ length: 6 }, (_, i) => i + 1).filter((v) => v >= (o.minN || 1)).map((v) => h('option', { value: v, selected: v === n }, `${v}문장`)));
  const saveBtn = h('button', { class: 'primary', disabled: !g, onclick: async () => {
    try { g.savedAt = Date.now(); await APP.kvSet(key, g); CM.dirty[key] = false; toast('저장했어요'); o.redraw(); }
    catch (e) { toast(e.message === 'TOOBIG' ? '내용이 너무 길어 저장할 수 없어요.' : errMsg(e), true); }
  } }, '저장');
  const expBtn = h('button', { disabled: !g, onclick: async () => {
    const rows = [o.exportHead, ...R.map((st) => o.exportRow(st, g.rows[st.num] || { parts: [] }))];
    const title = `${o.title} ${APP.today()}`;
    try {
      if (APP.DEMO) { APP.xl.saveBlob(APP.xl.buildXlsx([{ name: '평어', rows }]), title + '.xlsx'); toast('데모 모드라서 엑셀 파일로 내려받았어요'); return; }
      expBtn.disabled = true; const j = await api('exportSheet', { title, sheets: [{ name: '평어', rows }] });
      toast('구글 드라이브에 저장했어요'); window.open(j.url, '_blank', 'noopener');
    } catch (e) { toast(errMsg(e), true); } finally { expBtn.disabled = false; }
  } }, '구글 스프레드시트로 내보내기');
  const state = g ? (CM.dirty[key] ? h('span', { class: 'cm-unsaved' }, '저장하지 않은 변경이 있어요') : h('span', { class: 'muted' }, g.savedAt ? '저장됨' : '')) : null;
  const top = h('div', { class: 'card' },
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;align-items:center' }, ...o.head, h('span', { class: 'muted' }, '조합할 문장 수'), nSel,
      h('button', { class: 'sm', disabled: !!o.empty, onclick: async () => { if (g && !await uiConfirm('모든 학생의 평어를 새로 조합할까요? (직접 고친 내용도 바뀌어요)')) return; runAll(n); o.redraw(); } }, '전체 다시 조합'),
      h('div', { style: 'flex:1' }), state, saveBtn, expBtn),
    CM.lastNote ? h('div', { class: 'banner warn', style: 'margin:10px 0 0' }, CM.lastNote) : null);
  CM.lastNote = '';
  if (o.empty && !g) return h('div', null, top, h('div', { class: 'card placeholder' }, o.empty));

  const rows = R.filter((st) => !o.filter || o.filter(g.rows[st.num])).map((st) => {
    const row = g.rows[st.num] || (g.rows[st.num] = { parts: [] }), text = joinParts(row.parts);
    const reroll = () => { const r = o.one(st.num, g.n, usedFrom(st.num)); row.parts = r.parts; row.why = r.why || []; CM.dirty[key] = true; o.redraw(); };
    return h('tr', { class: APP.gcls(st.gender) },
      h('td', { class: 'cm-act' }, h('button', { class: 'sm ghost', title: '다시 조합', onclick: reroll }, '↻'), h('button', { class: 'sm ghost', title: '직접 고치기', onclick: () => editParts(st, row, o, key) }, '✎')),
      h('td', { class: 'cm-name' }, `${st.num} ${st.name}`),
      o.extraCol ? h('td', { class: 'cm-extra' }, o.extraCol[1](st.num, row)) : null,
      h('td', { class: 'cm-gen' }, row.parts.length ? row.parts.map((p, i) => [i ? ' ' : '', h(o.bold && o.bold(p) ? 'b' : 'span', { class: p.pol < 0 ? 'cm-neg' : '' }, p.text)]) : h('span', { class: 'muted' }, '(조합된 평어 없음)'),
        (row.why || []).length ? h('div', { class: 'cm-why' }, (row.parts.length ? `${g.n}문장 중 ${row.parts.length}문장만 조합 — ` : '조합하지 못한 이유: ') + row.why.join(' · ')) : null),
      h('td', { class: 'cm-len' }, charLen(text) ? charLen(text) + '자' : ''));
  });
  return h('div', null, top, h('div', { class: 'card' },
    h('div', { class: 'table-wrap' }, h('table', { class: 'roster cm-gentable' },
      h('thead', null, h('tr', null, h('th', null, ''), h('th', null, '학생'), o.extraCol ? h('th', null, o.extraCol[0]) : null, h('th', null, '평어'), h('th', null, '글자'))),
      h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: 5, class: 'muted', style: 'padding:20px' }, '이 날짜의 평어가 들어간 학생이 없어요.'))))),
    h('div', { class: 'muted', style: 'margin-top:8px' }, '↻ 그 학생만 다시 조합 · ✎ 문장을 직접 삭제·수정·교체 · 고친 뒤에는 오른쪽 위 "저장"을 눌러 주세요.')));
}

/* ✎ 문장 직접 고치기 */
function editParts(st, row, o, key) {
  const parts = row.parts.map((p) => ({ ...p }));
  const cands = o.cands(st.num);
  const list = h('div', { class: 'cm-edit-list' });
  const draw = () => {
    list.replaceChildren(...parts.map((p, i) => {
      const ta = h('textarea', { class: 'cm-text', value: p.text, oninput: (e) => { p.text = e.target.value; autosize(ta); } });
      setTimeout(() => autosize(ta), 0);
      const rep = h('select', { onchange: (e) => { const c = cands.find((x) => x.id === e.target.value); if (!c) return; Object.assign(p, { id: c.id, text: clean(c.text), date: c.date, kind: c.kind, pol: c.pol }); if (p.pol < 0) p.text = '다만, ' + p.text; draw(); } },
        h('option', { value: '' }, '다른 문장으로 교체…'), cands.map((c) => h('option', { value: c.id }, `[${c.label || ''}] ${clean(c.text).slice(0, 40)}`)));
      return h('div', { class: 'cm-edit-row' }, h('div', { class: 'row', style: 'gap:6px' }, h('b', null, `${i + 1}`), o.kind === 'cc' ? h('input', { type: 'date', value: p.date || '', onchange: (e) => { p.date = e.target.value; } }) : null, rep,
        h('div', { style: 'flex:1' }), h('button', { class: 'sm ghost', disabled: i === 0, onclick: () => { [parts[i - 1], parts[i]] = [parts[i], parts[i - 1]]; draw(); } }, '↑'),
        h('button', { class: 'sm ghost', title: '삭제', onclick: () => { parts.splice(i, 1); draw(); } }, '✕')), ta);
    }), h('button', { class: 'sm', onclick: () => { parts.push({ id: 'custom:' + uid(), text: '', date: o.kind === 'cc' ? APP.today() : undefined, kind: 'act', pol: 1 }); draw(); } }, '+ 문장 추가'));
  };
  draw();
  const close = () => ov.remove();
  const ov = h('div', { class: 'overlay' }, h('div', { class: 'modal cm-modal' }, h('h3', null, `${st.num}번 ${st.name} 평어 고치기`), list,
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:12px' }, h('button', { onclick: close }, '취소'),
      h('button', { class: 'primary', onclick: () => {
        row.parts = parts.filter((p) => clean(p.text)).map((p) => ({ ...p, text: clean(p.text) })); row.why = [];
        if (o.kind === 'cc') row.parts.sort((a, b) => String(a.date || '9').localeCompare(String(b.date || '9')));
        CM.dirty[key] = true; close(); o.redraw();
      } }, '적용'))));
  document.body.append(ov);
}

APP.comment = { manage, generate };
})();
