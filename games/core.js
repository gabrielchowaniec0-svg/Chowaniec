// Chowaniec Games core: the shared frame every game page plugs into (window.ChowGames).
// It draws the top bar, keeps family high scores, shows the game-over card and leaderboard, and runs
// multiplayer: a lobby you can invite any group chat or DM to, a 3-2-1 countdown, live race scores
// (everyone plays the same course from the same seed) and shared boards for turn-based games.
// Talks to /.netlify/functions/games. See games/README.md for how a game uses it.
(function () {
  'use strict';

  const API = '/.netlify/functions/games';
  const RACE_SYNC_MS = 600;     // games can ask for faster updates with opts.syncMs (min 250)
  const LOBBY_POLL_MS = 1500;
  const TURN_POLL_MS = 1000;
  const MUTE_KEY = 'chowaniec_games_muted';
  const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const me = () => { const u = window.getChowaniecUser ? window.getChowaniecUser() : null; return u && u.name ? u.name : ''; };
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Icons (paths from Lucide, ISC licence). ChowGames.icon(name, size?) returns an inline SVG.
  const ICONS = {"trophy":"<path d=\"M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2\"/><path d=\"M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2\"/><path d=\"M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3\"/><path d=\"M4 22h16\"/><path d=\"M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z\"/><path d=\"M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3\"/>","volume":"<path d=\"M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z\"/><path d=\"M16 9a5 5 0 0 1 0 6\"/><path d=\"M19.364 18.364a9 9 0 0 0 0-12.728\"/>","mute":"<path d=\"M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z\"/><path d=\"m16.5 14.5 5-5\"/><path d=\"m16.5 9.5 5 5\"/>","users":"<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><path d=\"M16 3.128a4 4 0 0 1 0 7.744\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/>","back":"<path d=\"m15 18-6-6 6-6\"/>","close":"<path d=\"M18 6 6 18\"/><path d=\"m6 6 12 12\"/>","play":"<path d=\"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z\"/>","again":"<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"/><path d=\"M3 3v5h5\"/>","crown":"<path d=\"M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z\"/><path d=\"M5 21h14\"/>","flag":"<path d=\"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528\"/>","star":"<path d=\"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z\"/>","clock":"<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 6v6l4 2\"/>","timer":"<line x1=\"10\" x2=\"14\" y1=\"2\" y2=\"2\"/><line x1=\"12\" x2=\"15\" y1=\"14\" y2=\"11\"/><circle cx=\"12\" cy=\"14\" r=\"8\"/>","heart":"<path d=\"M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5\"/>","settings":"<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>","share":"<circle cx=\"18\" cy=\"5\" r=\"3\"/><circle cx=\"6\" cy=\"12\" r=\"3\"/><circle cx=\"18\" cy=\"19\" r=\"3\"/><line x1=\"8.59\" x2=\"15.42\" y1=\"13.51\" y2=\"17.49\"/><line x1=\"15.41\" x2=\"8.59\" y1=\"6.51\" y2=\"10.49\"/>","copy":"<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\"/><path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\"/>","chat":"<path d=\"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719\"/>","group":"<path d=\"M18 21a8 8 0 0 0-16 0\"/><circle cx=\"10\" cy=\"8\" r=\"5\"/><path d=\"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3\"/>","gamepad":"<line x1=\"6\" x2=\"10\" y1=\"11\" y2=\"11\"/><line x1=\"8\" x2=\"8\" y1=\"9\" y2=\"13\"/><line x1=\"15\" x2=\"15.01\" y1=\"12\" y2=\"12\"/><line x1=\"18\" x2=\"18.01\" y1=\"10\" y2=\"10\"/><path d=\"M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z\"/>","image":"<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\"/><circle cx=\"9\" cy=\"9\" r=\"2\"/><path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\"/>","upload":"<path d=\"M12 3v12\"/><path d=\"m17 8-5-5-5 5\"/><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/>","check":"<path d=\"M20 6 9 17l-5-5\"/>","lock":"<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\"/><path d=\"M7 11V7a5 5 0 0 1 10 0v4\"/>","award":"<path d=\"m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526\"/><circle cx=\"12\" cy=\"8\" r=\"6\"/>","zap":"<path d=\"M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z\"/>","car":"<path d=\"M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2\"/><circle cx=\"7\" cy=\"17\" r=\"2\"/><path d=\"M9 17h6\"/><circle cx=\"17\" cy=\"17\" r=\"2\"/>","shield":"<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\"/>","shirt":"<path d=\"M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z\"/>","puzzle":"<path d=\"M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z\"/>","brain":"<path d=\"M12 18V5\"/><path d=\"M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4\"/><path d=\"M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5\"/><path d=\"M17.997 5.125a4 4 0 0 1 2.526 5.77\"/><path d=\"M18 18a4 4 0 0 0 2-7.464\"/><path d=\"M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517\"/><path d=\"M6 18a4 4 0 0 1-2-7.464\"/><path d=\"M6.003 5.125a4 4 0 0 0-2.526 5.77\"/>","sparkles":"<path d=\"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z\"/><path d=\"M20 2v4\"/><path d=\"M22 4h-4\"/><circle cx=\"4\" cy=\"20\" r=\"2\"/>","undo":"<path d=\"M9 14 4 9l5-5\"/><path d=\"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11\"/>","pause":"<rect x=\"14\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\"/><rect x=\"5\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\"/>","home":"<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\"/><path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>","link":"<path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\"/><path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\"/>","send":"<path d=\"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z\"/><path d=\"m21.854 2.147-10.94 10.939\"/>","video":"<path d=\"m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5\"/><rect x=\"2\" y=\"6\" width=\"14\" height=\"12\" rx=\"2\"/>","phone":"<path d=\"M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384\"/>","bell":"<path d=\"M10.268 21a2 2 0 0 0 3.464 0\"/><path d=\"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326\"/>","medal":"<path d=\"M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15\"/><path d=\"M11 12 5.12 2.2\"/><path d=\"m13 12 5.88-9.8\"/><path d=\"M8 7h8\"/><circle cx=\"12\" cy=\"17\" r=\"5\"/><path d=\"M12 18v-2h-.5\"/>","target":"<circle cx=\"12\" cy=\"12\" r=\"10\"/><circle cx=\"12\" cy=\"12\" r=\"6\"/><circle cx=\"12\" cy=\"12\" r=\"2\"/>","flame":"<path d=\"M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4\"/>","gift":"<path d=\"M12 7v14\"/><path d=\"M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8\"/><path d=\"M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5\"/><rect x=\"3\" y=\"7\" width=\"18\" height=\"4\" rx=\"1\"/>","cpu":"<path d=\"M12 20v2\"/><path d=\"M12 2v2\"/><path d=\"M17 20v2\"/><path d=\"M17 2v2\"/><path d=\"M2 12h2\"/><path d=\"M2 17h2\"/><path d=\"M2 7h2\"/><path d=\"M20 12h2\"/><path d=\"M20 17h2\"/><path d=\"M20 7h2\"/><path d=\"M7 20v2\"/><path d=\"M7 2v2\"/><rect x=\"4\" y=\"4\" width=\"16\" height=\"16\" rx=\"2\"/><rect x=\"8\" y=\"8\" width=\"8\" height=\"8\" rx=\"1\"/>","user":"<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\"/><circle cx=\"12\" cy=\"7\" r=\"4\"/>","plus":"<path d=\"M5 12h14\"/><path d=\"M12 5v14\"/>","minus":"<path d=\"M5 12h14\"/>","arrowUp":"<path d=\"m5 12 7-7 7 7\"/><path d=\"M12 19V5\"/>","arrowDown":"<path d=\"M12 5v14\"/><path d=\"m19 12-7 7-7-7\"/>","arrowLeft":"<path d=\"m12 19-7-7 7-7\"/><path d=\"M19 12H5\"/>","arrowRight":"<path d=\"M5 12h14\"/><path d=\"m12 5 7 7-7 7\"/>","siren":"<path d=\"M7 18v-6a5 5 0 1 1 10 0v6\"/><path d=\"M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z\"/><path d=\"M21 12h1\"/><path d=\"M18.5 4.5 18 5\"/><path d=\"M2 12h1\"/><path d=\"M12 2v1\"/><path d=\"m4.929 4.929.707.707\"/><path d=\"M12 12v6\"/>","palette":"<path d=\"M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z\"/><circle cx=\"13.5\" cy=\"6.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"17.5\" cy=\"10.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"6.5\" cy=\"12.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"8.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/>","camera":"<path d=\"M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z\"/><circle cx=\"12\" cy=\"13\" r=\"3\"/>","grid":"<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M3 9h18\"/><path d=\"M3 15h18\"/><path d=\"M9 3v18\"/><path d=\"M15 3v18\"/>","shuffle":"<path d=\"m18 14 4 4-4 4\"/><path d=\"m18 2 4 4-4 4\"/><path d=\"M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22\"/><path d=\"M2 6h1.972a4 4 0 0 1 3.6 2.2\"/><path d=\"M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45\"/>","eye":"<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>","calendar":"<path d=\"M8 2v3\"/><path d=\"M16 2v3\"/><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M3 9h18\"/>","info":"<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 16v-4\"/><path d=\"M12 8h.01\"/>","chevronRight":"<path d=\"m9 18 6-6-6-6\"/>","sun":"<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2\"/><path d=\"M12 20v2\"/><path d=\"m4.93 4.93 1.41 1.41\"/><path d=\"m17.66 17.66 1.41 1.41\"/><path d=\"M2 12h2\"/><path d=\"M20 12h2\"/><path d=\"m6.34 17.66-1.41 1.41\"/><path d=\"m19.07 4.93-1.41 1.41\"/>","moon":"<path d=\"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401\"/>","keyboard":"<path d=\"M10 8h.01\"/><path d=\"M12 12h.01\"/><path d=\"M14 8h.01\"/><path d=\"M16 12h.01\"/><path d=\"M18 8h.01\"/><path d=\"M6 8h.01\"/><path d=\"M7 16h10\"/><path d=\"M8 12h.01\"/><rect width=\"20\" height=\"16\" x=\"2\" y=\"4\" rx=\"2\"/>","party":"<path d=\"M5.8 11.3 2 22l10.7-3.79\"/><path d=\"M4 3h.01\"/><path d=\"M22 8h.01\"/><path d=\"M15 2h.01\"/><path d=\"M22 20h.01\"/><path d=\"m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10\"/><path d=\"m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17\"/><path d=\"m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7\"/><path d=\"M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z\"/>","thumbsUp":"<path d=\"M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z\"/><path d=\"M7 10v12\"/>","mapPin":"<path d=\"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0\"/><circle cx=\"12\" cy=\"10\" r=\"3\"/>","gauge":"<path d=\"m12 14 4-4\"/><path d=\"M3.34 19a10 10 0 1 1 17.32 0\"/>","circleDot":"<circle cx=\"12\" cy=\"12\" r=\"1\"/><circle cx=\"12\" cy=\"12\" r=\"10\"/>","apple":"<path d=\"M12 6.528V3a1 1 0 0 1 1-1h0\"/><path d=\"M18.237 21A15 15 0 0 0 22 11a6 6 0 0 0-10-4.472A6 6 0 0 0 2 11a15.1 15.1 0 0 0 3.763 10 3 3 0 0 0 3.648.648 5.5 5.5 0 0 1 5.178 0A3 3 0 0 0 18.237 21\"/>","hash":"<line x1=\"4\" x2=\"20\" y1=\"9\" y2=\"9\"/><line x1=\"4\" x2=\"20\" y1=\"15\" y2=\"15\"/><line x1=\"10\" x2=\"8\" y1=\"3\" y2=\"21\"/><line x1=\"16\" x2=\"14\" y1=\"3\" y2=\"21\"/>","type":"<path d=\"M12 4v16\"/><path d=\"M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2\"/><path d=\"M9 20h6\"/>","layers":"<path d=\"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z\"/><path d=\"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12\"/><path d=\"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17\"/>","dice":"<rect width=\"12\" height=\"12\" x=\"2\" y=\"10\" rx=\"2\" ry=\"2\"/><path d=\"m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6\"/><path d=\"M6 18h.01\"/><path d=\"M10 14h.01\"/><path d=\"M15 6h.01\"/><path d=\"M18 9h.01\"/>","ghost":"<path d=\"M15 10v1\"/><path d=\"M7.528 20.472a1.6 1.6 0 012.277 0l1.057 1.056a1.6 1.6 0 002.276 0l1.057-1.056a1.6 1.6 0 012.277 0l1.114 1.114a1.4 1.4 0 002.414-1V10a8 8 0 00-16 0v10.586a1.4 1.4 0 002.414 1z\"/><path d=\"M9 10v1\"/>","footprints":"<path d=\"M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z\"/><path d=\"M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z\"/><path d=\"M16 17h4\"/><path d=\"M4 13h4\"/>","help":"<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3\"/><path d=\"M12 17h.01\"/>","bird":"<path d=\"M16 7h.01\"/><path d=\"M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20\"/><path d=\"m20 7 2 .5-2 .5\"/><path d=\"M10 18v3\"/><path d=\"M14 17.75V21\"/><path d=\"M7 18a6 6 0 0 0 3.84-10.61\"/>","egg":"<path d=\"M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12\"/>","worm":"<path d=\"m19 12-1.5 3\"/><path d=\"M19.63 18.81 22 20\"/><path d=\"M6.47 8.23a1.68 1.68 0 0 1 2.44 1.93l-.64 2.08a6.76 6.76 0 0 0 10.16 7.67l.42-.27a1 1 0 1 0-2.73-4.21l-.42.27a1.76 1.76 0 0 1-2.63-1.99l.64-2.08A6.66 6.66 0 0 0 3.94 3.9l-.7.4a1 1 0 1 0 2.55 4.34z\"/>","grid2":"<path d=\"M12 3v18\"/><path d=\"M3 12h18\"/><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/>","circle":"<circle cx=\"12\" cy=\"12\" r=\"10\"/>","spade":"<path d=\"M12 18v4\"/><path d=\"M2 14.499a5.5 5.5 0 0 0 9.591 3.675.6.6 0 0 1 .818.001A5.5 5.5 0 0 0 22 14.5c0-2.29-1.5-4-3-5.5l-5.492-5.312a2 2 0 0 0-3-.02L5 8.999c-1.5 1.5-3 3.2-3 5.5\"/>","word":"<circle cx=\"7\" cy=\"12\" r=\"3\"/><path d=\"M10 9v6\"/><circle cx=\"17\" cy=\"12\" r=\"3\"/><path d=\"M14 7v8\"/><path d=\"M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1\"/>","carFront":"<path d=\"m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8\"/><path d=\"M7 14h.01\"/><path d=\"M17 14h.01\"/><rect width=\"18\" height=\"8\" x=\"3\" y=\"10\" rx=\"2\"/><path d=\"M5 18v2\"/><path d=\"M19 18v2\"/>","rocket":"<path d=\"M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5\"/><path d=\"M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09\"/><path d=\"M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z\"/><path d=\"M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05\"/>","crosshair":"<circle cx=\"12\" cy=\"12\" r=\"10\"/><line x1=\"22\" x2=\"18\" y1=\"12\" y2=\"12\"/><line x1=\"6\" x2=\"2\" y1=\"12\" y2=\"12\"/><line x1=\"12\" x2=\"12\" y1=\"6\" y2=\"2\"/><line x1=\"12\" x2=\"12\" y1=\"22\" y2=\"18\"/>","route":"<circle cx=\"6\" cy=\"19\" r=\"3\"/><path d=\"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15\"/><circle cx=\"18\" cy=\"5\" r=\"3\"/>","swords":"<path d=\"m13 19 6-6\"/><path d=\"M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5\"/><path d=\"m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586\"/><path d=\"m16 16 4 4\"/><path d=\"m19 21 2-2\"/><path d=\"m5 14 4 4\"/><path d=\"m5 21-2-2\"/><path d=\"M7.5 16.5 4 20\"/>","lightbulb":"<path d=\"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5\"/><path d=\"M9 18h6\"/><path d=\"M10 22h4\"/>","mic":"<path d=\"M12 19v3\"/><path d=\"M19 10v2a7 7 0 0 1-14 0v-2\"/><rect x=\"9\" y=\"2\" width=\"6\" height=\"13\" rx=\"3\"/>","wand":"<path d=\"m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72\"/><path d=\"m14 7 3 3\"/><path d=\"M5 6v4\"/><path d=\"M19 14v4\"/><path d=\"M10 2v2\"/><path d=\"M7 8H3\"/><path d=\"M21 16h-4\"/><path d=\"M11 3H9\"/>","scissors":"<circle cx=\"6\" cy=\"6\" r=\"3\"/><path d=\"M8.12 8.12 12 12\"/><path d=\"M20 4 8.12 15.88\"/><circle cx=\"6\" cy=\"18\" r=\"3\"/><path d=\"M14.8 14.8 20 20\"/>","gem":"<path d=\"M10.5 3 8 9l4 13 4-13-2.5-6\"/><path d=\"M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z\"/><path d=\"M2 9h20\"/>","hat":"<path d=\"M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z\"/><path d=\"M22 10v6\"/><path d=\"M6 12.5V16a6 3 0 0 0 12 0v-3.5\"/>","shoe":"<path d=\"M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z\"/><path d=\"M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z\"/><path d=\"M16 17h4\"/><path d=\"M4 13h4\"/>","music":"<path d=\"M9 18V5l12-2v13\"/><circle cx=\"6\" cy=\"18\" r=\"3\"/><circle cx=\"18\" cy=\"16\" r=\"3\"/>","map":"<path d=\"M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z\"/><path d=\"M15 5.764v15\"/><path d=\"M9 3.236v15\"/>","fuel":"<path d=\"M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-6.998a2 2 0 0 0-.59-1.42L18 5\"/><path d=\"M14 21V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16\"/><path d=\"M2 21h13\"/><path d=\"M3 9h11\"/>","badge":"<path d=\"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z\"/><path d=\"m16 9-5.5 5.5L8 12\"/>","handshake":"<path d=\"m11 17 2 2a1 1 0 1 0 3-3\"/><path d=\"m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4\"/><path d=\"m21 3 1 11h-2\"/><path d=\"M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3\"/><path d=\"M3 4h8\"/>","cat":"<path d=\"M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z\"/><path d=\"M8 14v.5\"/><path d=\"M16 14v.5\"/><path d=\"M11.25 16.25h1.5L12 17l-.75-.75Z\"/>","dog":"<path d=\"M11.25 16.25h1.5L12 17z\"/><path d=\"M16 14v.5\"/><path d=\"M4.42 11.247A13.152 13.152 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444a11.702 11.702 0 0 0-.493-3.309\"/><path d=\"M8 14v.5\"/><path d=\"M8.5 8.5c-.384 1.05-1.083 2.028-2.344 2.5-1.931.722-3.576-.297-3.656-1-.113-.994 1.177-6.53 4-7 1.923-.321 3.651.845 3.651 2.235A7.497 7.497 0 0 1 14 5.277c0-1.39 1.844-2.598 3.767-2.277 2.823.47 4.113 6.006 4 7-.08.703-1.725 1.722-3.656 1-1.261-.472-1.855-1.45-2.239-2.5\"/>","refresh":"<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\"/><path d=\"M21 3v5h-5\"/><path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\"/><path d=\"M8 16H3v5\"/>","maximize":"<path d=\"M15 3h6v6\"/><path d=\"m21 3-7 7\"/><path d=\"m3 21 7-7\"/><path d=\"M9 21H3v-6\"/>","save":"<path d=\"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z\"/><path d=\"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7\"/><path d=\"M7 3v4a1 1 0 0 0 1 1h7\"/>","externalLink":"<path d=\"M15 3h6v6\"/><path d=\"M10 14 21 3\"/><path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\"/>","reply":"<path d=\"M20 18v-2a4 4 0 0 0-4-4H4\"/><path d=\"m9 17-5-5 5-5\"/>","logIn":"<path d=\"m10 17 5-5-5-5\"/><path d=\"M15 12H3\"/><path d=\"M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4\"/>","trash":"<path d=\"M10 11v6\"/><path d=\"M14 11v6\"/><path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\"/><path d=\"M3 6h18\"/><path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"/>"};
  function icon(name, size) {
    const body = ICONS[name] || ICONS.circle;
    const px = size || 20;
    return `<svg class="cg-ic" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  // Each game's badge: an icon on its own gradient (used in the top bar, the lobby and the games page).
  const GAME_META = {
    dino: { icon: 'egg', from: '#fbbf24', to: '#f97316' },
    road: { icon: 'car', from: '#38bdf8', to: '#6366f1' },
    hop: { icon: 'bird', from: '#7dd3fc', to: '#facc15' },
    snake: { icon: 'worm', from: '#a3e635', to: '#16a34a' },
    2048: { icon: 'grid2', from: '#fdba74', to: '#ea580c' },
    four: { icon: 'circleDot', from: '#60a5fa', to: '#1d4ed8' },
    memory: { icon: 'layers', from: '#c4b5fd', to: '#d946ef' },
    word: { icon: 'word', from: '#86efac', to: '#059669' },
    kart: { icon: 'flag', from: '#f87171', to: '#be123c' },
    style: { icon: 'shirt', from: '#f9a8d4', to: '#a855f7' },
    police: { icon: 'siren', from: '#93c5fd', to: '#1e3a8a' },
    puzzle: { icon: 'puzzle', from: '#5eead4', to: '#0e7490' },
    trivia: { icon: 'brain', from: '#fde047', to: '#f472b6' }
  };
  function badge(id, size) {
    const m = GAME_META[id] || { icon: 'gamepad', from: '#a1a1aa', to: '#52525b' };
    const px = size || 30;
    return `<span class="cg-badge" style="width:${px}px;height:${px}px;background:linear-gradient(135deg,${m.from},${m.to})" aria-hidden="true">${icon(m.icon, Math.round(px * 0.58))}</span>`;
  }

  let opts = null;
  let booted = false;
  const listeners = {};
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, ...args) { (listeners[evt] || []).forEach((fn) => { try { fn(...args); } catch (e) { console.error(e); } }); }

  // ---------- API ----------
  async function api(method, query, body) {
    const u = window.getChowaniecUser ? window.getChowaniecUser() : null;
    const res = await fetch(API + (query || ''), {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: Object.assign({ 'X-Chowaniec-Key': (u && u.key) || '' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status, data });
    return data;
  }

  // ---------- Seeded random numbers (same seed = same course for everyone) ----------
  function rng(seed) {
    let a = (Number(seed) >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Sound effects (made on the fly, no files) ----------
  let audio = null;
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* ignore */ }
  function unlockAudio() {
    try {
      if (!audio) { const C = window.AudioContext || window.webkitAudioContext; if (C) audio = new C(); }
      if (audio && audio.state === 'suspended') audio.resume();
    } catch (e) { /* no sound */ }
  }
  ['pointerdown', 'keydown', 'touchend'].forEach((t) => window.addEventListener(t, unlockAudio, { capture: true, passive: true }));
  const SOUNDS = {
    jump: [['square', 520, 880, 0.12, 0.08]],
    flap: [['triangle', 420, 700, 0.09, 0.12]],
    coin: [['square', 988, 988, 0.07, 0.07], ['square', 1319, 1319, 0.18, 0.07, 0.07]],
    score: [['sine', 880, 880, 0.08, 0.1], ['sine', 1175, 1175, 0.12, 0.1, 0.08]],
    point: [['sine', 660, 990, 0.08, 0.08]],
    hit: [['sawtooth', 200, 60, 0.3, 0.16]],
    crash: [['sawtooth', 160, 40, 0.45, 0.18], ['square', 90, 40, 0.4, 0.08]],
    click: [['square', 700, 700, 0.03, 0.05]],
    tick: [['sine', 1200, 1200, 0.04, 0.06]],
    drop: [['triangle', 500, 160, 0.16, 0.14]],
    flip: [['triangle', 600, 900, 0.07, 0.08]],
    match: [['sine', 660, 660, 0.09, 0.1], ['sine', 880, 880, 0.09, 0.1, 0.09], ['sine', 1320, 1320, 0.16, 0.1, 0.18]],
    wrong: [['square', 240, 180, 0.18, 0.08]],
    win: [['square', 523, 523, 0.12, 0.08], ['square', 659, 659, 0.12, 0.08, 0.12], ['square', 784, 784, 0.12, 0.08, 0.24], ['square', 1047, 1047, 0.35, 0.08, 0.36]],
    lose: [['triangle', 392, 392, 0.18, 0.1], ['triangle', 330, 330, 0.18, 0.1, 0.2], ['triangle', 262, 196, 0.4, 0.1, 0.4]],
    go: [['square', 784, 784, 0.25, 0.1]],
    whoosh: [['sawtooth', 300, 900, 0.2, 0.04]]
  };
  function sfx(name) {
    if (muted || !SOUNDS[name]) return;
    unlockAudio();
    if (!audio || audio.state !== 'running') return;
    const t0 = audio.currentTime + 0.01;
    SOUNDS[name].forEach(([type, f1, f2, dur, vol, delay]) => {
      const t = t0 + (delay || 0);
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f1, t);
      if (f2 !== f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    });
  }
  function setMuted(v) {
    muted = !!v;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* ignore */ }
    const b = $('#cg-mute');
    if (b) { b.innerHTML = icon(muted ? 'mute' : 'volume'); b.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on'); }
  }

  // Uploads a picture (a data: URL, JPEG/PNG/WebP up to 2 MB) for everyone in a game to see; returns
  // { id, url }. Use the url in <img> or as a canvas image (same origin, so canvases stay readable).
  async function uploadImage(dataUrl) {
    const { id } = await api('POST', '', { action: 'image', data: dataUrl });
    return { id, url: `${API}?image=${id}` };
  }

  // ---------- Small UI pieces ----------
  let toastTimer = null;
  function toast(msg) {
    let t = $('#cg-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cg-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // A centred card over the game. Returns the card element; close with closeModal().
  function modal(html, { onClose, wide, sticky } = {}) {
    closeModal();
    const back = document.createElement('div');
    back.id = 'cg-modal';
    back.innerHTML = `<div class="cg-card${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(back);
    back.addEventListener('click', (e) => {
      if ((e.target === back && !sticky) || e.target.closest('[data-cg="close"]')) { closeModal(); if (onClose) onClose(); }
    });
    const first = back.querySelector('button.primary, button');
    if (first) setTimeout(() => first.focus(), 30);
    return back.querySelector('.cg-card');
  }
  function closeModal() { const m = $('#cg-modal'); if (m) m.remove(); }
  const modalOpen = () => !!$('#cg-modal');

  function medal(i) { return `<span class="cg-rank${i < 3 ? ` r${i + 1}` : ''}">${i + 1}</span>`; }

  // ---------- High scores ----------
  const unit = () => (opts && opts.scoreLabel) || 'points';

  // Scores that couldn't be sent (no signal, server hiccup) wait on this device and are sent next time.
  const PENDING_KEY = 'chowaniec_games_pending';
  function pending(list) {
    try {
      if (list) localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-20)));
      else return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    } catch (e) { return []; }
    return list;
  }

  async function submitScore(score) {
    const item = { game: opts.id, score: Math.round(score), user: me(), at: Date.now() };
    try {
      return await api('POST', '', { action: 'score', game: item.game, score: item.score });
    } catch (e) {
      if (e.status === 409) return null;                     // e.g. today's puzzle was already played
      if (!e.status || e.status >= 500 || e.status === 429) {
        pending(pending().concat(item));
        toast('No connection right now. Your score will be saved next time.');
      } else toast('Couldn’t save your score: ' + e.message);
      return null;
    }
  }

  async function sendPending() {
    const list = pending();
    if (!list.length) return;
    const keep = [];
    for (const item of list) {
      if (item.user !== me() || Date.now() - item.at > 7 * 86400000) { if (item.user !== me()) keep.push(item); continue; }
      try { await api('POST', '', { action: 'score', game: item.game, score: item.score }); } catch (e) { if (!e.status || e.status >= 500 || e.status === 429) keep.push(item); }
    }
    pending(keep);
  }

  async function showLeaderboard() {
    const card = modal(`<div class="cg-hero gold">${icon('trophy', 26)}</div><h2>Family leaderboard</h2><p class="cg-sub">${esc(opts.title)}</p><div class="cg-board">Loading…</div><div class="cg-row"><button type="button" class="primary" data-cg="close">Close</button></div>`);
    try {
      const data = await api('GET', `?board=${encodeURIComponent(opts.id)}`);
      const rows = data.top || [];
      let html = rows.length
        ? '<ol class="cg-list">' + rows.map((r, i) => `<li class="${r.name === me() ? 'mine' : ''}"><span class="m">${medal(i)}</span><span class="n">${esc(r.name)}</span><span class="s">${fmt(r.score)}</span></li>`).join('') + '</ol>'
        : `<p class="cg-empty">No scores yet. Be the first!</p>`;
      if (data.today) {
        html += `<h3>Today</h3>` + (data.today.length ? '<ol class="cg-list">' + data.today.map((r, i) => `<li class="${r.name === me() ? 'mine' : ''}"><span class="m">${medal(i)}</span><span class="n">${esc(r.name)}</span><span class="s">${r.score ? `${7 - r.score}/6` : 'X/6'}</span></li>`).join('') + '</ol>' : '<p class="cg-empty">Nobody has played today yet.</p>');
      }
      const box = card.querySelector('.cg-board');
      if (box) box.innerHTML = html;
    } catch (e) {
      const box = card.querySelector('.cg-board');
      if (box) box.textContent = e.message;
    }
  }

  // ---------- Multiplayer ----------
  const multi = {
    session: null,       // the session we're in
    players: {},         // race: name -> { state, at, round }
    round: 0,            // the round we've started locally
    myState: null,
    finished: false,
    timer: null,
    resultsShown: false,
    lastVersion: 0
  };
  const inSession = () => !!multi.session;
  const isHost = () => !!multi.session && multi.session.host === me();
  const colorOf = (name) => {
    const list = multi.session ? multi.session.players : [];
    const i = Math.max(0, list.indexOf(name));
    return COLORS[i % COLORS.length];
  };
  const setUrl = (id) => {
    const u = new URL(location.href);
    if (id) u.searchParams.set('s', id); else u.searchParams.delete('s');
    history.replaceState(null, '', u.pathname + u.search);
  };
  const shareUrl = () => `${location.origin}/games/${opts.id}/?s=${multi.session.id}`;

  const syncMs = () => Math.max(250, Number(opts.syncMs) || RACE_SYNC_MS);

  function stopTimer() { clearTimeout(multi.timer); multi.timer = null; }

  async function createSession(room) {
    const { session } = await api('POST', '', { action: 'create', game: opts.id, room: room || undefined });
    adopt(session);
    return session;
  }

  async function joinSession(id) {
    try {
      const { session } = await api('POST', '', { action: 'join', id });
      adopt(session);
      return session;
    } catch (e) {
      if (e.status === 409) {
        // Already started: watch (turn games) or join the next round.
        const { session } = await api('GET', `?session=${id}`);
        adopt(session);
        toast(e.message);
        return session;
      }
      setUrl(null);
      throw e;
    }
  }

  function adopt(session) {
    multi.session = session;
    multi.round = 0;     // a round already running (e.g. after a reload) is picked up by the next tick
    multi.lastVersion = session.version;
    setUrl(session.id);
    document.body.classList.add('cg-multi');
    renderBarState();
    tick();
  }

  async function leaveSession() {
    const s = multi.session;
    stopTimer();
    multi.session = null;
    multi.players = {};
    multi.round = 0;
    multi.finished = false;
    document.body.classList.remove('cg-multi');
    hideRaceBoard();
    closeModal();
    setUrl(null);
    renderBarState();
    if (s) api('POST', '', { action: 'leave', id: s.id }).catch(() => {});
    emit('multiEnd');
  }

  // Accepts a session read from the server, unless we left meanwhile or it's older than what we already
  // have (a poll that started before our own move finished). Returns false if we left.
  function take(fresh) {
    const cur = multi.session;
    if (!cur || cur.id !== fresh.id) return false;
    if (fresh.round < cur.round || (fresh.round === cur.round && fresh.version < cur.version)) return true;
    multi.session = fresh;
    return true;
  }

  // One heartbeat: refresh the session, start rounds, sync race states, pick up moves.
  async function tick() {
    stopTimer();
    const s = multi.session;
    if (!s) return;
    let wait = LOBBY_POLL_MS;
    try {
      if (opts.mode === 'race' && s.status === 'playing' && multi.round === s.round && multi.myState) {
        const data = await api('POST', '', { action: 'sync', id: s.id, state: multi.myState, round: s.round });
        if (!take(data.session)) return;
        multi.players = data.players || {};
        wait = syncMs();
      } else {
        const data = await api('GET', `?session=${s.id}`);
        if (!take(data.session)) return;
        multi.players = data.players || {};
        wait = opts.mode === 'turns' && data.session.status === 'playing' ? TURN_POLL_MS : (multi.round && data.session.status === 'playing' ? syncMs() : LOBBY_POLL_MS);
      }
    } catch (e) {
      if (e.status === 404) { toast(e.message); leaveSession(); return; }
      wait = 3000;
    }
    if (!multi.session) return;
    react();
    if (multi.session) multi.timer = setTimeout(tick, document.visibilityState === 'visible' ? wait : Math.max(wait, 4000));
  }

  function react() {
    const s = multi.session;
    renderBarState();
    if (s.status === 'playing' && s.round !== multi.round && s.players.includes(me())) {
      beginRound(s);
      return;
    }
    if (opts.mode === 'turns' && s.status !== 'lobby' && s.round && s.round !== multi.round && !s.players.includes(me())) {
      // Watching a game you couldn't join: show the board (info.myIndex is -1, so no moves).
      multi.round = s.round;
      multi.lastVersion = s.version;
      closeModal();
      emit('multiStart', Object.assign(turnInfo(), { seed: s.seed, shared: s.shared }));
      emit('shared', s.shared, turnInfo());
    }
    if (opts.mode === 'turns' && s.round === multi.round && s.version !== multi.lastVersion) {
      multi.lastVersion = s.version;
      emit('shared', s.shared, turnInfo());
    }
    if (opts.mode === 'race' && multi.round === s.round) {
      renderRaceBoard();
      if (multi.finished) renderResults();
    }
    if (isLobbyOpen()) renderLobby();
  }

  function turnInfo() {
    const s = multi.session;
    return { players: s.players.slice(), me: me(), myIndex: s.players.indexOf(me()), host: s.host, round: s.round, seed: s.seed, version: s.version, colors: s.players.map(colorOf), status: s.status };
  }

  // Countdown to the shared start time, then hand over to the game.
  async function beginRound(s) {
    multi.round = s.round;
    multi.finished = false;
    multi.resultsShown = false;
    multi.myState = null;
    multi.players = {};
    multi.lastVersion = s.version;
    closeModal();
    const late = Date.parse(s.startAt) - Date.now() < -2000;
    if (!late) {
      const cd = document.createElement('div');
      cd.id = 'cg-countdown';
      document.body.appendChild(cd);
      for (;;) {
        const left = Math.ceil((Date.parse(s.startAt) - Date.now()) / 1000);
        if (left <= 0) break;
        if (cd.textContent !== String(left)) { cd.textContent = String(left); cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop'); sfx('tick'); }
        await sleep(100);
        if (!multi.session || multi.session.round !== s.round) { cd.remove(); return; }
      }
      cd.textContent = 'Go!';
      cd.classList.add('go');
      cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop');
      sfx('go');
      setTimeout(() => cd.remove(), 650);
    }
    const info = Object.assign(turnInfo(), { seed: s.seed, shared: s.shared });
    if (opts.mode === 'race') {
      multi.myState = { score: 0, alive: true };
      renderRaceBoard();
    }
    emit('multiStart', info);
    if (opts.mode === 'turns') emit('shared', s.shared, turnInfo());
    tick();
  }

  // ----- races -----
  function raceUpdate(state) {
    if (!inSession() || multi.finished) return;
    multi.myState = Object.assign({ alive: true }, state);
  }

  function raceOthers() {
    if (!inSession()) return [];
    const round = multi.session.round;
    return Object.entries(multi.players)
      .filter(([name, p]) => name !== me() && p && p.round === round && p.state)
      .map(([name, p]) => ({ name, color: colorOf(name), state: p.state, age: Date.now() - p.at }));
  }

  function raceStandings() {
    const s = multi.session;
    const rows = s.players.map((name) => {
      const p = name === me() ? { state: multi.myState } : multi.players[name];
      const st = p && p.state && (name === me() || p.round === s.round) ? p.state : null;
      return { name, color: colorOf(name), score: st ? Number(st.score) || 0 : 0, alive: st ? st.alive !== false : true, started: !!st };
    });
    return rows.sort((a, b) => b.score - a.score);
  }

  function renderRaceBoard() {
    if (!inSession() || opts.mode !== 'race') return;
    let el = $('#cg-race');
    if (!el) { el = document.createElement('div'); el.id = 'cg-race'; el.setAttribute('aria-live', 'off'); document.body.appendChild(el); }
    el.innerHTML = raceStandings().map((r) => `<div class="r${r.name === me() ? ' me' : ''}${r.alive ? '' : ' out'}"><i style="background:${r.color}"></i><b>${esc(r.name)}</b><span>${fmt(r.score)}</span>${r.alive ? '' : `<em>${icon('flag', 12)}</em>`}</div>`).join('');
  }
  function hideRaceBoard() { const el = $('#cg-race'); if (el) el.remove(); }

  async function raceFinish(score, extra) {
    if (!inSession() || multi.finished || !multi.round || multi.session.round !== multi.round) return;
    multi.finished = true;
    multi.myState = Object.assign({}, multi.myState, extra || {}, { score: Math.round(score), alive: false, done: true });
    try {
      const data = await api('POST', '', { action: 'sync', id: multi.session.id, state: multi.myState, round: multi.session.round });
      multi.players = data.players || {};
    } catch (e) { /* the next tick retries */ }
    renderRaceBoard();
    renderResults();
  }

  function renderResults() {
    const s = multi.session;
    const rows = raceStandings();
    // Someone whose first update hasn't arrived is still playing, unless 15 s have passed (they never started).
    const grace = Date.now() - Date.parse(s.startAt) > 15000;
    const allDone = rows.every((r) => (r.started && !r.alive) || (!r.started && grace)) && rows.some((r) => r.started);
    const html = (allDone ? `<div class="cg-hero gold">${icon('crown', 26)}</div>` : `<div class="cg-hero">${icon('timer', 26)}</div>`) +
      `<h2>${allDone ? (rows[0].name === me() ? 'You win!' : `${esc(rows[0].name)} wins!`) : 'Waiting for the others…'}</h2>` +
      '<ol class="cg-list">' + rows.map((r, i) => `<li class="${r.name === me() ? 'mine' : ''}"><span class="m">${allDone ? medal(i) : icon(r.alive ? 'footprints' : 'flag', 18)}</span><span class="n"><i class="dot" style="background:${r.color}"></i>${esc(r.name)}</span><span class="s">${fmt(r.score)}</span></li>`).join('') + '</ol>' +
      `<div class="cg-row">${isHost() ? `<button type="button" class="primary" data-cg="again"${allDone ? '' : ' disabled'}>Play again</button>` : `<span class="cg-wait">${allDone ? `Waiting for ${esc(s.host)} to start again…` : ''}</span>`}<button type="button" data-cg="leave">Leave</button></div>`;
    let card = $('#cg-modal .cg-card.results');
    if (!card) {
      card = modal(html, { sticky: true });
      card.classList.add('results');
      card.addEventListener('click', onResultsClick);
    } else card.innerHTML = html;
    if (allDone && !multi.resultsShown) {
      multi.resultsShown = true;
      sfx(rows[0].name === me() ? 'win' : 'score');
    }
  }
  async function onResultsClick(e) {
    const b = e.target.closest('button[data-cg]');
    if (!b) return;
    if (b.dataset.cg === 'again') { b.disabled = true; await startRound(); }
    if (b.dataset.cg === 'leave') leaveSession();
  }

  // ----- turn games -----
  async function commit(shared, { done } = {}) {
    if (!inSession()) return false;
    try {
      const { session } = await api('POST', '', { action: 'move', id: multi.session.id, version: multi.session.version, shared, done: !!done });
      multi.session = session;
      multi.lastVersion = session.version;
      return true;
    } catch (e) {
      if (e.status === 409 && e.data && e.data.session) {
        multi.session = e.data.session;
        multi.lastVersion = e.data.session.version;
        emit('shared', multi.session.shared, turnInfo());
        toast('Someone else moved first.');
      } else toast(e.message);
      return false;
    }
  }

  // ----- lobby -----
  async function startRound() {
    try {
      const s = multi.session;
      const body = { action: 'start', id: s.id };
      if (opts.mode === 'turns' && opts.initialShared) body.shared = opts.initialShared(s.players.slice(), Math.floor(Math.random() * 2 ** 31));
      if (opts.mode === 'race' && opts.roundSetup) body.shared = await opts.roundSetup(s.players.slice());   // e.g. the puzzle picture
      if (body.shared === null) return;    // the host cancelled
      const { session } = await api('POST', '', body);
      multi.session = session;
      react();
    } catch (e) { toast(e.message); }
  }

  let chats = null;
  const isLobbyOpen = () => !!$('#cg-modal .cg-card.lobby');

  async function openLobby() {
    unlockAudio();
    if (!inSession()) {
      const card = modal(`<div class="cg-hero green">${icon('users', 26)}</div><h2>Play together</h2><p class="cg-sub">${esc(opts.title)} · ${opts.mode === 'turns' ? `${opts.minPlayers || 2}${(opts.maxPlayers || 2) > (opts.minPlayers || 2) ? `–${opts.maxPlayers}` : ''} players, take turns` : 'Everyone plays the same course at the same time'}</p>` +
        '<p>Start a game, then send the link to a chat. Anyone who taps it joins you here.</p>' +
        '<div class="cg-row"><button type="button" data-cg="close">Cancel</button><button type="button" class="primary" data-cg="create">Start a game</button></div>');
      card.querySelector('[data-cg="create"]').addEventListener('click', async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Starting…';
        try { await createSession(); openLobby(); } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Start a game'; }
      });
      return;
    }
    const card = modal('<div class="lobby-body"></div>', { wide: true });
    card.classList.add('lobby');
    card.addEventListener('click', onLobbyClick);
    renderLobby();
    if (!chats) {
      try { chats = (await api('GET', '?chats=1')).chats; } catch (e) { chats = []; }
      renderLobby();
    }
  }

  function renderLobby() {
    const card = $('#cg-modal .cg-card.lobby');
    if (!card || !multi.session) return;
    const s = multi.session;
    const min = opts.mode === 'turns' ? (opts.minPlayers || 2) : 1;
    const max = opts.maxPlayers || 8;
    const enough = s.players.length >= min;
    const invited = s.invitedTo || [];
    const chatButtons = (chats || []).map((c) => `<button type="button" class="chip${invited.includes(c.id) ? ' on' : ''}" data-cg="invite" data-room="${esc(c.id)}">${icon(invited.includes(c.id) ? 'check' : (c.dm ? 'chat' : 'group'), 16)}${esc(c.name)}</button>`).join('');
    const playing = s.status === 'playing' && s.round === multi.round;
    card.querySelector('.lobby-body').innerHTML =
      `<div class="cg-hero plain">${badge(opts.id, 52)}</div><h2>${esc(opts.title)}</h2><p class="cg-sub">${playing ? 'Game in progress' : `Lobby · ${s.players.length}/${max} players`}</p>` +
      '<div class="cg-players">' + s.players.map((n) => `<span class="pl"><i style="background:${colorOf(n)}"></i>${esc(n)}${n === s.host ? ' <small>host</small>' : ''}</span>`).join('') + '</div>' +
      `<h3>Invite</h3><p class="cg-hint">Tap a chat to send everyone there a “Join game” link and a notification.</p><div class="cg-chips">${chats ? chatButtons || '<span class="cg-hint">No chats found.</span>' : '<span class="cg-hint">Loading chats…</span>'}</div>` +
      `<div class="cg-row"><button type="button" data-cg="copy">Copy link</button></div>` +
      '<div class="cg-row lobby-actions">' +
      (isHost()
        ? `<button type="button" data-cg="leave">Leave</button><button type="button" class="primary" data-cg="start"${enough ? '' : ' disabled'}>${enough ? (s.round ? 'Start next round' : 'Start the game') : `Waiting for ${min - s.players.length} more…`}</button>`
        : `<button type="button" data-cg="leave">Leave</button><span class="cg-wait">Waiting for ${esc(s.host)} to start…</span>`) +
      '</div>';
  }

  async function onLobbyClick(e) {
    const b = e.target.closest('button[data-cg]');
    if (!b) return;
    const act = b.dataset.cg;
    if (act === 'invite') {
      if (b.classList.contains('on')) return;
      b.disabled = true;
      try {
        await api('POST', '', { action: 'invite', id: multi.session.id, room: b.dataset.room });
        multi.session.invitedTo = (multi.session.invitedTo || []).concat(b.dataset.room);
        toast('Invite sent!');
        renderLobby();
      } catch (err) { toast(err.message); b.disabled = false; }
    } else if (act === 'copy') {
      try { await navigator.clipboard.writeText(shareUrl()); toast('Link copied'); } catch (err) { prompt('Copy this link:', shareUrl()); }
    } else if (act === 'start') {
      b.disabled = true;
      await startRound();
    } else if (act === 'leave') {
      leaveSession();
    }
  }

  // ---------- Game over ----------
  // Solo: saves the score and shows it with the family record. Race: reports your finish and shows the
  // live results. Turn games: pass { title, score } (score 0 = nothing to save).
  async function gameOver({ score = 0, title, detail, again } = {}) {
    const racing = inSession() && multi.round > 0 && multi.session.round === multi.round;
    if (racing && opts.mode === 'race') {
      await raceFinish(score);
      submitScore(score);
      return;
    }
    if (racing && opts.mode === 'turns') {
      if (score > 0) submitScore(score);
      const card = modal(`<h2>${esc(title || 'Game over')}</h2>${detail ? `<p class="cg-sub">${esc(detail)}</p>` : ''}` +
        `<div class="cg-row">${isHost() ? '<button type="button" class="primary" data-cg="again">Play again</button>' : `<span class="cg-wait">Waiting for ${esc(multi.session.host)} to start again…</span>`}<button type="button" data-cg="leave">Leave</button></div>`, { sticky: true });
      card.addEventListener('click', onResultsClick);
      return;
    }
    const card = modal(`<h2>${esc(title || 'Game over')}</h2><div class="cg-score">${fmt(score)}<small>${esc(unit())}</small></div><p class="cg-best">Saving…</p>` +
      '<div class="cg-row col"><button type="button" class="primary" data-cg="again">Play again</button>' +
      `<button type="button" data-cg="family">${icon('users', 18)} Challenge the family</button><button type="button" data-cg="board">${icon('trophy', 18)} Leaderboard</button></div>`, { sticky: true });
    card.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-cg]');
      if (!b) return;
      if (b.dataset.cg === 'again') { closeModal(); if (again) again(); }
      if (b.dataset.cg === 'family') openLobby();
      if (b.dataset.cg === 'board') showLeaderboard();
    });
    const result = score > 0 ? await submitScore(score) : null;
    const best = card.querySelector('.cg-best');
    if (!best) return;
    if (!result) { best.textContent = score > 0 ? '' : 'Keep trying!'; return; }
    if (result.isRecord && result.rank === 1 && result.total > 1) { best.innerHTML = `<span class="cg-flag gold">${icon('crown', 16)} New family record!</span>`; sfx('win'); }
    else if (result.isRecord) best.innerHTML = `<span class="cg-flag">${icon('star', 16)} New personal best!</span> You’re #${result.rank} in the family.`;
    else best.textContent = `Your best: ${fmt(result.best)} · #${result.rank} in the family`;
  }

  // ---------- Frame ----------
  function renderBarState() {
    const b = $('#cg-together');
    if (!b) return;
    b.classList.toggle('on', inSession());
    b.innerHTML = inSession() ? `${icon('users', 18)}<span>${multi.session.players.length}</span>` : `${icon('users', 18)}<span>Play together</span>`;
  }

  function help() {
    modal(`<div class="cg-hero plain">${badge(opts.id, 52)}</div><h2>How to play</h2><div class="cg-help">${opts.help || ''}</div><div class="cg-row"><button type="button" class="primary" data-cg="close">Got it</button></div>`);
  }

  function frame() {
    const root = document.getElementById('app-root') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'app-root' }));
    root.classList.add('cg-app');
    root.innerHTML = `<header class="cg-bar"><a class="cg-back" href="/games/" aria-label="All games">${icon('back', 24)}</a>` +
      `<h1>${badge(opts.id, 28)}<span>${esc(opts.title)}</span></h1>` +
      `<button type="button" id="cg-help" aria-label="How to play">${icon('help')}</button>` +
      `<button type="button" id="cg-board" aria-label="Leaderboard">${icon('trophy')}</button>` +
      `<button type="button" id="cg-mute" aria-label="${muted ? 'Sound off' : 'Sound on'}">${icon(muted ? 'mute' : 'volume')}</button>` +
      `<button type="button" id="cg-together" class="cg-together">${icon('users', 18)}<span>Play together</span></button></header>` +
      '<main id="cg-stage"></main>';
    $('#cg-help').addEventListener('click', help);
    $('#cg-board').addEventListener('click', showLeaderboard);
    $('#cg-mute').addEventListener('click', () => setMuted(!muted));
    $('#cg-together').addEventListener('click', openLobby);
    document.title = `${opts.title} · Chowaniec Games`;
    return $('#cg-stage');
  }

  let stage = null;
  async function boot() {
    if (booted || !opts) return;
    booted = true;
    if (!stage) stage = frame();
    const ctx = { root: stage, user: me(), seed: Math.floor(Math.random() * 2 ** 31) };
    if (opts.onReady) opts.onReady(ctx);
    sendPending();
    const sid = new URLSearchParams(location.search).get('s');
    if (sid && /^[a-f0-9]{10}$/.test(sid)) {
      try { await joinSession(sid); openLobby(); } catch (e) { toast(e.message); }
    }
  }

  function mount(o) {
    opts = Object.assign({ mode: 'race', minPlayers: 1, maxPlayers: 8, scoreLabel: 'points' }, o);
    const ready = () => {
      if (!stage) stage = frame();
      if (window.isAppAuthorized && window.isAppAuthorized()) boot();
    };
    window.initializeProtectedContent = boot;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
    else ready();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') emit('pause');
    else { emit('resume'); if (inSession()) tick(); }
  });

  window.ChowGames = {
    mount, on, rng, sfx, toast, modal, closeModal, modalOpen, gameOver, submitScore, showLeaderboard, openLobby,
    me, colors: COLORS, icon, badge, meta: GAME_META,
    uploadImage,
    countingDown: () => { const c = document.getElementById('cg-countdown'); return !!c && !c.classList.contains('go'); },
    isMulti: () => inSession() && multi.round > 0 && multi.session.round === multi.round,
    session: () => multi.session,
    muted: () => muted,
    race: { update: raceUpdate, finish: raceFinish, others: raceOthers, standings: () => (inSession() ? raceStandings() : []) },
    turns: { shared: () => (multi.session ? multi.session.shared : null), info: () => (multi.session ? turnInfo() : null), commit }
  };
})();
