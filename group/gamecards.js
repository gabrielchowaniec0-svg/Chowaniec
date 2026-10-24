// Chowaniec Group: live game cards, game night cards and "new family record" cards inside chat bubbles.
// A message with m.game (an invite), m.gamenight (a game night) or m.record is drawn as a card. Cards keep
// themselves fresh from the games API (GET ?cards= / ?night=) while the chat is open. Also shows the game night
// champion's trophy next to their name (GroupExtras.nameBadge). Loaded after extras.js and wraps its hooks.
(function () {
    'use strict';

    const G = window.ChowaniecGroup;
    const X = window.GroupExtras;
    if (!G || !X) return;
    const esc = G.escapeHtml;
    const GAMES_API = '/.netlify/functions/games';
    const FAST_MS = 3000;
    const SLOW_MS = 15000;      // everything (including finished cards and trophies) is re-read this often

    // Icons (paths from Lucide, ISC licence) and each game's badge colours: the same as /games/core.js.
    const ICONS = {"trophy":"<path d=\"M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2\"/><path d=\"M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2\"/><path d=\"M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3\"/><path d=\"M4 22h16\"/><path d=\"M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z\"/><path d=\"M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3\"/>","crown":"<path d=\"M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z\"/><path d=\"M5 21h14\"/>","users":"<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><path d=\"M16 3.128a4 4 0 0 1 0 7.744\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/>","play":"<path d=\"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z\"/>","again":"<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"/><path d=\"M3 3v5h5\"/>","medal":"<path d=\"M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15\"/><path d=\"M11 12 5.12 2.2\"/><path d=\"m13 12 5.88-9.8\"/><path d=\"M8 7h8\"/><circle cx=\"12\" cy=\"17\" r=\"5\"/><path d=\"M12 18v-2h-.5\"/>","calendar":"<path d=\"M8 2v3\"/><path d=\"M16 2v3\"/><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M3 9h18\"/>","clock":"<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 6v6l4 2\"/>","chevronRight":"<path d=\"m9 18 6-6-6-6\"/>","sparkles":"<path d=\"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z\"/><path d=\"M20 2v4\"/><path d=\"M22 4h-4\"/><circle cx=\"4\" cy=\"20\" r=\"2\"/>","party":"<path d=\"M5.8 11.3 2 22l10.7-3.79\"/><path d=\"M4 3h.01\"/><path d=\"M22 8h.01\"/><path d=\"M15 2h.01\"/><path d=\"M22 20h.01\"/><path d=\"m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10\"/><path d=\"m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17\"/><path d=\"m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7\"/><path d=\"M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z\"/>","check":"<path d=\"M20 6 9 17l-5-5\"/>","flag":"<path d=\"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528\"/>","timer":"<line x1=\"10\" x2=\"14\" y1=\"2\" y2=\"2\"/><line x1=\"12\" x2=\"15\" y1=\"14\" y2=\"11\"/><circle cx=\"12\" cy=\"14\" r=\"8\"/>","award":"<path d=\"m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526\"/><circle cx=\"12\" cy=\"8\" r=\"6\"/>","star":"<path d=\"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z\"/>","gamepad":"<line x1=\"6\" x2=\"10\" y1=\"11\" y2=\"11\"/><line x1=\"8\" x2=\"8\" y1=\"9\" y2=\"13\"/><line x1=\"15\" x2=\"15.01\" y1=\"12\" y2=\"12\"/><line x1=\"18\" x2=\"18.01\" y1=\"10\" y2=\"10\"/><path d=\"M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z\"/>","arrowRight":"<path d=\"M5 12h14\"/><path d=\"m12 5 7 7-7 7\"/>","eye":"<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>","circle":"<circle cx=\"12\" cy=\"12\" r=\"10\"/>","close":"<path d=\"M18 6 6 18\"/><path d=\"m6 6 12 12\"/>","zap":"<path d=\"M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z\"/>","plus":"<path d=\"M5 12h14\"/><path d=\"M12 5v14\"/>","grid2":"<path d=\"M12 3v18\"/><path d=\"M3 12h18\"/><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/>","egg":"<path d=\"M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12\"/>","car":"<path d=\"M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2\"/><circle cx=\"7\" cy=\"17\" r=\"2\"/><path d=\"M9 17h6\"/><circle cx=\"17\" cy=\"17\" r=\"2\"/>","bird":"<path d=\"M16 7h.01\"/><path d=\"M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20\"/><path d=\"m20 7 2 .5-2 .5\"/><path d=\"M10 18v3\"/><path d=\"M14 17.75V21\"/><path d=\"M7 18a6 6 0 0 0 3.84-10.61\"/>","worm":"<path d=\"m19 12-1.5 3\"/><path d=\"M19.63 18.81 22 20\"/><path d=\"M6.47 8.23a1.68 1.68 0 0 1 2.44 1.93l-.64 2.08a6.76 6.76 0 0 0 10.16 7.67l.42-.27a1 1 0 1 0-2.73-4.21l-.42.27a1.76 1.76 0 0 1-2.63-1.99l.64-2.08A6.66 6.66 0 0 0 3.94 3.9l-.7.4a1 1 0 1 0 2.55 4.34z\"/>","circleDot":"<circle cx=\"12\" cy=\"12\" r=\"1\"/><circle cx=\"12\" cy=\"12\" r=\"10\"/>","layers":"<path d=\"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z\"/><path d=\"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12\"/><path d=\"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17\"/>","word":"<circle cx=\"7\" cy=\"12\" r=\"3\"/><path d=\"M10 9v6\"/><circle cx=\"17\" cy=\"12\" r=\"3\"/><path d=\"M14 7v8\"/><path d=\"M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1\"/>","shirt":"<path d=\"M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z\"/>","siren":"<path d=\"M7 18v-6a5 5 0 1 1 10 0v6\"/><path d=\"M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z\"/><path d=\"M21 12h1\"/><path d=\"M18.5 4.5 18 5\"/><path d=\"M2 12h1\"/><path d=\"M12 2v1\"/><path d=\"m4.929 4.929.707.707\"/><path d=\"M12 12v6\"/>","puzzle":"<path d=\"M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z\"/>","brain":"<path d=\"M12 18V5\"/><path d=\"M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4\"/><path d=\"M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5\"/><path d=\"M17.997 5.125a4 4 0 0 1 2.526 5.77\"/><path d=\"M18 18a4 4 0 0 0 2-7.464\"/><path d=\"M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517\"/><path d=\"M6 18a4 4 0 0 1-2-7.464\"/><path d=\"M6.003 5.125a4 4 0 0 0-2.526 5.77\"/>","palette":"<path d=\"M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z\"/><circle cx=\"13.5\" cy=\"6.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"17.5\" cy=\"10.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"6.5\" cy=\"12.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"8.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/>","dice":"<rect width=\"12\" height=\"12\" x=\"2\" y=\"10\" rx=\"2\" ry=\"2\"/><path d=\"m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6\"/><path d=\"M6 18h.01\"/><path d=\"M10 14h.01\"/><path d=\"M15 6h.01\"/><path d=\"M18 9h.01\"/>","grid":"<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M3 9h18\"/><path d=\"M3 15h18\"/><path d=\"M9 3v18\"/><path d=\"M15 3v18\"/>","keyboard":"<path d=\"M10 8h.01\"/><path d=\"M12 12h.01\"/><path d=\"M14 8h.01\"/><path d=\"M16 12h.01\"/><path d=\"M18 8h.01\"/><path d=\"M6 8h.01\"/><path d=\"M7 16h10\"/><path d=\"M8 12h.01\"/><rect width=\"20\" height=\"16\" x=\"2\" y=\"4\" rx=\"2\"/>","home":"<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\"/><path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>"};
    const META = {"2048":{"icon":"grid2","from":"#fdba74","to":"#ea580c"},"dino":{"icon":"egg","from":"#fbbf24","to":"#f97316"},"road":{"icon":"car","from":"#38bdf8","to":"#6366f1"},"hop":{"icon":"bird","from":"#7dd3fc","to":"#facc15"},"snake":{"icon":"worm","from":"#a3e635","to":"#16a34a"},"four":{"icon":"circleDot","from":"#60a5fa","to":"#1d4ed8"},"memory":{"icon":"layers","from":"#c4b5fd","to":"#d946ef"},"word":{"icon":"word","from":"#86efac","to":"#059669"},"kart":{"icon":"flag","from":"#f87171","to":"#be123c"},"style":{"icon":"shirt","from":"#f9a8d4","to":"#a855f7"},"police":{"icon":"siren","from":"#93c5fd","to":"#1e3a8a"},"puzzle":{"icon":"puzzle","from":"#5eead4","to":"#0e7490"},"trivia":{"icon":"brain","from":"#fde047","to":"#f472b6"},"doodle":{"icon":"palette","from":"#fda4af","to":"#e11d48"},"clash":{"icon":"layers","from":"#fca5a5","to":"#7c3aed"},"dice":{"icon":"dice","from":"#a5b4fc","to":"#4338ca"},"golf":{"icon":"flag","from":"#bef264","to":"#15803d"},"blocks":{"icon":"grid","from":"#67e8f9","to":"#7c3aed"},"typing":{"icon":"keyboard","from":"#e5e7eb","to":"#334155"},"checkers":{"icon":"crown","from":"#fca5a5","to":"#1f2937"},"ludo":{"icon":"home","from":"#fde047","to":"#16a34a"}};
    const NAMES = { dino: 'Dino Dash', road: 'Road Rush', hop: 'Sky Hop', snake: 'Snake', 2048: '2048', four: 'Four in a Row', memory: 'Memory Match', word: 'Daily Word', kart: 'Kart Party', style: 'Style Star', police: 'Police Patrol', puzzle: 'Picture Puzzle', trivia: 'Trivia Party', doodle: 'Doodle Guess', clash: 'Color Clash', dice: 'Dice Party', golf: 'Mini Golf', blocks: 'Block Drop', typing: 'Type Racer', checkers: 'Checkers', ludo: 'Race Home' };
    const nameOf = (id) => NAMES[id] || 'Game';
    const fmt = (n) => Number(n || 0).toLocaleString('en-US');

    function icon(name, size, cls) {
        const px = size || 18;
        return `<svg class="gc-ic${cls ? ' ' + cls : ''}" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.circle}</svg>`;
    }
    function badge(id, size) {
        const m = META[id] || { icon: 'gamepad', from: '#a1a1aa', to: '#52525b' };
        const px = size || 40;
        return `<span class="gc-badge" style="width:${px}px;height:${px}px;background:linear-gradient(135deg,${m.from},${m.to})" aria-hidden="true">${icon(m.icon, Math.round(px * 0.56))}</span>`;
    }
    const grad = (id) => { const m = META[id] || { from: '#a1a1aa', to: '#52525b' }; return `--ga:${m.from};--gb:${m.to}`; };
    const av = (name, size) => G.avatarHtml(name, size || 'av-sm');
    const join = (list) => list.length <= 1 ? list.join('') : list.length === 2 ? `${list[0]} & ${list[1]}` : `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`;
    const listNames = (names) => names.length > 3 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');

    // ---------------------------------------------------------------- live data
    const live = { cards: {}, nights: {}, trophies: {}, cardTimer: null, nightTimer: null, lastSlow: 0, busy: false };

    function cardMessages() { return G.state.messages.filter((m) => m && m.game && m.game.session); }
    function nightMessages() { return G.state.messages.filter((m) => m && m.gamenight && m.gamenight.id); }
    const infoOf = (m) => live.cards[m.game.session] || m.game.snap || null;
    const settled = (info) => !!info && info.status === 'done' && !!info.results && info.results.round === info.round;

    async function refresh(force) {
        if (live.busy || document.visibilityState === 'hidden') return;
        live.busy = true;
        let changed = false;
        try {
            const slow = force || Date.now() - live.lastSlow > SLOW_MS;
            if (slow) live.lastSlow = Date.now();
            const sids = [...new Set(cardMessages().slice(-20).filter((m) => slow || !settled(infoOf(m))).map((m) => m.game.session))];
            if (sids.length) {
                const data = await G.api(`${GAMES_API}?cards=${sids.join(',')}&room=${encodeURIComponent(G.room())}`);
                Object.entries(data.cards || {}).forEach(([sid, info]) => {
                    if (!info) { if (!(sid in live.cards)) live.cards[sid] = null; return; }
                    const before = live.cards[sid];
                    if (!before || JSON.stringify({ ...before, at: 0 }) !== JSON.stringify({ ...info, at: 0 })) { live.cards[sid] = info; changed = true; }
                });
            }
            const nids = [...new Set(nightMessages().map((m) => m.gamenight.id))].slice(-6);
            await Promise.all(nids.map(async (nid) => {
                const have = live.nights[nid];
                if (have && have.status === 'done' && !slow) return;
                try {
                    const data = await G.api(`${GAMES_API}?night=${nid}`);
                    if (JSON.stringify(have) !== JSON.stringify(data.night)) { live.nights[nid] = data.night; changed = true; }
                } catch (e) { if (e.status === 404 && !have) { live.nights[nid] = { gone: true }; changed = true; } }
            }));
            if (slow) {
                const data = await G.api(`${GAMES_API}?trophies=1`).catch(() => null);
                if (data && JSON.stringify(data.trophies || {}) !== JSON.stringify(live.trophies)) { live.trophies = data.trophies || {}; changed = true; }
            }
        } catch (e) { /* try again next time */ }
        live.busy = false;
        if (changed) G.render('auto');
    }
    function schedule() {
        clearTimeout(live.cardTimer);
        live.cardTimer = setTimeout(() => { refresh(false).finally(schedule); }, FAST_MS);
    }
    // A card was drawn before its live data arrived: fetch soon.
    let soon = null;
    function want() { if (!soon) soon = setTimeout(() => { soon = null; refresh(false); }, 60); }
    window.addEventListener('chowaniec-group-started', () => { setTimeout(() => refresh(true), 400); schedule(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(true); });

    // ---------------------------------------------------------------- game cards
    function statusLine(info) {
        if (!info) return 'Loading…';
        const max = info.max || 8;
        if (info.status === 'lobby') return `${info.rematchBy ? 'Rematch' : 'Lobby'} · ${info.players.length ? `${listNames(info.players)} · ` : ''}${info.players.length}/${max}`;
        if (info.status === 'playing') return `Playing${info.round > 1 ? ` · round ${info.round}` : ''} · ${listNames(info.players)}`;
        return 'Finished';
    }

    function podiumHtml(standings, opts) {
        const o = opts || {};
        const top = standings.slice(0, 3);
        const order = top.length >= 2 ? [top[1], top[0], top[2]].filter(Boolean) : top;
        const cols = order.map((r) => {
            const step = r.place === 1 ? 'p1' : r.place === 2 ? 'p2' : 'p3';
            const extra = o.points ? `<span class="pd-pts">+${o.points[r.name] || 0}</span>` : '';
            return `<div class="pd-col ${step}">${r.place === 1 ? `<span class="pd-crown">${icon('crown', 16)}</span>` : ''}${av(r.name, r.place === 1 ? 'av-lg' : 'av-md')}<b class="pd-name">${esc(r.name)}</b><span class="pd-score">${o.hideScore ? '' : fmt(r.score)}</span>${extra}<div class="pd-step"><span>${r.place}</span></div></div>`;
        }).join('');
        const rest = standings.slice(3).map((r) => `<div class="pd-row"><span class="pd-place">${r.place}</span>${av(r.name, 'av-xs')}<span class="pd-rn">${esc(r.name)}</span><span class="pd-rs">${o.hideScore ? '' : fmt(r.score)}${o.points ? ` · +${o.points[r.name] || 0}` : ''}</span></div>`).join('');
        return `<div class="podium n${order.length}">${cols}</div>${rest ? `<div class="pd-rest">${rest}</div>` : ''}`;
    }

    function gameCardHtml(m) {
        if (!(m.game.session in live.cards)) want();
        const info = infoOf(m);
        const gid = m.game.gameId;
        const sid = m.game.session;
        const href = `/games/${encodeURIComponent(gid)}/?s=${encodeURIComponent(sid)}`;
        const me = G.myName();
        const res = info && info.results;
        const showResults = res && info.status !== 'lobby' && !(info.status === 'playing' && res.round !== info.round);
        const head = (sub, live) => `<div class="gc-head" style="${grad(gid)}">${badge(gid, 44)}<div class="gc-tt"><b>${esc(nameOf(gid))}</b><span class="gc-st">${live ? `<i class="gc-live ${live}"></i>` : ''}${esc(sub)}</span></div>${info && info.label ? `<span class="gc-tag">${icon('trophy', 12)}</span>` : ''}</div>`;
        if (showResults) {
            const title = res.draw ? 'It’s a draw!' : res.winner ? `${G.sameName(res.winner, me) ? 'You win' : `${res.winner} wins`}!` : 'Results';
            const hideScore = res.mode === 'turns' && res.standings.every((r) => r.score <= 1);
            return `<div class="gc gc-results">${head(`Results${res.round > 1 ? ` · round ${res.round}` : ''}`)}<div class="gc-body"><div class="gc-win">${icon(res.draw ? 'users' : 'trophy', 18)}<span>${esc(title)}</span></div>${podiumHtml(res.standings, { hideScore })}<div class="gc-acts"><button type="button" class="gc-btn primary" data-x="gc-rematch" data-sid="${esc(sid)}" data-mid="${esc(m.id)}">${icon('again', 18)}Rematch</button><a class="gc-btn ghost" href="/games/${encodeURIComponent(gid)}/">${icon('play', 16)}Play solo</a></div></div></div>`;
        }
        const players = info ? info.players : [];
        const mineIn = players.some((n) => G.sameName(n, me));
        const full = info && players.length >= (info.max || 8) && !mineIn;
        const state = !info ? '' : info.status === 'playing' ? 'on' : 'wait';
        const label = info && info.status === 'playing' ? (info.mode === 'turns' && !mineIn ? 'Watch the game' : mineIn ? 'Back to the game' : 'Join the next round') : mineIn ? 'Open the lobby' : 'Join game';
        const avs = players.length ? `<div class="gc-avs">${players.slice(0, 8).map((n) => `<span class="gc-av" title="${esc(n)}">${av(n, 'av-md')}${trophyOf(n) ? `<span class="gc-av-tr">${icon('trophy', 10)}</span>` : ''}</span>`).join('')}${Array.from({ length: Math.max(0, Math.min(4, (info.max || 8) - players.length, info.mode === 'turns' ? (info.max - players.length) : 2)) }, () => '<span class="gc-av empty">' + icon('plus', 14) + '</span>').join('')}</div>` : '';
        const note = info && info.rematchBy && info.status === 'lobby' ? `<div class="gc-note">${icon('again', 14)}<span>${esc(G.sameName(info.rematchBy, me) ? 'You asked for a rematch' : `${info.rematchBy} wants a rematch!`)}</span></div>` : '';
        return `<div class="gc">${head(statusLine(info), state)}<div class="gc-body">${note}${avs}${full ? '<div class="gc-note">This game is full</div>' : `<a class="gc-btn primary big" href="${esc(href)}">${icon(info && info.status === 'playing' && !mineIn && info.mode === 'turns' ? 'eye' : 'play', 18)}${esc(label)}</a>`}</div></div>`;
    }

    async function rematch(btn) {
        btn.disabled = true;
        try {
            const data = await G.api(GAMES_API, { method: 'POST', body: { action: 'rematch', id: btn.dataset.sid, room: G.room(), msg: btn.dataset.mid } });
            if (data.url) location.href = data.url;
        } catch (e) { btn.disabled = false; G.toast(e.message || 'Couldn’t start a rematch.', 'error'); }
    }

    // ---------------------------------------------------------------- record cards
    function recordHtml(m) {
        const r = m.record;
        const add = r.kind === 'add';
        return `<div class="gc gc-record" style="${grad(r.game)}"><div class="rc-top"><span class="rc-burst">${icon('trophy', 26)}</span><span class="rc-eyebrow">${add ? 'New family leader' : 'New family record'}</span></div><div class="rc-main">${av(r.name, 'av-lg')}<div class="rc-who"><b>${esc(r.name)}</b><span>${badge(r.game, 18)}${esc(nameOf(r.game))}</span></div><div class="rc-score">${fmt(r.score)}<small>${add ? (r.score === 1 ? 'win' : 'wins') : 'points'}</small></div></div><div class="gc-acts"><a class="gc-btn primary" href="/games/${encodeURIComponent(r.game)}/">${icon('zap', 16)}Beat it</a></div></div>`;
    }

    // ---------------------------------------------------------------- game night
    function trophyOf(name) {
        const t = Object.entries(live.trophies).find(([n]) => G.sameName(n, name));
        return t && Date.parse(t[1].until) > Date.now() ? t[1] : null;
    }

    function boardHtml(standings, compact) {
        if (!standings || !standings.length) return '<div class="gn-empty">No points yet</div>';
        const max = Math.max(1, ...standings.map((s) => s.points));
        return `<div class="gn-board${compact ? ' compact' : ''}">${standings.slice(0, 8).map((s) => `<div class="gn-row${s.place === 1 ? ' lead' : ''}"><span class="gn-place">${s.place === 1 ? icon('crown', 14) : s.place}</span>${av(s.name, 'av-sm')}<span class="gn-name">${esc(s.name)}</span><span class="gn-bar"><i style="width:${Math.max(6, Math.round((s.points / max) * 100))}%"></i></span><span class="gn-pts">${s.points}</span></div>`).join('')}</div>`;
    }

    function stepsHtml(n) {
        return `<div class="gn-steps">${n.picks.map((g, i) => {
            const r = n.rounds[i];
            const st = !r ? 'next' : r.status === 'done' ? 'done' : r.status === 'skipped' ? 'skip' : 'now';
            const mark = st === 'done' ? icon('check', 11) : st === 'skip' ? icon('close', 11) : '';
            return `<div class="gn-step ${st}" title="${esc(nameOf(g))}">${badge(g, 30)}${mark ? `<span class="gn-mark">${mark}</span>` : ''}<span class="gn-sn">${esc(nameOf(g))}</span></div>`;
        }).join('<span class="gn-line"></span>')}</div>`;
    }

    const nightHead = (n, sub) => `<div class="gn-head"><span class="gn-ic">${icon('trophy', 22)}</span><div class="gn-tt"><span class="gn-eyebrow">Game night</span><b>${esc(n.title || 'Family Game Night')}</b><span class="gn-when">${icon(n.status === 'live' ? 'flag' : n.status === 'done' ? 'award' : 'calendar', 13)}${esc(sub || n.when || '')}</span></div></div>`;

    function nightCardHtml(m) {
        const n = live.nights[m.gamenight.id];
        if (!n) want();
        if (!n) return `<div class="gc gn">${nightHead({ title: 'Family Game Night' }, 'Loading…')}<div class="gc-body"><div class="gn-empty">Loading…</div></div></div>`;
        if (n.gone) return `<div class="gc gn">${nightHead({ title: 'Family Game Night' }, '')}<div class="gc-body"><div class="gn-empty">This game night is no longer available.</div></div></div>`;
        const nid = esc(n.id);
        if (n.status === 'scheduled') {
            const votes = n.votes || {};
            const chips = n.games.map((g) => `<div class="gn-chip">${badge(g, 26)}<span>${esc(nameOf(g))}</span><b>${votes[g] || 0}</b></div>`).join('');
            return `<div class="gc gn">${nightHead(n)}<div class="gc-body"><div class="gn-sub">${icon('users', 14)}<span>Vote for the games in the poll. The top picks get played, with points for every place.</span></div><div class="gn-chips">${chips}</div><button type="button" class="gc-btn primary big" data-x="gn-start" data-nid="${nid}">${icon('play', 18)}Start game night</button></div></div>`;
        }
        if (n.status === 'done') {
            const champs = n.champions || [];
            const games = n.rounds.map((r) => `<div class="gn-res">${badge(r.game, 22)}<span>${esc(r.name)}</span><b>${r.status === 'done' ? esc((r.standings && r.standings[0] && r.standings[0].place === 1 && !(r.standings[1] && r.standings[1].place === 1)) ? r.standings[0].name : 'Tie') : 'Skipped'}</b></div>`).join('');
            return `<div class="gc gn done">${nightHead(n, 'Final results')}<div class="gc-body">${champs.length ? `<div class="gn-champ">${av(champs[0], 'av-lg')}<div><span class="gn-eyebrow">Champion${champs.length > 1 ? 's' : ''}</span><b>${esc(join(champs))}</b></div><span class="gn-cup">${icon('trophy', 30)}</span></div>` : ''}${boardHtml(n.standings)}<div class="gn-results">${games}</div></div></div>`;
        }
        // live
        const i = n.current;
        const round = n.rounds[i];
        const info = n.live;
        const total = n.picks.length;
        let panel = '';
        if (round && round.status === 'open') {
            const href = `/games/${encodeURIComponent(round.game)}/?s=${encodeURIComponent(round.session)}`;
            const players = info ? info.players : [];
            const st = info ? (info.status === 'playing' ? `Playing · ${listNames(players)}` : players.length ? `Lobby · ${listNames(players)} · ${players.length}/${info.max}` : 'Waiting for players') : '';
            panel = `<div class="gn-now" style="${grad(round.game)}"><div class="gn-now-h">${badge(round.game, 40)}<div><span class="gn-eyebrow">Now playing · game ${i + 1} of ${total}</span><b>${esc(round.name)}</b><span class="gn-now-st"><i class="gc-live ${info && info.status === 'playing' ? 'on' : 'wait'}"></i>${esc(st)}</span></div></div>${players.length ? `<div class="gc-avs sm">${players.map((p) => `<span class="gc-av">${av(p, 'av-sm')}</span>`).join('')}</div>` : ''}<a class="gc-btn primary big" href="${esc(href)}">${icon('play', 18)}Join ${esc(round.name)}</a></div><div class="gc-acts"><button type="button" class="gc-btn ghost" data-x="gn-skip" data-nid="${nid}" data-from="${i}">${icon('arrowRight', 16)}Skip game</button></div>`;
        } else {
            const nextName = n.picks[i + 1] ? nameOf(n.picks[i + 1]) : '';
            panel = `<button type="button" class="gc-btn primary big" data-x="gn-next" data-nid="${nid}" data-from="${i}">${icon(nextName ? 'arrowRight' : 'trophy', 18)}${nextName ? `Next game: ${esc(nextName)}` : 'Finish game night'}</button>`;
        }
        return `<div class="gc gn">${nightHead(n, `Game ${i + 1} of ${total}`)}<div class="gc-body">${stepsHtml(n)}${panel}<div class="gn-h">${icon('award', 14)}Scoreboard</div>${boardHtml(n.standings)}</div></div>`;
    }

    function nightScoreHtml(m) {
        const n = live.nights[m.gamenight.id];
        if (!n) want();
        const after = Number(m.gamenight.after) || 0;
        if (!n || n.gone || !n.rounds) return `<div class="gn-mini"><div class="gn-mini-h">${icon('award', 16)}<span>${esc(m.text)}</span></div></div>`;
        const r = n.rounds[after];
        const total = n.picks.length;
        const canNext = n.status === 'live' && n.current === after && r && r.status === 'done';
        const nextName = n.picks[after + 1] ? nameOf(n.picks[after + 1]) : '';
        return `<div class="gc gn gn-score"><div class="gc-head" style="${grad(r ? r.game : '')}">${badge(r ? r.game : '', 40)}<div class="gc-tt"><b>${esc(r ? r.name : '')} results</b><span class="gc-st">Game night · game ${after + 1} of ${total}</span></div></div><div class="gc-body">${r && r.standings ? podiumHtml(r.standings, { points: r.points, hideScore: r.standings.every((s) => s.score <= 1) }) : ''}<div class="gn-h">${icon('award', 14)}Running total</div>${boardHtml(n.standings, true)}${canNext ? `<button type="button" class="gc-btn primary big" data-x="gn-next" data-nid="${esc(n.id)}" data-from="${after}">${icon('arrowRight', 18)}${nextName ? `Next game: ${esc(nextName)}` : 'Finish game night'}</button>` : ''}</div></div>`;
    }

    function nightWrapHtml(m) {
        const n = live.nights[m.gamenight.id];
        const champs = (n && n.champions) || [];
        return `<div class="gn-wrap">${champs.length ? `<div class="gn-wrap-h"><span class="gn-cup sm">${icon('trophy', 18)}</span><span><span class="gn-eyebrow">Game night champion${champs.length > 1 ? 's' : ''}</span><b>${esc(join(champs))}</b></span></div>` : ''}<span class="msg-text">${esc(m.text || '')}</span></div>`;
    }

    async function nightAction(btn, action) {
        btn.disabled = true;
        try {
            const data = await G.api(GAMES_API, { method: 'POST', body: { action, night: btn.dataset.nid, from: btn.dataset.from == null ? undefined : Number(btn.dataset.from) } });
            if (data.night) live.nights[data.night.id] = data.night;
            G.render('auto');
            if (data.url) location.href = data.url;
            else btn.disabled = false;
        } catch (e) {
            btn.disabled = false;
            G.toast(e.message || 'Couldn’t do that right now.', 'error');
            refresh(true);
        }
    }

    document.addEventListener('click', (e) => {
        if (G.clickSuppressed()) return;
        const t = e.target.closest && e.target.closest('[data-x^="gc-"],[data-x^="gn-"]');
        if (!t || t.disabled) return;
        e.preventDefault();
        if (t.dataset.x === 'gc-rematch') rematch(t);
        else if (t.dataset.x === 'gn-start') nightAction(t, 'night-start');
        else if (t.dataset.x === 'gn-next') nightAction(t, 'night-next');
        else if (t.dataset.x === 'gn-skip') { if (window.confirm('Skip this game? Nobody gets points for it.')) nightAction(t, 'night-skip'); }
    }, true);

    // ---------------------------------------------------------------- hooks
    function cardHtml(m) {
        if (!m) return '';
        if (m.game && m.game.session) return gameCardHtml(m);
        if (m.record && m.record.game) return recordHtml(m);
        if (m.gamenight && m.gamenight.id) {
            if (m.gamenight.view === 'score') return nightScoreHtml(m);
            if (m.gamenight.view === 'wrap') return nightWrapHtml(m);
            return nightCardHtml(m);
        }
        return '';
    }
    const base = { richHtml: X.richHtml, richClass: X.richClass, sig: X.sig };
    X.richHtml = function (m, o) { return cardHtml(m) || base.richHtml.call(X, m, o); };
    X.richClass = function (m) {
        if (m && m.gamenight && m.gamenight.view === 'wrap') return 'rich-wrap';
        if (m && ((m.game && m.game.session) || (m.record && m.record.game) || (m.gamenight && m.gamenight.id))) return 'rich-game';
        return base.richClass.call(X, m);
    };
    X.sig = function (m) {
        let extra = '';
        if (m && m.game && m.game.session) extra = JSON.stringify(infoOf(m) ? { ...infoOf(m), at: 0 } : null) + JSON.stringify((infoOf(m) || { players: [] }).players.map(trophyOf));
        else if (m && m.gamenight && m.gamenight.id) extra = JSON.stringify(live.nights[m.gamenight.id] || null);
        if (m && m.user) extra += trophyOf(m.user) ? '|tr' : '';
        return (base.sig ? base.sig(m) : '') + extra;
    };
    // A small trophy beside a game night champion's name (for 7 days).
    X.nameBadge = function (name) {
        const t = trophyOf(name);
        return t ? `<span class="name-trophy" title="${esc(t.title || 'Game night champion')}">${icon('trophy', 12)}</span>` : '';
    };
    window.GroupGameCards = { refresh, live };
})();
