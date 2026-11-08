/*
 * Chowaniec Studio - hand gesture control (self-contained, no build step).
 *
 * window.StudioGestures = {
 *   supported(): Promise<boolean>
 *   start(videoEl, { onGesture(name, confidence), fps = 12, minHoldMs = 600 }): Promise<void>
 *   stop()
 *   setPaused(bool)
 *   isRunning(): boolean
 *   onStatus?: (status) => void   // 'loading' | 'ready' | 'error' (assigned by the app)
 * }
 *
 * Emitted names: open_palm, closed_fist, thumbs_up, thumbs_down, victory, pointing_up.
 * Uses MediaPipe Tasks Vision GestureRecognizer, loaded lazily on the first start().
 *
 * Test hook: if window.__studioGestureRecognizerFactory is a function, it is called
 * (instead of loading MediaPipe) and must resolve to an object with
 * recognizeForVideo(image, timestampMs) -> { gestures: [[{categoryName, score}]] }
 * (sync or Promise). Only used when present.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.StudioGestures && window.StudioGestures.__version) return; // loaded twice

  var MP_VERSION = '0.10.14';
  var MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VERSION;
  var MP_BUNDLE = MP_BASE + '/vision_bundle.mjs';
  var MP_WASM = MP_BASE + '/wasm';
  var MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

  var TARGET_WIDTH = 320;       // inference frame width (px)
  var MIN_CONFIDENCE = 0.6;     // per-frame score threshold
  var RELEASE_MS = 400;         // hand gone this long -> gesture can fire again
  var COOLDOWN_MS = 1200;       // between any two emitted gestures
  var WATCHDOG_MS = 1000;       // rVFC silent this long -> tick from a timer anyway
  var MAX_DUTY = 0.5;           // inference may use at most ~50% of main-thread time
  var SLOW_GPU_MS = 100;        // GPU slower than this (e.g. software GL) -> try CPU

  var CATEGORY_MAP = {
    Open_Palm: 'open_palm',
    Closed_Fist: 'closed_fist',
    Thumb_Up: 'thumbs_up',
    Thumb_Down: 'thumbs_down',
    Victory: 'victory',
    Pointing_Up: 'pointing_up'
    // ILoveYou, None -> hand present, no command ('other')
  };

  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  function setStatus(s) {
    var cb = api.onStatus;
    if (typeof cb === 'function') { try { cb(s); } catch (e) { console.error('[StudioGestures] onStatus', e); } }
  }

  /* ------------------------------------------------------------------ *
   * Hold / debounce / cooldown state machine (pure, time passed in).
   * Frame labels: null (no hand) | 'uncertain' (score < threshold)
   *             | 'other' (ILoveYou / None) | one of the six names.
   * ------------------------------------------------------------------ */
  function createDebouncer(opts) {
    var minHoldMs = opts.minHoldMs;
    var emit = opts.emit;
    var hist = [];            // {t, label, score}
    var runName = null;       // gesture currently dominating the window
    var runStart = 0;
    var latched = null;       // last emitted gesture, blocked until released
    var lastHandAt = -Infinity;
    var lastEmitAt = -Infinity;

    function majority(t) {
      var counts = {}, n = hist.length, i, best = null, bestN = 0;
      for (i = 0; i < n; i++) {
        var l = hist[i].label === null ? '__none' : hist[i].label;
        counts[l] = (counts[l] || 0) + 1;
      }
      for (var k in counts) if (counts[k] > bestN) { best = k; bestN = counts[k]; }
      if (bestN * 2 <= n) return undefined; // no strict majority
      return best === '__none' ? null : best;
    }

    function firstSeen(label) {
      for (var i = 0; i < hist.length; i++) if (hist[i].label === label) return hist[i].t;
      return hist.length ? hist[hist.length - 1].t : 0;
    }

    function meanScore(label) {
      var s = 0, c = 0;
      for (var i = 0; i < hist.length; i++) if (hist[i].label === label) { s += hist[i].score; c++; }
      return c ? s / c : 0;
    }

    return {
      feed: function (label, score, t) {
        if (label !== null) lastHandAt = t;
        hist.push({ t: t, label: label, score: score });
        var cutoff = t - minHoldMs;
        while (hist.length > 1 && hist[0].t < cutoff) hist.shift();

        var maj = majority(t);
        var isGesture = typeof maj === 'string' && maj !== 'other' && maj !== 'uncertain';

        // Release the latch: hand gone >= RELEASE_MS, or a different pose dominates.
        if (latched) {
          if (t - lastHandAt >= RELEASE_MS) latched = null;
          else if (typeof maj === 'string' && maj !== 'uncertain' && maj !== latched) latched = null;
        }

        if (isGesture) {
          if (maj !== runName) { runName = maj; runStart = firstSeen(maj); }
        } else if (maj !== 'uncertain') {
          runName = null;
        }

        if (runName && maj === runName && runName !== latched &&
            t - runStart >= minHoldMs && t - lastEmitAt >= COOLDOWN_MS) {
          latched = runName;
          lastEmitAt = t;
          emit(runName, meanScore(runName));
        }
      },
      clearHistory: function (t) {
        hist = []; runName = null;
        if (latched) lastHandAt = t; // keep latch; restart the release timer
      },
      reset: function () {
        hist = []; runName = null; latched = null; lastHandAt = -Infinity; lastEmitAt = -Infinity;
      }
    };
  }

  function labelFromResult(res) {
    var g = res && res.gestures && res.gestures[0] && res.gestures[0][0];
    if (!g) {
      // A detected hand with no gesture output still counts as "hand present".
      return (res && res.landmarks && res.landmarks.length) ? { label: 'other', score: 0 } : { label: null, score: 0 };
    }
    var score = typeof g.score === 'number' ? g.score : 0;
    var mapped = CATEGORY_MAP[g.categoryName];
    if (score < MIN_CONFIDENCE) return { label: 'uncertain', score: score };
    return { label: mapped || 'other', score: score };
  }

  /* ------------------------------------------------------------------ *
   * Recognizer loading (lazy, cached, GPU -> CPU fallback)
   * ------------------------------------------------------------------ */
  var recognizerPromise = null;
  var visionModule = null, filesetPromise = null;

  function createMediaPipe(delegate) {
    if (!filesetPromise) {
      filesetPromise = import(MP_BUNDLE).then(function (mod) {
        visionModule = mod;
        return mod.FilesetResolver.forVisionTasks(MP_WASM);
      });
      filesetPromise.catch(function () { filesetPromise = null; });
    }
    return filesetPromise.then(function (fileset) {
      return visionModule.GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: delegate },
        runningMode: 'VIDEO',
        numHands: 1
      });
    });
  }

  function loadRecognizer() {
    if (recognizerPromise) return recognizerPromise;
    var factory = window.__studioGestureRecognizerFactory;
    if (typeof factory === 'function') {
      recognizerPromise = Promise.resolve().then(function () { return factory(); })
        .then(function (r) { return { impl: r, delegate: 'injected' }; });
    } else {
      recognizerPromise = createMediaPipe('GPU')
        .then(function (r) { return { impl: r, delegate: 'GPU' }; },
              function (err) {
                console.warn('[StudioGestures] GPU delegate failed, falling back to CPU', err);
                return createMediaPipe('CPU').then(function (r) { return { impl: r, delegate: 'CPU' }; });
              });
    }
    recognizerPromise.catch(function () { recognizerPromise = null; }); // allow retry on next start()
    return recognizerPromise;
  }

  /* ------------------------------------------------------------------ *
   * Session / frame loop
   * ------------------------------------------------------------------ */
  var session = null;   // active session or null
  var paused = false;
  var stats = { frames: 0, inferences: 0, skippedBusy: 0, errors: 0, inferenceMs: 0, emaInferenceMs: 0, lastLabel: null, lastScore: 0, delegate: null, startedAt: 0 };

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas === 'function') {
      try { var oc = new OffscreenCanvas(w, h); if (oc.getContext('2d')) return oc; } catch (e) { /* fall through */ }
    }
    var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }

  function shouldRun() {
    return !!session && !paused && document.visibilityState !== 'hidden';
  }

  function schedule(s) {
    if (s !== session || !shouldRun() || s.pending) return;
    s.pending = true;
    var v = s.video;
    if (typeof v.requestVideoFrameCallback === 'function') {
      s.rvfcId = v.requestVideoFrameCallback(function () { onWake(s); });
      s.timer = setTimeout(function () { onWake(s); }, WATCHDOG_MS);
    } else {
      var wait = Math.max(s.busy ? 20 : 0, s.nextDue - now()); // don't spin while an async inference runs
      s.timer = setTimeout(function () { onWake(s); }, wait);
    }
  }

  function cancelScheduled(s) {
    if (!s) return;
    if (s.rvfcId != null && typeof s.video.cancelVideoFrameCallback === 'function') {
      try { s.video.cancelVideoFrameCallback(s.rvfcId); } catch (e) { /* ignore */ }
    }
    s.rvfcId = null;
    clearTimeout(s.timer); s.timer = null;
    s.pending = false;
  }

  function onWake(s) {
    cancelScheduled(s);
    if (s !== session || !shouldRun()) return;
    var t = now();
    // Throttle to the requested fps. Due times advance by a fixed interval so that
    // e.g. 12 fps on a 30 fps camera alternates 2/3-frame gaps and averages 12.
    if (t >= s.nextDue - 2) {
      if (s.busy) stats.skippedBusy++;
      else {
        // Load shedding: on slow devices lower the rate so inference never hogs the
        // main thread while the camera is recording.
        var iv = Math.max(s.interval, s.ema / MAX_DUTY);
        s.nextDue = (t - s.nextDue > iv) ? t + iv : s.nextDue + iv;
        runInference(s, t);
      }
    }
    schedule(s);
  }

  function runInference(s, t) {
    var v = s.video;
    if (!v.videoWidth || !v.videoHeight || v.readyState < 2) return;
    stats.frames++;
    var w = Math.min(TARGET_WIDTH, v.videoWidth);
    var h = Math.max(1, Math.round(v.videoHeight * w / v.videoWidth));
    if (!s.canvas || s.canvas.width !== w || s.canvas.height !== h) {
      s.canvas = makeCanvas(w, h);
      s.ctx = s.canvas.getContext('2d', { alpha: false, desynchronized: true });
    }
    try { s.ctx.drawImage(v, 0, 0, w, h); } catch (e) { return; }

    var ts = Math.max(t, s.lastTs + 1); // MediaPipe needs strictly increasing timestamps
    s.lastTs = ts;
    s.busy = true;
    var t0 = now();
    var out;
    try { out = s.rec.impl.recognizeForVideo(s.canvas, ts); }
    catch (err) { s.busy = false; return onInferenceError(s, err); }
    Promise.resolve(out).then(function (res) {
      s.busy = false;
      var dt = now() - t0;
      stats.inferences++;
      stats.inferenceMs += dt;
      s.errorStreak = 0;
      s.count++;
      if (s.count > 2) s.ema = s.ema ? s.ema * 0.8 + dt * 0.2 : dt; // skip warm-up frames
      stats.emaInferenceMs = Math.round(s.ema * 10) / 10;
      maybeAdapt(s);
      if (s !== session || paused) return;
      var l = labelFromResult(res);
      stats.lastLabel = l.label; stats.lastScore = l.score;
      s.debouncer.feed(l.label, l.score, now());
    }, function (err) { s.busy = false; onInferenceError(s, err); });
  }

  // Swap delegate when the GPU path turns out slow (software GL); keep whichever is faster.
  function maybeAdapt(s) {
    if (s !== session || s.count < 6 || s.swapping) return;
    if (s.rec.delegate === 'GPU' && !s.triedCpu && s.ema > SLOW_GPU_MS) {
      s.triedCpu = true;
      s.gpuRec = s.rec; s.gpuEma = s.ema;
      swapTo(s, 'CPU', 'GPU inference slow (' + Math.round(s.ema) + ' ms), trying CPU');
    } else if (s.rec.delegate === 'CPU' && s.gpuRec && s.ema > s.gpuEma) {
      var cpu = s.rec;
      s.rec = s.gpuRec; s.gpuRec = null; s.ema = s.gpuEma; s.count = 6;
      try { cpu.impl.close && cpu.impl.close(); } catch (e) { /* ignore */ }
      recognizerPromise = Promise.resolve(s.rec); stats.delegate = 'GPU';
    } else if (s.rec.delegate === 'CPU' && s.gpuRec) {
      try { s.gpuRec.impl.close && s.gpuRec.impl.close(); } catch (e) { /* ignore */ }
      s.gpuRec = null;
    }
  }

  function swapTo(s, delegate, why) {
    console.warn('[StudioGestures] ' + why);
    s.swapping = true; s.busy = true;
    createMediaPipe(delegate).then(function (r) {
      s.swapping = false; s.busy = false;
      var rec = { impl: r, delegate: delegate };
      if (s !== session) { try { r.close(); } catch (e) { /* ignore */ } return; }
      if (!s.gpuRec) { try { s.rec.impl.close && s.rec.impl.close(); } catch (e) { /* ignore */ } }
      s.rec = rec; s.count = 0; s.ema = 0; s.errorStreak = 0;
      recognizerPromise = Promise.resolve(rec);
      stats.delegate = delegate;
      schedule(s);
    }, function (e2) {
      s.swapping = false; s.busy = false;
      if (s.gpuRec) { s.rec = s.gpuRec; s.gpuRec = null; schedule(s); } // keep slow GPU
      else fail(s, e2);
    });
  }

  function onInferenceError(s, err) {
    stats.errors++;
    s.errorStreak = (s.errorStreak || 0) + 1;
    if (s !== session) return;
    if (s.rec.delegate === 'GPU' && !s.triedCpu) {
      // GPU context can fail at first use on some phones: rebuild on CPU once.
      s.triedCpu = true; s.gpuRec = null;
      if (!s.swapping) swapTo(s, 'CPU', 'GPU inference failed, retrying on CPU: ' + (err && err.message || err));
      return;
    }
    if (s.errorStreak >= 5) fail(s, err);
  }

  function fail(s, err) {
    console.error('[StudioGestures] disabled after errors', err);
    if (s === session) { stopInternal(); setStatus('error'); }
  }

  function onVisibility() {
    if (!session) return;
    if (document.visibilityState === 'hidden') {
      cancelScheduled(session);
    } else if (!paused) {
      session.debouncer.clearHistory(now());
      session.nextDue = 0;
      schedule(session);
    }
  }

  function stopInternal() {
    if (!session) return;
    cancelScheduled(session);
    session = null;
    document.removeEventListener('visibilitychange', onVisibility);
  }

  var startToken = 0;

  var api = {
    __version: '1.0.0',
    onStatus: (window.StudioGestures && window.StudioGestures.onStatus) || undefined,

    supported: function () {
      try {
        if (typeof window.__studioGestureRecognizerFactory === 'function') return Promise.resolve(true);
        if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') return Promise.resolve(false);
        // Minimal valid wasm module header.
        if (!WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))) return Promise.resolve(false);
        var c = makeCanvas(2, 2);
        if (!c.getContext('2d')) return Promise.resolve(false);
        if (typeof Promise === 'undefined' || !window.HTMLVideoElement) return Promise.resolve(false);
        // MediaPipe needs WebGL2 for GPU, but falls back to CPU (WASM) without it.
        return Promise.resolve(true);
      } catch (e) {
        return Promise.resolve(false);
      }
    },

    start: function (videoEl, options) {
      options = options || {};
      var token = ++startToken;
      stopInternal();
      if (!videoEl || typeof videoEl.videoWidth !== 'number') {
        setStatus('error');
        return Promise.resolve();
      }
      var fps = Math.max(1, Math.min(60, Number(options.fps) || 12));
      var minHoldMs = Math.max(0, options.minHoldMs == null ? 600 : Number(options.minHoldMs) || 0);
      var onGesture = typeof options.onGesture === 'function' ? options.onGesture : function () {};

      var needsLoad = !recognizerPromise;
      if (needsLoad) setStatus('loading');
      return loadRecognizer().then(function (rec) {
        if (token !== startToken) return; // superseded by another start()/stop()
        stats.delegate = rec.delegate;
        stats.startedAt = now();
        var s = {
          video: videoEl, rec: rec, interval: 1000 / fps,
          nextDue: 0, ema: 0, count: 0, swapping: false, gpuRec: null, gpuEma: 0, lastTs: 0, busy: false, pending: false,
          rvfcId: null, timer: null, canvas: null, ctx: null, errorStreak: 0, triedCpu: false
        };
        s.debouncer = createDebouncer({
          minHoldMs: minHoldMs,
          emit: function (name, conf) {
            try { onGesture(name, Math.round(conf * 1000) / 1000); }
            catch (e) { console.error('[StudioGestures] onGesture', e); }
          }
        });
        session = s;
        document.addEventListener('visibilitychange', onVisibility);
        setStatus('ready');
        schedule(s);
      }, function (err) {
        if (token !== startToken) return;
        console.warn('[StudioGestures] could not load gesture recognizer', err);
        setStatus('error');
      });
    },

    stop: function () {
      startToken++;
      stopInternal();
    },

    setPaused: function (p) {
      p = !!p;
      if (p === paused) return;
      paused = p;
      if (!session) return;
      if (paused) cancelScheduled(session);
      else { session.debouncer.clearHistory(now()); session.nextDue = 0; schedule(session); }
    },

    isRunning: function () { return !!session; }
  };

  // Diagnostics (not part of the app contract): counters for tests / debugging.
  Object.defineProperty(api, '_stats', {
    enumerable: false,
    value: function () {
      var o = {}; for (var k in stats) o[k] = stats[k];
      o.paused = paused; o.running = !!session;
      o.avgInferenceMs = stats.inferences ? stats.inferenceMs / stats.inferences : 0;
      return o;
    }
  });
  Object.defineProperty(api, '_createDebouncer', { enumerable: false, value: createDebouncer });

  window.StudioGestures = api;
})();
