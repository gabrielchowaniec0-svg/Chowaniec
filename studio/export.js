/*!
 * Chowaniec Studio — export.js
 * Joins recorded takes into one video and shares/downloads files.
 *
 *   window.StudioExport = {
 *     canJoin(clips)                     -> { lossless, reason? }       (sync, mime-type based)
 *     join(clips, { onProgress, signal }) -> Promise<Blob>              (one playable video)
 *     share(files, { title })            -> Promise<'shared'|'downloaded'>
 *     filename(project, sceneNo, sceneName, takeNo, ext) -> "Comedy_S03_Opening-scene_T2.mp4"
 *     // extras: inspect(clips) (async, exact lossless check), extensionFor(mime), lastJoinInfo
 *   }
 *   clips: [{ blob, mimeType, name }] in playback order.
 *
 * join() strategy
 *   1. Lossless remux (no re-encoding) when every take has the same container and identical codec
 *      configuration (codec, resolution, codec private data, audio rate/channels, rotation):
 *        MP4  -> mp4box.js demux (fragmented MediaRecorder MP4 streamed in 4 MB slices; regular MP4
 *                read sample-by-sample from its sample tables) -> mp4-muxer (standard MP4, moov at end)
 *                + an edit list per track (B-frame composition offset / AAC priming / track start delay).
 *        WebM -> built-in streaming EBML demuxer -> webm-muxer.
 *      Each take's video defines the take length; audio is trimmed/kept per frame (nearest frame
 *      boundary) so audio and video are re-aligned at every join (error <= half an audio frame,
 *      never cumulative). AAC priming frames of takes 2..n are dropped.
 *   2. Re-encode with WebCodecs (decode -> scale/letterbox to take 1's size -> encode at take 1's
 *      bitrate) when configurations differ or remux fails.
 *   3. Real-time fallback: play each take into a canvas + WebAudio -> MediaRecorder.
 *
 * Libraries are loaded lazily from ./vendor/ (pinned, licence headers inside):
 *   mp4box.js 0.5.2 (BSD-3-Clause), mp4-muxer 5.2.2 (MIT), webm-muxer 5.1.4 (MIT).
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var READ_CHUNK = 4 << 20; // bytes read per Blob.slice

  // ---------------------------------------------------------------- library loading

  var BASE_URL = (function () {
    try {
      var cs = document.currentScript;
      if (cs && cs.src) return new URL('.', cs.src).href;
      var tags = document.querySelectorAll('script[src]');
      for (var i = 0; i < tags.length; i++) {
        if (/(^|\/)export\.js([?#]|$)/.test(tags[i].src)) return new URL('.', tags[i].src).href;
      }
    } catch (e) { /* ignore */ }
    try { return new URL('./', global.location.href).href; } catch (e) { return './'; }
  })();

  var LIBS = {
    mp4box: { path: 'vendor/mp4box.all.min.js', get: function () { return global.StudioMP4Box; } },
    mp4muxer: { path: 'vendor/mp4-muxer.js', get: function () { return global.Mp4Muxer; } },
    webmmuxer: { path: 'vendor/webm-muxer.js', get: function () { return global.WebMMuxer; } },
  };
  var libPromises = {};

  function loadLib(name) {
    var lib = LIBS[name];
    var have = lib.get();
    if (have) return Promise.resolve(have);
    if (!libPromises[name]) {
      libPromises[name] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = new URL(lib.path, BASE_URL).href;
        s.async = true;
        s.onload = function () {
          var v = lib.get();
          if (v) resolve(v); else reject(new Error('Library ' + name + ' did not initialise'));
        };
        s.onerror = function () { reject(new Error('Could not load ' + lib.path + ' (offline?)')); };
        document.head.appendChild(s);
      });
      libPromises[name].catch(function () { delete libPromises[name]; });
    }
    return libPromises[name];
  }

  // ---------------------------------------------------------------- small helpers

  function abortError() {
    try { return new DOMException('Export cancelled', 'AbortError'); } catch (e) {
      var err = new Error('Export cancelled'); err.name = 'AbortError'; return err;
    }
  }
  function isAbort(e) { return e && e.name === 'AbortError'; }
  function checkAbort(signal) {
    if (signal && signal.aborted) {
      throw (signal.reason && signal.reason.name === 'AbortError') ? signal.reason : abortError();
    }
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function even(n) { n = Math.max(2, Math.round(n)); return n - (n % 2); }
  function hex(u8) {
    if (!u8) return '';
    var s = '';
    for (var i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
    return s;
  }
  function fourcc(u8, off) {
    return String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
  }
  async function readBytes(blob, start, end) {
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
  }
  function concatBytes(list) {
    var n = 0, i;
    for (i = 0; i < list.length; i++) n += list[i].length;
    var out = new Uint8Array(n), o = 0;
    for (i = 0; i < list.length; i++) { out.set(list[i], o); o += list[i].length; }
    return out;
  }

  function containerFromHint(clip) {
    var t = String((clip && (clip.mimeType || (clip.blob && clip.blob.type))) || '').toLowerCase();
    if (/mp4|quicktime|m4v/.test(t)) return 'mp4';
    if (/webm|matroska/.test(t)) return 'webm';
    var n = String((clip && clip.name) || (clip && clip.blob && clip.blob.name) || '').toLowerCase();
    if (/\.(mp4|m4v|mov)$/.test(n)) return 'mp4';
    if (/\.(webm|mkv)$/.test(n)) return 'webm';
    return null;
  }
  function codecsFromMime(mime) {
    var m = /codecs\s*=\s*"?([^";]+)"?/i.exec(String(mime || ''));
    if (!m) return null;
    return m[1].split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean).join(',');
  }

  function extensionFor(mime) {
    var t = String(mime || '').toLowerCase();
    if (t.indexOf('webm') >= 0) return 'webm';
    if (t.indexOf('quicktime') >= 0) return 'mov';
    if (t.indexOf('matroska') >= 0) return 'mkv';
    return 'mp4';
  }

  // Progress reporter: clamps to 0..1, throttles to ~10 Hz.
  // Progress reporter: clamps to 0..1, never goes backwards (a fallback stage continues from where
  // the failed stage stopped), throttles to ~10 Hz.
  function makeReporter(cb) {
    var last = 0, lastT = 0, base = 0, sent = false;
    var r = function (f, force) {
      if (typeof cb !== 'function') return;
      f = base + (1 - base) * Math.max(0, Math.min(1, f || 0));
      if (f < last || (sent && f === last && !force)) return;
      var now = Date.now();
      if (!force && f !== 1 && (f - last < 0.001 || now - lastT < 100)) return;
      last = f; lastT = now; sent = true;
      try { cb(f); } catch (e) { /* ignore UI errors */ }
    };
    r.newStage = function () { base = last; };
    return r;
  }

  // Output collector for the muxers' StreamTarget: keeps the file as a list of Blobs (Chrome can
  // page large Blobs to disk) and supports the muxers' seek-back header patches.
  function BlobSink() {
    this.parts = []; this.offs = []; this.size = 0;
    this.pend = []; this.pendSize = 0; this.pendPos = 0;
  }
  BlobSink.prototype.flush = function () {
    if (!this.pendSize) return;
    this.parts.push(new Blob(this.pend));
    this.offs.push(this.pendPos);
    this.size = this.pendPos + this.pendSize;
    this.pend = []; this.pendSize = 0;
  };
  BlobSink.prototype.write = function (data, pos) {
    var end = pos + data.byteLength;
    if (pos === this.size + this.pendSize) {
      if (!this.pendSize) this.pendPos = pos;
      this.pend.push(data.slice());
      this.pendSize += data.byteLength;
      if (this.pendSize >= READ_CHUNK) this.flush();
      return;
    }
    this.flush();
    if (pos > this.size) {
      this.parts.push(new Blob([new Uint8Array(pos - this.size)]));
      this.offs.push(this.size);
      this.size = pos;
    }
    if (pos === this.size) {
      this.parts.push(new Blob([data.slice()]));
      this.offs.push(pos);
      this.size = end;
      return;
    }
    // Overwrite inside already written data.
    var np = [], no = [], inserted = false, piece = new Blob([data.slice()]);
    for (var i = 0; i < this.parts.length; i++) {
      var off = this.offs[i], b = this.parts[i], e = off + b.size;
      if (e <= pos || off >= end) {
        if (!inserted && off >= end) { np.push(piece); no.push(pos); inserted = true; }
        np.push(b); no.push(off);
        continue;
      }
      if (off < pos) { np.push(b.slice(0, pos - off)); no.push(off); }
      if (!inserted) { np.push(piece); no.push(pos); inserted = true; }
      if (e > end) { np.push(b.slice(end - off)); no.push(end); }
    }
    if (!inserted) { np.push(piece); no.push(pos); }
    this.parts = np; this.offs = no;
    this.size = Math.max(this.size, end);
  };
  BlobSink.prototype.blob = function (type) {
    this.flush();
    return new Blob(this.parts, { type: type });
  };

  // ---------------------------------------------------------------- codec helpers

  function opusHead(channels, preSkip, inputRate, gain, family, extra) {
    var len = 19 + (family ? 2 + channels : 0);
    var u = new Uint8Array(len), dv = new DataView(u.buffer);
    u.set([79, 112, 117, 115, 72, 101, 97, 100], 0); // "OpusHead"
    u[8] = 1; u[9] = channels;
    dv.setUint16(10, preSkip || 0, true);
    dv.setUint32(12, inputRate || 48000, true);
    dv.setInt16(16, gain || 0, true);
    u[18] = family || 0;
    if (family && extra) {
      u[19] = extra.StreamCount; u[20] = extra.CoupledCount;
      for (var i = 0; i < channels; i++) u[21 + i] = (extra.ChannelMapping || [])[i] || 0;
    }
    return u;
  }

  // Duration (s) of an Opus packet from its TOC byte (RFC 6716 §3.1).
  function opusPacketDuration(d) {
    if (!d || !d.length) return 0;
    var toc = d[0], config = toc >> 3, size;
    if (config < 12) size = [0.01, 0.02, 0.04, 0.06][config & 3];
    else if (config < 16) size = [0.01, 0.02][config & 1];
    else size = [0.0025, 0.005, 0.01, 0.02][config & 3];
    var c = toc & 3, frames = c === 0 ? 1 : c === 3 ? (d.length > 1 ? d[1] & 63 : 1) : 2;
    return size * frames;
  }

  var PRIM = { 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m' };
  var TRANSFER = { 1: 'bt709', 6: 'smpte170m', 13: 'iec61966-2-1' };
  var MATRIX = { 0: 'rgb', 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m' };
  function colorSpaceFromCodes(p, t, m, full) {
    if (PRIM[p] && TRANSFER[t] && MATRIX[m] !== undefined) {
      return { primaries: PRIM[p], transfer: TRANSFER[t], matrix: MATRIX[m], fullRange: !!full };
    }
    return null;
  }
  var DEFAULT_COLOR = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };

  function codecFamily(codec) {
    var c = String(codec || '').toLowerCase();
    if (/^(avc1|avc3)/.test(c) || c === 'v_mpeg4/iso/avc') return 'avc';
    if (/^(hvc1|hev1)/.test(c) || c === 'v_mpegh/iso/hevc') return 'hevc';
    if (/^vp09/.test(c) || c === 'vp9' || c === 'v_vp9') return 'vp9';
    if (/^vp8/.test(c) || c === 'v_vp8') return 'vp8';
    if (/^av01/.test(c) || c === 'v_av1') return 'av1';
    if (/^mp4a/.test(c) || c === 'a_aac' || c.indexOf('a_aac') === 0) return 'aac';
    if (/^opus/.test(c) || c === 'a_opus') return 'opus';
    if (c === 'a_vorbis' || c === 'vorbis') return 'vorbis';
    return c;
  }

  // ---------------------------------------------------------------- MP4 probe / demux

  async function scanTopBoxes(blob, stopAt) {
    var boxes = [], pos = 0;
    while (pos + 8 <= blob.size) {
      var h = await readBytes(blob, pos, Math.min(blob.size, pos + 16));
      var dv = new DataView(h.buffer);
      var size = dv.getUint32(0), type = fourcc(h, 4), hdr = 8;
      if (size === 1) {
        if (h.length < 16) break;
        size = dv.getUint32(8) * 4294967296 + dv.getUint32(12); hdr = 16;
      } else if (size === 0) size = blob.size - pos;
      if (size < hdr || !/^[\x20-\x7e]{4}$/.test(type)) break;
      boxes.push({ type: type, pos: pos, size: size });
      if (stopAt && type === stopAt) break;
      pos += size;
    }
    return boxes;
  }

  function findDescriptor(d, tag) {
    if (!d) return null;
    if (d.tag === tag) return d;
    var kids = d.descs || [];
    for (var i = 0; i < kids.length; i++) {
      var r = findDescriptor(kids[i], tag);
      if (r) return r;
    }
    return null;
  }

  function editInfo(trak, movieTs, mediaTs) {
    var delay = 0, start = 0, entries = trak.edts && trak.edts.elst && trak.edts.elst.entries;
    if (entries) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.media_time === -1 || e.media_time === 4294967295) { delay += e.segment_duration / movieTs; continue; }
        start = e.media_time / mediaTs;
        break;
      }
    }
    return { start: start, delay: delay };
  }

  function matrixInfo(trak) {
    var m = trak.tkhd && trak.tkhd.matrix;
    if (!m || m.length !== 9) return { rotation: 0, key: '' };
    var a = Array.prototype.slice.call(m);
    var id = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
    if (a.every(function (v, i) { return v === id[i]; }) || a.every(function (v) { return v === 0; })) {
      return { rotation: 0, key: '' };
    }
    var f = a.map(function (v, i) { return (i % 3 === 2) ? v / 1073741824 : v / 65536; });
    return { rotation: f, key: a.join(',') };
  }

  async function probeMp4(blob) {
    var lib = await loadLib('mp4box');
    var tops = await scanTopBoxes(blob, 'moov');
    var moov = tops.filter(function (b) { return b.type === 'moov'; })[0];
    if (!moov) throw new Error('MP4 has no moov box (incomplete recording?)');
    var ftyp = tops.filter(function (b) { return b.type === 'ftyp'; })[0];
    var parts = [];
    if (ftyp) parts.push(await readBytes(blob, ftyp.pos, ftyp.pos + ftyp.size));
    parts.push(await readBytes(blob, moov.pos, moov.pos + moov.size));
    var syn = concatBytes(parts);
    var ab = syn.buffer; ab.fileStart = 0;
    var file = lib.MP4Box.createFile(false), info = null, err = null;
    file.onReady = function (i) { info = i; };
    file.onError = function (e) { err = e; };
    file.appendBuffer(ab);
    file.flush();
    if (!info) throw new Error('Could not read MP4 header' + (err ? ': ' + err : ''));
    var fragmented = !!info.isFragmented;
    var res = { container: 'mp4', fragmented: fragmented, duration: info.duration ? info.duration / info.timescale : null, video: null, audio: null };
    var raw = function (box) { return box ? syn.slice(box.start + box.hdr_size, box.start + box.size) : null; };

    var vt = info.videoTracks && info.videoTracks[0];
    if (vt) {
      var trak = file.getTrackById(vt.id);
      var entry = trak.mdia.minf.stbl.stsd.entries[0];
      var type = entry.type, fam = codecFamily(type), desc = null, cs = null;
      if (fam === 'avc') desc = raw(entry.avcC);
      else if (fam === 'hevc') desc = raw(entry.hvcC);
      else if (fam === 'av1') desc = raw(entry.av1C);
      if (entry.colr && entry.colr.colour_type === 'nclx') {
        cs = colorSpaceFromCodes(entry.colr.colour_primaries, entry.colr.transfer_characteristics, entry.colr.matrix_coefficients, entry.colr.full_range_flag);
      }
      if (!cs && entry.vpcC && entry.vpcC.version === 1) {
        cs = colorSpaceFromCodes(entry.vpcC.colourPrimaries, entry.vpcC.transferCharacteristics, entry.vpcC.matrixCoefficients, entry.vpcC.videoFullRangeFlag);
      }
      var mx = matrixInfo(trak);
      var samples = fragmented ? null : trak.samples;
      var fps = null, bytes = 0, dur = 0;
      if (samples && samples.length) {
        for (var i = 0; i < samples.length; i++) { bytes += samples[i].size; dur += samples[i].duration; }
        dur /= vt.timescale;
        if (dur > 0) fps = samples.length / dur;
      }
      res.video = {
        id: vt.id, codec: vt.codec, fourcc: type, family: fam, muxCodec: fam,
        width: entry.width, height: entry.height, timescale: vt.timescale,
        description: desc, colorSpace: cs, rotation: mx.rotation,
        edit: editInfo(trak, info.timescale, vt.timescale),
        samples: samples, fps: fps, bitrate: dur > 0 ? bytes * 8 / dur : null,
        key: ['mp4', type, vt.codec, entry.width + 'x' + entry.height, hex(desc), mx.key].join('|'),
        label: vt.codec + ' ' + entry.width + 'x' + entry.height,
      };
    }
    var at = info.audioTracks && info.audioTracks[0];
    if (at) {
      var trakA = file.getTrackById(at.id);
      var e2 = trakA.mdia.minf.stbl.stsd.entries[0];
      var famA = codecFamily(e2.type === 'mp4a' ? 'mp4a' : e2.type);
      var sr = (e2.getSampleRate && e2.getSampleRate()) || e2.samplerate || (at.audio && at.audio.sample_rate) || at.timescale;
      var ch = (e2.getChannelCount && e2.getChannelCount()) || e2.channel_count || (at.audio && at.audio.channel_count) || 2;
      var descA = null, codecA = at.codec;
      if (famA === 'aac') {
        var dsi = e2.esds && e2.esds.esd && findDescriptor(e2.esds.esd, 5);
        descA = dsi && dsi.data ? new Uint8Array(dsi.data) : null;
      } else if (e2.type === 'Opus' || e2.type === 'opus') {
        famA = 'opus'; codecA = 'opus';
        var d = e2.dOps;
        ch = d ? d.OutputChannelCount : ch;
        sr = 48000;
        descA = d ? opusHead(d.OutputChannelCount, d.PreSkip, d.InputSampleRate, d.OutputGain, d.ChannelMappingFamily, d) : opusHead(ch, 312, 48000, 0, 0);
      }
      res.audio = {
        id: at.id, codec: codecA, fourcc: e2.type, family: famA, muxCodec: famA,
        sampleRate: sr, numberOfChannels: ch, timescale: at.timescale, description: descA,
        edit: editInfo(trakA, info.timescale, at.timescale),
        samples: fragmented ? null : trakA.samples,
        key: ['mp4', e2.type, codecA, sr, ch, hex(descA)].join('|'),
        label: codecA + ' ' + sr + 'Hz ' + ch + 'ch',
      };
    }
    if (!res.video && !res.audio) throw new Error('MP4 has no audio or video track');
    return res;
  }

  function mp4Sample(kind, tr, s) {
    var ts = s.timescale || tr.timescale;
    return {
      kind: kind, data: s.data, key: kind === 'audio' ? true : !!s.is_sync,
      pts: s.cts / ts - tr.edit.start + tr.edit.delay,
      dts: s.dts / ts - tr.edit.start + tr.edit.delay,
      duration: s.duration / ts,
    };
  }

  // Fragmented MP4 (MediaRecorder output): stream the file through mp4box in slices.
  async function* demuxMp4Fragmented(blob, pr, ctx) {
    var lib = await loadLib('mp4box');
    var file = lib.MP4Box.createFile(false), out = [], err = null;
    var kinds = {};
    if (pr.video) kinds[pr.video.id] = 'video';
    if (pr.audio) kinds[pr.audio.id] = 'audio';
    file.onError = function (e) { err = e; };
    file.onReady = function () {
      Object.keys(kinds).forEach(function (id) { file.setExtractionOptions(+id, null, { nbSamples: 50 }); });
      file.start();
    };
    file.onSamples = function (id, user, samples) {
      var kind = kinds[id];
      if (!kind) return;
      for (var i = 0; i < samples.length; i++) out.push(mp4Sample(kind, pr[kind], samples[i]));
      file.releaseUsedSamples(id, samples[samples.length - 1].number + 1);
    };
    var pos = 0;
    while (pos < blob.size) {
      checkAbort(ctx.signal);
      var ab = await blob.slice(pos, pos + READ_CHUNK).arrayBuffer();
      ab.fileStart = pos;
      file.appendBuffer(ab);
      pos += ab.byteLength;
      ctx.bytes(ab.byteLength);
      if (err) throw new Error('MP4 parse error: ' + err);
      if (out.length) yield out.splice(0, out.length);
    }
    file.flush();
    if (out.length) yield out.splice(0, out.length);
  }

  // Regular MP4 (moov anywhere): read samples straight from the sample tables.
  async function* demuxMp4Progressive(blob, pr, ctx) {
    var list = [];
    ['video', 'audio'].forEach(function (kind) {
      var tr = pr[kind];
      if (!tr) return;
      for (var i = 0; i < tr.samples.length; i++) list.push({ kind: kind, s: tr.samples[i] });
    });
    list.sort(function (a, b) { return a.s.offset - b.s.offset; });
    var i = 0, readTotal = 0;
    while (i < list.length) {
      checkAbort(ctx.signal);
      var start = list[i].s.offset, end = start + list[i].s.size, j = i;
      while (j + 1 < list.length) {
        var n = list[j + 1].s;
        if (n.offset - end > 65536 || n.offset + n.size - start > READ_CHUNK) break;
        j++; end = Math.max(end, n.offset + n.size);
      }
      var buf = await readBytes(blob, start, end);
      if (buf.length < end - start) throw new Error('MP4 sample data is truncated');
      ctx.bytes(end - start); readTotal += end - start;
      var batch = [];
      for (var k = i; k <= j; k++) {
        var it = list[k], s = it.s, tr = pr[it.kind];
        batch.push({
          kind: it.kind, n: s.number,
          data: buf.slice(s.offset - start, s.offset - start + s.size),
          key: it.kind === 'audio' ? true : !!s.is_sync,
          pts: s.cts / tr.timescale - tr.edit.start + tr.edit.delay,
          dts: s.dts / tr.timescale - tr.edit.start + tr.edit.delay,
          duration: s.duration / tr.timescale,
        });
      }
      batch.sort(function (a, b) { return a.kind === b.kind ? a.n - b.n : 0; });
      i = j + 1;
      yield batch;
    }
    ctx.bytes(Math.max(0, blob.size - readTotal));
  }

  // ---------------------------------------------------------------- WebM probe / demux

  var E = {
    EBML: 0x1A45DFA3, Segment: 0x18538067, SeekHead: 0x114D9B74, Info: 0x1549A966, Tracks: 0x1654AE6B,
    Cluster: 0x1F43B675, Cues: 0x1C53BB6B, Tags: 0x1254C367, Chapters: 0x1043A770, Attachments: 0x1941A469,
    TimecodeScale: 0x2AD7B1, Duration: 0x4489, TrackEntry: 0xAE, TrackNumber: 0xD7, TrackType: 0x83,
    CodecID: 0x86, CodecPrivate: 0x63A2, DefaultDuration: 0x23E383, Video: 0xE0, Audio: 0xE1,
    PixelWidth: 0xB0, PixelHeight: 0xBA, SamplingFrequency: 0xB5, Channels: 0x9F, Timecode: 0xE7,
    SimpleBlock: 0xA3, BlockGroup: 0xA0, Block: 0xA1, BlockDuration: 0x9B, ReferenceBlock: 0xFB,
    Colour: 0x55B0, MatrixCoefficients: 0x55B1, Range: 0x55B9, TransferCharacteristics: 0x55BA, Primaries: 0x55BB,
  };

  function EbmlReader(blob, ctx) {
    this.blob = blob; this.ctx = ctx;
    this.buf = new Uint8Array(0); this.bufPos = 0; this.pos = 0;
  }
  EbmlReader.prototype.need = async function (n) {
    while (this.pos + n > this.bufPos + this.buf.length) {
      var end = this.bufPos + this.buf.length;
      if (this.pos > end) end = this.pos;
      if (end >= this.blob.size) return false;
      checkAbort(this.ctx.signal);
      var chunk = await readBytes(this.blob, end, end + Math.max(READ_CHUNK, n));
      this.ctx.bytes(chunk.length);
      var keepFrom = this.pos - this.bufPos;
      if (this.pos >= this.bufPos && keepFrom < this.buf.length) {
        var keep = this.buf.subarray(keepFrom);
        var m = new Uint8Array(keep.length + chunk.length);
        m.set(keep); m.set(chunk, keep.length);
        this.buf = m; this.bufPos = this.pos;
      } else {
        this.buf = chunk; this.bufPos = end;
      }
    }
    return true;
  };
  EbmlReader.prototype.seek = function (p) {
    if (p < this.bufPos) { this.buf = new Uint8Array(0); this.bufPos = p; }
    this.pos = p;
  };
  EbmlReader.prototype.peek = function (i) { return this.buf[this.pos - this.bufPos + i]; };
  EbmlReader.prototype.vint = async function (keepMarker) {
    if (!(await this.need(1))) return null;
    var b0 = this.peek(0), len = 1, mask = 0x80;
    while (len <= 8 && !(b0 & mask)) { len++; mask >>= 1; }
    if (len > 8) throw new Error('Corrupt WebM (bad EBML number)');
    if (!(await this.need(len))) return null;
    var v = keepMarker ? b0 : (b0 & (mask - 1));
    var allOnes = (b0 & (mask - 1)) === mask - 1;
    for (var i = 1; i < len; i++) { var b = this.peek(i); v = v * 256 + b; if (b !== 255) allOnes = false; }
    this.pos += len;
    return { value: v, unknown: !keepMarker && allOnes };
  };
  EbmlReader.prototype.header = async function () {
    var start = this.pos;
    var id = await this.vint(true);
    if (!id) return null;
    var size = await this.vint(false);
    if (!size) return null;
    return { id: id.value, size: size.unknown ? -1 : size.value, start: start, dataStart: this.pos };
  };
  EbmlReader.prototype.bytes = async function (n) {
    if (!(await this.need(n))) return null;
    var o = this.pos - this.bufPos;
    var out = this.buf.slice(o, o + n);
    this.pos += n;
    return out;
  };
  EbmlReader.prototype.uint = async function (n) {
    var b = await this.bytes(n);
    if (!b) return 0;
    var v = 0;
    for (var i = 0; i < b.length; i++) v = v * 256 + b[i];
    return v;
  };
  EbmlReader.prototype.float = async function (n) {
    var b = await this.bytes(n);
    if (!b) return 0;
    var dv = new DataView(b.buffer);
    return n === 4 ? dv.getFloat32(0) : n === 8 ? dv.getFloat64(0) : 0;
  };
  EbmlReader.prototype.string = async function (n) {
    var b = await this.bytes(n);
    if (!b) return '';
    var s = '';
    for (var i = 0; i < b.length && b[i]; i++) s += String.fromCharCode(b[i]);
    return s;
  };

  async function readChildren(r, end, fn) {
    while (r.pos < end) {
      var h = await r.header();
      if (!h || h.size < 0) break;
      var next = h.dataStart + h.size;
      await fn(h);
      r.seek(next);
    }
  }

  async function parseWebmHead(r) {
    var ebml = await r.header();
    if (!ebml || ebml.id !== E.EBML) throw new Error('Not a WebM file');
    r.seek(ebml.dataStart + ebml.size);
    var seg = await r.header();
    if (!seg || seg.id !== E.Segment) throw new Error('WebM has no Segment');
    var head = { timecodeScale: 1e6, duration: null, tracks: [], segEnd: seg.size < 0 ? Infinity : seg.dataStart + seg.size, firstCluster: null };
    while (r.pos < head.segEnd) {
      var h = await r.header();
      if (!h) break;
      if (h.id === E.Cluster) { head.firstCluster = h.start; r.seek(h.start); break; }
      if (h.size < 0) throw new Error('Unsupported unknown-size WebM element');
      var next = h.dataStart + h.size;
      if (h.id === E.Info) {
        await readChildren(r, next, async function (c) {
          if (c.id === E.TimecodeScale) head.timecodeScale = await r.uint(c.size);
          else if (c.id === E.Duration) head.duration = await r.float(c.size);
        });
      } else if (h.id === E.Tracks) {
        await readChildren(r, next, async function (te) {
          if (te.id !== E.TrackEntry) return;
          var t = { number: 0, type: 0, codecId: '', codecPrivate: null, defaultDuration: 0, width: 0, height: 0, sampleRate: 0, channels: 0, colour: null };
          await readChildren(r, te.dataStart + te.size, async function (c) {
            switch (c.id) {
              case E.TrackNumber: t.number = await r.uint(c.size); break;
              case E.TrackType: t.type = await r.uint(c.size); break;
              case E.CodecID: t.codecId = await r.string(c.size); break;
              case E.CodecPrivate: t.codecPrivate = await r.bytes(c.size); break;
              case E.DefaultDuration: t.defaultDuration = await r.uint(c.size); break;
              case E.Video:
                await readChildren(r, c.dataStart + c.size, async function (v) {
                  if (v.id === E.PixelWidth) t.width = await r.uint(v.size);
                  else if (v.id === E.PixelHeight) t.height = await r.uint(v.size);
                  else if (v.id === E.Colour) {
                    var col = {};
                    await readChildren(r, v.dataStart + v.size, async function (cc) {
                      if (cc.id === E.MatrixCoefficients) col.m = await r.uint(cc.size);
                      else if (cc.id === E.TransferCharacteristics) col.t = await r.uint(cc.size);
                      else if (cc.id === E.Primaries) col.p = await r.uint(cc.size);
                      else if (cc.id === E.Range) col.r = await r.uint(cc.size);
                    });
                    t.colour = col;
                  }
                });
                break;
              case E.Audio:
                await readChildren(r, c.dataStart + c.size, async function (a) {
                  if (a.id === E.SamplingFrequency) t.sampleRate = await r.float(a.size);
                  else if (a.id === E.Channels) t.channels = await r.uint(a.size);
                });
                break;
            }
          });
          head.tracks.push(t);
        });
      }
      r.seek(next);
    }
    return head;
  }

  function webCodecsVideoCodec(t) {
    var id = t.codecId;
    if (id === 'V_VP9') return 'vp09.00.10.08';
    if (id === 'V_VP8') return 'vp8';
    if (id === 'V_AV1') return 'av01.0.04M.08';
    if (id === 'V_MPEG4/ISO/AVC' && t.codecPrivate && t.codecPrivate.length > 3) {
      return 'avc1.' + hex(t.codecPrivate.subarray(1, 4));
    }
    return id.toLowerCase();
  }

  async function probeWebm(blob) {
    var r = new EbmlReader(blob, { signal: null, bytes: function () {} });
    var head = await parseWebmHead(r);
    var res = { container: 'webm', head: head, duration: head.duration ? head.duration * head.timecodeScale / 1e9 : null, video: null, audio: null };
    var vt = head.tracks.filter(function (t) { return t.type === 1; })[0];
    var at = head.tracks.filter(function (t) { return t.type === 2; })[0];
    if (vt) {
      var cs = vt.colour ? colorSpaceFromCodes(vt.colour.p, vt.colour.t, vt.colour.m, vt.colour.r === 2) : null;
      res.video = {
        number: vt.number, codec: webCodecsVideoCodec(vt), muxCodec: vt.codecId, family: codecFamily(vt.codecId),
        width: vt.width, height: vt.height, description: vt.codecPrivate, colorSpace: cs, rotation: 0,
        defaultDuration: vt.defaultDuration ? vt.defaultDuration / 1e9 : 0,
        fps: vt.defaultDuration ? 1e9 / vt.defaultDuration : null,
        key: ['webm', vt.codecId, vt.width + 'x' + vt.height, hex(vt.codecPrivate)].join('|'),
        label: vt.codecId + ' ' + vt.width + 'x' + vt.height,
      };
    }
    if (at) {
      var fam = codecFamily(at.codecId);
      var sr = Math.round(at.sampleRate || 48000), ch = at.channels || 1;
      res.audio = {
        number: at.number, codec: fam === 'opus' ? 'opus' : fam === 'vorbis' ? 'vorbis' : fam === 'aac' ? 'mp4a.40.2' : at.codecId.toLowerCase(),
        muxCodec: at.codecId, family: fam, sampleRate: sr, numberOfChannels: ch,
        description: at.codecPrivate || (fam === 'opus' ? opusHead(ch, 312, sr, 0, 0) : null),
        defaultDuration: at.defaultDuration ? at.defaultDuration / 1e9 : 0,
        key: ['webm', at.codecId, sr, ch, hex(at.codecPrivate)].join('|'),
        label: at.codecId + ' ' + sr + 'Hz ' + ch + 'ch',
      };
    }
    if (!res.video && !res.audio) throw new Error('WebM has no audio or video track');
    return res;
  }

  var LEVEL1 = [E.SeekHead, E.Info, E.Tracks, E.Cluster, E.Cues, E.Tags, E.Chapters, E.Attachments];

  async function* demuxWebm(blob, pr, ctx) {
    var r = new EbmlReader(blob, ctx);
    var head = await parseWebmHead(r);
    var tcs = head.timecodeScale / 1e9;
    var kinds = {};
    if (pr.video) kinds[pr.video.number] = 'video';
    if (pr.audio) kinds[pr.audio.number] = 'audio';
    var pending = { video: null, audio: null }, lastDelta = { video: 0, audio: 0 };
    var isOpus = pr.audio && pr.audio.family === 'opus';
    var out = [], clusterTc = 0;

    function push(kind, s) {
      var p = pending[kind];
      if (p) {
        var d = s.pts - p.pts;
        if (d > 0) lastDelta[kind] = d;
        if (kind === 'audio' && isOpus) p.duration = opusPacketDuration(p.data) || d;
        else p.duration = d > 0 ? d : (pr[kind].defaultDuration || lastDelta[kind] || 1 / 30);
        out.push(p);
      }
      pending[kind] = s;
    }
    function finishPending() {
      ['video', 'audio'].forEach(function (kind) {
        var p = pending[kind];
        if (!p) return;
        if (kind === 'audio' && isOpus) p.duration = opusPacketDuration(p.data);
        if (!p.duration) p.duration = (p.blockDuration || pr[kind].defaultDuration || lastDelta[kind] || 1 / 30);
        out.push(p);
        pending[kind] = null;
      });
    }
    function block(data, isSimple, hasRef, blockDuration) {
      var b0 = data[0], len = 1, mask = 0x80;
      while (len <= 8 && !(b0 & mask)) { len++; mask >>= 1; }
      var track = b0 & (mask - 1);
      for (var i = 1; i < len; i++) track = track * 256 + data[i];
      var kind = kinds[track];
      if (!kind) return;
      var rel = (data[len] << 24 >> 16) | data[len + 1];
      var flags = data[len + 2];
      if (flags & 0x06) throw new Error('Laced WebM blocks are not supported');
      var key = isSimple ? !!(flags & 0x80) : !hasRef;
      var t = (clusterTc + rel) * tcs;
      var s = { kind: kind, data: data.subarray(len + 3), key: kind === 'audio' ? true : key, pts: t, dts: t, duration: 0 };
      if (blockDuration) s.blockDuration = blockDuration * tcs;
      push(kind, s);
    }

    if (head.firstCluster !== null) r.seek(head.firstCluster);
    while (r.pos < head.segEnd) {
      var h = await r.header();
      if (!h) break;
      if (h.id === E.Cluster) continue; // descend (works for known and unknown sizes)
      if (h.size < 0) break;
      var next = h.dataStart + h.size;
      if (h.id === E.Timecode) {
        clusterTc = await r.uint(h.size);
      } else if (h.id === E.SimpleBlock) {
        var d = await r.bytes(h.size);
        if (!d) break; // truncated tail
        block(d, true, false, 0);
      } else if (h.id === E.BlockGroup) {
        var bdata = null, ref = false, bdur = 0;
        await readChildren(r, next, async function (c) {
          if (c.id === E.Block) bdata = await r.bytes(c.size);
          else if (c.id === E.ReferenceBlock) ref = true;
          else if (c.id === E.BlockDuration) bdur = await r.uint(c.size);
        });
        if (bdata) block(bdata, false, ref, bdur);
      } else if (LEVEL1.indexOf(h.id) < 0 && h.id !== 0xEC && h.id !== 0xBF && h.id !== 0xA7 && h.id !== 0xAB) {
        // Unknown element inside a cluster: skip it.
      }
      r.seek(next);
      if (out.length >= 48) yield out.splice(0, out.length);
    }
    finishPending();
    ctx.bytes(Math.max(0, blob.size - (r.bufPos + r.buf.length)));
    if (out.length) yield out.splice(0, out.length);
  }

  // ---------------------------------------------------------------- probing

  async function probe(blob) {
    if (!blob || !blob.size) throw new Error('Empty recording');
    var head = await readBytes(blob, 0, 16);
    if (head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3) return probeWebm(blob);
    var t = fourcc(head, 4);
    if (['ftyp', 'moov', 'free', 'mdat', 'wide', 'skip', 'styp', 'uuid'].indexOf(t) >= 0) return probeMp4(blob);
    throw new Error('Unknown file format');
  }

  function demux(blob, pr, ctx) {
    if (pr.container === 'webm') return demuxWebm(blob, pr, ctx);
    return pr.fragmented ? demuxMp4Fragmented(blob, pr, ctx) : demuxMp4Progressive(blob, pr, ctx);
  }

  function remuxBlocker(probes) {
    var p0 = probes[0];
    for (var k = 1; k < probes.length; k++) {
      var p = probes[k], n = 'Take ' + (k + 1);
      if (p.container !== p0.container) return 'Takes use different file formats (' + p0.container.toUpperCase() + ' and ' + p.container.toUpperCase() + ')';
      if (!!p.video !== !!p0.video) return n + (p.video ? ' has video but take 1 has none' : ' has no video');
      if (!!p.audio !== !!p0.audio) return n + (p.audio ? ' has sound but take 1 has none' : ' has no sound');
      if (p.video && p.video.key !== p0.video.key) return n + ' has a different video format (' + p.video.label + ' vs ' + p0.video.label + ')';
      if (p.audio && p.audio.key !== p0.audio.key) return n + ' has a different audio format (' + p.audio.label + ' vs ' + p0.audio.label + ')';
    }
    if (p0.container === 'mp4') {
      if (p0.video && ['avc', 'hevc', 'vp9', 'av1'].indexOf(p0.video.family) < 0) return 'Video codec ' + p0.video.codec + ' cannot be joined losslessly';
      if (p0.audio && ['aac', 'opus'].indexOf(p0.audio.family) < 0) return 'Audio codec ' + p0.audio.codec + ' cannot be joined losslessly';
      if (p0.video && ['avc', 'hevc'].indexOf(p0.video.family) >= 0 && !p0.video.description) return 'Missing H.264/HEVC configuration';
      if (p0.audio && p0.audio.family === 'aac' && !p0.audio.description) return 'Missing AAC configuration';
    }
    return null;
  }

  // ---------------------------------------------------------------- MP4 edit lists (post-process)

  function listBoxes(u8, start, end) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = [], p = start;
    while (p + 8 <= end) {
      var size = dv.getUint32(p), type = fourcc(u8, p + 4);
      if (size === 1) size = dv.getUint32(p + 8) * 4294967296 + dv.getUint32(p + 12);
      else if (size === 0) size = end - p;
      if (size < 8 || p + size > end) break;
      out.push({ type: type, start: p, size: size });
      p += size;
    }
    return out;
  }
  function boxBytes(type, payload) {
    var u = new Uint8Array(8 + payload.length);
    new DataView(u.buffer).setUint32(0, u.length);
    for (var i = 0; i < 4; i++) u[4 + i] = type.charCodeAt(i);
    u.set(payload, 8);
    return u;
  }
  function edtsBox(emptyUnits, segUnits, mediaTime) {
    var entries = [];
    if (emptyUnits > 0) entries.push([emptyUnits, -1]);
    entries.push([segUnits, mediaTime]);
    var v1 = entries.some(function (e) { return e[0] > 0xFFFFFFFF || e[1] > 0x7FFFFFFF; });
    var esz = v1 ? 20 : 12;
    var p = new Uint8Array(8 + entries.length * esz), dv = new DataView(p.buffer);
    p[0] = v1 ? 1 : 0;
    dv.setUint32(4, entries.length);
    entries.forEach(function (e, i) {
      var o = 8 + i * esz;
      if (v1) {
        dv.setUint32(o, Math.floor(e[0] / 4294967296)); dv.setUint32(o + 4, e[0] >>> 0);
        if (e[1] < 0) { dv.setInt32(o + 8, -1); dv.setInt32(o + 12, -1); }
        else { dv.setUint32(o + 8, Math.floor(e[1] / 4294967296)); dv.setUint32(o + 12, e[1] >>> 0); }
        dv.setUint32(o + 16, 0x00010000);
      } else {
        dv.setUint32(o, e[0]); dv.setInt32(o + 4, e[1]); dv.setUint32(o + 8, 0x00010000);
      }
    });
    return boxBytes('edts', boxBytes('elst', p));
  }
  function setDur(dv, off, isV1, value) {
    if (isV1) { dv.setUint32(off, Math.floor(value / 4294967296)); dv.setUint32(off + 4, value >>> 0); }
    else if (value <= 0xFFFFFFFF) dv.setUint32(off, value);
  }

  // edits: [{ trackId, timescale, empty (s), mediaStart (s, media timeline), segment (s) }]
  async function addEditLists(blob, edits) {
    var tops = await scanTopBoxes(blob);
    var moov = tops.filter(function (b) { return b.type === 'moov'; })[0];
    if (!moov || moov.pos + moov.size !== blob.size) return blob;
    var src = await readBytes(blob, moov.pos, moov.pos + moov.size);
    var dv = new DataView(src.buffer);
    var kids = listBoxes(src, 8, src.length);
    var mvhd = kids.filter(function (b) { return b.type === 'mvhd'; })[0];
    if (!mvhd) return blob;
    var mv1 = src[mvhd.start + 8] === 1;
    var mts = dv.getUint32(mvhd.start + (mv1 ? 28 : 20));
    var outParts = [], movieDur = 0, mvhdCopy = null;
    kids.forEach(function (c) {
      var bytes = src.slice(c.start, c.start + c.size);
      if (c.type === 'mvhd') { mvhdCopy = bytes; outParts.push(bytes); return; }
      if (c.type !== 'trak') { outParts.push(bytes); return; }
      var tk = listBoxes(src, c.start + 8, c.start + c.size);
      var tkhd = tk.filter(function (b) { return b.type === 'tkhd'; })[0];
      var tv1 = src[tkhd.start + 8] === 1;
      var id = dv.getUint32(tkhd.start + (tv1 ? 28 : 20));
      var e = edits.filter(function (x) { return x.trackId === id; })[0];
      var tkhdBytes = src.slice(tkhd.start, tkhd.start + tkhd.size);
      var tdv = new DataView(tkhdBytes.buffer);
      var total;
      var edts = null;
      if (e) {
        var emptyU = Math.round(e.empty * mts);
        var segU = Math.max(1, Math.round(e.segment * mts));
        var mt = Math.max(0, Math.round(e.mediaStart * e.timescale));
        total = emptyU + segU;
        setDur(tdv, tv1 ? 36 : 28, tv1, total);
        if (emptyU > 0 || mt > 0) edts = edtsBox(emptyU, segU, mt);
      } else {
        total = tv1 ? dv.getUint32(tkhd.start + 36) * 4294967296 + dv.getUint32(tkhd.start + 40) : dv.getUint32(tkhd.start + 28);
      }
      movieDur = Math.max(movieDur, total);
      var pieces = [tkhdBytes];
      if (edts) pieces.push(edts);
      tk.forEach(function (b) { if (b.type !== 'tkhd' && b.type !== 'edts') pieces.push(src.slice(b.start, b.start + b.size)); });
      outParts.push(boxBytes('trak', concatBytes(pieces)));
    });
    if (mvhdCopy) setDur(new DataView(mvhdCopy.buffer), mv1 ? 32 : 24, mv1, movieDur);
    var newMoov = boxBytes('moov', concatBytes(outParts));
    return new Blob([blob.slice(0, moov.pos), newMoov], { type: blob.type });
  }

  // ---------------------------------------------------------------- remux writers

  async function createMp4RemuxWriter(pr, sink) {
    var M = await loadLib('mp4muxer');
    var v = pr.video, a = pr.audio;
    var vts = v ? ((Number.isInteger(v.timescale) && v.timescale >= 1000 && v.timescale <= 1000000) ? v.timescale : 90000) : 0;
    var opts = { target: new M.StreamTarget({ onData: function (d, p) { sink.write(d, p); } }), fastStart: false, firstTimestampBehavior: 'offset' };
    var T = {};
    if (v) {
      var cs = v.colorSpace || (v.family === 'vp9' ? DEFAULT_COLOR : null);
      opts.video = { codec: v.family, width: v.width, height: v.height, rotation: v.rotation || 0, frameRate: vts };
      var vdc = { codec: v.codec, codedWidth: v.width, codedHeight: v.height };
      if (v.description) vdc.description = v.description;
      if (cs) vdc.colorSpace = cs;
      T.video = { ts: vts, meta: { decoderConfig: vdc } };
    }
    if (a) {
      opts.audio = { codec: a.family, numberOfChannels: a.numberOfChannels, sampleRate: a.sampleRate };
      var adc = { codec: a.codec, numberOfChannels: a.numberOfChannels, sampleRate: a.sampleRate };
      if (a.description) adc.description = a.description;
      T.audio = { ts: a.sampleRate, meta: { decoderConfig: adc } };
    }
    Object.keys(T).forEach(function (k) { var t = T[k]; t.D0 = undefined; t.pFirst = Infinity; t.pEnd = -Infinity; t.n = 0; });
    var muxer = new M.Muxer(opts);
    return {
      tick: function (kind) { return 1 / T[kind].ts; },
      allowNegative: true,
      video: function (s, P, D) {
        var t = T.video;
        if (t.D0 === undefined) t.D0 = D;
        var ts = (P - t.D0) * 1e6, cto = (P - D) * 1e6;
        muxer.addVideoChunkRaw(s.data, s.key ? 'key' : 'delta', ts, Math.max(0, s.duration * 1e6), t.meta, cto);
        t.meta = undefined; t.n++;
        t.pFirst = Math.min(t.pFirst, P); t.pEnd = Math.max(t.pEnd, P + s.duration);
      },
      audio: function (data, P, dur) {
        var t = T.audio;
        if (t.D0 === undefined) t.D0 = P;
        muxer.addAudioChunkRaw(data, 'key', (P - t.D0) * 1e6, Math.max(0, dur * 1e6), t.meta);
        t.meta = undefined; t.n++;
        t.pFirst = Math.min(t.pFirst, P); t.pEnd = Math.max(t.pEnd, P + dur);
        return true;
      },
      finish: async function (totalDuration) {
        muxer.finalize();
        var blob = sink.blob('video/mp4');
        var edits = [];
        var id = 1;
        ['video', 'audio'].forEach(function (k) {
          var t = T[k];
          if (!t) return;
          var trackId = id++;
          if (!t.n) return;
          var startP = Math.max(0, t.pFirst);
          var end = k === 'audio' ? Math.min(t.pEnd, Math.max(totalDuration, startP)) : t.pEnd;
          edits.push({ trackId: trackId, timescale: t.ts, empty: startP, mediaStart: startP - t.D0, segment: Math.max(0, end - startP) });
        });
        return addEditLists(blob, edits);
      },
    };
  }

  // webm-muxer stores the last block's start as Duration; store the real end instead.
  async function patchWebmDuration(sink, seconds) {
    var blob = sink.blob('video/webm');
    if (!(seconds > 0)) return blob;
    try {
      var h = await readBytes(blob, 0, Math.min(blob.size, 65536));
      for (var i = 0; i + 4 < h.length; i++) {
        if (h[i] === 0x15 && h[i + 1] === 0x49 && h[i + 2] === 0xA9 && h[i + 3] === 0x66) {
          for (var j = i + 4; j + 11 < Math.min(h.length, i + 256); j++) {
            if (h[j] === 0x44 && h[j + 1] === 0x89 && h[j + 2] === 0x88) {
              var b = new Uint8Array(8);
              new DataView(b.buffer).setFloat64(0, seconds * 1000); // TimecodeScale is 1 ms
              sink.write(b, j + 3);
              return sink.blob('video/webm');
            }
          }
          break;
        }
      }
    } catch (e) { /* keep muxer's value */ }
    return blob;
  }

  async function createWebmRemuxWriter(pr, sink) {
    var W = await loadLib('webmmuxer');
    var v = pr.video, a = pr.audio;
    var opts = { target: new W.StreamTarget({ onData: function (d, p) { sink.write(d, p); } }), type: 'webm', firstTimestampBehavior: 'permissive' };
    var vmeta = null, ameta = null;
    if (v) {
      opts.video = { codec: v.muxCodec, width: v.width, height: v.height };
      var vdc = { codec: v.codec };
      if (v.description) vdc.description = v.description;
      if (v.colorSpace) vdc.colorSpace = v.colorSpace;
      vmeta = { decoderConfig: vdc };
    }
    if (a) {
      opts.audio = { codec: a.muxCodec, numberOfChannels: a.numberOfChannels, sampleRate: a.sampleRate };
      if (a.description) ameta = { decoderConfig: { codec: a.codec, description: a.description, numberOfChannels: a.numberOfChannels, sampleRate: a.sampleRate } };
    }
    var muxer = new W.Muxer(opts);
    var lastA = -1, lastV = -1;
    var us = function (sec) { return Math.round(sec * 1000) * 1000; }; // WebM has 1 ms resolution
    return {
      tick: function () { return 0.001; },
      allowNegative: false,
      video: function (s, P) {
        var ts = Math.max(us(P), lastV);
        muxer.addVideoChunkRaw(s.data, s.key ? 'key' : 'delta', ts, vmeta || undefined);
        vmeta = null; lastV = ts;
      },
      audio: function (data, P) {
        var ts = us(Math.max(0, P));
        if (ts <= lastA) return false;
        muxer.addAudioChunkRaw(data, 'key', ts, ameta || undefined);
        ameta = null; lastA = ts;
        return true;
      },
      finish: async function (total) {
        muxer.finalize();
        return patchWebmDuration(sink, total);
      },
    };
  }

  // ---------------------------------------------------------------- lossless remux

  // Silent frames used to fill audio gaps (so audio stays continuous and in sync at every join).
  // AAC-LC: zero-spectrum raw_data_blocks (as used by hls.js); Opus: 20 ms CELT silence frame.
  function silentFrame(family, channels) {
    if (family === 'aac') {
      if (channels === 1) return new Uint8Array([0x00, 0xc8, 0x00, 0x80, 0x23, 0x80]);
      if (channels === 2) return new Uint8Array([0x21, 0x00, 0x49, 0x90, 0x02, 0x19, 0x00, 0x23, 0x80]);
      return null;
    }
    if (family === 'opus') return new Uint8Array([0xf8, 0xff, 0xfe]);
    return null;
  }

  async function remuxJoin(clips, probes, ctx, keepAll) {
    var p0 = probes[0];
    var sink = new BlobSink();
    var W = p0.container === 'mp4' ? await createMp4RemuxWriter(p0, sink) : await createWebmRemuxWriter(p0, sink);
    var O = 0, lastVDts = -Infinity, lastAPts = -Infinity;
    var stats = [];

    // Audio is laid out back-to-back (every frame decodes to a fixed number of samples, so this is
    // what any decoder actually plays); each take's audio is re-anchored to its video at the join by
    // dropping frames or inserting silent frames, keeping the error within +/- half a frame.
    var af = p0.audio ? p0.audio.family : null;
    var asr = p0.audio ? p0.audio.sampleRate : 0;
    var silent = p0.audio ? silentFrame(af, p0.audio.numberOfChannels) : null;
    var silentDur = af === 'aac' ? 1024 / asr : 0.02;
    var A = null; // global end time of the audio written so far
    var frameDur = function (s) {
      if (af === 'aac') return 1024 / asr;
      if (af === 'opus') return opusPacketDuration(s.data) || s.duration;
      return s.duration;
    };

    for (var k = 0; k < clips.length; k++) {
      checkAbort(ctx.signal);
      var pr = probes[k], hasV = !!pr.video, hasA = !!pr.audio;
      var vq = [], aq = [], base = null, clipO = O, vEnd = -Infinity, aEnd = -Infinity, vCount = 0;
      var vtick = hasV ? W.tick('video') : 0;
      var st = { video: 0, audio: 0, droppedAudio: 0, silentFrames: 0 };
      var start = function (s) {
        base = s.pts; clipO = O;
        if (s.kind === 'video') {
          var D = clipO + s.dts - base;
          if (D <= lastVDts) clipO += lastVDts - D + vtick;
        }
      };
      var emitV = function (s) {
        var P = clipO + s.pts - base, D = clipO + s.dts - base;
        W.video(s, P, D); lastVDts = D; st.video++;
      };
      var writeA = function (data, P, dur) {
        if (P <= lastAPts) return false;
        if (!W.audio(data, P, dur)) return false;
        lastAPts = P;
        return true;
      };
      var fillSilence = function (until) {
        if (!silent || A === null) return;
        while (A + silentDur / 2 < until) {
          if (writeA(silent, A, silentDur)) st.silentFrames++;
          A += silentDur;
        }
      };
      var emitA = function (s, final, L) {
        var fd = frameDur(s);
        var t = s.pts - base;
        if (final && L !== undefined && t + fd / 2 > L) { st.droppedAudio++; return; }
        var Dg = clipO + t;
        if (A === null) {
          if (!W.allowNegative && Dg + fd / 2 < 0) { st.droppedAudio++; return; }
          var P0 = W.allowNegative ? Dg : Math.max(0, Dg);
          if (writeA(s.data, P0, fd)) { st.audio++; A = P0 + fd; }
          return;
        }
        var tol = (silent ? Math.min(silentDur, fd) : fd) / 2;
        if (A - Dg > tol) { st.droppedAudio++; return; }
        if (Dg - A > tol) {
          if (silent) fillSilence(Dg);
          else A = Dg; // no silent frame for this codec: leave a timestamp gap
        }
        if (writeA(s.data, A, fd)) st.audio++; else st.droppedAudio++;
        A += fd;
      };
      var pump = function (final) {
        for (;;) {
          if (base === null) {
            if (hasV && vq.length) start(vq[0]);
            else if ((!hasV || final) && aq.length) start(aq[0]);
            else return;
          }
          var v = vq[0], a = aq[0];
          if (!v && !a) return;
          var L;
          if (final) L = clipLength();
          if (a) {
            var decidable = final || !hasV || (a.pts + a.duration < vEnd - 0.1);
            if (decidable && (!v || a.pts <= v.dts)) { aq.shift(); emitA(a, final, final ? L : undefined); continue; }
          }
          if (v) { vq.shift(); emitV(v); continue; }
          return;
        }
      };
      // A take lasts as long as its video (audio is trimmed/padded to it); keepAll = longest track.
      var clipLength = function () {
        if (!(hasV && vCount)) return aEnd - base;
        return keepAll && aEnd > vEnd ? aEnd - base : vEnd - base;
      };
      var it = demux(clips[k].blob, pr, ctx);
      for (;;) {
        var r = await it.next();
        if (r.done) break;
        var batch = r.value;
        for (var i = 0; i < batch.length; i++) {
          var s = batch[i];
          if (s.kind === 'video' && hasV) { vq.push(s); vEnd = Math.max(vEnd, s.pts + s.duration); vCount++; }
          else if (s.kind === 'audio' && hasA) { aq.push(s); aEnd = Math.max(aEnd, s.pts + s.duration); }
        }
        pump(false);
        checkAbort(ctx.signal);
      }
      pump(true);
      if (base === null) throw new Error('Take ' + (k + 1) + ' contains no media');
      var L = clipLength();
      if (hasA && hasV) fillSilence(clipO + L); // take's audio ended before its video
      st.offset = clipO; st.length = L;
      stats.push(st);
      O = clipO + L;
    }
    var out = await W.finish(O);
    ctx.info.clips = stats;
    ctx.info.duration = O;
    return out;
  }

  // ---------------------------------------------------------------- WebCodecs re-encode

  function hasWebCodecs() {
    return typeof global.VideoEncoder === 'function' && typeof global.VideoDecoder === 'function' &&
      typeof global.VideoFrame === 'function' && typeof global.EncodedVideoChunk === 'function';
  }
  function hasAudioCodecs() {
    return typeof global.AudioEncoder === 'function' && typeof global.AudioDecoder === 'function' && typeof global.AudioData === 'function';
  }

  function wcFamilyToMux(container, codec) {
    var f = codecFamily(codec);
    if (container === 'webm') return { vp9: 'V_VP9', vp8: 'V_VP8', av1: 'V_AV1', opus: 'A_OPUS' }[f];
    return { avc: 'avc', hevc: 'hevc', vp9: 'vp9', av1: 'av1', aac: 'aac', opus: 'opus' }[f];
  }

  // Codec level that fits the picture size / frame rate.
  function vp9Level(w, h, fps) {
    var size = w * h, rate = size * fps;
    var L = [[10, 36864, 829440], [11, 73728, 2764800], [20, 122880, 4608000], [21, 245760, 9216000], [30, 552960, 20736000], [31, 983040, 36864000], [40, 2228224, 83558400], [41, 2228224, 160432128], [50, 8912896, 311951360], [51, 8912896, 588251136], [52, 8912896, 1176502272], [60, 35651584, 1176502272], [61, 35651584, 2353004544], [62, 35651584, 4706009088]];
    for (var i = 0; i < L.length; i++) if (size <= L[i][1] && rate <= L[i][2]) return String(L[i][0]);
    return '62';
  }
  function avcLevel(w, h, fps) {
    var fs = Math.ceil(w / 16) * Math.ceil(h / 16), mbps = fs * fps;
    var L = [[0x1e, 1620, 40500], [0x1f, 3600, 108000], [0x20, 5120, 216000], [0x28, 8192, 245760], [0x2a, 8704, 522240], [0x32, 22080, 589824], [0x33, 36864, 983040], [0x34, 36864, 2073600], [0x3c, 139264, 4177920], [0x3d, 139264, 8355840], [0x3e, 139264, 16711680]];
    for (var i = 0; i < L.length; i++) if (fs <= L[i][1] && mbps <= L[i][2]) return (L[i][0] < 16 ? '0' : '') + L[i][0].toString(16);
    return '3e';
  }
  // Codec string for decoding (Chrome writes VP9 level "00", which WebCodecs rejects).
  function decoderCodec(v) {
    if (v.family === 'vp9') {
      var m = /^vp09\.(\d\d)\.(\d\d)\.(\d\d)/.exec(v.codec);
      return 'vp09.' + (m ? m[1] : '00') + '.' + (m && +m[2] >= 10 ? m[2] : '10') + '.' + (m ? m[3] : '08');
    }
    return v.codec;
  }

  async function pickVideoEncoder(container, first, width, height, bitrate, fps) {
    var c0 = first.video.family === 'vp9' ? null : first.video.codec;
    var vl = vp9Level(width, height, fps), al = avcLevel(width, height, fps);
    var av1 = width * height > 2228224 ? 'av01.0.12M.08' : 'av01.0.08M.08';
    var cands = container === 'mp4'
      ? [c0, 'avc1.6400' + al, 'avc1.4d00' + al, 'avc1.42e0' + al, 'vp09.00.' + vl + '.08', av1]
      : [c0, 'vp09.00.' + vl + '.08', 'vp8', av1];
    var seen = {};
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (!c || seen[c] || !wcFamilyToMux(container, c) || codecFamily(c) === 'aac' || codecFamily(c) === 'opus') continue;
      seen[c] = 1;
      var cfg = { codec: c, width: width, height: height, bitrate: Math.round(bitrate), framerate: fps, latencyMode: 'quality', bitrateMode: 'variable' };
      if (codecFamily(c) === 'avc') cfg.avc = { format: 'avc' };
      if (codecFamily(c) === 'hevc') cfg.hevc = { format: 'hevc' };
      try {
        var r = await global.VideoEncoder.isConfigSupported(cfg);
        if (r && r.supported) return { config: cfg, mux: wcFamilyToMux(container, c), family: codecFamily(c) };
      } catch (e) { /* try next */ }
    }
    throw new Error('No suitable video encoder in this browser');
  }

  async function pickAudioEncoder(container, firstAudio) {
    var ch = Math.min(2, Math.max(1, firstAudio ? firstAudio.numberOfChannels : 2));
    var sr = firstAudio ? firstAudio.sampleRate : 48000;
    var cands = container === 'mp4' ? ['mp4a.40.2', 'opus'] : ['opus'];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      var rate = c === 'opus' && [8000, 12000, 16000, 24000, 48000].indexOf(sr) < 0 ? 48000 : sr;
      var cfg = { codec: c, sampleRate: rate, numberOfChannels: ch, bitrate: c === 'opus' ? 128000 : 192000 };
      try {
        var r = await global.AudioEncoder.isConfigSupported(cfg);
        if (r && r.supported) return { config: cfg, mux: wcFamilyToMux(container, c), family: codecFamily(c) };
      } catch (e) { /* next */ }
    }
    throw new Error('No suitable audio encoder in this browser');
  }

  function Resampler(inRate, outRate, inCh, outCh) {
    this.ratio = inRate / outRate; this.inCh = inCh; this.outCh = outCh;
    this.t = 0; this.prev = new Float32Array(outCh);
  }
  Resampler.prototype.process = function (planes) {
    var n = planes[0].length, outCh = this.outCh, inCh = planes.length, mapped = [], c, i;
    for (c = 0; c < outCh; c++) {
      if (inCh === outCh) mapped.push(planes[c]);
      else if (outCh === 1) {
        var m = new Float32Array(n);
        for (var k = 0; k < inCh; k++) for (i = 0; i < n; i++) m[i] += planes[k][i] / inCh;
        mapped.push(m);
      } else mapped.push(planes[Math.min(c, inCh - 1)]);
    }
    if (Math.abs(this.ratio - 1) < 1e-9 || n === 0) return mapped;
    var r = this.ratio, count = Math.max(0, Math.floor((n - 1 - this.t) / r) + 1), out = [];
    for (c = 0; c < outCh; c++) {
      var p = mapped[c], o = new Float32Array(count), prev = this.prev[c];
      for (i = 0; i < count; i++) {
        var x = this.t + i * r, i0 = Math.floor(x), f = x - i0;
        var s0 = i0 < 0 ? prev : p[i0], s1 = (i0 + 1 < n) ? p[i0 + 1] : s0;
        o[i] = s0 + (s1 - s0) * f;
      }
      out.push(o);
      this.prev[c] = p[n - 1];
    }
    this.t = this.t + count * r - n;
    return out;
  };

  async function reencodeJoin(clips, probes, ctx) {
    if (!hasWebCodecs()) throw new Error('WebCodecs is not available');
    var first = probes.filter(function (p) { return p.video; })[0];
    if (!first) throw new Error('No video in the takes');
    var anyAudio = probes.some(function (p) { return p.audio; });
    if (anyAudio && !hasAudioCodecs()) throw new Error('WebCodecs audio is not available');
    var container = first.container;
    var width = even(first.video.width), height = even(first.video.height);
    var fps = Math.round(first.video.fps || 30) || 30;
    var size0 = clips[probes.indexOf(first)].blob.size;
    var bitrate = first.video.bitrate || (first.duration ? size0 * 8 / first.duration - 160000 : 0);
    var heuristic = width * height * fps * 0.1;
    if (!(bitrate > 0)) bitrate = heuristic;
    bitrate = Math.max(1e6, Math.min(100e6, bitrate));

    var vsel = await pickVideoEncoder(container, first, width, height, bitrate, fps);
    var firstAudio = probes.filter(function (p) { return p.audio; })[0];
    var asel = anyAudio ? await pickAudioEncoder(container, firstAudio && firstAudio.audio) : null;
    var sr = asel ? asel.config.sampleRate : 0, och = asel ? asel.config.numberOfChannels : 0;

    var sink = new BlobSink(), muxer, failure = null;
    var Lib = container === 'mp4' ? await loadLib('mp4muxer') : await loadLib('webmmuxer');
    var mopts = { target: new Lib.StreamTarget({ onData: function (d, p) { sink.write(d, p); } }), firstTimestampBehavior: container === 'mp4' ? 'offset' : 'strict' };
    if (container === 'mp4') {
      mopts.fastStart = false;
      mopts.video = { codec: vsel.mux, width: width, height: height, rotation: first.video.rotation || 0, frameRate: 90000 };
      if (asel) mopts.audio = { codec: asel.mux, numberOfChannels: och, sampleRate: sr };
    } else {
      mopts.type = 'webm';
      mopts.video = { codec: vsel.mux, width: width, height: height };
      if (asel) mopts.audio = { codec: asel.mux, numberOfChannels: och, sampleRate: sr };
    }
    muxer = new Lib.Muxer(mopts);

    // Encoders may leave chunk.duration null; the MP4 muxer needs a number.
    function addChunk(kind, chunk, meta, ts) {
      if (container === 'mp4' && !(chunk.duration >= 0)) {
        var data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        if (kind === 'video') muxer.addVideoChunkRaw(data, chunk.type, ts, 0, meta);
        else muxer.addAudioChunkRaw(data, chunk.type, ts, 0, meta);
      } else if (kind === 'video') muxer.addVideoChunk(chunk, meta, ts);
      else muxer.addAudioChunk(chunk, meta, ts);
    }
    var firstV = true, firstA = true;
    var venc = new global.VideoEncoder({
      output: function (chunk, meta) {
        try {
          if (meta && meta.decoderConfig && vsel.family === 'vp9' && !meta.decoderConfig.colorSpace) meta.decoderConfig.colorSpace = DEFAULT_COLOR;
          addChunk('video', chunk, meta, firstV ? 0 : Math.max(0, chunk.timestamp));
          firstV = false;
        } catch (e) { failure = failure || e; }
      },
      error: function (e) { failure = failure || e; },
    });
    venc.configure(vsel.config);
    var aenc = null;
    if (asel) {
      aenc = new global.AudioEncoder({
        output: function (chunk, meta) {
          try {
            if (meta && meta.decoderConfig && asel.family === 'opus' && !meta.decoderConfig.description) {
              meta.decoderConfig.description = opusHead(och, 312, sr, 0, 0);
            }
            addChunk('audio', chunk, meta, firstA ? 0 : Math.max(0, chunk.timestamp));
            firstA = false;
          } catch (e) { failure = failure || e; }
        },
        error: function (e) { failure = failure || e; },
      });
      aenc.configure(asel.config);
    }

    var canvas = null, g = null;
    function fitFrame(frame) {
      if (frame.displayWidth === width && frame.displayHeight === height) return frame;
      if (!canvas) {
        canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width: width, height: height });
        g = canvas.getContext('2d');
      }
      g.fillStyle = '#000'; g.fillRect(0, 0, width, height);
      var s = Math.min(width / frame.displayWidth, height / frame.displayHeight);
      var w = frame.displayWidth * s, h = frame.displayHeight * s;
      g.drawImage(frame, (width - w) / 2, (height - h) / 2, w, h);
      var f = new global.VideoFrame(canvas, { timestamp: frame.timestamp, duration: frame.duration || undefined });
      frame.close();
      return f;
    }

    var outPos = 0; // audio samples written
    function encodePcm(planes) {
      var n = planes[0].length;
      if (!n) return;
      var buf = new Float32Array(n * och);
      for (var c = 0; c < och; c++) buf.set(planes[c], c * n);
      var ad = new global.AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: och, timestamp: Math.round(outPos / sr * 1e6), data: buf });
      aenc.encode(ad);
      ad.close();
      outPos += n;
    }
    function silence(n) {
      while (n > 0) {
        var m = Math.min(n, sr);
        var planes = [];
        for (var c = 0; c < och; c++) planes.push(new Float32Array(m));
        encodePcm(planes);
        n -= m;
      }
    }
    async function waitQueues(cond) {
      while (!cond()) {
        if (failure) throw failure;
        checkAbort(ctx.signal);
        await sleep(2);
      }
    }

    var O = 0, lastKey = -Infinity, decoders = [];
    try {
      for (var k = 0; k < clips.length; k++) {
        checkAbort(ctx.signal);
        var pr = probes[k];
        var base = null, clipO = O, vEnd = -Infinity, aEnd = -Infinity, aLocalStart = null;
        var clipFirstFrame = true, clipAudioFirst = true, dropN = 0;
        var vdec = null, adec = null, resampler = null, pendingAudio = [];
        if (pr.video) {
          vdec = new global.VideoDecoder({
            output: function (frame) {
              try {
                var f = fitFrame(frame);
                var key = clipFirstFrame || f.timestamp - lastKey >= 2e6;
                if (key) lastKey = f.timestamp;
                clipFirstFrame = false;
                venc.encode(f, { keyFrame: key });
                f.close();
              } catch (e) { failure = failure || e; try { frame.close(); } catch (x) { /* closed */ } }
            },
            error: function (e) { failure = failure || e; },
          });
          var vcfg = { codec: decoderCodec(pr.video), codedWidth: pr.video.width, codedHeight: pr.video.height };
          if (pr.video.description && pr.video.family !== 'vp9' && pr.video.family !== 'vp8') vcfg.description = pr.video.description;
          var vs = await global.VideoDecoder.isConfigSupported(vcfg).catch(function () { return { supported: false }; });
          if (!vs.supported) throw new Error('This browser cannot decode ' + pr.video.codec);
          vdec.configure(vcfg);
          decoders.push(vdec);
        }
        if (pr.audio && aenc) {
          resampler = new Resampler(pr.audio.sampleRate, sr, pr.audio.numberOfChannels, och);
          adec = new global.AudioDecoder({
            output: function (data) {
              try {
                var n = data.numberOfFrames, planes = [];
                for (var c = 0; c < data.numberOfChannels; c++) {
                  var p = new Float32Array(n);
                  data.copyTo(p, { planeIndex: c, format: 'f32-planar' });
                  planes.push(p);
                }
                var local = data.timestamp / 1e6;
                data.close();
                var out = resampler.process(planes);
                if (clipAudioFirst) {
                  clipAudioFirst = false;
                  var target = Math.round((clipO + local - base) * sr);
                  if (outPos < target) silence(target - outPos);
                  else dropN = outPos - target;
                }
                if (dropN > 0) {
                  var d = Math.min(dropN, out[0].length);
                  out = out.map(function (q) { return q.subarray(d); });
                  dropN -= d;
                }
                encodePcm(out);
              } catch (e) { failure = failure || e; }
            },
            error: function (e) { failure = failure || e; },
          });
          var acfg = { codec: pr.audio.codec, sampleRate: pr.audio.sampleRate, numberOfChannels: pr.audio.numberOfChannels };
          if (pr.audio.description) acfg.description = pr.audio.description;
          var as = await global.AudioDecoder.isConfigSupported(acfg).catch(function () { return { supported: false }; });
          if (!as.supported) throw new Error('This browser cannot decode ' + pr.audio.codec);
          adec.configure(acfg);
          decoders.push(adec);
        }
        var feedAudio = function (s) {
          if (aLocalStart === null) aLocalStart = s.pts;
          adec.decode(new global.EncodedAudioChunk({ type: 'key', timestamp: Math.round(s.pts * 1e6), duration: Math.round(s.duration * 1e6), data: s.data }));
        };
        var it = demux(clips[k].blob, pr, ctx);
        for (;;) {
          var r = await it.next();
          if (r.done) break;
          var batch = r.value;
          for (var i = 0; i < batch.length; i++) {
            var s = batch[i];
            if (s.kind === 'video' && vdec) {
              if (base === null) { base = s.pts; while (pendingAudio.length) feedAudio(pendingAudio.shift()); }
              vEnd = Math.max(vEnd, s.pts + s.duration);
              await waitQueues(function () { return vdec.decodeQueueSize < 6 && venc.encodeQueueSize < 6; });
              vdec.decode(new global.EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round((clipO + s.pts - base) * 1e6), duration: Math.round(s.duration * 1e6), data: s.data }));
            } else if (s.kind === 'audio' && adec) {
              aEnd = Math.max(aEnd, s.pts + s.duration);
              if (base === null && vdec) { pendingAudio.push(s); continue; }
              if (base === null) base = s.pts;
              await waitQueues(function () { return adec.decodeQueueSize < 20 && aenc.encodeQueueSize < 20; });
              feedAudio(s);
            }
          }
          if (failure) throw failure;
        }
        if (base === null && pendingAudio.length) { base = pendingAudio[0].pts; while (pendingAudio.length) feedAudio(pendingAudio.shift()); }
        if (vdec) { await vdec.flush(); vdec.close(); }
        if (adec) { await adec.flush(); adec.close(); }
        decoders = [];
        if (failure) throw failure;
        if (base === null) throw new Error('Take ' + (k + 1) + ' contains no media');
        var L = vdec ? vEnd - base : aEnd - base;
        O = clipO + L;
        if (aenc && (!adec || clipAudioFirst)) {
          var endS = Math.round(O * sr);
          if (outPos < endS) silence(endS - outPos);
        }
      }
      if (aenc) {
        var endT = Math.round(O * sr);
        if (outPos < endT) silence(endT - outPos);
      }
      await venc.flush();
      if (aenc) await aenc.flush();
      if (failure) throw failure;
      muxer.finalize();
    } finally {
      decoders.forEach(function (d) { try { if (d.state !== 'closed') d.close(); } catch (e) { /* ignore */ } });
      try { if (venc.state !== 'closed') venc.close(); } catch (e) { /* ignore */ }
      try { if (aenc && aenc.state !== 'closed') aenc.close(); } catch (e) { /* ignore */ }
    }
    ctx.info.duration = O;
    ctx.info.encoder = { video: vsel.config.codec, audio: asel ? asel.config.codec : null, bitrate: Math.round(bitrate) };
    return container === 'mp4' ? sink.blob('video/mp4') : patchWebmDuration(sink, O);
  }

  // ---------------------------------------------------------------- real-time fallback

  function once(target, ok, bad) {
    return new Promise(function (resolve, reject) {
      function done(e) { target.removeEventListener(ok, done); if (bad) target.removeEventListener(bad, fail); resolve(e); }
      function fail() { target.removeEventListener(ok, done); target.removeEventListener(bad, fail); reject(new Error('Could not play a take (' + bad + ')')); }
      target.addEventListener(ok, done);
      if (bad) target.addEventListener(bad, fail);
    });
  }

  function pickRecorderMime(pref) {
    var MR = global.MediaRecorder;
    var list = [pref, 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (var i = 0; i < list.length; i++) {
      try { if (list[i] && MR.isTypeSupported(list[i])) return list[i]; } catch (e) { /* ignore */ }
    }
    return '';
  }

  async function realtimeJoin(clips, probes, ctx) {
    if (typeof document === 'undefined' || typeof global.MediaRecorder !== 'function') throw new Error('This browser cannot record a joined video');
    var canvas = document.createElement('canvas');
    if (typeof canvas.captureStream !== 'function') throw new Error('This browser cannot record a joined video (no canvas capture)');
    var video = document.createElement('video');
    video.playsInline = true; video.setAttribute('playsinline', ''); video.preload = 'auto';
    Object.assign(video.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none', zIndex: '-1' });
    document.body.appendChild(video);
    var AC = global.AudioContext || global.webkitAudioContext, actx = null, dest = null;
    var rec = null, stream = null, url = null, cleanup = [];
    try {
      if (AC) {
        actx = new AC();
        try { await actx.resume(); } catch (e) { /* ignore */ }
        var srcNode = actx.createMediaElementSource(video);
        dest = actx.createMediaStreamDestination();
        srcNode.connect(dest);
      }
      var g = canvas.getContext('2d');
      var fps = Math.round((probes && probes[0] && probes[0].video && probes[0].video.fps) || 30) || 30;
      var durations = clips.map(function (c, i) { return (probes && probes[i] && probes[i].duration) || 0; });
      var total = durations.reduce(function (a, b) { return a + b; }, 0);
      var done = 0, raf = null, started = false, chunks = [];
      var draw = function () {
        var vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return;
        g.fillStyle = '#000'; g.fillRect(0, 0, canvas.width, canvas.height);
        var s = Math.min(canvas.width / vw, canvas.height / vh), w = vw * s, h = vh * s;
        g.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      };
      var loop = function () {
        draw();
        raf = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
      };
      var stopLoop = function () {
        if (raf === null) return;
        if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(raf); else cancelAnimationFrame(raf);
        raf = null;
      };
      var mime = '';
      for (var k = 0; k < clips.length; k++) {
        checkAbort(ctx.signal);
        url = URL.createObjectURL(clips[k].blob);
        video.src = url;
        await once(video, 'loadeddata', 'error');
        if (k === 0) {
          canvas.width = even(video.videoWidth || 1280); canvas.height = even(video.videoHeight || 720);
          draw();
          stream = new MediaStream(canvas.captureStream(fps).getVideoTracks().concat(dest ? dest.stream.getAudioTracks() : []));
          mime = pickRecorderMime(clips[0].mimeType || clips[0].blob.type);
          var bps = Math.max(2e6, Math.min(60e6, canvas.width * canvas.height * fps * 0.1));
          rec = new global.MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: bps, audioBitsPerSecond: 128000 } : { videoBitsPerSecond: bps });
          rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        }
        loop();
        try { await video.play(); } catch (e) {
          video.muted = true;
          await video.play();
          ctx.info.warning = 'Autoplay with sound was blocked; the joined video may be silent';
        }
        if (!started) { rec.start(1000); started = true; } else if (rec.state === 'paused') rec.resume();
        var timer = setInterval(function () {
          var d = isFinite(video.duration) && video.duration > 0 ? video.duration : durations[k];
          var frac = d ? Math.min(1, video.currentTime / d) : 0.5;
          ctx.report(total ? (done + frac * durations[k]) / total : (k + frac) / clips.length);
        }, 250);
        cleanup.push(function () { clearInterval(timer); });
        await new Promise(function (resolve, reject) {
          var onAbort = function () { reject(abortError()); };
          if (ctx.signal) ctx.signal.addEventListener('abort', onAbort, { once: true });
          video.onended = function () { if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort); resolve(); };
          video.onerror = function () { reject(new Error('Could not play take ' + (k + 1))); };
        });
        clearInterval(timer);
        stopLoop();
        if (rec.state === 'recording') rec.pause();
        done += durations[k];
        URL.revokeObjectURL(url); url = null;
      }
      var stopped = once(rec, 'stop');
      rec.stop();
      await stopped;
      ctx.info.duration = total || null;
      return new Blob(chunks, { type: (rec.mimeType || mime || 'video/webm').split(';')[0] });
    } finally {
      cleanup.forEach(function (f) { f(); });
      try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) { /* ignore */ }
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      if (url) URL.revokeObjectURL(url);
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) { /* ignore */ }
      video.remove();
      if (actx) { try { actx.close(); } catch (e) { /* ignore */ } }
    }
  }

  // ---------------------------------------------------------------- public API

  function validClips(clips) {
    return Array.isArray(clips) && clips.length > 0 && clips.every(function (c) { return c && c.blob && typeof c.blob.size === 'number'; });
  }

  function canJoin(clips) {
    if (!validClips(clips)) return { lossless: false, reason: 'No takes selected' };
    if (clips.length === 1) return { lossless: true };
    var cont = clips.map(containerFromHint);
    var c0 = cont[0];
    if (!c0) return { lossless: false, reason: 'Unknown video format' };
    for (var i = 1; i < clips.length; i++) {
      if (cont[i] !== c0) return { lossless: false, reason: 'Takes use different formats (' + String(c0).toUpperCase() + ' and ' + String(cont[i] || 'unknown').toUpperCase() + '); they will be re-encoded' };
      var a = codecsFromMime(clips[0].mimeType || clips[0].blob.type), b = codecsFromMime(clips[i].mimeType || clips[i].blob.type);
      if (a && b && a !== b) return { lossless: false, reason: 'Takes use different codecs (' + a + ' vs ' + b + '); they will be re-encoded' };
    }
    return { lossless: true };
  }

  // Exact (async) check: parses every take's header.
  async function inspect(clips) {
    if (!validClips(clips)) return { lossless: false, reason: 'No takes selected', takes: [] };
    var probes = [];
    for (var i = 0; i < clips.length; i++) {
      try { probes.push(await probe(clips[i].blob)); } catch (e) {
        return { lossless: false, reason: 'Take ' + (i + 1) + ' could not be read: ' + e.message, takes: [] };
      }
    }
    var reason = clips.length > 1 ? remuxBlocker(probes) : null;
    var takes = probes.map(function (p) {
      return { container: p.container, duration: p.duration, video: p.video && p.video.label, audio: p.audio && p.audio.label };
    });
    return reason ? { lossless: false, reason: reason, takes: takes } : { lossless: true, takes: takes };
  }

  async function join(clips, options) {
    options = options || {};
    var signal = options.signal;
    if (!validClips(clips)) throw new TypeError('join() needs at least one clip with a blob');
    checkAbort(signal);
    var report = makeReporter(options.onProgress);
    var info = { mode: null, reason: null, container: null, duration: null, startedAt: Date.now() };
    api.lastJoinInfo = info;
    report(0, true);
    if (clips.length === 1) {
      info.mode = 'single';
      report(1, true);
      return clips[0].blob;
    }
    var totalBytes = clips.reduce(function (a, c) { return a + c.blob.size; }, 0) || 1;
    var ctx = {
      signal: signal, info: info, report: report, done: 0,
      bytes: function (n) { this.done += n; report(0.99 * this.done / totalBytes); },
    };
    var probes = null, reason = null;
    try {
      probes = [];
      for (var i = 0; i < clips.length; i++) { checkAbort(signal); probes.push(await probe(clips[i].blob)); }
    } catch (e) {
      if (isAbort(e)) throw e;
      probes = null;
      reason = 'A take could not be read (' + e.message + ')';
    }
    if (probes) reason = remuxBlocker(probes);
    if (probes && !reason) {
      try {
        info.mode = 'remux'; info.container = probes[0].container;
        var out = await remuxJoin(clips, probes, ctx);
        info.ms = Date.now() - info.startedAt;
        report(1, true);
        return out;
      } catch (e) {
        if (isAbort(e)) throw e;
        reason = 'Lossless join failed (' + (e && e.message) + ')';
        if (global.console) console.warn('[StudioExport] remux failed, re-encoding:', e);
      }
    }
    info.reason = reason;
    if (probes && hasWebCodecs()) {
      try {
        info.mode = 'webcodecs'; info.container = probes.filter(function (p) { return p.video; })[0].container;
        ctx.done = 0; report.newStage();
        var out2 = await reencodeJoin(clips, probes, ctx);
        info.ms = Date.now() - info.startedAt;
        report(1, true);
        return out2;
      } catch (e) {
        if (isAbort(e)) throw e;
        info.webcodecsError = e && e.message;
        if (global.console) console.warn('[StudioExport] WebCodecs re-encode failed, using real-time recording:', e);
      }
    }
    info.mode = 'realtime';
    report.newStage();
    var out3 = await realtimeJoin(clips, probes, ctx);
    // MediaRecorder output has no duration/index (WebM) or is fragmented (MP4): rewrap it losslessly.
    try {
      var p3 = await probe(out3);
      var ctx3 = { signal: signal, info: {}, report: function () {}, bytes: function () {} };
      out3 = await remuxJoin([{ blob: out3 }], [p3], ctx3, true);
    } catch (e) {
      if (isAbort(e)) throw e;
    }
    info.container = /webm/.test(out3.type) ? 'webm' : 'mp4';
    info.ms = Date.now() - info.startedAt;
    report(1, true);
    return out3;
  }

  function downloadOne(file) {
    var url = URL.createObjectURL(file);
    var a = document.createElement('a');
    a.href = url;
    a.download = file.name || ('video.' + extensionFor(file.type));
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
    return sleep(700); // space downloads so the browser does not drop them
  }

  async function share(files, options) {
    options = options || {};
    var list = Array.prototype.slice.call(files || []).filter(Boolean);
    if (!list.length) throw new TypeError('share() needs at least one file');
    var nav = global.navigator;
    if (nav && typeof nav.share === 'function' && typeof nav.canShare === 'function') {
      var data = { files: list };
      if (options.title) data.title = options.title;
      var ok = false;
      try { ok = nav.canShare(data); } catch (e) { ok = false; }
      if (ok) {
        try {
          await nav.share(data);
          return 'shared';
        } catch (e) {
          if (isAbort(e)) throw e; // user closed the share sheet
          if (global.console) console.warn('[StudioExport] share failed, downloading instead:', e);
        }
      }
    }
    for (var i = 0; i < list.length; i++) await downloadOne(list[i]);
    return 'downloaded';
  }

  var SPECIAL = { 'ł': 'l', 'Ł': 'L', 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D', 'þ': 'th', 'Þ': 'Th', 'œ': 'oe', 'Œ': 'OE', 'ı': 'i' };
  function slug(s, max) {
    s = String(s == null ? '' : s);
    s = s.replace(/[łŁßæÆøØđĐþÞœŒı]/g, function (c) { return SPECIAL[c]; });
    try { s = s.normalize('NFKD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* old engines */ }
    s = s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (s.length > max) s = s.slice(0, max).replace(/-+$/, '');
    return s;
  }
  function filename(projectName, sceneNumber, sceneName, takeNumber, ext) {
    var parts = [slug(projectName, 40) || 'Studio'];
    var sn = parseInt(sceneNumber, 10);
    if (isFinite(sn) && sn >= 0) parts.push('S' + (sn < 10 ? '0' : '') + sn);
    var nm = slug(sceneName, 48);
    if (nm) parts.push(nm);
    var tn = parseInt(takeNumber, 10);
    if (isFinite(tn) && tn >= 0) parts.push('T' + tn);
    var e = String(ext == null || ext === '' ? 'mp4' : ext).toLowerCase();
    if (e.indexOf('/') >= 0) e = extensionFor(e);
    e = e.replace(/^\.+/, '').replace(/[^a-z0-9]/g, '') || 'mp4';
    return parts.join('_') + '.' + e;
  }

  var api = {
    version: VERSION,
    canJoin: canJoin,
    join: join,
    share: share,
    filename: filename,
    inspect: inspect,
    extensionFor: extensionFor,
    lastJoinInfo: null,
  };
  global.StudioExport = api;
})(typeof window !== 'undefined' ? window : this);
