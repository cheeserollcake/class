/* 버튼 아이콘 통일: 글자를 보고 알맞은 아이콘을 앞에 붙여요 (모든 페이지 공통)
   설정 = 톱니 / 내려받기 = 받침 위 아래 화살표 / 올리기 = 받침 위 위 화살표 / 양식 내려받기 = 문서+원 화살표 / 저장·보관 = 구름 위 화살표
   파일 형식이 정해진 내려받기(한글·워드·엑셀·스프레드시트·PDF·PNG)는 그 형식 아이콘 */
(() => {
'use strict';
const NS = 'http://www.w3.org/2000/svg';
const LINE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const SVG = {
  gear: `<svg viewBox="0 0 24 24" ${LINE}><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6a.5.5 0 0 0 .1-.6l-1.9-3.3a.5.5 0 0 0-.6-.2l-2.4 1a7.3 7.3 0 0 0-1.7-1l-.4-2.5a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.4 2.5a7.3 7.3 0 0 0-1.7 1l-2.4-1a.5.5 0 0 0-.6.2L2.5 8.8a.5.5 0 0 0 .1.6l2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6a.5.5 0 0 0-.1.6l1.9 3.3c.1.2.4.3.6.2l2.4-1a7.3 7.3 0 0 0 1.7 1l.4 2.5c0 .2.2.4.5.4h3.8c.3 0 .5-.2.5-.4l.4-2.5a7.3 7.3 0 0 0 1.7-1l2.4 1c.2.1.5 0 .6-.2l1.9-3.3a.5.5 0 0 0-.1-.6z"/><circle cx="12" cy="12" r="3"/></svg>`,
  download: `<svg viewBox="0 0 24 24" ${LINE} stroke-width="2.4"><path d="M12 4v10"/><path d="M7.5 10l4.5 4.5 4.5-4.5"/><path d="M5 15.5v2A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-2"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" ${LINE} stroke-width="2.4"><path d="M12 14.5V4"/><path d="M7.5 8.5L12 4l4.5 4.5"/><path d="M5 15.5v2A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-2"/></svg>`,
  template: `<svg viewBox="0 0 24 24" ${LINE} stroke-width="1.8"><path d="M11 21H6.5A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3H13l5 5v3"/><path d="M13 3v5h5"/><circle cx="17" cy="17" r="4.2"/><path d="M17 19.2v-4.4M15.2 16.6l1.8-1.8 1.8 1.8"/></svg>`,
  cloud: `<svg viewBox="0 0 24 24" ${LINE} stroke-width="2"><path d="M7.5 18.5H7a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.8 8.6 4.5 4.5 0 0 1 17 18.5h-.5"/><path d="M12 20.5V12M9 14.5l3-3 3 3"/></svg>`
};
const FMT = { hwp: ['HWP', '#1f6fd1'], docx: ['DOC', '#2b579a'], xlsx: ['XLS', '#1d6f42'], gsheet: ['SHT', '#0f9d58'], pdf: ['PDF', '#e0362c'], png: ['PNG', '#8e44ad'], csv: ['CSV', '#5f6b7a'] };
const fmtSvg = (k) => { const [t, c] = FMT[k]; return `<svg viewBox="0 0 24 24"><path d="M6 2.8h8.2L19 7.6V20a1.2 1.2 0 0 1-1.2 1.2H6A1.2 1.2 0 0 1 4.8 20V4A1.2 1.2 0 0 1 6 2.8z" fill="#fff" stroke="currentColor" stroke-width="1.4"/><path d="M14 2.8v4.8h5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="1.5" y="11.2" width="17" height="7.6" rx="1.6" fill="${c}"/><text x="10" y="17.1" font-size="6.2" font-weight="800" font-family="Arial,sans-serif" text-anchor="middle" fill="#fff">${t}</text></svg>`; };
function icon(k) {
  const s = document.createElement('span'); s.className = 'ic ic-' + k; s.setAttribute('aria-hidden', 'true');
  s.innerHTML = SVG[k] || (FMT[k] ? fmtSvg(k) : '');
  return s;
}
window.APP = window.APP || {};
window.APP.icon = icon;

const EMOJI = /^[\s⚙🗄📄📥📤💾⬇⬆📁🗂️️]+/u;
function pick(t) {
  if (/양식.*(받기|내려)|업로드 양식|양식 받기|템플릿|양식 만들기/.test(t)) return 'template';
  if (/업로드|올리기/.test(t) || (/불러오기/.test(t) && /PDF|엑셀|파일/i.test(t))) return 'upload';
  const fmtish = /\.(hwpx?|docx|xlsx|pdf|png|csv)\b|\((PNG|PDF|HWP|XLSX)\)|^(구글 )?스프레드시트$|내보내기|내려받기|다운로드|저장|파일/i.test(t);
  if (fmtish) {
    if (/hwpx?|한글/i.test(t)) return 'hwp';
    if (/docx|워드/i.test(t)) return 'docx';
    if (/스프레드시트|구글 시트/.test(t)) return 'gsheet';
    if (/xlsx|엑셀/i.test(t)) return 'xlsx';
    if (/csv/i.test(t)) return 'csv';
    if (/pdf/i.test(t)) return 'pdf';
    if (/png|이미지|그림/i.test(t)) return 'png';
  }
  if (/내보내기|내려받기|다운로드|백업/.test(t)) return 'download';
  if (/저장|보관/.test(t) && !/삭제|저장된|저장한|안 됨|중…|됨$|했/.test(t)) return 'cloud';
  if (/설정( 수정)?$/.test(t) && !/가져오기|기초설정/.test(t)) return 'gear';
  return null;
}
const SKIP = '.tab, .nav-btn, .chip, .cz-seg button, .tw-seg button, .lv, .cell, .scell, .nm-cell, .nm-pick, .cz-chip, .cz-opt, .abs-chip, .bw-cell, .cz-cchip, .side-toggle, .menu-fab, .x, .cz-live, .cz-flag, .cz-srcchip, .lv-group button, [data-noic]';
function deco(b) {
  if (b.dataset.ic || b.matches(SKIP)) return;
  const t = (b.textContent || '').replace(EMOJI, '').trim();
  if (!t || t.length > 24) return;
  const k = pick(t); if (!k) return;
  b.dataset.ic = k;
  // 앞에 붙은 이모지 아이콘은 떼어 내기
  const first = [...b.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
  if (first && EMOJI.test(first.nodeValue)) first.nodeValue = first.nodeValue.replace(EMOJI, '');
  b.prepend(icon(k)); b.classList.add('has-ic');
}
function scan(root) { if (root.nodeType !== 1) return; if (root.tagName === 'BUTTON') deco(root); root.querySelectorAll && root.querySelectorAll('button').forEach(deco); }
function start() {
  scan(document.body);
  new MutationObserver((ms) => ms.forEach((m) => {
    m.addedNodes.forEach(scan);
    if (m.type === 'childList' && m.target.nodeType === 1) {   // 버튼 글자를 통째로 바꾸면 아이콘이 지워지므로 다시 붙이기
      const b = m.target.closest('button');
      if (b && b.dataset.ic && !b.querySelector(':scope > .ic')) { delete b.dataset.ic; deco(b); }
    }
    if (m.type === 'characterData' && m.target.parentElement) { const b = m.target.parentElement.closest('button'); if (b && !b.dataset.ic) deco(b); }
  })).observe(document.body, { childList: true, subtree: true, characterData: true });
}
if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
