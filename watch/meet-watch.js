// "Watch together" inside a Chowaniec Meet call: a synced YouTube player (see watch.js) for everyone in the meeting,
// in a side panel on desktop and a bottom sheet on phones, while the video tiles stay visible.
// The party id comes from the meeting code (one party per meeting). Opening it tells the others in the call through a
// Daily app message, and they get a small "… is watching together · Open" banner.
// Used by meet/index.html: toggleWatchTogether(), watchAttach(callFrame), watchOnAppMessage(msg, fromId).
(function () {
  'use strict';
  if (window.toggleWatchTogether) return;

  let panel = null;
  let ctl = null;
  let frame = null;
  let opening = false;
  let bannerTimer = null;

  const meetingCode = () => { try { return currentMeetingCode; } catch (e) { return ''; } };   // eslint-disable-line no-undef
  const myName = () => { const u = window.getChowaniecUser ? window.getChowaniecUser() : null; return (u && u.name) || ''; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TV = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 2-5 5-5-5"/><rect width="20" height="15" x="2" y="7" rx="2"/></svg>';
  const X = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  function isOpen() { return !!panel && !panel.hidden; }

  function setButton(on) {
    const b = document.getElementById('btn-watch');
    if (!b) return;
    b.classList.toggle('bg-rose-600', on);
    b.classList.toggle('hover:bg-rose-500', on);
    b.classList.toggle('bg-[#3c4043]', !on);
    b.setAttribute('aria-pressed', String(on));
  }

  // Keeps the bottom sheet above the call controls on phones, and the tiles above the sheet.
  function layout() {
    if (!panel) return;
    const footer = document.querySelector('footer');
    document.documentElement.style.setProperty('--cw-meet-footer', `${footer ? footer.offsetHeight : 0}px`);
  }

  async function open() {
    const code = meetingCode();
    if (!code || !frame) { if (window.toast) window.toast('Join the meeting first, then watch together.'); return; }
    if (opening) return;
    opening = true;
    try {
      if (!panel) {
        panel = document.createElement('aside');
        panel.id = 'watch-panel';
        panel.className = 'cw-meet-panel';
        panel.setAttribute('aria-label', 'Watch together');
        (document.querySelector('main') || document.body).appendChild(panel);
      }
      panel.hidden = false;
      document.body.classList.add('watch-open');
      layout();
      setButton(true);
      hideBanner();
      if (!ctl) {
        panel.innerHTML = '<div class="cw cw-embedded cw-meet-loading"><div class="cw-spin"><i></i></div></div>';
        const party = await window.ChowWatch.meetParty(code);
        if (!isOpen()) return;
        ctl = window.ChowWatch.mountParty(panel, { id: party.id, embedded: true, title: 'Watch together', onClose: close });
        try { frame.sendAppMessage({ type: 'WATCH_PARTY', by: myName() }, '*'); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      if (window.toast) window.toast(e.message || 'Couldn’t open Watch together.');
      close();
    } finally {
      opening = false;
    }
  }

  function close() {
    if (ctl) { ctl.destroy(); ctl = null; }
    if (panel) { panel.hidden = true; panel.innerHTML = ''; }
    document.body.classList.remove('watch-open');
    setButton(false);
  }

  window.toggleWatchTogether = function () { if (isOpen()) close(); else open(); };
  window.watchClose = function () { close(); hideBanner(); };

  function hideBanner() {
    const b = document.getElementById('cw-meet-banner');
    if (b) b.remove();
    clearTimeout(bannerTimer);
  }
  function showBanner(by) {
    if (isOpen()) return;
    hideBanner();
    const b = document.createElement('div');
    b.id = 'cw-meet-banner';
    b.className = 'cw-meet-banner';
    b.setAttribute('role', 'status');
    b.innerHTML = `<span class="cw-meet-banner-ic">${TV}</span><span class="cw-meet-banner-text"><strong>${esc(by || 'Someone')} is watching together</strong><small>Join the watch party in this call</small></span><button type="button" class="cw-meet-open">Open</button><button type="button" class="cw-meet-x" aria-label="Dismiss">${X}</button>`;
    b.querySelector('.cw-meet-open').addEventListener('click', () => { hideBanner(); open(); });
    b.querySelector('.cw-meet-x').addEventListener('click', hideBanner);
    document.body.appendChild(b);
    bannerTimer = setTimeout(hideBanner, 20000);
  }

  // Returns true when the message was for Watch together.
  window.watchOnAppMessage = function (msg) {
    if (!msg || msg.type !== 'WATCH_PARTY') return false;
    showBanner(String(msg.by || '').slice(0, 40));
    return true;
  };

  window.watchAttach = function (callFrame) {
    frame = callFrame;
    if (!frame || !frame.on) return;
    // Newcomers hear about a party that is already open here.
    frame.on('participant-joined', (evt) => {
      const sid = evt && evt.participant && evt.participant.session_id;
      if (isOpen() && sid) { try { frame.sendAppMessage({ type: 'WATCH_PARTY', by: myName() }, sid); } catch (e) { /* ignore */ } }
    });
    frame.on('left-meeting', () => { close(); hideBanner(); });
  };

  window.addEventListener('resize', layout);
})();
