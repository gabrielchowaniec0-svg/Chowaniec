// Chowaniec Group media: video messages and GIFs (window.GroupMedia).
// Videos: pick one (up to 2 minutes; 10 for Gabriel, Victoria and Nicole), add a caption, and it uploads in
// 3 MB parts with a progress card. Videos too large to upload are re-recorded smaller on the phone first.
// GIFs: search GIPHY (G-rated only) and tap one to send it. Loaded after group.js and extras.js.
(function () {
    'use strict';

    const G = window.ChowaniecGroup;
    if (!G) return;
    const $ = (id) => document.getElementById(id);
    const esc = G.escapeHtml;
    const API = G.API;
    const PARALLEL_PARTS = 3;

    const fmtDur = (sec) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    const fmtLimit = (s) => (s % 60 ? fmtDur(s) : `${s / 60} minute${s === 60 ? '' : 's'}`);
    const key = () => { const u = window.getChowaniecUser ? window.getChowaniecUser() : null; return (u && u.key) || ''; };

    // ---------------------------------------------------------------- drawing messages

    function caption(m) {
        const t = String(m.text || '').trim();
        return t ? `<span class="msg-text media-cap">${esc(t)}</span>` : '';
    }

    function richHtml(m) {
        if (m.video && m.video.id) {
            const v = m.video;
            const ratio = v.width && v.height ? `${v.width} / ${v.height}` : '16 / 9';
            const src = `${API}?video=${encodeURIComponent(v.id)}&room=${encodeURIComponent(G.room())}`;
            const poster = v.poster ? G.mediaUrl(v.poster) : '';
            return `<div class="vid-wrap" style="aspect-ratio:${ratio}"><video class="vid" src="${esc(src)}"${poster ? ` poster="${esc(poster)}" preload="none"` : ' preload="metadata"'} controls playsinline></video><span class="vid-badge" aria-hidden="true">▶ ${fmtDur(v.duration)}</span></div>${caption(m)}`;
        }
        if (m.gif && m.gif.mp4) {
            const g = m.gif;
            return `<div class="gif-wrap" style="aspect-ratio:${g.width} / ${g.height}"><video class="gif" src="${esc(g.mp4)}" autoplay loop muted playsinline disablepictureinpicture aria-label="${esc(g.title || 'GIF')}"></video><span class="gif-badge" aria-hidden="true">GIF</span></div>${caption(m)}`;
        }
        return '';
    }

    // Hide the duration badge once a video starts playing.
    document.addEventListener('play', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('vid')) e.target.parentElement.classList.add('played');
    }, true);

    // ---------------------------------------------------------------- videos

    let limits = null;
    async function getLimits() {
        if (limits) return limits;
        try { limits = await G.api(`${API}?videolimits=1`); } catch (e) { limits = { seconds: 120, bytes: 300 * 1024 * 1024 }; }
        return limits;
    }

    function readVideo(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const v = document.createElement('video');
            v.preload = 'auto';
            v.muted = true;
            v.playsInline = true;
            v.setAttribute('playsinline', '');
            const done = () => resolve({ video: v, url, duration: v.duration, width: v.videoWidth, height: v.videoHeight });
            v.onloadedmetadata = () => {
                if (Number.isFinite(v.duration) && v.duration > 0) done();
                else {
                    // Some WebM files only know their length after seeking to the end.
                    v.currentTime = 1e7;
                    v.ontimeupdate = () => { v.ontimeupdate = null; v.currentTime = 0; done(); };
                }
            };
            v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That video couldn’t be opened. Try a different one.')); };
            v.src = url;
        });
    }

    // A still from the start of the video, shown before it plays (best effort).
    function makePoster(info) {
        return new Promise((resolve) => {
            const v = info.video;
            const finish = () => {
                try {
                    const w0 = v.videoWidth;
                    const h0 = v.videoHeight;
                    if (!w0 || !h0) return resolve(null);
                    const scale = Math.min(1, 640 / Math.max(w0, h0));
                    const c = document.createElement('canvas');
                    c.width = Math.round(w0 * scale);
                    c.height = Math.round(h0 * scale);
                    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
                    resolve(c.toDataURL('image/jpeg', 0.72));
                } catch (e) { resolve(null); }
            };
            const timer = setTimeout(() => resolve(null), 4000);
            v.onseeked = () => { clearTimeout(timer); finish(); };
            try { v.currentTime = Math.min(0.5, (info.duration || 1) / 3); } catch (e) { clearTimeout(timer); resolve(null); }
        });
    }

    // Re-records a video smaller in the browser (it plays through once, so it takes as long as the video).
    function canShrink() {
        return typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
    }
    function shrinkVideo(file, info, maxBytes, onProgress) {
        return new Promise((resolve, reject) => {
            const v = document.createElement('video');
            v.src = info.url;
            v.playsInline = true;
            v.setAttribute('playsinline', '');
            const scale = Math.min(1, 1280 / Math.max(info.width || 1280, info.height || 720));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round((info.width || 1280) * scale / 2) * 2;
            canvas.height = Math.round((info.height || 720) * scale / 2) * 2;
            const ctx = canvas.getContext('2d');
            const stream = canvas.captureStream(30);
            let audioCtx = null;
            try {
                const C = window.AudioContext || window.webkitAudioContext;
                audioCtx = new C();
                const src = audioCtx.createMediaElementSource(v);
                const dest = audioCtx.createMediaStreamDestination();
                src.connect(dest);
                dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
            } catch (e) { /* no sound track; still send the picture */ }
            const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
            const mimeType = types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
            const bits = Math.max(600000, Math.min(2500000, Math.floor((maxBytes * 8 * 0.85) / Math.max(1, info.duration))));
            let rec;
            try { rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bits, audioBitsPerSecond: 96000 }); } catch (e) { reject(new Error('This browser can’t shrink videos. Try a shorter clip.')); return; }
            const chunks = [];
            rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
            rec.onstop = () => {
                if (audioCtx) audioCtx.close().catch(() => {});
                const type = (rec.mimeType || mimeType || 'video/webm').split(';')[0];
                resolve(new File(chunks, `video.${type === 'video/mp4' ? 'mp4' : 'webm'}`, { type }));
            };
            let raf = 0;
            const draw = () => {
                ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                onProgress(Math.min(1, v.currentTime / info.duration));
                if (!v.ended && !v.paused) raf = requestAnimationFrame(draw);
            };
            v.onplay = () => { raf = requestAnimationFrame(draw); };
            v.onended = () => { cancelAnimationFrame(raf); if (rec.state !== 'inactive') rec.stop(); };
            v.onerror = () => reject(new Error('That video couldn’t be read.'));
            rec.start(1000);
            v.play().catch(() => reject(new Error('That video couldn’t be played to shrink it.')));
        });
    }

    // ----- the "send video" sheet -----
    let picked = null;
    function closeVideoSheet() {
        const el = $('video-sheet');
        if (el) el.remove();
        if (picked && !picked.sending) URL.revokeObjectURL(picked.info.url);
        picked = null;
    }

    async function onVideoChosen(file) {
        if (!file) return;
        if (!/^video\//.test(file.type || '') && !/\.(mp4|mov|m4v|webm)$/i.test(file.name || '')) { G.toast('Please choose a video.', 'error'); return; }
        const lim = await getLimits();
        let info;
        try { info = await readVideo(file); } catch (e) { G.toast(e.message, 'error'); return; }
        if (info.duration > lim.seconds + 0.5) {
            URL.revokeObjectURL(info.url);
            G.toast(`Videos can be up to ${fmtLimit(lim.seconds)} long (this one is ${fmtDur(info.duration)}). Trim it in your Photos app first.`, 'error');
            return;
        }
        const tooBig = file.size > lim.bytes;
        if (tooBig && !canShrink()) {
            URL.revokeObjectURL(info.url);
            G.toast(`That video is too large (max ${Math.round(lim.bytes / 1048576)} MB). Try a shorter clip.`, 'error');
            return;
        }
        closeVideoSheet();
        picked = { file, info, tooBig, limits: lim };
        const el = document.createElement('div');
        el.id = 'video-sheet';
        el.className = 'x-sheet media-sheet';
        el.innerHTML = '<div class="x-sheet-head"><b>Send a video</b><button type="button" data-m="close" aria-label="Close">✕</button></div>' +
            `<div class="media-body"><div class="vs-preview"><video src="${esc(info.url)}" controls playsinline muted></video></div>` +
            `<p class="vs-meta">${fmtDur(info.duration)} · ${(file.size / 1048576).toFixed(1)} MB${tooBig ? ' · it will be made smaller before sending' : ''}</p>` +
            '<label class="vs-label" for="vs-caption">Caption (optional)</label><textarea id="vs-caption" rows="2" maxlength="1000"></textarea>' +
            '<button type="button" class="vs-send" data-m="send">Send video</button></div>';
        document.body.appendChild(el);
    }

    // ----- uploading -----
    const uploads = new Map();   // local id -> { name, progress, status, cancel }
    function renderUploads() {
        let tray = $('media-uploads');
        if (!tray) {
            tray = document.createElement('div');
            tray.id = 'media-uploads';
            const row = $('attach-row');
            row.parentNode.insertBefore(tray, row);
        }
        tray.innerHTML = Array.from(uploads.entries()).map(([id, u]) =>
            `<div class="chip-card up-card${u.failed ? ' failed' : ''}"><span class="up-ic" aria-hidden="true">🎬</span><div class="min-w-0 flex-1"><div class="chip-k">${esc(u.label)}</div>` +
            `<div class="up-bar"><i style="width:${Math.round(u.progress * 100)}%"></i></div></div>` +
            (u.failed ? `<button type="button" class="up-btn" data-m="retry" data-up="${id}">Retry</button>` : '') +
            `<button type="button" class="x" data-m="cancel" data-up="${id}" aria-label="Cancel">✕</button></div>`).join('');
        tray.classList.toggle('hidden', !uploads.size);
    }

    async function putPart(uploadId, n, blob) {
        for (let attempt = 0; ; attempt++) {
            try {
                const res = await fetch(`${API}?upload=${uploadId}&part=${n}&room=${encodeURIComponent(G.room())}`, {
                    method: 'PUT', headers: { 'X-Chowaniec-Key': key(), 'Content-Type': 'application/octet-stream' }, body: blob
                });
                if (res.ok) return;
                const data = await res.json().catch(() => ({}));
                if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(data.error || 'Upload failed.'), { fatal: true });
            } catch (e) {
                if (e.fatal || attempt >= 3) throw e;
            }
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1) * (attempt + 1)));
        }
    }

    async function sendVideo(job) {
        const localId = job.localId;
        const u = uploads.get(localId);
        u.failed = false;
        try {
            let file = job.file;
            if (job.tooBig && !job.shrunk) {
                u.label = 'Making the video smaller…';
                renderUploads();
                file = await shrinkVideo(job.file, job.info, job.limits.bytes, (p) => { u.progress = p * 0.5; renderUploads(); });
                if (file.size > job.limits.bytes) throw new Error('Even made smaller, that video is too large. Try a shorter clip.');
                job.file = file;
                job.shrunk = true;
            }
            if (!job.poster) job.poster = await makePoster(job.info);
            u.label = 'Sending video…';
            const base = job.shrunk ? 0.5 : 0;
            const start = await G.api(API, { method: 'POST', body: { action: 'video-start', size: file.size, type: file.type || 'video/mp4', duration: job.info.duration, width: job.info.width, height: job.info.height } });
            let sent = 0;
            let next = 0;
            const worker = async () => {
                while (next < start.parts && !u.cancelled) {
                    const n = next++;
                    const blob = file.slice(n * start.partBytes, Math.min(file.size, (n + 1) * start.partBytes));
                    await putPart(start.id, n, blob);
                    sent += blob.size;
                    u.progress = base + (1 - base) * 0.97 * (sent / file.size);
                    renderUploads();
                }
            };
            await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, start.parts) }, worker));
            if (u.cancelled) return;
            const body = { action: 'video-finish', upload: start.id, text: job.text };
            if (job.poster) body.poster = job.poster;
            if (job.replyTo) body.replyTo = job.replyTo;
            const data = await G.api(API, { method: 'POST', body });
            uploads.delete(localId);
            renderUploads();
            URL.revokeObjectURL(job.info.url);
            if (data && data.message) { G.state.confirmed.add(data.message.id); G.upsert([data.message]); G.render('bottom'); }
        } catch (e) {
            if (u.cancelled) return;
            u.failed = true;
            u.label = e.message && e.message.length < 90 ? e.message : 'The video didn’t send.';
            renderUploads();
        }
    }

    let jobSeq = 0;
    const jobs = new Map();
    function startSend() {
        if (!picked) return;
        const reply = G.state.replyTo;
        const job = { localId: `u${++jobSeq}`, file: picked.file, info: picked.info, tooBig: picked.tooBig, limits: picked.limits, text: ($('vs-caption').value || '').trim(), replyTo: reply ? reply.id : null };
        picked.sending = true;
        closeVideoSheet();
        if (reply) G.setReply(null);
        jobs.set(job.localId, job);
        uploads.set(job.localId, { label: 'Getting the video ready…', progress: 0 });
        renderUploads();
        sendVideo(job);
    }

    // ---------------------------------------------------------------- GIFs

    const gifState = { q: '', offset: 0, loading: false, seq: 0, enabled: true, list: [] };

    function openGifs() {
        closeGifs();
        const el = document.createElement('div');
        el.id = 'gif-sheet';
        el.className = 'x-sheet media-sheet';
        el.innerHTML = '<div class="x-sheet-head"><b>GIFs</b><button type="button" data-m="gif-close" aria-label="Close">✕</button></div>' +
            '<div class="gif-search"><label class="sr-only" for="gif-q">Search GIFs</label><span class="gif-search-ic" aria-hidden="true">🔍</span><input id="gif-q" type="search" enterkeyhint="search" autocomplete="off" aria-label="Search GIFs"><span class="gif-search-hint" aria-hidden="true">Search GIFs</span></div>' +
            '<div class="gif-scroll"><div class="gif-grid" id="gif-grid"></div><div class="gif-more" id="gif-more"></div><p class="gif-credit">Powered by GIPHY</p></div>';
        document.body.appendChild(el);
        const input = $('gif-q');
        let timer = null;
        input.addEventListener('input', () => {
            el.classList.toggle('typed', !!input.value);
            clearTimeout(timer);
            timer = setTimeout(() => loadGifs(input.value, true), 350);
        });
        el.querySelector('.gif-scroll').addEventListener('scroll', (e) => {
            const s = e.target;
            if (s.scrollTop + s.clientHeight > s.scrollHeight - 300) loadGifs(gifState.q, false);
        });
        loadGifs('', true);
        if (window.matchMedia('(pointer: fine)').matches) input.focus();
    }
    function closeGifs() { const el = $('gif-sheet'); if (el) el.remove(); }

    async function loadGifs(q, fresh) {
        if (!fresh && (gifState.loading || gifState.done)) return;
        const seq = ++gifState.seq;
        if (fresh) { gifState.q = q; gifState.offset = 0; gifState.list = []; gifState.done = false; }
        gifState.loading = true;
        const more = $('gif-more');
        if (more) more.textContent = 'Loading…';
        try {
            const data = await G.api(`${API}?gifs=1&q=${encodeURIComponent(gifState.q)}&offset=${gifState.offset}`);
            if (seq !== gifState.seq) return;
            const grid = $('gif-grid');
            if (!grid) return;
            if (!data.enabled) {
                grid.innerHTML = '<div class="gif-off"><b>GIFs aren’t switched on yet.</b><br>Gabriel, Victoria or Nicole can turn them on by adding a free GIPHY key (GIPHY_API_KEY) in Netlify.</div>';
                $('gif-more').textContent = '';
                return;
            }
            gifState.offset += data.gifs.length;
            gifState.done = data.gifs.length < 24;
            gifState.list = gifState.list.concat(data.gifs);
            const html = data.gifs.map((g) => `<button type="button" class="gif-pick" data-m="gif-send" data-id="${esc(g.id)}" style="aspect-ratio:${g.width} / ${g.height}" aria-label="Send GIF: ${esc(g.title)}"><video src="${esc(g.preview)}" autoplay loop muted playsinline${g.still ? ` poster="${esc(g.still)}"` : ''}></video></button>`).join('');
            if (fresh) grid.innerHTML = html || `<div class="gif-off">No GIFs found for “${esc(gifState.q)}”.</div>`;
            else grid.insertAdjacentHTML('beforeend', html);
            $('gif-more').textContent = '';
        } catch (e) {
            const more2 = $('gif-more');
            if (more2) more2.textContent = e.message || 'Couldn’t load GIFs.';
        } finally {
            if (seq === gifState.seq) gifState.loading = false;
        }
    }

    async function sendGif(id) {
        closeGifs();
        try {
            const body = { action: 'gif', id };
            const reply = G.state.replyTo;
            if (reply) body.replyTo = reply.id;
            const data = await G.api(API, { method: 'POST', body });
            if (data && data.message) { G.state.confirmed.add(data.message.id); G.upsert([data.message]); }
            if (reply) G.setReply(null);
            G.render('bottom');
        } catch (e) { if (e.status !== 401) G.toast(e.message || 'Couldn’t send the GIF.', 'error'); }
    }

    // ---------------------------------------------------------------- wiring

    document.addEventListener('click', (e) => {
        const t = e.target.closest && e.target.closest('#btn-video, #btn-gif, [data-m]');
        if (!t) return;
        if (t.id === 'btn-video') { $('video-input').click(); return; }
        if (t.id === 'btn-gif') { openGifs(); return; }
        const m = t.dataset.m;
        if (m === 'close') closeVideoSheet();
        else if (m === 'send') startSend();
        else if (m === 'gif-close') closeGifs();
        else if (m === 'gif-send') sendGif(t.dataset.id);
        else if (m === 'cancel') {
            const u = uploads.get(t.dataset.up);
            if (u) u.cancelled = true;
            uploads.delete(t.dataset.up);
            jobs.delete(t.dataset.up);
            renderUploads();
        } else if (m === 'retry') {
            const job = jobs.get(t.dataset.up);
            if (job) sendVideo(job);
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeGifs(); closeVideoSheet(); }
    });
    const input = $('video-input');
    if (input) input.addEventListener('change', () => { const f = input.files && input.files[0]; input.value = ''; onVideoChosen(f); });
    window.addEventListener('beforeunload', (e) => {
        if (Array.from(uploads.values()).some((u) => !u.failed)) { e.preventDefault(); e.returnValue = ''; }
    });

    window.GroupMedia = { richHtml, openGifs };
})();
