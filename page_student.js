/* 학생 관리: 누가기록 입력 / 사건 검색 / 교우관계도 */
(() => {
'use strict';
const APP = window.APP;
const { S, h, api, toast, errMsg, kvGet } = APP;

const ST = { sub: 'input', logs: null, survey: null, date: null, text: '', editId: null,
  kw: '', stu: '', order: 'desc', gsub: 'graph', src: { log: true, survey: true }, round: 'all', thr: 1, sel: null,
  tone: '', svRound: null, rater: null };
APP.onLock.push(() => { ST.logs = null; ST.survey = null; ST.text = ''; ST.editId = null; });

/* ---------- 이름 찾기 (성 없이 "철수", 호칭도 인식) ---------- */
function buildAliases() {
  const map = new Map();
  const add = (alias, num) => {
    alias = String(alias || '').trim();
    if (alias.length < 2) return;
    if (!map.has(alias)) map.set(alias, new Set());
    map.get(alias).add(num);
  };
  S.roster.forEach((s) => {
    add(s.name, s.num);
    if (s.name.length >= 3) add(s.name.slice(1), s.num);
    String(s.title || '').split(/[,，、/\s]+/).forEach((t) => add(t, s.num));
  });
  return [...map.entries()].sort((a, b) => b[0].length - a[0].length);
}
function findStudents(text, aliases) {
  const used = new Array(text.length).fill(false);
  const spans = [], nums = new Set(), ambiguous = [];
  aliases.forEach(([alias, set]) => {
    let i = text.indexOf(alias);
    while (i !== -1) {
      const end = i + alias.length;
      if (!used.slice(i, end).some(Boolean)) {
        for (let k = i; k < end; k++) used[k] = true;
        spans.push({ start: i, end, nums: [...set], alias });
        set.forEach((n) => nums.add(n));
        if (set.size > 1 && !ambiguous.includes(alias)) ambiguous.push(alias);
      }
      i = text.indexOf(alias, i + 1);
    }
  });
  spans.sort((a, b) => a.start - b.start);
  return { nums: [...nums].sort((a, b) => a - b), spans, ambiguous };
}
const stuName = (n) => { const s = S.roster.find((x) => Number(x.num) === Number(n)); return s ? s.name : n + '번'; };
const stuOf = (n) => S.roster.find((x) => Number(x.num) === Number(n));

/* 본문 + 이름 강조 + 검색어 강조 */
function highlighted(text, spans, kw) {
  const out = [];
  let pos = 0;
  const plain = (t) => {
    if (!kw) return out.push(t);
    const low = t.toLowerCase(), k = kw.toLowerCase();
    let p = 0, i;
    while ((i = low.indexOf(k, p)) !== -1) {
      if (i > p) out.push(t.slice(p, i));
      out.push(h('mark', { class: 'kw' }, t.slice(i, i + k.length)));
      p = i + k.length;
    }
    if (p < t.length) out.push(t.slice(p));
  };
  spans.forEach((sp) => {
    if (sp.start > pos) plain(text.slice(pos, sp.start));
    const st = stuOf(sp.nums[0]);
    out.push(h('mark', { class: 'nm ' + (sp.nums.length === 1 && st ? APP.gcls(st.gender) : ''), title: sp.nums.map(stuName).join(', ') }, text.slice(sp.start, sp.end)));
    pos = sp.end;
  });
  if (pos < text.length) plain(text.slice(pos));
  return out;
}

/* ---------- 데이터 불러오기 ---------- */
async function ensure() {
  if (ST.logs && ST.survey) return;
  const [lj, kv] = await Promise.all([api('logsLoad'), kvGet(['survey:main'])]);
  ST.logs = lj.logs;
  ST.survey = await loadSurvey(kv['survey:main']);
}
/* 교우관계 조사: 'survey:main' = { v:2, rounds:[{id,name,date}] }, 'survey:r:<id>' = { 평가한학생: { 친구: 1~4 } } */
async function loadSurvey(main) {
  const sv = { main: { v: 2, rounds: [] }, data: {} };
  if (main && main.v === 2) {
    sv.main = main;
    const keys = main.rounds.map((r) => 'survey:r:' + r.id);
    if (keys.length) { const kv = await kvGet(keys); main.rounds.forEach((r) => { sv.data[r.id] = kv['survey:r:' + r.id] || {}; }); }
  } else if (main && (main.likes || main.dislikes)) {
    // 예전 방식(선호 3명·기피 2명)을 "좋음/싫음"으로 옮기기
    const id = 'old', d = {};
    const put = (a, b, v) => { if (!a || !b || Number(a) === Number(b)) return; (d[a] = d[a] || {})[b] = v; };
    Object.entries(main.likes || {}).forEach(([a, arr]) => (arr || []).forEach((b) => put(a, b, 4)));
    Object.entries(main.dislikes || {}).forEach(([a, arr]) => (arr || []).forEach((b) => put(a, b, 1)));
    if (Object.keys(d).length) { sv.main.rounds.push({ id, name: '예전 조사', date: '' }); sv.data[id] = d; }
  }
  return sv;
}
const LEVELS = [[4, '좋음', '#2f6fed'], [3, '친해지고 싶음', '#22a06b'], [2, '그저 그럼', '#9aa3af'], [1, '싫음', '#e5484d']];
const LV_SCORE = { 4: 2, 3: 1, 2: 0, 1: -2 };

/* ---------- 사건 성격(긍정/부정) 판단 ---------- */
const NEG_W = ['다투', '다퉜', '다툼', '싸우', '싸웠', '싸움', '때리', '때렸', '때림', '폭력', '욕을', '욕설', '욕하', '욕했', '놀리', '놀렸', '놀림', '따돌', '왕따', '괴롭', '밀치', '밀쳤', '밀쳐', '밀어서', '때려', '싸워', '다퉈', '놀려', '괴롭혀', '울었', '울음', '울어', '발로 차', '꼬집', '할퀴', '울렸', '울게', '무시', '갈등', '시비', '험담', '뒷담', '빼앗', '뺏', '훔치', '훔쳤', '거짓말', '싫어', '짜증', '화를 내', '화를 냈', '화냄', '화가 나', '소리를 지', '소리 지', '소리질', '위협', '협박', '다쳤', '다치게', '상처', '고자질', '이간', '방해', '비웃', '조롱', '삐졌', '삐짐', '토라', '절교', '외면', '배척', '끼워주지', '안 끼워', '소외', '학폭', '몸싸움', '말다툼', '언쟁', '신경전', '부딪', '탓을', '탓했', '째려', '노려', '침을 뱉', '던졌', '망가뜨', '찢었'];
const POS_W = ['도와', '도왔', '도움', '협력', '협동', '함께 놀', '같이 놀', '사이좋', '사이가 좋', '칭찬', '배려', '양보', '나눠', '나누어', '위로', '친하', '친해', '친한', '즐겁', '즐거', '고마', '감사', '축하', '응원', '격려', '챙겨', '챙김', '화해', '사과하', '사과를', '사과했', '함께 하', '같이 하', '함께하', '같이하', '웃으며', '웃었', '재미있게', '손잡', '손을 잡', '단짝', '어울려', '어울림', '어울리', '놀아 주', '놀아주', '편지', '선물', '안아', '빌려주', '빌려 주', '가르쳐', '알려 주', '알려주', '돌봐', '돌봐줌', '감싸', '편들어', '같이 다니', '함께 다니'];
const NEGATE = /^.{0,6}?(않|못|안 |없)/;
function sentenceTone(t) {
  let sc = 0;
  const scan = (list, sign) => list.forEach((w) => {
    let i = t.indexOf(w);
    while (i !== -1) { const after = t.slice(i + w.length, i + w.length + 8); sc += NEGATE.test(after) ? -sign * 0.5 : sign; i = t.indexOf(w, i + w.length); }
  });
  scan(NEG_W, -1.2); scan(POS_W, 1);  // 부정적인 말을 조금 더 무겁게
  return sc;
}
const TONE_OF = { '긍정': 1, '부정': -1, '중립': 0 };
const toneName = (v) => (v > 0 ? '긍정' : v < 0 ? '부정' : '중립');
/* 한 기록 → { tone: -1|0|1, auto: bool, pairs: Map('a-b' → -1~1) } */
function analyzeLog(l, al) {
  const sents = String(l.content).split(/(?<=[.!?。\n])|(?<=[가-힣][함음됨임다])\s+/).map((x) => x.trim()).filter(Boolean);
  const per = sents.map((t) => ({ sc: sentenceTone(t), nums: findStudents(t, al).nums }));
  const total = per.reduce((a, x) => a + x.sc, 0);
  const manual = l.tone && l.tone in TONE_OF;
  const tone = manual ? TONE_OF[l.tone] : Math.abs(total) < 0.5 ? 0 : Math.sign(total);
  const pairs = new Map();
  const put = (a, b, v) => { if (a === b || !v) return; const k = a < b ? a + '-' + b : b + '-' + a; const o = pairs.get(k) || 0; if (Math.abs(v) > Math.abs(o)) pairs.set(k, v); };
  // 같은 문장에 함께 나온 학생: 그 문장의 성격(없으면 기록 전체 성격)
  per.forEach((x) => { const t = manual ? tone : (Math.abs(x.sc) >= 0.5 ? Math.sign(x.sc) : tone); for (let i = 0; i < x.nums.length; i++) for (let j = i + 1; j < x.nums.length; j++) put(x.nums[i], x.nums[j], t); });
  // 다른 문장에 따로 나온 학생: 기록 전체 성격의 절반
  const all = l._nums || [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) put(all[i], all[j], tone * 0.5);
  return { tone, auto: !manual, pairs };
}
function annotate() {
  const al = buildAliases();
  ST.logs.forEach((l) => { const r = findStudents(l.content, al); l._nums = r.nums; l._spans = r.spans; l._amb = r.ambiguous; const a = analyzeLog(l, al); l._tone = a.tone; l._auto = a.auto; l._pairs = a.pairs; });
}
const sortedLogs = (dir) => ST.logs.slice().sort((a, b) => (a.date === b.date ? a.created - b.created : a.date < b.date ? -1 : 1) * (dir === 'asc' ? 1 : -1));

/* ---------- 페이지 ---------- */
APP.pages.student = () => {
  const wrap = h('div');
  const body = h('div');
  const tabs = h('div', { class: 'tabs' });
  const drawTabs = () => {
    tabs.replaceChildren(...[['input', '누가기록 입력'], ['search', '사건 검색'], ['graph', '교우관계도']].map(([id, n]) =>
      h('button', { class: 'tab' + (ST.sub === id ? ' active' : ''), onclick: () => { ST.sub = id; drawTabs(); draw(); } }, n)));
  };
  const draw = () => {
    body.replaceChildren();
    if (!S.roster.length) return body.append(h('div', { class: 'card placeholder' }, '먼저 학급 기초설정에서 명렬표를 입력해 주세요.'));
    annotate();
    body.append(ST.sub === 'input' ? viewInput(draw) : ST.sub === 'search' ? viewSearch(draw) : viewGraph(draw));
  };
  wrap.append(tabs, body);
  drawTabs();
  body.append(APP.loading());
  ensure().then(draw).catch((e) => { body.replaceChildren(h('div', { class: 'banner warn' }, errMsg(e))); });
  return wrap;
};

/* ---------- 1. 누가기록 입력 ---------- */
function viewInput(redraw) {
  if (!ST.date) ST.date = APP.today();
  const dateIn = h('input', { type: 'date', value: ST.date, onchange: (e) => { ST.date = e.target.value; } });
  const chips = h('div', { class: 'row', style: 'min-height:34px;margin-top:8px' });
  const warn = h('div', { class: 'muted' });
  const al = buildAliases();
  const upd = () => {
    const r = findStudents(ta.value, al);
    chips.replaceChildren(h('span', { class: 'muted' }, r.nums.length ? '인식된 학생:' : '인식된 학생이 없습니다'),
      ...r.nums.map((n) => h('span', { class: 'chip-s ' + APP.gcls(stuOf(n)?.gender) }, `${n} ${stuName(n)}`)));
    warn.textContent = r.ambiguous.length ? `※ "${r.ambiguous.join('", "')}"은(는) 이름이 같은 학생이 여러 명이라 모두 연결돼요. 성까지 쓰면 정확해요.` : '';
    drawTone();
  };
  const toneRow = h('div', { class: 'row tone-row' });
  const drawTone = () => {
    const auto = toneName(analyzeLog({ content: ta.value, tone: '', _nums: [] }, al).tone);
    toneRow.replaceChildren(h('span', { class: 'muted' }, '사건 성격'),
      ...[['', `자동 (${auto})`], ['긍정', '긍정'], ['중립', '중립'], ['부정', '부정']].map(([v, n]) =>
        h('button', { type: 'button', class: 'sm tone-btn' + (ST.tone === v ? ' on' : '') + (v ? ' t-' + v : ''), onclick: () => { ST.tone = v; drawTone(); } }, n)),
      h('span', { class: 'muted', style: 'font-size:12px' }, '교우관계도에서 긍정적인 사건은 가까운 관계로, 부정적인 사건은 갈등 관계로 반영돼요.'));
  };
  const ta = h('textarea', { class: 'log-ta', placeholder: '예) 쉬는 시간에 철수와 영희가 블록을 두고 다퉜다. 서로 사과하고 화해함.', value: ST.text, oninput: (e) => { ST.text = e.target.value; upd(); } });
  const saveBtn = h('button', { class: 'primary', onclick: async () => {
    const content = ta.value.trim();
    if (!content) return toast('내용을 입력하세요', true);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ST.date)) return toast('날짜를 확인하세요', true);
    const r = findStudents(content, al);
    const old = ST.editId ? ST.logs.find((l) => l.id === ST.editId) : null;
    const log = { id: old ? old.id : 'l' + Date.now().toString(36), date: ST.date, content, names: r.nums.map(stuName).join(', '), created: old ? old.created : Date.now(), tone: ST.tone };
    saveBtn.disabled = true;
    try {
      await api('logSave', { log });
      if (old) Object.assign(old, log); else ST.logs.push(log);
      ST.text = ''; ST.editId = null; ST.tone = ''; toast('누가기록을 저장했습니다 (구글 시트에도 기록됨)'); redraw();
    } catch (e) { toast(errMsg(e), true); saveBtn.disabled = false; }
  } }, ST.editId ? '수정 저장' : '기록하기');

  const recent = sortedLogs('desc').slice(0, 12);
  return h('div', null,
    h('div', { class: 'card' },
      h('div', { class: 'row gap' }, h('label', { class: 'muted' }, '날짜'), dateIn,
        h('button', { class: 'sm ghost', onclick: () => { ST.date = APP.today(); redraw(); } }, '오늘'),
        ST.editId ? h('span', { class: 'banner', style: 'margin:0;padding:4px 10px' }, '기록을 수정하는 중입니다') : null),
      ta, chips, warn, toneRow,
      h('div', { class: 'row', style: 'margin-top:10px;justify-content:flex-end' },
        ST.editId ? h('button', { onclick: () => { ST.editId = null; ST.text = ''; ST.tone = ''; redraw(); } }, '수정 취소') : null, saveBtn)),
    h('div', { class: 'card' }, h('h3', null, `최근 기록 (${ST.logs.length}건 중 ${recent.length}건)`),
      recent.length ? recent.map((l) => logItem(l, '', redraw, true)) : h('div', { class: 'muted' }, '아직 기록이 없습니다.')),
    (upd(), null));
}
function logItem(l, kw, redraw, editable) {
  return h('div', { class: 'log-item' },
    h('div', { class: 'row', style: 'justify-content:space-between' },
      h('span', { class: 'row' }, h('span', { class: 'log-date' }, l.date),
        h('span', { class: 'tone-badge t-' + toneName(l._tone), title: l._auto ? '자동 판단 (수정에서 바꿀 수 있어요)' : '선생님이 정한 성격' }, toneName(l._tone) + (l._auto ? '' : ' ✓'))),
      h('span', { class: 'row' }, (l._nums || []).map((n) => h('span', { class: 'chip-s ' + APP.gcls(stuOf(n)?.gender) }, `${n} ${stuName(n)}`)),
        editable ? [
          h('button', { class: 'sm ghost', onclick: () => { ST.editId = l.id; ST.text = l.content; ST.date = l.date; ST.tone = l.tone || ''; ST.sub = 'input'; redraw(); window.scrollTo(0, 0); } }, '수정'),
          h('button', { class: 'sm ghost', onclick: async () => {
            if (!confirm('이 기록을 삭제할까요?')) return;
            try { await api('logDel', { id: l.id }); ST.logs = ST.logs.filter((x) => x.id !== l.id); redraw(); } catch (e) { toast(errMsg(e), true); }
          } }, '삭제')] : null)),
    h('div', { class: 'log-text' }, highlighted(l.content, l._spans || [], kw)));
}

/* ---------- 2. 사건 검색 ---------- */
function viewSearch(redraw) {
  const kwIn = h('input', { placeholder: '검색어', value: ST.kw, style: 'min-width:160px', oninput: (e) => { ST.kw = e.target.value.trim(); list(); } });
  const sel = h('select', { value: ST.stu, onchange: (e) => { ST.stu = e.target.value; list(); } },
    h('option', { value: '' }, '모든 학생'), APP.roster().map((s) => h('option', { value: s.num }, `${s.num}번 ${s.name}`)));
  const radios = h('div', { class: 'radios' }, [['desc', '최신순'], ['asc', '오래된순'], ['num', '학생 번호순']].map(([v, n]) =>
    h('label', null, h('input', { type: 'radio', name: 'ord', checked: ST.order === v, onchange: () => { ST.order = v; list(); } }), n)));
  const out = h('div');
  const list = () => {
    let logs = sortedLogs(ST.order === 'asc' ? 'asc' : 'desc');
    if (ST.kw) logs = logs.filter((l) => l.content.toLowerCase().includes(ST.kw.toLowerCase()));
    if (ST.stu) logs = logs.filter((l) => l._nums.includes(Number(ST.stu)));
    out.replaceChildren();
    out.append(h('div', { class: 'muted', style: 'margin-bottom:8px' }, `${logs.length}건`));
    if (!logs.length) return out.append(h('div', { class: 'card placeholder' }, '조건에 맞는 기록이 없습니다.'));
    if (ST.order !== 'num') return out.append(h('div', { class: 'card' }, logs.map((l) => logItem(l, ST.kw, redraw, true))));
    const groups = new Map();
    logs.forEach((l) => { const ns = l._nums.length ? l._nums : [0]; ns.forEach((n) => { if (ST.stu && n !== Number(ST.stu)) return; if (!groups.has(n)) groups.set(n, []); groups.get(n).push(l); }); });
    [...groups.keys()].sort((a, b) => (a || 9999) - (b || 9999)).forEach((n) => {
      const items = groups.get(n).sort((a, b) => (a.date < b.date ? -1 : 1));
      out.append(h('div', { class: 'card' }, h('h3', null, n ? `${n}번 ${stuName(n)} (${items.length}건)` : `학생 미지정 (${items.length}건)`), items.map((l) => logItem(l, ST.kw, redraw, false))));
    });
  };
  const box = h('div', null,
    h('div', { class: 'card' }, h('div', { class: 'row' }, kwIn, sel, radios),
      h('div', { class: 'muted', style: 'margin-top:6px' }, '"철수"처럼 성을 빼고 써도, 명렬표의 호칭으로 써도 그 학생의 기록으로 찾아요.')), out);
  list();
  return box;
}

/* ---------- 3. 교우관계도 ---------- */
function viewGraph(redraw) {
  const sub = h('div', { class: 'tabs' }, [['graph', '관계도 보기'], ['survey', '교우관계 조사 입력']].map(([id, n]) =>
    h('button', { class: 'tab sm' + (ST.gsub === id ? ' active' : ''), onclick: () => { ST.gsub = id; redraw(); } }, n)));
  return h('div', null, sub, ST.gsub === 'survey' ? viewSurvey(redraw) : viewSociogram(redraw));
}

/* 조사 저장 (조금 모았다가 한 번에) */
let saveT = null, savePending = new Set();
function saveSurveyLater(id) {
  if (id) savePending.add(id);
  clearTimeout(saveT);
  saveT = setTimeout(flushSurvey, 900);
}
async function flushSurvey() {
  clearTimeout(saveT); saveT = null;
  const ids = [...savePending]; savePending.clear();
  try {
    await APP.kvSet('survey:main', ST.survey.main);
    for (const id of ids) if (ST.survey.data[id]) await APP.kvSet('survey:r:' + id, ST.survey.data[id]);
  } catch (e) { toast(errMsg(e), true); }
}

function viewSurvey(redraw) {
  const sv = ST.survey, roster = APP.roster(), rounds = sv.main.rounds;
  const box = h('div', { class: 'card' });
  const addRound = () => {
    const name = prompt('조사 이름을 입력하세요', `${rounds.length + 1}차 교우관계 조사`);
    if (!name) return;
    const r = { id: 'r' + Date.now().toString(36), name: name.trim().slice(0, 30), date: APP.today() };
    rounds.push(r); sv.data[r.id] = {}; ST.svRound = r.id; ST.rater = roster[0] && roster[0].num;
    saveSurveyLater(r.id); redraw();
  };
  if (!rounds.length) {
    box.append(h('h3', null, '교우관계 조사 입력'),
      h('div', { class: 'muted', style: 'margin-bottom:12px;line-height:1.7' }, '학생마다 자기 자신을 뺀 모든 친구를 "좋음 / 친해지고 싶음 / 그저 그럼 / 싫음" 4단계로 평가한 결과를 옮겨 적어요. 조사는 여러 번 할 수 있어요.'),
      h('button', { class: 'primary', onclick: addRound }, '+ 첫 조사 만들기'));
    return box;
  }
  if (!rounds.some((r) => r.id === ST.svRound)) ST.svRound = rounds[rounds.length - 1].id;
  const round = rounds.find((r) => r.id === ST.svRound), data = sv.data[round.id] = sv.data[round.id] || {};
  if (!roster.some((x) => x.num === ST.rater)) ST.rater = roster[0].num;
  const done = (n) => roster.filter((f) => f.num !== n && (data[n] || {})[f.num]).length;
  const need = roster.length - 1;
  const fullCount = roster.filter((x) => done(x.num) >= need).length;

  const roundSel = h('select', { onchange: (e) => { ST.svRound = e.target.value; redraw(); } },
    rounds.map((r) => h('option', { value: r.id, selected: r.id === round.id }, r.name + (r.date ? ` (${r.date})` : ''))));
  const head = h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
    h('b', null, '조사'), roundSel,
    h('input', { type: 'date', value: round.date || '', title: '조사한 날짜', onchange: (e) => { round.date = e.target.value; saveSurveyLater(); } }),
    h('button', { class: 'sm', onclick: () => { const n = prompt('조사 이름', round.name); if (n) { round.name = n.trim().slice(0, 30); saveSurveyLater(); redraw(); } } }, '이름 바꾸기'),
    h('button', { class: 'sm', onclick: addRound }, '+ 새 조사'),
    h('button', { class: 'sm ghost', onclick: async () => {
      if (!confirm(`"${round.name}" 조사를 삭제할까요? 입력한 평가가 모두 지워져요.`)) return;
      sv.main.rounds = rounds.filter((r) => r.id !== round.id); delete sv.data[round.id];
      try { await APP.kvSet('survey:main', sv.main); await APP.kvDel('survey:r:' + round.id); } catch (e) { toast(errMsg(e), true); }
      ST.svRound = null; redraw();
    } }, '조사 삭제'));

  const idx = roster.findIndex((x) => x.num === ST.rater), me = roster[idx];
  const go = (d) => { const n = roster[(idx + d + roster.length) % roster.length]; ST.rater = n.num; redraw(); };
  const raterSel = h('select', { onchange: (e) => { ST.rater = Number(e.target.value); redraw(); } },
    roster.map((x) => h('option', { value: x.num, selected: x.num === ST.rater }, `${x.num} ${x.name}  ${done(x.num) >= need ? '✓' : done(x.num) ? `(${done(x.num)}/${need})` : ''}`)));
  const nav = h('div', { class: 'row sv-nav' },
    h('button', { class: 'sm', onclick: () => go(-1) }, '◀ 이전 학생'), raterSel, h('button', { class: 'sm', onclick: () => go(1) }, '다음 학생 ▶'),
    h('span', { class: 'muted' }, `입력 완료 ${fullCount}/${roster.length}명`));

  const mine = (data[me.num] = data[me.num] || {});
  const rowsEl = [];
  const setV = (f, v, rowEl) => {
    if (mine[f.num] === v) delete mine[f.num]; else mine[f.num] = v;
    rowEl.querySelectorAll('.lv').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === mine[f.num]));
    cnt.textContent = `${done(me.num)}/${need}명 평가함`;
    saveSurveyLater(round.id);
  };
  const friends = roster.filter((f) => f.num !== me.num);
  friends.forEach((f, i) => {
    const row = h('div', { class: 'sv-row ' + APP.gcls(f.gender), tabindex: 0 });
    row.append(h('span', { class: 'sv-fname' }, `${f.num} ${f.name}`),
      h('span', { class: 'lv-group' }, LEVELS.map(([v, n, c], k) => h('button', { type: 'button', tabindex: -1, class: 'lv' + (mine[f.num] === v ? ' on' : ''), 'data-v': v, style: `--c:${c}`, title: `키보드 ${k + 1}`, onclick: () => { setV(f, v, row); row.focus(); } }, `${k + 1} ${n}`))));
    row.addEventListener('keydown', (e) => {
      const k = Number(e.key);
      if (k >= 1 && k <= 4) { e.preventDefault(); const v = LEVELS[k - 1][0]; mine[f.num] = undefined; setV(f, v, row); (rowsEl[i + 1] || row).focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); (rowsEl[i + 1] || row).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (rowsEl[i - 1] || row).focus(); }
      else if (e.key === 'Enter' && i === friends.length - 1) { e.preventDefault(); go(1); }
    });
    rowsEl.push(row);
  });
  const cnt = h('span', { class: 'muted' }, `${done(me.num)}/${need}명 평가함`);
  box.append(h('h3', null, '교우관계 조사 입력'), head,
    h('div', { class: 'muted', style: 'margin:10px 0;line-height:1.7' }, '평가한 학생을 고른 뒤, 친구마다 4단계 중 하나를 누르세요. 키보드 숫자 1~4로 입력하면 다음 친구로 넘어가요. (↑↓ 이동, 같은 칸을 다시 누르면 지워져요) 자동 저장돼요.'),
    nav,
    h('div', { class: 'row', style: 'justify-content:space-between;margin:10px 0 6px' }, h('b', null, `${me.num}번 ${me.name} 학생의 평가`), cnt,
      h('button', { class: 'sm ghost', onclick: () => { friends.forEach((f) => { if (!mine[f.num]) mine[f.num] = 2; }); saveSurveyLater(round.id); redraw(); } }, '빈 칸 모두 "그저 그럼"')),
    h('div', { class: 'sv-list' }, rowsEl));
  setTimeout(() => { const first = rowsEl.find((r, i) => !mine[friends[i].num]) || rowsEl[0]; if (first && document.activeElement === document.body) first.focus({ preventScroll: true }); }, 0);
  return box;
}

/* 힘 기반 배치 (Fruchterman–Reingold) */
function forceLayout(ids, edges, W, H) {
  const n = ids.length, pos = {}, k = Math.sqrt((W * H) / Math.max(n, 1)) * 0.8;
  ids.forEach((id, i) => { const a = (2 * Math.PI * i) / n; pos[id] = { x: W / 2 + Math.cos(a) * W * 0.32, y: H / 2 + Math.sin(a) * H * 0.32 }; });
  let t = W / 8;
  for (let it = 0; it < 320; it++) {
    const disp = {}; ids.forEach((id) => (disp[id] = { x: 0, y: 0 }));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = pos[ids[i]], b = pos[ids[j]]; let dx = a.x - b.x, dy = a.y - b.y; let d = Math.hypot(dx, dy) || 0.01;
      const f = (k * k) / d; dx /= d; dy /= d;
      disp[ids[i]].x += dx * f; disp[ids[i]].y += dy * f; disp[ids[j]].x -= dx * f; disp[ids[j]].y -= dy * f;
    }
    edges.forEach((e) => {
      const a = pos[e.a], b = pos[e.b]; let dx = a.x - b.x, dy = a.y - b.y; const d = Math.hypot(dx, dy) || 0.01;
      const f = ((d * d) / k) * (0.6 + Math.min(e.w, 4) * 0.25); dx /= d; dy /= d;
      disp[e.a].x -= dx * f; disp[e.a].y -= dy * f; disp[e.b].x += dx * f; disp[e.b].y += dy * f;
    });
    ids.forEach((id) => {
      const p = pos[id], dd = disp[id];
      dd.x += (W / 2 - p.x) * 0.05; dd.y += (H / 2 - p.y) * 0.05; // 가운데로 모으기
      const d = Math.hypot(dd.x, dd.y) || 0.01, m = Math.min(d, t);
      p.x = Math.max(34, Math.min(W - 34, p.x + (dd.x / d) * m));
      p.y = Math.max(34, Math.min(H - 34, p.y + (dd.y / d) * m));
    });
    t *= 0.985;
  }
  return pos;
}

/* 관계 계산: 조사(방향 있음) + 누가기록(긍정/부정) */
function computeRel() {
  const roster = APP.roster(), ids = roster.map((s) => s.num), idset = new Set(ids);
  const useS = ST.src.survey, useL = ST.src.log;
  const rounds = ST.survey.main.rounds;
  // 조사 점수 s(a→b): 고른 조사, 또는 전체(최근 조사일수록 비중 큼)
  const chosen = ST.round === 'all' ? rounds.map((r, i) => ({ r, w: Math.pow(0.6, rounds.length - 1 - i) })) : rounds.filter((r) => r.id === ST.round).map((r) => ({ r, w: 1 }));
  const sDir = new Map(); // 'a>b' → 점수(-2~2)
  const lastLv = new Map(); // 'a>b' → 가장 최근 단계
  if (useS) {
    const acc = new Map();
    chosen.forEach(({ r, w }) => { const d = ST.survey.data[r.id] || {}; Object.entries(d).forEach(([a, m]) => Object.entries(m || {}).forEach(([b, v]) => {
      if (!LV_SCORE.hasOwnProperty(v) || !idset.has(Number(a)) || !idset.has(Number(b))) return;
      const k = a + '>' + b, o = acc.get(k) || [0, 0]; o[0] += LV_SCORE[v] * w; o[1] += w; acc.set(k, o); lastLv.set(k, v);
    })); });
    acc.forEach(([sum, w], k) => sDir.set(k, sum / w));
  }
  // 누가기록 점수 L(a,b)
  const L = new Map(), pos = {}, neg = {}, pairPN = new Map();
  ids.forEach((i) => { pos[i] = 0; neg[i] = 0; });
  if (useL) ST.logs.forEach((l) => {
    (l._nums || []).forEach((n) => { if (l._tone > 0 && n in pos) pos[n]++; if (l._tone < 0 && n in neg) neg[n]++; });
    (l._pairs || new Map()).forEach((v, k) => {
      L.set(k, (L.get(k) || 0) + v);
      const o = pairPN.get(k) || [0, 0]; if (v > 0) o[0]++; if (v < 0) o[1]++; pairPN.set(k, o);
    });
  });
  const key = (a, b) => (a < b ? a + '-' + b : b + '-' + a);
  const rel = (a, b) => {
    const s1 = sDir.get(a + '>' + b), s2 = sDir.get(b + '>' + a);
    const sv = s1 == null && s2 == null ? null : ((s1 ?? s2) + (s2 ?? s1)) / 2;
    const lv = L.has(key(a, b)) ? 2 * Math.tanh(L.get(key(a, b)) / 1.5) : null;
    if (sv != null && lv != null) return 0.6 * sv + 0.4 * lv;
    return sv != null ? sv : lv;
  };
  const edges = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const r = rel(ids[i], ids[j]); if (r != null && r !== 0) edges.push({ a: ids[i], b: ids[j], r }); }
  return { ids, sDir, lastLv, L, pairPN, pos, neg, edges, rel, useS, useL, chosen };
}

function viewSociogram(redraw) {
  const roster = APP.roster(), W = 920, H = 600;
  const R = computeRel(), ids = R.ids;
  const thr = ST.thr;
  const posE = R.edges.filter((e) => e.r >= thr), negE = R.edges.filter((e) => e.r <= -thr);
  // 연결된 학생은 가운데에 힘 배치, 연결 없는 학생은 아래쪽에 가지런히 놓기
  const forceEdges = posE.map((e) => ({ a: e.a, b: e.b, w: e.r * 1.5 }));
  const touched = new Set(); [...posE, ...negE].forEach((e) => { touched.add(e.a); touched.add(e.b); });
  const conIds = ids.filter((i) => touched.has(i)), isoIds = ids.filter((i) => !touched.has(i));
  const perRow = Math.max(1, Math.floor((W - 40) / 58)), isoRows = Math.ceil(isoIds.length / perRow);
  const mainH = H - (isoRows ? isoRows * 56 + 24 : 0);
  const pos = conIds.length ? forceLayout(conIds, forceEdges, W, mainH) : {};
  isoIds.forEach((id, i) => { pos[id] = { x: 40 + (i % perRow) * 58, y: mainH + 30 + Math.floor(i / perRow) * 56 }; });

  // 학생별 요약
  const raters = new Set([...R.sDir.keys()].map((k) => Number(k.split('>')[0])));
  const hasSurvey = R.useS && raters.size >= Math.ceil(ids.length / 2);
  const st = {};
  ids.forEach((n) => {
    const rec = ids.filter((x) => x !== n && R.sDir.has(x + '>' + n)).map((x) => R.sDir.get(x + '>' + n));
    const good = rec.filter((v) => v >= 1.5).length, bad = rec.filter((v) => v <= -1).length;
    const mutual = ids.filter((x) => x !== n && (R.sDir.get(n + '>' + x) ?? -9) >= 1.5 && (R.sDir.get(x + '>' + n) ?? -9) >= 1.5).length;
    const avg = rec.length ? rec.reduce((a, b) => a + b, 0) / rec.length : null;
    const close = posE.filter((e) => e.a === n || e.b === n).length, conflict = negE.filter((e) => e.a === n || e.b === n).length;
    const flags = [];
    if (hasSurvey && rec.length) {
      if (bad >= Math.max(3, Math.ceil(rec.length * 0.2))) flags.push('싫어하는 친구가 많음');
      if (mutual === 0) flags.push('서로 좋아하는 친구 없음');
      if (avg < 0) flags.push('전반적으로 평가가 낮음');
    }
    if (R.useL && R.neg[n] >= 3 && R.neg[n] > R.pos[n]) flags.push('갈등 사건이 잦음');
    if ((hasSurvey || (R.useL && ST.logs.length >= 10)) && close === 0) flags.push('가까운 관계가 드러나지 않음');
    st[n] = { avg, good, bad, mutual, close, conflict, flags };
  });

  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, ...kids) => { const e = document.createElementNS(NS, tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); kids.forEach((c) => e.append(c)); return e; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sg' });
  const sel = ST.sel;
  const relOn = (e) => sel == null || e.a === sel || e.b === sel;
  const line = (e, attrs) => {
    const a = pos[e.a], b = pos[e.b]; if (!a || !b) return;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, r = 22;
    svg.append(el('line', { x1: a.x + (dx / d) * r, y1: a.y + (dy / d) * r, x2: b.x - (dx / d) * r, y2: b.y - (dy / d) * r, opacity: relOn(e) ? 0.9 : 0.08, ...attrs }));
  };
  posE.forEach((e) => line(e, { stroke: '#2f6fed', 'stroke-width': 1 + Math.min(e.r, 2) * 1.6 }));
  negE.forEach((e) => line(e, { stroke: '#e5484d', 'stroke-width': 1 + Math.min(-e.r, 2) * 1.4, 'stroke-dasharray': '6 4' }));
  const linked = new Set([sel]);
  [...posE, ...negE].forEach((e) => { if (e.a === sel) linked.add(e.b); if (e.b === sel) linked.add(e.a); });
  roster.forEach((s) => {
    const p = pos[s.num], flagged = st[s.num].flags.length > 0;
    const g = el('g', { class: 'sg-node', opacity: sel == null || linked.has(s.num) ? 1 : 0.25, style: 'cursor:pointer' },
      el('circle', { cx: p.x, cy: p.y, r: 22, fill: s.gender === '남' ? '#bcd6ff' : s.gender === '여' ? '#fbc3d3' : '#e5e7eb', stroke: sel === s.num ? '#1f2937' : flagged ? '#f59e0b' : '#fff', 'stroke-width': sel === s.num || flagged ? 3 : 2 }),
      (() => { const t = el('text', { x: p.x, y: p.y + 4, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600, fill: '#1f2937' }); t.textContent = s.name.length > 3 ? s.name.slice(0, 3) : s.name; return t; })(),
      (() => { const t = el('text', { x: p.x, y: p.y - 26, 'text-anchor': 'middle', 'font-size': 10, fill: '#6b7280' }); t.textContent = s.num; return t; })());
    g.addEventListener('click', () => { ST.sel = ST.sel === s.num ? null : s.num; redraw(); });
    svg.append(g);
  });

  const src = (k, label) => h('label', null, h('input', { type: 'checkbox', checked: ST.src[k], onchange: (e) => { ST.src[k] = e.target.checked; redraw(); } }), label);
  const rounds = ST.survey.main.rounds;
  const controls = h('div', { class: 'card' },
    h('div', { class: 'row radios', style: 'gap:14px;flex-wrap:wrap' },
      h('b', null, '분석 기준'), src('log', '누가기록 기반으로 관계 파악하기'), src('survey', '교우관계 조사 기반으로 관계 파악하기')),
    h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;margin-top:8px' },
      ST.src.survey ? h('span', null, '조사 ', h('select', { onchange: (e) => { ST.round = e.target.value; redraw(); } },
        h('option', { value: 'all', selected: ST.round === 'all' }, rounds.length > 1 ? '전체 조사 (최근 조사에 더 비중)' : '전체 조사'),
        rounds.map((r) => h('option', { value: r.id, selected: ST.round === r.id }, r.name)))) : null,
      h('span', null, '표시할 관계 ', h('select', { onchange: (e) => { ST.thr = Number(e.target.value); redraw(); } },
        [[1.5, '아주 강한 관계만'], [1, '뚜렷한 관계'], [0.5, '약한 관계까지']].map(([v, n]) => h('option', { value: v, selected: ST.thr === v }, n)))),
      h('span', { class: 'legend' }, h('i', { class: 'ln', style: 'background:#2f6fed' }), '가까운 관계', h('i', { class: 'ln dash' }), '갈등·멀어진 관계', h('i', { class: 'dot', style: 'background:#fff;border:3px solid #f59e0b' }), '살펴볼 학생')),
    h('div', { class: 'muted', style: 'margin-top:6px;line-height:1.6' },
      !ST.src.log && !ST.src.survey ? '분석 기준을 하나 이상 골라 주세요.'
        : '선이 굵을수록 관계가 강해요. 누가기록은 같은 사건에 나온 횟수가 아니라 사건의 성격(긍정·부정)으로 판단해요. 동그라미를 누르면 그 학생의 관계를 자세히 볼 수 있어요.'));

  // 분석표
  const cols = ['학생'].concat(R.useS ? ['받은 평가 평균', '좋음 받음', '싫음 받음', '서로 좋음'] : [], R.useL ? ['긍정 사건', '부정 사건'] : [], ['가까운 관계', '갈등 관계', '살펴볼 점']);
  const rows = roster.map((s) => { const x = st[s.num];
    return h('tr', { class: APP.gcls(s.gender), style: 'cursor:pointer', onclick: () => { ST.sel = s.num; redraw(); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
      h('td', null, `${s.num} ${s.name}`),
      R.useS ? [h('td', null, x.avg == null ? '-' : x.avg.toFixed(1)), h('td', null, x.good), h('td', null, x.bad), h('td', null, x.mutual)] : null,
      R.useL ? [h('td', null, R.pos[s.num]), h('td', null, R.neg[s.num])] : null,
      h('td', null, x.close), h('td', null, x.conflict),
      h('td', { style: 'text-align:left' }, x.flags.length ? h('b', { style: 'color:var(--danger)' }, x.flags.join(', ')) : ''));
  });
  const table = h('div', { class: 'card' }, h('h3', null, '관계 요약'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'roster survey' }, h('thead', null, h('tr', null, cols.map((t) => h('th', null, t)))), h('tbody', null, rows))),
    h('div', { class: 'muted', style: 'margin-top:6px;line-height:1.6' },
      (R.useS ? '받은 평가 평균: 좋음 +2, 친해지고 싶음 +1, 그저 그럼 0, 싫음 -2. ' : '') +
      (R.useS && !hasSurvey ? '조사를 절반 이상 입력하면 조사 기준 "살펴볼 점"이 표시돼요. ' : '') + '표시는 참고용이에요. 판단은 선생님이 직접 해 주세요.'));

  // 선택한 학생 자세히
  let detail = null;
  if (sel != null && ids.includes(sel)) {
    const lvName = (v) => (LEVELS.find((x) => x[0] === v) || [0, '-'])[1];
    const lvTag = (v) => v ? h('span', { class: 'lv-tag', style: `--c:${LEVELS.find((x) => x[0] === v)[2]}` }, lvName(v)) : h('span', { class: 'muted' }, '-');
    const others = roster.filter((f) => f.num !== sel).map((f) => ({ f, r: R.rel(sel, f.num) })).sort((a, b) => (b.r ?? -0.001) - (a.r ?? -0.001));
    const k = (a, b) => (a < b ? a + '-' + b : b + '-' + a);
    const relRows = others.filter((o) => o.r != null).map(({ f, r }) => { const pn = R.pairPN.get(k(sel, f.num)) || [0, 0];
      return h('tr', { class: APP.gcls(f.gender) }, h('td', null, `${f.num} ${f.name}`),
        R.useS ? [h('td', null, lvTag(R.lastLv.get(sel + '>' + f.num))), h('td', null, lvTag(R.lastLv.get(f.num + '>' + sel)))] : null,
        R.useL ? [h('td', null, pn[0] || ''), h('td', null, pn[1] || '')] : null,
        h('td', null, h('b', { style: `color:${r >= 0.5 ? '#2f6fed' : r <= -0.5 ? 'var(--danger)' : 'inherit'}` }, r >= 1.5 ? '아주 가까움' : r >= 0.5 ? '가까움' : r <= -1.5 ? '갈등 큼' : r <= -0.5 ? '갈등' : '보통')));
    });
    const evs = R.useL ? sortedLogs('desc').filter((l) => l._nums.includes(sel)) : [];
    detail = h('div', { class: 'card' }, h('h3', null, `${sel}번 ${stuName(sel)} 학생`),
      st[sel].flags.length ? h('div', { class: 'banner warn', style: 'margin-bottom:8px' }, '살펴볼 점: ' + st[sel].flags.join(', ')) : null,
      relRows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'roster survey' },
        h('thead', null, h('tr', null, ['친구'].concat(R.useS ? ['이 학생이 준 평가', '친구에게 받은 평가'] : [], R.useL ? ['긍정 사건', '부정 사건'] : [], ['종합']).map((t) => h('th', null, t)))),
        h('tbody', null, relRows))) : h('div', { class: 'muted' }, '드러난 관계가 없어요.'),
      R.useS && R.chosen.length > 1 ? h('div', { class: 'muted', style: 'margin-top:4px' }, '평가는 가장 최근 조사 기준으로 보여 줘요.') : null,
      evs.length ? [h('h3', { style: 'margin-top:14px' }, `관련 사건 ${evs.length}건`), evs.map((l) => logItem(l, '', redraw, false))] : null);
  }
  return h('div', null, controls, h('div', { class: 'card' }, svg), detail, table);
}
})();
