(function () {
  function isAuthorized() {
    return sessionStorage.getItem('chowaniec_authenticated') === 'true';
  }

  function getHubUrl() {
    const isLocal =
      window.location.protocol === 'file:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    return isLocal ? '../index.html' : '/';
  }

  function applyLockState() {
    if (isAuthorized()) {
      const appEl = document.getElementById('app-root');
      if (appEl) {
        appEl.classList.remove('filter', 'blur-md', 'pointer-events-none', 'select-none');
      }
      return;
    }

    // Blur and disable underlying layout
    const appEl = document.getElementById('app-root');
    if (appEl) {
      appEl.classList.add('filter', 'blur-md', 'pointer-events-none', 'select-none');
      appEl.setAttribute('aria-hidden', 'true');
    }

    renderGateModal();
  }

  function unlockApplication() {
    const modal = document.getElementById('gate-passcode-modal');
    if (modal) modal.remove();

    const appEl = document.getElementById('app-root');
    if (appEl) {
      appEl.classList.remove('filter', 'blur-md', 'pointer-events-none', 'select-none');
      appEl.removeAttribute('aria-hidden');
    }

    document.body.style.overflow = '';

    // Trigger full content population only after authorization
    if (typeof window.initializeProtectedContent === 'function') {
      window.initializeProtectedContent();
    }
  }

  async function verifyInputPasscode() {
    const input = document.getElementById('gate-passcode-input');
    const error = document.getElementById('gate-passcode-error');
    const box = document.getElementById('gate-passcode-box');
    const entered = input.value.trim();

    const user = await window.checkChowaniecPasscode(entered);

    if (user) {
      window.setChowaniecSession(user);
      unlockApplication();
    } else {
      error.classList.remove('hidden');
      box.classList.add('animate-shake');
      input.value = '';
      setTimeout(() => box.classList.remove('animate-shake'), 400);
    }
  }

  function renderGateModal() {
    if (document.getElementById('gate-passcode-modal')) return;

    document.body.style.overflow = 'hidden';

    if (!document.getElementById('gate-shake-style')) {
      const style = document.createElement('style');
      style.id = 'gate-shake-style';
      // Self-contained styles (design-system tokens with fallbacks), so the box looks right before Tailwind or /design.css load.
      style.innerHTML = `
        @keyframes gateShake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }
        @keyframes gateIn { from { opacity: 0; transform: translateY(16px) scale(.97); } }
        .animate-shake { animation: gateShake 0.35s ease-in-out; }
        #gate-passcode-modal { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 16px;
          background: var(--overlay, rgba(10,10,10,.32)); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
          font-family: var(--ch-font-ui, 'Outfit', system-ui, -apple-system, sans-serif); color: var(--text, #0a0a0a); -webkit-font-smoothing: antialiased; }
        #gate-passcode-modal * { box-sizing: border-box; }
        #gate-passcode-box { width: 100%; max-width: 380px; padding: 32px 24px 24px; text-align: center; border-radius: var(--ch-r-xl, 28px);
          background: var(--ch-glass-strong, rgba(255,255,255,.88)); -webkit-backdrop-filter: saturate(1.8) blur(28px); backdrop-filter: saturate(1.8) blur(28px);
          border: 1px solid var(--ch-glass-border, rgba(0,0,0,.08)); box-shadow: var(--ch-shadow-3, 0 30px 60px -18px rgba(0,0,0,.25)); }
        @media (prefers-reduced-motion: no-preference) { html:not([data-motion="reduced"]) #gate-passcode-box:not(.animate-shake) { animation: gateIn .45s cubic-bezier(.22,1,.36,1) both; } }
        .cg-ic { width: 60px; height: 60px; margin: 0 auto 18px; border-radius: 19px; display: flex; align-items: center; justify-content: center; color: var(--accent-ink, #fff);
          background: linear-gradient(150deg, color-mix(in srgb, var(--accent, #0a0a0a) 72%, #fff), var(--accent, #0a0a0a));
          box-shadow: inset 0 -2px 0 rgba(0,0,0,.14), inset 0 1px 0 rgba(255,255,255,.3), 0 12px 24px -10px color-mix(in srgb, var(--accent, #0a0a0a) 70%, transparent); }
        .cg-ic svg { width: 28px; height: 28px; }
        .cg-title { margin: 0 0 6px; font: 400 28px/1.1 var(--ch-font-display, 'Playfair Display', Georgia, serif); letter-spacing: -.015em; color: var(--text, #0a0a0a); }
        .cg-sub { margin: 0 0 22px; font-size: 14px; line-height: 1.45; color: var(--muted, #6b6b73); }
        .cg-field { display: grid; gap: 6px; text-align: left; }
        .cg-label { font-size: 13.5px; font-weight: 600; color: var(--text-2, #3f3f46); }
        #gate-passcode-input { width: 100%; min-height: 52px; padding: 0 16px; border-radius: var(--ch-r-md, 16px); border: 1px solid var(--line-strong, rgba(0,0,0,.18));
          background: var(--input-bg, var(--surface-2, #f4f4f5)); color: var(--text, #0a0a0a); font: 500 18px/1 var(--ch-font-mono, ui-monospace, monospace); letter-spacing: .3em; text-align: center; outline: none;
          transition: border-color .2s ease, box-shadow .2s ease, background-color .2s ease; }
        #gate-passcode-input:focus { border-color: var(--accent, #0a0a0a); background: var(--surface, #fff); box-shadow: 0 0 0 2px var(--surface, #fff), 0 0 0 4px color-mix(in srgb, var(--accent, #0a0a0a) 70%, transparent); }
        #gate-passcode-error { margin: 8px 0 0; font-size: 13px; font-weight: 600; color: var(--danger, #dc2626); text-align: center; }
        #gate-passcode-error.hidden { display: none; }
        #app-root.blur-md { filter: blur(12px); } #app-root.pointer-events-none { pointer-events: none; } #app-root.select-none { user-select: none; -webkit-user-select: none; }
        .cg-actions { display: flex; gap: 10px; margin-top: 22px; }
        .cg-btn { flex: 1; min-height: 48px; padding: 0 16px; border-radius: 999px; font: 600 15px/1 var(--ch-font-ui, 'Outfit', system-ui, sans-serif); cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: transform .2s cubic-bezier(.34,1.4,.5,1), background-color .2s ease; -webkit-tap-highlight-color: transparent; }
        .cg-btn:active { transform: scale(.96); }
        .cg-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--surface, #fff), 0 0 0 4px color-mix(in srgb, var(--accent, #0a0a0a) 70%, transparent); }
        #gate-cancel-btn { background: var(--surface-2, #f4f4f5); color: var(--text, #0a0a0a); border: 1px solid var(--line, rgba(0,0,0,.1)); }
        #gate-cancel-btn:hover { background: var(--surface-3, #e9e9eb); }
        #gate-submit-btn { background: var(--accent, #0a0a0a); color: var(--accent-ink, #fff); border: 0;
          box-shadow: 0 1px 0 rgba(255,255,255,.18) inset, 0 6px 16px -6px color-mix(in srgb, var(--accent, #0a0a0a) 55%, transparent); }
      `;
      document.head.appendChild(style);
    }

    const modal = document.createElement('div');
    modal.id = 'gate-passcode-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'gate-title');
    modal.innerHTML = `
      <div id="gate-passcode-box">
        <div class="cg-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2.5"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
        <h2 id="gate-title" class="cg-title">Welcome back</h2>
        <p class="cg-sub">Enter your family passcode to open Chowaniec.</p>
        <div class="cg-field">
          <label class="cg-label" for="gate-passcode-input">Passcode</label>
          <input type="password" id="gate-passcode-input" autocomplete="current-password" aria-describedby="gate-passcode-error" />
          <p id="gate-passcode-error" class="hidden" role="alert">That passcode didn&rsquo;t work. Try again.</p>
        </div>
        <div class="cg-actions">
          <button type="button" id="gate-cancel-btn" class="cg-btn">Back to home</button>
          <button type="button" id="gate-submit-btn" class="cg-btn">Unlock</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const input = document.getElementById('gate-passcode-input');
    const submitBtn = document.getElementById('gate-submit-btn');
    const cancelBtn = document.getElementById('gate-cancel-btn');

    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') verifyInputPasscode();
    });
    submitBtn.addEventListener('click', verifyInputPasscode);
    cancelBtn.addEventListener('click', () => {
      window.location.href = getHubUrl();
    });
  }

  window.isAppAuthorized = isAuthorized;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyLockState);
  } else {
    applyLockState();
  }
})();
