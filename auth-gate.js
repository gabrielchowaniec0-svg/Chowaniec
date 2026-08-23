(function () {
  const DEFAULT_PASSCODES = ['chowaniec2026'];

  function isAuthorized() {
    return sessionStorage.getItem('chowaniec_authenticated') === 'true';
  }

  function setAuthorized() {
    sessionStorage.setItem('chowaniec_authenticated', 'true');
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

  function verifyInputPasscode() {
    const input = document.getElementById('gate-passcode-input');
    const error = document.getElementById('gate-passcode-error');
    const box = document.getElementById('gate-passcode-box');
    const entered = input.value.trim();

    const authorizedList =
      window.CHOWANIEC_CONFIG && window.CHOWANIEC_CONFIG.AUTHORIZED_PASSCODES
        ? window.CHOWANIEC_CONFIG.AUTHORIZED_PASSCODES
        : DEFAULT_PASSCODES;

    if (authorizedList.includes(entered)) {
      setAuthorized();
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
      style.innerHTML = `
        @keyframes gateShake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }
        .animate-shake { animation: gateShake 0.35s ease-in-out; }
      `;
      document.head.appendChild(style);
    }

    const modal = document.createElement('div');
    modal.id = 'gate-passcode-modal';
    modal.className =
      'fixed inset-0 bg-black/30 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 selection:bg-gray-200';
    modal.innerHTML = `
      <div id="gate-passcode-box" class="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-gray-100 space-y-6 text-center">
        <div class="w-12 h-12 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto text-black font-serif text-lg">
          CH
        </div>
        <div>
          <h3 class="text-xl font-serif text-black mb-1">Enter Passcode</h3>
          <p class="text-xs text-gray-400 font-light">
            Authentication required to access this service
          </p>
        </div>
        <div class="space-y-3">
          <input
            type="password"
            id="gate-passcode-input"
            placeholder="••••••••"
            class="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-center text-sm font-mono tracking-widest outline-none focus:border-black focus:bg-white transition-all"
          />
          <p id="gate-passcode-error" class="text-xs text-red-500 font-medium hidden">
            Invalid passcode
          </p>
        </div>
        <div class="flex gap-3 pt-2">
          <button
            id="gate-cancel-btn"
            class="flex-1 py-3 text-xs font-medium text-gray-500 hover:bg-gray-50 rounded-xl transition-colors"
          >
            Return to Hub
          </button>
          <button
            id="gate-submit-btn"
            class="flex-1 py-3 text-xs font-medium bg-black text-white rounded-xl hover:bg-gray-800 transition-colors shadow-sm"
          >
            Authorize
          </button>
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
