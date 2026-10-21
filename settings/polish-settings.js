// Settings: colour, text size, vibration, AI voice (all on this device) and the birthdays editor (heads only).
(function () {
  'use strict';
  var S = window.ChowaniecSettings;
  var $ = function (id) { return document.getElementById(id); };
  var get = function (k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  var set = function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

  function appearance() {
    function paint() {
      var size = get('chowaniec_textsize', 'normal');
      $('size-seg').querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.size === size)); });
    }
    $('size-seg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-size]');
      if (!b) return;
      set('chowaniec_textsize', b.dataset.size);
      if (window.ChowaniecPolish) window.ChowaniecPolish.applyAppearance();
      paint();
    });
    $('sw-haptics').checked = get('chowaniec_haptics', 'on') !== 'off';
    $('sw-haptics').addEventListener('change', function (e) {
      set('chowaniec_haptics', e.target.checked ? 'on' : 'off');
      if (e.target.checked && window.ChowaniecHaptics) window.ChowaniecHaptics.tap('medium');
    });
    $('sw-voice').checked = get('chowaniec_ai_voice', 'off') === 'on';
    $('sw-voice').addEventListener('change', function (e) { set('chowaniec_ai_voice', e.target.checked ? 'on' : 'off'); });
    paint();
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var list = [];
  function saveBirthdays() {
    return S.api('/.netlify/functions/birthdays', { method: 'POST', body: { birthdays: list } }).then(function (d) {
      list = d.birthdays;
      try { sessionStorage.removeItem('chowaniec_birthdays'); } catch (e) { /* ignore */ }
      paintBirthdays();
    });
  }
  function paintBirthdays() {
    var box = $('bday-list');
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div class="s" style="padding:6px 0">No birthdays yet.</div>'; return; }
    list.slice().sort(function (a, b) { return a.month - b.month || a.day - b.day; }).forEach(function (b) {
      var row = document.createElement('div');
      row.className = 'row';
      var t = document.createElement('div');
      t.className = 'grow';
      t.innerHTML = '<div class="t"></div><div class="s"></div>';
      t.firstChild.textContent = b.name;
      t.lastChild.textContent = MONTHS[b.month - 1] + ' ' + b.day + (b.year ? ', ' + b.year : '');
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn danger';
      del.textContent = 'Remove';
      del.setAttribute('aria-label', 'Remove ' + b.name + '’s birthday');
      del.addEventListener('click', function () { list = list.filter(function (x) { return x !== b && !(x.name === b.name && x.month === b.month && x.day === b.day); }); saveBirthdays().catch(function (e) { S.toast(e.message, true); }); });
      row.append(t, del);
      box.appendChild(row);
    });
  }
  function birthdays() {
    var user = S.user();
    if (!user || !user.host) return;
    $('bday-card').classList.remove('hidden');
    var sel = $('bday-month');
    MONTHS.forEach(function (m, i) { var o = document.createElement('option'); o.value = String(i + 1); o.textContent = m; sel.appendChild(o); });
    S.api('/.netlify/functions/birthdays').then(function (d) { list = d.birthdays; paintBirthdays(); }).catch(function () {});
    $('bday-add').addEventListener('click', function () {
      var name = $('bday-name').value.trim();
      var day = Number($('bday-day').value);
      var year = Number($('bday-year').value);
      var msg = $('bday-msg');
      if (!name || !day) { msg.textContent = 'Add a name, a month and a day.'; return; }
      list = list.concat([Object.assign({ name: name, month: Number(sel.value), day: day }, year ? { year: year } : {})]);
      msg.textContent = '';
      saveBirthdays().then(function () {
        $('bday-name').value = ''; $('bday-day').value = ''; $('bday-year').value = '';
        msg.textContent = 'Saved.';
      }).catch(function (e) { msg.textContent = e.message; });
    });
  }

  function init() { appearance(); var tries = 0; var t = setInterval(function () { if (S.user() || ++tries > 40) { clearInterval(t); birthdays(); } }, 150); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
