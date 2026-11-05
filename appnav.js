// Chowaniec app navigation + small UI helpers (loaded on every page by /pwa.js).
//
//   - Phones: a floating frosted tab bar (Home, Chats, Games, Calendar, More). Desktop (>= 1024px): a slim left rail.
//   - "More" opens a bottom sheet with every other app.
//   - Unread badge on Chats from GET /.netlify/functions/unread -> { total } (every 20 s while visible; hidden on 404).
//   - Hidden on immersive pages (the chat, a game, Meet in a call, a watch party) and while the keyboard is open.
//     A page can also opt out with <html data-appnav="off">, or call ChowaniecNav.hide() / .show().
//   - Page transitions: cross-document View Transitions (rules in /theme.css); elsewhere a quick fade fallback.
//   - Swipe from the left edge on a phone to go back.
//
// window.ChowaniecNav = { show(), hide(), refresh(), setUnread(n), openMore(), closeMore() }
//   events on window: 'chowaniec-unread' { detail: { total } }
// window.ChowaniecUI  = { icon(name, size), avatar(name, opts), colorFor(name), sheet(elOrSelector), initHeaders(root), esc(text) }
//   icon names: home, chats, message, messages, gamepad, calendar, calendarPlus, grid, bot, notes, lists, video, tv, trophy,
//   search, settings, phone, download, smartphone, plus, x, chevronRight, chevronLeft, arrowUpRight, users, sparkles, cake,
//   mapPin, sun, moon, cloud, cloudSun, cloudRain, cloudSnow, cloudFog, cloudBolt, logOut, menu, lock, info, fileText,
//   share, play, zap, radio, clock, award, star, pen, locate, flame, wind, droplet, bell
(function () {
  'use strict';
  if (window.ChowaniecNav) return;
  var root = document.documentElement;
  var path = location.pathname.replace(/index\.html$/, '');

  // ---------- icons (lucide-style, 24px grid, stroke = currentColor) ----------
  var CLOUD = '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.24"/>';
  var P = {
    home: '<path d="M3 10.2 12 3l9 7.2V20a1.5 1.5 0 0 1-1.5 1.5H15v-6.5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v6.5H4.5A1.5 1.5 0 0 1 3 20z"/>',
    chats: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
    message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    messages: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
    gamepad: '<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.59C2.6 9.42 2 14.46 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.41-1.41A2 2 0 0 1 9.83 16h4.34a2 2 0 0 1 1.41.59L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.54-.6-6.58-.69-7.26A4 4 0 0 0 17.32 5z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2.5"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
    calendarPlus: '<rect x="3" y="4" width="18" height="18" rx="2.5"/><path d="M16 2v4M8 2v4M3 10h18M12 13.5v5M9.5 16h5"/>',
    grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
    bot: '<path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2.5"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
    notes: '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4M2 10h4M2 14h4M2 18h4"/><path d="M21.38 5.63a2.12 2.12 0 1 0-3-3l-5.02 5.01a2 2 0 0 0-.5.86l-.84 2.87a.5.5 0 0 0 .62.62l2.87-.84a2 2 0 0 0 .86-.5z"/>',
    lists: '<path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
    video: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2.5"/>',
    tv: '<rect x="2" y="7" width="20" height="15" rx="2.5"/><path d="m17 2-5 5-5-5"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    search: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.35-4.35"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    smartphone: '<rect x="5" y="2" width="14" height="20" rx="2.5"/><path d="M12 18h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    arrowUpRight: '<path d="M7 7h10v10M7 17 17 7"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    sparkles: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/><path d="M20 3v4M22 5h-4"/>',
    cake: '<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1M2 21h20M7 8v3M12 8v3M17 8v3M7 4h.01M12 4h.01M17 4h.01"/>',
    mapPin: '<path d="M20 10c0 5-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    cloudSun: '<path d="M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41M15.95 12.65a4 4 0 0 0-5.93-4.13"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>',
    cloudRain: CLOUD + '<path d="M16 14v6M8 14v6M12 16v6"/>',
    cloudSnow: CLOUD + '<path d="M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01"/>',
    cloudFog: CLOUD + '<path d="M16 17H7M17 21H9"/>',
    cloudBolt: CLOUD + '<path d="m13 12-3 5h4l-3 5"/>',
    logOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2.5"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
    play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    radio: '<circle cx="12" cy="12" r="2"/><path d="M4.93 19.07a10 10 0 0 1 0-14.14M7.76 16.24a6 6 0 0 1 0-8.49M16.24 7.76a6 6 0 0 1 0 8.49M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/>',
    star: '<path d="M11.52 2.3a.53.53 0 0 1 .96 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .29-.9l5.17-.76a2.12 2.12 0 0 0 1.6-1.16z"/>',
    pen: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.38 2.63a2.12 2.12 0 1 1 3 3l-9.01 9.01a2 2 0 0 1-.85.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.85z"/>',
    locate: '<path d="M2 12h3M19 12h3M12 2v3M12 19v3"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    wind: '<path d="M12.8 19.6A2 2 0 1 0 14 16H2M17.5 8a2.5 2.5 0 1 1 2 4H2M9.8 4.4A2 2 0 1 1 11 8H2"/>',
    droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
    bell: '<path d="M10.27 21a2 2 0 0 0 3.46 0M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"/>'
  };
  // lucide names used by /directory.js
  var ALIAS = { 'messages-square': 'chats', 'message-circle': 'message', 'notebook-pen': 'notes', 'list-checks': 'lists', 'gamepad-2': 'gamepad',
    'calendar-days': 'calendar', 'calendar-plus': 'calendarPlus', 'map-pin': 'mapPin', 'log-out': 'logOut', 'file-text': 'fileText', 'share-2': 'share',
    'arrow-up-right': 'arrowUpRight', 'chevron-right': 'chevronRight', 'chevron-left': 'chevronLeft', 'square-pen': 'pen', 'layout-grid': 'grid' };
  function icon(name, size, extra) {
    var d = P[name] || P[ALIAS[name]] || P.grid;
    size = size || 24;
    return '<svg class="ch-ic' + (extra ? ' ' + extra : '') + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + d + '</svg>';
  }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var COLORS = ['#e11d48', '#2563eb', '#0d9488', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#475569'];
  function colorFor(name) { var h = 0; name = String(name || ''); for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; }
  function avatar(name, opts) {
    opts = opts || {};
    var cls = 'ch-avatar' + (opts.size ? ' ch-avatar--' + opts.size : '');
    var inner = opts.icon ? icon(opts.icon, 24) : esc(String(name || '?').trim().charAt(0).toUpperCase() || '?');
    return '<span class="' + cls + '" style="--_c:' + (opts.color || colorFor(name)) + '" aria-hidden="true">' + inner + (opts.online ? '<span class="ch-avatar__presence"></span>' : '') + '</span>';
  }

  // ---------- small helpers ----------
  var user = function () { try { return window.getChowaniecUser ? window.getChowaniecUser() : JSON.parse(sessionStorage.getItem('chowaniec_user') || 'null'); } catch (e) { return null; } };
  var reduced = function () { return root.getAttribute('data-motion') === 'reduced' || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); };
  var coarse = window.matchMedia ? matchMedia('(pointer: coarse)').matches : ('ontouchstart' in window);
  var hap = function (k) { if (window.ChowaniecHaptics && window.ChowaniecHaptics.tap) try { window.ChowaniecHaptics.tap(k || 'light'); } catch (e) { /* ignore */ } };

  // ---------- styles ----------
  var CSS = [
    // tab bar (phones)
    '.ch-nav{position:fixed;z-index:var(--ch-z-nav,45);left:12px;right:12px;bottom:var(--ch-tabbar-gap,10px);height:var(--ch-tabbar-h,62px);max-width:520px;margin:0 auto;display:flex;align-items:stretch;justify-content:space-around;padding:0 6px;',
    'border-radius:26px;background:var(--ch-glass-strong,rgba(255,255,255,.86));-webkit-backdrop-filter:saturate(1.8) blur(24px);backdrop-filter:saturate(1.8) blur(24px);',
    'border:1px solid var(--ch-glass-border,rgba(0,0,0,.08));box-shadow:0 10px 30px -10px rgba(17,17,26,.28),0 2px 8px rgba(17,17,26,.06),inset 0 1px 0 rgba(255,255,255,.35);',
    'font-family:var(--ch-font-ui,Outfit,system-ui,sans-serif);view-transition-name:ch-nav;transition:transform .38s cubic-bezier(.22,1,.36,1),opacity .25s ease;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}',
    'html[data-theme="dark"] .ch-nav{box-shadow:0 14px 34px -10px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.06)}',
    '.ch-nav[hidden]{display:none}',
    '.ch-nav.is-away{transform:translateY(calc(100% + 40px));opacity:0;pointer-events:none}',
    '.ch-nav.is-new{animation:ch-nav-in .55s cubic-bezier(.22,1,.36,1) both}',
    '@keyframes ch-nav-in{from{transform:translateY(calc(100% + 30px));opacity:0}}',
    '.ch-tab{position:relative;flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border:0;background:none;padding:0;margin:0;cursor:pointer;',
    'color:var(--ch-muted,#6b6b73);text-decoration:none;font:600 10.5px/1 var(--ch-font-ui,Outfit,system-ui,sans-serif);letter-spacing:.01em;border-radius:20px;outline:none}',
    '.ch-tab__ic{position:relative;display:flex;align-items:center;justify-content:center;width:52px;height:30px;border-radius:15px;transition:background-color .25s ease,color .2s ease,transform .3s cubic-bezier(.34,1.4,.5,1)}',
    '.ch-tab__ic svg{width:23px;height:23px;transition:transform .3s cubic-bezier(.34,1.4,.5,1)}',
    '.ch-tab:active .ch-tab__ic{transform:scale(.88)}',
    '.ch-tab[aria-current="page"],.ch-tab.is-on{color:var(--ch-accent-text,#0a0a0a)}',
    '.ch-tab[aria-current="page"] .ch-tab__ic,.ch-tab.is-on .ch-tab__ic{background:color-mix(in srgb,var(--ch-accent,#0a0a0a) 14%,transparent)}',
    '.ch-tab[aria-current="page"] .ch-tab__ic svg{stroke-width:2.3}',
    '.ch-nav .ch-tab:focus-visible{outline:none!important;box-shadow:none!important}.ch-tab:focus-visible .ch-tab__ic{box-shadow:var(--ch-focus)}',
    '.ch-tab__badge{position:absolute;top:-3px;left:calc(50% + 5px);min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--ch-danger,#dc2626);color:#fff;',
    'font:700 10.5px/18px var(--ch-font-ui,Outfit,system-ui,sans-serif);text-align:center;box-shadow:0 0 0 2px var(--ch-surface,#fff);font-variant-numeric:tabular-nums;animation:ch-badge-in .4s cubic-bezier(.34,1.5,.5,1)}',
    '.ch-tab__badge[hidden]{display:none}',
    '@keyframes ch-badge-in{from{transform:scale(.3);opacity:0}}',
    '.ch-nav__brand{display:none}',
    // desktop rail
    '@media (min-width:1024px){',
    '.ch-nav{left:0;right:auto;top:0;bottom:0;height:auto;width:var(--ch-rail-w,84px);max-width:none;margin:0;flex-direction:column;justify-content:flex-start;gap:6px;padding:14px 8px 18px;border-radius:0;',
    'border:0;border-right:1px solid var(--ch-line,rgba(0,0,0,.08));box-shadow:none;background:var(--ch-glass-bg,rgba(255,255,255,.7))}',
    'html[data-theme="dark"] .ch-nav{box-shadow:none}',
    '.ch-nav.is-away{transform:translateX(-110%)}',
    '@keyframes ch-nav-in{from{transform:translateX(-100%);opacity:0}}',
    '.ch-nav__brand{display:flex;align-items:center;justify-content:center;width:46px;height:46px;margin:0 auto 14px;border-radius:15px;background:var(--ch-accent,#0a0a0a);color:var(--ch-accent-ink,#fff);',
    'font:600 21px/1 var(--ch-font-display,"Playfair Display",Georgia,serif);text-decoration:none;box-shadow:0 8px 18px -8px color-mix(in srgb,var(--ch-accent,#000) 70%,transparent)}',
    '.ch-tab{flex:none;height:64px;gap:5px;font-size:11px}',
    '.ch-tab__ic{width:48px;height:34px;border-radius:12px}',
    '.ch-tab:hover .ch-tab__ic{background:var(--ch-surface-2,#f4f4f5)}',
    '.ch-tab[aria-current="page"]:hover .ch-tab__ic{background:color-mix(in srgb,var(--ch-accent,#0a0a0a) 16%,transparent)}',
    '.ch-tab--more{margin-top:auto}',
    '}',
    // more sheet grid
    '.ch-more__grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px 8px;padding:4px 0 8px}',
    '@media (min-width:480px){.ch-more__grid{grid-template-columns:repeat(5,minmax(0,1fr))}}',
    '.ch-more__item{display:flex;flex-direction:column;align-items:center;gap:8px;text-decoration:none;color:var(--ch-text,#0a0a0a);font:500 12.5px/1.2 var(--ch-font-ui,Outfit,sans-serif);text-align:center;border-radius:16px;padding:4px 0;-webkit-tap-highlight-color:transparent}',
    '.ch-more__item:focus-visible{outline:none;box-shadow:var(--ch-focus)}',
    '.ch-more__tile{width:58px;height:58px;border-radius:18px;display:flex;align-items:center;justify-content:center;color:#fff;background:linear-gradient(150deg,color-mix(in srgb,var(--c) 70%,#fff),var(--c) 70%);',
    'box-shadow:inset 0 -2px 0 rgba(0,0,0,.14),inset 0 1px 0 rgba(255,255,255,.3),0 8px 16px -8px color-mix(in srgb,var(--c) 80%,transparent);transition:transform .3s cubic-bezier(.34,1.4,.5,1)}',
    '.ch-more__tile svg{width:26px;height:26px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.2))}',
    '.ch-more__item:hover .ch-more__tile{transform:translateY(-2px)}',
    '.ch-more__item:active .ch-more__tile{transform:scale(.9)}',
    '.ch-sheet.is-open .ch-more__item{animation:ch-more-in .45s cubic-bezier(.22,1,.36,1) both;animation-delay:calc(var(--i,0) * 22ms + 60ms)}',
    '@keyframes ch-more-in{from{opacity:0;transform:translateY(10px) scale(.94)}}',
    '.ch-more__me{display:flex;align-items:center;gap:12px;margin-top:14px;padding:12px 14px;border-radius:18px;background:var(--ch-surface-2,#f4f4f5);color:var(--ch-text);text-decoration:none}',
    '.ch-more__me b{display:block;font-weight:600;font-size:15px}.ch-more__me small{display:block;color:var(--ch-muted);font-size:12.5px;margin-top:2px}',
    '.ch-more__me .ch-ic{margin-left:auto;color:var(--ch-faint)}',
    // swipe back
    '.ch-swipe{position:fixed;z-index:2147483300;left:0;top:50%;width:44px;height:44px;margin:-22px 0 0 -52px;border-radius:50%;display:flex;align-items:center;justify-content:center;pointer-events:none;',
    'background:var(--ch-glass-strong,rgba(255,255,255,.9));-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);color:var(--ch-text,#111);box-shadow:0 6px 20px rgba(0,0,0,.2);border:1px solid var(--ch-glass-border,rgba(0,0,0,.08));transition:background-color .15s,color .15s}',
    '.ch-swipe.is-ready{background:var(--ch-accent,#111);color:var(--ch-accent-ink,#fff)}',
    '.ch-swipe-shade{position:fixed;inset:0;z-index:2147483290;pointer-events:none;background:linear-gradient(90deg,rgba(0,0,0,.18),transparent 40%);opacity:0}',
    // fallback page transition (browsers without cross-document View Transitions)
    'html.ch-leaving body{opacity:0;transform:translateY(6px);transition:opacity .14s ease,transform .14s ease}',
    // keep floating bits clear of the tab bar; the hub button is redundant next to Home
    'html[data-nav="on"] [onclick="returnToHub()"][title="Return to Hub"]{display:none!important}',
    'html[data-nav="on"] #bob-float:not(.in-header),html[data-nav="on"] #toast.fixed,html[data-nav="on"] .toast,html[data-nav="on"] #chowaniec-notify-card.at-bottom{translate:0 calc(-1 * var(--ch-nav-bottom,0px))}',
    '@media (min-width:1024px){html[data-nav="on"] #bob-float:not(.in-header){translate:var(--ch-rail-w,84px) 0}}',
    '@media print{.ch-nav,.ch-swipe{display:none!important}}'
  ].join('');

  function injectCss() {
    if (document.getElementById('ch-appnav-css')) return;
    var st = document.createElement('style');
    st.id = 'ch-appnav-css';
    st.textContent = CSS;
    (document.head || root).appendChild(st);
    // The More sheet and avatars use the shared design system; every rule in it is .ch-* scoped, so it is safe anywhere.
    if (!document.querySelector('link[href="/design.css"]')) {
      var l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = '/design.css';
      (document.head || root).insertBefore(l, st);
    }
  }

  // ---------- routes ----------
  var TABS = [
    { id: 'home', label: 'Home', href: '/', icon: 'home' },
    { id: 'chats', label: 'Chats', href: '/messages/', icon: 'chats' },
    { id: 'games', label: 'Games', href: '/games/', icon: 'gamepad' },
    { id: 'calendar', label: 'Calendar', href: '/calendar/', icon: 'calendar' }
  ];
  var MORE = [
    { label: 'Ask Bob', href: '/ai/', icon: 'bot', c: '#7c3aed' },
    { label: 'Group chat', href: '/group/', icon: 'users', c: '#0d9488' },
    { label: 'Notes', href: '/notes/', icon: 'notes', c: '#d97706' },
    { label: 'Lists', href: '/lists/', icon: 'lists', c: '#16a34a' },
    { label: 'Meet', href: '/meet/', icon: 'video', c: '#0284c7' },
    { label: 'Watch party', href: '/watch/', icon: 'tv', c: '#e11d48' },
    { label: 'Trophies', href: '/trophies/', icon: 'trophy', c: '#ca8a04' },
    { label: 'Search', href: '/search/', icon: 'search', c: '#475569' },
    { label: 'Settings', href: '/settings/', icon: 'settings', c: '#52525b' },
    { label: 'Get the app', href: '/get-the-app/', icon: 'download', c: '#4f46e5' }
  ];
  function activeTab() {
    if (path === '/' || path === '') return 'home';
    if (/^\/(messages|group)(\/|$)/.test(path)) return 'chats';
    if (/^\/games(\/|$)/.test(path)) return 'games';
    if (/^\/calendar(\/|$)/.test(path)) return 'calendar';
    return 'more';
  }
  // Pages where the bar would get in the way.
  function immersive() {
    if (root.getAttribute('data-appnav') === 'off' || (document.body && document.body.hasAttribute('data-immersive'))) return true;
    if (/^\/group(\/|$)/.test(path)) return true;                         // a chat conversation
    if (/^\/games\/[^/]+/.test(path)) return true;                       // a game
    if (/^\/watch(\/|$)/.test(path) && location.search.length > 1) return true;   // a watch party
    if (/^\/offline/.test(path)) return true;
    if (/^\/meet(\/|$)/.test(path)) {                                     // Meet: only in the lobby, never in a call
      var lobby = document.getElementById('lobby-screen');
      return !lobby || lobby.classList.contains('hidden') || lobby.hidden || getComputedStyle(lobby).display === 'none';
    }
    return false;
  }

  // ---------- the bar ----------
  var nav = null, badge = null, forcedHidden = false, kbOpen = false, built = false;
  function tabHtml(t, on) {
    return '<a class="ch-tab" href="' + t.href + '" data-tab="' + t.id + '"' + (on ? ' aria-current="page"' : '') + '>' +
      '<span class="ch-tab__ic">' + icon(t.icon, 23) + (t.id === 'chats' ? '<span class="ch-tab__badge" hidden></span>' : '') + '</span><span class="ch-tab__label">' + t.label + '</span></a>';
  }
  function build() {
    if (built) return;
    built = true;
    injectCss();
    var act = activeTab();
    nav = document.createElement('nav');
    nav.className = 'ch-nav';
    nav.setAttribute('aria-label', 'Main');
    nav.hidden = true;
    nav.innerHTML = '<a class="ch-nav__brand" href="/" aria-label="Chowaniec home">C</a>' + TABS.map(function (t) { return tabHtml(t, t.id === act); }).join('') +
      '<button type="button" class="ch-tab ch-tab--more' + (act === 'more' ? ' is-on' : '') + '" data-tab="more" aria-haspopup="dialog" aria-expanded="false"><span class="ch-tab__ic">' + icon('grid', 23) + '</span><span class="ch-tab__label">More</span></button>';
    document.body.appendChild(nav);
    badge = nav.querySelector('.ch-tab__badge');
    nav.addEventListener('click', function (e) {
      var a = e.target.closest('.ch-tab');
      if (!a) return;
      hap('light');
      if (a.dataset.tab === 'more') { e.preventDefault(); openMore(); return; }
      // tapping the tab you're on scrolls to the top, like a native app
      if (a.getAttribute('aria-current') === 'page' && a.dataset.tab !== 'chats') {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
        return;
      }
      nav.querySelectorAll('.ch-tab').forEach(function (t) { t.removeAttribute('aria-current'); t.classList.remove('is-on'); });
      a.setAttribute('aria-current', 'page');
    });
    try { if (!sessionStorage.getItem('ch_nav_seen')) { nav.classList.add('is-new'); sessionStorage.setItem('ch_nav_seen', '1'); } } catch (e) { /* ignore */ }
    prefetchTabs();
  }

  function update() {
    var signedIn = !!(user() && user().key);
    var show = signedIn && !forcedHidden && !immersive();
    root.setAttribute('data-nav', show ? 'on' : 'off');
    if (show) { build(); nav.hidden = false; }
    else if (nav) nav.hidden = true;
    if (nav) nav.classList.toggle('is-away', kbOpen);
    if (kbOpen && show) root.setAttribute('data-nav-kb', ''); else root.removeAttribute('data-nav-kb');
    if (show) startUnread(); else stopUnread();
  }

  // ---------- unread badge ----------
  var unreadTimer = null, unreadGone = false, lastUnread = null;
  function setUnread(n) {
    n = Math.max(0, Number(n) || 0);
    if (n !== lastUnread) { lastUnread = n; try { window.dispatchEvent(new CustomEvent('chowaniec-unread', { detail: { total: n } })); } catch (e) { /* ignore */ } }
    if (!badge) return;
    badge.hidden = !n;
    badge.textContent = n > 99 ? '99+' : String(n);
    var chats = nav && nav.querySelector('[data-tab="chats"]');
    if (chats) chats.setAttribute('aria-label', n ? 'Chats, ' + n + ' unread' : 'Chats');
  }
  function pollUnread() {
    var u = user();
    if (unreadGone || !u || !u.key || document.hidden) return;
    fetch('/.netlify/functions/unread', { headers: { 'X-Chowaniec-Key': u.key }, cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 404) { unreadGone = true; stopUnread(); setUnread(0); try { sessionStorage.setItem('ch_unread_404', String(Date.now())); } catch (e) { /* ignore */ } return null; }
        return r.ok ? r.json() : null;
      })
      .then(function (d) { if (d && typeof d.total === 'number') setUnread(d.total); })
      .catch(function () { /* offline: keep the last number */ });
  }
  function startUnread() {
    if (unreadTimer || unreadGone) return;
    try { var gone = Number(sessionStorage.getItem('ch_unread_404') || 0); if (gone && Date.now() - gone < 10 * 60 * 1000) { unreadGone = true; return; } } catch (e) { /* ignore */ }
    pollUnread();
    unreadTimer = setInterval(pollUnread, 20000);
  }
  function stopUnread() { clearInterval(unreadTimer); unreadTimer = null; }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && unreadTimer) pollUnread(); });

  // ---------- bottom sheet helper (design.css .ch-sheet) ----------
  var openSheets = [];
  function sheet(target) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return null;
    if (el._chSheet) return el._chSheet;
    var panel = el.querySelector('.ch-sheet__panel') || el;
    var lastFocus = null, closeTimer = null;
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); api.close(); }
      else if (e.key === 'Tab') {
        var f = Array.prototype.filter.call(panel.querySelectorAll('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])'), function (n) { return n.offsetParent !== null; });
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    }
    var api = {
      el: el,
      isOpen: function () { return el.classList.contains('is-open'); },
      open: function () {
        clearTimeout(closeTimer);
        lastFocus = document.activeElement;
        el.hidden = false;
        el.style.removeProperty('--ch-drag');
        void el.offsetWidth;
        el.classList.add('is-open');
        document.addEventListener('keydown', onKey);
        if (openSheets.indexOf(api) < 0) openSheets.push(api);
        document.documentElement.style.overflow = 'hidden';
        setTimeout(function () { var f = panel.querySelector('[autofocus], a[href], button:not([disabled]), input'); if (f) try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 60);
        el.dispatchEvent(new CustomEvent('ch-sheet-open'));
      },
      close: function () {
        if (!el.classList.contains('is-open')) return;
        el.classList.remove('is-open');
        document.removeEventListener('keydown', onKey);
        openSheets = openSheets.filter(function (s) { return s !== api; });
        if (!openSheets.length) document.documentElement.style.overflow = '';
        closeTimer = setTimeout(function () { el.hidden = true; el.style.removeProperty('--ch-drag'); }, reduced() ? 0 : 380);
        if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        el.dispatchEvent(new CustomEvent('ch-sheet-close'));
      }
    };
    el.addEventListener('click', function (e) { if (e.target === el || e.target.closest('[data-sheet-close]')) api.close(); });
    // drag down to dismiss (from the handle, or anywhere when the panel is scrolled to the top)
    var startY = null, dy = 0, dragging = false;
    panel.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      var fromHandle = !!e.target.closest('.ch-sheet__handle');
      if (!fromHandle && panel.scrollTop > 0) return;
      startY = e.touches[0].clientY; dy = 0; dragging = false;
    }, { passive: true });
    panel.addEventListener('touchmove', function (e) {
      if (startY == null) return;
      dy = e.touches[0].clientY - startY;
      if (!dragging && dy > 8) { dragging = true; el.classList.add('is-dragging'); }
      if (dragging) { el.style.setProperty('--ch-drag', Math.max(0, dy) + 'px'); if (e.cancelable) e.preventDefault(); }
    }, { passive: false });
    panel.addEventListener('touchend', function () {
      if (startY == null) return;
      startY = null;
      el.classList.remove('is-dragging');
      if (dragging && dy > 110) api.close(); else el.style.setProperty('--ch-drag', '0px');
      dragging = false;
    });
    el._chSheet = api;
    return api;
  }

  // ---------- "More" sheet ----------
  var moreSheet = null;
  function buildMore() {
    if (moreSheet) return moreSheet;
    injectCss();
    var u = user() || {};
    var el = document.createElement('div');
    el.className = 'ch-sheet ch-more';
    el.id = 'ch-more';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'ch-more-title');
    el.innerHTML = '<div class="ch-sheet__panel"><div class="ch-sheet__handle" aria-hidden="true"></div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><h2 class="ch-sheet__title" id="ch-more-title" style="margin:0">All apps</h2>' +
      '<button type="button" class="ch-iconbtn" data-sheet-close aria-label="Close">' + icon('x', 22) + '</button></div>' +
      '<div class="ch-more__grid">' + MORE.map(function (m, i) {
        var here = path.indexOf(m.href) === 0;
        return '<a class="ch-more__item" href="' + m.href + '" style="--i:' + i + '"' + (here ? ' aria-current="page"' : '') + '><span class="ch-more__tile" style="--c:' + m.c + '">' + icon(m.icon, 26) + '</span><span>' + esc(m.label) + '</span></a>';
      }).join('') + '</div>' +
      (u.name ? '<a class="ch-more__me" href="/settings/">' + avatar(u.name) + '<span><b>' + esc(u.name) + '</b><small>Profile, theme and notifications</small></span>' + icon('chevronRight', 18) + '</a>' : '') +
      '</div>';
    document.body.appendChild(el);
    moreSheet = sheet(el);
    var btn = function () { return nav && nav.querySelector('[data-tab="more"]'); };
    el.addEventListener('ch-sheet-open', function () { var b = btn(); if (b) { b.setAttribute('aria-expanded', 'true'); b.classList.add('is-on'); } });
    el.addEventListener('ch-sheet-close', function () { var b = btn(); if (b) { b.setAttribute('aria-expanded', 'false'); if (activeTab() !== 'more') b.classList.remove('is-on'); } });
    el.addEventListener('click', function (e) { if (e.target.closest('.ch-more__item')) hap('light'); });
    return moreSheet;
  }
  function openMore() { buildMore().open(); }
  function closeMore() { if (moreSheet) moreSheet.close(); }

  // ---------- on-screen keyboard ----------
  function isEditable(n) {
    if (!n || n.nodeType !== 1) return false;
    if (n.isContentEditable) return true;
    if (n.tagName === 'TEXTAREA' || n.tagName === 'SELECT') return true;
    if (n.tagName !== 'INPUT') return false;
    return !/^(checkbox|radio|button|submit|reset|range|color|file|image|hidden)$/i.test(n.type || 'text');
  }
  function setKb(on) { if (on === kbOpen) return; kbOpen = on; update(); }
  if (coarse) {
    document.addEventListener('focusin', function (e) { if (isEditable(e.target) && !e.target.closest('.ch-sheet')) setKb(true); });
    document.addEventListener('focusout', function () { setTimeout(function () { if (!isEditable(document.activeElement)) setKb(false); }, 120); });
    if (window.visualViewport) {
      visualViewport.addEventListener('resize', function () {
        var open = window.innerHeight - visualViewport.height > 150;
        if (open) setKb(true); else if (!isEditable(document.activeElement)) setKb(false);
      });
    }
  }

  // ---------- swipe from the left edge to go back ----------
  function swipeAllowed() {
    if (!('ontouchstart' in window)) return false;
    if (path === '/' || /^\/games\/[^/]+/.test(path) || /^\/(meet|watch)(\/|$)/.test(path)) return false;
    var forced = null;
    try { forced = localStorage.getItem('chowaniec_swipeback'); } catch (e) { /* ignore */ }
    if (forced === '0') return false;
    if (forced === '1') return true;
    var ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    return !ios || standalone;   // iOS Safari already has its own edge swipe
  }
  function setupSwipe() {
    if (!swipeAllowed()) return;
    var EDGE = 24, GO = 90;
    var sx = 0, sy = 0, st = 0, dx = 0, active = false, decided = false, chip = null, shade = null;
    function ensure() {
      if (chip) return;
      injectCss();
      chip = document.createElement('div'); chip.className = 'ch-swipe'; chip.setAttribute('aria-hidden', 'true'); chip.innerHTML = icon('chevronLeft', 22);
      shade = document.createElement('div'); shade.className = 'ch-swipe-shade';
      document.body.appendChild(shade); document.body.appendChild(chip);
    }
    function paint(x, animate) {
      var t = Math.min(1, x / GO);
      chip.style.transition = animate ? 'transform .25s cubic-bezier(.22,1,.36,1), opacity .2s' : 'none';
      shade.style.transition = animate ? 'opacity .25s' : 'none';
      chip.style.transform = 'translateX(' + Math.min(x * 0.7, 76) + 'px) scale(' + (0.6 + t * 0.4) + ')';
      chip.style.opacity = String(Math.min(1, t * 1.4));
      shade.style.opacity = String(t * 0.9);
      chip.classList.toggle('is-ready', x >= GO);
    }
    document.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1 || openSheets.length) return;
      var t = e.touches[0];
      if (t.clientX > EDGE) return;
      sx = t.clientX; sy = t.clientY; st = Date.now(); dx = 0; active = true; decided = false;
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!active) return;
      var t = e.touches[0];
      dx = t.clientX - sx;
      var dy = t.clientY - sy;
      if (!decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        decided = true;
        if (Math.abs(dy) > Math.abs(dx) || dx < 0) { active = false; return; }
        ensure();
        chip.style.top = Math.max(60, Math.min(innerHeight - 60, sy)) + 'px';
      }
      if (e.cancelable) e.preventDefault();
      var wasReady = dx >= GO;
      paint(Math.max(0, dx), false);
      if (!wasReady && dx >= GO) hap('light');
    }, { passive: false });
    document.addEventListener('touchend', function () {
      if (!active) return;
      active = false;
      if (!decided || !chip) return;
      var fast = dx > 40 && dx / Math.max(1, Date.now() - st) > 0.6;
      if (dx >= GO || fast) {
        paint(GO, true);
        hap('medium');
        setTimeout(function () {
          var sameOrigin = document.referrer && document.referrer.indexOf(location.origin) === 0;
          if (history.length > 1 && sameOrigin) history.back(); else location.href = '/';
          setTimeout(function () { if (chip) paint(0, true); }, 600);
        }, 60);
      } else paint(0, true);
    });
    document.addEventListener('touchcancel', function () { if (active && chip) paint(0, true); active = false; });
    window.addEventListener('pageshow', function () { if (chip) paint(0, false); });
  }

  // ---------- page transitions fallback (no cross-document View Transitions) ----------
  function setupTransitions() {
    var crossDoc = 'CSSViewTransitionRule' in window;
    window.addEventListener('pageshow', function () { root.classList.remove('ch-leaving'); });
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target && a.target !== '_self' || a.hasAttribute('download') || a.getAttribute('rel') === 'external') return;
      var url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin || /^(mailto|tel|sms|javascript):/.test(a.getAttribute('href') || '')) return;
      if (url.pathname === location.pathname && url.search === location.search) return;   // same page / hash link
      if (/\.(png|jpe?g|gif|webp|pdf|zip|mp4|mp3|webmanifest|json)$/i.test(url.pathname)) return;
      if (crossDoc || reduced()) return;                                                   // the browser animates it
      e.preventDefault();
      root.classList.add('ch-leaving');
      setTimeout(function () { location.href = url.href; }, 130);
      setTimeout(function () { root.classList.remove('ch-leaving'); }, 1500);
    });
  }

  // Warm up the tab pages so switching feels instant (prefetch only; nothing runs).
  function prefetchTabs() {
    if (navigator.connection && (navigator.connection.saveData || /2g/.test(navigator.connection.effectiveType || ''))) return;
    try {
      if (HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules')) {
        var s = document.createElement('script');
        s.type = 'speculationrules';
        s.textContent = JSON.stringify({ prefetch: [{ source: 'list', urls: TABS.map(function (t) { return t.href; }).filter(function (h) { return h !== path; }), eagerness: 'moderate' }] });
        document.head.appendChild(s);
      }
    } catch (e) { /* ignore */ }
  }

  // ---------- collapsing large-title headers (design.css .ch-header) ----------
  function initHeaders(scope) {
    (scope || document).querySelectorAll('.ch-header:not([data-ch-wired])').forEach(function (h) {
      h.setAttribute('data-ch-wired', '');
      var bar = h.querySelector('.ch-header__bar'), title = h.querySelector('.ch-header__title');
      if (!bar || !title) return;
      var check = function () {
        var collapsed = title.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom + 2;
        h.classList.toggle('is-collapsed', collapsed);
      };
      var ticking = false;
      window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(function () { ticking = false; check(); }); } }, { passive: true });
      window.addEventListener('resize', check);
      check();
    });
  }

  // ---------- Chats tab: make sure the group chats are one tap away on /messages/ ----------
  function addGroupsToMessages() {
    if (!/^\/messages\/?$/.test(path)) return;
    var main = document.getElementById('main');
    var u = user();
    if (!main || !u || !u.key || document.getElementById('ch-groups') || document.querySelector('[data-ch-groups], #main a[href="/group/"], #main a[href^="/group/?room=everyone"]')) return;
    fetch('/.netlify/functions/group?rooms=1', { headers: { 'X-Chowaniec-Key': u.key }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var rooms = d && d.rooms;
        if (!rooms || !rooms.length || document.getElementById('ch-groups')) return;
        var sec = document.createElement('section');
        sec.className = 'card';
        sec.id = 'ch-groups';
        sec.setAttribute('aria-labelledby', 'ch-groups-h');
        sec.innerHTML = '<h2 id="ch-groups-h">Group chats</h2>' + rooms.map(function (r) {
          return '<a class="dm-row" href="/group/?room=' + encodeURIComponent(r.id) + '"><span class="dm-av" style="background:' + colorFor(r.id) + '">' + icon('users', 22) + '</span>' +
            '<span class="dm-main"><span class="dm-name">' + esc(r.name) + '</span><br><span class="dm-last">' + esc(r.blurb || (r.count + ' people')) + '</span></span>' + icon('chevronRight', 18) + '</a>';
        }).join('');
        main.insertBefore(sec, main.firstChild);
      })
      .catch(function () { /* the DM list still works */ });
  }

  // ---------- start ----------
  function start() {
    injectCss();
    update();
    initHeaders();
    setupSwipe();
    setupTransitions();
    addGroupsToMessages();
    // Signed in later (passcode box) or Meet lobby opening/closing: look again.
    var tries = 0;
    var t = setInterval(function () { if ((user() && built) || ++tries > 60) clearInterval(t); update(); if (user()) addGroupsToMessages(); }, 1500);
    window.addEventListener('chowaniec-session', function () { update(); });
    window.addEventListener('pageshow', function (e) { if (e.persisted) update(); });
    var lobby = document.getElementById('lobby-screen');
    if (lobby && window.MutationObserver) new MutationObserver(update).observe(lobby, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
  }

  window.ChowaniecUI = window.ChowaniecUI || {};
  Object.assign(window.ChowaniecUI, { icon: icon, avatar: avatar, colorFor: colorFor, sheet: sheet, initHeaders: initHeaders, esc: esc });
  window.ChowaniecNav = {
    show: function () { forcedHidden = false; update(); },
    hide: function () { forcedHidden = true; update(); },
    refresh: update,
    setUnread: setUnread,
    openMore: openMore,
    closeMore: closeMore
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
