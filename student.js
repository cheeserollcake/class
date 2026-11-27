/* 학생용 친구 설문: 선생님 사이트가 만든 QR 주소(#c=설정)로 열림.
   응답은 선생님 구글 설문지로 바로 보내고, 선생님 사이트가 가져가서 반영함. (서버 없음) */
(() => {
'use strict';
const $ = (s) => document.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => { if (v == null || v === false) return; if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'class') el.className = v; else el.setAttribute(k, v === true ? '' : v); });
  kids.flat(Infinity).forEach((c) => { if (c == null || c === false) return; el.append(c.nodeType ? c : String(c)); });
  return el;
}
let toastT = null;
const toast = (t) => { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); };

const CTX = [['l', '학습과제', '조사·발표·문제풀이를 함께 한다면'], ['p', '수행과제', '체육·음악·미술 활동을 함께 한다면'], ['u', '점심시간', '점심시간에 같이 논다면'], ['o', '학교 밖', '학교 밖에서 만나 놀러 간다면']];
const LV = [['좋음', '#22a06b'], ['친해지고 싶음', '#eab308', 'y'], ['그저 그럼', '#3b82f6'], ['싫음', '#e5484d']];
const MAX = 3;

function readCfg() {
  const m = location.hash.match(/[#&]c=([^&]+)/); if (!m) return null;
  try {
    const b = m[1].replace(/-/g, '+').replace(/_/g, '/'), bin = atob(b + '==='.slice((b.length + 3) % 4));
    const c = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (x) => x.charCodeAt(0))));
    return c && c.f && c.e && Array.isArray(c.s) ? c : null;
  } catch (e) { return null; }
}
const C = readCfg();
const app = $('#app');
if (!C) { app.replaceChildren(h('div', { class: 'center' }, h('h2', null, '설문 주소가 올바르지 않아요'), h('p', { class: 'muted' }, '선생님이 보여 준 QR을 다시 찍어 주세요.'))); return; }

const S = { me: null, pick: {}, lv: {}, step: 'me' };
CTX.forEach(([k]) => { S.pick[k + 'y'] = []; S.pick[k + 'n'] = []; });
const stu = C.s.map(([num, name, g]) => ({ num, name, g }));
const label = (s) => `${s.num} ${s.name}`;
const KEY = 'friend_survey_' + C.f;
const others = () => stu.filter((s) => s.num !== S.me);
const MIN = () => Math.max(1, Math.min(C.m || 1, MAX, Math.floor(others().length / 2) || 1));
/* 이 기기에서 낸 번호 + 선생님 사이트가 적어 둔 제출 현황(공개 시트, 번호만) */
const localSent = () => { try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter((x) => typeof x === 'number' && x < 1000) : []; } catch (e) { return []; } };
async function remoteSent() {
  if (!C.k) return [];
  try {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(C.k)}/gviz/tq?tqx=out:csv&range=A1&t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return [];
    return (await r.text()).replace(/"/g, '').split(/[^\d]+/).filter(Boolean).map(Number);
  } catch (e) { return []; }
}

function cell(s, on, opp, onclick) {
  return h('button', { type: 'button', class: 'cell ' + (s.g || '') + (on ? ' on' : '') + (opp ? ' opp' : ''), onclick }, h('small', null, s.num), s.name);
}
function render() {
  window.scrollTo({ top: 0 });
  if (S.step === 'sent') {
    app.replaceChildren(h('div', { class: 'done' }, h('div', { class: 'big' }, '🎉'), h('h2', null, '제출했어요!'), h('p', { class: 'muted' }, '솔직하게 답해 줘서 고마워요.'),
      h('button', { class: 'btn', style: 'margin-top:16px', onclick: () => { S.step = 'me'; S.me = null; render(); } }, '처음으로')));
    return;
  }
  const head = h('div', { class: 'head' }, h('h1', null, C.t || '친구 설문'), h('p', null, '정답은 없어요. 내 생각대로 솔직하게 골라 주세요. 내가 고른 내용은 선생님만 볼 수 있어요.'));
  if (S.step === 'me') {
    app.replaceChildren(head, h('div', { class: 'sec me' }, h('h2', null, '내 이름을 눌러요'), h('div', { class: 'd' }, '내 번호와 이름을 찾아 눌러요.'),
      h('div', { class: 'cells' }, stu.map((s) => cell(s, S.me === s.num, false, () => { S.me = s.num; render(); })))),
      h('div', { class: 'bar' }, h('button', { class: 'btn primary', disabled: S.me == null, onclick: async (e) => {
        e.currentTarget.disabled = true; e.currentTarget.textContent = '확인하는 중…';
        const done = localSent().includes(S.me) || (await remoteSent()).includes(S.me);
        S.step = done ? 'blocked' : 'confirm'; render();
      } }, S.me == null ? '이름을 골라 주세요' : `${stu.find((x) => x.num === S.me).name}(으)로 설문 시작하기`)));
    return;
  }
  if (S.step === 'confirm' || S.step === 'blocked') {
    const me0 = stu.find((x) => x.num === S.me);
    app.replaceChildren(head, S.step === 'confirm'
      ? h('div', { class: 'done' }, h('div', { class: 'big' }, '🙋'), h('h2', null, `${me0.num}번 ${me0.name}`), h('p', { style: 'font-size:18px' }, '본인이 맞습니까?'),
        h('div', { class: 'yn' }, h('button', { class: 'btn', onclick: () => { S.step = 'me'; S.me = null; render(); } }, '아니오'), h('button', { class: 'btn primary', onclick: () => { S.step = 'ask'; render(); } }, '예')))
      : h('div', { class: 'done' }, h('div', { class: 'big' }, '✅'), h('h2', null, '이미 제출을 완료하였습니다'), h('p', { class: 'muted' }, `${me0.num}번 ${me0.name} 학생은 이미 설문을 냈어요. 다시 낼 수 없어요.`), h('p', { class: 'muted', style: 'font-size:13px' }, '내 이름이 아니라면 선생님께 말씀드려요.'),
        h('button', { class: 'btn', style: 'margin-top:12px', onclick: () => { S.step = 'me'; S.me = null; render(); } }, '처음으로')));
    return;
  }
  const me = stu.find((x) => x.num === S.me);
  const secs = [];
  if (C.e.ly) CTX.forEach(([k, n, d]) => {
    const blk = (pol) => {
      const arr = S.pick[k + pol], opp = S.pick[k + (pol === 'y' ? 'n' : 'y')];
      const need = MIN(), miss = S.tried && arr.length < need;
      return h('div', { class: 'blk ' + (pol === 'y' ? 'pos' : 'neg') + (miss ? ' miss' : ''), 'data-miss': miss ? '1' : null }, h('div', { class: 'bh' }, pol === 'y' ? '🙂 함께하고 싶은 친구' : '😐 함께하고 싶지 않은 친구', h('span', null, `${arr.length}/${MAX} · ${need === MAX ? '꼭 3명' : need + '명 이상'}`)),
        h('div', { class: 'cells' }, others().map((s) => cell(s, arr.includes(s.num), opp.includes(s.num), () => {
          const i = arr.indexOf(s.num);
          if (i >= 0) arr.splice(i, 1);
          else { if (arr.length >= MAX) return toast(`최대 ${MAX}명까지 고를 수 있어요. 먼저 한 명을 빼 주세요.`); const j = opp.indexOf(s.num); if (j >= 0) opp.splice(j, 1); arr.push(s.num); }
          const y = window.scrollY; render(); window.scrollTo({ top: y });
        }))));
    };
    secs.push(h('div', { class: 'sec' }, h('h2', null, n), h('div', { class: 'd' }, d), blk('y'), blk('n')));
  });
  if (C.g) secs.push(h('div', { class: 'sec' }, h('h2', null, '친구에 대한 내 생각'), h('div', { class: 'd' }, '친구마다 가장 가까운 것을 하나씩 눌러요.'),
    others().filter((s) => C.g[s.num]).map((s) => h('div', { class: 'lvrow' + (S.tried && !S.lv[s.num] ? ' miss' : ''), 'data-miss': S.tried && !S.lv[s.num] ? '1' : null }, h('span', { class: 'lvname ' + (s.g || '') }, s.name),
      h('div', { class: 'lvbtns' }, LV.map(([n, c, y]) => h('button', { type: 'button', class: 'lv' + (S.lv[s.num] === n ? ' on' : '') + (y ? ' y' : ''), style: `--c:${c}`, onclick: () => { S.lv[s.num] = S.lv[s.num] === n ? undefined : n; const yy = window.scrollY; render(); window.scrollTo({ top: yy }); } }, n)))))));
  app.replaceChildren(head, h('div', { class: 'sec' }, '응답하는 사람: ', h('span', { class: 'who' }, `${me.num} ${me.name}`), ' ', h('button', { class: 'btn', style: 'padding:6px 10px;font-size:13px;margin-left:6px', onclick: () => { S.step = 'me'; S.tried = false; render(); } }, '바꾸기')),
    ...secs, h('div', { class: 'bar' }, h('button', { class: 'btn', onclick: () => { S.step = 'me'; render(); } }, '← 이전'), h('button', { class: 'btn primary', onclick: submit }, '제출하기')));
}
let sending = false;
async function submit() {
  if (sending) return;
  // 모든 문항 필수
  const need = MIN();
  const missN = C.e.ly ? CTX.reduce((t, [k]) => t + ['y', 'n'].filter((pol) => S.pick[k + pol].length < need).length, 0) : 0;
  const missL = C.g ? others().filter((s) => C.g[s.num] && !S.lv[s.num]).length : 0;
  if (missN || missL) {
    S.tried = true; render();
    const first = document.querySelector('[data-miss]'); if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(missN ? `빨간 테두리 칸에서 친구를 ${need === MAX ? '꼭 3명' : need + '명 이상'} 골라야 제출할 수 있어요.` : `아직 고르지 않은 친구가 ${missL}명 있어요.`);
    return;
  }
  // 그사이 다른 기기에서 같은 이름으로 냈는지 한 번 더 확인
  if ((await remoteSent()).includes(S.me)) { S.step = 'blocked'; render(); return; }
  if (!confirm('제출할까요? 제출하면 다시 고칠 수 없어요.')) return;
  sending = true;
  const body = new URLSearchParams();
  const me = stu.find((x) => x.num === S.me);
  body.append('entry.' + C.e.n, label(me));
  if (C.e.ly) CTX.forEach(([k]) => ['y', 'n'].forEach((pol) => S.pick[k + pol].forEach((n) => body.append('entry.' + C.e[k + pol], label(stu.find((x) => x.num === n))))));
  if (C.g) Object.entries(S.lv).forEach(([n, v]) => { if (v && C.g[n]) body.append('entry.' + C.g[n], v); });
  body.append('fvv', '1');
  body.append('pageHistory', Array.from({ length: C.p || 1 }, (_, i) => i).join(','));
  try {
    await fetch(`https://docs.google.com/forms/d/e/${encodeURIComponent(C.f)}/formResponse`, { method: 'POST', mode: 'no-cors', body });
    try { const a = localSent(); if (!a.includes(S.me)) a.push(S.me); localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) { /* 저장 안 됨 */ }
    S.step = 'sent'; S.tried = false; S.pick = {}; CTX.forEach(([k]) => { S.pick[k + 'y'] = []; S.pick[k + 'n'] = []; }); S.lv = {};
    render();
  } catch (e) { toast('보내지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.'); }
  sending = false;
}
render();
})();
