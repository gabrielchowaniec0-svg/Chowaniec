// Quick jump: press Ctrl/Cmd-K (or "/" when you're not typing) on any page, or choose "Search & jump" from Bob,
// then type to jump to a page, a note, a chat message, an event or a meeting. Window.ChowaniecQuickJump.open().
(function () {
  'use strict';
  const PAGES = [
    { title: 'Group chat', url: '/group/', words: 'chat family messages' },
    { title: 'Messages (private)', url: '/messages/', words: 'direct dm private' },
    { title: 'Chowaniec AI', url: '/ai/', words: 'assistant ask bob robot' },
    { title: 'Meet', url: '/meet/', words: 'video call meeting' },
    { title: 'Notes', url: '/notes/', words: 'notebook write' },
    { title: 'Calendar', url: '/calendar/', words: 'events plans birthdays' },
    { title: 'Lists', url: '/lists/', words: 'groceries packing costumes shared list' },
    { title: 'Games', url: '/games/', words: 'play dino driving racing snake 2048 word puzzle arcade high score' },
    { title: 'Search everything', url: '/search/', words: 'find' },
    { title: 'Settings', url: '/settings/', words: 'preferences colour theme text size notifications' },
    { title: 'Home', url: '/', words: 'start directory' }
  ];
  let root = null, input = null, listEl = null, items = [], active = 0, timer = null, seq = 0;
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const user = () => (window.getChowaniecUser ? window.getChowaniecUser() : null);

  function build() {
    const style = document.createElement('style');
    style.textContent = `
#qj { position: fixed; inset: 0; z-index: 2147483200; display: none; align-items: flex-start; justify-content: center; padding: calc(env(safe-area-inset-top,0px) + 10vh) 12px 12px; background: rgba(0,0,0,.45); backdrop-filter: blur(3px); font-family: system-ui, sans-serif; }
#qj.open { display: flex; }
#qj .qj-box { width: min(560px, 100%); max-height: 78vh; display: flex; flex-direction: column; background: #fff; color: #111827; border-radius: 18px; box-shadow: 0 20px 60px rgba(0,0,0,.35); overflow: hidden; animation: qj-in .22s cubic-bezier(.34,1.3,.5,1); }
@media (prefers-color-scheme: dark) { #qj .qj-box { background: #1c1c1f; color: #f4f4f5; } #qj input { background: #27272a; color: #f4f4f5; border-color: #3f3f46; } #qj li[aria-selected="true"] { background: #2e2e33; } }
#qj label { font-size: 12px; font-weight: 600; padding: 14px 16px 6px; opacity: .65; }
#qj input { margin: 0 12px 8px; min-height: 46px; border: 1px solid #d4d4d8; border-radius: 12px; padding: 0 14px; font: 16px system-ui, sans-serif; outline: none; }
#qj input:focus { border-color: var(--accent, #6d28d9); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #6d28d9) 25%, transparent); }
#qj ul { list-style: none; margin: 0; padding: 4px 8px 10px; overflow-y: auto; }
#qj li { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 10px; cursor: pointer; min-height: 44px; justify-content: center; }
#qj li[aria-selected="true"] { background: #f4f4f5; }
#qj .qj-t { font-size: 15px; font-weight: 600; } #qj .qj-s { font-size: 12.5px; opacity: .65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#qj .qj-h { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; opacity: .5; padding: 8px 12px 2px; }
@keyframes qj-in { from { transform: translateY(-10px) scale(.97); opacity: 0; } to { transform: none; opacity: 1; } }`;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.id = 'qj';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Search and jump');
    root.innerHTML = '<div class="qj-box"><label for="qj-input">Jump to a page, note, chat, event or meeting</label><input id="qj-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="qj-list"><ul id="qj-list" role="listbox" aria-label="Results"></ul></div>';
    document.body.appendChild(root);
    input = root.querySelector('input');
    listEl = root.querySelector('ul');
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    input.addEventListener('input', () => { render(pageMatches(input.value), []); clearTimeout(timer); timer = setTimeout(search, 220); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); go(items[active]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    listEl.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) go(items[Number(li.dataset.i)]); });
  }

  const pageMatches = (q) => {
    const w = q.trim().toLowerCase();
    return PAGES.filter((p) => !w || `${p.title} ${p.words}`.toLowerCase().includes(w));
  };

  function render(pages, found) {
    items = [];
    let html = '';
    const section = (label, list) => {
      if (!list.length) return;
      html += `<li class="qj-h" role="presentation">${esc(label)}</li>`;
      list.forEach((it) => { html += `<li role="option" data-i="${items.length}" aria-selected="false"><span class="qj-t">${esc(it.title)}</span>${it.sub ? `<span class="qj-s">${esc(it.sub)}</span>` : ''}</li>`; items.push(it); });
    };
    section('Pages', pages.map((p) => ({ title: p.title, url: p.url })));
    section('Notes', found.filter((f) => f.type === 'note').map((f) => ({ title: f.title, sub: f.snippet, url: f.url })));
    section('Events', found.filter((f) => f.type === 'event').map((f) => ({ title: f.title, sub: f.snippet, url: f.url })));
    section('Chats', found.filter((f) => f.type === 'chat').map((f) => ({ title: `${f.user} in ${f.roomName}`, sub: f.snippet, url: f.url })));
    section('Meetings', found.filter((f) => f.type === 'meeting').map((f) => ({ title: f.title, sub: f.snippet, url: `/meet/?room=${encodeURIComponent(f.code)}` })));
    if (!items.length) html = '<li role="presentation" style="cursor:default"><span class="qj-s">Nothing found.</span></li>';
    listEl.innerHTML = html;
    active = 0;
    paint();
  }
  function paint() {
    listEl.querySelectorAll('li[data-i]').forEach((li) => li.setAttribute('aria-selected', String(Number(li.dataset.i) === active)));
    const cur = listEl.querySelector('li[aria-selected="true"]');
    if (cur) { cur.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', ''); }
  }
  function move(d) { if (!items.length) return; active = (active + d + items.length) % items.length; paint(); }
  function go(it) { if (it && it.url) { close(); location.href = it.url; } }

  async function search() {
    const q = input.value.trim();
    const me = user();
    if (q.length < 2 || !me || !me.key) return;
    const mine = ++seq;
    try {
      const res = await fetch('/.netlify/functions/search?q=' + encodeURIComponent(q), { headers: { 'X-Chowaniec-Key': me.key }, credentials: 'same-origin' });
      if (!res.ok || mine !== seq) return;
      const d = await res.json();
      if (mine !== seq || input.value.trim() !== q) return;
      render(pageMatches(q), [...(d.notes || []), ...(d.events || []), ...(d.chats || []), ...(d.meetings || [])]);
    } catch (e) { /* offline: pages still work */ }
  }

  let lastFocus = null;
  function open() {
    if (!root) build();
    lastFocus = document.activeElement;
    root.classList.add('open');
    input.value = '';
    render(pageMatches(''), []);
    setTimeout(() => input.focus(), 30);
  }
  function close() {
    if (!root) return;
    root.classList.remove('open');
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) { /* ignore */ }
  }

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); root && root.classList.contains('open') ? close() : open(); }
    else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); open(); }
  });
  window.ChowaniecQuickJump = { open, close };
})();
