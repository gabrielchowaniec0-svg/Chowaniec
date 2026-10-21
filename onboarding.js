// First-run welcome: after an update, each person is asked once to pick their theme and their robot.
// Shown on any page (except Meet while in a call) the first time they open the app after ONBOARD_VERSION changes.
// Their answers are saved to their account (settings.look / settings.robot); look.onboarded records that it's done.
(function () {
  const ONBOARD_VERSION = 1;
  if (window.__chowaniecOnboarding) return;
  window.__chowaniecOnboarding = true;

  const user = () => (window.getChowaniecUser && window.getChowaniecUser()) || null;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function loadSettings(u) {
    const res = await fetch('/.netlify/functions/settings', { headers: { 'X-Chowaniec-Key': u.key }, cache: 'no-store' });
    if (!res.ok) throw new Error('settings');
    return (await res.json()).settings || {};
  }
  async function saveLook(u, look) {
    try {
      await fetch('/.netlify/functions/settings', {
        method: 'POST', headers: { 'X-Chowaniec-Key': u.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { look } })
      });
    } catch (e) { /* will ask again next time */ }
  }

  const css = `
  #ob-root{position:fixed;inset:0;z-index:2000;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transition:opacity .35s ease}
  #ob-root.in{opacity:1}
  #ob-card{width:min(560px,100%);max-height:92dvh;display:flex;flex-direction:column;background:var(--surface,var(--bg,#fff));color:var(--text,var(--fg,#111));border-radius:28px 28px 0 0;box-shadow:0 -12px 50px rgba(0,0,0,.35);transform:translateY(40px);transition:transform .5s cubic-bezier(.2,1,.3,1);font-family:inherit;padding-bottom:env(safe-area-inset-bottom,0)}
  #ob-root.in #ob-card{transform:none}
  @media(min-width:640px){#ob-root{align-items:center}#ob-card{border-radius:28px;max-height:88dvh}}
  #ob-head{padding:22px 22px 6px;text-align:center}
  #ob-dots{display:flex;gap:6px;justify-content:center;margin-bottom:12px}
  #ob-dots i{width:8px;height:8px;border-radius:99px;background:currentColor;opacity:.2;transition:all .3s ease}
  #ob-dots i.on{opacity:1;width:22px;background:var(--accent,#7c3aed)}
  #ob-title{font-size:22px;font-weight:700;margin:0 0 4px}
  #ob-sub{font-size:14px;opacity:.7;margin:0}
  #ob-body{padding:14px 18px;overflow-y:auto;flex:1;min-height:200px;animation:ob-step .4s ease}
  @keyframes ob-step{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:none}}
  #ob-foot{display:flex;gap:10px;justify-content:space-between;align-items:center;padding:12px 18px 18px}
  .ob-btn{min-height:46px;padding:0 22px;border-radius:14px;border:0;font:600 15px inherit;cursor:pointer;transition:transform .15s ease,opacity .2s ease}
  .ob-btn:active{transform:scale(.96)}
  .ob-btn:focus:not(:focus-visible){outline:none}
  .ob-primary{background:var(--accent,#111);color:var(--accent-ink,#fff);flex:1;max-width:240px;margin-left:auto}
  .ob-ghost{background:transparent;color:inherit;opacity:.65}
  .ob-hello{text-align:center;padding:10px 0 4px}
  .ob-hello .ob-bot{width:120px;margin:0 auto 10px}
  @media(prefers-reduced-motion:reduce){#ob-root,#ob-card,#ob-body,.ob-btn{transition:none!important;animation:none!important}}`;

  function run(u, settings) {
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    const root = document.createElement('div');
    root.id = 'ob-root'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'ob-title');
    root.innerHTML = `<div id="ob-card"><div id="ob-head"><div id="ob-dots"></div><h2 id="ob-title"></h2><p id="ob-sub"></p></div><div id="ob-body"></div><div id="ob-foot"></div></div>`;
    document.body.appendChild(root);
    requestAnimationFrame(() => root.classList.add('in'));
    const $ = (id) => root.querySelector(id);

    const first = String(u.name || '').split(' ')[0];
    const steps = [
      { title: `Welcome${first ? ', ' + esc(first) : ''}!`, sub: 'The app has a fresh look. Two quick choices make it yours.', render(body) {
        const robot = window.ChowaniecRobot ? window.ChowaniecRobot.mascot({ live: true, state: 'idle' }) : '';
        body.innerHTML = `<div class="ob-hello"><div class="ob-bot">${robot}</div><p style="opacity:.75;font-size:15px;margin:0">Pick a theme and a robot helper. You can change them any time in Settings.</p></div>`;
        const bob = body.querySelector('.bob'); if (bob) { bob.dataset.state = 'listening'; }
      }, next: "Let's go" },
      { title: 'Pick your theme', sub: 'Colors, seasons, gradients, or make your own.', render(body) {
        if (window.ChowaniecTheme && window.ChowaniecTheme.mountPicker) window.ChowaniecTheme.mountPicker(body, {});
        else body.innerHTML = '<p style="text-align:center">The theme picker didn\u2019t load. <button type="button" class="ob-btn ob-ghost" data-reload>Reload</button></p>';
      }, next: 'Next' },
      { title: 'Choose your robot', sub: 'Pick a helper and dress it up.', render(body) {
        if (window.ChowaniecRobot && window.ChowaniecRobot.mountPicker) window.ChowaniecRobot.mountPicker(body, {});
        else body.innerHTML = '<p style="text-align:center">The robot picker didn\u2019t load. <button type="button" class="ob-btn ob-ghost" data-reload>Reload</button></p>';
      }, next: 'All done' }
    ];
    let i = 0;

    function show() {
      const s = steps[i];
      $('#ob-dots').innerHTML = steps.map((_, n) => `<i class="${n === i ? 'on' : ''}"></i>`).join('');
      $('#ob-title').textContent = s.title.replace(/&amp;/g, '&');
      $('#ob-sub').textContent = s.sub;
      const body = $('#ob-body'); body.style.animation = 'none'; void body.offsetWidth; body.style.animation = ''; body.innerHTML = '';
      s.render(body);
      $('#ob-foot').innerHTML = `${i > 0 ? '<button class="ob-btn ob-ghost" data-back type="button">Back</button>' : '<button class="ob-btn ob-ghost" data-skip type="button">Skip for now</button>'}<button class="ob-btn ob-primary" data-next type="button">${s.next}</button>`;
      $('#ob-foot').querySelector('[data-next]').focus({ preventScroll: true });
    }
    async function finish(skipped) {
      // The pickers already saved the person's choices; this just records that the welcome is done.
      if (window.ChowaniecTheme && window.ChowaniecTheme.markOnboarded) { try { await window.ChowaniecTheme.markOnboarded(ONBOARD_VERSION); } catch (e) { await saveLook(u, { onboarded: ONBOARD_VERSION }); } }
      else await saveLook(u, { onboarded: ONBOARD_VERSION });
      try { localStorage.setItem(`chowaniec_onboarded_${u.name}`, String(ONBOARD_VERSION)); } catch (e) { /* storage blocked */ }
      root.classList.remove('in');
      setTimeout(() => { root.remove(); style.remove(); }, reduced() ? 0 : 450);
      if (!skipped && window.ChowaniecHaptics) window.ChowaniecHaptics.tap('success');
    }
    root.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.hasAttribute('data-next')) { if (i < steps.length - 1) { i++; show(); } else finish(false); }
      else if (t.hasAttribute('data-back')) { i--; show(); }
      else if (t.hasAttribute('data-skip')) finish(true);
      else if (t.hasAttribute('data-reload')) {
        (async () => {
          try {
            const regs = await (navigator.serviceWorker ? navigator.serviceWorker.getRegistrations() : []);
            await Promise.all(regs.map((r) => r.unregister()));
            if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
          } catch (err) { /* reload anyway */ }
          location.reload();
        })();
      }
    });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') finish(true); });
    show();
  }

  async function start(tries, force) {
    tries = tries || 0;
    if (!force && /[?&]welcome=1\b/.test(location.search)) force = true;   // chowaniec.net/?welcome=1 shows it again
    const u = user();
    if (!u || !u.key) { if (tries < 60) setTimeout(() => start(tries + 1), 2000); return; }   // signed in later on this page (the hub)
    if (u.name === 'Guest') return;
    if (/^\/meet\/?/.test(location.pathname) && document.getElementById('call-screen') && !document.getElementById('call-screen').classList.contains('hidden')) return;
    try { if (!force && Number(localStorage.getItem(`chowaniec_onboarded_${u.name}`)) >= ONBOARD_VERSION) return; } catch (e) { /* storage blocked */ }
    let settings;
    try { settings = await loadSettings(u); } catch (e) { return; }
    if (!force && (settings.look && settings.look.onboarded) >= ONBOARD_VERSION) {
      try { localStorage.setItem(`chowaniec_onboarded_${u.name}`, String(ONBOARD_VERSION)); } catch (e) { /* storage blocked */ }
      return;
    }
    // Make sure the full theme and robot pickers are loaded. A device can hold an older copy of these scripts
    // right after an update, so if a picker is missing, fetch a fresh copy (the new address skips the old cache).
    const themeOk = () => window.ChowaniecTheme && typeof window.ChowaniecTheme.mountPicker === 'function';
    const robotOk = () => window.ChowaniecRobot && typeof window.ChowaniecRobot.mountPicker === 'function';
    const waitFor = async (ok, ms) => { for (let n = 0; n < ms / 150 && !ok(); n++) await new Promise((r) => setTimeout(r, 150)); return ok(); };
    const fresh = (src) => new Promise((resolve) => {
      const sc = document.createElement('script');
      sc.src = `${src}?fresh=${Date.now()}`; sc.onload = () => resolve(true); sc.onerror = () => resolve(false);
      document.head.appendChild(sc);
    });
    if (!window.ChowaniecRobot) { const sc = document.createElement('script'); sc.src = '/robot.js'; document.head.appendChild(sc); }
    if (!(await waitFor(robotOk, 2500))) { await fresh('/robot.js'); await waitFor(robotOk, 2500); }
    if (!(await waitFor(themeOk, 1500))) { await fresh('/theme.js'); await waitFor(themeOk, 2500); }
    run(u, settings);
  }
  window.ChowaniecOnboarding = { replay: () => { if (!document.getElementById('ob-root')) start(0, true); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(() => start(0), 600)); else setTimeout(() => start(0), 600);
})();
