// Shared haptics for every Chowaniec page (loaded by /pwa.js; some pages also load it directly).
//   ChowaniecHaptics.tap()        a light tick (buttons)        tap('light' | 'medium' | 'heavy' | 'success' | …) still works
//   ChowaniecHaptics.selection()  a tiny tick (toggles, pickers)
//   ChowaniecHaptics.success()    a double pulse (sent, saved, done)
//   ChowaniecHaptics.warning()    a longer triple pulse (errors, destructive confirmations)
// Uses navigator.vibrate where the phone has it (Android). iPhone Safari has no vibration API, so it quietly does
// nothing there. Also off when the person prefers reduced motion or switched it off (localStorage chowaniec_haptics = "off").
// Calls closer together than 45 ms are merged, so a page and the shared tap handler never buzz twice for one tap.
(function () {
  'use strict';
  if (window.ChowaniecHaptics && window.ChowaniecHaptics.version >= 2) return;
  const PATTERNS = {
    selection: 5,
    light: 8,
    tap: 8,
    medium: 18,
    heavy: 30,
    success: [12, 40, 18],
    warning: [24, 60, 24, 60, 24],
    error: [40, 60, 40]
  };
  let last = 0;

  function enabled() {
    try {
      if (localStorage.getItem('chowaniec_haptics') === 'off') return false;
    } catch (e) { /* storage unavailable: keep default */ }
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    } catch (e) { /* ignore */ }
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  function play(kind) {
    if (!enabled()) return false;
    const now = Date.now();
    if (now - last < 45) return false;
    last = now;
    try { return navigator.vibrate(PATTERNS[kind] || PATTERNS.light); } catch (e) { return false; }
  }

  window.ChowaniecHaptics = {
    version: 2,
    enabled,
    patterns: PATTERNS,
    tap: (kind) => play(kind || 'light'),
    selection: () => play('selection'),
    success: () => play('success'),
    warning: () => play('warning'),
    error: () => play('error'),
    impact: (weight) => play(weight === 'heavy' ? 'heavy' : weight === 'medium' ? 'medium' : 'light')
  };
})();
