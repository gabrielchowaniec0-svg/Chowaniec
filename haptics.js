// Shared haptics for every Chowaniec page (loaded by /pwa.js; some pages also load it directly).
//   ChowaniecHaptics.tap()        a light tick (buttons)        tap('light' | 'medium' | 'heavy' | 'success' | …) still works
//   ChowaniecHaptics.selection()  a tiny tick (toggles, pickers)
//   ChowaniecHaptics.success()    a double pulse (sent, saved, done)
//   ChowaniecHaptics.warning()    a triple pulse (destructive confirmations)
//   ChowaniecHaptics.error()      a firmer triple pulse (something failed)
//   ChowaniecHaptics.impact(w)    'light' | 'medium' | 'heavy'
//   ChowaniecHaptics.buzz(p, o)   a raw navigator.vibrate pattern (ringing, game bumps); o.always ignores the on/off switch
//   ChowaniecHaptics.status()     { method: 'vibrate' | 'ios-switch' | 'none', reason } (used by the ?haptics=test panel)
//
// How it buzzes:
//   Android / other phones with navigator.vibrate: the patterns below. Chrome ignores vibrate() (and logs an
//     "intervention" warning) until the person has tapped the page once, so nothing is sent before that.
//   iPhone / iPad (Safari, the installed app, and any other iOS browser - they are all WebKit): there is no
//     vibration API, but since iOS 18 toggling an <input type="checkbox" switch> from a tap plays the system
//     "switch" haptic. We keep one hidden label + switch and click the label. It only works while WebKit still
//     counts the call as part of a tap, so it is tried only during (or within a second of) a real tap, and
//     each pulse is one "tick" (success = 2, warning/error = 3, spaced 110 ms; the timers are started from the
//     tap itself so WebKit forwards the gesture to them).
//   Desktop (no touch screen): nothing.
// Off only when switched off in Settings (localStorage chowaniec_haptics = "off").
// Calls closer together than 45 ms are merged, so a page and the shared tap handler never buzz twice for one tap -
// unless the later one is stronger (e.g. success right after the send button's tap), which then wins.
// Visit any page with ?haptics=test for a small panel with a button per haptic and the method in use.
(function () {
  'use strict';
  if (window.ChowaniecHaptics && window.ChowaniecHaptics.version >= 3) return;

  // Long enough to feel: many phone motors (Samsung included) render nothing for pulses under ~20 ms.
  const PATTERNS = {
    selection: 22,
    light: 30,
    tap: 30,
    medium: 45,
    heavy: 65,
    success: [35, 70, 50],
    warning: [50, 80, 50, 80, 50],
    error: [80, 70, 80, 70, 80]
  };
  // iOS can only play one fixed tick, so a pattern becomes a number of ticks.
  const TICKS = { selection: 1, light: 1, tap: 1, medium: 1, heavy: 1, success: 2, warning: 3, error: 3 };
  // Within the 45 ms merge window a stronger kind replaces a weaker one; equal or weaker ones are dropped.
  const RANK = { selection: 1, light: 2, tap: 2, medium: 3, heavy: 4, success: 5, warning: 6, error: 7 };
  const MERGE_MS = 45;
  const TICK_GAP_MS = 110;
  const GESTURE_MS = 1000;
  const GESTURE_TYPES = { click: 1, touchend: 1, touchstart: 1, pointerup: 1, pointerdown: 1, mousedown: 1, mouseup: 1, keydown: 1, keyup: 1, change: 1, input: 1, submit: 1 };

  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const isIOS = /iP(hone|ad|od)/.test(ua) ||
    (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);   // iPadOS asks for the desktop site
  const hasSwitch = typeof HTMLInputElement !== 'undefined' && 'switch' in HTMLInputElement.prototype;   // Safari 17.4+
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

  function hasTouch() {
    try {
      if (navigator.maxTouchPoints > 0) return true;
      return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    } catch (e) { return false; }
  }

  // What this device can do, ignoring the person's settings.
  function method() {
    if (isIOS) return hasSwitch ? { method: 'ios-switch', reason: 'iPhone/iPad: hidden switch toggle (needs iOS 18+)' }
      : { method: 'none', reason: 'iPhone/iPad without the switch control (iOS older than 17.4)' };
    if (!canVibrate) return { method: 'none', reason: 'this browser has no vibration API' };
    if (!hasTouch()) return { method: 'none', reason: 'no touch screen (desktop)' };
    return { method: 'vibrate', reason: 'navigator.vibrate' };
  }
  const METHOD = method();

  function setting() {
    try { return localStorage.getItem('chowaniec_haptics') !== 'off'; } catch (e) { return true; }
  }
  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  // Haptics aren't motion on screen, so "reduce motion / remove animations" (often switched on on Samsung
  // phones) no longer turns them off; only the Settings switch does.
  function enabled() {
    return METHOD.method !== 'none' && setting();
  }

  function status() {
    if (METHOD.method === 'none') return METHOD;
    if (!setting()) return { method: 'none', reason: 'switched off in Settings', device: METHOD.method };
    return METHOD;
  }

  // ---------- When are we inside a tap? ----------
  let lastGestureAt = 0;
  function noteGesture(e) { if (e.isTrusted) lastGestureAt = Date.now(); }
  ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'click', 'keydown'].forEach((t) => {
    try { document.addEventListener(t, noteGesture, { capture: true, passive: true }); } catch (e) { /* ignore */ }
  });
  function inGesture() {
    const ev = window.event;
    if (ev && ev.isTrusted && GESTURE_TYPES[ev.type]) return true;
    return Date.now() - lastGestureAt < GESTURE_MS;
  }
  // Chrome only lets vibrate() through after the first tap on the page ("sticky activation").
  function activated() {
    const ua2 = navigator.userActivation;
    if (ua2 && typeof ua2.hasBeenActive === 'boolean') return ua2.hasBeenActive;
    return lastGestureAt > 0;
  }

  // ---------- iOS: hidden switch ----------
  let box = null;
  let label = null;
  let input = null;
  let ticking = false;   // true while our own label click is being dispatched
  function stop(e) { e.stopPropagation(); }
  function ensureSwitch() {
    if (label && label.isConnected) return label;
    const host = document.body || document.documentElement;
    if (!host) return null;
    box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.setAttribute('data-haptic', 'off');   // the shared tap handler in /pwa.js skips anything in here
    box.id = 'chowaniec-haptic-switch';
    // Visually hidden but still laid out (not display:none). The input is visibility:hidden so WebKit's label
    // click can't move focus to it (which would close the keyboard in chat).
    box.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;' +
      'clip:rect(0 0 0 0);clip-path:inset(50%);opacity:0;pointer-events:none;z-index:-1;contain:strict;';
    label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    input.style.cssText = 'visibility:hidden;margin:0;width:1px;height:1px;';
    label.appendChild(input);
    box.appendChild(label);
    // Keep our clicks and change events away from the page's own handlers (they bubble otherwise).
    ['click', 'change', 'input'].forEach((t) => box.addEventListener(t, stop));
    host.appendChild(box);
    return label;
  }
  function tick() {
    const l = ensureSwitch();
    if (!l) return false;
    const before = document.activeElement;
    const sx = window.scrollX;
    const sy = window.scrollY;
    ticking = true;
    try { l.click(); } catch (e) { return false; } finally { ticking = false; }
    // Belt and braces: if WebKit did move focus or scroll, put it back.
    if (document.activeElement === input) {
      try { input.blur(); } catch (e) { /* ignore */ }
      if (before && before !== document.body && typeof before.focus === 'function') { try { before.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
    if (window.scrollX !== sx || window.scrollY !== sy) { try { window.scrollTo(sx, sy); } catch (e) { /* ignore */ } }
    return true;
  }
  function ticks(n) {
    if (!tick()) return false;
    // Scheduled now, from inside the tap, so WebKit forwards the gesture to the timers.
    for (let i = 1; i < n; i++) setTimeout(tick, i * TICK_GAP_MS);
    return true;
  }

  // ---------- Playing ----------
  let last = 0;
  let lastKind = null;
  function play(kind) {
    if (!PATTERNS[kind]) kind = 'light';
    if (ticking || !enabled()) return false;
    if (document.visibilityState === 'hidden') return false;
    const now = Date.now();
    let extra = 0;   // ticks already played for the weaker call we're replacing (iOS)
    if (now - last < MERGE_MS && lastKind) {
      if ((RANK[kind] || 0) <= (RANK[lastKind] || 0)) return false;
      extra = TICKS[lastKind] || 1;
    }
    if (METHOD.method === 'vibrate') {
      if (!activated()) return false;
      last = now; lastKind = kind;
      try { return navigator.vibrate(PATTERNS[kind]) !== false; } catch (e) { return false; }
    }
    if (METHOD.method === 'ios-switch') {
      if (!inGesture()) return false;
      last = now; lastKind = kind;
      if (!extra) return ticks(TICKS[kind] || 1);
      // Upgrading a tick that already played (tap, then success): add the missing ticks after it.
      for (let i = 1; i <= (TICKS[kind] || 1) - extra; i++) setTimeout(tick, i * TICK_GAP_MS);
      return true;
    }
    return false;
  }

  // Raw pattern for things that aren't button feedback (incoming call ringing, a game bump). Android only.
  function buzz(pattern, opts) {
    opts = opts || {};
    if (METHOD.method !== 'vibrate' || !activated()) return false;
    if (!opts.always && !setting()) return false;
    try { return navigator.vibrate(pattern) !== false; } catch (e) { return false; }
  }

  window.ChowaniecHaptics = {
    version: 3,
    enabled,
    status,
    patterns: PATTERNS,
    tap: (kind) => play(kind || 'light'),
    selection: () => play('selection'),
    success: () => play('success'),
    warning: () => play('warning'),
    error: () => play('error'),
    impact: (weight) => play(weight === 'heavy' ? 'heavy' : weight === 'medium' ? 'medium' : 'light'),
    buzz
  };

  // ---------- ?haptics=test diagnostic panel ----------
  function panel() {
    if (document.getElementById('chowaniec-haptics-test')) return;
    const p = document.createElement('div');
    p.id = 'chowaniec-haptics-test';
    p.setAttribute('data-haptic', 'off');
    p.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:2147483000;max-width:420px;margin:0 auto;' +
      'background:rgba(20,20,24,.94);color:#fff;font:13px/1.35 system-ui,-apple-system,sans-serif;border-radius:14px;padding:10px 12px;box-shadow:0 8px 30px rgba(0,0,0,.35);';
    const kinds = ['selection', 'tap', 'medium', 'heavy', 'success', 'warning', 'error'];
    p.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">' +
      '<b>Haptics test</b><button type="button" data-x="close" style="all:unset;cursor:pointer;padding:2px 8px;opacity:.8">Close</button></div>' +
      '<div data-x="info" style="opacity:.85;margin-bottom:8px"></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px">' + kinds.map((k) => '<button type="button" data-k="' + k + '" style="all:unset;cursor:pointer;' +
        'background:#3b82f6;color:#fff;border-radius:9px;padding:8px 10px;font-weight:600">' + k + '</button>').join('') + '</div>' +
      '<div data-x="log" style="opacity:.7;margin-top:8px;font-size:12px"></div>';
    const info = p.querySelector('[data-x="info"]');
    const log = p.querySelector('[data-x="log"]');
    function render() {
      const s = status();
      const act = navigator.userActivation ? (navigator.userActivation.hasBeenActive ? 'yes' : 'not yet') : 'n/a';
      info.textContent = 'Method: ' + (s.method === 'ios-switch' ? 'iOS switch' : s.method) + ' (' + s.reason + ')' +
        ' · Setting: ' + (setting() ? 'on' : 'off') + ' · Reduce motion: ' + (reducedMotion() ? 'yes' : 'no') + ' · Tapped yet: ' + act;
    }
    p.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button');
      if (!b) return;
      if (b.getAttribute('data-x') === 'close') { p.remove(); return; }
      const k = b.getAttribute('data-k');
      if (!k) return;
      last = 0; lastKind = null;   // let every press through, even quick repeats
      const ok = window.ChowaniecHaptics[k] ? window.ChowaniecHaptics[k]() : play(k);
      log.textContent = k + ': ' + (ok ? 'sent' : 'not sent') + ' at ' + new Date().toLocaleTimeString() +
        (ok && METHOD.method === 'ios-switch' ? ' · nothing felt? Needs iOS 18+ and Settings › Sounds & Haptics › System Haptics on' : '');
      render();
    });
    document.body.appendChild(p);
    render();
  }
  try {
    if (/(?:^|[?&])haptics=test(?:&|$)/.test(location.search)) {
      if (document.body) panel(); else document.addEventListener('DOMContentLoaded', panel);
    }
  } catch (e) { /* ignore */ }
})();
