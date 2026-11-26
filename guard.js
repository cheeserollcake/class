/* 다른 사이트가 이 화면을 몰래 틀 안에 넣어 쓰지 못하게 막기 */
(function () {
  if (window.top !== window.self) {
    try { window.top.location = window.self.location.href; } catch (e) { document.documentElement.style.display = 'none'; }
  }
})();
