// Tiny shared haptics helper. window.ChowaniecHaptics.tap('light' | 'medium' | 'success')
// Does nothing when the device has no vibration, when the person prefers reduced motion,
// or when they switched it off (localStorage chowaniec_haptics = "off").
(function () {
  const PATTERNS = { light: 8, medium: 18, success: [12, 40, 18] };
  function enabled() {
    try {
      if (localStorage.getItem('chowaniec_haptics') === 'off') return false;
    } catch (e) { /* storage unavailable: keep default */ }
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    } catch (e) { /* ignore */ }
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }
  function tap(kind) {
    if (!enabled()) return false;
    try { return navigator.vibrate(PATTERNS[kind] || PATTERNS.light); } catch (e) { return false; }
  }
  window.ChowaniecHaptics = { tap, enabled };
})();
