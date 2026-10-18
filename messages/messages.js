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
  function row(d) {
    var last = d.last ? ((d.last.onBehalfOf ? 'AI for ' + d.last.onBehalfOf : d.last.user) + ': ' + d.last.text) : 'Say hello';
    return '<a class="dm-row" href="/group/?room=' + encodeURIComponent(d.id) + '" data-dm="' + esc(d.id) + '">' + avatar(d) +
      '<span class="dm-main"><span class="dm-name">' + esc(d.name) + '</span><br><span class="dm-last">' + esc(last) + '</span></span>' +
      (d.last ? '<span class="dm-time">' + esc(when(d.last.createdAt)) + '</span>' : '') +
      (d.unread ? '<span class="dm-badge" aria-label="' + d.unread + ' unread">' + d.unread + '</span>' : '') + '</a>';
  }
  function load() {
    S.api('/.netlify/functions/group?dms=1').then(function (data) {
      var dms = data.dms || [];
      var talked = dms.filter(function (d) { return d.last; });
      var others = dms.filter(function (d) { return !d.last; });
      $('talked').innerHTML = talked.length ? talked.map(row).join('') : '<p class="dm-empty">No conversations yet. Pick someone below.</p>';
      $('others').innerHTML = others.length ? others.map(row).join('') : '<p class="dm-empty">You are already talking with everyone.</p>';
    }).catch(function (e) { $('talked').innerHTML = '<p class="dm-empty">' + esc(e.message) + '</p>'; });
  }
  S.whenSignedIn(function () {
    load();
    setInterval(function () { if (document.visibilityState === 'visible') load(); }, 8000);
  });
})();
