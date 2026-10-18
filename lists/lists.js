// The Lists page: shared lists the family ticks off together.
(function () {
  'use strict';
  var S = window.ChowaniecSettings;
  var $ = S.$;
  var API = '/.netlify/functions/lists';
  var lists = [];
  var rooms = [];
  var openId = new URLSearchParams(location.search).get('id');
  var poll = null;

  function roomName(id) { var r = rooms.find(function (x) { return x.id === id; }); return r ? r.name : 'a chat'; }

  function render() {
    var box = $('lists');
    box.removeAttribute('aria-busy');
    box.innerHTML = '';
    if (!lists.length) {
      var empty = document.createElement('section');
      empty.className = 'card';
      empty.innerHTML = '<p>No lists yet. Tap <b>New list</b>, or ask the AI: \u201cadd milk and eggs to the groceries list\u201d.</p>';
      box.appendChild(empty);
      return;
    }
    lists.forEach(function (l) {
      var card = document.createElement('section');
      card.className = 'card';
      card.id = 'list-' + l.id;
      card.style.marginBottom = '16px';
      card.setAttribute('aria-label', l.title);
      var done = l.items.filter(function (i) { return i.done; }).length;
      var head = document.createElement('div');
      head.className = 'head';
      var h = document.createElement('h3'); h.textContent = l.title;
      var count = document.createElement('span'); count.className = 's'; count.style.color = 'var(--muted)'; count.textContent = done + '/' + l.items.length;
      head.append(h, count);
      var menu = document.createElement('button'); menu.type = 'button'; menu.className = 'xbtn'; menu.textContent = '\u22EF'; menu.setAttribute('aria-label', 'List options for ' + l.title);
      menu.addEventListener('click', function () { options(l); });
      head.appendChild(menu);
      card.appendChild(head);
      var sub = document.createElement('div'); sub.className = 's'; sub.style.cssText = 'font-size:12px;color:var(--muted)'; sub.textContent = 'Shared with ' + roomName(l.room);
      card.appendChild(sub);
      var meter = document.createElement('div'); meter.className = 'meter'; meter.setAttribute('role', 'progressbar'); meter.setAttribute('aria-label', 'Ticked off');
      meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', String(l.items.length)); meter.setAttribute('aria-valuenow', String(done));
      meter.innerHTML = '<i style="width:' + (l.items.length ? Math.round(done / l.items.length * 100) : 0) + '%"></i>';
      card.appendChild(meter);
      l.items.forEach(function (it) {
        var row = document.createElement('div');
        row.className = 'item' + (it.done ? ' done' : '');
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = it.done; cb.id = 'it-' + it.id;
        cb.addEventListener('change', function () { act({ action: 'toggle', id: l.id, item: it.id, done: cb.checked }); if (window.ChowaniecHaptics) window.ChowaniecHaptics.tap('light'); });
        var lab = document.createElement('label'); lab.className = 'txt'; lab.htmlFor = cb.id; lab.textContent = it.text;
        var by = document.createElement('span'); by.className = 'by'; by.textContent = it.done && it.doneBy ? it.doneBy : it.addedBy;
        var x = document.createElement('button'); x.type = 'button'; x.className = 'xbtn'; x.textContent = '\u00d7'; x.setAttribute('aria-label', 'Remove ' + it.text);
        x.addEventListener('click', function () { act({ action: 'remove', id: l.id, items: [it.id] }); });
        row.append(cb, lab, by, x);
        card.appendChild(row);
      });
      var form = document.createElement('form'); form.className = 'addrow';
      var inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 120; inp.autocomplete = 'off'; inp.setAttribute('aria-label', 'Add an item to ' + l.title);
      var add = document.createElement('button'); add.type = 'submit'; add.className = 'btn solid'; add.textContent = 'Add';
      form.append(inp, add);
      form.addEventListener('submit', function (e) { e.preventDefault(); var v = inp.value.trim(); if (!v) return; inp.value = ''; act({ action: 'add', id: l.id, items: v.split(/\n|,(?=\s*\S)/).map(function (x) { return x.trim(); }).filter(Boolean) }).then(function () { var again = $('list-' + l.id); if (again) again.querySelector('input[type=text]').focus(); }); });
      card.appendChild(form);
      box.appendChild(card);
    });
    if (openId) { var el = $('list-' + openId); if (el) el.scrollIntoView({ block: 'start' }); openId = null; }
  }

  function options(l) {
    var ticked = l.items.some(function (i) { return i.done; });
    var dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-label', 'Options for ' + l.title);
    dlg.style.cssText = 'position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center;padding:12px';
    var sheet = document.createElement('div');
    sheet.className = 'card'; sheet.style.cssText = 'width:min(480px,100%);display:grid;gap:8px';
    function btn(text, cls, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + (cls || ''); b.textContent = text; b.addEventListener('click', function () { dlg.remove(); fn && fn(); }); sheet.appendChild(b); return b; }
    if (ticked) btn('Clear ticked items', '', function () { act({ action: 'clear', id: l.id }); });
    btn('Delete list', 'danger', function () { S.api(API + '?id=' + l.id, { method: 'DELETE' }).then(load).catch(function (e) { S.toast(e.message, true); }); });
    btn('Close', '');
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.remove(); });
    dlg.appendChild(sheet);
    document.body.appendChild(dlg);
    sheet.querySelector('button').focus();
  }

  function act(body) {
    return S.api(API, { method: 'POST', body: body }).then(function (d) {
      lists = lists.map(function (l) { return l.id === d.list.id ? d.list : l; });
      render();
      var done = d.list.items.length && d.list.items.every(function (i) { return i.done; });
      if (done && body.action === 'toggle' && window.ChowaniecPolish) window.ChowaniecPolish.celebrate('list');
    }).catch(function (e) { S.toast(e.message, true); load(); });
  }

  function load() {
    return S.api(API).then(function (d) { lists = d.lists; render(); }).catch(function (e) { $('lists').innerHTML = ''; S.toast(e.message, true); });
  }

  function start() {
    S.api('/.netlify/functions/group?rooms=1').then(function (d) {
      rooms = d.rooms || [];
      var sel = $('new-room');
      rooms.forEach(function (r) { var o = document.createElement('option'); o.value = r.id; o.textContent = r.name; sel.appendChild(o); });
      var pref = rooms.find(function (r) { return r.id === 'no-emilia'; });
      if (pref) sel.value = 'no-emilia';
      render();
    }).catch(function () {});
    load();
    $('btn-new').addEventListener('click', function () { $('new-card').classList.remove('hidden'); $('new-title').focus(); });
    $('new-cancel').addEventListener('click', function () { $('new-card').classList.add('hidden'); });
    $('new-create').addEventListener('click', function () {
      S.api(API, { method: 'POST', body: { action: 'create', title: $('new-title').value, room: $('new-room').value } }).then(function (d) {
        $('new-title').value = ''; $('new-msg').textContent = ''; $('new-card').classList.add('hidden');
        lists.unshift(d.list); openId = d.list.id; render();
      }).catch(function (e) { $('new-msg').textContent = e.message; });
    });
    // Pick up changes from other people (and the AI) every so often.
    poll = setInterval(function () { if (!document.hidden && !document.activeElement.matches('input[type=text]')) load(); }, 20000);
  }
  S.whenSignedIn(start);
})();
