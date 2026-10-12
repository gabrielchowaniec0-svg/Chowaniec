// Chowaniec Notes - Live Notes.
// Takes notes during an in-person conversation on one device. Audio goes to a private,
// single-device Daily room with transcription and speaker separation (diarization),
// which labels each line "voice 1", "voice 2"... A short voice calibration (everyone
// says a sentence) maps those voices to names. Every minute the AI rewrites the note
// from the new lines; the transcript is kept underneath. If Daily transcription is
// unavailable, the browser's own speech recognition is used and the speaker is picked
// by tapping their name. Talks to notes.js through window.NotesBridge.
(function () {
  'use strict';

  const SESSION_API = '/.netlify/functions/live-notes-session';
  const AI_API = '/.netlify/functions/notes-ai';
  const NOTES_INTERVAL_MS = 60 * 1000;
  const MAX_LINES_PER_UPDATE = 400;
  const START_TIMEOUT_MS = 12000;
  const TRANSCRIPT_MARKER = '<!-- live-transcript -->';
  const PEOPLE_KEY = 'chowaniec_live_people';

  const live = freshState();

  function freshState() {
    return {
      step: 'closed',          // closed | setup | starting | calibrate | live | finishing | done
      mode: null,              // daily | browser
      call: null,
      recognition: null,
      wakeLock: null,
      people: [],
      voiceMap: {},            // voice index -> name
      calIndex: 0,
      calMessage: '',
      calUnavailable: false,
      lines: [],               // { time, voice, forced, text }
      notesPart: '',           // the AI-managed notes (everything above the transcript)
      notesUpdatedIndex: 0,
      notesUpdatedAt: null,
      updating: false,
      error: '',
      notesError: '',
      override: null,          // name tapped as "speaking now"
      paused: false,
      timer: null,
      writeTimer: null,
      startedAt: null
    };
  }

  const $ = (id) => document.getElementById(id);
  const bridge = () => window.NotesBridge;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function userKey() {
    const user = bridge().user();
    return (user && user.key) || '';
  }

  function clock(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function loadPeople() {
    try {
      const stored = JSON.parse(localStorage.getItem(PEOPLE_KEY));
      if (Array.isArray(stored) && stored.length) return stored.map(String).slice(0, 12);
    } catch (e) {
      // ignore
    }
    const user = bridge().user();
    return user && user.name && user.name !== 'Guest' ? [user.name] : [];
  }

  function savePeople() {
    try {
      localStorage.setItem(PEOPLE_KEY, JSON.stringify(live.people));
    } catch (e) {
      // not remembered
    }
  }

  // --- Speakers ---

  function speakerOf(line) {
    if (line.forced) return line.forced;
    if (line.voice !== null && live.voiceMap[line.voice]) return live.voiceMap[line.voice];
    if (line.voice !== null) return `Voice ${line.voice + 1}`;
    return 'Unknown speaker';
  }

  function unassignedVoices() {
    const seen = new Set(live.lines.filter((l) => l.voice !== null && !l.forced).map((l) => l.voice));
    return [...seen].filter((v) => !live.voiceMap[v]).sort((a, b) => a - b);
  }

  function assignVoice(voice, name) {
    live.voiceMap[voice] = name;
    if (!live.people.includes(name)) live.people.push(name);
    scheduleWrite();
    render();
  }

  // Splits a Daily transcription message into per-voice segments when diarization data exists.
  function segmentsFrom(evt) {
    const raw = evt.rawResponse || {};
    const words = (raw.channel && raw.channel.alternatives && raw.channel.alternatives[0] && raw.channel.alternatives[0].words) || raw.words;
    if (Array.isArray(words) && words.some((w) => Number.isInteger(w.speaker))) {
      const segments = [];
      words.forEach((w) => {
        const text = w.punctuated_word || w.word || '';
        const last = segments[segments.length - 1];
        if (last && last.voice === w.speaker) last.text += ` ${text}`;
        else segments.push({ voice: Number.isInteger(w.speaker) ? w.speaker : null, text });
      });
      return segments.filter((s) => s.text.trim());
    }
    return [{ voice: null, text: evt.text || '' }];
  }

  function addSegment(voice, text) {
    if (live.paused || !text.trim()) return;
    const line = { time: new Date().toISOString(), voice, forced: null, text: text.trim() };

    if (live.step === 'calibrate') {
      const person = live.people[live.calIndex];
      // A voice that already belongs to someone else keeps its owner's name.
      const owner = voice !== null ? live.voiceMap[voice] : null;
      line.forced = owner && owner !== person ? null : person;
      live.lines.push(line);
      calibrateWith(voice, person, text);
    } else {
      if (live.override) line.forced = live.override;
      live.lines.push(line);
    }
    scheduleWrite();
    render();
  }

  // --- Calibration ---

  function calibrateWith(voice, person, text) {
    if (text.trim().split(/\s+/).length < 2) return; // wait for a real sentence
    if (voice === null) {
      // No speaker data: voices can't be told apart automatically on this device.
      live.calUnavailable = true;
      live.calMessage = '';
      goLive();
      return;
    }
    const owner = live.voiceMap[voice];
    if (owner && owner !== person) {
      live.calMessage = `That sounded like ${owner}'s voice. ${person}, please try another sentence, or skip.`;
      return;
    }
    live.voiceMap[voice] = person;
    live.calMessage = '';
    nextCalibration();
  }

  function nextCalibration() {
    live.calIndex++;
    if (live.calIndex >= live.people.length) goLive();
    render();
  }

  function goLive() {
    live.step = 'live';
    clearInterval(live.timer);
    live.timer = setInterval(() => updateNotes(false), NOTES_INTERVAL_MS);
    render();
  }

  // --- Writing the note ---

  function composeNote() {
    const transcript = live.lines.map((l) => `**${clock(l.time)} ${speakerOf(l)}:** ${l.text}  `).join('\n');
    const notes = live.notesPart.trim();
    return `${notes ? `${notes}\n\n` : ''}${TRANSCRIPT_MARKER}\n## Live Transcript\n\n${transcript}\n`;
  }

  function scheduleWrite() {
    clearTimeout(live.writeTimer);
    live.writeTimer = setTimeout(() => bridge().setBodyQuiet(composeNote()), 1500);
  }

  async function updateNotes(final) {
    if (live.updating) return;
    const end = Math.min(live.lines.length, live.notesUpdatedIndex + MAX_LINES_PER_UPDATE);
    if (end <= live.notesUpdatedIndex) {
      if (final) finish();
      return;
    }
    live.updating = true;
    live.notesError = '';
    render();
    try {
      const note = bridge().current();
      const res = await fetch(AI_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Chowaniec-Key': userKey() },
        body: JSON.stringify({
          mode: 'live',
          title: note ? note.title : '',
          markdown: live.notesPart,
          speakers: live.people,
          transcript: live.lines.slice(live.notesUpdatedIndex, end).map((l) => ({
            time: clock(l.time), speaker: speakerOf(l), text: l.text
          }))
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The AI could not update the notes.');
      live.notesPart = data.markdown;
      live.notesUpdatedIndex = end;
      live.notesUpdatedAt = new Date().toISOString();
      clearTimeout(live.writeTimer);
      bridge().setBodyQuiet(composeNote());
    } catch (err) {
      live.notesError = err.message;
    } finally {
      live.updating = false;
      render();
      if (final) {
        if (live.notesUpdatedIndex < live.lines.length && !live.notesError) updateNotes(true);
        else finish();
      }
    }
  }

  // --- Audio: Daily (with speaker separation) or the browser's speech recognition ---

  async function startDaily() {
    if (!window.DailyIframe) throw new Error('Daily is unavailable');
    const res = await fetch(SESSION_API, { method: 'POST', headers: { 'X-Chowaniec-Key': userKey() } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not start live transcription.');

    const call = window.DailyIframe.createCallObject({ audioSource: true, videoSource: false });
    live.call = call;
    const started = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Transcription did not start.')), START_TIMEOUT_MS);
      call.on('transcription-started', () => { clearTimeout(timeout); resolve(); });
      call.on('transcription-error', (evt) => { clearTimeout(timeout); reject(new Error((evt && evt.errorMsg) || 'Transcription failed.')); });
    });
    call.on('transcription-message', (evt) => segmentsFrom(evt).forEach((s) => addSegment(s.voice, s.text)));
    await call.join({ url: data.url, token: data.token, startVideoOff: true });
    call.startTranscription({ punctuate: true, includeRawResponse: true, extra: { diarize: true } });
    await started;
    live.mode = 'daily';
  }

  function startBrowserRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) throw new Error('Live transcription isn\'t available in this browser. Try Chrome or Safari.');
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = (evt) => {
      for (let i = evt.resultIndex; i < evt.results.length; i++) {
        if (evt.results[i].isFinal) addSegment(null, evt.results[i][0].transcript);
      }
    };
    recognition.onerror = (evt) => {
      if (evt.error === 'not-allowed' || evt.error === 'service-not-allowed') {
        live.error = 'Microphone access was blocked. Allow the microphone for this site and try again.';
        stop();
      }
    };
    // Browsers end recognition after silence; keep it going while the session runs.
    recognition.onend = () => {
      if (live.recognition === recognition && !live.paused && ['calibrate', 'live'].includes(live.step)) {
        try { recognition.start(); } catch (e) { /* already restarting */ }
      }
    };
    live.recognition = recognition;
    recognition.start();
    live.mode = 'browser';
    live.calUnavailable = true;
  }

  async function keepScreenOn() {
    try {
      if (navigator.wakeLock) live.wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {
      // Not supported or refused: the tip in the panel covers it.
    }
  }

  // --- Session lifecycle ---

  async function open() {
    const b = bridge();
    if (!b) return;
    if (!b.current()) await b.newNote();
    if (!b.canEditCurrent()) {
      b.toast('You can\'t edit this note, so Live Notes can\'t write to it.');
      return;
    }
    if (['starting', 'calibrate', 'live', 'finishing'].includes(live.step)) {
      render();
      return;
    }
    Object.assign(live, freshState());
    live.people = loadPeople();
    live.step = 'setup';
    render();
  }

  async function start(calibrate) {
    if (!live.people.length) {
      live.error = 'Add at least one person first.';
      render();
      return;
    }
    savePeople();
    const b = bridge();
    const note = b.current();
    if (!note.title.trim()) {
      const title = $('note-title');
      title.value = `Conversation ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
      title.dispatchEvent(new Event('input'));
    }
    live.notesPart = (note.markdown || '').split(TRANSCRIPT_MARKER)[0].trim();
    live.step = 'starting';
    live.error = '';
    live.startedAt = new Date().toISOString();
    b.setLocked(true);
    render();

    try {
      await startDaily();
    } catch (dailyError) {
      cleanupDaily();
      try {
        startBrowserRecognition();
        b.toast('Using this browser\'s transcription. Tap who is speaking to label lines.');
      } catch (browserError) {
        live.error = browserError.message;
        b.setLocked(false);
        live.step = 'setup';
        render();
        return;
      }
    }
    keepScreenOn();
    if (calibrate && !live.calUnavailable) {
      live.step = 'calibrate';
      live.calIndex = 0;
      render();
    } else {
      goLive();
    }
  }

  function cleanupDaily() {
    if (!live.call) return;
    const call = live.call;
    live.call = null;
    try { call.stopTranscription(); } catch (e) { /* ignore */ }
    call.leave().catch(() => {}).finally(() => call.destroy().catch(() => {}));
  }

  function stopAudio() {
    clearInterval(live.timer);
    cleanupDaily();
    if (live.recognition) {
      const r = live.recognition;
      live.recognition = null;
      try { r.stop(); } catch (e) { /* ignore */ }
    }
    if (live.wakeLock) {
      live.wakeLock.release().catch(() => {});
      live.wakeLock = null;
    }
  }

  function stop() {
    if (!['starting', 'calibrate', 'live'].includes(live.step)) return;
    stopAudio();
    live.step = 'finishing';
    render();
    updateNotes(true);
  }

  function finish() {
    clearTimeout(live.writeTimer);
    if (live.lines.length) bridge().setBodyQuiet(composeNote());
    bridge().setLocked(false);
    bridge().saveNow();
    live.step = 'done';
    render();
  }

  function setPaused(paused) {
    live.paused = paused;
    if (live.call) live.call.setLocalAudio(!paused);
    if (live.recognition) {
      try { paused ? live.recognition.stop() : live.recognition.start(); } catch (e) { /* ignore */ }
    }
    render();
  }

  function close() {
    if (['starting', 'calibrate', 'live', 'finishing'].includes(live.step)) return;
    live.step = 'closed';
    render();
  }

  // --- Panel UI ---

  const btn = (action, label, cls, extra) => `<button type="button" data-live="${action}" ${extra || ''} class="min-h-[44px] px-4 rounded-full text-sm font-medium transition-colors ${cls}">${label}</button>`;
  const primary = 'bg-black text-white hover:bg-gray-800';
  const secondary = 'border border-gray-200 bg-white text-gray-700 hover:border-black hover:text-black';
  const chip = (attrs, label, active) => `<button type="button" ${attrs} class="min-h-[40px] px-3.5 rounded-full text-xs font-medium border transition-colors ${active ? 'bg-black text-white border-black' : 'bg-white text-gray-700 border-gray-200 hover:border-black'}">${label}</button>`;

  function renderSetup() {
    return `
      <p class="text-sm text-gray-500 font-light leading-relaxed">Live Notes listens through this device and writes the notes as you talk. First, who's in the conversation?</p>
      <div class="flex flex-wrap gap-2">
        ${live.people.map((p, i) => `
          <span class="inline-flex items-center gap-1 min-h-[40px] pl-3.5 pr-1 rounded-full bg-gray-50 border border-gray-200 text-sm text-gray-800">
            ${escapeHtml(p)}
            <button type="button" data-live="remove-person" data-index="${i}" title="Remove ${escapeHtml(p)}" class="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-black"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
          </span>`).join('')}
      </div>
      <form data-live-form="add" class="flex gap-2">
        <div class="flex-1">
          <label for="live-person" class="block text-[10px] font-mono uppercase tracking-widest text-gray-400 mb-1">Add a person</label>
          <input id="live-person" type="text" maxlength="40" autocomplete="off" class="w-full min-h-[44px] bg-gray-50 border border-gray-200 rounded-xl px-3 text-sm outline-none focus:border-black focus:bg-white">
        </div>
        <button type="submit" class="self-end min-h-[44px] px-4 rounded-xl border border-gray-200 text-sm text-gray-700 hover:border-black">Add</button>
      </form>
      ${live.error ? `<p class="text-xs text-red-600">${escapeHtml(live.error)}</p>` : ''}
      <div class="grid gap-2 pt-1">
        ${btn('start-calibrate', 'Calibrate Voices &amp; Start', primary)}
        ${btn('start-plain', 'Start Without Calibration', secondary)}
      </div>
      <p class="text-[11px] text-gray-400 leading-relaxed">Calibration: each person says a sentence so the notes know whose voice is whose. Keep this screen on while recording.</p>`;
  }

  function renderCalibrate() {
    const person = live.people[live.calIndex];
    return `
      <div class="space-y-1">
        <p class="text-[10px] font-mono uppercase tracking-widest text-gray-400">Voice calibration · ${live.calIndex + 1} of ${live.people.length}</p>
        <p class="text-2xl font-serif text-black">${escapeHtml(person)}, please speak</p>
        <p class="text-sm text-gray-500 font-light leading-relaxed">Say a sentence or two, for example: "Hi, this is ${escapeHtml(person)}, and today I'd like to talk about the next episode."</p>
      </div>
      <div class="flex items-center gap-2 text-xs text-violet-600"><span class="w-2 h-2 rounded-full bg-violet-500 animate-pulse"></span>Listening...</div>
      ${live.calMessage ? `<p class="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3">${escapeHtml(live.calMessage)}</p>` : ''}
      <ul class="space-y-1.5">
        ${live.people.map((p, i) => {
          const done = Object.values(live.voiceMap).includes(p);
          return `<li class="flex items-center gap-2 text-sm ${i === live.calIndex ? 'text-black font-medium' : 'text-gray-500'}">
            <i data-lucide="${done ? 'circle-check' : 'mic'}" class="w-4 h-4 ${done ? 'text-emerald-500' : 'text-gray-300'}"></i>${escapeHtml(p)}
          </li>`;
        }).join('')}
      </ul>
      <div class="grid grid-cols-2 gap-2">
        ${btn('skip-person', 'Skip', secondary)}
        ${btn('finish-calibration', 'Start Notes', primary)}
      </div>`;
  }

  function renderLive() {
    const unassigned = unassignedVoices();
    const recent = live.lines.slice(-30);
    return `
      <div class="flex items-center justify-between gap-2">
        <span class="inline-flex items-center gap-2 text-xs ${live.paused ? 'text-gray-400' : 'text-red-600'}">
          <span class="w-2 h-2 rounded-full ${live.paused ? 'bg-gray-300' : 'bg-red-500 animate-pulse'}"></span>${live.paused ? 'Paused' : 'Listening'}
          ${live.mode === 'daily' ? '<span class="text-gray-400">· voices separated automatically</span>' : ''}
        </span>
        <span class="text-[10px] font-mono text-gray-400">${live.updating ? 'UPDATING NOTES...' : live.notesUpdatedAt ? `NOTES ${escapeHtml(clock(live.notesUpdatedAt))}` : 'NOTES EVERY MINUTE'}</span>
      </div>

      <div class="space-y-1.5">
        <p class="text-[10px] font-mono uppercase tracking-widest text-gray-400">${live.calUnavailable ? "Who's speaking? (tap to label new lines)" : 'Speaking now (optional override)'}</p>
        <div class="flex flex-wrap gap-1.5">
          ${live.calUnavailable ? '' : chip('data-live="override" data-name=""', 'Auto', !live.override)}
          ${live.people.map((p) => chip(`data-live="override" data-name="${escapeHtml(p)}"`, escapeHtml(p), live.override === p)).join('')}
        </div>
      </div>

      ${unassigned.map((v) => `
        <div class="p-3 rounded-2xl bg-violet-50 border border-violet-100 space-y-2">
          <p class="text-xs text-violet-800">New voice heard (Voice ${v + 1}). Who is this?</p>
          <div class="flex flex-wrap gap-1.5">${live.people.map((p) => chip(`data-live="assign" data-voice="${v}" data-name="${escapeHtml(p)}"`, escapeHtml(p), false)).join('')}</div>
        </div>`).join('')}

      ${live.notesError ? `<p class="text-xs text-red-600">${escapeHtml(live.notesError)}</p>` : ''}

      <div class="max-h-[30vh] overflow-y-auto rounded-2xl bg-gray-50 border border-gray-100 p-3 space-y-1.5" id="live-feed">
        ${recent.length ? recent.map((l) => `<p class="text-xs text-gray-600 leading-relaxed"><span class="text-gray-400">${escapeHtml(clock(l.time))}</span> <span class="font-medium text-black">${escapeHtml(speakerOf(l))}:</span> ${escapeHtml(l.text)}</p>`).join('') : '<p class="text-xs text-gray-400">Start talking; lines will appear here.</p>'}
      </div>

      <div class="grid grid-cols-3 gap-2">
        ${btn(live.paused ? 'resume' : 'pause', live.paused ? 'Resume' : 'Pause', secondary)}
        ${btn('update', 'Update', secondary, live.updating ? 'disabled' : '')}
        ${btn('stop', 'Stop', 'bg-red-600 text-white hover:bg-red-500')}
      </div>`;
  }

  function render() {
    const panel = $('live-panel');
    if (!panel) return;
    const visible = live.step !== 'closed';
    panel.classList.toggle('hidden', !visible);
    panel.classList.toggle('flex', visible);
    const liveBtn = $('btn-live');
    if (liveBtn) liveBtn.classList.toggle('ring-2', ['calibrate', 'live'].includes(live.step));
    if (!visible) return;

    let body;
    if (live.step === 'setup') body = renderSetup();
    else if (live.step === 'starting') body = '<p class="text-sm text-gray-500">Starting the microphone and transcription...</p>';
    else if (live.step === 'calibrate') body = renderCalibrate();
    else if (live.step === 'live') body = renderLive();
    else if (live.step === 'finishing') body = '<p class="text-sm text-gray-500">Writing the final notes...</p>';
    else {
      body = `
        <p class="text-sm text-gray-600 leading-relaxed">Live notes are saved in this note${live.lines.length ? `, with the transcript (${live.lines.length} lines) at the bottom` : ''}.</p>
        ${live.notesError ? `<p class="text-xs text-red-600">${escapeHtml(live.notesError)} The transcript is still saved.</p>` : ''}
        ${btn('close', 'Done', primary)}`;
    }
    $('live-body').innerHTML = body;
    $('live-close').classList.toggle('hidden', !['setup', 'done'].includes(live.step));
    if (window.lucide) window.lucide.createIcons();
    const feed = $('live-feed');
    if (feed) feed.scrollTop = feed.scrollHeight;
  }

  function bindEvents() {
    $('btn-live').addEventListener('click', open);
    $('live-close').addEventListener('click', close);
    $('live-body').addEventListener('click', (e) => {
      const el = e.target.closest('[data-live]');
      if (!el) return;
      const action = el.dataset.live;
      if (action === 'remove-person') { live.people.splice(Number(el.dataset.index), 1); render(); }
      else if (action === 'start-calibrate') start(true);
      else if (action === 'start-plain') start(false);
      else if (action === 'skip-person') { live.calMessage = ''; nextCalibration(); }
      else if (action === 'finish-calibration') goLive();
      else if (action === 'override') { live.override = el.dataset.name || null; render(); }
      else if (action === 'assign') assignVoice(Number(el.dataset.voice), el.dataset.name);
      else if (action === 'pause') setPaused(true);
      else if (action === 'resume') setPaused(false);
      else if (action === 'update') updateNotes(false);
      else if (action === 'stop') stop();
      else if (action === 'close') close();
    });
    $('live-body').addEventListener('submit', (e) => {
      const form = e.target.closest('[data-live-form="add"]');
      if (!form) return;
      e.preventDefault();
      const input = $('live-person');
      const name = input.value.trim().slice(0, 40);
      if (name && !live.people.includes(name)) live.people.push(name);
      live.error = '';
      render();
      setTimeout(() => { const i = $('live-person'); if (i) i.focus(); }, 0);
    });
    window.addEventListener('beforeunload', (e) => {
      if (['calibrate', 'live', 'finishing'].includes(live.step)) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  window.ChowaniecLiveNotes = { open, stop, state: live };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindEvents);
  else bindEvents();
})();
