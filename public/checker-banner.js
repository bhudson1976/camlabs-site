// Persistent Redaction Checker call-out — injected site-wide.
// One file, loaded by every page via <script src="/checker-banner.js" defer></script>.
// Renders a slim sticky top bar; skips the Checker page itself.
(function () {
  if (location.pathname.replace(/\/$/, '') === '/redaction-checker') return;

  var bar = document.createElement('div');
  bar.id = 'checker-bar';
  bar.innerHTML =
    '<a href="/redaction-checker/">' +
      'Is your redacted PDF <em>really</em> redacted? ' +
      '<strong>Check it free \u2192</strong>' +
    '</a>';

  var s = document.createElement('style');
  s.textContent =
    '#checker-bar{' +
      'position:sticky;top:0;z-index:9999;' +
      'background:linear-gradient(90deg,#6366f1,#8b5cf6);' +
      'text-align:center;padding:8px 16px;font-family:Inter,system-ui,sans-serif;' +
    '}' +
    '#checker-bar a{' +
      'color:#fff;text-decoration:none;font-size:0.88rem;letter-spacing:0.01em;' +
    '}' +
    '#checker-bar em{font-style:italic;}' +
    '#checker-bar strong{font-weight:700;}' +
    '#checker-bar a:hover{text-decoration:underline;}';

  document.head.appendChild(s);
  document.body.prepend(bar);
})();
