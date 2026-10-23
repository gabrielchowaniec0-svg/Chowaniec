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

  let checking = false;
  async function checkIncoming() {
    if (checking || document.visibilityState !== 'visible') return;
    const user = me();
    if (!user || !user.key || user.name === 'Guest') return;
    checking = true;
    try {
      const { call } = await api('GET', '?incoming=1');
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

  window.ChowaniecCalls = { confirmStart, check: checkIncoming };
})();
