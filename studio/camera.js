// Chowaniec Studio – camera engine (/studio/camera.js)
// ---------------------------------------------------------------------------------------------------
// Opens the best camera the browser offers, at the highest resolution and frame rate the track allows,
// with natural (unprocessed) stereo sound, and records it with MediaRecorder in 1 s chunks that the caller
// streams straight to storage.
//
// window.StudioCamera = {
//   PRESETS, listCameras(), defaultCameraId(list), open({ deviceId, facing, preset, video }), close(),
//   applyPreset(id), availablePresets(), specs(), caps(), setZoom(v), setTorch(on), focusAt(x, y),
//   setExposureCompensation(v), setWhiteBalance(mode), setFocusMode(mode),
//   pickMime(), bitrateFor(w, h, fps), startRecorder({ onChunk, onStart, onStop, onError }), stopRecorder(),
//   isRecording(), stream()
// }
(function () {
  'use strict';
  if (window.StudioCamera) return;

  // Width/height are given in landscape terms; the browser rotates frames to match how the phone is held.
  var PRESETS = [
    { id: '4k60', label: '4K · 60 fps', w: 3840, h: 2160, fps: 60 },
    { id: '4k30', label: '4K · 30 fps', w: 3840, h: 2160, fps: 30 },
    { id: '1080p60', label: '1080p · 60 fps', w: 1920, h: 1080, fps: 60 },
    { id: '1080p30', label: '1080p · 30 fps', w: 1920, h: 1080, fps: 30 },
    { id: '720p', label: '720p · 30 fps', w: 1280, h: 720, fps: 30 }
  ];
  var MIMES = [
    'video/mp4;codecs=avc1.640034,mp4a.40.2',   // H.264 High @ 5.2 (4K60) + AAC
    'video/mp4;codecs=avc1.640033,mp4a.40.2',
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  var AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 }, sampleSize: { ideal: 16 } };

  var cur = { stream: null, video: null, track: null, deviceId: null, preset: null, recorder: null, mime: '', bitrate: 0, audioOk: false };

  function gum(c) { return navigator.mediaDevices.getUserMedia(c); }
  function stopStream(s) { if (s) s.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* ignore */ } }); }

  // ---------- lenses ----------
  // Chrome on Android names cameras "camera2 0, facing back" etc. Samsung phones list the main wide lens first and
  // the extra rear lenses (ultra-wide, telephotos) after it. Safari names them ("Back Ultra Wide Camera").
  function describe(dev, backIndex) {
    var l = (dev.label || '').toLowerCase();
    var front = /front|selfie|facetime/.test(l);
    var back = /back|rear|environment|world/.test(l) || (!front && /camera2/.test(l));
    var name, kind = front ? 'front' : back ? 'back' : 'other', zoomHint = 1;
    if (/ultra ?wide|uw\b|0\.5|0\.6/.test(l)) { name = 'Ultra-wide'; zoomHint = 0.6; }
    else if (/tele|zoom/.test(l)) { var m = l.match(/(\d+(?:\.\d+)?)\s*x/); zoomHint = m ? parseFloat(m[1]) : 3; name = 'Telephoto ' + (m ? m[1] + 'x' : ''); }
    else if (/triple/.test(l)) { name = 'Triple (auto lens)'; }
    else if (/dual wide/.test(l)) { name = 'Dual wide (auto lens)'; }
    else if (/dual/.test(l)) { name = 'Dual (auto lens)'; }
    else if (/macro/.test(l)) { name = 'Macro'; }
    else if (/depth/.test(l)) { name = 'Depth'; }
    else if (front) name = 'Front camera';
    else if (back) {
      // Android numeric ids: guess the typical Samsung Ultra order (main, ultra-wide, 3x, 5x/10x).
      var guess = [['Main · 1x', 1], ['Ultra-wide · 0.6x', 0.6], ['Telephoto · 3x', 3], ['Telephoto · 5x', 5], ['Telephoto · 10x', 10]];
      var g = guess[backIndex] || ['Rear lens ' + (backIndex + 1), 1];
      name = g[0]; zoomHint = g[1];
    } else name = (dev.label && dev.label.length <= 28 && !/[\\/]/.test(dev.label)) ? dev.label : 'Camera';
    if (/^back camera$|^rear camera$/.test(l) || /camera2 0\b/.test(l)) { name = 'Main · 1x'; zoomHint = 1; }
    return { deviceId: dev.deviceId, label: dev.label || name, name: name.trim(), kind: kind, zoomHint: zoomHint };
  }
  async function listCameras() {
    var devs = [];
    try { devs = await navigator.mediaDevices.enumerateDevices(); } catch (e) { return []; }
    var vids = devs.filter(function (d) { return d.kind === 'videoinput'; });
    var out = [], bi = 0;
    // Android lists "camera2 N" out of numeric order sometimes; sort so camera2 0 comes first.
    vids.sort(function (a, b) {
      var na = (a.label.match(/camera2 (\d+)/) || [])[1], nb = (b.label.match(/camera2 (\d+)/) || [])[1];
      return (na == null || nb == null) ? 0 : na - nb;
    });
    vids.forEach(function (d) {
      var isBack = !/front|selfie|facetime/i.test(d.label) && (/back|rear|environment|camera2/i.test(d.label));
      var x = describe(d, isBack ? bi : 0);
      if (isBack) bi++;
      out.push(x);
    });
    // Two lenses with the same name get a number so they stay distinguishable.
    var seen = {};
    out.forEach(function (c) { seen[c.name] = (seen[c.name] || 0) + 1; if (seen[c.name] > 1) c.name += ' (' + seen[c.name] + ')'; });
    // Rear first, front last.
    var order = { back: 0, other: 1, front: 2 };
    out.sort(function (a, b) { return order[a.kind] - order[b.kind]; });
    return out;
  }
  function defaultCameraId(list) {
    if (!list || !list.length) return null;
    var main = list.find(function (c) { return /camera2 0\b/i.test(c.label) && c.kind === 'back'; }) ||
      list.find(function (c) { return /^back camera$/i.test(c.label); }) ||
      list.find(function (c) { return c.kind === 'back' && c.name.indexOf('Main') === 0; }) ||
      list.find(function (c) { return c.kind === 'back'; }) || list[0];
    return main.deviceId;
  }

  // ---------- open ----------
  function videoConstraints(deviceId, facing, p) {
    var v = { width: { ideal: p ? p.w : 3840 }, height: { ideal: p ? p.h : 2160 }, frameRate: { ideal: p ? p.fps : 60 } };
    if (deviceId) v.deviceId = { exact: deviceId }; else v.facingMode = { ideal: facing || 'environment' };
    return v;
  }
  async function open(opts) {
    opts = opts || {};
    close();
    var preset = PRESETS.find(function (p) { return p.id === opts.preset; }) || null;
    var stream = null, audioOk = true;
    try {
      stream = await gum({ video: videoConstraints(opts.deviceId, opts.facing, preset), audio: AUDIO });
    } catch (e) {
      if (e && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError' || e.name === 'NotReadableError')) {
        try { stream = await gum({ video: videoConstraints(null, opts.facing, preset), audio: AUDIO }); }
        catch (e2) { stream = await gum({ video: true, audio: true }).catch(function () { audioOk = false; return gum({ video: true }); }); }
      } else if (e && e.name === 'NotAllowedError') {
        throw e;
      } else {
        audioOk = false;
        stream = await gum({ video: videoConstraints(opts.deviceId, opts.facing, preset) });
      }
    }
    cur.stream = stream;
    cur.track = stream.getVideoTracks()[0];
    cur.audioOk = audioOk && stream.getAudioTracks().length > 0;
    cur.deviceId = (cur.track.getSettings && cur.track.getSettings().deviceId) || opts.deviceId || null;
    // Push the track to the best it can do (or to the chosen preset).
    await applyPreset(preset ? preset.id : 'max');
    try { var focusModes = (caps().focusMode || []); if (focusModes.indexOf('continuous') >= 0) await cur.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) { /* ignore */ }
    if (opts.video) {
      cur.video = opts.video;
      opts.video.srcObject = stream;
      opts.video.muted = true;
      opts.video.setAttribute('playsinline', '');
      try { await opts.video.play(); } catch (e) { /* autoplay muted is allowed */ }
    }
    return stream;
  }
  function close() {
    if (cur.recorder && cur.recorder.state !== 'inactive') { try { cur.recorder.stop(); } catch (e) { /* ignore */ } }
    stopStream(cur.stream);
    if (cur.video) cur.video.srcObject = null;
    cur.stream = null; cur.track = null; cur.recorder = null;
  }
  function caps() {
    try { return (cur.track && cur.track.getCapabilities) ? cur.track.getCapabilities() || {} : {}; } catch (e) { return {}; }
  }
  function settings() { try { return cur.track ? cur.track.getSettings() : {}; } catch (e) { return {}; } }
  function maxOf(r, fallback) { return r && typeof r.max === 'number' && r.max > 0 ? r.max : fallback; }

  // Which presets this lens can do. Capabilities are reported in landscape terms (long side = width), but compare the
  // long and short sides anyway so a portrait-reporting browser still works.
  function availablePresets() {
    var c = caps();
    if (!c.width || !c.height) {
      // No capabilities (Safari < 17, Firefox): offer the presets up to what the track currently delivers.
      var s = settings(), L = Math.max(s.width || 0, s.height || 0), fps = s.frameRate || 30;
      return PRESETS.filter(function (p) { return p.w <= Math.max(L, 1280) && p.fps <= Math.max(fps, 30) + 1; });
    }
    var long = Math.max(maxOf(c.width, 0), maxOf(c.height, 0)), short = Math.min(maxOf(c.width, 0), maxOf(c.height, 0));
    var fmax = maxOf(c.frameRate, 30);
    var list = PRESETS.filter(function (p) { return long >= p.w && short >= p.h && fmax >= p.fps - 0.5; });
    if (!list.length) list = [PRESETS[PRESETS.length - 1]];
    return list;
  }
  async function applyPreset(id) {
    if (!cur.track) return;
    var c = caps();
    var p = PRESETS.find(function (x) { return x.id === id; });
    var want;
    if (!p || id === 'max') {
      // The best 16:9 mode under the track's limits: prefer the biggest preset available, else the raw max.
      var avail = availablePresets();
      p = avail[0];
      want = p ? { width: { ideal: p.w }, height: { ideal: p.h }, frameRate: { ideal: p.fps } }
        : { width: { ideal: maxOf(c.width, 3840) }, height: { ideal: maxOf(c.height, 2160) }, frameRate: { ideal: maxOf(c.frameRate, 60) } };
    } else {
      want = { width: { ideal: p.w }, height: { ideal: p.h }, frameRate: { ideal: p.fps } };
    }
    try { await cur.track.applyConstraints(want); } catch (e) {
      try { await cur.track.applyConstraints({ width: want.width, height: want.height }); } catch (e2) { /* keep what we have */ }
    }
    cur.preset = p ? p.id : null;
  }
  function specs() {
    var s = settings();
    var vw = cur.video && cur.video.videoWidth, vh = cur.video && cur.video.videoHeight;
    var w = vw || s.width || 0, h = vh || s.height || 0;
    var fps = Math.round(s.frameRate || 30);
    var mime = pickMime();
    return {
      width: w, height: h, fps: fps, mime: mime,
      container: /mp4/.test(mime) ? 'MP4' : /webm/.test(mime) ? 'WebM' : '?',
      codec: /avc1|mp4$/.test(mime) || mime === 'video/mp4' ? 'H.264' : /vp9/.test(mime) ? 'VP9' : /vp8/.test(mime) ? 'VP8' : '',
      bitrate: bitrateFor(w, h, fps),
      preset: cur.preset, deviceId: cur.deviceId,
      audio: cur.audioOk ? audioSpecs() : null
    };
  }
  function audioSpecs() {
    var t = cur.stream && cur.stream.getAudioTracks()[0];
    if (!t) return null;
    var s = {}; try { s = t.getSettings(); } catch (e) { /* ignore */ }
    return { channels: s.channelCount || null, sampleRate: s.sampleRate || null, processed: !!(s.echoCancellation || s.noiseSuppression || s.autoGainControl) };
  }
  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < MIMES.length; i++) { try { if (MediaRecorder.isTypeSupported(MIMES[i])) return MIMES[i]; } catch (e) { /* ignore */ } }
    return '';
  }
  // Bitrate by pixels per second: 4K60 ≈ 60 Mbps, 4K30 ≈ 45, 1080p60 ≈ 20, 1080p30 ≈ 12, 720p30 ≈ 6.
  function bitrateFor(w, h, fps) {
    var px = (w || 1920) * (h || 1080);
    var hi = (fps || 30) > 40;
    if (px >= 3840 * 2160 * 0.9) return hi ? 60e6 : 45e6;
    if (px >= 2560 * 1440 * 0.9) return hi ? 36e6 : 24e6;
    if (px >= 1920 * 1080 * 0.9) return hi ? 20e6 : 12e6;
    if (px >= 1280 * 720 * 0.9) return hi ? 9e6 : 6e6;
    return hi ? 5e6 : 3e6;
  }

  // ---------- pro controls (only where the track has them) ----------
  async function adv(o) { if (!cur.track) return false; try { await cur.track.applyConstraints({ advanced: [o] }); return true; } catch (e) { return false; } }
  var setZoom = function (v) { return adv({ zoom: v }); };
  var setTorch = function (on) { return adv({ torch: !!on }); };
  var setExposureCompensation = function (v) { return adv({ exposureMode: 'continuous', exposureCompensation: v }); };
  var setWhiteBalance = function (mode) { return adv({ whiteBalanceMode: mode }); };
  var setFocusMode = function (mode) { return adv({ focusMode: mode }); };
  async function focusAt(x, y) {
    var c = caps();
    var o = {};
    if ('pointsOfInterest' in c || (navigator.mediaDevices.getSupportedConstraints && navigator.mediaDevices.getSupportedConstraints().pointsOfInterest)) o.pointsOfInterest = [{ x: x, y: y }];
    var fm = c.focusMode || [];
    if (fm.indexOf('single-shot') >= 0) o.focusMode = 'single-shot'; else if (fm.indexOf('continuous') >= 0) o.focusMode = 'continuous';
    var em = c.exposureMode || [];
    if (em.indexOf('continuous') >= 0) o.exposureMode = 'continuous';
    if (!Object.keys(o).length) return false;
    var ok = await adv(o);
    // Go back to continuous autofocus after a few seconds so a moving actor stays sharp.
    if (o.focusMode === 'single-shot' && fm.indexOf('continuous') >= 0) setTimeout(function () { adv({ focusMode: 'continuous' }); }, 4000);
    return ok;
  }

  // ---------- recording ----------
  function startRecorder(h) {
    h = h || {};
    var mime = pickMime();
    var sp = specs();
    var opts = { videoBitsPerSecond: sp.bitrate, audioBitsPerSecond: 256000 };
    if (mime) opts.mimeType = mime;
    var rec;
    try { rec = new MediaRecorder(cur.stream, opts); }
    catch (e) { delete opts.mimeType; rec = new MediaRecorder(cur.stream, opts); }
    cur.recorder = rec; cur.mime = rec.mimeType || mime || 'video/mp4'; cur.bitrate = sp.bitrate;
    rec.ondataavailable = function (ev) { if (ev.data && ev.data.size && h.onChunk) h.onChunk(ev.data); };
    rec.onstop = function () { if (h.onStop) h.onStop(); };
    rec.onerror = function (ev) { if (h.onError) h.onError(ev.error || ev); };
    rec.onstart = function () { if (h.onStart) h.onStart(); };
    rec.start(1000);
    return { mimeType: cur.mime, bitrate: sp.bitrate };
  }
  function stopRecorder() {
    var r = cur.recorder;
    if (!r || r.state === 'inactive') return false;
    try { r.requestData(); } catch (e) { /* ignore */ }
    r.stop();
    return true;
  }

  window.StudioCamera = {
    PRESETS: PRESETS, MIMES: MIMES,
    listCameras: listCameras, defaultCameraId: defaultCameraId, describe: describe,
    open: open, close: close, applyPreset: applyPreset, availablePresets: availablePresets,
    specs: specs, caps: caps, settings: settings,
    setZoom: setZoom, setTorch: setTorch, focusAt: focusAt, setExposureCompensation: setExposureCompensation,
    setWhiteBalance: setWhiteBalance, setFocusMode: setFocusMode,
    pickMime: pickMime, bitrateFor: bitrateFor,
    startRecorder: startRecorder, stopRecorder: stopRecorder,
    isRecording: function () { return !!(cur.recorder && cur.recorder.state === 'recording'); },
    stream: function () { return cur.stream; },
    track: function () { return cur.track; },
    mime: function () { return cur.mime; }
  };
})();
