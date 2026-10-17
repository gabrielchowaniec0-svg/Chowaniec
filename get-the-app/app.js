/* Chowaniec "Get the App" page.
 * Uses window.ChowaniecPWA (from /pwa.js, loaded with `defer`) to show install
 * steps and manage push notifications. Everything degrades gracefully when the
 * helper is missing or slow to load.
 */
(function () {
    'use strict';

    const PLATFORMS = ['ios', 'android', 'desktop'];
    const PLATFORM_LABELS = { ios: 'iPhone / iPad', android: 'Android', desktop: 'Computer' };

    const state = {
        user: null,
        pwa: null,            // window.ChowaniecPWA once available
        pwaMissing: false,    // gave up waiting for the helper
        platform: null,       // detected platform for this device
        tab: null,            // platform tab being viewed
        standalone: false,
        canPrompt: false,
        installBusy: false,
        installNote: '',
        push: 'loading',      // pushStatus() value, or 'loading' / 'error' / 'missing'
        pushBusy: '',         // '', 'enable', 'disable', 'test'
        pushMessage: null,    // { tone: 'ok'|'warn'|'error', text }
        pushSeq: 0
    };

    // ---------- helpers ----------
    const $ = (id) => document.getElementById(id);

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function icons() {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            try { window.lucide.createIcons(); } catch (e) { /* ignore */ }
        }
    }

    let toastTimer = null;
    function toast(text) {
        const el = $('toast');
        if (!el) return;
        el.textContent = text;
        el.classList.remove('hidden');
        el.classList.add('flex');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            el.classList.add('hidden');
            el.classList.remove('flex');
        }, 3200);
    }

    function errorText(err, fallback) {
        const msg = err && (err.message || (typeof err === 'string' ? err : ''));
        return msg ? String(msg).slice(0, 200) : fallback;
    }

    function withTimeout(promise, ms) {
        return Promise.race([
            Promise.resolve(promise),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out')), ms))
        ]);
    }

    function getUser() {
        try {
            return typeof window.getChowaniecUser === 'function' ? window.getChowaniecUser() : null;
        } catch (e) {
            return null;
        }
    }

    // Fallbacks used only when /pwa.js never shows up.
    function guessPlatform() {
        const ua = navigator.userAgent || '';
        const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        if (/iPhone|iPad|iPod/i.test(ua) || iPadOS) return 'ios';
        if (/Android/i.test(ua)) return 'android';
        return 'desktop';
    }
    function guessStandalone() {
        try {
            return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
        } catch (e) {
            return false;
        }
    }

    function safeCall(fn, fallback) {
        try { return fn(); } catch (e) { return fallback; }
    }

    function isIosNonSafari() {
        return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\//i.test(navigator.userAgent || '');
    }
    function isFirefoxDesktop() {
        return /Firefox\//i.test(navigator.userAgent || '') && !/Android/i.test(navigator.userAgent || '');
    }

    // ---------- reading the PWA helper ----------
    function readPwa() {
        const pwa = state.pwa;
        if (pwa) {
            state.platform = safeCall(() => pwa.platform(), null) || guessPlatform();
            state.standalone = !!safeCall(() => pwa.isStandalone(), guessStandalone());
            state.canPrompt = !!safeCall(() => pwa.canPromptInstall(), false);
        } else {
            state.platform = guessPlatform();
            state.standalone = guessStandalone();
            state.canPrompt = false;
        }
        if (PLATFORMS.indexOf(state.platform) === -1) state.platform = 'desktop';
        if (!state.tab) state.tab = state.platform;
    }

    async function refreshPush() {
        const seq = ++state.pushSeq;
        if (!state.pwa || typeof state.pwa.pushStatus !== 'function') {
            state.push = state.pwaMissing ? 'missing' : 'loading';
            renderStatus();
            renderPush();
            return;
        }
        try {
            const status = await withTimeout(state.pwa.pushStatus(), 10000);
            if (seq !== state.pushSeq) return;
            state.push = status || 'error';
        } catch (err) {
            if (seq !== state.pushSeq) return;
            state.push = 'error';
            state.pushMessage = { tone: 'error', text: 'Couldn’t check notifications: ' + errorText(err, 'unknown error') };
        }
        renderStatus();
        renderPush();
    }

    function refreshAll() {
        readPwa();
        renderStatus();
        renderInstall();
        refreshPush();
    }

    // ---------- status card ----------
    const PUSH_LABELS = {
        loading: ['Checking…', 'wait'],
        enabled: ['On', 'ok'],
        disabled: ['Off', 'idle'],
        'needs-install': ['Install the app first', 'warn'],
        denied: ['Blocked in settings', 'warn'],
        unsupported: ['Not supported here', 'idle'],
        'not-configured': ['Not set up yet', 'idle'],
        error: ['Couldn’t check', 'warn'],
        missing: ['Unavailable', 'idle']
    };

    function statusRow(icon, tone, label, value) {
        const tones = {
            ok: 'bg-emerald-50 text-emerald-600 border-emerald-100',
            warn: 'bg-amber-50 text-amber-600 border-amber-100',
            idle: 'bg-gray-50 text-gray-400 border-gray-100',
            wait: 'bg-gray-50 text-gray-400 border-gray-100'
        };
        const glyph = tone === 'ok' ? 'check' : tone === 'warn' ? 'alert-circle' : tone === 'wait' ? 'loader-circle' : icon;
        return `<li class="flex items-center gap-3 min-w-0">
            <span class="w-9 h-9 shrink-0 rounded-full border flex items-center justify-center ${tones[tone] || tones.idle}">
                <i data-lucide="${glyph}" class="w-4 h-4 ${tone === 'wait' ? 'spin' : ''}"></i>
            </span>
            <span class="min-w-0 flex-1">
                <span class="block text-[10px] font-mono uppercase tracking-widest text-gray-400">${escapeHtml(label)}</span>
                <span class="block text-sm font-medium text-black truncate">${escapeHtml(value)}</span>
            </span>
        </li>`;
    }

    function renderStatus() {
        const list = $('status-list');
        if (!list) return;
        const installed = state.standalone
            ? statusRow('smartphone', 'ok', 'Installed', 'Yes — you’re in the app')
            : statusRow('smartphone', 'idle', 'Installed', 'Not opened as the app');
        const p = PUSH_LABELS[state.push] || PUSH_LABELS.error;
        const push = statusRow('bell', p[1], 'Notifications', p[0]);
        const name = state.user && state.user.name ? state.user.name : null;
        const signed = name
            ? statusRow('user', 'ok', 'Signed in as', name + (state.user.host ? ' (host)' : ''))
            : statusRow('user', 'warn', 'Signed in', 'Not signed in');
        list.innerHTML = installed + push + signed;
        icons();
    }

    function renderUserChip() {
        const chip = $('user-chip');
        if (!chip || !state.user) return;
        chip.innerHTML = `<span class="w-6 h-6 rounded-full bg-white border border-gray-200 flex items-center justify-center text-black font-serif text-xs">${escapeHtml(String(state.user.name || '?').charAt(0))}</span><span class="truncate">${escapeHtml(state.user.name)}</span>${state.user.host ? '<span class="text-[9px] uppercase tracking-widest text-gray-400 hidden sm:inline">Host</span>' : ''}`;
        chip.classList.remove('hidden');
        chip.classList.add('flex');
    }

    // ---------- step illustrations ----------
    // Tiny, schematic device mocks. The highlighted control gets a black ring.
    function mock(kind) {
        const ring = 'mock-ring rounded-lg bg-white text-black';
        const appIcon = '<span class="w-9 h-9 rounded-[22%] bg-black text-white font-serif text-[11px] flex items-center justify-center shadow">CN</span>';
        switch (kind) {
            case 'safari':
                return `<div class="mock p-3 flex items-center gap-2">
                    <i data-lucide="compass" class="w-6 h-6 text-sky-500 shrink-0"></i>
                    <span class="flex-1 min-w-0 h-8 rounded-lg bg-white border border-gray-200 px-3 flex items-center gap-1.5 text-xs font-mono text-gray-500 truncate"><i data-lucide="lock" class="w-3 h-3 shrink-0"></i>chowaniec.net</span>
                </div>`;
            case 'chrome':
                return `<div class="mock p-3 flex items-center gap-2">
                    <i data-lucide="globe" class="w-6 h-6 text-gray-500 shrink-0"></i>
                    <span class="flex-1 min-w-0 h-8 rounded-lg bg-white border border-gray-200 px-3 flex items-center gap-1.5 text-xs font-mono text-gray-500 truncate"><i data-lucide="lock" class="w-3 h-3 shrink-0"></i>chowaniec.net</span>
                </div>`;
            case 'ios-share':
                return `<div class="mock px-4 py-3 flex items-center justify-between text-gray-400">
                    <i data-lucide="chevron-left" class="w-5 h-5"></i>
                    <i data-lucide="chevron-right" class="w-5 h-5"></i>
                    <span class="${ring} w-9 h-9 flex items-center justify-center"><i data-lucide="share" class="w-5 h-5"></i></span>
                    <i data-lucide="book-open" class="w-5 h-5"></i>
                    <i data-lucide="copy" class="w-5 h-5"></i>
                </div>`;
            case 'ios-add':
                return `<div class="mock p-2 space-y-1 text-xs">
                    <div class="flex items-center justify-between px-3 h-8 rounded-lg bg-white text-gray-400"><span>Add to Favorites</span><i data-lucide="star" class="w-4 h-4"></i></div>
                    <div class="flex items-center justify-between px-3 h-9 ${ring} font-medium"><span>Add to Home Screen</span><i data-lucide="square-plus" class="w-4 h-4"></i></div>
                </div>`;
            case 'ios-confirm':
                return `<div class="mock px-3 py-2 flex items-center justify-between gap-2 text-xs">
                    <span class="text-gray-400">Cancel</span>
                    <span class="font-medium text-gray-600 truncate">Add to Home Screen</span>
                    <span class="${ring} px-3 h-8 flex items-center font-semibold text-sky-600">Add</span>
                </div>`;
            case 'homescreen':
                return `<div class="mock p-3 grid grid-cols-4 gap-2 place-items-center">
                    <span class="w-9 h-9 rounded-[22%] bg-gray-200"></span>
                    <span class="w-9 h-9 rounded-[22%] bg-gray-200"></span>
                    <span class="mock-ring rounded-[22%]">${appIcon}</span>
                    <span class="w-9 h-9 rounded-[22%] bg-gray-200"></span>
                </div>`;
            case 'android-menu':
                return `<div class="mock p-3 flex items-center gap-2">
                    <span class="flex-1 min-w-0 h-8 rounded-full bg-white border border-gray-200 px-3 flex items-center text-xs font-mono text-gray-500 truncate">chowaniec.net</span>
                    <span class="${ring} w-9 h-9 flex items-center justify-center"><i data-lucide="ellipsis-vertical" class="w-5 h-5"></i></span>
                </div>`;
            case 'android-install':
                return `<div class="mock p-2 space-y-1 text-xs">
                    <div class="flex items-center gap-3 px-3 h-8 rounded-lg bg-white text-gray-400"><i data-lucide="bookmark" class="w-4 h-4"></i><span>Bookmarks</span></div>
                    <div class="flex items-center gap-3 px-3 h-9 ${ring} font-medium"><i data-lucide="smartphone" class="w-4 h-4"></i><span>Install app</span></div>
                </div>`;
            case 'install-dialog':
                return `<div class="mock p-3 flex items-center gap-3 text-xs">
                    ${appIcon}
                    <span class="flex-1 min-w-0"><span class="block font-medium text-black truncate">Install Chowaniec?</span><span class="block text-gray-400 truncate">chowaniec.net</span></span>
                    <span class="${ring} px-3 h-8 flex items-center font-semibold">Install</span>
                </div>`;
            case 'desktop-bar':
                return `<div class="mock p-3 flex items-center gap-2">
                    <span class="flex-1 min-w-0 h-8 rounded-full bg-white border border-gray-200 pl-3 pr-1 flex items-center justify-between text-xs font-mono text-gray-500">
                        <span class="truncate">chowaniec.net</span>
                        <span class="${ring} w-7 h-7 flex items-center justify-center shrink-0"><i data-lucide="monitor-down" class="w-4 h-4"></i></span>
                    </span>
                    <i data-lucide="ellipsis-vertical" class="w-5 h-5 text-gray-400 shrink-0"></i>
                </div>`;
            case 'dock':
                return `<div class="mock p-3 flex items-center justify-center gap-2">
                    <span class="w-8 h-8 rounded-[22%] bg-gray-200"></span>
                    <span class="w-8 h-8 rounded-[22%] bg-gray-200"></span>
                    <span class="mock-ring rounded-[22%]">${appIcon}</span>
                    <span class="w-8 h-8 rounded-[22%] bg-gray-200"></span>
                </div>`;
            default:
                return '';
        }
    }

    const STEPS = {
        ios: {
            steps: [
                { title: 'Open chowaniec.net in <strong>Safari</strong>', body: 'Use Safari, the compass icon. Other browsers inside apps (Instagram, Gmail, etc.) can’t add to the Home Screen.', art: 'safari' },
                { title: 'Tap the <strong>Share</strong> button', body: 'The square with an arrow pointing up — at the bottom of the screen on iPhone, top right on iPad. If you only see •••, tap that first, then Share.', art: 'ios-share' },
                { title: 'Scroll down and tap <strong>Add to Home Screen</strong>', body: 'It’s in the list below the row of apps. Don’t see it? Tap <em>Edit Actions</em> at the bottom to add it.', art: 'ios-add' },
                { title: 'Tap <strong>Add</strong>', body: 'Top right corner. Keep the name “Chowaniec”.', art: 'ios-confirm' },
                { title: 'Open <strong>Chowaniec</strong> from your Home Screen', body: 'From now on, use the icon instead of Safari. Then come back to this page (Get the App) in the app to turn on notifications.', art: 'homescreen' }
            ],
            note: 'On iPhone and iPad, notifications only work from the Home Screen app, and need iOS / iPadOS 16.4 or newer (Settings → General → Software Update).'
        },
        android: {
            steps: [
                { title: 'Open chowaniec.net in <strong>Chrome</strong>', body: 'Samsung Internet and Edge work too — the menu names are slightly different.', art: 'chrome' },
                { title: 'Tap the <strong>⋮ menu</strong>', body: 'The three dots at the top right of Chrome.', art: 'android-menu' },
                { title: 'Tap <strong>Install app</strong>', body: 'On some phones it’s called <em>Add to Home screen</em>. In Samsung Internet: ≡ menu → <em>Add page to</em> → <em>Home screen</em>.', art: 'android-install' },
                { title: 'Tap <strong>Install</strong>, then open Chowaniec', body: 'The icon appears on your home screen and in your app drawer.', art: 'install-dialog' }
            ],
            note: 'Notifications work in the browser too, but the app keeps them separate from your other Chrome notifications.'
        },
        desktop: {
            steps: [
                { title: 'Open chowaniec.net in <strong>Chrome</strong> or <strong>Edge</strong>', body: 'On a Mac, Safari works too: <em>File → Add to Dock</em> (macOS Sonoma or newer).', art: 'chrome' },
                { title: 'Click the <strong>install icon</strong> in the address bar', body: 'A small screen with a down arrow at the right end of the address bar. No icon? Chrome: ⋮ menu → <em>Cast, save and share</em> → <em>Install page as app</em>. Edge: ⋯ menu → <em>Apps</em> → <em>Install this site as an app</em>.', art: 'desktop-bar' },
                { title: 'Click <strong>Install</strong>', body: 'Chowaniec opens in its own window. Pin it to your taskbar or Dock so it’s one click away.', art: 'dock' }
            ],
            note: 'Firefox on computers can’t install apps yet — use Chrome, Edge or Safari for this step.'
        }
    };

    function renderSteps(platform) {
        const data = STEPS[platform];
        const items = data.steps.map((s, i) => `
            <li class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_260px] sm:gap-6 items-center py-4 first:pt-0 last:pb-0">
                <div class="flex gap-3 min-w-0">
                    <span class="w-7 h-7 shrink-0 rounded-full border border-gray-200 text-gray-500 font-mono text-xs flex items-center justify-center mt-0.5">${i + 1}</span>
                    <div class="min-w-0">
                        <p class="text-base text-black leading-snug">${s.title}</p>
                        <p class="mt-1 text-sm text-gray-500 leading-relaxed">${s.body}</p>
                    </div>
                </div>
                <div class="pl-10 sm:pl-0" aria-hidden="true">${mock(s.art)}</div>
            </li>`).join('');
        return `<ol class="divide-y divide-gray-100">${items}</ol>
            <div class="mt-5 flex gap-3 rounded-2xl bg-gray-50 border border-gray-100 p-4 text-sm text-gray-600">
                <i data-lucide="info" class="w-4 h-4 shrink-0 mt-0.5 text-gray-400"></i>
                <p>${data.note}</p>
            </div>`;
    }

    function renderTabs() {
        const el = $('platform-tabs');
        if (!el) return;
        el.innerHTML = PLATFORMS.map((p) => {
            const active = p === state.tab;
            const mine = p === state.platform;
            return `<button type="button" role="tab" id="tab-${p}" aria-controls="install-steps" aria-selected="${active}" data-action="tab" data-platform="${p}"
                class="min-h-[44px] px-2 rounded-full text-xs sm:text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${active ? 'bg-black text-white shadow' : 'text-gray-500 hover:text-black'}">
                <span class="truncate">${p === 'ios' ? '<span class="sm:hidden">iPhone</span><span class="hidden sm:inline">iPhone / iPad</span>' : PLATFORM_LABELS[p]}</span>${mine ? `<span class="w-1.5 h-1.5 shrink-0 rounded-full ${active ? 'bg-emerald-400' : 'bg-emerald-500'}" title="This device"></span>` : ''}
            </button>`;
        }).join('');
    }

    function renderInstallCurrent() {
        const el = $('install-current');
        if (!el) return;
        if (state.standalone) {
            el.innerHTML = `<div class="flex items-center gap-4 rounded-2xl bg-emerald-50 border border-emerald-100 p-4 sm:p-5">
                <span class="w-10 h-10 shrink-0 rounded-full bg-emerald-500 text-white flex items-center justify-center"><i data-lucide="check" class="w-5 h-5"></i></span>
                <div class="min-w-0">
                    <p class="font-medium text-black">You're using the app ✓</p>
                    <p class="text-sm text-gray-600">Chowaniec is installed on this device. Helping someone else? Their steps are below.</p>
                </div>
            </div>`;
            return;
        }
        const p = state.platform;
        const here = p === 'ios' ? 'an iPhone or iPad' : p === 'android' ? 'an Android device' : 'a computer';
        let html = '';
        if ((p === 'android' || p === 'desktop') && state.canPrompt) {
            html = `<div class="rounded-2xl bg-gray-50 border border-gray-100 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                <div class="min-w-0 flex-1">
                    <p class="font-medium text-black">One tap and you're done</p>
                    <p class="text-sm text-gray-500">Your browser can install Chowaniec right now.</p>
                </div>
                <button type="button" data-action="install" ${state.installBusy ? 'disabled' : ''}
                    class="w-full sm:w-auto min-h-[52px] px-7 rounded-full bg-black text-white text-sm font-medium hover:bg-gray-800 transition-colors shadow-md flex items-center justify-center gap-2 disabled:opacity-60">
                    <i data-lucide="${state.installBusy ? 'loader-circle' : 'download'}" class="w-4 h-4 ${state.installBusy ? 'spin' : ''}"></i> Install App
                </button>
            </div>`;
        } else if (p === 'ios') {
            const warn = isIosNonSafari()
                ? `<p class="mt-2 text-sm text-amber-700 flex gap-2"><i data-lucide="alert-circle" class="w-4 h-4 shrink-0 mt-0.5"></i><span>It looks like you're not in Safari. Copy <strong>chowaniec.net</strong> and open it in Safari first.</span></p>`
                : '';
            html = `<div class="rounded-2xl bg-gray-50 border border-gray-100 p-4 sm:p-5">
                <p class="text-sm text-gray-600">You're on ${here}. Follow the five steps below in Safari &mdash; it takes about 20 seconds.</p>${warn}
            </div>`;
        } else {
            const ff = p === 'desktop' && isFirefoxDesktop()
                ? ' Firefox can’t install apps on computers — open chowaniec.net in Chrome or Edge.'
                : ' Your browser hasn’t offered a one-tap install, so use its menu as shown below.';
            html = `<div class="rounded-2xl bg-gray-50 border border-gray-100 p-4 sm:p-5">
                <p class="text-sm text-gray-600">You're on ${here}.${escapeHtml(ff)}</p>
            </div>`;
        }
        if (state.installNote) {
            html += `<p class="mt-3 text-sm text-gray-600">${escapeHtml(state.installNote)}</p>`;
        }
        el.innerHTML = html;
    }

    function renderInstall() {
        renderInstallCurrent();
        renderTabs();
        const steps = $('install-steps');
        if (steps) {
            steps.setAttribute('aria-labelledby', 'tab-' + state.tab);
            steps.innerHTML = renderSteps(state.tab);
        }
        icons();
    }

    // ---------- notifications ----------
    const BTN_PRIMARY = 'min-h-[48px] px-6 rounded-full bg-black text-white text-sm font-medium hover:bg-gray-800 transition-colors shadow-md inline-flex items-center justify-center gap-2 disabled:opacity-60';
    const BTN_SECONDARY = 'min-h-[48px] px-6 rounded-full bg-white border border-gray-200 text-black text-sm font-medium hover:border-gray-400 transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60';

    function busyIcon(kind, fallback) {
        return state.pushBusy === kind
            ? '<i data-lucide="loader-circle" class="w-4 h-4 spin"></i>'
            : `<i data-lucide="${fallback}" class="w-4 h-4"></i>`;
    }

    function panel(icon, tone, title, body, actions) {
        const tones = {
            ok: 'bg-emerald-500 text-white',
            warn: 'bg-amber-100 text-amber-700',
            idle: 'bg-gray-100 text-gray-500',
            dark: 'bg-black text-white'
        };
        return `<div class="flex flex-col sm:flex-row sm:items-start gap-4">
            <span class="w-11 h-11 shrink-0 rounded-full flex items-center justify-center ${tones[tone] || tones.idle}"><i data-lucide="${icon}" class="w-5 h-5"></i></span>
            <div class="min-w-0 flex-1">
                <p class="font-medium text-black text-lg">${title}</p>
                <div class="mt-1 text-sm text-gray-600 leading-relaxed space-y-2">${body}</div>
                ${actions ? `<div class="mt-4 flex flex-col sm:flex-row sm:flex-wrap gap-3">${actions}</div>` : ''}
            </div>
        </div>`;
    }

    function deniedHelp() {
        const p = state.platform;
        if (p === 'ios') {
            return `<ol class="list-decimal pl-5 space-y-1 marker:text-gray-400">
                <li>Open the iPhone <strong>Settings</strong> app.</li>
                <li>Tap <strong>Notifications</strong>, then <strong>Chowaniec</strong>.</li>
                <li>Turn on <strong>Allow Notifications</strong>, then come back here.</li>
            </ol>`;
        }
        if (p === 'android') {
            return `<ol class="list-decimal pl-5 space-y-1 marker:text-gray-400">
                <li>Press and hold the Chowaniec icon and tap <strong>App info</strong> (or in Chrome, tap the icon left of the address and choose <strong>Permissions</strong>).</li>
                <li>Tap <strong>Notifications</strong> and switch them <strong>on</strong>.</li>
                <li>Come back here and tap <strong>Check again</strong>.</li>
            </ol>`;
        }
        return `<ol class="list-decimal pl-5 space-y-1 marker:text-gray-400">
            <li>Click the icon just left of <strong>chowaniec.net</strong> in the address bar (a lock or sliders), or the app window's ⋮ menu → <strong>App info</strong>.</li>
            <li>Set <strong>Notifications</strong> to <strong>Allow</strong>. In Safari: Settings → Websites → Notifications.</li>
            <li>Reload this page, or click <strong>Check again</strong>.</li>
        </ol>`;
    }

    function messageHtml() {
        const m = state.pushMessage;
        if (!m) return '';
        const tones = {
            ok: 'bg-emerald-50 border-emerald-100 text-emerald-800',
            warn: 'bg-amber-50 border-amber-100 text-amber-800',
            error: 'bg-red-50 border-red-100 text-red-700'
        };
        const icon = m.tone === 'ok' ? 'check' : 'alert-circle';
        return `<div id="push-message" class="mt-5 flex gap-2 rounded-2xl border p-3 sm:p-4 text-sm ${tones[m.tone] || tones.warn}">
            <i data-lucide="${icon}" class="w-4 h-4 shrink-0 mt-0.5"></i><p class="min-w-0 break-words">${escapeHtml(m.text)}</p>
        </div>`;
    }

    function renderPush() {
        const el = $('push-body');
        if (!el) return;
        const busy = !!state.pushBusy;
        const dis = busy ? 'disabled' : '';
        let html;
        switch (state.push) {
            case 'loading':
                html = `<div class="flex items-center gap-3 text-sm text-gray-500 min-h-[48px]"><i data-lucide="loader-circle" class="w-4 h-4 spin"></i> Checking this device…</div>`;
                break;
            case 'disabled':
                html = panel('bell', 'dark', 'Notifications are off on this device',
                    '<p>Tap the button and choose <strong>Allow</strong> when your device asks.</p>',
                    `<button type="button" data-action="push-enable" class="${BTN_PRIMARY}" ${dis}>${busyIcon('enable', 'bell-ring')} Turn on notifications</button>`);
                break;
            case 'enabled':
                html = panel('bell-ring', 'ok', 'Notifications are on ✓',
                    '<p>This device will be notified about new Group Chat messages. Want to make sure it works?</p>',
                    `<button type="button" data-action="push-test" class="${BTN_PRIMARY}" ${dis}>${busyIcon('test', 'send')} Send a test notification</button>
                     <button type="button" data-action="push-disable" class="${BTN_SECONDARY}" ${dis}>${busyIcon('disable', 'bell-off')} Turn off</button>`);
                break;
            case 'needs-install':
                html = panel('smartphone', 'warn', 'Install the app first',
                    '<p>On iPhone and iPad, Apple only allows notifications from apps on the Home Screen. Add Chowaniec to your Home Screen (Step 1), open it from there, and come back to this page to switch notifications on.</p><p class="text-gray-500">Needs iOS / iPadOS 16.4 or newer.</p>',
                    `<button type="button" data-action="show-ios" class="${BTN_PRIMARY}"><i data-lucide="arrow-up" class="w-4 h-4"></i> Show me how</button>`);
                break;
            case 'denied':
                html = panel('bell-off', 'warn', 'Notifications are blocked',
                    `<p>This device said “Don't allow” earlier, so the site can't ask again. To fix it:</p>${deniedHelp()}`,
                    `<button type="button" data-action="push-recheck" class="${BTN_SECONDARY}" ${dis}><i data-lucide="refresh-cw" class="w-4 h-4"></i> Check again</button>`);
                break;
            case 'unsupported':
                html = panel('circle-slash', 'idle', 'This browser doesn’t support notifications',
                    state.platform === 'ios'
                        ? '<p>Update your iPhone or iPad to iOS 16.4 or newer (Settings → General → Software Update), then open Chowaniec from the Home Screen.</p>'
                        : '<p>Try the latest Chrome, Edge, Firefox or Safari. Private / incognito windows usually can’t receive notifications either.</p>',
                    '');
                break;
            case 'not-configured':
                html = panel('server-off', 'idle', 'Notifications aren’t set up on the server yet',
                    '<p>Nothing to do on your side — the family host still needs to switch them on. You can install the app in the meantime; check back here later.</p>',
                    `<button type="button" data-action="push-recheck" class="${BTN_SECONDARY}" ${dis}><i data-lucide="refresh-cw" class="w-4 h-4"></i> Check again</button>`);
                break;
            case 'missing':
                html = panel('alert-circle', 'warn', 'The app helper didn’t load',
                    '<p>We couldn’t load the part of the site that handles installing and notifications. Check your connection and reload the page.</p>',
                    `<button type="button" data-action="reload" class="${BTN_SECONDARY}"><i data-lucide="refresh-cw" class="w-4 h-4"></i> Reload page</button>`);
                break;
            default: // 'error' or anything unexpected
                html = panel('alert-circle', 'warn', 'Couldn’t check notifications',
                    '<p>Something went wrong talking to this device. Try again in a moment.</p>',
                    `<button type="button" data-action="push-recheck" class="${BTN_SECONDARY}" ${dis}><i data-lucide="refresh-cw" class="w-4 h-4"></i> Try again</button>`);
        }
        el.innerHTML = html + messageHtml();
        icons();
    }

    // ---------- actions ----------
    async function doInstall() {
        if (!state.pwa || state.installBusy) return;
        state.installBusy = true;
        state.installNote = '';
        renderInstallCurrent();
        icons();
        let outcome;
        try {
            outcome = await state.pwa.promptInstall();
        } catch (err) {
            outcome = 'error';
            state.installNote = 'Install didn’t start: ' + errorText(err, 'unknown error') + '. Use the steps below instead.';
        }
        state.installBusy = false;
        if (outcome === 'accepted') {
            toast('Installing Chowaniec…');
            state.installNote = 'Installed! Open Chowaniec from your home screen or app list.';
        } else if (outcome === 'dismissed') {
            toast('No problem — you can install it any time.');
        } else if (outcome === 'unavailable') {
            state.installNote = 'Your browser isn’t offering the install button right now — use the steps below.';
        }
        readPwa();
        renderStatus();
        renderInstall();
    }

    async function doPush(kind) {
        const pwa = state.pwa;
        if (!pwa || state.pushBusy) return;
        state.pushBusy = kind;
        state.pushMessage = null;
        renderPush();
        try {
            if (kind === 'enable') {
                const res = await pwa.enablePush();
                if (res === 'enabled') {
                    toast('Notifications are on');
                    state.pushMessage = { tone: 'ok', text: 'Done! Try “Send a test notification” to check it works.' };
                } else if (res === 'denied') {
                    state.pushMessage = { tone: 'warn', text: 'Notifications weren’t allowed. Follow the steps above to allow them in settings.' };
                } else {
                    state.pushMessage = { tone: 'error', text: 'Couldn’t turn on notifications. Please try again in a moment.' };
                }
            } else if (kind === 'disable') {
                await pwa.disablePush();
                toast('Notifications turned off');
            } else if (kind === 'test') {
                const res = await pwa.sendTestPush();
                const sent = res && typeof res.sent === 'number' ? res.sent : 0;
                state.pushMessage = sent > 0
                    ? { tone: 'ok', text: 'Test sent to ' + sent + (sent === 1 ? ' device' : ' devices') + '. It should pop up in a few seconds.' }
                    : { tone: 'warn', text: 'The server didn’t find any device to notify. Turn notifications off and on again, then retry.' };
            }
        } catch (err) {
            state.pushMessage = { tone: 'error', text: 'Something went wrong: ' + errorText(err, 'unknown error') };
        }
        state.pushBusy = '';
        await refreshPush();
    }

    function onClick(e) {
        const btn = e.target.closest('[data-action]');
        if (!btn || btn.disabled) return;
        const action = btn.getAttribute('data-action');
        switch (action) {
            case 'tab':
                state.tab = btn.getAttribute('data-platform');
                renderInstall();
                { const t = $('tab-' + state.tab); if (t) t.focus(); }
                break;
            case 'install': doInstall(); break;
            case 'push-enable': doPush('enable'); break;
            case 'push-disable': doPush('disable'); break;
            case 'push-test': doPush('test'); break;
            case 'push-recheck':
                state.pushMessage = null;
                state.push = 'loading';
                renderPush();
                refreshPush();
                break;
            case 'show-ios':
                state.tab = 'ios';
                renderInstall();
                { const s = $('step-install'); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
                break;
            case 'reload': window.location.reload(); break;
        }
    }

    function onTabKey(e) {
        if (!e.target.closest('#platform-tabs')) return;
        const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const i = PLATFORMS.indexOf(state.tab);
        state.tab = PLATFORMS[(i + dir + PLATFORMS.length) % PLATFORMS.length];
        renderInstall();
        const t = $('tab-' + state.tab);
        if (t) t.focus();
    }

    // ---------- startup ----------
    function heroIconFallback() {
        const img = $('hero-icon');
        const fb = $('hero-icon-fallback');
        if (!img || !fb) return;
        const swap = () => {
            img.classList.add('hidden');
            fb.classList.remove('hidden');
            fb.classList.add('flex');
        };
        img.addEventListener('error', swap);
        if (img.complete && img.naturalWidth === 0) swap();
    }

    function waitForPwa(timeoutMs) {
        return new Promise((resolve) => {
            if (window.ChowaniecPWA) return resolve(window.ChowaniecPWA);
            const started = Date.now();
            const timer = setInterval(() => {
                if (window.ChowaniecPWA) {
                    clearInterval(timer);
                    resolve(window.ChowaniecPWA);
                } else if (Date.now() - started > timeoutMs) {
                    clearInterval(timer);
                    resolve(null);
                }
            }, 100);
        });
    }

    let started = false;
    async function start() {
        if (started) return;
        started = true;
        state.user = getUser();
        renderUserChip();
        document.addEventListener('click', onClick);
        document.addEventListener('keydown', onTabKey);

        // First paint with best guesses so the page is never empty.
        state.pwa = window.ChowaniecPWA || null;
        refreshAll();

        if (!state.pwa) {
            state.pwa = await waitForPwa(6000);
            if (!state.pwa) state.pwaMissing = true;
            refreshAll();
        }

        window.addEventListener('chowaniec-pwa-change', () => {
            if (!state.pwa && window.ChowaniecPWA) state.pwa = window.ChowaniecPWA;
            refreshAll();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') refreshAll();
        });
        try {
            const mq = window.matchMedia && window.matchMedia('(display-mode: standalone)');
            if (mq && mq.addEventListener) mq.addEventListener('change', refreshAll);
        } catch (e) { /* ignore */ }
    }

    window.returnToHub = function () {
        const isLocal =
            window.location.protocol === 'file:' ||
            window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1';
        window.location.href = isLocal ? '../index.html' : '/';
    };

    window.initializeProtectedContent = function () {
        start();
        icons();
    };

    window.addEventListener('DOMContentLoaded', () => {
        heroIconFallback();
        icons();
        if (window.isAppAuthorized && window.isAppAuthorized()) {
            window.initializeProtectedContent();
        }
    });
})();
