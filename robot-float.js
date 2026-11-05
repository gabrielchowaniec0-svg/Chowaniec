// Bob the helper: a small robot in the bottom-left corner of Group, Notes, Calendar and Lists.
//   tap  -> talk to Bob (voice mode, see /voice.js; typing works there too)
//   hold -> small menu (talk, open Chowaniec AI, quick jump, catch me up)
// He sleeps at night, perks up when you touch him, and celebrates when a poll finishes or a sign-up sheet fills.
// He moves up out of the way of text boxes and hides while you are typing on a phone.
(function () {
  'use strict';
  if (document.getElementById('bob-float')) return;
  const ensure = (tag, attrs) => new Promise((resolve) => {
    const el = document.createElement(tag);
    Object.assign(el, attrs);
    el.onload = () => resolve();
    el.onerror = () => resolve();
    document.head.appendChild(el);
  });

  function start() {
    if (!window.ChowaniecRobot) return;
    const wrap = document.createElement('div');
    wrap.id = 'bob-float';
    wrap.innerHTML = window.ChowaniecRobot.mascot();
    // In the chat, Bob lives in the header so he never covers messages.
    const header = document.querySelector('.chat-header .hdr-inner');
    if (header) {
      wrap.classList.add('in-header');
      header.insertBefore(wrap, document.getElementById('btn-search') || null);
    } else {
      document.body.appendChild(wrap);
    }
    const bob = wrap.querySelector('.bob');
    const say = wrap.querySelector('.bob-say');
    bob.setAttribute('aria-label', 'Bob, your AI helper. Tap to talk to Bob, press and hold for more.');
    bob.setAttribute('aria-haspopup', 'dialog');
    // Voice mode: a small "Talk to Bob" card next to him.
    let panel = null;
    const voicePanel = () => {
      if (!panel && window.BobVoice) {
        panel = window.BobVoice.mountPanel({
          variant: 'pop', bob, anchor: wrap,
          onOpen: () => { bob.setAttribute('aria-expanded', 'true'); wrap.classList.add('talking'); },
          onClose: () => { bob.setAttribute('aria-expanded', 'false'); wrap.classList.remove('talking'); rest(); }
        });
        bob.setAttribute('aria-controls', panel.el.id);
      }
      return panel;
    };
    // Must run inside the tap itself: iOS only starts listening from a user gesture.
    const talk = () => {
      const v = voicePanel();
      if (v) v.talk(); else location.href = '/ai/';
    };
    const signedIn = () => window.getChowaniecUser && window.getChowaniecUser();

    let sayTimer = null, stateTimer = null, celebrating = false;
    const night = () => { const h = new Date().getHours(); return h >= 22 || h < 6; };
    const rest = () => { bob.dataset.state = night() ? 'asleep' : 'idle'; };
    const hint = (text, ms) => {
      say.textContent = text;
      say.classList.remove('hidden');
      clearTimeout(sayTimer);
      sayTimer = setTimeout(() => say.classList.add('hidden'), ms || 3200);
    };
    rest();
    setInterval(() => { if (!celebrating && !['listening', 'talking', 'thinking'].includes(bob.dataset.state)) rest(); }, 60000);

    // ---- Dodge text boxes: sit just above the lowest one, hide while typing on a phone.
    function place() {
      const boxes = Array.from(document.querySelectorAll('textarea, input[type="text"], input:not([type]), [contenteditable="true"]'))
        .filter((el) => el.offsetParent && !el.closest('#qj') && !el.closest('#bob-menu') && !el.closest('.bv'));
      let top = innerHeight;
      boxes.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.bottom > innerHeight * 0.55 && r.top < innerHeight && r.left < 120) top = Math.min(top, r.top);
      });
      const base = 12;
      if (wrap.classList.contains('in-header')) return;
      wrap.style.bottom = top < innerHeight ? `calc(env(safe-area-inset-bottom, 0px) + ${Math.round(innerHeight - top + 10)}px)` : '';
      if (top >= innerHeight) wrap.style.bottom = `calc(env(safe-area-inset-bottom, 0px) + ${base}px)`;
      if (panel && panel.open) setTimeout(() => panel.place(), 320);
    }
    let placeTimer = null;
    const schedulePlace = () => { clearTimeout(placeTimer); placeTimer = setTimeout(place, 150); };
    new MutationObserver(schedulePlace).observe(document.body, { childList: true, subtree: true });
    addEventListener('resize', schedulePlace);
    if (window.visualViewport) visualViewport.addEventListener('resize', () => {
      const keyboard = window.innerHeight - visualViewport.height > 150;
      wrap.classList.toggle('away', keyboard);
      schedulePlace();
    });
    place();

    // ---- Tap and hold
    let holdTimer = null, held = false, startX = 0, startY = 0, menu = null;
    const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
    function openMenu() {
      closeMenu();
      menu = document.createElement('div');
      menu.id = 'bob-menu';
      menu.setAttribute('role', 'menu');
      const r = wrap.getBoundingClientRect();
      if (wrap.classList.contains('in-header')) { menu.style.top = `${Math.round(r.bottom + 6)}px`; menu.style.left = `${Math.max(8, Math.round(r.left - 150))}px`; menu.style.bottom = 'auto'; }
      else menu.style.bottom = `${Math.round(innerHeight - r.top + 6)}px`;
      const entries = [
        ['Talk to Bob', () => talk()],
        ['Open Chowaniec AI', () => { location.href = '/ai/'; }],
        ['Search & jump', () => window.ChowaniecQuickJump && window.ChowaniecQuickJump.open()],
        ['Catch me up (read aloud)', () => { location.href = '/ai/?run=recap&speak=1'; }]
      ];
      entries.forEach(([label, fn]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.textContent = label;
        b.addEventListener('click', () => { closeMenu(); fn(); });
        menu.appendChild(b);
      });
      document.body.appendChild(menu);
      menu.querySelector('button').focus();
      if (window.ChowaniecHaptics) window.ChowaniecHaptics.tap('medium');
      bob.dataset.state = 'listening';
    }
    document.addEventListener('pointerdown', (e) => { if (menu && !menu.contains(e.target) && !wrap.contains(e.target)) { closeMenu(); if (!panel || !panel.open) rest(); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu) { closeMenu(); rest(); bob.focus(); } });

    const busy = () => panel && panel.open && panel.session.state !== 'idle';
    bob.addEventListener('pointerdown', (e) => {
      held = false; startX = e.clientX; startY = e.clientY;
      clearTimeout(holdTimer);
      if (!busy()) bob.dataset.state = 'listening';
      holdTimer = setTimeout(() => { held = true; openMenu(); }, 480);
    });
    const cancel = () => clearTimeout(holdTimer);
    bob.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) cancel(); });
    bob.addEventListener('pointercancel', () => { cancel(); if (!menu && !busy()) rest(); });
    bob.addEventListener('pointerup', cancel);
    bob.addEventListener('click', (e) => {
      e.preventDefault();
      cancel();
      if (held) { held = false; return; }
      if (window.ChowaniecHaptics) window.ChowaniecHaptics.tap('light');
      talk();
    });
    bob.addEventListener('contextmenu', (e) => e.preventDefault());
    bob.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); talk(); }
      else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); openMenu(); }
    });

    // ---- Moods
    window.addEventListener('chowaniec-celebrate', (e) => {
      celebrating = true;
      clearTimeout(stateTimer);
      bob.dataset.state = 'celebrate';
      const why = e.detail && e.detail.why;
      hint(why === 'poll' ? 'Everyone voted!' : why === 'sheet' ? 'Every slot is taken!' : why === 'birthday' ? 'Happy birthday!' : 'Hooray!', 3500);
      stateTimer = setTimeout(() => { celebrating = false; if (!busy()) rest(); }, 3600);
    });
    if (night()) setTimeout(() => { if (!signedIn()) return; hint('Zzz… it’s late. Tap me if you need me.', 3500); }, 1500);
  }

  Promise.all([
    ensure('link', { rel: 'stylesheet', href: '/robot.css' }),
    window.ChowaniecRobot ? Promise.resolve() : ensure('script', { src: '/robot.js' }),
    window.BobVoice ? Promise.resolve() : ensure('script', { src: '/voice.js' })
  ]).then(() => {
    const go = () => { if (window.ChowaniecRobot) start(); };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
  });
})();
