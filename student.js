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
    const sent = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } })();
    app.replaceChildren(head, h('div', { class: 'sec me' }, h('h2', null, '내 이름을 눌러요'), h('div', { class: 'd' }, sent.length ? '이 기기에서 이미 제출한 적이 있어요. 다시 내면 마지막에 낸 것으로 바뀌어요.' : '내 번호와 이름을 찾아 눌러요.'),
      h('div', { class: 'cells' }, stu.map((s) => cell(s, S.me === s.num, false, () => { S.me = s.num; render(); })))),
      h('div', { class: 'bar' }, h('button', { class: 'btn primary', disabled: S.me == null, onclick: () => { S.step = 'ask'; render(); } }, S.me == null ? '이름을 골라 주세요' : `${stu.find((x) => x.num === S.me).name}(으)로 시작하기`)));
    return;
  }
  const me = stu.find((x) => x.num === S.me);
  const secs = [];
  if (C.e.ly) CTX.forEach(([k, n, d]) => {
    const blk = (pol) => {
      const arr = S.pick[k + pol], opp = S.pick[k + (pol === 'y' ? 'n' : 'y')];
      return h('div', { class: 'blk ' + (pol === 'y' ? 'pos' : 'neg') }, h('div', { class: 'bh' }, pol === 'y' ? '🙂 함께하고 싶은 친구' : '😐 함께하고 싶지 않은 친구', h('span', null, `${arr.length}/${MAX}`)),
        h('div', { class: 'cells' }, others().map((s) => cell(s, arr.includes(s.num), opp.includes(s.num), () => {
          const i = arr.indexOf(s.num);
          if (i >= 0) arr.splice(i, 1);
          else { if (arr.length >= MAX) return toast(`최대 ${MAX}명까지 고를 수 있어요. 먼저 한 명을 빼 주세요.`); const j = opp.indexOf(s.num); if (j >= 0) opp.splice(j, 1); arr.push(s.num); }
          const y = window.scrollY; render(); window.scrollTo({ top: y });
        }))));
    };
    secs.push(h('div', { class: 'sec' }, h('h2', null, n), h('div', { class: 'd' }, d + ' · 없으면 고르지 않아도 돼요'), blk('y'), blk('n')));
  });
  if (C.g) secs.push(h('div', { class: 'sec' }, h('h2', null, '친구에 대한 내 생각'), h('div', { class: 'd' }, '친구마다 가장 가까운 것을 하나씩 눌러요.'),
    others().filter((s) => C.g[s.num]).map((s) => h('div', { class: 'lvrow' }, h('span', { class: 'lvname ' + (s.g || '') }, s.name),
      h('div', { class: 'lvbtns' }, LV.map(([n, c, y]) => h('button', { type: 'button', class: 'lv' + (S.lv[s.num] === n ? ' on' : '') + (y ? ' y' : ''), style: `--c:${c}`, onclick: () => { S.lv[s.num] = S.lv[s.num] === n ? undefined : n; const yy = window.scrollY; render(); window.scrollTo({ top: yy }); } }, n)))))));
  app.replaceChildren(head, h('div', { class: 'sec' }, '응답하는 사람: ', h('span', { class: 'who' }, `${me.num} ${me.name}`), ' ', h('button', { class: 'btn', style: 'padding:6px 10px;font-size:13px;margin-left:6px', onclick: () => { S.step = 'me'; render(); } }, '바꾸기')),
    ...secs, h('div', { class: 'bar' }, h('button', { class: 'btn', onclick: () => { S.step = 'me'; render(); } }, '← 이전'), h('button', { class: 'btn primary', onclick: submit }, '제출하기')));
}
let sending = false;
async function submit() {
  if (sending) return;
  if (C.g) { const miss = others().filter((s) => C.g[s.num] && !S.lv[s.num]).length; if (miss && !confirm(`아직 고르지 않은 친구가 ${miss}명 있어요. 그대로 낼까요?`)) return; }
  if (!confirm('제출할까요?')) return;
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
    try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); a.push(Date.now()); localStorage.setItem(KEY, JSON.stringify(a.slice(-5))); } catch (e) { /* 저장 안 됨 */ }
    S.step = 'sent'; S.pick = {}; CTX.forEach(([k]) => { S.pick[k + 'y'] = []; S.pick[k + 'n'] = []; }); S.lv = {};
    render();
  } catch (e) { toast('보내지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.'); }
  sending = false;
}
render();
})();
