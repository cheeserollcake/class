/* 학생 관리: 누가기록 입력 / 사건 검색 / 교우관계도 */
(() => {
'use strict';
const APP = window.APP;
const { S, h, api, toast, errMsg, kvGet } = APP;

const ST = { sub: 'input', logs: null, survey: null, date: null, text: '', editId: null,
  kw: '', stu: '', order: 'desc', gsub: 'graph', src: { log: true, survey: true }, round: 'all', thr: 1, sel: null,
  tone: '', svRound: null, rater: null, pairEdit: {}, open: { sum: true, det: true, ev: true } };
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
/* 키보드 숫자 = 값: 1 싫음, 2 그저 그럼, 3 친해지고 싶음, 4 좋음 */
const LEVELS = [[1, '싫음', '#e5484d'], [2, '그저 그럼', '#3b82f6'], [3, '친해지고 싶음', '#eab308'], [4, '좋음', '#22a06b']];
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
/* ---------- 사건 속 학생 쌍별 관계 (규칙 기반 분석) ----------
   예) "철수와 영희가 다퉜다" → 철수–영희 부정 / "길동이가 영희 편을 들었다" → 길동–영희 긍정
       "영희와 길동이는 철수를 몰아갔다" → 영희–철수, 길동–철수 부정, 영희–길동 같은 편(긍정)
       "길순이가 셋의 이야기를 들어주고 둘 사이를 달랬다" → 길순–(셋) 긍정 */
const KW = [
  ['mneg', /(다투|다퉜|다툼|싸우|싸웠|싸움|의견 ?충돌|갈등|말다툼|언성|신경전|시비)/g, -1],
  ['neg', /(몰아|놀리|놀렸|놀려|때리|때렸|때려|밀치|밀쳤|밀쳐|괴롭|따돌|비난|욕을|욕했|무시|탓을|탓했|뺏|빼앗|째려|노려|비웃|험담|고자질|이간)/g, -1],
  ['sup', /(편을 ?들|편들|도와|도왔|도움을 ?주|위로|챙겨|감싸|응원|양보|빌려 ?주|칭찬|격려)/g, 1],
  ['med', /(중재|달래|말리|말렸|말려|화해시|이야기를 ?들어|얘기를 ?들어|들어 ?주|진정시)/g, 0.5],
  ['mpos', /(함께 놀|같이 놀|사이좋|사이가 좋|협력|협동|화해|사과|어울려|어울리|친해)/g, 1]
];
const PRON = /(둘|셋|넷|세 ?명|두 ?명|네 ?명|모두|다들|그들|이들|서로)/g;
function roleAt(text, end) {
  let t = text.slice(end, end + 8);
  if (/^이(가|는|도|를|와|랑|의|에게|한테)/.test(t)) t = t.slice(1);   // 길동이가, 철수이와(드묾)
  if (/^(이는|이가)/.test(t)) t = t.slice(1);
  if (/^\s*(의\s*)?편/.test(t)) return 'tgt';
  if (/^(은|는)/.test(t)) return 'topic';
  if (/^(가|도|이)(\s|$|,)/.test(t) || /^가/.test(t)) return 'subj';
  if (/^(를|을)/.test(t)) return 'obj';
  if (/^(와|과|랑|하고|이랑)/.test(t)) return 'with';
  if (/^(에게|한테|께)/.test(t)) return 'tgt';
  if (/^(의)/.test(t)) return /^의\s*(편|이야기|얘기|말|사이|마음)/.test(t) ? 'tgt' : 'poss';
  if (/^\s*사이/.test(t)) return 'tgt';
  return 'none';
}
function pairEngine(content, al) {
  const out = new Map(), ctx = [];   // ctx: 지금까지 나온 학생(순서대로)
  let last2 = [];
  const add = (a, b, v) => { if (a === b || !v) return; const k = a < b ? a + '-' + b : b + '-' + a; out.set(k, (out.get(k) || 0) + v); };
  const sents = String(content).split(/(?<=[.!?。\n])|(?<=[가-힣][함음됨임다])\s+/).map((x) => x.trim()).filter(Boolean);
  sents.forEach((t) => {
    const sp = findStudents(t, al).spans.map((x) => ({ start: x.start, end: x.end, nums: x.nums, role: roleAt(t, x.end) }));
    // 대명사(둘이, 셋의, 둘 사이 …)를 앞에 나온 학생들로 바꾸기
    let m; PRON.lastIndex = 0;
    while ((m = PRON.exec(t))) {
      if (sp.some((x) => m.index >= x.start && m.index < x.end)) continue;
      const before = [...new Set(sp.filter((x) => !x.pron && x.start < m.index).flatMap((x) => x.nums))];
      const w = m[1].replace(/\s/g, ''), nums = w === '둘' || w === '두명' ? (before.length >= 2 ? before.slice(-2) : last2.slice(-2)) : w === '셋' || w === '세명' ? ctx.slice(-3) : w === '넷' || w === '네명' ? ctx.slice(-4) : w === '서로' ? null : ctx.slice();
      if (!nums || nums.length < 2) continue;
      sp.push({ start: m.index, end: m.index + m[0].length, nums, role: roleAt(t, m.index + m[0].length), pron: true });
    }
    sp.sort((x, y) => x.start - y.start);
    // "A와 B가" → 한 무리(역할은 마지막 이름의 것)
    const groups = [];
    sp.forEach((x) => {
      const g = groups[groups.length - 1];
      if (g && g.role === 'with' && x.start - g.end <= 3) { g.nums = [...new Set([...g.nums, ...x.nums])]; g.end = x.end; g.role = x.role; }
      else groups.push({ ...x, nums: x.nums.slice() });
    });
    const inSent = [...new Set(groups.flatMap((g) => g.nums))];
    const each = (A, B, v) => A.forEach((a) => B.forEach((b) => add(a, b, v)));
    const within = (A, v) => { for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) add(A[i], A[j], v); };
    const mutual = /서로/.test(t);
    let fired = false;
    KW.forEach(([type, re, w]) => {
      re.lastIndex = 0; let k;
      while ((k = re.exec(t))) {
        const ks = k.index, ke = ks + k[0].length;
        if (/^[가-힣]{0,4}\s?(않|못|안 )/.test(t.slice(ke, ke + 8))) continue;   // ~지 않았다
        // 주어 찾기: "중재하던 길동이가"처럼 바로 뒤에 꾸밈을 받는 주어 → 문장 앞쪽의 "~는/은" → 가장 가까운 "~이/가"
        let subj = groups.find((g) => g.start >= ke && g.start - ke <= 10 && (g.role === 'subj' || g.role === 'topic') && /(던|는|한|던\s|는\s|한\s)\s*$/.test(t.slice(ke, g.start)));
        const rel = !!subj;
        if (!subj) subj = groups.find((g) => g.role === 'topic' && g.start < ks) || groups.filter((g) => g.role === 'subj' && g.start < ks).pop();
        const S = subj ? subj.nums : [];
        const tg = groups.filter((g) => g !== subj && (rel ? g.start > subj.end : (!subj || g.start > subj.start) && g.start < ks) && ['obj', 'tgt', 'with', 'poss'].includes(g.role)).flatMap((g) => g.nums).filter((n) => !S.includes(n));
        if (type === 'mneg' || type === 'mpos') {
          const P = [...new Set([...S, ...tg])];
          if (P.length >= 2) { within(P, w); fired = true; }
        } else if (type === 'neg') {
          if (S.length && tg.length) { each(S, tg, w); within(S, 0.5); fired = true; }
          else if (mutual && S.length >= 2) { within(S, w); fired = true; }
        } else if (type === 'sup') {
          if (S.length && tg.length) { each(S, tg, w); fired = true; }
          else if (mutual && S.length >= 2) { within(S, w); fired = true; }
        } else if (type === 'med' && S.length) {
          const T = tg.length ? tg : inSent.filter((n) => !S.includes(n));
          if (T.length) { each(S, T, w); fired = true; }
        }
      }
    });
    // 규칙에 안 걸린 단순한 문장(두 명): 문장 전체 분위기를 약하게
    if (!fired && inSent.length === 2) { const sc = sentenceTone(t); if (Math.abs(sc) >= 0.5) add(inSent[0], inSent[1], Math.sign(sc) * 0.5); }
    groups.forEach((g) => g.nums.forEach((n) => { const i = ctx.indexOf(n); if (i >= 0) ctx.splice(i, 1); ctx.push(n); }));
    const named = [...new Set(sp.filter((x) => !x.pron).flatMap((x) => x.nums))];
    const big = groups.filter((g) => !g.pron && g.nums.length >= 2).pop();
    if (big) last2 = big.nums.slice(-2); else if (named.length >= 2) last2 = named.slice(-2);
  });
  out.forEach((v, k) => out.set(k, Math.max(-1, Math.min(1, v))));
  return out;
}
const PAIR_V = { 1: 1, 0: 0, '-1': -1 };
APP._pairTest = (text) => [...pairEngine(text, buildAliases()).entries()].map(([k, v]) => k.split('-').map((n) => stuName(n)).join('–') + ' ' + v);   // 시험용
function analyzeLog(l, al) {
  const sents = String(l.content).split(/(?<=[.!?。\n])|(?<=[가-힣][함음됨임다])\s+/).map((x) => x.trim()).filter(Boolean);
  const total = sents.reduce((a, t) => a + sentenceTone(t), 0);
  const manual = l.tone && l.tone in TONE_OF;
  const tone = manual ? TONE_OF[l.tone] : Math.abs(total) < 0.5 ? 0 : Math.sign(total);
  const auto = pairEngine(l.content, al), pairs = new Map(auto);
  // 선생님이 직접 정한 관계가 우선
  Object.entries(l.pairs || {}).forEach(([k, v]) => { if (v in PAIR_V) { if (PAIR_V[v]) pairs.set(k, PAIR_V[v]); else pairs.delete(k); } });
  return { tone, auto: !manual, pairs, autoPairs: auto };
}
function annotate() {
  const al = buildAliases();
  ST.logs.forEach((l) => { const r = findStudents(l.content, al); l._nums = r.nums; l._spans = r.spans; l._amb = r.ambiguous; const a = analyzeLog(l, al); l._tone = a.tone; l._auto = a.auto; l._pairs = a.pairs; });
}
const sortedLogs = (dir) => ST.logs.slice().sort((a, b) => (a.date === b.date ? a.created - b.created : a.date < b.date ? -1 : 1) * (dir === 'asc' ? 1 : -1));

/* ---------- 평어 생성용: 학생별 관계·사건 요약 (다른 학생 이름은 담지 않음) ---------- */
APP.studentInsights = async () => {
  await ensure(); annotate();
  const keep = { src: ST.src, round: ST.round, thr: ST.thr };
  ST.src = { log: true, survey: true }; ST.round = 'all'; ST.thr = 1;
  let R; try { R = computeRel(); } finally { Object.assign(ST, keep); }
  const out = {};
  R.ids.forEach((n) => {
    const rec = R.ids.filter((x) => x !== n && R.sDir.has(x + '>' + n)).map((x) => R.sDir.get(x + '>' + n));
    const mutual = R.ids.filter((x) => x !== n && (R.sDir.get(n + '>' + x) ?? -9) >= 1.5 && (R.sDir.get(x + '>' + n) ?? -9) >= 1.5).length;
    const close = R.edges.filter((e) => (e.a === n || e.b === n) && e.r >= 1).length, conflict = R.edges.filter((e) => (e.a === n || e.b === n) && e.r <= -1).length;
    const logs = ST.logs.filter((l) => (l._nums || []).includes(n)).map((l) => ({ text: l.content, tone: l._tone }));
    out[n] = { received: rec.length ? rec.reduce((a, b) => a + b, 0) / rec.length : null, raters: rec.length, good: rec.filter((v) => v >= 1.5).length, bad: rec.filter((v) => v <= -1).length, mutual, close, conflict, pos: R.pos[n] || 0, neg: R.neg[n] || 0, logs };
  });
  return out;
};

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
    drawTone(); drawPairs();
  };
  const pairBox = h('div', { class: 'pair-box' });
  const drawPairs = () => {
    const r = findStudents(ta.value, al), nums = r.nums;
    if (nums.length < 2) { pairBox.replaceChildren(); return; }
    const auto = pairEngine(ta.value, al), ed = ST.pairEdit, keys = [];
    for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) keys.push(nums[i] + '-' + nums[j]);
    const show = keys.length <= 15 ? keys : keys.filter((k) => auto.get(k) || k in ed);
    const eff = (k) => (k in ed ? PAIR_V[ed[k]] : Math.sign(auto.get(k) || 0));
    pairBox.replaceChildren(h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'muted' }, '학생 사이 관계 (자동으로 분석했어요. 틀리면 눌러서 고치세요)'),
      Object.keys(ed).length ? h('button', { class: 'sm ghost', onclick: () => { ST.pairEdit = {}; drawPairs(); } }, '모두 자동으로') : null),
      ...show.map((k) => { const [a, b] = k.split('-'), v = eff(k), manual = k in ed;
        return h('div', { class: 'pair-row' }, h('span', { class: 'pair-nm' }, `${stuName(a)} – ${stuName(b)}`),
          ...[[1, '긍정'], [0, '중립'], [-1, '부정']].map(([x, n]) => h('button', { type: 'button', class: 'sm pair-btn' + (v === x ? ' on v' + x : ''), onclick: () => { ed[k] = x; drawPairs(); } }, n)),
          h('span', { class: 'muted pair-src' }, manual ? '직접' : '자동')); }));
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
    const log = { id: old ? old.id : 'l' + Date.now().toString(36), date: ST.date, content, names: r.nums.map(stuName).join(', '), created: old ? old.created : Date.now(), tone: ST.tone,
      pairs: Object.fromEntries(Object.entries(ST.pairEdit).filter(([k]) => k.split('-').every((n) => r.nums.includes(Number(n))))) };
    saveBtn.disabled = true;
    try {
      await api('logSave', { log });
      if (old) Object.assign(old, log); else ST.logs.push(log);
      ST.text = ''; ST.editId = null; ST.tone = ''; ST.pairEdit = {}; toast('누가기록을 저장했습니다 (구글 시트에도 기록됨)'); redraw();
    } catch (e) { toast(errMsg(e), true); saveBtn.disabled = false; }
  } }, ST.editId ? '수정 저장' : '기록하기');

  const recent = sortedLogs('desc').slice(0, 12);
  return h('div', null,
    h('div', { class: 'card' },
      h('div', { class: 'row gap' }, h('label', { class: 'muted' }, '날짜'), dateIn,
        h('button', { class: 'sm ghost', onclick: () => { ST.date = APP.today(); redraw(); } }, '오늘'),
        ST.editId ? h('span', { class: 'banner', style: 'margin:0;padding:4px 10px' }, '기록을 수정하는 중입니다') : null),
      ta, chips, warn, toneRow, pairBox,
      h('div', { class: 'row', style: 'margin-top:10px;justify-content:flex-end' },
        ST.editId ? h('button', { onclick: () => { ST.editId = null; ST.text = ''; ST.tone = ''; ST.pairEdit = {}; redraw(); } }, '수정 취소') : null, saveBtn)),
    h('details', { class: 'card fold', open: ST.open.recent ? '' : null, ontoggle: (e) => { ST.open.recent = e.target.open; } }, h('summary', null, h('h3', null, `최근 기록 (${ST.logs.length}건 중 ${recent.length}건)`)),
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
          h('button', { class: 'sm ghost', onclick: () => { ST.editId = l.id; ST.text = l.content; ST.date = l.date; ST.tone = l.tone || ''; ST.pairEdit = { ...(l.pairs || {}) }; ST.sub = 'input'; redraw(); window.scrollTo(0, 0); } }, '수정'),
          h('button', { class: 'sm ghost', onclick: async () => {
            if (!confirm('이 기록을 삭제할까요?')) return;
            try { await api('logDel', { id: l.id }); ST.logs = ST.logs.filter((x) => x.id !== l.id); redraw(); } catch (e) { toast(errMsg(e), true); }
          } }, '삭제')] : null)),
    h('div', { class: 'log-text' }, highlighted(l.content, l._spans || [], kw)),
    l._pairs && l._pairs.size ? h('div', { class: 'pair-chips' }, [...l._pairs.entries()].map(([k, v]) => { const [a, b] = k.split('-'); return h('span', { class: 'pair-chip ' + (v > 0 ? 'p' : 'n') }, `${stuName(a)}–${stuName(b)} ${v > 0 ? '긍정' : '부정'}`); })) : null);
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
      h('span', { class: 'lv-group' }, LEVELS.map(([v, n, c]) => h('button', { type: 'button', tabindex: -1, class: 'lv' + (mine[f.num] === v ? ' on' : ''), 'data-v': v, style: `--c:${c}`, title: `키보드 ${v}`, onclick: () => { setV(f, v, row); row.focus(); } }, `${v} ${n}`))));
    row.addEventListener('keydown', (e) => {
      const k = Number(e.key);
      if (k >= 1 && k <= 4) { e.preventDefault(); mine[f.num] = undefined; setV(f, k, row); (rowsEl[i + 1] || row).focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); (rowsEl[i + 1] || row).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (rowsEl[i - 1] || row).focus(); }
      else if (e.key === 'Enter' && i === friends.length - 1) { e.preventDefault(); go(1); }
    });
    rowsEl.push(row);
  });
  const cnt = h('span', { class: 'muted' }, `${done(me.num)}/${need}명 평가함`);
  box.append(h('h3', null, '교우관계 조사 입력'), head,
    h('div', { class: 'muted', style: 'margin:10px 0;line-height:1.7' }, '평가한 학생을 고른 뒤, 친구마다 4단계 중 하나를 누르세요. 키보드 숫자(1 싫음 · 2 그저 그럼 · 3 친해지고 싶음 · 4 좋음)로 입력하면 다음 친구로 넘어가요. (↑↓ 이동, 같은 칸을 다시 누르면 지워져요) 자동 저장돼요.'),
    nav,
    h('div', { class: 'row', style: 'justify-content:space-between;margin:10px 0 6px' }, h('b', null, `${me.num}번 ${me.name} 학생의 평가`), cnt,
      h('button', { class: 'sm danger', onclick: () => {
        if (!done(me.num)) return toast(`${me.name} 학생은 아직 입력한 기록이 없어요`);
        if (!confirm(`${me.name} 학생이 친구들을 평가한 기록 ${done(me.num)}개를 모두 지울까요?`)) return;
        delete data[me.num]; saveSurveyLater(round.id); toast(`${me.name} 학생의 기록을 지웠어요`); redraw();
      } }, '이 학생 기록 삭제')),
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


/* ---------- 조사 회차별 추이 ---------- */
function roundsOrdered() {
  return ST.survey.main.rounds.map((x, i) => ({ x, i })).sort((a, b) => (a.x.date || '').localeCompare(b.x.date || '') || a.i - b.i).map((o) => o.x);
}
const lvAt = (r, a, b) => { const v = ((ST.survey.data[r.id] || {})[a] || {})[b]; return LV_SCORE.hasOwnProperty(v) ? LV_SCORE[v] : null; };
const pairSeries = (a, b) => roundsOrdered().map((r) => lvAt(r, a, b));
function slopeOf(vals) {
  const p = vals.map((v, i) => [i, v]).filter((x) => x[1] != null);
  if (p.length < 2) return null;
  const mx = p.reduce((s, x) => s + x[0], 0) / p.length, my = p.reduce((s, x) => s + x[1], 0) / p.length;
  const num = p.reduce((s, x) => s + (x[0] - mx) * (x[1] - my), 0), den = p.reduce((s, x) => s + (x[0] - mx) ** 2, 0);
  // 회차 간격 대신 "처음→마지막" 전체 변화량으로 환산
  return den ? (num / den) * (p[p.length - 1][0] - p[0][0]) : 0;
}
const meanOf = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
/* 추이를 꺾은선 화살표로: 좋아지면 오른쪽 위, 나빠지면 오른쪽 아래, 비슷하면 – */
function trendMark(vals) {
  const v = vals.filter((x) => x != null);
  if (v.length < 2) return null;
  if (Math.max(...v) - Math.min(...v) < 0.5) return h('span', { class: 'tr-flat', title: '비슷함' }, '–');
  const NS = 'http://www.w3.org/2000/svg', W = Math.min(64, 12 + 12 * (v.length - 1)), H = 18;
  const xs = v.map((_, i) => 2 + (i * (W - 8)) / (v.length - 1)), ys = v.map((x) => H - 3 - ((x + 2) / 4) * (H - 6));
  const d = v[v.length - 1] - v[0], col = d > 0.25 ? '#16a34a' : d < -0.25 ? '#dc2626' : '#6b7280';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('class', 'tr-svg');
  const pl = document.createElementNS(NS, 'polyline'); pl.setAttribute('points', xs.map((x, i) => `${x},${ys[i]}`).join(' '));
  pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', col); pl.setAttribute('stroke-width', '1.8'); pl.setAttribute('stroke-linejoin', 'round'); svg.append(pl);
  const n = v.length - 1, ang = Math.atan2(ys[n] - ys[n - 1], xs[n] - xs[n - 1]), L = 5;
  const tip = [xs[n], ys[n]], p1 = [tip[0] - L * Math.cos(ang - 0.5), tip[1] - L * Math.sin(ang - 0.5)], p2 = [tip[0] - L * Math.cos(ang + 0.5), tip[1] - L * Math.sin(ang + 0.5)];
  const head = document.createElementNS(NS, 'polygon'); head.setAttribute('points', `${tip.join(',')} ${p1.join(',')} ${p2.join(',')}`); head.setAttribute('fill', col); svg.append(head);
  const t = document.createElementNS(NS, 'title'); t.textContent = '회차별: ' + v.map((x) => ({ 2: '좋음', 1: '친해지고 싶음', 0: '그저 그럼', '-2': '싫음' }[x] || x)).join(' → '); svg.append(t);
  return svg;
}
const trendWord = (sl) => (sl == null ? '' : sl >= 0.6 ? '점점 좋아짐' : sl <= -0.6 ? '점점 나빠짐' : '비슷하게 유지');
function modal(title, ...body) {
  const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) ov.remove(); } },
    h('div', { class: 'modal rel-modal' }, h('h3', null, title), h('div', { class: 'rel-body' }, ...body),
      h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:12px' }, h('button', { class: 'primary', onclick: () => ov.remove() }, '닫기'))));
  document.body.append(ov);
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

/* 학급 전체 분석 */
function classReport(R, st, ids, hasSurvey) {
  const gOf = (x) => (stuOf(x) || {}).gender, nm = (n) => stuName(n);
  const rounds = roundsOrdered(), secs = [];
  const sec = (title, ...items) => secs.push(h('div', { class: 'rel-sec' }, h('h4', null, title), ...items));
  const li = (t, cls) => h('li', { class: cls || '' }, t);
  // 1. 전반 상태와 변화
  if (R.useS && rounds.length) {
    const per = rounds.map((r) => { const v = []; ids.forEach((a) => ids.forEach((b) => { if (a !== b) { const x = lvAt(r, a, b); if (x != null) v.push(x); } })); return { r, avg: meanOf(v), n: v.length, dis: v.filter((x) => x < 0).length / (v.length || 1) }; }).filter((x) => x.n);
    const last = per[per.length - 1], first = per[0];
    const mood = (a) => (a >= 0.9 ? '아주 좋음' : a >= 0.4 ? '대체로 좋음' : a >= 0 ? '보통' : '좋지 않음');
    const items = [li(`조사 ${per.length}회 · 가장 최근(${last.r.name}) 학급 평균 ${last.avg.toFixed(2)}점 → 분위기 ${mood(last.avg)} ("싫음" 비율 ${Math.round(last.dis * 100)}%)`)];
    if (per.length >= 2) {
      const d = last.avg - first.avg;
      items.push(li(`첫 조사보다 평균이 ${d >= 0 ? '+' : ''}${d.toFixed(2)}점 ${Math.abs(d) < 0.15 ? '— 큰 변화 없음' : d > 0 ? '— 관계가 좋아지는 중' : '— 관계가 나빠지는 중'}`, d <= -0.15 ? 'bad' : d >= 0.15 ? 'good' : ''));
      const prevR = per[per.length - 2].r; let up = 0, down = 0;
      ids.forEach((n) => { const a = meanOf(ids.filter((x) => x !== n).map((x) => lvAt(prevR, x, n))), b = meanOf(ids.filter((x) => x !== n).map((x) => lvAt(last.r, x, n))); if (a != null && b != null) { if (b - a >= 0.4) up++; if (b - a <= -0.4) down++; } });
      items.push(li(`직전 조사와 비교: 받은 평가가 오른 학생 ${up}명, 내려간 학생 ${down}명`));
    }
    sec('학급 분위기', h('ul', { class: 'rel-list' }, items));
    // 2. 남녀 관계
    const cs = (r, same) => { const v = []; ids.forEach((a) => ids.forEach((b) => { if (a !== b && gOf(a) && gOf(b) && (gOf(a) === gOf(b)) === same) { const x = lvAt(r, a, b); if (x != null) v.push(x); } })); return v; };
    const sv = cs(last.r, true), xv = cs(last.r, false);
    if (sv.length && xv.length) {
      const sa = meanOf(sv), xa = meanOf(xv), xd = xv.filter((x) => x < 0).length / xv.length, sd = sv.filter((x) => x < 0).length / sv.length;
      const conflict = xa < -0.2 || (xd >= 0.3 && xd > sd * 1.8);
      const g = [li(`같은 성별끼리 평균 ${sa.toFixed(2)}점 ("싫음" ${Math.round(sd * 100)}%) / 다른 성별끼리 평균 ${xa.toFixed(2)}점 ("싫음" ${Math.round(xd * 100)}%)`)];
      g.push(li(conflict ? '남녀 사이 관계가 같은 성별 사이보다 뚜렷하게 나빠요. 남녀 갈등이 있는지 살펴볼 필요가 있어요.' : xa < sa - 0.6 ? '남녀가 서로 덜 친한 편이지만 갈등 수준은 아니에요.' : '남녀 사이 관계가 크게 나쁘지 않아요.', conflict ? 'bad' : ''));
      if (per.length >= 2) { const xf = meanOf(cs(first.r, false)); if (xf != null) { const d = xa - xf; if (Math.abs(d) >= 0.15) g.push(li(`남녀 사이 평가가 첫 조사보다 ${d > 0 ? '좋아졌어요' : '나빠졌어요'} (${d > 0 ? '+' : ''}${d.toFixed(2)}점)`, d < 0 ? 'bad' : 'good')); } }
      sec('남녀 관계', h('ul', { class: 'rel-list' }, g));
    }
  }
  // 3. 위기 관계
  const iso = ids.filter((n) => st[n].flags.includes('고립 우려'));
  const disliked = ids.filter((n) => st[n].flags.includes('싫어하는 친구가 많음'));
  const worse = ids.filter((n) => st[n].flags.includes('관계가 점점 나빠지고 있음'));
  const conf = ids.filter((n) => st[n].flags.includes('갈등 사건이 잦음'));
  const noClose = ids.filter((n) => st[n].flags.includes('가까운 관계가 드러나지 않음') && !iso.includes(n));
  const bully = disliked.filter((n) => st[n].avg != null && st[n].avg < 0 && st[n].mutual === 0);
  const crisis = [];
  if (bully.length) crisis.push(li(`따돌림 우려 (많은 친구가 "싫음"으로 평가하고 서로 좋아하는 친구가 없음): ${bully.map(nm).join(', ')}`, 'bad'));
  if (iso.length) crisis.push(li(`고립 우려 (서로 좋아하는 친구·가까운 관계가 거의 없음): ${iso.map(nm).join(', ')}`, 'bad'));
  const dis2 = disliked.filter((n) => !bully.includes(n));
  if (dis2.length) crisis.push(li(`"싫음"을 많이 받은 학생: ${dis2.map(nm).join(', ')}`, 'bad'));
  if (worse.length) crisis.push(li(`관계가 점점 나빠지는 학생: ${worse.map(nm).join(', ')}`, 'bad'));
  if (conf.length) crisis.push(li(`누가기록에 갈등 사건이 잦은 학생: ${conf.map(nm).join(', ')}`, 'bad'));
  if (noClose.length) crisis.push(li(`가까운 관계가 드러나지 않은 학생: ${noClose.map(nm).join(', ')}`));
  if (!hasSurvey && R.useS) crisis.push(li('교우관계 조사를 학급의 절반 이상 입력하면 더 정확하게 분석할 수 있어요.'));
  sec('위기 관계', crisis.length ? h('ul', { class: 'rel-list' }, crisis) : h('div', { class: 'muted' }, '뚜렷한 위기 신호가 보이지 않아요.'));
  // 4. 관계의 중심
  const centers = ids.filter((n) => st[n].center);
  if (centers.length) sec('관계의 중심', h('ul', { class: 'rel-list' }, ['학급 관계의 중심', '여학생 관계의 중심', '남학생 관계의 중심'].map((c) => { const a = centers.filter((n) => st[n].center === c); return a.length ? li(`${c}: ${a.map(nm).join(', ')}`) : null; })),
    h('div', { class: 'muted' }, '친구들에게 "좋음"을 많이 받은 학생이에요. 모둠 구성이나 학급 활동에서 다른 학생들을 이어 주는 역할을 맡길 수 있어요.'));
  // 5. 제안
  const tips = [];
  if (bully.length || iso.length) tips.push('위기 신호가 있는 학생은 개별 상담으로 마음을 먼저 들어 보고, 필요하면 보호자·상담 선생님과 함께 살펴보세요.');
  if (iso.length || noClose.length) tips.push('모둠·짝 활동에서 성향이 맞는 친구나 관계의 중심인 학생과 함께하도록 배치해 보세요.');
  if (secs.some((x) => x.textContent.includes('남녀 갈등'))) tips.push('남녀가 함께하는 협동 활동을 늘리고, 서로 존중하는 말하기를 함께 이야기해 보세요.');
  if (worse.length) tips.push('관계가 나빠지는 학생은 최근 누가기록을 함께 살펴보세요.');
  if (tips.length) sec('도움이 될 만한 것', h('ul', { class: 'rel-list' }, tips.map((t) => li(t))));
  modal('학급 전체 분석', ...secs, h('div', { class: 'muted', style: 'margin-top:8px' }, '조사·기록을 바탕으로 한 참고 자료예요. 실제 판단은 선생님이 직접 관찰한 내용과 함께 해 주세요.'));
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
      if (mutual === 0) flags.push('서로 좋아하는 친구 없음');
      if (avg < 0) flags.push('전반적으로 평가가 낮음');
    }
    if (R.useL && R.neg[n] >= 3 && R.neg[n] > R.pos[n]) flags.push('갈등 사건이 잦음');
    if ((hasSurvey || (R.useL && ST.logs.length >= 10)) && close === 0) flags.push('가까운 관계가 드러나지 않음');
    // 받은 평가의 회차별 추이
    const recvSeries = R.useS ? roundsOrdered().map((r) => meanOf(ids.filter((x) => x !== n).map((x) => lvAt(r, x, n)))) : [];
    const sl = slopeOf(recvSeries);
    if (hasSurvey && sl != null && sl <= -0.6) flags.push('관계가 점점 나빠지고 있음');
    if (hasSurvey && rec.length && mutual === 0 && close === 0 && good <= 1) flags.push('고립 우려');
    st[n] = { avg, good, bad, mutual, close, conflict, flags, sl, recvSeries, center: '', nrec: rec.length };
  });
  // 학급 안에서 상대적으로 두드러지는 학생만 (모두가 비슷하면 표시하지 않음)
  if (hasSurvey) {
    const msd = (k) => { const v = ids.map((n) => st[n][k]); const m = v.reduce((a, b) => a + b, 0) / v.length; return [m, Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length)]; };
    const [mb, sb] = msd('bad'), [mg, sg] = msd('good'), gOf = (x) => (stuOf(x) || {}).gender;
    ids.forEach((n) => {
      const x = st[n];
      if (x.nrec && x.bad >= Math.max(3, Math.ceil(x.nrec * 0.2)) && x.bad >= mb + Math.max(sb, 1)) x.flags.unshift('싫어하는 친구가 많음');
      // 관계의 중심 (엄격하게)
      //  ① 받은 "좋음"이 4명 이상이고 학급 평균보다 표준편차 1.5배 이상 많음
      //  ② 서로 "좋음"인 친구가 2명 이상
      //  ③ 남학생(또는 여학생) 중 절반 이상에게 "좋음"을 받음 → 그 성별의 중심, 둘 다면 학급의 중심
      if (x.nrec && x.good >= Math.max(4, mg + 1.5 * Math.max(sg, 1)) && x.mutual >= 2) {
        const from = (g) => { const rs = ids.filter((y) => y !== n && gOf(y) === g && R.sDir.has(y + '>' + n)); const k = rs.filter((y) => R.sDir.get(y + '>' + n) >= 1.5).length; return { k, t: rs.length, r: rs.length >= 3 ? k / rs.length : 0 }; };
        const fm = from('남'), ff = from('여');
        x.center = fm.r >= 0.5 && ff.r >= 0.5 ? '학급 관계의 중심' : fm.r >= 0.5 ? '남학생 관계의 중심' : ff.r >= 0.5 ? '여학생 관계의 중심' : '';
        if (x.center) x.centerWhy = `"좋음"을 남학생 ${fm.t}명 중 ${fm.k}명, 여학생 ${ff.t}명 중 ${ff.k}명에게 받았어요 (학급 평균 ${mg.toFixed(1)}명). 서로 "좋음"인 친구 ${x.mutual}명.`;
      }
    });
  }

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
      h('td', { style: 'text-align:left' }, x.flags.length ? h('b', { style: 'color:var(--danger)' }, x.flags.join(', ')) : '', x.center ? h('span', { class: 'rel-center' }, x.center) : null));
  });
  const fold = (key, title, ...body) => h('details', { class: 'card fold', open: ST.open[key] ? '' : null, ontoggle: (e) => { ST.open[key] = e.target.open; } }, h('summary', null, h('h3', null, title)), ...body);
  const table = fold('sum', '관계 요약',
    h('div', { class: 'table-wrap' }, h('table', { class: 'roster survey' }, h('thead', null, h('tr', null, cols.map((t) => h('th', null, t)))), h('tbody', null, rows))),
    h('div', { class: 'muted', style: 'margin-top:6px;line-height:1.6' },
      (R.useS ? '받은 평가 평균: 좋음 +2, 친해지고 싶음 +1, 그저 그럼 0, 싫음 -2. ' : '') +
      (R.useS && !hasSurvey ? '조사를 절반 이상 입력하면 조사 기준 "살펴볼 점"이 표시돼요. ' : '') + '표시는 참고용이에요. 판단은 선생님이 직접 해 주세요.'));

  // 선택한 학생 자세히
  let detail = null;
  if (sel != null && ids.includes(sel)) {
    const lvName = (v) => (LEVELS.find((x) => x[0] === v) || [0, '-'])[1];
    const lvTag = (v) => v ? h('span', { class: 'lv-tag lv' + v, style: `--c:${LEVELS.find((x) => x[0] === v)[2]}` }, lvName(v)) : h('span', { class: 'muted' }, '-');
    const cellTr = (v, series) => { const m = trendMark(series); return h('td', null, h('span', { class: 'tr-cell' }, lvTag(v), m ? h('span', { class: 'tr-paren' }, '(', m, ')') : null)); };
    const others = roster.filter((f) => f.num !== sel).map((f) => ({ f, r: R.rel(sel, f.num) })).sort((a, b) => (b.r ?? -0.001) - (a.r ?? -0.001));
    const k = (a, b) => (a < b ? a + '-' + b : b + '-' + a);
    const relRows = others.filter((o) => o.r != null).map(({ f, r }) => { const pn = R.pairPN.get(k(sel, f.num)) || [0, 0];
      return h('tr', { class: APP.gcls(f.gender) }, h('td', null, `${f.num} ${f.name}`),
        R.useS ? [cellTr(R.lastLv.get(sel + '>' + f.num), pairSeries(sel, f.num)), cellTr(R.lastLv.get(f.num + '>' + sel), pairSeries(f.num, sel))] : null,
        R.useL ? [h('td', null, pn[0] || ''), h('td', null, pn[1] || '')] : null,
        h('td', null, h('b', { style: `color:${r >= 0.5 ? '#2f6fed' : r <= -0.5 ? 'var(--danger)' : 'inherit'}` }, r >= 1.5 ? '아주 가까움' : r >= 0.5 ? '가까움' : r <= -1.5 ? '갈등 큼' : r <= -0.5 ? '갈등' : '보통'),
          (() => { if (!R.useS) return null; const a = pairSeries(sel, f.num), b = pairSeries(f.num, sel); const w = trendWord(slopeOf(a.map((x, i) => meanOf([x, b[i]])))); return w ? h('div', { class: 'tr-word ' + (w.includes('좋아') ? 'up' : w.includes('나빠') ? 'down' : '') }, w) : null; })()));
    });
    const evs = R.useL ? sortedLogs('desc').filter((l) => l._nums.includes(sel)) : [];
    detail = h('div', null, fold('det', `${sel}번 ${stuName(sel)} 학생의 관계`,
      st[sel].flags.length ? h('div', { class: 'banner warn', style: 'margin-bottom:8px' }, '살펴볼 점: ' + st[sel].flags.join(', ')) : null,
      st[sel].center ? h('div', { class: 'banner', style: 'margin-bottom:8px' }, `${st[sel].center}: ${st[sel].centerWhy || ''}`) : null,
      relRows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'roster survey' },
        h('thead', null, h('tr', null, ['친구'].concat(R.useS ? ['이 학생이 준 평가', '친구에게 받은 평가'] : [], R.useL ? ['긍정 사건', '부정 사건'] : [], ['종합']).map((t) => h('th', null, t)))),
        h('tbody', null, relRows))) : h('div', { class: 'muted' }, '드러난 관계가 없어요.'),
      R.useS && ST.survey.main.rounds.length > 1 ? h('div', { class: 'muted', style: 'margin-top:4px' }, '평가는 가장 최근 조사 기준이에요. 괄호 안 꺾은선은 지금까지 조사한 회차별 변화예요. (초록: 좋아짐, 빨강: 나빠짐, –: 비슷함)') : null,
      st[sel].sl != null ? h('div', { class: 'muted', style: 'margin-top:2px' }, `친구들에게 받은 평가 평균의 변화: ${trendWord(st[sel].sl)}`) : null,
      ), evs.length ? fold('ev', `관련 사건 ${evs.length}건`, evs.map((l) => logItem(l, '', redraw, false))) : null);
  }
  const helpBtn = h('button', { class: 'sm', onclick: () => modal('관계도 보는 방법',
    h('ul', { class: 'rel-list' },
      h('li', null, '동그라미 하나가 학생 한 명이에요. 파랑은 남학생, 분홍은 여학생이에요.'),
      h('li', null, h('b', { style: 'color:#2f6fed' }, '파란 실선'), '은 가까운 관계, ', h('b', { style: 'color:#e5484d' }, '빨간 점선'), '은 갈등이나 멀어진 관계예요. 선이 굵을수록 관계가 강해요.'),
      h('li', null, '서로 가까운 학생들은 가운데로 모이고, 연결이 적은 학생은 바깥이나 아래쪽에 놓여요.'),
      h('li', null, h('b', { style: 'color:#f59e0b' }, '주황 테두리'), '는 "살펴볼 점"이 있는 학생이에요.'),
      h('li', null, '교우관계 조사는 좋음 +2, 친해지고 싶음 +1, 그저 그럼 0, 싫음 −2로 바꿔 계산해요. 조사가 여러 번이면 최근 조사를 더 무겁게 봐요.'),
      h('li', null, '누가기록은 같이 나온 횟수가 아니라 사건의 성격(긍정·부정)으로 반영해요.'),
      h('li', null, '"관계의 중심"은 ① "좋음"을 4명 이상, 학급 평균보다 눈에 띄게 많이 받고 ② 서로 "좋음"인 친구가 2명 이상이며 ③ 남학생(또는 여학생)의 절반 이상에게 "좋음"을 받은 학생이에요. 둘 다 절반 이상이면 학급 관계의 중심이에요.'),
      h('li', null, '학생을 누르면 친구별 평가와 회차별 변화(괄호 안 꺾은선 화살표)를 볼 수 있어요.'),
      h('li', null, '모든 분석은 참고용이에요. 학생을 직접 관찰한 선생님의 판단이 가장 정확해요.'))) }, '관계도 보는 방법');
  const classBtn = h('button', { class: 'sm primary', onclick: () => classReport(R, st, ids, hasSurvey) }, '학급 전체 분석');
  return h('div', null, controls, h('div', { class: 'card' }, svg, h('div', { class: 'row', style: 'gap:8px;margin-top:8px' }, helpBtn, classBtn)), detail, table);
}
})();
