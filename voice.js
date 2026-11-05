// Bob's voice: talk to Bob hands-free.
//   listen  Web Speech API (SpeechRecognition / webkitSpeechRecognition), live captions, mic level for Bob's ears
//   think   a normal Chowaniec AI turn (POST /.netlify/functions/ai-agent, streamed NDJSON, voice: true)
//   speak   speechSynthesis, sentence by sentence, Bob's mouth moving on word boundaries
//
//   BobVoice.support                  -> { listen, speak, ios }
//   BobVoice.createSession(opts)      -> session (see below); the engine, no UI
//   BobVoice.mountPanel(opts)         -> panel: the "Talk to Bob" card used by robot-float.js and /ai
//   BobVoice.askAgent(text, hooks)    -> Promise<{ text, quickAnswers, sources, actions, conversationId } | { error }>
//   BobVoice.speakable(markdown)      -> [sentences] plain text to read aloud (no Markdown, links or [n] citations)
//
// The optional "Hey Bob" wake word only runs while the page is open and on screen (it stops when the page is
// hidden), and turns itself off after 10 minutes without use. Nothing here ever listens in the background.
(function () {
  'use strict';
  if (window.BobVoice) return;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const canSpeak = () => 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined';
  const support = { listen: !!SR, speak: canSpeak(), ios };

  const WAKE = /(?:^|[^\p{L}])(?:hey|hi|hej|ok|okay|o\.k\.)[\s,.!]*(?:bob|bobby|bop|bobie)(?![\p{L}])[\s,.!?]*/iu;
  const STOP = /^\s*(stop|stop talking|stop it|cancel|never ?mind|quiet|be quiet|shh+|that'?s all|thanks,? bob|thank you,? bob|przestań|wystarczy|cisza|anuluj|dzięki)\s*[.!]*\s*$/i;
  const MORE = /^\s*(tell me more|more|go on|continue|keep going|and then\??|what else\??|powiedz więcej|więcej|dalej|mów dalej|co jeszcze\??)\s*[.!?]*\s*$/i;
  const YES = /^\s*(yes|yeah|yep|yup|sure|ok(ay)?|do it|go ahead|send it|please do|tak|jasne|dobrze|wyślij)\b/i;
  const NO = /^\s*(no|nope|not now|don'?t|nah|nie|nie teraz)\b/i;
  const WAKE_IDLE_MS = 10 * 60 * 1000;
  const FIRST_SENTENCES = 3;

  // ---------- language & voices ----------
  const LANG_KEY = 'chowaniec_bob_lang';
  function normLang(tag) {
    const t = String(tag || '').trim();
    if (!t) return 'en-US';
    if (/^pl/i.test(t)) return 'pl-PL';
    if (/^en$/i.test(t)) return 'en-US';
    return t;
  }
  function defaultLang() {
    try { const saved = localStorage.getItem(LANG_KEY); if (saved) return saved; } catch (e) { /* ignore */ }
    return normLang(navigator.language || 'en-US');
  }
  const looksPolish = (text) => /[ąćęłńśźż]/i.test(text) || /\b(jest|się|nie|tak|czy|jak|kiedy|jutro|dzisiaj|mamy|był|była)\b/i.test(text);

  const NOVELTY = /Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Zarvox|Whisper|Trinoids|Organ|Jester|Superstar|Good News|Deranged|Hysterical|Pipe|Junior|Ralph|Fred|Kathy|Grandpa|Grandma|Rocko|Shelley|Flo|Eddy|Reed|Sandy/;
  const PREFER = {
    en: [/Google US English/, /Samantha/, /Ava \((Premium|Enhanced)\)/, /Microsoft (Aria|Jenny|Ava|Emma|Michelle).*(Natural|Online)/, /Allison/, /Ava/, /Karen/, /Moira/, /Google UK English Female/, /Daniel/, /Microsoft (Zira|Aria)/],
    pl: [/Zosia/, /Google polski/, /Microsoft (Zofia|Agnieszka|Paulina|Marek).*(Natural|Online)/, /Microsoft (Paulina|Zofia)/, /Ewa/, /Krzysztof/]
  };
  let voices = [];
  function loadVoices() { try { voices = canSpeak() ? speechSynthesis.getVoices() || [] : []; } catch (e) { voices = []; } }
  if (canSpeak()) {
    loadVoices();
    try { speechSynthesis.addEventListener('voiceschanged', loadVoices); } catch (e) { /* old Safari */ }
  }
  function pickVoice(lang) {
    if (!voices.length) loadVoices();
    const base = lang.slice(0, 2).toLowerCase();
    const pool = voices.filter((v) => String(v.lang || '').replace('_', '-').toLowerCase().startsWith(base) && !NOVELTY.test(v.name));
    if (!pool.length) return null;
    const prefs = PREFER[base] || [];
    const rank = (v) => {
      let r = prefs.findIndex((re) => re.test(v.name));
      r = r < 0 ? 50 : r;
      if (String(v.lang).replace('_', '-').toLowerCase() === lang.toLowerCase()) r -= 0.5;
      if (/compact/i.test(v.voiceURI || '')) r += 5;
      return r;
    };
    return pool.slice().sort((a, b) => rank(a) - rank(b))[0];
  }

  // ---------- turning a Markdown reply into something to say ----------
  function plainText(md) {
    return String(md || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^\s*\|.*\|\s*$/gm, ' ')                        // tables
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                     // images
      .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')    // links -> their text
      .replace(/\s?\[(?:m?\d+)(?:\s*,\s*m?\d+)*\]/g, '')          // citations [1] [m2, m3]
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/(^|\s)\/[a-z][\w-]*\/(\?\S*)?/g, '$1')          // site paths
      .replace(/^\s{0,3}#{1,6}\s*(.+)$/gm, '$1.')                // headings
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/gm, (all, item) => (/[.!?:]$/.test(item.trim()) ? item : `${item}.`))
      .replace(/[*_`~>]+/g, '')
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/\s*\n+\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\.\s*\./g, '.')
      .trim();
  }
  function sentencesOf(text) {
    const t = String(text || '').trim();
    if (!t) return [];
    if (window.Intl && Intl.Segmenter) {
      try {
        return Array.from(new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(t), (s) => s.segment.trim()).filter(Boolean);
      } catch (e) { /* fall through */ }
    }
    return (t.match(/[^.!?]+(?:[.!?]+["”’)]*|$)/g) || [t]).map((s) => s.trim()).filter(Boolean);
  }
  const speakable = (md) => sentencesOf(plainText(md));
  const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

  // ---------- mic level (Bob's ears) ----------
  async function micGranted() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return false;
      const p = await navigator.permissions.query({ name: 'microphone' });
      return p.state === 'granted';
    } catch (e) { return false; }
  }
  function startMeter(onLevel) {
    // iOS can't share the mic between speech recognition and Web Audio; Bob's ears pulse on their own there.
    const AC = window.AudioContext || window.webkitAudioContext;
    let stopped = false;
    let stream = null; let ctx = null; let raf = 0;
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (ctx) ctx.close().catch(() => {});
      onLevel(null);
    };
    if (ios || !AC || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return stop;
    micGranted().then(async (granted) => {
      if (!granted || stopped) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        ctx = new AC();
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.fftSize);
        let level = 0;
        const tick = () => {
          if (stopped) return;
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          const rms = Math.sqrt(sum / buf.length);
          level = level * 0.6 + Math.min(1, rms * 5) * 0.4;
          onLevel(level);
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) { /* no meter: fine */ }
    });
    return stop;
  }

  // ---------- the engine ----------
  function createSession(o) {
    const opts = o || {};
    const s = {
      state: 'idle', lang: defaultLang(), wake: false, lastUse: Date.now(), rest: [], quick: null,
      rec: null, speakToken: 0, turnToken: 0, sync: false, wakeFails: 0, destroyed: false, unlocked: false,
      wakeTimer: null, meterStop: null, listenTimer: null, speaking: null
    };
    const emit = (name, ...a) => { try { if (typeof opts[name] === 'function') opts[name](...a); } catch (e) { console.error(e); } };
    const setState = (st, info) => { s.state = st; emit('onState', st, info || {}); };
    const status = (text, kind) => emit('onStatus', text || '', kind || '');
    const touch = () => { s.lastUse = Date.now(); };
    const visible = () => document.visibilityState !== 'hidden';
    const isOpen = () => (typeof opts.isOpen === 'function' ? opts.isOpen() : true);

    // iOS only lets a page speak after speech was started from a tap.
    function unlock() {
      if (s.unlocked || !canSpeak()) return;
      s.unlocked = true;
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        speechSynthesis.speak(u);
      } catch (e) { /* ignore */ }
    }

    // ----- recognition
    function stopMeter() { if (s.meterStop) { s.meterStop(); s.meterStop = null; } }
    function stopRec(abort) {
      const r = s.rec;
      clearTimeout(s.listenTimer);
      if (!r) return;
      s.rec = null;
      clearTimeout(r.settle);
      r.dead = true;
      try { if (abort) r.rec.abort(); else r.rec.stop(); } catch (e) { /* ignore */ }
      stopMeter();
    }

    function startRec(mode) {
      if (!SR) return null;
      stopRec(true);
      let rec;
      try { rec = new SR(); } catch (e) { return null; }
      rec.lang = s.lang;
      rec.continuous = mode !== 'once';
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      const r = { rec, mode, capturing: mode === 'once', base: 0, scanFrom: 0, utter: '', fin: '', error: null, settle: null, dead: false, results: 0, startedAt: Date.now() };
      rec.onaudiostart = () => { if (r.capturing && !s.meterStop) s.meterStop = startMeter((lvl) => emit('onLevel', lvl)); };
      rec.onresult = (e) => onResult(r, e);
      rec.onerror = (e) => { r.error = (e && e.error) || 'error'; };
      rec.onend = () => onEnd(r);
      try { rec.start(); } catch (e) { return null; }
      s.rec = r;
      return r;
    }

    function settleLater(r, ms) {
      clearTimeout(r.settle);
      r.settle = setTimeout(() => {
        if (r.dead || s.rec !== r) return;
        r.finishing = true;
        try { r.rec.stop(); } catch (e) { onEnd(r); }
        // Some browsers never fire "end" after stop(): don't wait forever.
        setTimeout(() => { if (s.rec === r) onEnd(r); }, 1200);
      }, ms);
    }

    function beginCapture(r, base, why) {
      r.capturing = true;
      r.base = base;
      touch();
      if (s.state === 'speaking') stopSpeaking();
      setState('listening', { why });
      status(why === 'wake' ? 'Yes? I’m listening…' : 'Listening…');
      emit('onHeard', '', false);
      if (!s.meterStop) s.meterStop = startMeter((lvl) => emit('onLevel', lvl));
      if (window.ChowaniecHaptics) try { window.ChowaniecHaptics.tap('light'); } catch (e) { /* ignore */ }
    }

    // Does what was heard while Bob talks look like Bob's own voice coming back through the speakers?
    function isEcho(heard) {
      const said = norm((s.speaking && s.speaking.list.join(' ')) || '');
      const words = norm(heard).split(' ').filter(Boolean);
      if (words.length < 2) return true;
      const inSaid = words.filter((w) => said.includes(w)).length;
      return inSaid / words.length >= 0.5;
    }

    function onResult(r, e) {
      if (r.dead || s.rec !== r) return;
      let fin = ''; let int = '';
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0] ? res[0].transcript : '';
        if (res.isFinal) fin += `${t} `; else int += `${t} `;
      }
      r.results += 1;
      const full = `${fin}${int}`.replace(/\s+/g, ' ');
      if (!r.capturing) {
        const fresh = full.slice(r.scanFrom);
        const m = WAKE.exec(fresh);
        if (m) {
          beginCapture(r, r.scanFrom + m.index + m[0].length, 'wake');
        } else if (r.mode === 'barge' && int.trim() && !isEcho(int)) {
          beginCapture(r, fin.replace(/\s+/g, ' ').length, 'barge');
        } else {
          // Keep scanning only the newest words, so an old "hey bob" can't fire twice.
          if (fin.length > r.scanFrom + 200) r.scanFrom = Math.max(0, fin.replace(/\s+/g, ' ').length - 60);
          return;
        }
      }
      r.utter = full.slice(r.base).replace(/^[\s,.!?]+/, '').trim();
      emit('onHeard', r.utter, false);
      // continuous=false ends by itself on most browsers; iOS sometimes doesn't, so stop after a pause.
      settleLater(r, r.utter ? (r.mode === 'once' ? 1700 : 1400) : 6000);
    }

    function onEnd(r) {
      if (r.ended) return;
      r.ended = true;
      clearTimeout(r.settle);
      if (s.rec === r) { s.rec = null; clearTimeout(s.listenTimer); }
      stopMeter();
      emit('onLevel', null);
      if (r.dead && !r.finishing) return;       // we stopped it on purpose
      if (s.destroyed) return;
      const blocked = r.error === 'not-allowed' || r.error === 'service-not-allowed';
      if (r.capturing) {
        if (r.utter) { submit(r.utter, { spoken: true }); return; }
        if (blocked) {
          setState('idle');
          status('Bob can’t hear you: microphone access is blocked for this site. Allow it in your browser’s settings, or type below.', 'error');
          if (s.wake) setWake(false, 'blocked');
          return;
        }
        if (r.error === 'audio-capture') { setState('idle'); status('No microphone was found. You can type to Bob below.', 'error'); return; }
        if (r.error === 'network') { setState('idle'); status('Bob couldn’t reach the speech service. Check your connection, or type below.', 'error'); return; }
        if (r.error === 'language-not-supported') { setState('idle'); status('That language isn’t available for listening here. Pick another language or type below.', 'error'); return; }
        setState('idle');
        status(r.mode === 'once' ? 'I didn’t catch that. Tap the mic and try again.' : '');
        resumeWake();
        return;
      }
      // A wake-word or barge-in listener ended without hearing anything for Bob.
      if (blocked) { if (s.wake) setWake(false, 'blocked'); return; }
      if (r.mode === 'barge') { if (s.state === 'speaking' && !ios) setTimeout(() => { if (s.state === 'speaking' && !s.rec) startRec('barge'); }, 250); return; }
      if (r.mode === 'wake') {
        const quick = Date.now() - r.startedAt < 1500;
        s.wakeFails = quick ? s.wakeFails + 1 : 0;
        if (s.wakeFails >= 4) { setWake(false, 'failed'); return; }
        resumeWake(quick ? 1500 : 250);
      }
    }

    function listen() {
      unlock();
      touch();
      if (!SR) {
        setState('idle');
        emit('onUnsupported');
        status(`Listening isn’t available in this browser (it works in Chrome, Edge and Safari). You can type to Bob below${support.speak ? ' and he’ll still answer out loud' : ''}.`, 'warn');
        return false;
      }
      stopSpeaking();
      const r = startRec('once');
      if (!r) { setState('idle'); status('The microphone couldn’t start. Tap the mic to try again.', 'error'); return false; }
      setState('listening', { why: 'tap' });
      status('Listening…');
      emit('onHeard', '', false);
      clearTimeout(s.listenTimer);
      s.listenTimer = setTimeout(() => { if (s.rec === r) { r.finishing = true; try { r.rec.stop(); } catch (e) { onEnd(r); } } }, 12000);
      return true;
    }

    // The main button / tapping Bob.
    function tap() {
      unlock();
      touch();
      if (s.state === 'speaking') {
        stopSpeaking();
        stopRec(true);
        setState('idle');
        status('Okay, I’ll stop. Tap the mic to talk.');
        resumeWake();
        return;
      }
      if (s.state === 'listening') {
        const r = s.rec;
        if (r && r.utter) { r.finishing = true; try { r.rec.stop(); } catch (e) { onEnd(r); } return; }
        stopRec(true);
        setState('idle');
        status('Tap the mic to talk.');
        resumeWake();
        return;
      }
      if (s.state === 'thinking') { status('Still thinking…'); return; }
      listen();
    }

    // ----- speaking
    function stopSpeaking() {
      s.speakToken += 1;
      s.speaking = null;
      if (canSpeak()) { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
      emit('onMouth', 'closed');
    }

    function speakList(list, done) {
      stopSpeaking();
      const token = s.speakToken;
      if (!list.length || !canSpeak()) { done(); return; }
      const lang = looksPolish(list.join(' ')) ? 'pl-PL' : (s.lang.startsWith('pl') ? 'en-US' : s.lang);
      const voice = pickVoice(lang);
      s.speaking = { list, index: 0 };
      setState('speaking');
      if (SR && !ios && opts.bargeIn !== false) startRec('barge');
      let mouthTimer = null;
      const next = (i) => {
        if (token !== s.speakToken) return;
        if (i >= list.length) {
          s.speaking = null;
          emit('onMouth', 'closed');
          if (s.rec && s.rec.mode === 'barge' && !s.rec.capturing) stopRec(true);
          if (s.state === 'speaking') setState('idle');
          done();
          return;
        }
        s.speaking.index = i;
        const u = new SpeechSynthesisUtterance(list[i]);
        u.lang = voice ? voice.lang : lang;
        if (voice) u.voice = voice;
        u.rate = 1.03;
        u.pitch = 1.06;
        let finished = false;
        const end = () => { if (finished) return; finished = true; clearTimeout(watch); next(i + 1); };
        // Chrome sometimes never fires "end": move on after a generous guess of the sentence's length.
        const watch = setTimeout(end, 3500 + list[i].length * 95);
        u.onstart = () => {
          if (token !== s.speakToken) return;
          emit('onSpeak', i, list);
          s.sync = false;
          setTimeout(() => { if (token === s.speakToken && !s.sync) emit('onMouth', 'loop'); }, 450);
        };
        u.onboundary = (e) => {
          if (token !== s.speakToken || (e && e.name && e.name !== 'word')) return;
          s.sync = true;
          emit('onMouth', 'open');
          clearTimeout(mouthTimer);
          mouthTimer = setTimeout(() => emit('onMouth', 'half'), 130);
        };
        u.onend = end;
        u.onerror = (e) => { if (e && (e.error === 'interrupted' || e.error === 'canceled')) { finished = true; clearTimeout(watch); return; } end(); };
        try {
          speechSynthesis.resume();
          speechSynthesis.speak(u);
        } catch (e) { end(); }
      };
      next(0);
    }

    function speak(sentences, after) {
      speakList(sentences, () => { if (after) after(); });
    }

    // ----- a turn
    function matchQuick(text) {
      const q = s.quick;
      if (!q || !q.length) return null;
      const t = norm(text);
      const exact = q.find((a) => norm(a.label) === t || norm(a.reply) === t);
      if (exact) return exact;
      if (YES.test(text)) return q.find((a) => YES.test(a.label)) || null;
      if (NO.test(text)) return q.find((a) => NO.test(a.label)) || null;
      return q.find((a) => t.length > 3 && norm(a.label).startsWith(t)) || null;
    }

    function afterReply(reply) {
      if (s.destroyed) return;
      if (s.rest.length) status('Say “tell me more” to hear the rest.');
      else status(reply && reply.quickAnswers && reply.quickAnswers.length ? '' : 'Tap the mic to talk again.');
      // Bob asked something: listen for the answer straight away (hands-free).
      if (reply && reply.quickAnswers && reply.quickAnswers.length && isOpen() && SR && visible() && opts.followUp !== false) {
        setTimeout(() => {
          if (s.state !== 'idle' || s.destroyed || !isOpen()) return;
          if (listen()) status('Listening for your answer…');
          else status('Tap the mic to answer.');
        }, 350);
        return;
      }
      resumeWake();
    }

    async function submit(raw, how) {
      const text = String(raw || '').trim();
      if (!text) return;
      touch();
      const spoken = !(how && how.typed);
      emit('onHeard', text, true);
      if (spoken && STOP.test(text)) {
        stopSpeaking();
        setState('idle');
        status('Okay.');
        resumeWake();
        return;
      }
      if (MORE.test(text) && s.rest.length) {
        const rest = s.rest;
        s.rest = [];
        emit('onMore', rest);
        status('');
        speak(rest, () => afterReply(null));
        return;
      }
      const quick = matchQuick(text);
      const send = quick ? quick.reply : text;
      s.quick = null;
      s.rest = [];
      stopSpeaking();
      const token = ++s.turnToken;
      setState('thinking');
      status('Thinking…');
      emit('onSaid', '', [], -1);
      let reply;
      try {
        reply = await opts.ask(send, {
          spoken, heard: text,
          onText: (t) => { if (token === s.turnToken) emit('onSaid', plainText(t), null, -1); },
          onTool: (label) => { if (token === s.turnToken && label) status(`${label}…`); }
        });
      } catch (e) {
        reply = { error: (e && e.message) || 'Something went wrong.' };
      }
      if (token !== s.turnToken || s.destroyed) return;
      if (!reply || reply.error) {
        setState('idle');
        const msg = (reply && reply.error) || 'Something went wrong. Try again.';
        status(msg, 'error');
        if (reply && reply.stopped) return;
        speak(sentencesOf(msg).slice(0, 1), () => resumeWake());
        return;
      }
      s.quick = Array.isArray(reply.quickAnswers) ? reply.quickAnswers : null;
      const all = speakable(reply.text);
      const first = all.slice(0, FIRST_SENTENCES);
      s.rest = all.slice(FIRST_SENTENCES);
      emit('onReply', reply, all, FIRST_SENTENCES);
      emit('onSaid', all.join(' '), all, -1);
      if (!canSpeak() || opts.mute) { setState('idle'); afterReply(reply); return; }
      status('');
      speak(first, () => afterReply(reply));
    }

    // ----- "Hey Bob"
    function resumeWake(delay) {
      if (!s.wake || s.destroyed) return;
      setTimeout(() => {
        if (!s.wake || s.destroyed || s.state !== 'idle' || s.rec || !visible()) return;
        if (Date.now() - s.lastUse >= WAKE_IDLE_MS) { setWake(false, 'timeout'); return; }
        const r = startRec('wake');
        if (!r) { s.wakeFails += 1; if (s.wakeFails >= 4) setWake(false, 'failed'); else resumeWake(1500); }
      }, delay == null ? 400 : delay);
    }

    function setWake(on, why) {
      const want = !!on && !!SR;
      if (on && !SR) { emit('onUnsupported'); status('“Hey Bob” needs a browser that can listen (Chrome, Edge or Safari).', 'warn'); }
      s.wake = want;
      clearInterval(s.wakeTimer);
      if (want) {
        unlock();
        touch();
        s.wakeFails = 0;
        s.wakeTimer = setInterval(() => {
          if (s.wake && Date.now() - s.lastUse >= WAKE_IDLE_MS && s.state === 'idle') setWake(false, 'timeout');
        }, 15000);
        if (s.state === 'idle' && visible()) {
          const r = startRec('wake');
          if (!r) resumeWake(1000);
        }
        status('Say “Hey Bob” any time while this page is open.');
      } else {
        if (s.rec && s.rec.mode === 'wake' && !s.rec.capturing) stopRec(true);
        if (why === 'timeout') status('“Hey Bob” turned off after 10 minutes without use.');
        else if (why === 'blocked') status('“Hey Bob” is off: the microphone is blocked for this site.', 'error');
        else if (why === 'failed') status('“Hey Bob” stopped: this browser wouldn’t keep listening. Tap the mic instead.', 'warn');
        else if (why === 'user') status('“Hey Bob” is off.');
      }
      emit('onWake', want, why || '');
    }

    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        // Never listen or talk in the background.
        stopRec(true);
        stopSpeaking();
        if (s.state === 'listening' || s.state === 'speaking') setState('idle');
      } else if (s.wake) {
        if (Date.now() - s.lastUse >= WAKE_IDLE_MS) setWake(false, 'timeout');
        else resumeWake(300);
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    const onHide = () => destroy();
    window.addEventListener('pagehide', onHide);

    function destroy() {
      s.destroyed = true;
      s.wake = false;
      clearInterval(s.wakeTimer);
      stopRec(true);
      stopSpeaking();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
    }

    // Stop everything that is going on (closing the panel), but keep the session usable.
    function halt() {
      s.turnToken += 1;
      stopRec(true);
      stopSpeaking();
      setState('idle');
    }

    return {
      tap, listen, submit: (text, how) => submit(text, how || { typed: true }), stopSpeaking, halt, destroy, setWake,
      setLang: (l) => { s.lang = normLang(l); try { localStorage.setItem(LANG_KEY, s.lang); } catch (e) { /* ignore */ } if (s.rec && s.rec.mode === 'wake') { stopRec(true); resumeWake(100); } },
      get state() { return s.state; }, get wake() { return s.wake; }, get lang() { return s.lang; },
      get rest() { return s.rest.slice(); },
      touch, _s: s
    };
  }

  // ---------- talking to the agent from any page ----------
  const AGENT_URL = '/.netlify/functions/ai-agent';
  const CONV_KEY = 'chowaniec_bob_conv';
  function convId() { try { return sessionStorage.getItem(CONV_KEY) || ''; } catch (e) { return ''; } }
  function setConvId(id) { try { if (id) sessionStorage.setItem(CONV_KEY, id); else sessionStorage.removeItem(CONV_KEY); } catch (e) { /* ignore */ } }
  function chatChoice() { try { return localStorage.getItem('chowaniec_ai_chat') || 'no-emilia'; } catch (e) { return 'no-emilia'; } }

  async function askAgent(text, hooks) {
    const h = hooks || {};
    const user = typeof window.getChowaniecUser === 'function' ? window.getChowaniecUser() : null;
    if (!user || !user.key) return { error: 'Please sign in again to talk to Bob.' };
    const body = { message: text, chat: chatChoice(), voice: h.spoken !== false };
    const id = convId();
    if (id) body.conversationId = id;
    let res;
    try {
      res = await fetch(AGENT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Chowaniec-Key': user.key, Accept: 'application/x-ndjson' }, body: JSON.stringify(body), signal: h.signal, cache: 'no-store' });
    } catch (e) {
      return { error: e && e.name === 'AbortError' ? 'Stopped.' : 'Bob couldn’t reach the server. Check your connection.', stopped: e && e.name === 'AbortError' };
    }
    if (!res.ok) {
      let data = {};
      try { data = await res.json(); } catch (e) { data = {}; }
      return { error: res.status === 401 ? 'Please sign in again to talk to Bob.' : data.error || `Something went wrong (${res.status}).` };
    }
    let text2 = '';
    let done = null;
    let error = null;
    const handle = (evt) => {
      if (!evt || typeof evt !== 'object') return;
      if (evt.type === 'start' && evt.conversationId) { setConvId(evt.conversationId); if (h.onStart) h.onStart(evt.conversationId); }
      else if (evt.type === 'text' && evt.text) { text2 += evt.text; if (h.onText) h.onText(text2); }
      else if (evt.type === 'tool' && h.onTool) h.onTool(evt.label || '', evt);
      else if (evt.type === 'tool_result' && h.onToolResult) h.onToolResult(evt);
      else if (evt.type === 'done') done = evt.message || {};
      else if (evt.type === 'error') error = evt.error || 'Something went wrong.';
    };
    try {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) { try { handle(JSON.parse(line)); } catch (e) { /* skip */ } }
        }
      }
      if (buf.trim()) { try { handle(JSON.parse(buf.trim())); } catch (e) { /* skip */ } }
    } catch (e) {
      return { error: e && e.name === 'AbortError' ? 'Stopped.' : 'The answer was cut off. Try again.', stopped: e && e.name === 'AbortError' };
    }
    if (error) return { error };
    if (!done) return { error: 'Bob didn’t answer. Try again.' };
    return { text: done.text || text2, quickAnswers: done.quickAnswers || null, sources: done.sources || [], actions: done.actions || [], conversationId: convId() };
  }

  // ---------- the panel ----------
  const svg = (paths, cls) => `<svg class="${cls || 'bv-ic'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
  const ICONS = {
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    send: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    note: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    event: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    gamenight: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.7V17c0 .6-.5 1-1 1.2C7.9 18.8 7 20.2 7 22"/><path d="M14 14.7V17c0 .6.5 1 1 1.2 1.1.6 2 2 2 3.8"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    record: '<path d="M11.5 2.3a.5.5 0 0 1 1 0l2.3 4.7a2 2 0 0 0 1.6 1.2l5.2.7a.5.5 0 0 1 .3.9l-3.8 3.7a2 2 0 0 0-.6 1.9l.9 5.1a.5.5 0 0 1-.8.6l-4.6-2.4a2 2 0 0 0-2 0L6.4 21a.5.5 0 0 1-.8-.6l.9-5.1a2 2 0 0 0-.6-1.9L2.2 9.8a.5.5 0 0 1 .3-.9l5.2-.7a2 2 0 0 0 1.6-1.2z"/>',
    open: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
    ear: '<path d="M6 8.5a6 6 0 1 1 12 0c0 6-6 6-6 10a3.5 3.5 0 1 1-7 0"/><path d="M15 8.5a3 3 0 1 0-6 0"/>'
  };
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function safeHref(url) {
    try {
      const u = new URL(String(url || ''), location.origin);
      if (u.origin !== location.origin) return null;
      return u.pathname + u.search + u.hash;
    } catch (e) { return null; }
  }
  function shortDate(when) {
    const s = String(when || '');
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  }
  const SOURCE_KIND = { chat: 'Chat', note: 'Note', event: 'Event', gamenight: 'Game night', record: 'Record' };
  function sourceChipsHtml(sources) {
    return (sources || []).map((src) => {
      const href = safeHref(src.url);
      if (!href) return '';
      const date = shortDate(src.when);
      return `<a class="bv-src" href="${esc(href)}" data-src="${esc(src.type)}" title="${esc(`${SOURCE_KIND[src.type] || 'Source'}: ${src.title}${date ? `, ${date}` : ''}`)}">${svg(ICONS[src.type] || ICONS.note, 'bv-src-ic')}<span class="bv-src-t">${esc(src.title)}</span>${date ? `<span class="bv-src-d">${esc(date)}</span>` : ''}</a>`;
    }).join('');
  }

  let uid = 0;
  // opts: { variant: 'pop' | 'sheet', bob: element (an existing .bob to animate), anchor: element to sit next to,
  //         ask: custom ask(text, hooks) (default askAgent), showExtras (sources + links in the panel), openInAi, onClose }
  function mountPanel(po) {
    const p = Object.assign({ variant: 'pop', showExtras: true, openInAi: true }, po || {});
    const id = `bv${++uid}`;
    const root = document.createElement('div');
    root.className = `bv bv-${p.variant}`;
    root.id = `${id}-panel`;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'false');
    root.setAttribute('aria-labelledby', `${id}-title`);
    root.hidden = true;
    const langs = [...new Set([normLang(navigator.language || 'en-US'), 'en-US', 'pl-PL'])];
    const langName = (l) => { try { return new Intl.DisplayNames([l], { type: 'language' }).of(l); } catch (e) { return l; } };
    root.innerHTML = `
      <div class="bv-head">
        <span class="bv-title" id="${id}-title">Talk to Bob</span>
        <span class="bv-wake-dot" aria-hidden="true"></span>
        <label class="bv-lang"><span class="bv-sr">Language</span><select data-bv="lang">${langs.map((l) => `<option value="${esc(l)}">${esc(langName(l))}</option>`).join('')}</select></label>
        <button type="button" class="bv-x" data-bv="close" aria-label="Close voice mode">${svg(ICONS.x)}</button>
      </div>
      ${p.variant === 'sheet' ? `<div class="bv-stage"><div class="bv-halo" aria-hidden="true"></div><div class="bv-bob" data-bv="bob"></div></div>` : ''}
      <p class="bv-status" data-bv="status" role="status" aria-live="polite"></p>
      <div class="bv-captions">
        <div class="bv-line bv-you" data-bv="you-wrap" hidden><span class="bv-who">You</span><p class="bv-heard" data-bv="heard"></p></div>
        <div class="bv-line bv-him" data-bv="him-wrap" hidden><span class="bv-who">Bob</span><p class="bv-said" data-bv="said" aria-live="polite"></p></div>
      </div>
      <div class="bv-extra" data-bv="extra" hidden></div>
      <div class="bv-controls">
        <button type="button" class="bv-mic" data-bv="mic" aria-label="Start talking"><span class="bv-mic-ring" aria-hidden="true"></span>${svg(ICONS.mic, 'bv-ic bv-ic-mic')}${svg(ICONS.stop, 'bv-ic bv-ic-stop')}</button>
        <form class="bv-type" data-bv="form" autocomplete="off">
          <label class="bv-type-label" for="${id}-input">Or type to Bob</label>
          <div class="bv-type-row"><input id="${id}-input" data-bv="input" type="text" enterkeyhint="send" autocomplete="off"><button type="submit" class="bv-send" aria-label="Send to Bob">${svg(ICONS.send)}</button></div>
        </form>
      </div>
      <label class="bv-wake" data-bv="wake-wrap">
        <input type="checkbox" role="switch" data-bv="wake">
        <span class="bv-track" aria-hidden="true"></span>
        <span class="bv-wake-text"><span class="bv-wake-name">“Hey Bob”</span><small>Listens for “Hey Bob” only while this page is open and on screen, never in the background. Turns off after 10 minutes without use.</small></span>
      </label>
      ${p.openInAi ? `<a class="bv-open" data-bv="open" href="/ai/">${svg(ICONS.open)}<span>Open in Chowaniec AI</span></a>` : ''}`;
    document.body.appendChild(root);
    const $ = (k) => root.querySelector(`[data-bv="${k}"]`);
    let bob = p.bob || null;
    if (p.variant === 'sheet' && window.ChowaniecRobot) {
      $('bob').innerHTML = window.ChowaniecRobot.mascot({ state: 'idle' });
      bob = $('bob').querySelector('.bob');
      bob.setAttribute('aria-label', 'Bob. Tap to talk.');
      bob.addEventListener('click', () => session.tap());
      bob.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); session.tap(); } });
    }
    const langSel = $('lang');
    langSel.value = langs.includes(defaultLang()) ? defaultLang() : langs[0];

    let open = false;
    let toolLinks = [];
    let saidList = [];
    const setBob = (state) => {
      if (!bob) return;
      const map = { idle: 'idle', listening: 'listening', thinking: 'thinking', speaking: 'talking' };
      bob.dataset.state = map[state] || 'idle';
    };

    function renderSaid(text, list, current) {
      const said = $('said');
      $('him-wrap').hidden = !text && !(list && list.length);
      if (list && list.length) {
        saidList = list;
        said.innerHTML = list.map((t, i) => `<span class="bv-s${i >= 3 ? ' bv-s-later' : ''}${i === current ? ' bv-s-now' : ''}" data-i="${i}">${esc(t)}</span>`).join(' ');
      } else {
        saidList = [];
        said.textContent = text || '';
      }
    }

    function renderExtras(reply) {
      const box = $('extra');
      if (!(typeof p.showExtras === 'function' ? p.showExtras() : p.showExtras)) { box.hidden = true; return; }
      const links = (reply && reply.actions || []).concat(toolLinks).filter((a) => a && a.label && safeHref(a.url));
      const seen = new Set();
      const uniq = links.filter((a) => { const k = safeHref(a.url); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
      const chips = sourceChipsHtml(reply && reply.sources);
      box.innerHTML = `${chips ? `<div class="bv-srcs" aria-label="Sources">${chips}</div>` : ''}${uniq.length ? `<div class="bv-links">${uniq.map((a) => `<a class="bv-link" href="${esc(safeHref(a.url))}">${esc(a.label)}${svg(ICONS.open, 'bv-ic bv-ic-sm')}</a>`).join('')}</div>` : ''}`;
      box.hidden = !box.innerHTML.trim();
    }

    const ask = p.ask || ((text, hooks) => askAgent(text, {
      ...hooks,
      onToolResult: (evt) => { if (evt.ok && evt.url) toolLinks.push({ label: evt.summary || 'Open', url: evt.url }); }
    }));

    const session = createSession({
      isOpen: () => open,
      ask: (text, hooks) => { toolLinks = []; $('extra').hidden = true; return ask(text, hooks); },
      onState: (st) => {
        root.dataset.state = st;
        setBob(st);
        const mic = $('mic');
        const busy = st === 'listening' || st === 'speaking';
        mic.classList.toggle('on', busy);
        mic.setAttribute('aria-label', st === 'listening' ? 'Stop listening' : st === 'speaking' ? 'Stop Bob talking' : st === 'thinking' ? 'Bob is thinking' : 'Start talking');
        if (p.onState) p.onState(st);
      },
      onStatus: (text, kind) => { const el = $('status'); el.textContent = text; el.dataset.kind = kind || ''; },
      onHeard: (text, final) => {
        $('you-wrap').hidden = !text;
        const h = $('heard');
        h.textContent = text ? `“${text}”` : '';
        h.classList.toggle('bv-interim', !final);
      },
      onSaid: (text, list, current) => renderSaid(text, list, current),
      onSpeak: (i, list) => {
        root.querySelectorAll('.bv-s-now').forEach((el) => el.classList.remove('bv-s-now'));
        const el = root.querySelector(`.bv-s[data-i="${i}"]`);
        if (el && saidList[i] === list[i]) { el.classList.add('bv-s-now'); el.classList.remove('bv-s-later'); }
      },
      onMore: () => root.querySelectorAll('.bv-s-later').forEach((el) => el.classList.remove('bv-s-later')),
      onReply: (reply) => { renderExtras(reply); if (p.onReply) p.onReply(reply); },
      onLevel: (lvl) => {
        const v = lvl == null ? '' : String(Math.round(lvl * 100) / 100);
        [root, bob].forEach((el) => { if (!el) return; if (v) { el.style.setProperty('--lvl', v); el.dataset.meter = '1'; } else { el.style.removeProperty('--lvl'); delete el.dataset.meter; } });
      },
      onMouth: (m) => {
        if (!bob) return;
        if (m === 'loop' || m === 'closed') { delete bob.dataset.sync; bob.style.removeProperty('--mouth'); return; }
        bob.dataset.sync = '1';
        bob.style.setProperty('--mouth', m === 'open' ? '1' : '0.35');
      },
      onWake: (on) => {
        $('wake').checked = on;
        root.classList.toggle('bv-waking', on);
        if (bob) { if (on) bob.dataset.wake = '1'; else delete bob.dataset.wake; }
        if (p.onWake) p.onWake(on);
      },
      onUnsupported: () => { root.classList.add('bv-nosr'); }
    });
    if (!support.listen) root.classList.add('bv-nosr');

    // ----- placement (pop variant): next to Bob, above the keyboard
    function place() {
      if (p.variant !== 'pop' || !open) return;
      const a = p.anchor ? p.anchor.getBoundingClientRect() : null;
      const vv = window.visualViewport;
      const viewH = vv ? vv.height + vv.offsetTop : innerHeight;
      root.style.top = ''; root.style.bottom = ''; root.style.left = ''; root.style.right = '';
      const topSafe = (vv ? vv.offsetTop : 0) + 12;
      if (a && a.top < innerHeight * 0.3) {           // Bob in a header: drop down from him
        root.style.top = `${Math.round(a.bottom + 8)}px`;
        root.style.right = '8px';
        root.style.maxHeight = `${Math.max(240, Math.round(viewH - a.bottom - 20))}px`;
      } else {
        const keyboard = vv && innerHeight - vv.height > 150;
        const bottom = keyboard ? innerHeight - viewH + 8 : (a ? innerHeight - a.top + 8 : 16);
        root.style.bottom = `${Math.round(bottom)}px`;
        root.style.left = `${Math.max(8, Math.round(a ? Math.min(a.left, innerWidth - root.offsetWidth - 8) : 8))}px`;
        // Never taller than the room above Bob (or above the keyboard).
        root.style.maxHeight = `${Math.max(220, Math.round(innerHeight - bottom - topSafe))}px`;
      }
    }
    addEventListener('resize', place);
    if (window.visualViewport) visualViewport.addEventListener('resize', place);

    function show() {
      if (!open) {
        open = true;
        root.hidden = false;
        root.classList.remove('bv-closing');
        requestAnimationFrame(() => root.classList.add('bv-in'));
        place();
        if (!$('status').textContent) $('status').textContent = support.listen ? 'Tap the mic and ask me anything.' : '';
        if (!support.listen) {
          $('status').textContent = `Listening isn’t available in this browser (it works in Chrome, Edge and Safari). Type to Bob below${support.speak ? ' and he’ll answer out loud' : ''}.`;
          $('status').dataset.kind = 'warn';
        }
        document.addEventListener('keydown', onKey);
        if (p.onOpen) p.onOpen();
      }
    }
    function hide() {
      if (!open) return;
      open = false;
      session.halt();
      if (session.wake) session.setWake(false, 'closed');
      root.classList.remove('bv-in');
      root.classList.add('bv-closing');
      setTimeout(() => { if (!open) root.hidden = true; }, 220);
      document.removeEventListener('keydown', onKey);
      if (p.onClose) p.onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); if (session.state === 'speaking' || session.state === 'listening') session.tap(); else hide(); }
    }

    $('close').addEventListener('click', hide);
    $('mic').addEventListener('click', () => session.tap());
    $('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('input');
      const text = input.value.trim();
      if (!text || session.state === 'thinking') return;
      input.value = '';
      session.submit(text, { typed: true });
    });
    $('wake').addEventListener('change', (e) => session.setWake(e.target.checked, e.target.checked ? 'user' : 'user'));
    langSel.addEventListener('change', () => session.setLang(langSel.value));
    // Tapping the captions or the panel while Bob talks stops him.
    root.addEventListener('pointerdown', (e) => {
      if (session.state === 'speaking' && !e.target.closest('button, a, input, select, label')) { session.tap(); }
    });
    const openLink = $('open');
    if (openLink) openLink.addEventListener('click', () => { const c = convId(); openLink.href = c ? `/ai/?c=${encodeURIComponent(c)}` : '/ai/'; });

    return {
      el: root, session,
      get open() { return open; },
      show, hide,
      // Open and start listening in one go (call from a tap: iOS needs it).
      talk() { show(); session.tap(); },
      toggle() { if (open) hide(); else this.talk(); },
      setBob(el) { bob = el; },
      place
    };
  }

  window.BobVoice = { support, createSession, mountPanel, askAgent, speakable, plainText, sentencesOf, pickVoice, sourceChipsHtml, icons: ICONS, svg, _wake: WAKE, _more: MORE, _stop: STOP, WAKE_IDLE_MS };
})();
