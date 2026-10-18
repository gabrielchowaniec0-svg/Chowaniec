// Messages: your direct message conversations (with family members and the AI).
(function () {
  'use strict';
  var S = window.ChowaniecSettings, $ = S.$, esc = S.esc;
  var COLORS = ['#e11d48', '#2563eb', '#0d9488', '#d97706', '#7c3aed', '#db2777', '#475569'];
  function colorFor(name) { var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; }
  function avatar(d) {
    if (d.ai) return '<span class="dm-av ai">' + (window.ChowaniecRobot ? window.ChowaniecRobot.face() : 'AI') + '</span>';
    return '<span class="dm-av" style="background:' + colorFor(d.name) + '">' + esc(d.name.charAt(0).toUpperCase()) + '</span>';
  }
  function when(iso) {
    var d = new Date(iso), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  var PIN_KEY = 'chowaniec_dm_pins';
  function pins() { try { return JSON.parse(localStorage.getItem(PIN_KEY) || '[]'); } catch (e) { return []; } }
  function savePins(list) { try { localStorage.setItem(PIN_KEY, JSON.stringify(list)); } catch (e) { /* storage unavailable */ } }
  function hap(k) { if (window.ChowaniecHaptics) window.ChowaniecHaptics.tap(k); }
  var byId = {};
  var busy = false;      // a row is being swiped or opened: don't redraw under the finger
  var ACTS_W = 216;

  function row(d) {
    byId[d.id] = d;
    var last = d.last ? ((d.last.onBehalfOf ? 'AI for ' + d.last.onBehalfOf : d.last.user) + ': ' + d.last.text) : 'Say hello';
    var pinned = pins().indexOf(d.id) >= 0;
    var muted = !!d.mutedUntil;
    return '<div class="dm-swipe" data-sw="' + esc(d.id) + '">' +
      '<div class="dm-acts">' +
        '<button type="button" class="a-pin" data-act="pin">' + (pinned ? 'Unpin' : 'Pin') + '</button>' +
        '<button type="button" class="a-mute" data-act="mute">' + (muted ? 'Unmute' : 'Mute') + '</button>' +
        '<button type="button" class="a-read" data-act="read">Mark read</button>' +
      '</div>' +
      '<a class="dm-row" href="/group/?room=' + encodeURIComponent(d.id) + '" data-dm="' + esc(d.id) + '">' + avatar(d) +
      '<span class="dm-main"><span class="dm-name">' + esc(d.name) + (pinned ? '<span class="dm-pin" title="Pinned">&#128204;</span>' : '') + (muted ? '<span class="dm-mutedi" title="Muted">&#128277;</span>' : '') + '</span><br><span class="dm-last">' + esc(last) + '</span></span>' +
      (d.last ? '<span class="dm-time">' + esc(when(d.last.createdAt)) + '</span>' : '') +
      (d.unread ? '<span class="dm-badge" aria-label="' + d.unread + ' unread">' + d.unread + '</span>' : '') +
      '<button type="button" class="dm-more" data-more="1" aria-label="Pin, mute or mark read">&#8942;</button></a></div>';
  }

  function sortTalked(list) {
    var p = pins();
    return list.slice().sort(function (a, b) {
      var pa = p.indexOf(a.id) >= 0 ? 1 : 0, pb = p.indexOf(b.id) >= 0 ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return a.last.createdAt < b.last.createdAt ? 1 : -1;
    });
  }

  var lastDms = [];
  function draw() {
    var talked = sortTalked(lastDms.filter(function (d) { return d.last; }));
    var others = lastDms.filter(function (d) { return !d.last; });
    $('talked').innerHTML = talked.length ? talked.map(row).join('') : '<p class="dm-empty">No conversations yet. Pick someone below.</p>';
    $('others').innerHTML = others.length ? others.map(row).join('') : '<p class="dm-empty">You are already talking with everyone.</p>';
  }
  function load() {
    if (busy) return;
    S.api('/.netlify/functions/group?dms=1').then(function (data) {
      if (busy) return;
      lastDms = data.dms || [];
      draw();
    }).catch(function (e) { $('talked').innerHTML = '<p class="dm-empty">' + esc(e.message) + '</p>'; });
  }

  // ---- swipe a row left to show Pin / Mute / Mark read (the three-dots button does the same)
  var openRow = null;
  function setX(sw, x, animate) {
    var r = sw.querySelector('.dm-row');
    sw.classList.toggle('dragging', !animate);
    r.style.transform = x ? 'translateX(' + x + 'px)' : '';
  }
  function closeRow() {
    if (openRow) { setX(openRow, 0, true); openRow = null; }
    busy = false;
  }
  function openIt(sw) {
    if (openRow && openRow !== sw) closeRow();
    openRow = sw; busy = true;
    setX(sw, -ACTS_W, true);
    hap('light');
  }
  var drag = null;
  document.addEventListener('pointerdown', function (e) {
    var sw = e.target.closest && e.target.closest('.dm-swipe');
    if (!sw || e.target.closest('.dm-acts') || e.target.closest('[data-more]')) { if (!(e.target.closest && e.target.closest('.dm-acts'))) closeRow(); return; }
    if (openRow && openRow !== sw) closeRow();
    drag = { sw: sw, x: e.clientX, y: e.clientY, base: openRow === sw ? -ACTS_W : 0, mode: null, dx: 0 };
  });
  document.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.mode) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      drag.mode = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'swipe' : 'scroll';
      if (drag.mode === 'swipe') busy = true;
    }
    if (drag.mode !== 'swipe') return;
    var x = Math.max(-ACTS_W - 24, Math.min(0, drag.base + dx));
    drag.dx = dx;
    setX(drag.sw, x, false);
  });
  function endDrag(e, cancelled) {
    if (!drag) return;
    var d = drag; drag = null;
    if (d.mode !== 'swipe') return;
    var x = d.base + d.dx;
    if (!cancelled && x < -ACTS_W / 2) openIt(d.sw); else { if (openRow === d.sw) openRow = null; setX(d.sw, 0, true); busy = !!openRow; }
    d.sw.dataset.swiped = '1';
    setTimeout(function () { delete d.sw.dataset.swiped; }, 350);
  }
  document.addEventListener('pointerup', function (e) { endDrag(e, false); });
  document.addEventListener('pointercancel', function (e) { endDrag(e, true); });

  document.addEventListener('click', function (e) {
    var more = e.target.closest && e.target.closest('[data-more]');
    if (more) {
      e.preventDefault();
      var sw = more.closest('.dm-swipe');
      if (openRow === sw) closeRow(); else openIt(sw);
      return;
    }
    var sw2 = e.target.closest && e.target.closest('.dm-swipe');
    if (sw2 && sw2.dataset.swiped) { e.preventDefault(); return; }       // a swipe, not a tap
    if (sw2 && openRow === sw2 && !e.target.closest('.dm-acts')) { e.preventDefault(); closeRow(); return; }
    var btn = e.target.closest && e.target.closest('.dm-acts button');
    if (btn) { e.preventDefault(); act(btn.closest('.dm-swipe').dataset.sw, btn.dataset.act, btn); return; }
    if (openRow) closeRow();
  }, true);

  function act(id, what, btn) {
    var d = byId[id];
    if (!d) return;
    if (what === 'pin') {
      var p = pins(), i = p.indexOf(id);
      if (i >= 0) p.splice(i, 1); else p.push(id);
      savePins(p); hap('light'); closeRow(); draw();
    } else if (what === 'read') {
      if (!d.last || !d.last.id) { S.toast('Nothing to mark.'); closeRow(); return; }
      S.api('/.netlify/functions/group', { method: 'POST', body: { action: 'read', id: d.last.id, room: id } })
        .then(function () { d.unread = 0; hap('success'); closeRow(); draw(); })
        .catch(function (err) { S.toast(err.message, true); });
    } else if (what === 'mute') {
      if (d.mutedUntil) {
        post_mute(id, 'off', d);
        return;
      }
      var acts = btn.closest('.dm-acts');
      acts.innerHTML = '<button type="button" class="a-mute" data-mute="1h">1 hour</button><button type="button" class="a-mute" data-mute="8h">8 hours</button><button type="button" class="a-mute" data-mute="week">1 week</button>';
      acts.onclick = function (ev) {
        var b = ev.target.closest('[data-mute]');
        if (b) { ev.preventDefault(); ev.stopPropagation(); post_mute(id, b.dataset.mute, d); }
      };
    }
  }
  function post_mute(id, duration, d) {
    S.api('/.netlify/functions/group', { method: 'POST', body: { action: 'mute', room: id, duration: duration } })
      .then(function (data) {
        var until = (data.mutes || {})[id];
        if (until) d.mutedUntil = until; else delete d.mutedUntil;
        hap('light'); closeRow(); draw();
        S.toast(until ? 'Muted' : 'Unmuted');
      }).catch(function (err) { S.toast(err.message, true); });
  }
  S.whenSignedIn(function () {
    load();
    setInterval(function () { if (document.visibilityState === 'visible') load(); }, 8000);
  });
})();
