/* 성적 관리: 수행평가 관리 / 기타 평가 관리 / 성적 추이 / 성적 조회 */
(() => {
'use strict';
const APP = window.APP;
const { S, h, api, toast, errMsg, clone, kvGet } = APP;

const GR = { cfg: null, data: {}, tab: 'perf', ptab: 'base', sem: '1', subId: null, evalId: null, dirty: false,
  creating: false, editing: false, tmode: 'student', tStu: null, tAsm: null, vStu: null, vAsm: 'all', vDetail: true };
APP.onLock.push(() => { GR.cfg = null; GR.data = {}; GR.dirty = false; });

const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const defCfg = () => ({ labels: ['매우잘함', '잘함', '보통', '노력요함'], perf: { '1': [], '2': [] }, evals: [] });
const autoCuts = (max) => [0.9, 0.7, 0.5].map((r) => Math.round(max * r * 10) / 10);
const LV_CLASS = ['lv0', 'lv1', 'lv2', 'lv3'];
const perfKey = (sem, sid) => `grade:perf:${sem}:${sid}`;
const evalKey = (id) => `grade:eval:${id}`;
const stuName = (n) => (S.roster.find((x) => Number(x.num) === Number(n)) || {}).name || n + '번';
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const fmt = (n) => (n == null ? '-' : Math.round(n * 10) / 10);
const bandIdx = (cuts, sc) => (sc == null ? -1 : sc >= cuts[0] ? 0 : sc >= cuts[1] ? 1 : sc >= cuts[2] ? 2 : 3);
const norm = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/[①-⑩]/g, (c) => String('①②③④⑤⑥⑦⑧⑨⑩'.indexOf(c) + 1));
const evMax = (ev) => (ev.type === 'answers' ? ev.items.reduce((s, i) => s + (Number(i.pts) || 0), 0) : Number(ev.max) || 0);

function evalTotal(ev, d, n) {
  if (ev.type === 'score') return num(d.scores && d.scores[n]);
  const resp = d.answers && d.answers[n];
  if (!resp || !resp.some((r) => String(r || '').trim() !== '')) return null;
  return ev.items.reduce((s, it, i) => s + (norm(resp[i]) !== '' && norm(resp[i]) === norm(it.ans) ? Number(it.pts) || 0 : 0), 0);
}

async function ensure() {
  if (GR.cfg) return;
  const j = await kvGet(['grade:cfg']);
  GR.cfg = Object.assign(defCfg(), j['grade:cfg'] || {});
  GR.cfg.perf = Object.assign({ '1': [], '2': [] }, GR.cfg.perf);
}
async function loadKeys(keys) {
  const need = keys.filter((k) => !(k in GR.data));
  if (!need.length) return;
  const j = await kvGet(need);
  need.forEach((k) => { GR.data[k] = j[k] || (k.startsWith('grade:perf') ? { scores: {} } : { scores: {}, answers: {} }); });
}
const saveCfg = () => APP.kvSet('grade:cfg', GR.cfg);

/* 모든 평가를 한 줄로 */
function assessments() {
  const out = [];
  ['1', '2'].forEach((sem) => GR.cfg.perf[sem].forEach((sub) => sub.items.forEach((it) => out.push({
    id: `p:${sem}:${sub.id}:${it.id}`, label: `${sem}학기 ${sub.name} - ${it.name}`, short: `${sem}학기 ${sub.name.slice(0, 4)}·${it.name.slice(0, 5)}`,
    max: Number(it.max) || 0, kind: 'perf', sub, it, cuts: it.cuts, key: perfKey(sem, sub.id) }))));
  GR.cfg.evals.forEach((ev) => out.push({ id: 'e:' + ev.id, label: ev.name, short: ev.name.slice(0, 9), max: evMax(ev), kind: 'eval', ev, key: evalKey(ev.id) }));
  return out;
}
function scoreOf(a, n) {
  const d = GR.data[a.key]; if (!d) return null;
  return a.kind === 'perf' ? num(d.scores && d.scores[n] && d.scores[n][a.it.id]) : evalTotal(a.ev, d, n);
}
async function loadAll() { await loadKeys([...new Set(assessments().map((a) => a.key))]); }

async function exportSheet(name, rows) {
  try { await api('writeTable', { name: '성적_' + name, rows }); } catch (e) { toast('저장은 됐지만 시트 내보내기에 실패했어요: ' + errMsg(e), true); }
}

/* ---------- 페이지 ---------- */
APP.pages.grade = () => {
  const wrap = h('div'), body = h('div'), tabs = h('div', { class: 'tabs' });
  const drawTabs = () => tabs.replaceChildren(...[['perf', '수행평가 관리'], ['etc', '기타 평가 관리'], ['trend', '성적 추이'], ['view', '성적 조회']].map(([id, n]) =>
    h('button', { class: 'tab' + (GR.tab === id ? ' active' : ''), onclick: () => { GR.tab = id; drawTabs(); draw(); } }, n)));
  const draw = async () => {
    body.replaceChildren(APP.loading());
    try {
      await ensure();
      if (!S.roster.length) return body.replaceChildren(h('div', { class: 'card placeholder' }, '먼저 학급 기초설정에서 명렬표를 입력해 주세요.'));
      let v;
      if (GR.tab === 'perf') v = await viewPerf(draw);
      else if (GR.tab === 'etc') v = await viewEtc(draw);
      else { await loadAll(); v = GR.tab === 'trend' ? viewTrend(draw) : viewLookup(draw); }
      body.replaceChildren(v);
    } catch (e) { body.replaceChildren(h('div', { class: 'banner warn' }, errMsg(e))); }
  };
  wrap.append(tabs, body); drawTabs(); draw();
  return wrap;
};

const semToggle = (redraw) => h('div', { class: 'tabs' }, ['1', '2'].map((s) =>
  h('button', { class: 'tab sm' + (GR.sem === s ? ' active' : ''), onclick: () => { GR.sem = s; GR.subId = null; redraw(); } }, s + '학기')));
const dirtyNote = () => (GR.dirty ? h('span', { class: 'muted' }, '저장하지 않은 변경이 있습니다') : null);

/* =====================================================
   수행평가 관리
   ===================================================== */
async function viewPerf(redraw) {
  const sub = h('div', { class: 'tabs' }, [['base', '기초작업'], ['eval', '평가']].map(([id, n]) =>
    h('button', { class: 'tab sm' + (GR.ptab === id ? ' active' : ''), onclick: () => { GR.ptab = id; redraw(); } }, n)));
  return h('div', null, sub, GR.ptab === 'base' ? perfBase(redraw) : await perfEval(redraw));
}

function perfBase(redraw) {
  const cfg = GR.cfg, labels = cfg.labels, subs = cfg.perf[GR.sem];
  const dirty = () => { GR.dirty = true; };
  const labelRow = h('div', { class: 'row' }, h('span', { class: 'muted' }, '평어 이름'),
    labels.map((l, i) => h('input', { value: l, style: 'width:96px', onchange: (e) => { labels[i] = e.target.value.trim() || l; dirty(); redraw(); } })));
  const cards = subs.map((sb, si) => h('div', { class: 'card' },
    h('div', { class: 'row gap' }, h('input', { value: sb.name, placeholder: '과목명', style: 'font-weight:700;width:180px', onchange: (e) => { sb.name = e.target.value; dirty(); } }),
      h('button', { class: 'sm ghost', onclick: () => { if (confirm(`"${sb.name}" 과목을 삭제할까요? (입력한 점수는 시트에 남아 있어요)`)) { subs.splice(si, 1); dirty(); redraw(); } } }, '과목 삭제')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'roster survey' },
      h('thead', null, h('tr', null, h('th', null, '평가기준'), h('th', null, '만점'), [0, 1, 2].map((i) => h('th', null, `${labels[i]} 기준(이상)`)), h('th', null, `${labels[3]}`), h('th', null, ''))),
      h('tbody', null, sb.items.map((it, ii) => h('tr', null,
        h('td', null, h('input', { value: it.name, placeholder: '예) 발표하기', style: 'min-width:180px;width:100%', onchange: (e) => { it.name = e.target.value; dirty(); } })),
        h('td', null, h('input', { type: 'number', value: it.max, style: 'width:70px;text-align:center', onchange: (e) => { it.max = num(e.target.value) || 0; it.cuts = autoCuts(it.max); dirty(); redraw(); } })),
        [0, 1, 2].map((i) => h('td', null, h('input', { type: 'number', step: 'any', value: it.cuts[i], style: 'width:78px;text-align:center', onchange: (e) => { it.cuts[i] = num(e.target.value) || 0; dirty(); } }))),
        h('td', { class: 'muted' }, `그 미만`),
        h('td', { class: 'del' }, h('button', { class: 'sm ghost', onclick: () => { sb.items.splice(ii, 1); dirty(); redraw(); } }, '✕'))))))),
    h('div', { style: 'margin-top:8px' }, h('button', { class: 'sm', onclick: () => { sb.items.push({ id: uid('i'), name: '', max: 10, cuts: autoCuts(10) }); dirty(); redraw(); } }, '+ 평가기준 추가'))));
  return h('div', null, semToggle(redraw),
    h('div', { class: 'card' }, labelRow, h('div', { class: 'muted', style: 'margin-top:6px' }, '만점을 바꾸면 기준 점수가 90%·70%·50%로 자동 채워져요. 직접 고쳐도 됩니다.')),
    cards,
    h('div', { class: 'row' }, h('button', { onclick: () => { subs.push({ id: uid('s'), name: '', items: [{ id: uid('i'), name: '', max: 10, cuts: autoCuts(10) }] }); dirty(); redraw(); } }, '+ 과목 추가'),
      h('div', { style: 'flex:1' }), dirtyNote(),
      h('button', { class: 'primary', onclick: async () => { try { await saveCfg(); GR.dirty = false; toast('기초작업을 저장했습니다'); redraw(); } catch (e) { toast(errMsg(e), true); } } }, '저장')));
}

async function perfEval(redraw) {
  const subs = GR.cfg.perf[GR.sem].filter((s) => s.items.length);
  if (!subs.length) return h('div', null, semToggle(redraw), h('div', { class: 'card placeholder' }, `${GR.sem}학기 과목이 없습니다. "기초작업"에서 과목과 평가기준을 먼저 만들어 주세요.`));
  const sb = subs.find((s) => s.id === GR.subId) || subs[0]; GR.subId = sb.id;
  const key = perfKey(GR.sem, sb.id); await loadKeys([key]);
  const d = GR.data[key], labels = GR.cfg.labels;
  const sel = h('select', { value: sb.id, onchange: (e) => { GR.subId = e.target.value; redraw(); } }, subs.map((s) => h('option', { value: s.id }, s.name || '(이름 없음)')));
  const rows = APP.roster().map((s) => {
    const tds = sb.items.map((it) => {
      const chip = h('span', { class: 'lvchip' });
      const upd = () => {
        const v = num(d.scores[s.num] && d.scores[s.num][it.id]), bi = bandIdx(it.cuts, v);
        chip.textContent = bi < 0 ? '' : labels[bi]; chip.className = 'lvchip ' + (bi < 0 ? '' : LV_CLASS[bi]);
      };
      const inp = h('input', { type: 'number', step: 'any', min: 0, max: it.max, value: d.scores[s.num] && d.scores[s.num][it.id] != null ? d.scores[s.num][it.id] : '',
        oninput: (e) => {
          const v = e.target.value; d.scores[s.num] = d.scores[s.num] || {};
          if (v === '') delete d.scores[s.num][it.id]; else d.scores[s.num][it.id] = Number(v);
          inp.classList.toggle('bad', Number(v) > it.max || Number(v) < 0); GR.dirty = true; upd();
        } });
      upd();
      return h('td', { class: 'sc' }, inp, chip);
    });
    return h('tr', { class: APP.gcls(s.gender) }, h('td', { class: 'sv-name' }, `${s.num} ${s.name}`), tds);
  });
  return h('div', null, semToggle(redraw),
    h('div', { class: 'card' },
      h('div', { class: 'row gap' }, sel, h('span', { class: 'muted' }, '점수를 입력하면 평어가 자동으로 나와요.'), h('div', { style: 'flex:1' }), dirtyNote(),
        h('button', { class: 'primary', onclick: async () => {
          const bad = sb.items.some((it) => APP.roster().some((s) => { const v = num(d.scores[s.num] && d.scores[s.num][it.id]); return v != null && (v > it.max || v < 0); }));
          if (bad) return toast('만점을 넘거나 0보다 작은 점수가 있습니다', true);
          try {
            await APP.kvSet(key, d); GR.dirty = false; toast('점수를 저장했습니다');
            const head = ['번호', '이름', ...sb.items.map((i) => `${i.name}(${i.max})`), ...sb.items.map((i) => `${i.name} 평어`)];
            const body = APP.roster().map((s) => [s.num, s.name, ...sb.items.map((it) => num(d.scores[s.num] && d.scores[s.num][it.id])), ...sb.items.map((it) => { const b = bandIdx(it.cuts, num(d.scores[s.num] && d.scores[s.num][it.id])); return b < 0 ? '' : labels[b]; })]);
            exportSheet(`${GR.sem}학기_${sb.name}`, [head, ...body]);
          } catch (e) { toast(errMsg(e), true); }
        } }, '저장')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'roster survey' },
        h('thead', null, h('tr', null, h('th', null, '학생'), sb.items.map((it) => h('th', null, `${it.name || '(기준)'} / ${it.max}점`)))),
        h('tbody', null, rows)))));
}

/* =====================================================
   기타 평가 관리
   ===================================================== */
async function viewEtc(redraw) {
  const evs = GR.cfg.evals;
  const chips = h('div', { class: 'chips' }, evs.map((e) => h('button', { class: 'chip' + (e.id === GR.evalId && !GR.creating ? ' active' : ''), onclick: () => { GR.evalId = e.id; GR.creating = false; GR.editing = false; redraw(); } }, e.name || '(이름 없음)')),
    h('button', { class: 'chip add', onclick: () => { GR.creating = true; GR.editing = false; redraw(); } }, '+ 평가 추가'));
  if (GR.creating) return h('div', null, chips, evalForm(null, redraw));
  const ev = evs.find((e) => e.id === GR.evalId) || evs[0];
  if (!ev) return h('div', null, chips, h('div', { class: 'card placeholder' }, '평가가 없습니다. "+ 평가 추가"로 만들어 보세요.'));
  GR.evalId = ev.id;
  if (GR.editing) return h('div', null, chips, evalForm(ev, redraw));
  return h('div', null, chips, await evalEntry(ev, redraw));
}

function evalForm(ev, redraw) {
  const isNew = !ev;
  const e = ev || { id: uid('e'), name: '', type: 'score', max: 100, cut: 80, items: [], created: Date.now() };
  const box = h('div', { class: 'card' });
  const draw = () => {
    box.replaceChildren(
      h('h3', null, isNew ? '새 평가 만들기' : '평가 설정 수정'),
      h('div', { class: 'field' }, h('label', null, '평가 이름'), h('input', { value: e.name, placeholder: '예) 단원평가 3단원', style: 'width:100%;max-width:360px', oninput: (x) => { e.name = x.target.value; } })),
      h('div', { class: 'field' }, h('label', null, '입력 방식'), h('div', { class: 'radios' },
        [['score', '점수를 직접 입력'], ['answers', '학생별 문항 응답을 입력하면 자동 채점']].map(([v, n]) =>
          h('label', null, h('input', { type: 'radio', name: 'etype', checked: e.type === v, disabled: !isNew, onchange: () => { e.type = v; if (v === 'answers' && !e.items.length) e.items = Array.from({ length: 10 }, () => ({ ans: '', pts: 1 })); draw(); } }), n)))),
      e.type === 'score'
        ? h('div', { class: 'field' }, h('label', null, '만점'), h('input', { type: 'number', class: 'n', value: e.max, onchange: (x) => { e.max = num(x.target.value) || 0; } }))
        : h('div', { class: 'field' }, h('label', null, '문항 정답과 배점'),
          h('div', { class: 'row gap' }, h('span', null, '문항 수'), h('input', { type: 'number', class: 'n', min: 1, max: 60, value: e.items.length, onchange: (x) => {
            const n = Math.max(1, Math.min(60, Number(x.target.value) | 0)); while (e.items.length < n) e.items.push({ ans: '', pts: 1 }); e.items.length = n; draw(); } }),
            h('span', { class: 'muted' }, `만점 ${evMax(e)}점 · 정답은 숫자, ①~⑤, O/X, 글자 모두 가능`)),
          h('div', { class: 'qgrid' }, e.items.map((it, i) => h('div', { class: 'q' }, h('b', null, i + 1),
            h('input', { value: it.ans, placeholder: '정답', oninput: (x) => { it.ans = x.target.value; } }),
            h('input', { type: 'number', step: 'any', value: it.pts, title: '배점', oninput: (x) => { it.pts = num(x.target.value) || 0; } }))))),
      h('div', { class: 'field' }, h('label', null, '기준 점수 (이 점수 이상이면 "기준 도달")'), h('input', { type: 'number', step: 'any', class: 'n', value: e.cut == null ? '' : e.cut, onchange: (x) => { e.cut = num(x.target.value); } })),
      h('div', { class: 'row', style: 'justify-content:flex-end' },
        h('button', { onclick: () => { GR.creating = false; GR.editing = false; redraw(); } }, '취소'),
        !isNew ? h('button', { class: 'danger', onclick: async () => {
          if (!confirm(`"${e.name}" 평가를 삭제할까요? 입력한 점수도 사라집니다.`)) return;
          try { GR.cfg.evals = GR.cfg.evals.filter((x) => x.id !== e.id); await saveCfg(); await APP.kvDel(evalKey(e.id)); delete GR.data[evalKey(e.id)]; GR.evalId = null; GR.editing = false; redraw(); } catch (x) { toast(errMsg(x), true); }
        } }, '평가 삭제') : null,
        h('button', { class: 'primary', onclick: async () => {
          if (!e.name.trim()) return toast('평가 이름을 입력하세요', true);
          if (evMax(e) <= 0) return toast('만점이 0보다 커야 합니다', true);
          if (isNew) GR.cfg.evals.push(e);
          try { await saveCfg(); GR.evalId = e.id; GR.creating = false; GR.editing = false; toast('평가를 저장했습니다'); redraw(); } catch (x) { toast(errMsg(x), true); }
        } }, '저장')));
  };
  draw();
  return box;
}

async function evalEntry(ev, redraw) {
  const key = evalKey(ev.id); await loadKeys([key]);
  const d = GR.data[key]; d.scores = d.scores || {}; d.answers = d.answers || {};
  const max = evMax(ev), roster = APP.roster();
  const stats = h('div', { class: 'row muted', style: 'margin-bottom:10px' });
  const upStats = () => {
    const vals = roster.map((s) => evalTotal(ev, d, s.num)).filter((v) => v != null);
    stats.textContent = vals.length ? `입력 ${vals.length}명 · 평균 ${fmt(vals.reduce((a, b) => a + b, 0) / vals.length)}점 · 최고 ${Math.max(...vals)} · 최저 ${Math.min(...vals)}${ev.cut != null ? ` · 기준 도달 ${vals.filter((v) => v >= ev.cut).length}명` : ''}` : '아직 입력된 점수가 없습니다';
  };
  const rows = roster.map((s) => {
    const res = h('td', { class: 'sc-res' }), tot = h('td', { class: 'sc-tot' });
    const upd = () => {
      const t = evalTotal(ev, d, s.num);
      tot.textContent = t == null ? '' : `${fmt(t)}점`;
      res.replaceChildren(t == null || ev.cut == null ? '' : h('span', { class: 'lvchip ' + (t >= ev.cut ? 'lv0' : 'lv3') }, t >= ev.cut ? '기준 도달' : '미도달'));
      upStats();
    };
    let cells;
    if (ev.type === 'score') {
      cells = [h('td', null, h('input', { type: 'number', step: 'any', min: 0, max, value: d.scores[s.num] != null ? d.scores[s.num] : '', style: 'width:90px;text-align:center', oninput: (e) => {
        const v = e.target.value; if (v === '') delete d.scores[s.num]; else d.scores[s.num] = Number(v);
        e.target.classList.toggle('bad', Number(v) > max || Number(v) < 0); GR.dirty = true; upd(); } }))];
    } else {
      cells = ev.items.map((it, i) => {
        const inp = h('input', { class: 'ans', value: (d.answers[s.num] || [])[i] || '', oninput: (e) => {
          const arr = (d.answers[s.num] = d.answers[s.num] || []); arr[i] = e.target.value; GR.dirty = true; mark(); upd(); } });
        const mark = () => { const r = norm(inp.value); inp.classList.toggle('ok', r !== '' && r === norm(it.ans)); inp.classList.toggle('no', r !== '' && r !== norm(it.ans)); };
        mark(); return h('td', null, inp);
      });
    }
    upd();
    return h('tr', { class: APP.gcls(s.gender) }, h('td', { class: 'sv-name' }, `${s.num} ${s.name}`), cells, tot, res);
  });
  upStats();
  const head = h('tr', null, h('th', null, '학생'),
    ev.type === 'score' ? h('th', null, `점수 (${max}점)`) : ev.items.map((it, i) => h('th', { title: `정답 ${it.ans} / ${it.pts}점` }, i + 1)),
    h('th', null, '총점'), h('th', null, ev.cut != null ? `기준 ${ev.cut}점` : '결과'));
  return h('div', { class: 'card' },
    h('div', { class: 'row gap' }, h('b', null, ev.name), h('span', { class: 'muted' }, `${ev.type === 'score' ? '점수 직접 입력' : '문항 응답 입력(자동 채점)'} · 만점 ${max}점`),
      h('div', { style: 'flex:1' }), dirtyNote(), h('button', { class: 'sm', onclick: () => { GR.editing = true; redraw(); } }, '설정 수정'),
      h('button', { class: 'primary', onclick: async () => {
        if (ev.type === 'score' && roster.some((s) => d.scores[s.num] != null && (d.scores[s.num] > max || d.scores[s.num] < 0))) return toast('만점을 넘거나 0보다 작은 점수가 있습니다', true);
        try {
          await APP.kvSet(key, d); GR.dirty = false; toast('저장했습니다');
          const cols = ev.type === 'answers' ? ev.items.map((_, i) => `${i + 1}번`) : [];
          const hd = ['번호', '이름', ...cols, '총점', ev.cut != null ? '기준 도달' : ''];
          const body = roster.map((s) => { const t = evalTotal(ev, d, s.num); return [s.num, s.name, ...(ev.type === 'answers' ? ev.items.map((_, i) => (d.answers[s.num] || [])[i] || '') : []), t, ev.cut != null && t != null ? (t >= ev.cut ? '도달' : '미도달') : '']; });
          const answerRow = ev.type === 'answers' ? [['', '정답', ...ev.items.map((i) => i.ans), max, '']] : [];
          exportSheet(ev.name, [hd, ...answerRow, ...body]);
        } catch (e) { toast(errMsg(e), true); }
      } }, '저장')),
    stats,
    h('div', { class: 'table-wrap' }, h('table', { class: 'roster survey' }, h('thead', null, head), h('tbody', null, rows))));
}

/* =====================================================
   성적 추이 (SVG 그래프)
   ===================================================== */
const C1 = '#2a78d6', C2 = '#eb6834', C3 = '#1baf7a', GRID = '#e5e7eb', INK = '#52514e';
const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs, ...kids) => { const e = document.createElementNS(NS, tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); kids.forEach((c) => e.append(c)); return e; };
const txt = (attrs, s) => { const t = sv('text', attrs); t.textContent = s; return t; };

function chartFrame(W, H, m) {
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sg', role: 'img' });
  [0, 25, 50, 75, 100].forEach((v) => {
    const y = m.t + (1 - v / 100) * (H - m.t - m.b);
    svg.append(sv('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: GRID, 'stroke-width': 1 }), txt({ x: m.l - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: INK }, v + '%'));
  });
  return svg;
}
function legend(items) {
  return h('div', { class: 'row legend2' }, items.map(([c, n, dash]) => h('span', null, h('i', { class: 'dot', style: `background:${c};${dash ? 'opacity:.7' : ''}` }), n)));
}
function lineChart(labels, series, titles) {
  const W = 920, H = 340, m = { l: 104, r: 90, t: 14, b: 92 }, svg = chartFrame(W, H, m);
  const n = labels.length, x = (i) => m.l + (n === 1 ? (W - m.l - m.r) / 2 : (i * (W - m.l - m.r)) / (n - 1)), y = (v) => m.t + (1 - v / 100) * (H - m.t - m.b);
  labels.forEach((l, i) => { const t = txt({ x: x(i), y: H - m.b + 14, 'text-anchor': 'end', 'font-size': 11, fill: INK, transform: `rotate(-30 ${x(i)} ${H - m.b + 14})` }, l); svg.append(t); });
  series.forEach((s) => {
    let d = '', pen = false;
    s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i)},${y(v)}`; pen = true; });
    svg.append(sv('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-dasharray': s.dash ? '6 4' : '' }));
    let last = -1;
    s.values.forEach((v, i) => {
      if (v == null) return; last = i;
      svg.append(sv('circle', { cx: x(i), cy: y(v), r: 4.5, fill: s.color, stroke: '#fff', 'stroke-width': 2 }, (() => { const t = sv('title'); t.textContent = `${s.name} · ${titles[i]}: ${Math.round(v * 10) / 10}%`; return t; })()));
    });
    if (last >= 0) svg.append(txt({ x: x(last) + 9, y: y(s.values[last]) + 4, 'font-size': 11, 'font-weight': 600, fill: INK }, s.name));
  });
  return svg;
}
function barChart(names, vals, avg, title) {
  const W = 920, H = 320, m = { l: 48, r: 20, t: 14, b: 46 }, svg = chartFrame(W, H, m);
  const n = names.length, bw = (W - m.l - m.r) / n, y = (v) => m.t + (1 - v / 100) * (H - m.t - m.b);
  vals.forEach((v, i) => {
    const cx = m.l + bw * i + bw / 2;
    if (v != null) {
      const h0 = y(0) - y(v);
      svg.append(sv('path', { d: `M${cx - bw * 0.3},${y(0)} v${-Math.max(h0 - 4, 0)} q0,-4 4,-4 h${bw * 0.6 - 8} q4,0 4,4 v${Math.max(h0 - 4, 0)} z`, fill: C1 }, (() => { const t = sv('title'); t.textContent = `${names[i]}: ${Math.round(v * 10) / 10}%`; return t; })()));
    }
    svg.append(txt({ x: cx, y: H - m.b + 16, 'text-anchor': 'middle', 'font-size': bw < 26 ? 9 : 11, fill: INK }, names[i].length > 3 ? names[i].slice(0, 3) : names[i]));
  });
  if (avg != null) svg.append(sv('line', { x1: m.l, x2: W - m.r, y1: y(avg), y2: y(avg), stroke: C2, 'stroke-width': 2, 'stroke-dasharray': '6 4' }), txt({ x: W - m.r, y: y(avg) - 6, 'text-anchor': 'end', 'font-size': 11, 'font-weight': 600, fill: INK }, `학급 평균 ${Math.round(avg * 10) / 10}%`));
  return svg;
}
const pct = (a, v) => (v == null || !a.max ? null : (v / a.max) * 100);

function viewTrend(redraw) {
  const asm = assessments(), roster = APP.roster();
  if (!asm.length) return h('div', { class: 'card placeholder' }, '아직 평가가 없습니다. 수행평가나 기타 평가를 먼저 입력해 주세요.');
  const withData = asm.filter((a) => roster.some((s) => scoreOf(a, s.num) != null));
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const classVals = (a) => roster.map((s) => pct(a, scoreOf(a, s.num))).filter((v) => v != null);
  const modes = [['student', '학생별'], ['asm', '평가별'], ['class', '학급별']];
  const bar = h('div', { class: 'card' }, h('div', { class: 'row radios' }, modes.map(([v, n]) =>
    h('label', null, h('input', { type: 'radio', name: 'tm', checked: GR.tmode === v, onchange: () => { GR.tmode = v; redraw(); } }), n))));
  let chart, table;
  if (!withData.length) return h('div', null, bar, h('div', { class: 'card placeholder' }, '입력된 점수가 없습니다.'));
  if (GR.tmode === 'student') {
    const sel = h('select', { value: GR.tStu || roster[0].num, onchange: (e) => { GR.tStu = Number(e.target.value); redraw(); } }, roster.map((s) => h('option', { value: s.num }, `${s.num}번 ${s.name}`)));
    const sn = Number(GR.tStu || roster[0].num);
    const mine = withData.map((a) => pct(a, scoreOf(a, sn))), avg = withData.map((a) => mean(classVals(a)));
    chart = h('div', null, h('div', { class: 'row gap' }, sel, legend([[C1, stuName(sn)], [C2, '학급 평균', true]])),
      lineChart(withData.map((a) => a.short), [{ name: '학급 평균', values: avg, color: C2, dash: true }, { name: stuName(sn), values: mine, color: C1 }], withData.map((a) => a.label)));
    table = [['평가', stuName(sn), '학급 평균'], ...withData.map((a, i) => [a.label, fmt(mine[i]) + '%', fmt(avg[i]) + '%'])];
  } else if (GR.tmode === 'asm') {
    const cur = withData.find((a) => a.id === GR.tAsm) || withData[0];
    const sel = h('select', { value: cur.id, onchange: (e) => { GR.tAsm = e.target.value; redraw(); } }, withData.map((a) => h('option', { value: a.id }, a.label)));
    const vals = roster.map((s) => pct(cur, scoreOf(cur, s.num))), avg = mean(vals.filter((v) => v != null));
    chart = h('div', null, h('div', { class: 'row gap' }, sel, legend([[C1, '학생 점수(만점 대비 %)'], [C2, '학급 평균', true]])), barChart(roster.map((s) => s.name), vals, avg, cur.label));
    table = [['학생', '점수', '%'], ...roster.map((s, i) => [`${s.num} ${s.name}`, fmt(scoreOf(cur, s.num)), fmt(vals[i]) + '%'])];
  } else {
    const avg = withData.map((a) => mean(classVals(a))), mx = withData.map((a) => Math.max(...classVals(a))), mn = withData.map((a) => Math.min(...classVals(a)));
    chart = h('div', null, h('div', { class: 'row gap' }, legend([[C1, '평균'], [C3, '최고'], [C2, '최저']])),
      lineChart(withData.map((a) => a.short), [{ name: '최고', values: mx, color: C3 }, { name: '최저', values: mn, color: C2 }, { name: '평균', values: avg, color: C1 }], withData.map((a) => a.label)));
    table = [['평가', '평균', '최고', '최저'], ...withData.map((a, i) => [a.label, fmt(avg[i]) + '%', fmt(mx[i]) + '%', fmt(mn[i]) + '%'])];
  }
  return h('div', null, bar, h('div', { class: 'card' }, chart,
    h('details', { style: 'margin-top:12px' }, h('summary', null, '표로 보기'),
      h('div', { class: 'table-wrap', style: 'margin-top:8px' }, h('table', { class: 'roster survey' }, h('thead', null, h('tr', null, table[0].map((t) => h('th', null, t)))), h('tbody', null, table.slice(1).map((r) => h('tr', null, r.map((c, i) => h('td', { style: i ? '' : 'text-align:left;padding:6px 10px' }, c))))))))));
}

/* =====================================================
   성적 조회
   ===================================================== */
function viewLookup(redraw) {
  const asm = assessments(), roster = APP.roster();
  if (!asm.length) return h('div', { class: 'card placeholder' }, '아직 평가가 없습니다.');
  const sn = Number(GR.vStu || roster[0].num), labels = GR.cfg.labels;
  const ss = h('select', { value: sn, onchange: (e) => { GR.vStu = Number(e.target.value); redraw(); } }, roster.map((s) => h('option', { value: s.num }, `${s.num}번 ${s.name}`)));
  const sa = h('select', { value: GR.vAsm, onchange: (e) => { GR.vAsm = e.target.value; redraw(); } }, h('option', { value: 'all' }, '전체 평가'), asm.map((a) => h('option', { value: a.id }, a.label)));
  const radios = h('div', { class: 'radios' }, [[true, '문항별 맞고 틀림 보기'], [false, '점수만 보기']].map(([v, n]) =>
    h('label', null, h('input', { type: 'radio', name: 'vd', checked: GR.vDetail === v, onchange: () => { GR.vDetail = v; redraw(); } }), n)));
  const resultOf = (a) => {
    const sc = scoreOf(a, sn);
    if (sc == null) return '입력 없음';
    if (a.kind === 'perf') { const b = bandIdx(a.cuts, sc); return h('span', null, `${fmt(sc)} / ${a.max}점 `, h('span', { class: 'lvchip ' + LV_CLASS[b] }, labels[b])); }
    return h('span', null, `${fmt(sc)} / ${a.max}점 `, a.ev.cut != null ? h('span', { class: 'lvchip ' + (sc >= a.ev.cut ? 'lv0' : 'lv3') }, sc >= a.ev.cut ? '기준 도달' : '미도달') : null);
  };
  let out;
  if (GR.vAsm === 'all') {
    out = h('div', { class: 'table-wrap' }, h('table', { class: 'roster survey' }, h('thead', null, h('tr', null, ['평가', '결과', '만점 대비'].map((t) => h('th', null, t)))),
      h('tbody', null, asm.map((a) => { const sc = scoreOf(a, sn); return h('tr', null, h('td', { style: 'text-align:left;padding:8px 10px' }, a.label), h('td', null, resultOf(a)), h('td', null, sc == null ? '' : fmt(pct(a, sc)) + '%')); }))));
  } else {
    const a = asm.find((x) => x.id === GR.vAsm);
    out = h('div', null, h('div', { style: 'font-size:18px;font-weight:700;margin-bottom:10px' }, a.label, ' — ', resultOf(a)));
    if (a.kind === 'eval' && a.ev.type === 'answers' && GR.vDetail) {
      const resp = (GR.data[a.key].answers || {})[sn] || [];
      out.append(h('div', { class: 'table-wrap' }, h('table', { class: 'roster survey' }, h('thead', null, h('tr', null, ['문항', '학생 응답', '정답', '배점', '결과'].map((t) => h('th', null, t)))),
        h('tbody', null, a.ev.items.map((it, i) => {
          const ok = norm(resp[i]) !== '' && norm(resp[i]) === norm(it.ans), blank = norm(resp[i]) === '';
          return h('tr', null, h('td', null, i + 1), h('td', null, resp[i] || ''), h('td', null, it.ans), h('td', null, it.pts),
            h('td', null, blank ? '' : h('span', { class: 'lvchip ' + (ok ? 'lv0' : 'lv3') }, ok ? 'O' : 'X')));
        })))));
    }
  }
  return h('div', null, h('div', { class: 'card' }, h('div', { class: 'row gap' }, ss, sa), GR.vAsm !== 'all' && asm.find((x) => x.id === GR.vAsm).kind === 'eval' && asm.find((x) => x.id === GR.vAsm).ev.type === 'answers' ? radios : null), h('div', { class: 'card' }, out));
}
})();
