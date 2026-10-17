// Passcodes are stored as SHA-256 hashes so they can't be read from page source.
// To add a passcode, hash it (e.g. `printf %s 'newcode' | sha256sum`) and add an entry.
// `host: true` grants host (Director) priority in Chowaniec Meet.
// This file is also required by netlify/functions/create-meeting.js.
const CHOWANIEC_PASSCODE_HASHES = {
  '36af96d4beb0c64a1b5035398e5cb28fb2184a4dad56e7d48d54ba5337d04443': { name: 'Gabriel', host: true },
  '00096bec10e72967b2dd17c8f6483841a1de2675d972f572f8ca41b2b7867a3f': { name: 'Liliana', host: false },
  '67c6bc8bef67c7c78dc5f5e23afc08ec1ea8e93f3f8b601cb6269427105456d3': { name: 'Victoria', host: true },
  '152302fe54354121d6badc400637c3871e7ae994946de748e2991671544b42ca': { name: 'Amelia', host: false },
  '0d63a26561291d7cebf51511ef1c6d39048fd78a946a2c63f238bceb5e5b2caf': { name: 'Emilia', host: false },
  'da9342ae5c97d5ad2a70a7dc38356b79716fbe9a6e28d56b6ac8607213dd70c4': { name: 'Nicole', host: true },
  'd22960ef32dd2b56ebdf0da3acde7ef46542579275473288628b7182c11b4798': { name: 'Guest', host: false }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PASSCODE_HASHES: CHOWANIEC_PASSCODE_HASHES };
}

if (typeof window !== 'undefined') {
  window.CHOWANIEC_CONFIG = { PASSCODE_HASHES: CHOWANIEC_PASSCODE_HASHES };

  (function () {
    // Pure-JS SHA-256, used when crypto.subtle is unavailable (e.g. opened via file://).
    function sha256Fallback(str) {
      const bytes = new TextEncoder().encode(str);
      const K = [];
      const H = [];
      let n = 2;
      const isPrime = (x) => { for (let i = 2; i * i <= x; i++) if (x % i === 0) return false; return true; };
      const frac = (x) => ((x - Math.floor(x)) * 0x100000000) | 0;
      while (K.length < 64) {
        if (isPrime(n)) {
          if (H.length < 8) H.push(frac(Math.pow(n, 1 / 2)));
          K.push(frac(Math.pow(n, 1 / 3)));
        }
        n++;
      }

      const len = bytes.length;
      const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
      padded.set(bytes);
      padded[len] = 0x80;
      const view = new DataView(padded.buffer);
      view.setUint32(padded.length - 4, len * 8);
      view.setUint32(padded.length - 8, Math.floor(len / 0x20000000));

      const rotr = (x, r) => (x >>> r) | (x << (32 - r));
      const w = new Array(64);
      for (let off = 0; off < padded.length; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
        for (let i = 16; i < 64; i++) {
          const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
          const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        let [a, b, c, d, e, f, g, h] = H;
        for (let i = 0; i < 64; i++) {
          const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
          const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
          h = g; g = f; f = e; e = (d + t1) | 0;
          d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
        H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
      }
      return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
    }

    async function sha256Hex(str) {
      if (window.crypto && window.crypto.subtle) {
        const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
      }
      return sha256Fallback(str);
    }

    // Resolves to { name, host } for a valid passcode, or null.
    window.checkChowaniecPasscode = async function (passcode) {
      const hashes = window.CHOWANIEC_CONFIG.PASSCODE_HASHES;
      const hash = await sha256Hex(passcode);
      return Object.prototype.hasOwnProperty.call(hashes, hash) ? Object.assign({ key: hash }, hashes[hash]) : null;
    };

    // Sign-ins are remembered for 180 days in a cookie holding the passcode's hash (never the
    // passcode itself). It is checked against the list above on every page load.
    const AUTH_COOKIE = 'chowaniec_auth';
    const AUTH_COOKIE_MAX_AGE = 180 * 24 * 60 * 60;

    function readAuthCookie() {
      const match = document.cookie.match(/(?:^|;\s*)chowaniec_auth=([0-9a-f]{64})(?:;|$)/);
      return match ? match[1] : null;
    }

    function writeAuthCookie(key, maxAge) {
      const secure = window.location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `${AUTH_COOKIE}=${key || ''}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
    }

    window.setChowaniecSession = function (user) {
      sessionStorage.setItem('chowaniec_authenticated', 'true');
      sessionStorage.setItem('chowaniec_user', JSON.stringify(user));
      if (user && user.key) writeAuthCookie(user.key, AUTH_COOKIE_MAX_AGE);
    };

    window.clearChowaniecSession = function () {
      sessionStorage.removeItem('chowaniec_authenticated');
      sessionStorage.removeItem('chowaniec_user');
      writeAuthCookie('', 0);
    };

    // Everyone who can be @mentioned (the family; not the shared Guest passcode).
    window.chowaniecPeople = function () {
      const names = Object.values(CHOWANIEC_PASSCODE_HASHES).map((u) => u.name).filter((n) => n !== 'Guest');
      return [...new Set(names)];
    };

    // Restore a remembered sign-in before the page's own auth checks run.
    (function restoreRememberedSession() {
      try {
        if (sessionStorage.getItem('chowaniec_authenticated') === 'true') {
          // Older sessions predate the cookie; remember them from now on.
          const current = JSON.parse(sessionStorage.getItem('chowaniec_user') || 'null');
          if (current && current.key && !readAuthCookie()) writeAuthCookie(current.key, AUTH_COOKIE_MAX_AGE);
          return;
        }
        const key = readAuthCookie();
        if (!key) return;
        if (!Object.prototype.hasOwnProperty.call(CHOWANIEC_PASSCODE_HASHES, key)) {
          writeAuthCookie('', 0);
          return;
        }
        sessionStorage.setItem('chowaniec_authenticated', 'true');
        sessionStorage.setItem('chowaniec_user', JSON.stringify(Object.assign({ key }, CHOWANIEC_PASSCODE_HASHES[key])));
        // Refresh the expiry so regular visitors stay signed in.
        writeAuthCookie(key, AUTH_COOKIE_MAX_AGE);
      } catch (e) {
        // Storage blocked: fall back to signing in each visit.
      }
    })();

    window.getChowaniecUser = function () {
      try {
        return JSON.parse(sessionStorage.getItem('chowaniec_user'));
      } catch (e) {
        return null;
      }
    };
  })();
}
