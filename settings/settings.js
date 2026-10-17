// Shared bits for the Settings pages: sign-in check, API helper, toast.
(function () {
  'use strict';
  const S = {};
  S.user = () => (window.getChowaniecUser ? window.getChowaniecUser() : null);
  S.esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  S.$ = (id) => document.getElementById(id);

  S.api = async function (path, options) {
    const user = S.user();
    const opts = Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options || {});
    opts.headers = Object.assign({ 'X-Chowaniec-Key': (user && user.key) || '' }, opts.headers || {});
    if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
      opts.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status });
    return data;
  };

  let toastTimer = null;
  S.toast = function (text, bad) {
    let el = S.$('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.className = 'toast' + (bad ? ' bad' : '');
    el.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  };

  // Runs `start` once the person is signed in (the shared passcode box handles signing in).
  S.whenSignedIn = function (start) {
    let started = false;
    const go = () => { if (!started && window.isAppAuthorized && window.isAppAuthorized()) { started = true; start(); } };
    window.initializeProtectedContent = go;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  };

  window.ChowaniecSettings = S;
})();
