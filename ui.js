/* 웹페이지 안의 팝업 (브라우저 confirm·prompt·alert 대신) — 기록 모드 비밀번호 창과 같은 모양 */
(() => {
'use strict';
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function open(kind, msg, def, opt) {
  opt = opt || {};
  return new Promise((resolve) => {
    const ov = el('div', 'overlay ui-pop'); ov.style.zIndex = 200;
    const m = el('div', 'modal');
    const lines = String(msg || '').split('\n');
    const title = opt.title || (lines.length > 1 && lines[0].length < 40 ? lines.shift() : (kind === 'alert' ? '알림' : kind === 'prompt' ? '입력' : '확인'));
    m.append(el('h3', null, title));
    const body = lines.join('\n').trim(); if (body) m.append(el('div', 'ui-msg', body));
    let input = null;
    if (kind === 'prompt') { input = el('input'); input.type = 'text'; input.value = def == null ? '' : String(def); input.autocomplete = 'off'; m.append(input); }
    const row = el('div', 'row ui-btns');
    const done = (v) => { ov.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
    const ok = el('button', opt.danger ? 'danger' : 'primary', opt.ok || '확인');
    ok.onclick = () => done(kind === 'prompt' ? input.value : kind === 'confirm' ? true : undefined);
    if (kind !== 'alert') { const no = el('button', null, opt.cancel || '취소'); no.onclick = () => done(kind === 'prompt' ? null : false); row.append(no); }
    row.append(ok); m.append(row);
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(kind === 'prompt' ? null : kind === 'confirm' ? false : undefined); } else if (e.key === 'Enter' && (!input || document.activeElement === input)) { e.preventDefault(); ok.click(); } };
    document.addEventListener('keydown', key, true);
    ov.append(m); document.body.append(ov);
    setTimeout(() => { if (input) { input.focus(); input.select(); } else ok.focus(); }, 0);
  });
}
/* 위험한 일: 경고를 보여 주고 정해진 말(예: 삭제)을 입력해야 버튼이 켜짐 */
window.uiTypeConfirm = (title, msg, word, okText) => new Promise((resolve) => {
  const ov = el('div', 'overlay ui-pop'); ov.style.zIndex = 200;
  const m = el('div', 'modal'); m.append(el('h3', null, title), el('div', 'ui-msg ui-warn', msg));
  const tip = el('div', 'ui-msg'); tip.textContent = `계속하려면 아래 칸에 "${word}"라고 입력하세요.`; m.append(tip);
  const input = el('input'); input.type = 'text'; input.autocomplete = 'off'; input.placeholder = word; m.append(input);
  const row = el('div', 'row ui-btns'), no = el('button', null, '취소'), ok = el('button', 'danger', okText || word);
  ok.disabled = true; input.oninput = () => { ok.disabled = input.value.trim() !== word; };
  const done = (v) => { ov.remove(); resolve(v); };
  no.onclick = () => done(false); ok.onclick = () => { if (input.value.trim() === word) done(true); };
  input.onkeydown = (e) => { if (e.key === 'Enter') ok.click(); if (e.key === 'Escape') done(false); };
  row.append(no, ok); m.append(row); ov.append(m); document.body.append(ov); setTimeout(() => input.focus(), 0);
});
window.uiConfirm = (msg, opt) => open('confirm', msg, null, opt);
window.uiPrompt = (msg, def, opt) => open('prompt', msg, def, opt);
window.uiAlert = (msg, opt) => open('alert', msg, null, opt);
})();
