// Chowaniec Group extras: polls, voice messages and scheduled messages.
// Loaded after group.js, which hands over what we need as window.ChowaniecGroup and calls
// window.GroupExtras (richHtml / richClass / menuItems / afterRender) while drawing messages.
(function () {
    'use strict';

    const G = window.ChowaniecGroup;
    if (!G) return;
    const $ = (id) => document.getElementById(id);
    const esc = G.escapeHtml;
    const API = G.API;

    const MAX_VOICE_SECONDS = 300;
    const MIN_VOICE_SECONDS = 1;
    const LONG_PRESS_MS = 480;
    const TIPS_KEY = 'chowaniec_group_tips_v1';

    // Small inline icons (these live inside message bubbles that are redrawn, so no icon library needed).
    const SVG = {
        play: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor"/></svg>',
        pause: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="6" y="5" width="4.5" height="14" rx="1.4" fill="currentColor"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.4" fill="currentColor"/></svg>',
        check: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        lock: '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    };

    function fmtDur(sec) {
        const s = Math.max(0, Math.round(sec));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    function hashStr(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    }

    // ---------------------------------------------------------------- polls
    // NB: bubbles are white-space: pre-wrap, so every template below is one unbroken line of HTML.

    function pollHtml(m) {
        const p = m.poll;
        const me = G.myName();
        const total = p.options.reduce((n, o) => n + o.votes.length, 0);
        const voters = new Set(p.options.reduce((all, o) => all.concat(o.votes), [])).size;
        const rows = p.options.map((o) => {
            const mine = o.votes.some((v) => G.sameName(v, me));
            const pct = total ? Math.round((o.votes.length / total) * 100) : 0;
            const names = o.votes.length ? `<span class="po-names">${esc(o.votes.join(', '))}</span>` : '';
            return `<button type="button" class="po${mine ? ' on' : ''}" data-x="vote" data-mid="${esc(m.id)}" data-opt="${esc(o.id)}" aria-pressed="${mine}"${p.closed ? ' disabled' : ''}>` +
                `<span class="po-fill" style="width:${pct}%"></span>` +
                `<span class="po-mark" aria-hidden="true">${mine ? SVG.check : ''}</span>` +
                `<span class="po-main"><span class="po-text">${esc(o.text)}</span>${names}</span>` +
                `<span class="po-n">${o.votes.length}</span></button>`;
        }).join('');
        const kind = p.closed ? `${SVG.lock} Closed` : (p.multi ? 'Pick any' : 'Pick one');
        const meta = `${kind}<span class="dotsep">·</span>${voters} ${voters === 1 ? 'person has' : 'people have'} voted`;
        return `<div class="poll${p.closed ? ' closed' : ''}"><div class="poll-q">${esc(p.question)}</div><div class="poll-meta">${meta}</div>${rows}</div>`;
    }

    async function castVote(mid, optionId) {
        const m = G.findMessage(mid);
        if (!m || !m.poll || m.poll.closed) return;
        const me = G.myName();
        const before = m.poll;
        // Show the vote straight away, then confirm with the server.
        const next = JSON.parse(JSON.stringify(before));
        const opt = next.options.find((o) => o.id === optionId);
        if (!opt) return;
        const had = opt.votes.some((v) => G.sameName(v, me));
        if (!next.multi) next.options.forEach((o) => { o.votes = o.votes.filter((v) => !G.sameName(v, me)); });
        if (next.multi) opt.votes = had ? opt.votes.filter((v) => !G.sameName(v, me)) : opt.votes.concat([me]);
        else if (!had) opt.votes.push(me);
        G.upsert([Object.assign({}, m, { poll: next })]);
        G.render('auto');
        try {
            const data = await G.api(API, { method: 'POST', body: { action: 'vote', id: mid, option: optionId } });
            if (data && data.message) G.upsert([data.message]);
        } catch (e) {
            G.upsert([Object.assign({}, m, { poll: before })]);
            if (e.status !== 401) G.toast(e.message, 'error');
        }
        G.render('auto');
    }

    async function closePoll(mid) {
        try {
            const data = await G.api(API, { method: 'POST', body: { action: 'closepoll', id: mid } });
            if (data && data.message) G.upsert([data.message]);
            G.render('auto');
            G.toast('Poll closed');
        } catch (e) {
            if (e.status !== 401) G.toast(e.message, 'error');
        }
    }

    // -- poll maker
    let pollModal = null;

    function buildPollModal() {
        const el = document.createElement('div');
        el.id = 'poll-modal';
        el.className = 'modal hidden';
        el.style.zIndex = '70';
        el.innerHTML = '<div class="modal-card form-card fade-in" role="dialog" aria-modal="true" aria-labelledby="poll-title">' +
            '<h3 id="poll-title">New poll</h3>' +
            '<label class="fld" for="poll-q"><span>Question</span></label>' +
            '<input id="poll-q" class="fld-input" type="text" maxlength="200" autocomplete="off">' +
            '<div class="fld"><span>Answers</span></div>' +
            '<div id="poll-opts" class="poll-opts"></div>' +
            '<button type="button" id="poll-add" class="btn btn-ghost add-opt">Add another answer</button>' +
            '<label class="chk"><input type="checkbox" id="poll-multi"><span class="chk-box" aria-hidden="true"></span><span>Let people pick more than one</span></label>' +
            '<div id="poll-error" class="form-error hidden" role="alert"></div>' +
            '<div class="modal-actions"><button type="button" id="poll-cancel" class="btn btn-ghost">Cancel</button><button type="button" id="poll-send" class="btn btn-solid">Send poll</button></div>' +
            '</div>';
        document.body.appendChild(el);
        el.addEventListener('click', (e) => { if (e.target === el) closePollModal(); });
        $('poll-cancel').addEventListener('click', closePollModal);
        $('poll-add').addEventListener('click', () => addPollOption(true));
        $('poll-send').addEventListener('click', sendPoll);
        $('poll-opts').addEventListener('click', (e) => {
            const rm = e.target.closest('[data-rm]');
            if (!rm) return;
            const rows = $('poll-opts').children;
            if (rows.length <= 2) return;
            rm.closest('.po-row').remove();
            renumberPollOptions();
        });
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closePollModal();
            if (e.key === 'Enter' && e.target.matches('#poll-opts input')) {
                e.preventDefault();
                const rows = [...$('poll-opts').querySelectorAll('input')];
                const i = rows.indexOf(e.target);
                if (i < rows.length - 1) rows[i + 1].focus();
                else if (rows.length < 8) addPollOption(true);
            }
        });
        return el;
    }

    function addPollOption(focus) {
        const box = $('poll-opts');
        if (box.children.length >= 8) return;
        const n = box.children.length + 1;
        const row = document.createElement('div');
        row.className = 'po-row';
        row.innerHTML = `<span class="po-num" aria-hidden="true">${n}</span><input type="text" class="fld-input" maxlength="100" autocomplete="off" aria-label="Answer ${n}">` +
            `<button type="button" class="po-rm" data-rm="1" aria-label="Remove answer ${n}" title="Remove"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg></button>`;
        box.appendChild(row);
        renumberPollOptions();
        if (focus) row.querySelector('input').focus();
    }

    function renumberPollOptions() {
        const rows = [...$('poll-opts').children];
        rows.forEach((r, i) => {
            r.querySelector('.po-num').textContent = String(i + 1);
            r.querySelector('input').setAttribute('aria-label', `Answer ${i + 1}`);
            const rm = r.querySelector('.po-rm');
            rm.setAttribute('aria-label', `Remove answer ${i + 1}`);
            rm.style.visibility = rows.length > 2 ? 'visible' : 'hidden';
        });
        $('poll-add').style.display = rows.length >= 8 ? 'none' : '';
    }

    function openPollModal() {
        if (!pollModal) pollModal = buildPollModal();
        $('poll-q').value = '';
        $('poll-opts').innerHTML = '';
        $('poll-multi').checked = false;
        $('poll-error').classList.add('hidden');
        addPollOption(false);
        addPollOption(false);
        $('poll-send').disabled = false;
        G.show(pollModal);
        setTimeout(() => $('poll-q').focus(), 60);
    }

    function closePollModal() { if (pollModal) G.hide(pollModal); }

    async function sendPoll() {
        const question = $('poll-q').value.trim();
        const options = [...$('poll-opts').querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
        const err = $('poll-error');
        const fail = (t) => { err.textContent = t; err.classList.remove('hidden'); };
        if (!question) return fail('Add a question for the poll.');
        if (options.length < 2) return fail('Add at least two answers.');
        if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return fail('Each answer needs to be different.');
        err.classList.add('hidden');
        $('poll-send').disabled = true;
        try {
            const body = { action: 'poll', question, options, multi: $('poll-multi').checked };
            const reply = G.state.replyTo;
            if (reply) body.replyTo = reply.id;
            const data = await G.api(API, { method: 'POST', body });
            if (data && data.message) { G.state.confirmed.add(data.message.id); G.upsert([data.message]); }
            if (reply) G.setReply(null);
            closePollModal();
            G.render('bottom');
        } catch (e) {
            $('poll-send').disabled = false;
            if (e.status !== 401) fail(e.message || 'Couldn’t send the poll. Please try again.');
        }
    }

    // ---------------------------------------------------------------- voice messages: playing

    // One shared audio element plays every voice message. The recording is downloaded first and played from
    // memory: that works the same on every phone, and iPhones only allow sound that was started by a tap,
    // so the first tap also "unlocks" the element with a moment of silence.
    const player = { audio: null, id: null, speed: 1, loading: false, unlocked: false };
    const SILENCE = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
    const voiceUrls = new Map();       // media id -> blob: URL of the downloaded recording (newest 12 kept)

    function audio() {
        if (player.audio) return player.audio;
        const a = new Audio();
        ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'durationchange', 'error', 'ratechange'].forEach((ev) => a.addEventListener(ev, () => {
            if (ev === 'ended') a.currentTime = 0;
            if (ev === 'error' && player.id && !player.loading && a.getAttribute('src') !== SILENCE) G.toast('Couldn’t play that voice message.', 'error');
            paintVoice(player.id);
        }));
        player.audio = a;
        return a;
    }

    async function voiceUrl(mediaId) {
        if (voiceUrls.has(mediaId)) return voiceUrls.get(mediaId);
        const user = G.state.user;
        const res = await fetch(G.mediaUrl(mediaId), { headers: { 'X-Chowaniec-Key': (user && user.key) || '' }, credentials: 'same-origin' });
        if (!res.ok) throw new Error('Voice message not available');
        const url = URL.createObjectURL(await res.blob());
        voiceUrls.set(mediaId, url);
        while (voiceUrls.size > 12) {
            const oldest = voiceUrls.keys().next().value;
            URL.revokeObjectURL(voiceUrls.get(oldest));
            voiceUrls.delete(oldest);
        }
        return url;
    }

    function voiceHtml(m) {
        const v = m.voice;
        const n = 34;
        const seed = hashStr(m.id);
        let bars = '';
        for (let i = 0; i < n; i++) {
            const r = hashStr(`${seed}:${i}`) % 100;
            const shape = 0.45 + 0.55 * Math.sin((i / (n - 1)) * Math.PI);      // taller in the middle
            const h = Math.round(18 + (r / 100) * 62 * shape + 16 * shape);
            bars += `<i style="height:${Math.min(100, h)}%"></i>`;
        }
        return `<div class="voice" data-mid="${esc(m.id)}" data-dur="${esc(v.duration)}">` +
            `<button type="button" class="v-play" data-x="voice-play" data-mid="${esc(m.id)}" aria-label="Play voice message">${SVG.play}</button>` +
            `<div class="v-body"><div class="v-wave" data-x="voice-seek" data-mid="${esc(m.id)}" role="slider" aria-label="Voice message position" aria-valuemin="0" aria-valuemax="${esc(v.duration)}" aria-valuenow="0">${bars}</div>` +
            `<div class="v-row"><span class="v-time">${fmtDur(v.duration)}</span>${v.transcript ? `<button type="button" class="v-aa" data-x="voice-text" data-mid="${esc(m.id)}" aria-label="Show what was said">Aa</button>` : ''}<button type="button" class="v-speed" data-x="voice-speed" data-mid="${esc(m.id)}" aria-label="Playback speed">1×</button></div></div></div>` +
            (v.transcript ? `<div class="v-text hidden" data-mid="${esc(m.id)}">${esc(v.transcript)}</div>` : '');
    }

    function paintVoice(id) {
        if (!id) return;
        const a = player.audio;
        document.querySelectorAll(`.voice[data-mid="${CSS.escape(id)}"]`).forEach((root) => {
            const active = player.id === id;
            const dur = Number(root.dataset.dur) || (a && a.duration) || 0;
            const total = active && a && isFinite(a.duration) && a.duration > 0 ? a.duration : dur;
            const cur = active && a ? a.currentTime : 0;
            const frac = total && !player.loading ? Math.min(1, cur / total) : 0;
            const playing = active && !player.loading && a && !a.paused && !a.ended;
            root.classList.toggle('playing', playing);
            root.classList.toggle('loading', active && player.loading);
            root.classList.toggle('started', active && cur > 0);
            const btn = root.querySelector('.v-play');
            btn.innerHTML = playing ? SVG.pause : SVG.play;
            btn.setAttribute('aria-label', playing ? 'Pause voice message' : 'Play voice message');
            const bars = root.querySelectorAll('.v-wave i');
            const doneUpTo = Math.round(frac * bars.length);
            bars.forEach((b, i) => b.classList.toggle('done', i < doneUpTo));
            root.querySelector('.v-wave').setAttribute('aria-valuenow', String(Math.round(cur)));
            root.querySelector('.v-time').textContent = active && cur > 0 ? `${fmtDur(cur)} / ${fmtDur(total)}` : fmtDur(dur);
            root.querySelector('.v-speed').textContent = `${String(player.speed).replace('.5', '.5')}×`;
        });
    }

    function stopOtherPlayback() {
        const old = player.id;
        if (player.audio) { player.audio.pause(); }
        player.id = null;
        player.loading = false;
        if (old) paintVoice(old);
    }

    function playVoice(mid, fraction) {
        const m = G.findMessage(mid);
        if (!m || !m.voice) return;
        const a = audio();
        if (player.id === mid && !player.loading) {
            if (fraction != null && isFinite(a.duration)) a.currentTime = fraction * a.duration;
            if (a.paused || a.ended || fraction != null) a.play().catch(() => {}); else a.pause();
            return;
        }
        if (player.id === mid && player.loading) return;
        stopOtherPlayback();
        player.id = mid;
        player.loading = true;
        if (!player.unlocked) {            // still inside the tap: let this element make sound later
            player.unlocked = true;
            a.src = SILENCE;
            a.play().catch(() => {});
        }
        paintVoice(mid);
        voiceUrl(m.voice.id).then((url) => {
            if (player.id !== mid) return null;            // they tapped something else meanwhile
            player.loading = false;
            a.src = url;
            a.playbackRate = player.speed;
            if (fraction != null) {
                const seek = () => { if (isFinite(a.duration)) a.currentTime = fraction * a.duration; a.removeEventListener('loadedmetadata', seek); };
                a.addEventListener('loadedmetadata', seek);
            }
            return a.play();
        }).catch((e) => {
            if (player.id !== mid) return;
            player.loading = false;
            paintVoice(mid);
            if (!e || e.name !== 'AbortError') G.toast('Couldn’t play that voice message.', 'error');
        });
    }

    function cycleSpeed() {
        const order = [1, 1.5, 2];
        player.speed = order[(order.indexOf(player.speed) + 1) % order.length];
        if (player.audio) player.audio.playbackRate = player.speed;
        document.querySelectorAll('.voice .v-speed').forEach((b) => { b.textContent = `${player.speed}×`; });
    }

    // ---------------------------------------------------------------- voice messages: recording

    const rec = { state: 'idle', mr: null, stream: null, chunks: [], t0: 0, timer: null, discard: false, mime: '' };

    function pickMime() {
        if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
        const choices = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
        return choices.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    }

    function setRecUi(state, label) {
        rec.state = state;
        $('composer').classList.toggle('recording', state === 'recording' || state === 'sending' || state === 'failed');
        $('composer').classList.toggle('rec-busy', state === 'sending');
        $('rec-label').textContent = label || '';
        $('rec-send').disabled = state === 'sending';
    }

    function tickRec() {
        const secs = (Date.now() - rec.t0) / 1000;
        $('rec-time').textContent = fmtDur(secs);
        if (secs >= MAX_VOICE_SECONDS && rec.state === 'recording') {
            G.toast('That’s 5 minutes — sending your voice message.');
            finishRecording();
        }
    }

    function releaseStream() {
        if (rec.stream) rec.stream.getTracks().forEach((t) => t.stop());
        rec.stream = null;
    }

    async function startRecording() {
        if (rec.state !== 'idle') return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
            G.toast('Voice messages aren’t available on this browser.', 'error');
            return;
        }
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
            G.toast(denied ? 'Allow the microphone to send voice messages.' : 'Couldn’t start the microphone.', 'error');
            return;
        }
        try {
            rec.mime = pickMime();
            const opts = { audioBitsPerSecond: 32000 };
            if (rec.mime) opts.mimeType = rec.mime;
            rec.mr = new MediaRecorder(stream, opts);
        } catch (e) {
            stream.getTracks().forEach((t) => t.stop());
            G.toast('Voice messages aren’t available on this browser.', 'error');
            return;
        }
        rec.stream = stream;
        rec.chunks = [];
        rec.discard = false;
        rec.mr.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); });
        rec.mr.start(250);
        startTranscript();
        rec.t0 = Date.now();
        $('rec-time').textContent = '0:00';
        clearInterval(rec.timer);
        rec.timer = setInterval(tickRec, 250);
        setRecUi('recording', 'Recording');
        if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* ignore */ } }
    }

    function stopRecorder() {
        stopTranscript();
        return new Promise((resolve) => {
            const mr = rec.mr;
            clearInterval(rec.timer);
            if (!mr || mr.state === 'inactive') { resolve(); return; }
            mr.addEventListener('stop', () => resolve(), { once: true });
            try { mr.stop(); } catch (e) { resolve(); }
        });
    }

    async function cancelRecording() {
        if (rec.state === 'sending') return;
        rec.discard = true;
        await stopRecorder();
        releaseStream();
        rec.chunks = [];
        rec.blob = null;
        setRecUi('idle');
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.onerror = () => reject(new Error('Couldn’t read the recording.'));
            r.readAsDataURL(blob);
        });
    }

    async function finishRecording() {
        if (rec.state !== 'recording') return;
        const seconds = (Date.now() - rec.t0) / 1000;
        setRecUi('sending', 'Sending…');
        await stopRecorder();
        releaseStream();
        if (seconds < MIN_VOICE_SECONDS) {
            G.toast('Hold on a little longer — that one was too short.', 'error');
            rec.chunks = [];
            setRecUi('idle');
            return;
        }
        const type = (rec.mr && rec.mr.mimeType) || rec.mime || 'audio/webm';
        rec.blob = new Blob(rec.chunks, { type });
        rec.duration = seconds;
        await sendRecording();
    }

    // Words are captured by the phone's own speech recognition while recording (when the phone supports it).
    function startTranscript() {
        rec.transcript = '';
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;
        try {
            const r = new SR();
            r.continuous = true; r.interimResults = false; r.lang = navigator.language || 'en-US';
            const done = [];
            r.onresult = (ev) => {
                for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) done.push(ev.results[i][0].transcript.trim());
                rec.transcript = done.join(' ');
            };
            r.onerror = () => {};
            r.onend = () => { if (rec.state === 'recording') { try { r.start(); } catch (e) { /* ignore */ } } };
            r.start();
            rec.sr = r;
        } catch (e) { rec.sr = null; }
    }
    function stopTranscript() { if (rec.sr) { const r = rec.sr; rec.sr = null; r.onend = null; try { r.stop(); } catch (e) { /* ignore */ } } }

    async function sendRecording() {
        setRecUi('sending', 'Sending…');
        try {
            const dataUrl = await blobToDataUrl(rec.blob);
            const body = { action: 'voice', audio: dataUrl, duration: rec.duration };
            if (rec.transcript && rec.transcript.trim()) body.transcript = rec.transcript.trim();
            const reply = G.state.replyTo;
            if (reply) body.replyTo = reply.id;
            const data = await G.api(API, { method: 'POST', body });
            if (data && data.message) { G.state.confirmed.add(data.message.id); G.upsert([data.message]); }
            if (reply) G.setReply(null);
            rec.blob = null;
            rec.chunks = [];
            setRecUi('idle');
            G.render('bottom');
        } catch (e) {
            setRecUi('failed', 'Couldn’t send — tap ➤ to retry');
            if (e.status !== 401) G.toast(e.message || 'Couldn’t send the voice message.', 'error');
        }
    }

    // ---------------------------------------------------------------- scheduled messages

    const sched = { list: [], loaded: false, sheet: null, pressTimer: null, longFired: false };

    function whenLabel(iso) {
        const d = new Date(iso);
        const now = new Date();
        const sameDay = d.toDateString() === now.toDateString();
        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        if (sameDay) return `Today at ${time}`;
        if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow at ${time}`;
        const opts = { weekday: 'short', month: 'short', day: 'numeric' };
        if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
        return `${d.toLocaleDateString([], opts)} at ${time}`;
    }

    function renderSchedChip() {
        const slot = $('sched-chip-slot');
        if (!sched.list.length) { slot.innerHTML = ''; return; }
        const n = sched.list.length;
        slot.innerHTML = `<button type="button" class="sched-chip" data-x="sched-open"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>${n} scheduled</span></button>`;
    }

    async function loadScheduled() {
        try {
            const data = await G.api(`${API}?scheduled=1`);
            sched.list = Array.isArray(data.scheduled) ? data.scheduled : [];
            sched.loaded = true;
            renderSchedChip();
            if (sched.sheet && !sched.sheet.classList.contains('hidden') && sched.mode === 'list') renderSchedList();
        } catch (e) { /* the chip simply stays as it was */ }
    }

    function buildSchedSheet() {
        const el = document.createElement('div');
        el.id = 'sched-modal';
        el.className = 'modal sheet-modal hidden';
        el.style.zIndex = '70';
        el.innerHTML = '<div class="modal-card form-card sheet-card fade-in" role="dialog" aria-modal="true" aria-labelledby="sched-title"><div id="sched-body"></div></div>';
        document.body.appendChild(el);
        el.addEventListener('click', (e) => { if (e.target === el) closeSched(); });
        el.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSched(); });
        return el;
    }

    function closeSched() { if (sched.sheet) G.hide(sched.sheet); }

    function quickTimes() {
        const now = new Date();
        const at = (dayOffset, h, mi) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, h, mi || 0, 0);
        const list = [];
        list.push({ label: 'In 1 hour', when: new Date(now.getTime() + 60 * 60 * 1000) });
        if (now.getHours() < 17) list.push({ label: 'This evening', when: at(0, 18) });
        else if (now.getHours() < 21) list.push({ label: 'Later tonight', when: at(0, 21) });
        list.push({ label: 'Tomorrow morning', when: at(1, 9) });
        list.push({ label: 'Tomorrow evening', when: at(1, 18) });
        return list;
    }

    function toLocalInput(d) {
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function openSchedulePicker() {
        const ta = $('composer-input');
        const text = ta.value.trim();
        if (!text) { G.toast('Write a message first, then hold send to schedule it.'); return; }
        if (G.state.image) { G.toast('Photos can’t be scheduled yet — send the photo now or remove it first.', 'error'); return; }
        if (!sched.sheet) sched.sheet = buildSchedSheet();
        sched.mode = 'pick';
        const quick = quickTimes().map((q, i) => `<button type="button" class="sched-opt" data-x="sched-quick" data-i="${i}"><b>${esc(q.label)}</b><span>${esc(whenLabel(q.when.toISOString()))}</span></button>`).join('');
        const soon = new Date(Date.now() + 5 * 60 * 1000);
        $('sched-body').innerHTML = `<h3 id="sched-title">Send later</h3>` +
            `<div class="sched-preview">${esc(text.length > 140 ? text.slice(0, 140) + '…' : text)}</div>` +
            `<div class="sched-opts">${quick}</div>` +
            `<label class="fld" for="sched-when"><span>Or pick a date and time</span></label>` +
            `<input id="sched-when" class="fld-input" type="datetime-local" min="${esc(toLocalInput(soon))}" value="">` +
            `<div id="sched-error" class="form-error hidden" role="alert"></div>` +
            `<div class="modal-actions"><button type="button" class="btn btn-ghost" data-x="sched-close">Cancel</button><button type="button" class="btn btn-solid" data-x="sched-custom">Schedule</button></div>`;
        sched._quick = quickTimes();
        G.show(sched.sheet);
    }

    async function scheduleAt(date) {
        const text = $('composer-input').value.trim();
        const err = $('sched-error');
        const fail = (t) => { if (err) { err.textContent = t; err.classList.remove('hidden'); } else G.toast(t, 'error'); };
        if (!(date instanceof Date) || isNaN(date)) return fail('Pick a date and time.');
        if (date.getTime() < Date.now() + 60 * 1000) return fail('Pick a time at least a minute from now.');
        const body = { action: 'schedule', text, sendAt: date.toISOString() };
        if (G.state.replyTo) body.replyTo = G.state.replyTo.id;
        try {
            const data = await G.api(API, { method: 'POST', body });
            if (data && data.scheduled) { sched.list.push(data.scheduled); sched.list.sort((a, b) => (a.sendAt < b.sendAt ? -1 : 1)); }
            renderSchedChip();
            closeSched();
            G.clearComposer();
            G.toast(`Scheduled for ${whenLabel(date.toISOString()).toLowerCase()}`);
        } catch (e) {
            if (e.status !== 401) fail(e.message || 'Couldn’t schedule that message.');
        }
    }

    function renderSchedList() {
        sched.mode = 'list';
        const rows = sched.list.map((s) => `<div class="sched-row" data-sid="${esc(s.id)}"><div class="sched-when">${esc(whenLabel(s.sendAt))}</div>` +
            `<div class="sched-text">${esc(s.text.length > 160 ? s.text.slice(0, 160) + '…' : s.text)}</div>` +
            `<div class="sched-acts"><button type="button" class="btn btn-ghost" data-x="sched-edit" data-sid="${esc(s.id)}">Edit</button><button type="button" class="btn btn-ghost danger" data-x="sched-cancel" data-sid="${esc(s.id)}">Cancel send</button></div></div>`).join('');
        $('sched-body').innerHTML = `<h3 id="sched-title">Scheduled messages</h3>` +
            (rows ? `<div class="sched-list">${rows}</div>` : `<p class="sched-empty">Nothing is scheduled.</p>`) +
            `<div class="modal-actions"><button type="button" class="btn btn-solid" data-x="sched-close">Done</button></div>`;
    }

    function openSchedList() {
        if (!sched.sheet) sched.sheet = buildSchedSheet();
        renderSchedList();
        G.show(sched.sheet);
        loadScheduled();
    }

    async function cancelScheduledSend(sid, thenEdit) {
        const item = sched.list.find((s) => s.id === sid);
        try {
            await G.api(API, { method: 'POST', body: { action: 'unschedule', id: sid } });
        } catch (e) {
            if (e.status === 404) { /* already gone */ } else { if (e.status !== 401) G.toast(e.message, 'error'); return; }
        }
        sched.list = sched.list.filter((s) => s.id !== sid);
        renderSchedChip();
        if (thenEdit && item) {
            closeSched();
            const ta = $('composer-input');
            if (ta.value.trim() && !confirmReplaceDraft()) { G.toast('Scheduled message cancelled'); return; }
            ta.value = item.text;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.focus();
            G.toast('Edit it, then hold send to schedule again');
        } else {
            renderSchedList();
            G.toast('Scheduled message cancelled');
        }
    }

    function confirmReplaceDraft() { return window.confirm('Replace what you’re typing with this scheduled message?'); }

    // long-press on the send button
    function bindSendHold() {
        const send = $('btn-send');
        const clear = () => { clearTimeout(sched.pressTimer); sched.pressTimer = null; };
        send.addEventListener('pointerdown', (e) => {
            if (send.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
            sched.longFired = false;
            clear();
            sched.pressTimer = setTimeout(() => {
                sched.pressTimer = null;
                sched.longFired = true;
                if (navigator.vibrate) { try { navigator.vibrate(10); } catch (err) { /* ignore */ } }
                openSchedulePicker();
            }, LONG_PRESS_MS);
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => send.addEventListener(ev, clear));
        send.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (send.disabled) return;
            sched.longFired = true;
            clear();
            openSchedulePicker();
        });
    }

    // ---------------------------------------------------------------- plus menu, clicks, wiring

    function setPlus(open) {
        const pop = $('plus-popup');
        const btn = $('btn-plus');
        if (open) { G.closeEmoji(); G.show(pop, 'block'); } else G.hide(pop, 'block');
        btn.setAttribute('aria-expanded', String(open));
        btn.classList.toggle('on', open);
    }

    function canClosePoll(m) {
        const u = G.state.user;
        return !!m.poll && !m.poll.closed && !!u && (G.isMine(m) || !!u.host);
    }

    // "Smart detect" (plans -> calendar, questions -> polls) can be switched off per device.
    function smartOn() {
        try { return localStorage.getItem('chowaniec_group_smart') !== 'off'; } catch (e) { return true; }
    }
    function showSmart() {
        const on = smartOn();
        const label = $('smart-label');
        if (label) label.textContent = `Smart detect: ${on ? 'on' : 'off'}`;
        const btn = $('btn-smart');
        if (btn) btn.setAttribute('aria-checked', String(on));
    }
    function toggleSmart() {
        try { localStorage.setItem('chowaniec_group_smart', smartOn() ? 'off' : 'on'); } catch (e) { /* ignore */ }
        showSmart();
        G.toast(smartOn() ? 'Smart detect is on: plans go to the calendar and questions become polls.' : 'Smart detect is off.');
    }
    window.addEventListener('chowaniec-group-started', showSmart);

    function handleClick(e) {
        // A click that follows a long-press, swipe or double-tap is swallowed by group.js; skip it here too.
        if (G.clickSuppressed()) return;
        const send = e.target.closest && e.target.closest('#btn-send');
        if (send && sched.longFired) { sched.longFired = false; e.preventDefault(); e.stopPropagation(); return; }
        const plus = e.target.closest && e.target.closest('#btn-plus');
        if (plus) { e.preventDefault(); setPlus($('plus-popup').classList.contains('hidden')); return; }
        const inPlusMenu = e.target.closest && e.target.closest('#plus-popup');
        if (inPlusMenu) {
            const pollBtn = e.target.closest('#btn-poll');
            const stickerBtn = e.target.closest('#btn-sticker');
            const sheetBtn = e.target.closest('#btn-sheet');
            if (e.target.closest('#btn-smart')) { toggleSmart(); return; }
            setPlus(false);
            if (pollBtn) openPollModal();
            if (stickerBtn) openStickers();
            if (sheetBtn) openSheetForm();
            return;
        }
        if (!$('plus-popup').classList.contains('hidden')) setPlus(false);

        const t = e.target.closest && e.target.closest('[data-x]');
        if (!t) return;
        const x = t.dataset.x;
        switch (x) {
            case 'vote': castVote(t.dataset.mid, t.dataset.opt); break;
            case 'close-poll': G.closeActions(); closePoll(t.dataset.id); break;
            case 'voice-play': playVoice(t.dataset.mid); break;
            case 'voice-speed': cycleSpeed(); break;
            case 'voice-seek': {
                const r = t.getBoundingClientRect();
                const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
                playVoice(t.dataset.mid, frac);
                break;
            }
            case 'slot-claim': slotAction('claim', t.dataset.sid, t.dataset.slot); break;
            case 'slot-release': slotAction('release', t.dataset.sid, t.dataset.slot); break;
            case 'sheet-close': closeSheetForm(); break;
            case 'sheet-create': createSheet(); break;
            case 'thread-open': G.closeActions(); openThread(t.dataset.id); break;
            case 'thread-close': closeThread(); break;
            case 'thread-send': sendThreadReply(); break;
            case 'sticker-send': sendSticker(t.dataset.id); break;
            case 'sticker-close': closeStickers(); break;
            case 'catchup-run': runCatchUp(); break;
            case 'catchup-close': closeCatchUp(); break;
            case 'voice-text': { const el = document.querySelector(`.v-text[data-mid="${CSS.escape(t.dataset.mid)}"]`); if (el) el.classList.toggle('hidden'); break; }
            case 'sched-open': openSchedList(); break;
            case 'sched-close': closeSched(); break;
            case 'sched-quick': { const q = sched._quick && sched._quick[Number(t.dataset.i)]; if (q) scheduleAt(q.when); break; }
            case 'sched-custom': { const v = $('sched-when').value; scheduleAt(v ? new Date(v) : null); break; }
            case 'sched-cancel': cancelScheduledSend(t.dataset.sid, false); break;
            case 'sched-edit': cancelScheduledSend(t.dataset.sid, true); break;
            default: break;
        }
    }
    // Registered now (before group.js binds its own click handler) so we can still see its "swallow" flag.
    document.addEventListener('click', handleClick, true);

    function bindOnceStarted() {
        if (bindOnceStarted.done) return;
        bindOnceStarted.done = true;
        $('btn-mic').addEventListener('click', startRecording);
        $('rec-cancel').addEventListener('click', cancelRecording);
        $('rec-send').addEventListener('click', () => {
            if (rec.state === 'recording') finishRecording();
            else if (rec.state === 'failed') sendRecording();
        });
        bindSendHold();
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !$('plus-popup').classList.contains('hidden')) setPlus(false);
        });
        // Opening the emoji picker closes the plus menu.
        $('btn-emoji').addEventListener('click', () => { if (!$('plus-popup').classList.contains('hidden')) setPlus(false); });
        loadScheduled();
        setInterval(() => { if (document.visibilityState === 'visible') loadScheduled(); }, 60000);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadScheduled(); });
        showTipOnce();
    }

    function showTipOnce() {
        try {
            if (localStorage.getItem(TIPS_KEY)) return;
            localStorage.setItem(TIPS_KEY, '1');
        } catch (e) { return; }
        setTimeout(() => G.toast('New: tap + for polls, the mic for voice messages, and hold send to schedule.'), 2500);
    }

    window.addEventListener('chowaniec-group-started', bindOnceStarted);
    if (G.state && G.state.started) bindOnceStarted();

    // ---------------------------------------------------------------- stickers

    let stickerList = null;
    const stickerOf = (id) => (stickerList || FALLBACK_STICKERS).find((x) => x.id === id);
    const FALLBACK_STICKERS = [
      { id: 'bravo', emoji: '👏', label: 'Bravo!' }, { id: 'break-a-leg', emoji: '🎭', label: 'Break a leg!' }, { id: 'curtain-up', emoji: '🎬', label: 'Curtain up!' },
      { id: 'standing-o', emoji: '🙌', label: 'Standing ovation' }, { id: 'on-my-way', emoji: '🚗', label: 'On my way' }, { id: 'running-late', emoji: '⏰', label: 'Running late' },
      { id: 'dinner', emoji: '🍝', label: 'Dinner time' }, { id: 'love-you', emoji: '❤️', label: 'Love you' }, { id: 'thank-you', emoji: '🙏', label: 'Thank you' },
      { id: 'congrats', emoji: '🎉', label: 'Congrats!' }, { id: 'need-help', emoji: '🆘', label: 'Need a hand' }, { id: 'good-night', emoji: '🌙', label: 'Good night' },
      { id: 'good-morning', emoji: '☀️', label: 'Good morning' }, { id: 'rehearsal', emoji: '🎤', label: 'Rehearsal time' }, { id: 'hug', emoji: '🤗', label: 'Big hug' }, { id: 'cheers', emoji: '🥂', label: 'Cheers!' }
    ];
    function stickerHtml(m) {
        const st = stickerOf(m.sticker);
        return `<div class="sticker"><span class="st-emoji">${esc(st.emoji)}</span><span class="st-label">${esc(st.label)}</span></div>`;
    }
    function openStickers() {
        closeStickers();
        const el = document.createElement('div');
        el.id = 'sticker-sheet';
        el.className = 'x-sheet';
        el.innerHTML = `<div class="x-sheet-head"><b>Stickers</b><button type="button" data-x="sticker-close" aria-label="Close">✕</button></div><div class="sticker-grid">` +
            FALLBACK_STICKERS.map((st) => `<button type="button" class="sticker-pick" data-x="sticker-send" data-id="${esc(st.id)}"><span class="st-emoji">${esc(st.emoji)}</span><span class="st-label">${esc(st.label)}</span></button>`).join('') + `</div>`;
        document.body.appendChild(el);
    }
    function closeStickers() { const el = $('sticker-sheet'); if (el) el.remove(); }
    async function sendSticker(id) {
        closeStickers();
        try {
            const body = { action: 'sticker', id };
            const reply = G.state.replyTo;
            if (reply) body.replyTo = reply.id;
            const data = await G.api(API, { method: 'POST', body });
            if (data && data.message) { G.state.confirmed.add(data.message.id); G.upsert([data.message]); }
            if (reply) G.setReply(null);
            G.render('bottom');
        } catch (e) { if (e.status !== 401) G.toast(e.message || 'Couldn’t send the sticker.', 'error'); }
    }

    // ---------------------------------------------------------------- sign-up sheets

    const SIGNUP = '/.netlify/functions/signup';
    const sheets = {};
    let sheetTimer = null;
    async function loadSheets() {
        try {
            const data = await G.api(`${SIGNUP}?room=${encodeURIComponent(G.room())}`);
            let changed = false;
            (data.sheets || []).forEach((sh) => { if (JSON.stringify(sheets[sh.id]) !== JSON.stringify(sh)) { sheets[sh.id] = sh; changed = true; } });
            if (changed) G.render('auto');
        } catch (e) { /* ignore */ }
    }
    function sheetSig(m) { const sh = m.sheet && sheets[m.sheet]; return sh ? sh.slots.map((x) => x.claimedBy || '').join('|') + sh.title : ''; }
    function sheetHtml(m) {
        const sh = sheets[m.sheet];
        if (!sh) return `<div class="sheet"><b>${esc(m.text)}</b><span class="sheet-note">Loading…</span></div>`;
        const me = G.myName();
        const open = sh.slots.filter((x) => !x.claimedBy).length;
        return `<div class="sheet"><b>📝 ${esc(sh.title)}</b><span class="sheet-note">${open ? `${open} of ${sh.slots.length} still open` : 'All spots taken'}</span>` +
            sh.slots.map((x) => {
                const mine = x.claimedBy && G.sameName(x.claimedBy, me);
                return `<div class="slot ${x.claimedBy ? 'taken' : ''}"><span class="slot-label">${esc(x.label)}</span>` +
                    (x.claimedBy ? `<span class="slot-who">${mine ? 'You' : esc(x.claimedBy)}</span>${mine ? `<button type="button" class="slot-btn" data-x="slot-release" data-sid="${esc(sh.id)}" data-slot="${esc(x.id)}">Give back</button>` : ''}`
                        : `<button type="button" class="slot-btn go" data-x="slot-claim" data-sid="${esc(sh.id)}" data-slot="${esc(x.id)}">I’ll do it</button>`) + `</div>`;
            }).join('') + `</div>`;
    }
    async function slotAction(kind, sid, slot) {
        try {
            const data = await G.api(SIGNUP, { method: 'POST', body: { action: kind, id: sid, slot } });
            sheets[data.sheet.id] = data.sheet;
            G.render('auto');
        } catch (e) { G.toast(e.message || 'Couldn’t update.', 'error'); loadSheets(); }
    }
    function openSheetForm() {
        closeSheetForm();
        const el = document.createElement('div');
        el.id = 'signup-form';
        el.className = 'x-sheet';
        el.innerHTML = `<div class="x-sheet-head"><b>New sign-up sheet</b><button type="button" data-x="sheet-close" aria-label="Close">✕</button></div>` +
            `<form id="signup-new" class="sheet-new" autocomplete="off"><label>What is it for?<input id="signup-title" type="text" maxlength="100"></label>` +
            `<label>Slots, one per line<textarea id="signup-slots" rows="5"></textarea></label><button type="button" class="thread-send" data-x="sheet-create">Post sheet</button></form>`;
        document.body.appendChild(el);
        $('signup-new').addEventListener('submit', (e) => e.preventDefault());
    }
    function closeSheetForm() { const el = $('signup-form'); if (el) el.remove(); }
    async function createSheet() {
        const title = $('signup-title').value.trim();
        const slots = $('signup-slots').value.split('\n').map((x) => x.trim()).filter(Boolean);
        if (!title || !slots.length) { G.toast('Add a name and at least one slot.', 'error'); return; }
        try {
            const data = await G.api(SIGNUP, { method: 'POST', body: { action: 'create', title, slots } });
            sheets[data.sheet.id] = data.sheet;
            closeSheetForm();
            G.state.confirmed.add(data.message.id); G.upsert([data.message]); G.render('bottom');
        } catch (e) { G.toast(e.message || 'Couldn’t create the sheet.', 'error'); }
    }
    window.addEventListener('chowaniec-group-started', () => {
        loadSheets();
        clearInterval(sheetTimer);
        sheetTimer = setInterval(() => { if (document.visibilityState === 'visible') loadSheets(); }, 8000);
    });

    // ---------------------------------------------------------------- threads

    const thread = { id: null, timer: null, seen: new Set() };
    function threadMsgHtml(m) {
        const mine = G.isMine(m);
        const body = m.sticker && stickerOf(m.sticker) ? `${esc(stickerOf(m.sticker).emoji)} ${esc(stickerOf(m.sticker).label)}` : esc(m.text || '');
        return `<div class="t-msg ${mine ? 'mine' : ''}"><b>${esc(m.kind === 'ai' ? m.user : m.user)}${m.onBehalfOf ? ` <i>for ${esc(m.onBehalfOf)}</i>` : ''}</b><span>${body}</span></div>`;
    }
    async function loadThread() {
        if (!thread.id) return;
        try {
            const data = await G.api(`${API}?thread=${encodeURIComponent(thread.id)}`);
            const box = $('thread-body');
            if (!box || !thread.id) return;
            const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
            box.innerHTML = [data.root].concat(data.replies || []).map(threadMsgHtml).join('');
            if (stick || !thread.seen.size) box.scrollTop = box.scrollHeight;
            thread.seen = new Set((data.replies || []).map((r) => r.id));
            if (!thread.seen.size) thread.seen.add('root');
        } catch (e) { if (e.status === 404) { closeThread(); G.toast('That message is gone.'); } }
    }
    function openThread(id) {
        closeThread();
        thread.id = id;
        thread.seen = new Set();
        const el = document.createElement('div');
        el.id = 'thread-sheet';
        el.className = 'x-sheet thread-sheet';
        el.innerHTML = `<div class="x-sheet-head"><b>Thread</b><button type="button" data-x="thread-close" aria-label="Close thread">✕</button></div><div id="thread-body" class="thread-body"></div>` +
            `<form id="thread-form" class="thread-form" autocomplete="off"><input id="thread-input" type="text" maxlength="2000" aria-label="Reply in this thread"><button type="button" data-x="thread-send" class="thread-send" aria-label="Send reply">Send</button></form>`;
        document.body.appendChild(el);
        $('thread-form').addEventListener('submit', (e) => { e.preventDefault(); sendThreadReply(); });
        loadThread();
        thread.timer = setInterval(() => { if (document.visibilityState === 'visible') loadThread(); }, 4000);
    }
    function closeThread() {
        clearInterval(thread.timer); thread.timer = null; thread.id = null;
        const el = $('thread-sheet'); if (el) el.remove();
    }
    async function sendThreadReply() {
        const input = $('thread-input');
        const text = input && input.value.trim();
        if (!text || !thread.id) return;
        input.value = '';
        try {
            const data = await G.api(API, { method: 'POST', body: { text, thread: thread.id } });
            if (data && data.message) { G.state.confirmed.add(data.message.id); G.upsert([data.message]); G.render('auto'); }
            loadThread();
        } catch (e) { input.value = text; if (e.status !== 401) G.toast(e.message || 'Couldn’t send.', 'error'); }
    }

    // ---------------------------------------------------------------- catch-up ("what you missed")

    window.addEventListener('chowaniec-group-opened', () => setTimeout(showCatchUp, 500));
    function showCatchUp() {
        const slot = $('catchup-slot');
        const last = G.state.openRead && G.state.openRead.id;
        if (!slot || !last) return;
        const unseen = G.state.messages.filter((m) => m.id > last && m.kind !== 'system' && !m.thread && !G.isMine(m)).length;
        if (unseen < 8) return;
        slot.innerHTML = `<div class="catchup"><div class="catchup-row"><span>${unseen}${G.state.hasMore ? '+' : ''} new messages since you last looked.</span><button type="button" class="btn" data-x="catchup-run">What did I miss?</button><button type="button" data-x="catchup-close" aria-label="Dismiss">✕</button></div><div id="catchup-text" class="catchup-text hidden"></div></div>`;
    }
    function closeCatchUp() { const slot = $('catchup-slot'); if (slot) slot.innerHTML = ''; }
    async function runCatchUp() {
        const box = $('catchup-text');
        if (!box) return;
        box.classList.remove('hidden');
        box.textContent = 'Reading the chat…';
        try {
            const data = await G.api(API, { method: 'POST', body: { action: 'catchup', since: G.state.openRead && G.state.openRead.id } });
            box.innerHTML = '';
            const lines = String(data.summary || '').split('\n').map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
            if (!lines.length) { box.textContent = 'Nothing new to catch up on.'; return; }
            const ul = document.createElement('ul');
            lines.forEach((l) => { const li = document.createElement('li'); li.textContent = l; ul.appendChild(li); });
            box.appendChild(ul);
        } catch (e) { box.textContent = e.message || 'Couldn’t summarise right now.'; }
    }

    // ---------------------------------------------------------------- hooks used by group.js

    window.GroupExtras = {
        richHtml(m) {
            if (m && m.poll && Array.isArray(m.poll.options)) return pollHtml(m);
            if (m && m.sheet) return sheetHtml(m);
            if (m && m.sticker && stickerOf(m.sticker)) return stickerHtml(m);
            if (m && m.voice && m.voice.id) return voiceHtml(m);
            return '';
        },
        richClass(m) { return m.poll ? 'rich-poll' : m.sheet ? 'rich-poll' : m.sticker ? 'rich-sticker' : 'rich-voice'; },
        sig: sheetSig,
        menuItems(m) {
            let out = '';
            if (canClosePoll(m)) out += `<button type="button" role="menuitem" data-x="close-poll" data-id="${esc(m.id)}" class="mi"><i data-lucide="lock"></i>Close poll</button>`;
            if (!m.thread && m.kind !== 'system' && !m._pending) out += `<button type="button" role="menuitem" data-x="thread-open" data-id="${esc(m.id)}" class="mi"><i data-lucide="messages-square"></i>Reply in thread</button>`;
            return out;
        },
        afterRender() { if (player.id) paintVoice(player.id); }
    };
})();
