// Chowaniec calls (loaded on every page by pwa.js). Talks to /.netlify/functions/call.
//  - While a page is open and visible it checks every few seconds for a call ringing for you and shows a
//    full-screen "… is calling" popup that rings (and buzzes on Android) with Answer and Decline.
//  - window.ChowaniecCalls.confirmStart(room, chatName, people) asks "Call …?", starts the call and
//    takes the caller into it on /meet, where a small banner shows who is still ringing.
(function () {
  'use strict';
  if (window.ChowaniecCalls) return;

  const API = '/.netlify/functions/call';
  const CHECK_MS = 4000;
  const params = new URLSearchParams(location.search);
  const onMeet = /^\/meet(\/|$)/.test(location.pathname);
  const myCallId = onMeet && /^[a-f0-9]{16}$/.test(params.get('call') || '') ? params.get('call') : null;

  const me = () => (window.getChowaniecUser ? window.getChowaniecUser() : null);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const list = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

  async function api(method, query, body) {
    const user = me();
    if (!user || !user.key) throw new Error('Please sign in again.');
    const res = await fetch(API + (query || ''), {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: Object.assign({ 'X-Chowaniec-Key': user.key }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  // ---------- Styles (a phone-call look that is the same in light and dark) ----------
  function addStyles() {
    if (document.getElementById('chowaniec-call-style')) return;
    const style = document.createElement('style');
    style.id = 'chowaniec-call-style';
    style.textContent = [
      '.cc-font{font-family:Outfit,system-ui,-apple-system,sans-serif}',
      '#cc-incoming{position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:space-between;',
      'padding:calc(env(safe-area-inset-top,0px) + 64px) 24px calc(env(safe-area-inset-bottom,0px) + 56px);color:#fff;text-align:center;',
      'background:radial-gradient(120% 80% at 50% 0%,#3a3f52 0%,#16171d 60%,#0b0b0e 100%);animation:ccFade .25s ease-out}',
      '#cc-incoming .cc-who{display:flex;flex-direction:column;align-items:center;gap:14px}',
      '#cc-incoming .cc-av{width:112px;height:112px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:44px;font-weight:600;',
      'background:linear-gradient(135deg,#6b7280,#374151);box-shadow:0 0 0 0 rgba(255,255,255,.35);animation:ccPulse 1.6s ease-out infinite}',
      '#cc-incoming .cc-name{font-size:32px;font-weight:600;letter-spacing:-.01em;margin:6px 0 0}',
      '#cc-incoming .cc-sub{font-size:16px;color:rgba(255,255,255,.72);margin:0}',
      '#cc-incoming .cc-hint{font-size:13px;color:rgba(255,255,255,.55);margin:10px 0 0;max-width:320px}',
      '#cc-incoming .cc-actions{display:flex;gap:72px}',
      '.cc-btn{display:flex;flex-direction:column;align-items:center;gap:10px;background:none;border:0;color:#fff;font:inherit;font-size:14px;cursor:pointer}',
      '.cc-btn span.cc-circle{width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:transform .12s}',
      '.cc-btn:active span.cc-circle{transform:scale(.92)}',
      '.cc-btn:focus{outline:none}.cc-btn:focus-visible span.cc-circle{outline:3px solid rgba(255,255,255,.85);outline-offset:4px}',
      '.cc-btn svg{width:30px;height:30px}',
      '.cc-decline span.cc-circle{background:#ef4444}',
      '.cc-answer span.cc-circle{background:#22c55e;animation:ccWiggle 1.4s ease-in-out infinite}',
      '.cc-btn[disabled]{opacity:.6;cursor:default}',
      '#cc-sheet-back{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center;animation:ccFade .2s ease-out}',
      '#cc-sheet{width:100%;max-width:440px;margin:0 12px calc(env(safe-area-inset-bottom,0px) + 12px);padding:22px 20px 16px;border-radius:22px;background:#fff;color:#111;',
      'box-shadow:0 20px 60px rgba(0,0,0,.3);animation:ccUp .28s cubic-bezier(.2,.9,.3,1.1);text-align:center}',
      '#cc-sheet .cc-icon{width:56px;height:56px;margin:0 auto 10px;border-radius:50%;background:#22c55e;color:#fff;display:flex;align-items:center;justify-content:center}',
      '#cc-sheet .cc-icon svg{width:26px;height:26px}',
      '#cc-sheet h2{font-size:20px;font-weight:600;margin:0 0 6px}',
      '#cc-sheet p{font-size:14px;color:#555;margin:0}',
      '#cc-sheet .cc-err{color:#dc2626;margin-top:10px}',
      '#cc-sheet .cc-row{display:flex;gap:10px;margin-top:18px}',
      '#cc-sheet .cc-row button{flex:1;min-height:48px;border-radius:14px;font:inherit;font-weight:600;font-size:15px;cursor:pointer;border:1px solid rgba(0,0,0,.12);background:transparent;color:#333}',
      '#cc-sheet .cc-row .cc-go{background:#22c55e;border-color:#22c55e;color:#fff}',
      '#cc-sheet .cc-row button[disabled]{opacity:.6;cursor:default}',
      'html[data-theme="dark"] #cc-sheet{background:#1c1c20;color:#f2f2f4}',
      'html[data-theme="dark"] #cc-sheet p{color:#a8a8b0}',
      'html[data-theme="dark"] #cc-sheet .cc-row button:not(.cc-go){border-color:rgba(255,255,255,.18);color:#ddd}',
      '#cc-status{position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 12px);z-index:9998;display:flex;align-items:center;gap:10px;',
      'max-width:calc(100% - 24px);padding:8px 8px 8px 14px;border-radius:999px;background:rgba(17,17,20,.92);color:#fff;font-size:14px;',
      'box-shadow:0 10px 30px rgba(0,0,0,.3);animation:ccFade .25s ease-out}',
      '#cc-status .cc-dot{flex:none;width:9px;height:9px;border-radius:50%;background:#22c55e;animation:ccBlink 1s ease-in-out infinite}',
      '#cc-status .cc-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#cc-status button{flex:none;border:0;border-radius:999px;padding:6px 12px;background:#ef4444;color:#fff;font:inherit;font-size:13px;font-weight:600;cursor:pointer}',
      '#cc-status.done .cc-dot{animation:none;background:#a1a1aa}',
      '@keyframes ccFade{from{opacity:0}to{opacity:1}}',
      '@keyframes ccUp{from{transform:translateY(30px);opacity:0}to{transform:none;opacity:1}}',
      '@keyframes ccPulse{0%{box-shadow:0 0 0 0 rgba(255,255,255,.35)}100%{box-shadow:0 0 0 34px rgba(255,255,255,0)}}',
      '@keyframes ccWiggle{0%,60%,100%{transform:rotate(0)}10%,30%,50%{transform:rotate(-12deg)}20%,40%{transform:rotate(12deg)}}',
      '@keyframes ccBlink{50%{opacity:.35}}'
    ].join('');
    document.head.appendChild(style);
  }

  const PHONE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
  const HANGUP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate(135deg)"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';

  // ---------- Ringtone ----------
  // Browsers only let a page make sound after the person has tapped it once, so the sound is unlocked
  // on the first tap. If it isn't, the popup still shows (and Android phones still buzz).
  let audio = null;
  function unlockAudio() {
    try {
      if (!audio) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audio = new Ctx();
      }
      if (audio.state === 'suspended') audio.resume();
    } catch (e) { /* no sound on this browser */ }
  }
  ['pointerdown', 'keydown', 'touchend'].forEach((type) => window.addEventListener(type, unlockAudio, { capture: true, passive: true }));

  let ringTimer = null;
  function ringOnce() {
    if (audio && audio.state === 'running') {
      // Two short warbling bursts, like a phone.
      const t0 = audio.currentTime + 0.02;
      [0, 0.5].forEach((offset) => {
        const gain = audio.createGain();
        gain.gain.setValueAtTime(0.0001, t0 + offset);
        gain.gain.exponentialRampToValueAtTime(0.22, t0 + offset + 0.03);
        gain.gain.setValueAtTime(0.22, t0 + offset + 0.36);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.42);
        gain.connect(audio.destination);
        [440, 480].forEach((freq) => {
          const osc = audio.createOscillator();
          osc.frequency.value = freq;
          osc.connect(gain);
          osc.start(t0 + offset);
          osc.stop(t0 + offset + 0.45);
        });
      });
    }
    if (navigator.vibrate) { try { navigator.vibrate([700, 300, 700]); } catch (e) { /* ignore */ } }
  }
  function startRinging() {
    stopRinging();
    unlockAudio();
    ringOnce();
    ringTimer = setInterval(ringOnce, 3000);
  }
  function stopRinging() {
    clearInterval(ringTimer);
    ringTimer = null;
    if (navigator.vibrate) { try { navigator.vibrate(0); } catch (e) { /* ignore */ } }
  }

  // ---------- Incoming call popup ----------
  let shown = null;   // the call on screen
  const dismissed = new Set();

  function showIncoming(call) {
    if (shown && shown.id === call.id) return;
    closeIncoming();
    addStyles();
    shown = call;
    const el = document.createElement('div');
    el.id = 'cc-incoming';
    el.className = 'cc-font';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-label', `${call.from} is calling`);
    const group = call.people.length > 1;
    el.innerHTML = `<div class="cc-who"><div class="cc-av" aria-hidden="true">${esc(call.from.charAt(0))}</div>` +
      `<p class="cc-name">${esc(call.from)}</p><p class="cc-sub">${group ? `Group call · ${esc(call.roomName)}` : 'Chowaniec call'}</p>` +
      (group ? `<p class="cc-hint">Also ringing ${esc(list(call.people.filter((n) => n !== (me() || {}).name)))}</p>` : '') + '</div>' +
      `<div class="cc-actions"><button type="button" class="cc-btn cc-decline"><span class="cc-circle">${HANGUP_SVG}</span>Decline</button>` +
      `<button type="button" class="cc-btn cc-answer"><span class="cc-circle">${PHONE_SVG}</span>Answer</button></div>`;
    document.body.appendChild(el);
    const answer = el.querySelector('.cc-answer');
    const decline = el.querySelector('.cc-decline');
    answer.addEventListener('click', async () => {
      answer.disabled = decline.disabled = true;
      stopRinging();
      try { await api('POST', '', { action: 'answer', id: call.id }); } catch (e) { /* still join */ }
      location.href = call.join;
    });
    decline.addEventListener('click', async () => {
      dismissed.add(call.id);
      closeIncoming();
      try { await api('POST', '', { action: 'decline', id: call.id }); } catch (e) { /* the call stops ringing on its own */ }
    });
    answer.focus();
    startRinging();
  }

  function closeIncoming() {
    stopRinging();
    const el = document.getElementById('cc-incoming');
    if (el) el.remove();
    shown = null;
  }

  // ---------- In-app notifications ----------
  // While you're on Chowaniec, new messages, game invites, meetings and reminders arrive here as a toast
  // (the server sends them instead of a phone notification). Quick buttons: Reply (right in the toast),
  // Join game, Join meeting, Open chat, View event...
  let inboxCursor = '';
  const TOAST_MS = 7000;
  const IC = {
    gamepad: '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
    video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    chat: '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
    reply: '<path d="M20 18v-2a4 4 0 0 0-4-4H4"/><path d="m9 17-5-5 5-5"/>',
    calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
    externalLink: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>'
  };
  const svg = (name, px) => `<svg width="${px || 16}" height="${px || 16}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[name] || IC.bell}</svg>`;
  const PALETTE = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'];
  const colorFor = (name) => { let h = 0; for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

  function toastStyles() {
    if (document.getElementById('ct-style')) return;
    const st = document.createElement('style');
    st.id = 'ct-style';
    st.textContent = [
      '#ct-stack{position:fixed;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 10px);z-index:9600;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;padding:0 10px}',
      '.ct{pointer-events:auto;width:100%;max-width:430px;display:flex;gap:12px;align-items:flex-start;padding:12px 10px 12px 12px;border-radius:20px;',
      'background:rgba(255,255,255,.94);color:#111;box-shadow:0 14px 40px rgba(0,0,0,.22),0 0 0 1px rgba(0,0,0,.05);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);',
      'font:14px/1.35 Outfit,system-ui,-apple-system,sans-serif;animation:ctIn .35s cubic-bezier(.2,.9,.3,1.15);touch-action:pan-x;transition:transform .2s,opacity .2s}',
      '.ct.out{opacity:0;transform:translateY(-24px) scale(.97)}',
      '.ct-av{flex:none;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:17px}',
      '.ct-av.ic{border-radius:13px}',
      '.ct-main{flex:1;min-width:0}',
      '.ct-t{font-weight:700;font-size:14.5px;margin:1px 0 1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ct-b{margin:0;color:#444;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}',
      '.ct-acts{display:flex;gap:6px;margin-top:9px;flex-wrap:wrap}',
      '.ct-acts button{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:0 12px;border-radius:999px;border:0;background:rgba(0,0,0,.07);color:#111;font:inherit;font-weight:600;font-size:13px;cursor:pointer}',
      '.ct-acts button.pri{background:#111;color:#fff}',
      '.ct-x{flex:none;width:30px;height:30px;border:0;border-radius:50%;background:transparent;color:#888;display:flex;align-items:center;justify-content:center;cursor:pointer}',
      '.ct-reply{display:flex;gap:6px;margin-top:9px}',
      '.ct-reply input{flex:1;min-width:0;min-height:38px;padding:0 12px;border-radius:999px;border:1px solid rgba(0,0,0,.15);background:#fff;color:#111;font:inherit;font-size:16px}',
      '.ct-reply button{flex:none;width:38px;height:38px;border-radius:50%;border:0;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer}',
      '.ct-sent{display:inline-flex;align-items:center;gap:6px;margin-top:8px;color:#15803d;font-weight:600}',
      '.ct.important{box-shadow:0 14px 40px rgba(220,38,38,.3),0 0 0 2px #ef4444}',
      'html[data-theme="dark"] .ct{background:rgba(32,32,38,.94);color:#f4f4f5;box-shadow:0 14px 40px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.08)}',
      'html[data-theme="dark"] .ct-b{color:#b4b4bd}html[data-theme="dark"] .ct-acts button{background:rgba(255,255,255,.1);color:#f4f4f5}',
      'html[data-theme="dark"] .ct-acts button.pri,html[data-theme="dark"] .ct-reply button{background:#f4f4f5;color:#111}',
      'html[data-theme="dark"] .ct-reply input{background:#18181b;color:#f4f4f5;border-color:rgba(255,255,255,.15)}',
      '@media (prefers-color-scheme:dark){html:not([data-theme="light"]) .ct{background:rgba(32,32,38,.94);color:#f4f4f5}html:not([data-theme="light"]) .ct-b{color:#b4b4bd}',
      'html:not([data-theme="light"]) .ct-acts button{background:rgba(255,255,255,.1);color:#f4f4f5}html:not([data-theme="light"]) .ct-acts button.pri{background:#f4f4f5;color:#111}}',
      '@keyframes ctIn{from{opacity:0;transform:translateY(-30px) scale(.96)}to{opacity:1;transform:none}}',
      '@media (prefers-reduced-motion:reduce){.ct{animation:none}}'
    ].join('');
    document.head.appendChild(st);
  }

  // Hide a toast for something already on screen: the chat you're reading, or the game you're in.
  function alreadyShowing(item) {
    const here = new URLSearchParams(location.search);
    if (item.kind === 'message' && /^\/group\/?$/.test(location.pathname)) {
      let room = here.get('room');
      if (!room) { try { room = localStorage.getItem('chowaniec_group_room'); } catch (e) { room = null; } }
      return (room || 'everyone') === item.room;
    }
    const m = /^\/games\/([\w-]+)\/\?s=([a-f0-9]+)/.exec(item.url || '');
    return !!m && location.pathname.startsWith(`/games/${m[1]}`) && here.get('s') === m[2];
  }

  function chime() {
    if (!audio || audio.state !== 'running') return;
    const t0 = audio.currentTime + 0.01;
    [[880, 0], [1320, 0.09]].forEach(([f, d]) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.06, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.25);
      o.connect(g).connect(audio.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.3);
    });
  }

  function showToast(item) {
    if (!item || alreadyShowing(item)) return;
    toastStyles();
    let stack = document.getElementById('ct-stack');
    if (!stack) { stack = document.createElement('div'); stack.id = 'ct-stack'; stack.setAttribute('aria-live', 'polite'); document.body.appendChild(stack); }
    const old = item.tag && stack.querySelector(`.ct[data-tag="${CSS.escape(item.tag)}"]`);
    if (old) old.remove();
    while (stack.children.length >= 3) stack.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = `ct${item.kind === 'important' ? ' important' : ''}`;
    el.setAttribute('role', 'status');
    if (item.tag) el.dataset.tag = item.tag;
    const kindIcon = { game: 'gamepad', meeting: 'video', event: 'calendar', important: 'bell' }[item.kind];
    const av = item.from && !kindIcon
      ? `<div class="ct-av" style="background:${colorFor(item.from)}">${esc(item.from.charAt(0))}</div>`
      : `<div class="ct-av ic" style="background:${item.kind === 'important' ? '#ef4444' : colorFor(item.from || item.kind)}">${svg(kindIcon || 'bell', 20)}</div>`;
    const acts = (item.actions || []).map((a, i) => `<button type="button" class="${i === 0 ? 'pri' : ''}" data-ct="${a.reply ? 'reply' : 'go'}" data-url="${esc(a.url || '')}">${svg(a.icon, 15)}${esc(a.label)}</button>`).join('');
    el.innerHTML = `${av}<div class="ct-main"><p class="ct-t">${esc(item.title)}</p>${item.body ? `<p class="ct-b">${esc(item.body)}</p>` : ''}${acts ? `<div class="ct-acts">${acts}</div>` : ''}</div>` +
      `<button type="button" class="ct-x" data-ct="close" aria-label="Dismiss">${svg('close', 16)}</button>`;
    stack.appendChild(el);
    chime();
    if (navigator.vibrate) { try { navigator.vibrate(25); } catch (e) { /* ignore */ } }

    let timer = null;
    let held = false;
    const close = () => { clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 220); };
    const arm = () => { clearTimeout(timer); if (!held) timer = setTimeout(close, TOAST_MS); };
    el.addEventListener('pointerenter', () => { held = true; clearTimeout(timer); });
    el.addEventListener('pointerleave', () => { if (!el.querySelector('.ct-reply')) { held = false; arm(); } });
    // Swipe up to dismiss.
    let y0 = null;
    el.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchmove', (e) => { if (y0 != null && e.touches[0].clientY - y0 < -30) { y0 = null; close(); } }, { passive: true });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-ct]');
      if (!b) return;
      const act = b.dataset.ct;
      if (act === 'close') close();
      else if (act === 'go') { close(); location.href = b.dataset.url; }
      else if (act === 'reply') {
        held = true;
        clearTimeout(timer);
        const box = el.querySelector('.ct-acts');
        box.outerHTML = `<form class="ct-reply"><input type="text" enterkeyhint="send" autocomplete="off" aria-label="Reply to ${esc(item.from || item.title)}" maxlength="2000"><button type="submit" aria-label="Send">${svg('send', 16)}</button></form>`;
        const form = el.querySelector('.ct-reply');
        const input = form.querySelector('input');
        input.focus();
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          input.disabled = true;
          try {
            const u = me();
            const res = await fetch('/.netlify/functions/group', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'X-Chowaniec-Key': (u && u.key) || '', 'Content-Type': 'application/json' },
              body: JSON.stringify({ room: item.room || 'everyone', text })
            });
            if (!res.ok) throw new Error();
            form.outerHTML = `<span class="ct-sent">${svg('check', 15)}Sent</span>`;
            held = false;
            timer = setTimeout(close, 1400);
          } catch (err) {
            input.disabled = false;
            input.focus();
          }
        });
      }
    });
    arm();
  }

  let checking = false;
  async function checkIncoming() {
    if (checking || document.visibilityState !== 'visible') return;
    const user = me();
    if (!user || !user.key || user.name === 'Guest') return;
    checking = true;
    try {
      const { call, inbox } = await api('GET', `?incoming=1&since=${encodeURIComponent(inboxCursor)}`);
      if (inbox) {
        if (inboxCursor) (inbox.items || []).forEach(showToast);
        inboxCursor = inbox.cursor || inboxCursor;
      }
      if (call && !dismissed.has(call.id) && call.id !== myCallId) showIncoming(call);
      else if (shown && (!call || call.id !== shown.id)) closeIncoming();
    } catch (e) {
      // try again on the next check
    } finally {
      checking = false;
    }
  }

  setInterval(checkIncoming, CHECK_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkIncoming(); });
  setTimeout(checkIncoming, 800);

  // ---------- Starting a call ----------
  function confirmStart(room, chatName, people) {
    addStyles();
    unlockAudio();
    const others = (people || []).filter(Boolean);
    const back = document.createElement('div');
    back.id = 'cc-sheet-back';
    back.className = 'cc-font';
    back.innerHTML = '<div id="cc-sheet" role="dialog" aria-modal="true" aria-labelledby="cc-sheet-title">' +
      `<div class="cc-icon">${PHONE_SVG}</div><h2 id="cc-sheet-title">Call ${esc(chatName)}?</h2>` +
      `<p>${others.length ? `This rings ${esc(list(others))}.` : 'This rings everyone in the chat.'} Anyone who doesn’t have Chowaniec open gets a notification.</p>` +
      '<p class="cc-err" hidden></p>' +
      '<div class="cc-row"><button type="button" class="cc-no">Cancel</button><button type="button" class="cc-go">Call</button></div></div>';
    document.body.appendChild(back);
    const close = () => back.remove();
    const go = back.querySelector('.cc-go');
    const no = back.querySelector('.cc-no');
    const err = back.querySelector('.cc-err');
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    no.addEventListener('click', close);
    go.focus();
    go.addEventListener('click', async () => {
      go.disabled = no.disabled = true;
      go.textContent = 'Calling…';
      try {
        const { call } = await api('POST', '', { action: 'start', room });
        location.href = call.join;
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
        go.disabled = no.disabled = false;
        go.textContent = 'Try again';
      }
    });
  }

  // ---------- In the call (/meet/?…&call=<id>) ----------
  // Marks you as answered, and shows the caller who is still ringing, with a button to stop ringing.
  function watchCall(id) {
    let call = null;
    let timer = null;
    let bar = null;

    function render() {
      const user = me();
      if (!call || !user || call.from !== user.name) return;
      addStyles();
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'cc-status';
        bar.className = 'cc-font';
        bar.setAttribute('role', 'status');
        document.body.appendChild(bar);
      }
      const waiting = call.people.filter((n) => !call.answered.includes(n) && !call.declined.includes(n));
      let text;
      if (call.status === 'ringing') {
        text = `Ringing ${list(waiting)}…` + (call.answered.length ? ` · ${list(call.answered)} picked up` : '');
      } else if (call.status === 'answered') {
        text = `${list(call.answered)} picked up` + (waiting.length ? ` · ${list(waiting)} didn’t answer` : '');
      } else if (call.status === 'declined') {
        text = call.people.length > 1 ? 'Everyone declined' : `${call.people[0]} declined`;
      } else if (call.status === 'cancelled') {
        text = 'Stopped ringing';
      } else {
        text = 'No answer · they’ll see a missed call';
      }
      bar.classList.toggle('done', call.status !== 'ringing');
      bar.innerHTML = `<span class="cc-dot" aria-hidden="true"></span><span class="cc-text">${esc(text)}</span>` +
        (call.status === 'ringing' ? '<button type="button">Stop ringing</button>' : '');
      const stop = bar.querySelector('button');
      if (stop) stop.addEventListener('click', async () => {
        stop.disabled = true;
        try { call = (await api('POST', '', { action: 'cancel', id })).call; } catch (e) { /* ignore */ }
        render();
      });
      if (call.status !== 'ringing') {
        clearInterval(timer);
        setTimeout(() => { if (bar) { bar.remove(); bar = null; } }, 6000);
      }
    }

    async function refresh() {
      try {
        call = (await api('GET', `?id=${id}`)).call;
        render();
      } catch (e) { /* try again */ }
    }

    (async () => {
      try { call = (await api('POST', '', { action: 'answer', id })).call; } catch (e) { return; }
      render();
      if (call.status === 'ringing') timer = setInterval(refresh, 3000);
    })();

    // Leaving the call page while it still rings stops the ringing for everyone.
    window.addEventListener('pagehide', () => {
      const user = me();
      if (call && call.status === 'ringing' && user && call.from === user.name && navigator.sendBeacon) {
        navigator.sendBeacon(API, new Blob([JSON.stringify({ action: 'cancel', id })], { type: 'application/json' }));
      }
    });
  }

  function whenSignedIn(fn, tries) {
    if (me()) fn();
    else if ((tries || 0) < 60) setTimeout(() => whenSignedIn(fn, (tries || 0) + 1), 1000);
  }
  if (myCallId) whenSignedIn(() => watchCall(myCallId));

  window.ChowaniecCalls = { confirmStart, check: checkIncoming, toast: showToast };
})();
