// The Chowaniec AI's little robot ("Bob"): a face for avatars and a full mascot for meetings.
// window.ChowaniecRobot.face()   -> small inline SVG face (used as the AI's profile picture)
// window.ChowaniecRobot.mascot() -> HTML for the animated mascot (see /meet/ and robot.css)
(function () {
  'use strict';
  const face = (cls) => `<svg class="bob-face ${cls || ''}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <line x1="24" y1="4" x2="24" y2="11" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="24" cy="4" r="3" fill="#fbbf24"/>
    <rect x="7" y="11" width="34" height="28" rx="10" fill="#fff"/>
    <rect x="3" y="21" width="5" height="9" rx="2.5" fill="#fff" opacity=".85"/><rect x="40" y="21" width="5" height="9" rx="2.5" fill="#fff" opacity=".85"/>
    <circle cx="17" cy="23" r="4" fill="#3b0764"/><circle cx="31" cy="23" r="4" fill="#3b0764"/>
    <circle cx="18.2" cy="21.8" r="1.2" fill="#fff"/><circle cx="32.2" cy="21.8" r="1.2" fill="#fff"/>
    <path d="M16 31 Q24 37 32 31" fill="none" stroke="#3b0764" stroke-width="2.6" stroke-linecap="round"/></svg>`;

  // The mascot: head with antenna, eyes, a mouth that moves while talking, arms, and a little laptop.
  // States (set as data-state on the root): idle | listening | thinking | talking | asleep
  const mascot = () => `<div class="bob" data-state="asleep" role="button" tabindex="0" aria-label="Bob, the AI helper. Tap to wake.">
    <div class="bob-bubbles" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="bob-say hidden" role="status"></div>
    <svg class="bob-svg" viewBox="0 0 120 130" aria-hidden="true" focusable="false">
      <g class="bob-body">
        <line x1="60" y1="10" x2="60" y2="24" stroke="#4c1d95" stroke-width="3" stroke-linecap="round"/>
        <circle class="bob-bulb" cx="60" cy="9" r="5" fill="#fbbf24"/>
        <rect x="26" y="24" width="68" height="50" rx="18" fill="#ede9fe" stroke="#4c1d95" stroke-width="3"/>
        <rect x="18" y="40" width="8" height="18" rx="4" fill="#c4b5fd" stroke="#4c1d95" stroke-width="2"/><rect x="94" y="40" width="8" height="18" rx="4" fill="#c4b5fd" stroke="#4c1d95" stroke-width="2"/>
        <g class="bob-eyes"><ellipse class="bob-eye l" cx="46" cy="46" rx="7" ry="8" fill="#3b0764"/><ellipse class="bob-eye r" cx="74" cy="46" rx="7" ry="8" fill="#3b0764"/>
          <circle cx="48" cy="43" r="2.2" fill="#fff"/><circle cx="76" cy="43" r="2.2" fill="#fff"/></g>
        <g class="bob-mouth"><path class="bob-mouth-closed" d="M46 62 Q60 70 74 62" fill="none" stroke="#3b0764" stroke-width="3.5" stroke-linecap="round"/>
          <ellipse class="bob-mouth-open" cx="60" cy="64" rx="9" ry="6" fill="#3b0764"/></g>
        <rect x="40" y="76" width="40" height="22" rx="8" fill="#c4b5fd" stroke="#4c1d95" stroke-width="3"/>
        <circle cx="52" cy="87" r="3" fill="#7c3aed"/><circle cx="68" cy="87" r="3" fill="#a78bfa"/>
        <g class="bob-arm l"><rect x="22" y="80" width="20" height="9" rx="4.5" fill="#c4b5fd" stroke="#4c1d95" stroke-width="2.5"/></g>
        <g class="bob-arm r"><rect x="78" y="80" width="20" height="9" rx="4.5" fill="#c4b5fd" stroke="#4c1d95" stroke-width="2.5"/></g>
      </g>
      <g class="bob-laptop"><path d="M22 118 L30 100 H90 L98 118 Z" fill="#374151" stroke="#111827" stroke-width="2.5" stroke-linejoin="round"/>
        <rect x="14" y="118" width="92" height="7" rx="3.5" fill="#6b7280" stroke="#111827" stroke-width="2.5"/>
        <circle cx="60" cy="109" r="3" fill="#a78bfa"/></g>
      <text class="bob-z" x="96" y="26" font-size="14" font-weight="700" fill="#7c3aed">z</text>
    </svg></div>`;

  window.ChowaniecRobot = { face, mascot };
})();
