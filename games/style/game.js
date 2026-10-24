// Style Star: a dress-up runway game (in the spirit of "Dress To Impress") for Chowaniec Games.
// A theme is announced, everyone dresses a layered-SVG paper doll, walks the runway, rates the other
// looks 1-5 stars and the best average wins. Solo: against 3 computer models. Multiplayer (race mode):
// every phase is timed from the round's start, outfits and votes travel in ChowGames.race.update().
// Free style: dress up with no timer and save looks to a wardrobe on this device.
(function () {
  'use strict';
  const CG = window.ChowGames;

  // ===================================================================================================
  // Colour helpers
  // ===================================================================================================
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function hexRgb(h) {
    h = String(h || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgbHex = (r, g, b) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  function mix(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return rgbHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
  const shade = (h, t) => (t < 0 ? mix(h, '#1a1020', -t) : mix(h, '#ffffff', t));
  function luma(h) { const [r, g, b] = hexRgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
  function hueOf(h) {
    const [r, g, b] = hexRgb(h).map((v) => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 0.08) return { h: 0, s: 0 };
    let hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh = (hh * 60 + 360) % 360;
    return { h: hh, s: d / (1 - Math.abs(mx + mn - 1) || 1) };
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ===================================================================================================
  // Palettes
  // ===================================================================================================
  // fam: colour family used by the "colour harmony" judge (n = neutral).
  const COLORS = [
    ['wh', 'White', '#fbfaf7', 'n'], ['cr', 'Cream', '#f6e7c8', 'n'], ['sv', 'Silver', '#cfd6e0', 'n'], ['gy', 'Grey', '#9aa1ad', 'n'],
    ['bk', 'Black', '#2d2b36', 'n'], ['tn', 'Tan', '#d4ad7f', 'n'], ['br', 'Brown', '#8a5a36', 'n'], ['dn', 'Denim', '#5a7fbf', 'n'],
    ['gd', 'Gold', '#f2bf3d', 'n'], ['rd', 'Red', '#ec4048', 'red'], ['co', 'Coral', '#ff8a73', 'red'], ['or', 'Orange', '#fb923c', 'orange'],
    ['ye', 'Yellow', '#fcd34d', 'yellow'], ['lm', 'Lime', '#a3e048', 'green'], ['gr', 'Green', '#35b86a', 'green'], ['mt', 'Mint', '#97e6c8', 'green'],
    ['tl', 'Teal', '#1cb5a6', 'teal'], ['sk', 'Sky', '#86cdf7', 'blue'], ['bl', 'Blue', '#3f7ef0', 'blue'], ['nv', 'Navy', '#283c86', 'blue'],
    ['lv', 'Lavender', '#c7b6fb', 'purple'], ['pu', 'Purple', '#9045e0', 'purple'], ['pk', 'Pink', '#f9a8d0', 'pink'], ['hp', 'Hot pink', '#ec4899', 'pink']
  ];
  const COL = {}; COLORS.forEach(([k, name, hex, fam]) => { COL[k] = { k, name, hex, fam }; });
  const colHex = (k) => (COL[k] ? COL[k].hex : (/^#[0-9a-f]{6}$/i.test(k || '') ? k : '#cccccc'));

  const PATTERNS = [
    ['so', 'Solid'], ['st', 'Stripes'], ['dt', 'Polka dots'], ['sp', 'Sparkle'], ['pl', 'Plaid'], ['fl', 'Flowers'], ['ht', 'Hearts'], ['sr', 'Stars']
  ];
  const PAT_TAGS = { st: ['pirate', 'beach', 'ocean', 'sport', 'school'], dt: ['cute', 'candy', 'party'], sp: ['sparkle', 'party', 'royal', 'glam', 'disco', 'music', 'fairy'], pl: ['autumn', 'school', 'farm', 'camping', 'western', 'rock', 'detective'], fl: ['garden', 'spring', 'tropical', 'beach'], ht: ['cute', 'candy', 'party', 'pink'], sr: ['space', 'hero', 'night', 'magic'] };

  const SKINS = ['#fde3cf', '#f7d0b0', '#eebc94', '#d9a274', '#c08457', '#9b6340', '#7a4b2f', '#5a3522'];
  const EYE_COLORS = ['#5b3a22', '#2e2420', '#3f7ef0', '#2f9e5b', '#a07032', '#6b7a8f', '#8b5cf6', '#e0559a'];
  const HAIR_COLORS = ['#2a1d18', '#5a3825', '#8c5a32', '#c98b4b', '#f1cf7a', '#f6e7b2', '#c4512c', '#9aa1ad', '#f2f2f2', '#f58fc0', '#a77bf5', '#5aa4f2', '#3fc6a6', '#ef4444', '#fb923c', '#2d3b8c'];

  const BGS = [
    ['runway', 'Runway'], ['studio', 'Studio'], ['beach', 'Beach'], ['castle', 'Castle'], ['space', 'Space'], ['city', 'City'],
    ['garden', 'Garden'], ['snow', 'Snow'], ['rain', 'Rain'], ['stage', 'Concert'], ['forest', 'Forest'], ['ocean', 'Under the sea'],
    ['stadium', 'Stadium'], ['night', 'Starry night'], ['candy', 'Candy land'], ['desert', 'Wild west']
  ];
  const POSES = [
    ['classic', 'Classic'], ['hips', 'Hands on hips'], ['wave', 'Wave'], ['star', 'Superstar'], ['shy', 'Sweet'], ['model', 'Strike a pose'], ['tada', 'Ta-da!']
  ];

  // ===================================================================================================
  // Body geometry (doll space: x 0..200, feet at y ~328)
  // ===================================================================================================
  const POSE_GEO = {
    // [upperArmAngle, forearmAngle] per side (degrees from straight down, + = away from the body), stance
    classic: { L: [11, 5], R: [11, 5], st: 3 },
    hips: { L: [40, -44], R: [40, -44], st: 6 },
    wave: { L: [11, 5], R: [146, 172], st: 3 },
    star: { L: [138, 158], R: [138, 158], st: 10 },
    shy: { L: [7, -62], R: [7, -62], st: 0 },
    model: { L: [40, -44], R: [14, 8], st: 4 },
    tada: { L: [72, 100], R: [72, 100], st: 7 }
  };
  const SH = { L: [78.5, 137], R: [121.5, 137] };
  const UPPER = 33, FORE = 31;
  function armPts(side, pose) {
    const g = POSE_GEO[pose] || POSE_GEO.classic;
    const [a1, a2] = g[side];
    const sx = side === 'L' ? -1 : 1;
    const S = SH[side];
    const r1 = a1 * Math.PI / 180, r2 = a2 * Math.PI / 180;
    const E = [S[0] + sx * Math.sin(r1) * UPPER, S[1] + Math.cos(r1) * UPPER];
    const W = [E[0] + sx * Math.sin(r2) * FORE, E[1] + Math.cos(r2) * FORE];
    return { S, E, W, sx };
  }
  const lerp = (A, B, t) => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
  const pt = (p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  function legPts(side, pose) {
    const st = (POSE_GEO[pose] || POSE_GEO.classic).st;
    const sx = side === 'L' ? -1 : 1;
    return { hip: [100 + sx * 10.4, 199], knee: [100 + sx * (12 + st * 0.45), 258], ank: [100 + sx * (13 + st), 313], sx };
  }
  // A tapered limb outline (polygon with rounded joins) between hip, knee and ankle with half-widths w.
  function limb(P, w, yEnd) {
    let { hip, knee, ank } = P;
    if (yEnd != null && yEnd < ank[1]) {
      if (yEnd <= knee[1]) { const t = (yEnd - hip[1]) / (knee[1] - hip[1]); ank = lerp(hip, knee, t); knee = lerp(hip, knee, t * 0.5); w = [w[0], w[0] + (w[1] - w[0]) * t * 0.5, w[0] + (w[1] - w[0]) * t]; }
      else { const t = (yEnd - knee[1]) / (ank[1] - knee[1]); ank = lerp(knee, ank, t); w = [w[0], w[1], w[1] + (w[2] - w[1]) * t]; }
    }
    const s = P.sx;
    const o = (p, ww) => [p[0] + s * ww, p[1]], i = (p, ww) => [p[0] - s * ww, p[1]];
    return `M ${pt(i(hip, w[0]))} L ${pt(o(hip, w[0]))} Q ${pt(o(knee, w[1] + 0.6))} ${pt(o(ank, w[2]))} L ${pt(i(ank, w[2]))} Q ${pt(i(knee, w[1] + 0.6))} ${pt(i(hip, w[0]))} Z`;
  }

  // ===================================================================================================
  // SVG helpers
  // ===================================================================================================
  let UID = 0;
  const SW = 1.5;
  const sw = (x) => (x && x.indexOf('stroke-width') >= 0 ? '' : ` stroke-width="${SW}"`);
  const P = (d, c, x) => `<path d="${d}" fill="${c.f}" stroke="${c.o}"${sw(x)} stroke-linejoin="round" stroke-linecap="round"${x ? ' ' + x : ''}/>`;
  const F = (d, fill, x) => `<path d="${d}" fill="${fill}"${x ? ' ' + x : ''}/>`;
  const L = (d, col, w, x) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w || 1.2}" stroke-linecap="round" stroke-linejoin="round"${x ? ' ' + x : ''}/>`;
  const C = (cx, cy, r, fill, stroke, x) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${stroke ? ` stroke="${stroke}"${sw(x)}` : ''}${x ? ' ' + x : ''}/>`;
  const E = (cx, cy, rx, ry, fill, stroke, x) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"${stroke ? ` stroke="${stroke}"${sw(x)}` : ''}${x ? ' ' + x : ''}/>`;
  const G = (inner, x) => `<g${x ? ' ' + x : ''}>${inner}</g>`;
  const star = (cx, cy, r, ri) => { ri = ri || r * 0.45; let d = ''; for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? ri : r; d += (k ? 'L' : 'M') + (cx + Math.cos(a) * rr).toFixed(1) + ' ' + (cy + Math.sin(a) * rr).toFixed(1) + ' '; } return d + 'Z'; };
  const glint = (cx, cy, r) => `M ${cx} ${cy - r} Q ${cx + r * 0.18} ${cy - r * 0.18} ${cx + r} ${cy} Q ${cx + r * 0.18} ${cy + r * 0.18} ${cx} ${cy + r} Q ${cx - r * 0.18} ${cy + r * 0.18} ${cx - r} ${cy} Q ${cx - r * 0.18} ${cy - r * 0.18} ${cx} ${cy - r} Z`;
  const heart = (cx, cy, s) => `M ${cx} ${cy + s * 0.9} C ${cx - s * 1.4} ${cy - s * 0.1} ${cx - s * 0.7} ${cy - s * 1.2} ${cx} ${cy - s * 0.45} C ${cx + s * 0.7} ${cy - s * 1.2} ${cx + s * 1.4} ${cy - s * 0.1} ${cx} ${cy + s * 0.9} Z`;
  // Mirror an absolute M/L/Q/C path across x = 100.
  function mirrorD(d) {
    let i = 0;
    return d.replace(/-?\d*\.?\d+/g, (n) => (i++ % 2 === 0 ? String(+(200 - parseFloat(n)).toFixed(2)) : n));
  }
  // Scalloped hem from (x1,y) to (x2,y), n bumps of depth dep (drawn as part of a path).
  function scallop(x1, x2, y, n, dep) {
    let s = '';
    const w = (x2 - x1) / n;
    for (let k = 0; k < n; k++) s += ` Q ${(x1 + w * (k + 0.5)).toFixed(1)} ${(y + dep).toFixed(1)} ${(x1 + w * (k + 1)).toFixed(1)} ${y.toFixed(1)}`;
    return s;
  }

  // A fabric: fill (solid colour or pattern), outline, base, accent, lighter and darker shades.
  function fabric(defs, pid, colKey, pat) {
    const b = colHex(colKey);
    const lu = luma(b);
    const o = shade(b, lu > 0.75 ? -0.3 : -0.42);
    const a = lu > 0.8 ? shade(b, -0.2) : lu < 0.3 ? mix(b, '#ffffff', 0.75) : mix(b, '#ffffff', 0.62);
    const c = { b, o, a, l: shade(b, 0.35), d: shade(b, -0.18), dd: shade(b, -0.32), f: b, id: pid };
    if (pat && pat !== 'so') {
      let body = `<rect width="40" height="40" fill="${b}"/>`;
      let w = 8, h = 8;
      if (pat === 'st') { w = 8; h = 8; body = `<rect width="8" height="8" fill="${b}"/><rect y="0" width="8" height="3.4" fill="${a}"/>`; }
      if (pat === 'dt') { w = 10; h = 10; body = `<rect width="10" height="10" fill="${b}"/><circle cx="2.5" cy="2.5" r="1.9" fill="${a}"/><circle cx="7.5" cy="7.5" r="1.9" fill="${a}"/>`; }
      if (pat === 'sp') { w = 18; h = 18; const g1 = lu > 0.7 ? '#e7b416' : '#fff6c9'; body = `<rect width="18" height="18" fill="${b}"/><path d="${glint(4.5, 5, 2.6)}" fill="#ffffff" opacity=".95"/><path d="${glint(13, 12.5, 2)}" fill="${g1}"/><circle cx="12.5" cy="3.5" r=".9" fill="#ffffff"/><circle cx="4" cy="14" r=".8" fill="${g1}"/><circle cx="9" cy="9" r=".6" fill="#ffffff" opacity=".8"/>`; }
      if (pat === 'pl') { w = 14; h = 14; body = `<rect width="14" height="14" fill="${b}"/><rect y="4" width="14" height="5" fill="${a}" opacity=".55"/><rect x="4" width="5" height="14" fill="${a}" opacity=".55"/><rect y="11.5" width="14" height="1" fill="${o}" opacity=".45"/><rect x="11.5" width="1" height="14" fill="${o}" opacity=".45"/>`; }
      if (pat === 'fl') { w = 16; h = 16; const pc = lu > 0.7 ? '#f472b6' : '#ffffff', pc2 = lu > 0.7 ? '#facc15' : '#fde68a'; const fl = (x, y, r) => [0, 72, 144, 216, 288].map((dg) => `<circle cx="${(x + Math.cos(dg * Math.PI / 180) * r).toFixed(2)}" cy="${(y + Math.sin(dg * Math.PI / 180) * r).toFixed(2)}" r="${r * 0.75}" fill="${pc}"/>`).join('') + `<circle cx="${x}" cy="${y}" r="${r * 0.55}" fill="${pc2}"/>`; body = `<rect width="16" height="16" fill="${b}"/>${fl(4.5, 4.5, 2)}${fl(12, 12, 1.6)}<circle cx="12" cy="4" r=".8" fill="${a}"/><circle cx="4" cy="12.5" r=".8" fill="${a}"/>`; }
      if (pat === 'ht') { w = 14; h = 14; const hc = lu > 0.7 ? '#ef4f8f' : '#ffffff'; body = `<rect width="14" height="14" fill="${b}"/><path d="${heart(3.6, 3.8, 2)}" fill="${hc}"/><path d="${heart(10.6, 10.6, 2)}" fill="${hc}"/>`; }
      if (pat === 'sr') { w = 16; h = 16; const sc = lu > 0.7 ? '#e9a90f' : '#fde68a'; body = `<rect width="16" height="16" fill="${b}"/><path d="${star(4.5, 4.5, 2.8)}" fill="${sc}"/><path d="${star(12, 12, 2.2)}" fill="${lu > 0.7 ? '#ffffff' : '#ffffff'}" opacity=".9"/><circle cx="12" cy="3.5" r=".7" fill="#ffffff"/>`; }
      defs.push(`<pattern id="${pid}" width="${w}" height="${h}" patternUnits="userSpaceOnUse">${body}</pattern>`);
      c.f = `url(#${pid})`;
    }
    return c;
  }

  // ===================================================================================================
  // Garment shape builders
  // ===================================================================================================
  // Torso garment (tops and dress bodices). t: { neck: crew|v|scoop|high|square|tank|strapless|halter, hem, flare, ruffle }
  function topD(t) {
    const hem = t.hem || 200, fl = t.flare || 0;
    const xAt = (y) => 77.5 + (84 - 77.5) * (y - 152) / 30;
    const leftDown = hem <= 182 ? ` L ${xAt(hem).toFixed(1)} ${hem}` : ` Q 83.5 166 84 182 Q ${(81.5 - fl * 0.25).toFixed(1)} 191 ${80 - fl} ${hem}`;
    const rightUp = hem <= 182 ? ' L 122.5 152' : ` Q ${(118.5 + fl * 0.25).toFixed(1)} 191 116 182 Q 116.5 166 122.5 152`;
    const lx = hem <= 182 ? xAt(hem) : 80 - fl, rx = 200 - lx;
    const hemD = t.ruffle ? scallop(lx, rx, hem, Math.max(4, Math.round((rx - lx) / 8)), 4.5) : ` Q 100 ${hem + 3} ${rx.toFixed(1)} ${hem}`;
    const body = leftDown + hemD + rightUp;
    switch (t.neck) {
      case 'tank': return `M 91 121.5 L 86 121.5 Q 84 141 77.5 152${body} Q 116 141 114 121.5 L 109 121.5 Q 100 136 91 121.5 Z`;
      case 'strapless': return `M 122.5 141 Q 111 134 100 140 Q 89 134 77.5 141 L 77.5 152${body} Z`;
      case 'halter': return `M 95 118 Q 88 138 77.5 152${body} Q 112 138 105 118 Q 100 122 95 118 Z`;
      default: {
        const nk = { crew: 'Q 100 130 92 121.5', v: 'L 100 144 L 92 121.5', scoop: 'Q 100 143 92 121.5', high: 'Q 100 124 92 121.5', square: 'L 107 134 L 93 134 L 92 121.5' }[t.neck] || 'Q 100 130 92 121.5';
        return `M 92 121.5 Q 80 123 74.5 131.5 L 77.5 152${body} L 125.5 131.5 Q 120 123 108 121.5 ${nk} Z`;
      }
    }
  }
  // Skirt from the waist: s: { top, hem, flare, style: a|puff|straight|mermaid|tutu, edge: flat|scallop|wave }
  function skirtD(s) {
    const top = s.top || 182, hem = s.hem, fl = s.flare, wl = s.wl || 84, wr = 200 - wl;
    const mid = (top + hem) / 2;
    const lx = 100 - fl, rx = 100 + fl;
    let left, right;
    if (s.style === 'puff') { left = `C ${wl - fl * 0.55} ${top + 6} ${lx} ${hem - (hem - top) * 0.45} ${lx} ${hem}`; right = `C ${rx} ${hem - (hem - top) * 0.45} ${wr + fl * 0.55} ${top + 6} ${wr} ${top}`; }
    else if (s.style === 'mermaid') { left = `C 80 ${top + 40} 90 ${hem - 60} 88 ${hem - 34} Q 84 ${hem - 10} ${lx} ${hem}`; right = `Q 116 ${hem - 10} 112 ${hem - 34} C 110 ${hem - 60} 120 ${top + 40} ${wr} ${top}`; }
    else { left = `Q ${((wl + lx) / 2 - 3).toFixed(1)} ${mid} ${lx} ${hem}`; right = `Q ${((wr + rx) / 2 + 3).toFixed(1)} ${mid} ${wr} ${top}`; }
    const n = Math.max(4, Math.round(fl / 6));
    const edge = s.edge === 'scallop' ? scallop(lx, rx, hem, n, 6) : s.edge === 'wave' ? scallop(lx, rx, hem, n, 3) : ` Q 100 ${hem + 6} ${rx} ${hem}`;
    return `M ${wl} ${top} ${left}${edge} ${right} Q 100 ${top + 2.5} ${wl} ${top} Z`;
  }
  // Draw several shapes as one silhouette: a shared outline, then the fills on top.
  function merged(ds, c, w) {
    const ww = w || 3;
    return ds.map((d) => `<path d="${d}" fill="${c.o}" stroke="${c.o}" stroke-width="${ww}" stroke-linejoin="round"/>`).join('') + ds.map((d) => `<path d="${d}" fill="${c.f}"/>`).join('');
  }
  function pantsD(pose, w, yEnd, waist) {
    const Lp = legPts('L', pose), Rp = legPts('R', pose);
    const wy = waist || 182;
    return [limb(Lp, w, yEnd), limb(Rp, w, yEnd), `M 83 ${wy} L 117 ${wy} Q 120.5 192 121.5 203 Q 110 206 100 205 Q 90 206 78.5 203 Q 79.5 192 83 ${wy} Z`];
  }
  function legEndX(side, pose, y) { const p = legPts(side, pose); const t = (y - p.knee[1]) / (p.ank[1] - p.knee[1]); return y <= p.knee[1] ? lerp(p.hip, p.knee, (y - p.hip[1]) / (p.knee[1] - p.hip[1]))[0] : lerp(p.knee, p.ank, t)[0]; }
  // The polyline of an arm from the shoulder covering fraction t of its length.
  function armPart(A, t) {
    const tot = UPPER + FORE, d = t * tot;
    if (d <= UPPER) return `M ${pt(A.S)} L ${pt(lerp(A.S, A.E, d / UPPER))}`;
    return `M ${pt(A.S)} L ${pt(A.E)} L ${pt(lerp(A.E, A.W, (d - UPPER) / FORE))}`;
  }
  const armEnd = (A, t) => { const tot = UPPER + FORE, d = t * tot; return d <= UPPER ? lerp(A.S, A.E, d / UPPER) : lerp(A.E, A.W, (d - UPPER) / FORE); };
  function strokeLimb(d, c, w) {
    return `<path d="${d}" fill="none" stroke="${c.o}" stroke-width="${w + 2.8}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${c.f}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  // Sleeves on one arm. type: short|cap|puff|three|long|bell|tight
  function sleeve(A, type, c, jacket) {
    if (!type || type === 'none') return '';
    if (jacket) {
      const end = armEnd(A, 0.86);
      return strokeLimb(armPart(A, 0.86), c, 15.5) + C(end[0].toFixed(1), end[1].toFixed(1), 6.4, c.d, c.o);
    }
    switch (type) {
      case 'cap': return strokeLimb(armPart(A, 0.13), c, 15);
      case 'short': return strokeLimb(armPart(A, 0.3), c, 14);
      case 'puff': { const p = lerp(A.S, A.E, 0.2); return strokeLimb(armPart(A, 0.26), c, 14) + E(p[0].toFixed(1), (p[1] - 1).toFixed(1), 10.5, 9.5, c.f, c.o) + L(`M ${(p[0] - 6).toFixed(1)} ${(p[1] - 6).toFixed(1)} Q ${p[0].toFixed(1)} ${(p[1] + 2).toFixed(1)} ${(p[0] + 6).toFixed(1)} ${(p[1] - 6).toFixed(1)}`, c.o, 0.9, 'opacity=".5"'); }
      case 'three': return strokeLimb(armPart(A, 0.72), c, 13);
      case 'tight': return strokeLimb(armPart(A, 0.9), c, 11.2);
      case 'bell': {
        const e = armEnd(A, 0.8), b = armEnd(A, 0.6);
        const dx = e[0] - b[0], dy = e[1] - b[1], m = Math.hypot(dx, dy) || 1, nx = -dy / m, ny = dx / m;
        const q = (p, k) => `${(p[0] + nx * k).toFixed(1)} ${(p[1] + ny * k).toFixed(1)}`;
        const tip = [e[0] + dx / m * 6, e[1] + dy / m * 6];
        return strokeLimb(armPart(A, 0.7), c, 13) + P(`M ${q(b, 6)} L ${q(tip, 12)} Q ${pt(lerp(tip, e, -0.2))} ${q(tip, -12)} L ${q(b, -6)} Z`, c);
      }
      default: return strokeLimb(armPart(A, 0.9), c, 13);
    }
  }

  // ===================================================================================================
  // Hair (back layer behind the body, front layer over the face)
  // ===================================================================================================
  const CAP_MID = 'M 58 96 C 50 50 74 25 100 25 C 126 25 150 50 142 96 Q 139 100 136 96 C 137 78 134 64 126 56 C 116 62 106 60 100 48 C 94 60 84 62 74 56 C 66 64 63 78 64 96 Q 61 100 58 96 Z';
  const MID_LINES = (h) => L('M 100 30 L 100 47', h.o, 1, 'opacity=".55"') + L('M 92 30 C 86 38 80 46 75 54', h.d, 1.1, 'opacity=".7"') + L('M 108 30 C 114 38 120 46 125 54', h.d, 1.1, 'opacity=".7"');
  const SHINE = (h, d) => L(d || 'M 74 46 Q 84 34 98 31', h.l, 3.2, 'opacity=".6"');
  function braidChain(x0, y0, x1, y1, n, w, h) {
    let s = '';
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1), x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, ww = w * (1 - t * 0.25);
      s += E(x.toFixed(1), y.toFixed(1), ww.toFixed(1), (ww * 0.95).toFixed(1), h.f, h.o) + L(`M ${(x - ww * 0.6).toFixed(1)} ${(y - 1).toFixed(1)} Q ${x.toFixed(1)} ${(y + ww * 0.5).toFixed(1)} ${(x + ww * 0.6).toFixed(1)} ${(y - 1).toFixed(1)}`, h.d, 1, 'opacity=".8"');
    }
    return s;
  }
  function cloud(cx, cy, rx, ry, n, r, h) {
    const ds = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
      ds.push(`M ${(x - r).toFixed(1)} ${y.toFixed(1)} a ${r} ${r} 0 1 0 ${(2 * r).toFixed(1)} 0 a ${r} ${r} 0 1 0 ${(-2 * r).toFixed(1)} 0 Z`);
    }
    ds.push(`M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 ${-2 * rx} 0 Z`);
    return merged(ds, h);
  }
  const HAIR = [
    { id: 'long', name: 'Long & sleek', tags: ['royal', 'fairy', 'formal'],
      back: (h) => P('M 62 60 C 62 22 138 22 138 60 C 142 100 146 150 148 196 Q 136 204 124 199 Q 112 206 100 201 Q 88 206 76 199 Q 64 204 52 196 C 54 150 58 100 62 60 Z', h) + L('M 70 120 C 68 150 66 170 64 196', h.d, 1.2, 'opacity=".6"') + L('M 130 120 C 132 150 134 170 136 196', h.d, 1.2, 'opacity=".6"'),
      front: (h) => P('M 58 104 C 50 52 72 25 102 25 C 132 25 152 52 142 104 Q 139 108 136 104 C 137 84 135 68 128 58 C 114 68 92 70 70 64 C 66 74 64 88 64 104 Q 61 108 58 104 Z', h) + L('M 104 29 C 98 42 88 52 76 60', h.d, 1.1, 'opacity=".7"') + L('M 114 31 C 118 44 124 52 129 57', h.d, 1.1, 'opacity=".7"') + SHINE(h) },
    { id: 'bob', name: 'Bob', tags: ['school', 'detective', 'art'],
      back: (h) => P('M 60 64 C 58 24 142 24 140 64 L 146 118 Q 142 128 128 125 L 72 125 Q 58 128 54 118 Z', h),
      front: (h) => P('M 55 118 C 46 52 72 24 100 24 C 128 24 154 52 145 118 Q 140 126 134 120 C 137 100 137 80 134 64 Q 118 59 100 60 Q 82 59 66 64 C 63 80 63 100 66 120 Q 60 126 55 118 Z', h) + L('M 80 60 L 82 50 M 92 60 L 93 49 M 106 60 L 106 49 M 119 60 L 118 50', h.d, 1.1, 'opacity=".6"') + SHINE(h, 'M 72 44 Q 84 32 100 30') },
    { id: 'pony', name: 'Ponytail', tags: ['sport', 'casual', 'school'],
      back: (h) => P('M 118 34 C 152 24 170 62 162 106 C 158 134 168 160 156 190 C 150 172 140 160 140 134 C 140 110 146 80 128 56 Z', h) + L('M 140 50 C 156 70 152 110 150 140', h.d, 1.2, 'opacity=".6"'),
      front: (h) => P('M 59 92 C 52 50 74 26 100 26 C 126 26 148 50 141 92 Q 139 96 137 92 C 138 74 132 60 120 52 C 106 60 84 60 70 66 C 65 74 63 82 63 92 Q 61 96 59 92 Z', h) + L('M 118 32 C 106 40 90 48 76 58', h.d, 1.1, 'opacity=".6"') + SHINE(h, 'M 72 50 Q 82 36 96 32') + C(126, 37, 5, '#f472b6', '#c2457f') },
    { id: 'pigtails', name: 'Pigtails', tags: ['cute', 'farm', 'school', 'candy'],
      back: (h) => P('M 64 64 C 42 66 30 100 34 138 C 36 160 30 176 24 190 C 44 186 56 162 54 134 C 52 112 58 92 68 80 Z', h) + P(mirrorD('M 64 64 C 42 66 30 100 34 138 C 36 160 30 176 24 190 C 44 186 56 162 54 134 C 52 112 58 92 68 80 Z'), h),
      front: (h) => P(CAP_MID, h) + MID_LINES(h) + SHINE(h, 'M 70 50 Q 78 38 92 32') + C(62, 68, 5.5, '#facc15', '#c99a08') + C(138, 68, 5.5, '#facc15', '#c99a08') },
    { id: 'buns', name: 'Space buns', tags: ['space', 'music', 'party', 'dance'],
      back: (h) => C(67, 33, 16, h.f, h.o) + C(133, 33, 16, h.f, h.o) + L('M 58 30 Q 66 22 76 30 M 124 30 Q 134 22 142 30', h.d, 1.2, 'opacity=".7"'),
      front: (h) => P(CAP_MID, h) + MID_LINES(h) + SHINE(h, 'M 70 50 Q 78 38 92 32') },
    { id: 'curly', name: 'Big curls', tags: ['music', 'disco', 'party'],
      back: (h) => cloud(100, 76, 50, 52, 16, 15, h),
      front: (h) => merged(['M 60 78 C 58 40 80 26 100 26 C 120 26 142 40 140 78 C 130 62 116 56 100 56 C 84 56 70 62 60 78 Z',
        ...[[64, 66], [72, 56], [84, 50], [97, 48], [110, 49], [122, 54], [131, 62], [137, 72]].map(([x, y]) => `M ${x - 8} ${y} a 8 8 0 1 0 16 0 a 8 8 0 1 0 -16 0 Z`)], h) +
        L('M 78 40 Q 82 34 88 36 M 108 34 Q 114 30 118 36 M 92 30 Q 98 26 102 30', h.d, 1.1, 'opacity=".6"') + SHINE(h, 'M 76 40 Q 86 30 98 30') },
    { id: 'short', name: 'Short crop', tags: ['sport', 'school', 'casual'],
      back: (h) => P('M 60 76 C 56 30 144 30 140 76 L 138 96 L 62 96 Z', h),
      front: (h) => P('M 59 86 C 54 46 74 24 100 24 C 126 24 146 46 141 86 L 138 84 C 138 72 136 64 132 58 L 124 62 L 119 54 L 111 60 L 103 52 L 96 60 L 88 54 L 82 61 L 74 57 C 68 64 63 72 62 84 Z', h) + L('M 86 30 C 92 40 96 46 98 52 M 112 30 C 112 40 112 46 111 54', h.d, 1.1, 'opacity=".6"') + SHINE(h, 'M 72 46 Q 82 32 96 29') },
    { id: 'spiky', name: 'Spiky', tags: ['rock', 'hero', 'sport'],
      back: (h) => P('M 60 76 C 56 30 144 30 140 76 L 138 96 L 62 96 Z', h),
      front: (h) => P('M 59 86 C 56 60 60 48 64 42 L 54 30 L 72 32 L 70 14 L 87 25 L 95 5 L 105 23 L 118 7 L 121 27 L 138 18 L 136 35 L 149 37 L 139 49 C 142 60 142 72 141 86 L 137 84 C 137 72 135 64 131 58 L 120 62 L 114 54 L 104 60 L 96 52 L 88 60 L 80 54 L 72 60 C 66 66 63 74 63 84 Z', h) + L('M 95 12 L 98 40 M 118 14 L 112 40 M 72 22 L 82 42', h.d, 1.1, 'opacity=".6"') + SHINE(h, 'M 74 46 Q 84 36 96 34') },
    { id: 'braids', name: 'Two braids', tags: ['farm', 'fairy', 'camping', 'school'],
      back: (h) => P('M 60 70 C 58 26 142 26 140 70 L 140 100 L 60 100 Z', h) + braidChain(60, 98, 56, 178, 8, 8, h) + braidChain(140, 98, 144, 178, 8, 8, h) + C(56, 186, 3.5, '#f472b6', '#c2457f') + C(144, 186, 3.5, '#f472b6', '#c2457f') + P('M 52 188 Q 56 200 60 188 Z M 140 188 Q 144 200 148 188 Z', h),
      front: (h) => P(CAP_MID, h) + MID_LINES(h) + SHINE(h, 'M 70 50 Q 78 38 92 32') },
    { id: 'wavy', name: 'Long waves', tags: ['beach', 'fairy', 'garden', 'formal'],
      back: (h) => P('M 62 60 C 60 22 140 22 138 60 C 150 90 140 110 150 140 C 158 165 146 185 152 208 Q 126 216 100 209 Q 74 216 48 208 C 54 185 42 165 50 140 C 60 110 50 90 62 60 Z', h) + L('M 64 120 C 56 146 70 168 60 196 M 136 120 C 144 146 130 168 140 196', h.d, 1.2, 'opacity=".6"'),
      front: (h) => P('M 58 110 C 46 56 72 25 100 25 C 128 25 154 56 142 110 C 138 116 132 112 134 104 C 136 90 138 70 128 56 C 118 52 106 44 100 36 C 94 44 82 52 72 56 C 62 70 64 90 66 104 C 68 112 62 116 58 110 Z', h) + L('M 100 30 L 100 36', h.o, 1, 'opacity=".5"') + SHINE(h, 'M 70 54 Q 76 40 90 33') },
    { id: 'topbun', name: 'Top bun', tags: ['ballet', 'dance', 'formal', 'chef'],
      back: (h) => C(100, 21, 16, h.f, h.o) + L('M 90 16 Q 100 8 110 16', h.d, 1.2, 'opacity=".7"'),
      front: (h) => P('M 59 92 C 52 48 74 27 100 27 C 126 27 148 48 141 92 Q 139 96 137 92 C 138 70 128 50 100 46 C 72 50 62 70 63 92 Q 61 96 59 92 Z', h) + L('M 84 32 C 76 40 70 50 66 62 M 116 32 C 124 40 130 50 134 62', h.d, 1.1, 'opacity=".6"') + E(100, 34, 10, 4, '#f9a8d0', '#c2457f') + SHINE(h, 'M 72 50 Q 80 38 92 34') },
    { id: 'swoop', name: 'Side swoop', tags: ['formal', 'rock', 'music'],
      back: (h) => P('M 60 76 C 56 30 144 30 140 76 L 138 98 L 62 98 Z', h),
      front: (h) => P('M 59 88 C 52 46 76 22 104 23 C 132 24 150 48 141 88 L 137 86 C 138 76 137 68 134 62 C 128 66 116 66 104 60 C 94 56 86 52 80 52 C 70 58 64 70 63 86 Z', h) + L('M 80 40 C 96 46 114 56 128 62 M 92 32 C 108 38 122 48 134 58 M 80 50 C 76 44 78 36 86 30', h.d, 1.1, 'opacity=".65"') + SHINE(h, 'M 96 30 Q 110 27 124 32') },
    { id: 'pixie', name: 'Pixie', tags: ['fairy', 'art', 'casual'],
      back: (h) => P('M 60 76 C 56 30 144 30 140 76 L 140 100 L 60 100 Z', h),
      front: (h) => P('M 58 98 C 50 52 74 25 100 25 C 128 25 148 50 142 92 Q 140 98 137 94 C 137 80 135 68 130 60 C 118 64 104 62 94 56 C 90 66 80 72 70 72 C 66 80 64 88 64 100 Q 60 104 58 98 Z', h) + L('M 96 30 C 92 40 92 48 94 56 M 110 30 C 116 40 122 50 128 58', h.d, 1.1, 'opacity=".6"') + SHINE(h, 'M 72 50 Q 80 38 92 32') },
    { id: 'curtain', name: 'Curtains', tags: ['music', 'casual', 'school'],
      back: (h) => P('M 60 66 C 58 26 142 26 140 66 L 144 114 Q 140 122 132 118 L 68 118 Q 60 122 56 114 Z', h),
      front: (h) => P('M 56 112 C 48 54 72 25 100 25 C 128 25 152 54 144 112 Q 140 118 135 112 C 136 92 134 72 124 62 C 114 58 104 52 100 44 C 96 52 86 58 76 62 C 66 72 64 92 65 112 Q 60 118 56 112 Z', h) + L('M 100 29 L 100 43', h.o, 1, 'opacity=".5"') + L('M 90 32 C 84 40 78 48 72 58 M 110 32 C 116 40 122 48 128 58', h.d, 1.1, 'opacity=".6"') + SHINE(h, 'M 70 52 Q 78 38 92 32') },
    { id: 'sidebraid', name: 'Side braid', tags: ['fairy', 'royal', 'garden', 'camping'],
      back: (h) => P('M 62 60 C 60 24 140 24 138 60 L 142 112 L 58 112 Z', h),
      front: (h) => P('M 58 104 C 50 52 72 25 102 25 C 132 25 152 52 142 104 Q 139 108 136 104 C 137 84 135 68 128 58 C 114 68 92 70 70 64 C 66 74 64 88 64 104 Q 61 108 58 104 Z', h) + braidChain(136, 104, 128, 176, 7, 8, h) + C(128, 183, 3.6, '#a78bfa', '#6d4fd1') + P('M 124 185 Q 128 198 132 185 Z', h) + SHINE(h) },
    { id: 'buzz', name: 'Buzz cut', tags: ['sport', 'hero', 'space'],
      back: () => '',
      front: (h) => P('M 60.5 80 C 58 42 76 29 100 29 C 124 29 142 42 139.5 80 L 137 78 C 136 66 132 58 126 54 Q 100 47 74 54 C 68 58 64 66 63 78 Z', h) + SHINE(h, 'M 76 44 Q 86 36 98 35') },
    { id: 'afro', name: 'Puff', tags: ['party', 'music', 'sport', 'disco'],
      back: (h) => cloud(100, 30, 28, 18, 10, 11, h),
      front: (h) => P('M 59.5 84 C 56 46 76 30 100 30 C 124 30 144 46 140.5 84 L 137 82 C 136 68 130 58 120 54 Q 100 48 80 54 C 70 58 64 68 63 82 Z', h) + E(100, 44, 18, 4.5, '#f9a8d0', '#c2457f') + SHINE(h, 'M 78 44 Q 88 38 98 37') }
  ];
  const HAIR_BY = {}; HAIR.forEach((x) => { HAIR_BY[x.id] = x; });

  // ===================================================================================================
  // Face
  // ===================================================================================================
  const INK = '#2a1d24';
  const EYES = [['sparkle', 'Sparkly'], ['lashes', 'Lashes'], ['round', 'Button'], ['happy', 'Happy'], ['wink', 'Wink'], ['stars', 'Starry'], ['sleepy', 'Dreamy'], ['big', 'Big & bright']];
  const BROWS = [['soft', 'Soft'], ['thick', 'Bold'], ['raised', 'Surprised'], ['determined', 'Determined'], ['short', 'Dots'], ['none', 'None']];
  const MOUTHS = [['smile', 'Smile'], ['grin', 'Big grin'], ['teeth', 'Cheesy'], ['o', 'Ooh'], ['cat', 'Kitty'], ['smirk', 'Cheeky'], ['tongue', 'Silly']];
  const BLUSH = [['soft', 'Soft blush'], ['rosy', 'Rosy'], ['freckles', 'Freckles'], ['star', 'Star sticker'], ['heart', 'Heart sticker'], ['none', 'None']];
  function eye(x, y, kind, iris, side, skin) {
    const lash = (w) => L(`M ${x - 8.5} ${y - 4.5} Q ${x} ${y - 12.5} ${x + 8.5} ${y - 4.5}`, INK, w || 2.4);
    const flick = side < 0 ? `M ${x - 8} ${y - 4.8} L ${x - 11.5} ${y - 8}` : `M ${x + 8} ${y - 4.8} L ${x + 11.5} ${y - 8}`;
    const irisBlock = (rx, ry) => E(x, y, rx, ry, INK) + E(x, y + 0.6, rx - 1.1, ry - 1.1, iris) + F(`M ${x - rx + 1.6} ${y + 1} Q ${x} ${y + ry + 1.5} ${x + rx - 1.6} ${y + 1} Q ${x} ${y + ry * 0.35} ${x - rx + 1.6} ${y + 1} Z`, shade(iris, 0.35), 'opacity=".8"') + E(x, y + 0.4, rx * 0.5, ry * 0.52, '#1b1218');
    switch (kind) {
      case 'round': return E(x, y + 1, 4.8, 5.8, INK) + C(x + 1.7, y - 1.2, 1.7, '#fff');
      case 'happy': return L(`M ${x - 7.5} ${y + 2} Q ${x} ${y - 7} ${x + 7.5} ${y + 2}`, INK, 2.8);
      case 'wink': return side > 0 ? L(`M ${x - 7.5} ${y + 1} Q ${x} ${y - 6} ${x + 7.5} ${y + 1}`, INK, 2.8) : eye(x, y, 'sparkle', iris, side, skin);
      case 'sleepy': return irisBlock(6.6, 8.4) + F(`M ${x - 9} ${y - 10} L ${x + 9} ${y - 10} L ${x + 9} ${y - 0.5} Q ${x} ${y - 3} ${x - 9} ${y - 0.5} Z`, skin) + L(`M ${x - 8.5} ${y - 0.5} Q ${x} ${y - 3.5} ${x + 8.5} ${y - 0.5}`, INK, 2.4) + C(x + 2.3, y + 2, 1.6, '#fff') + L(side < 0 ? `M ${x - 8} ${y - 1} L ${x - 11} ${y - 3}` : `M ${x + 8} ${y - 1} L ${x + 11} ${y - 3}`, INK, 1.8);
      case 'stars': return irisBlock(6.6, 8.4) + F(star(x + 0.2, y + 0.6, 4.6, 2), '#fff6c9') + C(x + 2.6, y - 4, 1.6, '#fff') + lash() + L(flick, INK, 2);
      case 'big': return irisBlock(7.6, 9.6) + C(x + 2.6, y - 3.8, 2.8, '#fff') + C(x - 2.8, y + 4.2, 1.4, '#fff') + E(x, y + 0.4, 4.2, 5.2, 'none', '#ffffff', 'opacity=".25"') + L(`M ${x - 9.5} ${y - 5.5} Q ${x} ${y - 14.5} ${x + 9.5} ${y - 5.5}`, INK, 2.6) + L(flick, INK, 2);
      case 'lashes': return irisBlock(6.6, 8.4) + C(x + 2.3, y - 3.4, 2.3, '#fff') + C(x - 2.4, y + 3.6, 1.1, '#fff') + lash(2.6) + L(flick, INK, 2) + L(side < 0 ? `M ${x - 6} ${y - 8} L ${x - 8.5} ${y - 11.5}` : `M ${x + 6} ${y - 8} L ${x + 8.5} ${y - 11.5}`, INK, 1.8);
      default: return irisBlock(6.6, 8.4) + C(x + 2.3, y - 3.4, 2.3, '#fff') + C(x - 2.4, y + 3.6, 1.1, '#fff') + lash();
    }
  }
  function face(o, skin, browCol) {
    const iris = EYE_COLORS[o.ec] || EYE_COLORS[0];
    const ex = [84, 116], ey = 84;
    let s = '';
    // blush under everything
    if (o.bl === 'soft') s += E(76, 95, 7, 3.8, '#ff6f91', null, 'opacity=".28"') + E(124, 95, 7, 3.8, '#ff6f91', null, 'opacity=".28"');
    if (o.bl === 'rosy') s += E(76, 95, 7.5, 4.2, '#ff5c84', null, 'opacity=".45"') + E(124, 95, 7.5, 4.2, '#ff5c84', null, 'opacity=".45"') + L('M 72 94 L 74 92 M 76 94 L 78 92 M 122 94 L 124 92 M 126 94 L 128 92', '#ffffff', 1, 'opacity=".7"');
    if (o.bl === 'freckles') s += [[73, 94], [77, 96], [79, 92.5], [75, 91], [121, 92.5], [123, 96], [127, 94], [125, 91]].map(([x, y]) => C(x, y, 0.95, shade(skin, -0.35))).join('') + E(76, 96, 6, 3, '#ff6f91', null, 'opacity=".18"') + E(124, 96, 6, 3, '#ff6f91', null, 'opacity=".18"');
    if (o.bl === 'star') s += E(76, 95, 6, 3.4, '#ff6f91', null, 'opacity=".25"') + F(star(125, 95, 5.4, 2.4), '#fcd34d', 'stroke="#d39b0b" stroke-width="1" stroke-linejoin="round"');
    if (o.bl === 'heart') s += F(heart(76, 95, 4.2), '#ff7aa8', 'stroke="#d94a7d" stroke-width="1"') + E(124, 95, 6, 3.4, '#ff6f91', null, 'opacity=".25"');
    s += eye(ex[0], ey, o.ey, iris, -1, skin) + eye(ex[1], ey, o.ey, iris, 1, skin);
    const bc = browCol;
    const by = o.br === 'raised' ? 64 : 69.5;
    if (o.br === 'soft' || o.br === 'raised') s += L(`M 77 ${by} Q 84 ${by - 3.5} 91 ${by - 0.5} M 109 ${by - 0.5} Q 116 ${by - 3.5} 123 ${by}`, bc, 2.2);
    if (o.br === 'thick') s += L(`M 77 ${by} Q 84 ${by - 3.5} 91 ${by - 0.8} M 109 ${by - 0.8} Q 116 ${by - 3.5} 123 ${by}`, bc, 3.6);
    if (o.br === 'determined') s += L('M 77 66 Q 85 66.5 91 70 M 109 70 Q 115 66.5 123 66', bc, 2.8);
    if (o.br === 'short') s += E(83, 69, 3, 1.7, bc) + E(117, 69, 3, 1.7, bc);
    s += L('M 98.5 91.5 Q 100.3 93.3 102 91.5', shade(skin, -0.3), 1.4);
    const lip = '#7a2e3b';
    switch (o.mo) {
      case 'grin': s += F('M 92 97.5 Q 100 99.5 108 97.5 Q 106.5 107.5 100 107.5 Q 93.5 107.5 92 97.5 Z', lip) + F('M 95 104.4 Q 100 101 105 104.4 Q 103.2 107.4 100 107.4 Q 96.8 107.4 95 104.4 Z', '#f47d90'); break;
      case 'teeth': s += F('M 92 97.5 Q 100 99.5 108 97.5 Q 106.5 107.5 100 107.5 Q 93.5 107.5 92 97.5 Z', lip) + F('M 93 98.4 Q 100 100.2 107 98.4 L 106.6 100.6 Q 100 102 93.4 100.6 Z', '#ffffff') + F('M 96 105 Q 100 102.4 104 105 Q 102.4 107.3 100 107.3 Q 97.6 107.3 96 105 Z', '#f47d90'); break;
      case 'o': s += E(100, 100.5, 3.4, 4, lip) + E(100, 102, 2, 1.6, '#f47d90'); break;
      case 'cat': s += L('M 92 98 Q 96 102.5 100 98.5 Q 104 102.5 108 98', lip, 2); break;
      case 'smirk': s += L('M 93.5 100 Q 102 103.5 107.5 97', lip, 2.2) + L('M 107.5 97 L 109 96', lip, 1.6); break;
      case 'tongue': s += L('M 93 98 Q 100 104.5 107 98', lip, 2.2) + F('M 101.5 101.6 Q 102 107.5 105.5 107 Q 108.6 106.4 106.8 100 Z', '#f47d90', `stroke="${lip}" stroke-width="1.2"`); break;
      default: s += L('M 93 98 Q 100 104.5 107 98', lip, 2.2);
    }
    return s;
  }

  // ===================================================================================================
  // Clothes. Each item: id, name, tags (theme words), col (default colour), pat (default pattern),
  // draw(c, g) -> svg string or { back, legs, main, front }. c = the fabric, g = { pose, A: arms }.
  // ===================================================================================================
  const WHITE = { f: '#fbfaf7', o: '#b9b3aa', b: '#fbfaf7', d: '#e6e1d9', l: '#ffffff', a: '#e6e1d9', dd: '#cfc8bd' };
  const GOLD = { f: '#f2bf3d', o: '#a87612', b: '#f2bf3d', d: '#d9a21d', l: '#ffe7a3', a: '#fff1c4', dd: '#b8860b' };
  const SILVER = { f: '#d7dde6', o: '#7f8a99', b: '#d7dde6', d: '#b6bfcc', l: '#f4f6f9', a: '#ffffff', dd: '#97a1b0' };
  const DARK = { f: '#2d2b36', o: '#141219', b: '#2d2b36', d: '#22202a', l: '#5a5766', a: '#5a5766', dd: '#141219' };
  const solid = (hex) => ({ f: hex, o: shade(hex, -0.42), b: hex, d: shade(hex, -0.18), l: shade(hex, 0.35), a: shade(hex, 0.6), dd: shade(hex, -0.32) });
  const btn = (x, y, c, r) => C(x, y, r || 1.6, c.d || c, c.o || null);
  const lines = (d, c, w) => L(d, c.o, w || 1, 'opacity=".55"');

  const TOPS = [
    { id: 'tee', name: 'T-shirt', tags: ['casual', 'summer', 'school', 'beach', 'camping'], col: 'sk', sl: 'short', draw: (c) => P(topD({ neck: 'crew', hem: 200 }), c) + lines('M 92 122 Q 100 130.5 108 122', c, 1.4) },
    { id: 'startee', name: 'Star tee', tags: ['casual', 'rock', 'music', 'party', 'space'], col: 'bk', sl: 'short', draw: (c) => P(topD({ neck: 'crew', hem: 200 }), c) + F(star(100, 160, 14, 6.5), '#fcd34d', 'stroke="#c99a08" stroke-width="1.2" stroke-linejoin="round"') + lines('M 92 122 Q 100 130.5 108 122', c, 1.4) },
    { id: 'tank', name: 'Tank top', tags: ['summer', 'beach', 'sport', 'casual', 'tropical'], col: 'co', sl: 'none', draw: (c) => P(topD({ neck: 'tank', hem: 198 }), c) },
    { id: 'crop', name: 'Crop top', tags: ['summer', 'party', 'disco', 'music', 'dance', 'beach'], col: 'hp', sl: 'short', draw: (c) => P(topD({ neck: 'scoop', hem: 172 }), c) },
    { id: 'blouse', name: 'Frilly blouse', tags: ['garden', 'formal', 'spring', 'school', 'cute', 'wedding'], col: 'wh', sl: 'puff', draw: (c) => P(topD({ neck: 'crew', hem: 196, flare: 2, ruffle: true }), c) + P('M 92 121.5 Q 82 127 86 135 Q 95 138 100 129 Z', WHITE) + P(mirrorD('M 92 121.5 Q 82 127 86 135 Q 95 138 100 129 Z'), WHITE) + btn(100, 146, c) + btn(100, 160, c) + btn(100, 174, c) },
    { id: 'sweater', name: 'Cosy jumper', tags: ['winter', 'autumn', 'cozy', 'school', 'ski', 'camping'], col: 'rd', sl: 'long', draw: (c) => P(topD({ neck: 'crew', hem: 204, flare: 1 }), c) + P('M 79.5 196 Q 100 199 120.5 196 L 121 204 Q 100 207 79 204 Z', c) + lines('M 84 197 L 84 204 M 90 198 L 90 205 M 96 198 L 96 205 M 102 198 L 102 205 M 108 198 L 108 205 M 114 197 L 114 204', c) + P('M 92 121.5 Q 100 130 108 121.5 Q 100 135 92 121.5 Z', c) + L('M 82 150 Q 100 156 118 150', c.a, 2.4, 'opacity=".8"') + L('M 83 160 Q 100 166 117 160', c.a, 2.4, 'opacity=".8"') },
    { id: 'hoodie', name: 'Hoodie', tags: ['casual', 'cozy', 'winter', 'camping', 'sport', 'school'], col: 'lv', sl: 'long', draw: (c) => P('M 80 132 Q 74 110 100 107 Q 126 110 120 132 Z', c) + P(topD({ neck: 'crew', hem: 204, flare: 1 }), c) + P('M 85 178 L 115 178 L 119 197 L 81 197 Z', c) + lines('M 85 178 L 81 190 M 115 178 L 119 190', c) + L('M 95 128 L 94 150 M 105 128 L 106 150', c.a, 1.6) + C(94, 151, 1.6, c.a) + C(106, 151, 1.6, c.a) },
    { id: 'jersey', name: 'Sports jersey', tags: ['sport', 'casual'], col: 'bl', sl: 'short', draw: (c) => P(topD({ neck: 'v', hem: 202 }), c) + L('M 92 122 L 100 144 L 108 122', '#ffffff', 2.4) + `<text x="100" y="178" text-anchor="middle" font-family="Outfit, system-ui, sans-serif" font-weight="800" font-size="28" fill="#ffffff" stroke="${c.o}" stroke-width="1">7</text>` + L('M 80 193 Q 100 197 120 193', '#ffffff', 2.4) },
    { id: 'shirt', name: 'Button shirt', tags: ['formal', 'school', 'detective', 'farm', 'western', 'wedding'], col: 'wh', sl: 'long', draw: (c) => P(topD({ neck: 'v', hem: 204 }), c) + P('M 92 121 L 86 134 L 98 138 Z', c) + P(mirrorD('M 92 121 L 86 134 L 98 138 Z'), c) + L('M 100 140 L 100 202', c.o, 1, 'opacity=".5"') + btn(100, 150, c, 1.4) + btn(100, 166, c, 1.4) + btn(100, 182, c, 1.4) + P('M 84 150 L 94 150 L 94 160 Q 89 162 84 160 Z', c) },
    { id: 'turtle', name: 'Turtleneck', tags: ['winter', 'detective', 'autumn', 'formal', 'art'], col: 'bk', sl: 'long', draw: (c) => P(topD({ neck: 'high', hem: 202 }), c) + P('M 90.5 109 L 109.5 109 L 110.5 126 Q 100 129.5 89.5 126 Z', c) + lines('M 94 111 L 94 127 M 100 111 L 100 128 M 106 111 L 106 127', c) },
    { id: 'sailor', name: 'Sailor top', tags: ['ocean', 'beach', 'pirate', 'school', 'cute'], col: 'wh', sl: 'short', draw: (c) => P(topD({ neck: 'v', hem: 198 }), c) + P('M 92 121.5 L 74.5 132 L 79 146 L 100 145 Z', solid('#283c86')) + P(mirrorD('M 92 121.5 L 74.5 132 L 79 146 L 100 145 Z'), solid('#283c86')) + L('M 80 140 L 96 140', '#ffffff', 1.4) + L(mirrorD('M 80 140 L 96 140'), '#ffffff', 1.4) + P('M 100 145 L 90 138 L 91 152 Z M 100 145 L 110 138 L 109 152 Z', solid('#ec4048')) + C(100, 145, 2.6, '#ec4048', '#9b1d24') },
    { id: 'pirate', name: 'Pirate shirt', tags: ['pirate', 'medieval', 'fairy'], col: 'cr', sl: 'bell', draw: (c) => P(topD({ neck: 'v', hem: 206, flare: 3 }), c) + L('M 95 128 L 105 134 M 105 128 L 95 134 M 96 136 L 104 141 M 104 136 L 96 141', '#8a5a36', 1.3) + P('M 92 121.5 Q 86 130 90 137 L 96 128 Z', c) + P(mirrorD('M 92 121.5 Q 86 130 90 137 L 96 128 Z'), c) + L('M 84 170 Q 86 186 84 200 M 116 170 Q 114 186 116 200', c.o, 1, 'opacity=".4"') },
    { id: 'hero', name: 'Hero top', tags: ['hero', 'sport', 'space'], col: 'bl', sl: 'tight', draw: (c) => P(topD({ neck: 'crew', hem: 200 }), c) + C(100, 152, 12.5, '#fcd34d', '#c99a08') + F(star(100, 153, 8.5, 3.8), '#ec4048', 'stroke="#9b1d24" stroke-width="1" stroke-linejoin="round"') + P('M 82 186 L 118 186 L 118.5 194 L 81.5 194 Z', solid('#fcd34d')) },
    { id: 'tunic', name: 'Royal tunic', tags: ['medieval', 'royal', 'fairy', 'pirate'], col: 'pu', sl: 'long', draw: (c) => P(topD({ neck: 'v', hem: 222, flare: 8 }), c) + P('M 82 186 L 118 186 L 119 194 L 81 194 Z', solid('#8a5a36')) + P('M 96 186 L 104 186 L 104 194 L 96 194 Z', GOLD) + L('M 92 122 L 100 144 L 108 122', GOLD.f, 2.2) + F(star(100, 165, 7, 3), GOLD.f, `stroke="${GOLD.o}" stroke-width="1"`) }
  ];

  // Dresses and one-pieces. over: true = worn over a top. sl: sleeves.
  const DRESSES = [
    { id: 'sundress', name: 'Sundress', tags: ['summer', 'beach', 'garden', 'spring', 'tropical'], col: 'ye', pat: 'fl', sl: 'none', draw: (c) => P(skirtD({ hem: 258, flare: 34 }), c) + P(topD({ neck: 'tank', hem: 184 }), c) + P('M 84 179 Q 100 183 116 179 L 116.5 186 Q 100 190 83.5 186 Z', WHITE) + P('M 100 183 L 92 177 L 92 189 Z M 100 183 L 108 177 L 108 189 Z', WHITE) + lines('M 90 200 L 84 252 M 110 200 L 116 252 M 100 192 L 100 260', c) },
    { id: 'ballgown', name: 'Ball gown', tags: ['royal', 'formal', 'fairy', 'wedding', 'glam'], col: 'pk', pat: 'sp', sl: 'puff', draw: (c) => P(skirtD({ hem: 324, flare: 70, style: 'puff', edge: 'wave' }), c) + lines('M 92 190 Q 76 260 62 320 M 100 190 L 100 328 M 108 190 Q 124 260 138 320 M 86 188 Q 60 250 40 318 M 114 188 Q 140 250 160 318', c) + P(topD({ neck: 'strapless', hem: 184 }), c) + P('M 84 179 Q 100 184 116 179 L 116.5 186 Q 100 191 83.5 186 Z', c) + F(glint(100, 160, 5), '#ffffff', 'opacity=".9"') },
    { id: 'princess', name: 'Princess dress', tags: ['royal', 'fairy', 'cute', 'wedding', 'candy'], col: 'lv', pat: 'so', sl: 'puff', draw: (c) => P(skirtD({ hem: 322, flare: 62, style: 'puff', edge: 'wave' }), { f: c.l, o: c.o }) + P(skirtD({ hem: 276, flare: 56, style: 'puff', edge: 'scallop' }), c) + P(topD({ neck: 'square', hem: 184 }), c) + C(100, 140, 4, GOLD.f, GOLD.o) + P('M 84 179 Q 100 184 116 179 L 116.5 186 Q 100 191 83.5 186 Z', GOLD) },
    { id: 'tutu', name: 'Ballet tutu', tags: ['ballet', 'dance', 'fairy', 'cute', 'party'], col: 'pk', sl: 'none', draw: (c) => P(topD({ neck: 'tank', hem: 204 }), c) + P(skirtD({ top: 188, hem: 228, flare: 46, edge: 'scallop' }), { f: c.l, o: c.o }, 'opacity=".9"') + P(skirtD({ top: 186, hem: 220, flare: 40, edge: 'scallop' }), c, 'opacity=".95"') + F(glint(90, 210, 3), '#fff') + F(glint(112, 214, 2.5), '#fff') + C(100, 128, 0.01, 'none') },
    { id: 'party', name: 'Party dress', tags: ['party', 'birthday', 'disco', 'candy', 'dance'], col: 'hp', pat: 'dt', sl: 'cap', draw: (c) => P(skirtD({ hem: 238, flare: 34 }), c) + lines('M 92 192 L 84 234 M 108 192 L 116 234 M 100 192 L 100 240', c) + P(topD({ neck: 'scoop', hem: 184 }), c) + P('M 84 179 Q 100 184 116 179 L 116.5 186 Q 100 191 83.5 186 Z', DARK) },
    { id: 'gown', name: 'Starry gown', tags: ['formal', 'glam', 'night', 'royal', 'music'], col: 'nv', pat: 'sp', sl: 'none', draw: (c) => P(skirtD({ hem: 324, flare: 34, wl: 85 }), c) + lines('M 96 200 Q 92 260 88 322 M 106 200 Q 110 260 114 322', c) + P(topD({ neck: 'halter', hem: 186 }), c) },
    { id: 'mermaid', name: 'Mermaid gown', tags: ['ocean', 'beach', 'glam', 'fairy'], col: 'tl', pat: 'sp', sl: 'none', draw: (c) => P(skirtD({ hem: 324, flare: 44, style: 'mermaid', edge: 'scallop' }), c) + P('M 88 290 Q 100 300 112 290 Q 128 312 140 322 Q 100 336 60 322 Q 72 312 88 290 Z', { f: c.l, o: c.o }, 'opacity=".8"') + P(topD({ neck: 'strapless', hem: 186 }), c) + E(91, 142, 7, 5, c.l, c.o) + E(109, 142, 7, 5, c.l, c.o) },
    { id: 'tiered', name: 'Ruffle dress', tags: ['dance', 'party', 'garden', 'spring', 'western'], col: 'rd', pat: 'dt', sl: 'short', draw: (c) => P(skirtD({ hem: 272, flare: 46, edge: 'scallop' }), c) + P(skirtD({ hem: 240, flare: 38, edge: 'scallop' }), { f: c.l, o: c.o }) + P(skirtD({ hem: 212, flare: 28, edge: 'scallop' }), c) + P(topD({ neck: 'v', hem: 184 }), c) },
    { id: 'pinafore', name: 'Pinafore', tags: ['school', 'farm', 'cute', 'art', 'autumn'], col: 'dn', over: true, sl: 'none', draw: (c) => P(skirtD({ hem: 248, flare: 28 }), c) + P('M 86 140 L 114 140 L 116 184 L 84 184 Z', c) + L('M 87 141 L 84 124 M 113 141 L 116 124', c.f, 4) + btn(87, 142, GOLD, 1.8) + btn(113, 142, GOLD, 1.8) + P('M 94 150 L 106 150 L 106 162 Q 100 165 94 162 Z', c) },
    { id: 'overalls', name: 'Dungarees', tags: ['farm', 'camping', 'casual', 'art', 'school'], col: 'dn', over: true, sl: 'none', draw: (c, g) => ({ legs: merged(pantsD(g.pose, [12.4, 10, 8.6], 312), c) + L('M 100 206 L 100 214', c.o, 1, 'opacity=".5"'), main: P('M 84 146 L 116 146 L 118 196 Q 100 200 82 196 Z', c) + L('M 86 147 L 82 126 M 114 147 L 118 126', c.f, 4.2) + btn(86, 148, GOLD, 2) + btn(114, 148, GOLD, 2) + P('M 92 156 L 108 156 L 108 170 Q 100 173 92 170 Z', c) }) },
    { id: 'jumpsuit', name: 'Disco jumpsuit', tags: ['disco', 'party', 'glam', 'music', 'space'], col: 'gd', pat: 'sp', sl: 'none', draw: (c, g) => ({ legs: merged(pantsD(g.pose, [13, 12, 15.5], 316), c), main: P(topD({ neck: 'v', hem: 204 }), c) + P('M 83 182 L 117 182 L 117.6 190 L 82.4 190 Z', DARK) }) },
    { id: 'spacesuit', name: 'Space suit', tags: ['space', 'costume', 'adventure'], col: 'wh', sl: 'long', draw: (c, g) => ({ legs: merged(pantsD(g.pose, [13.5, 11.5, 10], 300), c) + L(`M ${legEndX('L', g.pose, 258) - 10} 258 L ${legEndX('L', g.pose, 258) + 9} 258 M ${legEndX('R', g.pose, 258) - 9} 258 L ${legEndX('R', g.pose, 258) + 10} 258`, c.o, 1.2, 'opacity=".6"'), main: P(topD({ neck: 'high', hem: 204, flare: 2 }), c) + P('M 88 140 L 112 140 L 112 166 L 88 166 Z', solid('#cfd6e0')) + C(94, 148, 2.5, '#ec4048', '#9b1d24') + C(102, 148, 2.5, '#35b86a', '#1e7a43') + C(108, 148, 2.5, '#3f7ef0', '#1d4bb5') + L('M 92 158 L 108 158', '#7f8a99', 2) + P('M 82 186 L 118 186 L 119 195 L 81 195 Z', solid('#3f7ef0')) + P('M 88 110 L 112 110 L 114 124 Q 100 128 86 124 Z', SILVER) }) },
    { id: 'herosuit', name: 'Hero suit', tags: ['hero', 'costume', 'sport'], col: 'rd', sl: 'tight', draw: (c, g) => ({ legs: merged(pantsD(g.pose, [11, 7.8, 5.8], 314), c), main: P(topD({ neck: 'crew', hem: 202 }), c) + P('M 86 140 L 114 140 L 100 170 Z', solid('#fcd34d')) + F(star(100, 150, 6, 2.6), '#ec4048') + P('M 82 186 L 118 186 L 118.5 194 L 81.5 194 Z', solid('#fcd34d')) + P('M 96 185 L 104 185 L 104 195 L 96 195 Z', solid('#f59e0b')) }) },
    { id: 'onesie', name: 'Cosy onesie', tags: ['pajama', 'cozy', 'winter', 'cute'], col: 'sk', pat: 'sr', sl: 'long', draw: (c, g) => ({ legs: merged(pantsD(g.pose, [12.6, 10.6, 9], 306), c) + L(`M ${legEndX('L', g.pose, 300) - 9} 302 L ${legEndX('L', g.pose, 300) + 9} 302 M ${legEndX('R', g.pose, 300) - 9} 302 L ${legEndX('R', g.pose, 300) + 9} 302`, c.o, 3, 'opacity=".4"'), main: P(topD({ neck: 'crew', hem: 204, flare: 2 }), c) + L('M 100 128 L 100 200', c.o, 1.2, 'opacity=".6"') + C(100, 130, 2, SILVER.f, SILVER.o) + E(100, 176, 12, 14, c.l, c.o, 'opacity=".8"') }) },
    { id: 'pumpkin', name: 'Pumpkin costume', tags: ['spooky', 'costume', 'autumn', 'cute'], col: 'or', sl: 'none', draw: (c) => P(topD({ neck: 'tank', hem: 200 }), DARK) + P('M 100 128 C 60 126 52 150 54 172 C 56 200 72 214 100 214 C 128 214 144 200 146 172 C 148 150 140 126 100 128 Z', c) + lines('M 82 132 C 70 150 70 196 84 212 M 118 132 C 130 150 130 196 116 212 M 100 128 L 100 214', c, 1.4) + F('M 84 158 L 92 150 L 96 160 Z M 116 158 L 108 150 L 104 160 Z', DARK.f) + F('M 82 178 Q 100 196 118 178 Q 112 182 108 180 L 104 186 L 100 180 L 96 186 L 92 180 Q 88 182 82 178 Z', DARK.f) + P('M 92 128 Q 100 118 108 128 Q 100 132 92 128 Z', solid('#35b86a')) },
    { id: 'dino', name: 'Dino costume', tags: ['costume', 'safari', 'adventure', 'cute', 'spooky'], col: 'gr', sl: 'long', draw: (c, g) => ({ back: P('M 118 196 C 150 206 168 236 184 262 C 160 252 140 236 116 224 Z', c), legs: merged(pantsD(g.pose, [12.6, 10.6, 9], 308), c), main: P(topD({ neck: 'crew', hem: 206, flare: 2 }), c) + E(100, 170, 13, 22, c.a, c.o) + lines('M 90 158 Q 100 161 110 158 M 89 170 Q 100 173 111 170 M 90 182 Q 100 185 110 182', c) + P('M 125 133 L 132 138 L 126 142 L 130 150 L 124 152 L 126 160 L 121 158 Z', solid('#fcd34d')) }) }
  ];

  // Jackets: drawn over tops and dresses. jsl: long | none
  function openJacket(c, hem, fl, edge) {
    const e = edge || 97;
    const left = `M 92.5 121 Q 80 123 74.5 131.5 L 77.5 152 Q 83.5 166 84 182 Q ${(80.5 - fl * 0.25).toFixed(1)} 192 ${79 - fl} ${hem} Q ${(88 - fl * 0.5).toFixed(1)} ${hem + 2} ${e} ${hem + 1} L ${e} 160 Z`;
    return P(left, c) + P(mirrorD(left), c);
  }
  const lapel = (c) => P('M 92.5 121 L 85 132 L 90 138 L 86 142 L 97 162 Z', c) + P(mirrorD('M 92.5 121 L 85 132 L 90 138 L 86 142 L 97 162 Z'), c);
  function closedJacket(c, hem, fl) { return P(topD({ neck: 'crew', hem, flare: fl }), c); }
  const JACKETS = [
    { id: 'blazer', name: 'Blazer', tags: ['formal', 'school', 'detective', 'wedding', 'movie'], col: 'nv', jsl: 'long', draw: (c) => openJacket(c, 212, 2) + lapel({ f: c.d, o: c.o }) + btn(97, 186, GOLD, 2) + L('M 82 196 L 92 196', c.o, 1.2, 'opacity=".6"') + L('M 108 150 L 116 150', c.o, 1.2, 'opacity=".6"') },
    { id: 'denim', name: 'Denim jacket', tags: ['casual', 'rock', 'farm', 'western', 'camping'], col: 'dn', jsl: 'long', draw: (c) => openJacket(c, 200, 0) + P('M 92.5 121 L 84 128 L 92 136 Z', c) + P(mirrorD('M 92.5 121 L 84 128 L 92 136 Z'), c) + P('M 84 148 L 94 148 L 94 158 L 84 158 Z', c) + P(mirrorD('M 84 148 L 94 148 L 94 158 L 84 158 Z'), c) + L('M 81 188 L 97 188 M 103 188 L 119 188', c.a, 1, 'stroke-dasharray="2 2"') + btn(95, 168, SILVER, 1.4) + btn(105, 168, SILVER, 1.4) },
    { id: 'leather', name: 'Rock jacket', tags: ['rock', 'music', 'party', 'mono'], col: 'bk', jsl: 'long', draw: (c) => openJacket(c, 200, 0, 99) + lapel({ f: c.d, o: c.o }) + L('M 99 162 L 99 200', '#cfd6e0', 1.4, 'stroke-dasharray="1.5 1.5"') + [[80, 136], [120, 136], [84, 132], [116, 132]].map(([x, y]) => C(x, y, 1.3, '#cfd6e0', '#7f8a99')).join('') + L('M 104 176 L 114 174', '#cfd6e0', 1.2) },
    { id: 'puffer', name: 'Puffer coat', tags: ['winter', 'ski', 'camping', 'cozy', 'autumn'], col: 'pu', jsl: 'puffy', draw: (c) => closedJacket(c, 216, 6) + lines('M 78 152 Q 100 158 122 152 M 82 172 Q 100 178 118 172 M 79 192 Q 100 198 121 192 M 76 208 Q 100 214 124 208', c, 1.4) + L('M 100 128 L 100 216', c.o, 1.4, 'opacity=".6"') + P('M 88 112 Q 100 108 112 112 L 114 128 Q 100 133 86 128 Z', c) },
    { id: 'raincoat', name: 'Raincoat', tags: ['rain', 'ocean', 'pirate', 'autumn', 'farm'], col: 'ye', jsl: 'long', draw: (c) => ({ back: E(100, 70, 49, 50, c.f, c.o) + E(100, 74, 42, 43, c.d), main: closedJacket(c, 236, 12) + L('M 100 126 L 100 236', c.o, 1.4, 'opacity=".6"') + btn(105, 150, c.dd ? { d: c.dd, o: c.o } : c, 2.2) + btn(105, 176, { d: c.dd, o: c.o }, 2.2) + btn(105, 202, { d: c.dd, o: c.o }, 2.2) + P('M 84 196 L 94 196 L 94 206 L 84 206 Z', c) + L('M 80 160 Q 78 190 80 220', '#ffffff', 2, 'opacity=".45"') }) },
    { id: 'cardigan', name: 'Cardigan', tags: ['school', 'cozy', 'autumn', 'garden', 'art'], col: 'mt', jsl: 'long', draw: (c) => openJacket(c, 206, 1, 96) + L('M 92.5 121 L 96 158 L 96 206', c.d, 3) + L(mirrorD('M 92.5 121 L 96 158 L 96 206'), c.d, 3) + btn(97, 168, WHITE, 1.6) + btn(97, 182, WHITE, 1.6) + btn(97, 196, WHITE, 1.6) },
    { id: 'tailcoat', name: 'Tailcoat', tags: ['formal', 'royal', 'magic', 'wedding', 'music', 'movie'], col: 'bk', jsl: 'long', draw: (c) => ({ back: P('M 82 190 L 118 190 L 122 262 Q 112 268 100 250 Q 88 268 78 262 Z', c), main: openJacket(c, 188, 0, 96) + lapel({ f: '#4a4756', o: c.o }) + btn(95, 176, { d: c.l, o: c.o }, 1.7) }) },
    { id: 'varsity', name: 'Varsity jacket', tags: ['sport', 'school', 'casual'], col: 'rd', jsl: 'long', draw: (c) => openJacket(c, 204, 0, 98) + P('M 79 198 Q 100 202 121 198 L 121 206 Q 100 209 79 206 Z', WHITE) + L('M 92.5 122 L 98 160 L 98 200', '#ffffff', 2) + L(mirrorD('M 92.5 122 L 98 160 L 98 200'), '#ffffff', 2) + `<text x="88" y="166" text-anchor="middle" font-family="Outfit, system-ui, sans-serif" font-weight="800" font-size="15" fill="#ffffff" stroke="${c.o}" stroke-width=".8">S</text>` },
    { id: 'vest', name: 'Waistcoat', tags: ['western', 'pirate', 'formal', 'detective', 'wedding'], col: 'br', jsl: 'none', draw: (c) => { const d = 'M 91 121.5 L 86 121.5 Q 84 141 78 152 Q 83.5 166 84 182 L 82 204 L 97 212 L 98 160 Z'; return P(d, c) + P(mirrorD(d), c) + btn(96, 172, GOLD, 1.6) + btn(96, 186, GOLD, 1.6) + btn(96, 200, GOLD, 1.6) + L('M 84 176 L 92 176', c.o, 1, 'opacity=".6"'); } },
    { id: 'trench', name: 'Trench coat', tags: ['detective', 'rain', 'autumn', 'formal'], col: 'tn', jsl: 'long', draw: (c) => closedJacket(c, 250, 16) + lapel({ f: c.d, o: c.o }) + P('M 82.5 184 L 117.5 184 L 118.5 193 L 81.5 193 Z', c) + P('M 97 183 L 104 183 L 104 194 L 97 194 Z', { f: 'none', o: c.o }) + [[93, 160], [107, 160], [93, 174], [107, 174]].map(([x, y]) => btn(x, y, { d: c.dd, o: c.o }, 1.8)).join('') + L('M 100 194 L 100 250', c.o, 1.2, 'opacity=".5"') },
    { id: 'chef', name: 'Chef coat', tags: ['chef', 'formal'], col: 'wh', jsl: 'long', draw: (c) => closedJacket(c, 210, 3) + P('M 89 110 L 111 110 L 112 124 Q 100 128 88 124 Z', c) + [[93, 146], [107, 146], [93, 162], [107, 162], [93, 178], [107, 178]].map(([x, y]) => btn(x, y, { d: c.dd, o: c.o }, 1.8)).join('') + L('M 82 132 Q 100 160 104 210', c.o, 1, 'opacity=".35"') },
    { id: 'explorer', name: 'Explorer vest', tags: ['safari', 'camping', 'adventure', 'detective'], col: 'tn', jsl: 'none', draw: (c) => { const d = 'M 91 121.5 L 86 121.5 Q 84 141 78 152 Q 83.5 166 84 182 L 81 206 L 97 206 L 97 160 Z'; return P(d, c) + P(mirrorD(d), c) + P('M 84 150 L 95 150 L 95 162 L 84 162 Z', c) + P(mirrorD('M 84 150 L 95 150 L 95 162 L 84 162 Z'), c) + P('M 83 180 L 95 180 L 95 194 L 83 194 Z', c) + P(mirrorD('M 83 180 L 95 180 L 95 194 L 83 194 Z'), c) + btn(89.5, 152, { d: c.dd, o: c.o }, 1.3) + btn(110.5, 152, { d: c.dd, o: c.o }, 1.3); } },
    { id: 'bolero', name: 'Sparkle bolero', tags: ['party', 'formal', 'dance', 'glam', 'disco'], col: 'sv', pat: 'sp', jsl: 'three', draw: (c) => { const d = 'M 92.5 121 Q 80 123 74.5 131.5 L 77.5 152 Q 80 158 84 160 Q 92 156 95 140 Z'; return P(d, c) + P(mirrorD(d), c); } },
    { id: 'labcoat', name: 'Lab coat', tags: ['science', 'detective', 'formal'], col: 'wh', jsl: 'long', draw: (c) => openJacket(c, 252, 10, 96) + lapel({ f: c.d, o: c.o }) + P('M 82 200 L 93 200 L 93 212 L 82 212 Z', c) + P('M 108 146 L 117 146 L 117 156 L 108 156 Z', c) + L('M 110 144 L 110 150 M 113 143 L 113 150', '#3f7ef0', 1.4) }
  ];

  const BOTTOMS = [
    { id: 'jeans', name: 'Jeans', tags: ['casual', 'school', 'farm', 'western', 'rock', 'camping'], col: 'dn', pants: true, draw: (c, g) => merged(pantsD(g.pose, [11.8, 8.8, 7.2], 312), c) + L('M 100 206 L 100 212', c.o, 1, 'opacity=".5"') + L('M 86 186 Q 90 192 84 196 M 114 186 Q 110 192 116 196', c.a, 1, 'opacity=".8"') + L(`M ${legEndX('L', g.pose, 306) - 7} 306 L ${legEndX('L', g.pose, 306) + 7} 306 M ${legEndX('R', g.pose, 306) - 7} 306 L ${legEndX('R', g.pose, 306) + 7} 306`, c.a, 1, 'opacity=".8"') },
    { id: 'trousers', name: 'Smart trousers', tags: ['formal', 'detective', 'wedding', 'school', 'movie'], col: 'bk', pants: true, draw: (c, g) => merged(pantsD(g.pose, [12.2, 9.8, 9], 314), c) + L(`M 90 206 L ${legEndX('L', g.pose, 312)} 312 M 110 206 L ${legEndX('R', g.pose, 312)} 312`, c.o, 1, 'opacity=".45"') },
    { id: 'wide', name: 'Flares', tags: ['disco', 'glam', 'music', 'party', 'beach'], col: 'pk', pants: true, draw: (c, g) => merged(pantsD(g.pose, [12.6, 11.5, 15.5], 318), c) },
    { id: 'joggers', name: 'Joggers', tags: ['sport', 'cozy', 'pajama', 'casual', 'camping'], col: 'gy', pants: true, draw: (c, g) => merged(pantsD(g.pose, [12.2, 9.8, 7.6], 306), c) + [['L'], ['R']].map(([s]) => { const x = legEndX(s, g.pose, 304); return P(`M ${x - 7.4} 300 L ${x + 7.4} 300 L ${x + 6.8} 309 L ${x - 6.8} 309 Z`, c); }).join('') + L('M 84 186 L 116 186', '#ffffff', 1.2, 'opacity=".7"') + L('M 80 210 L 80 300 M 120 210 L 120 300', '#ffffff', 1.6, 'opacity=".55"') },
    { id: 'leggings', name: 'Leggings', tags: ['sport', 'dance', 'ballet', 'hero', 'cozy'], col: 'hp', pants: true, draw: (c, g) => merged(pantsD(g.pose, [10.8, 7.6, 5.9], 312), c) },
    { id: 'snowpants', name: 'Snow pants', tags: ['winter', 'ski'], col: 'nv', pants: true, draw: (c, g) => merged(pantsD(g.pose, [13.6, 12.2, 10.6], 306), c) + L('M 80 232 Q 89 236 99 232 M 101 232 Q 111 236 120 232 M 81 270 Q 89 274 98 270 M 102 270 Q 111 274 119 270', c.o, 1.2, 'opacity=".5"') },
    { id: 'breeches', name: 'Pirate pants', tags: ['pirate', 'medieval', 'adventure'], col: 'wh', pat: 'st', pants: true, draw: (c, g) => merged(pantsD(g.pose, [13, 12, 9.6], 276), c) + P('M 82 182 L 118 182 L 118.6 190 L 81.4 190 Z', solid('#ec4048')) },
    { id: 'shorts', name: 'Shorts', tags: ['summer', 'beach', 'sport', 'camping', 'casual', 'tropical'], col: 'tn', pants: true, draw: (c, g) => merged(pantsD(g.pose, [12.4, 11, 9], 236), c) + L('M 100 206 L 100 212', c.o, 1, 'opacity=".5"') },
    { id: 'cargo', name: 'Cargo shorts', tags: ['safari', 'camping', 'adventure', 'casual'], col: 'gr', pants: true, draw: (c, g) => merged(pantsD(g.pose, [12.6, 11.2, 9.5], 250), c) + P('M 77 216 L 86 216 L 86 230 L 78 230 Z', c) + P(mirrorD('M 77 216 L 86 216 L 86 230 L 78 230 Z'), c) },
    { id: 'swim', name: 'Board shorts', tags: ['beach', 'summer', 'ocean', 'tropical', 'sport'], col: 'tl', pat: 'fl', pants: true, draw: (c, g) => merged(pantsD(g.pose, [13, 12, 11], 242), c) + L('M 79.5 200 L 79 238 M 120.5 200 L 121 238', '#ffffff', 2, 'opacity=".8"') + L('M 96 184 L 92 192 M 104 184 L 108 192', '#ffffff', 1.4) },
    { id: 'mini', name: 'Mini skirt', tags: ['party', 'school', 'casual', 'rock', 'candy'], col: 'rd', pat: 'pl', draw: (c) => P(skirtD({ top: 182, hem: 228, flare: 27 }), c) + P('M 84 181 Q 100 185 116 181 L 116.5 187 Q 100 191 83.5 187 Z', c) },
    { id: 'pleated', name: 'Pleated skirt', tags: ['school', 'sport', 'cute', 'autumn'], col: 'nv', pat: 'pl', draw: (c) => P(skirtD({ top: 182, hem: 236, flare: 31, edge: 'wave' }), c) + lines('M 89 190 L 80 234 M 95 190 L 92 236 M 100 190 L 100 237 M 105 190 L 108 236 M 111 190 L 120 234', c) },
    { id: 'tutuskirt', name: 'Tutu skirt', tags: ['ballet', 'fairy', 'party', 'candy', 'cute', 'dance'], col: 'lv', draw: (c) => P(skirtD({ top: 184, hem: 232, flare: 46, edge: 'scallop' }), { f: c.l, o: c.o }, 'opacity=".9"') + P(skirtD({ top: 182, hem: 222, flare: 40, edge: 'scallop' }), c) + F(glint(90, 208, 3), '#fff') + F(glint(110, 212, 2.4), '#fff') },
    { id: 'maxi', name: 'Maxi skirt', tags: ['garden', 'beach', 'fairy', 'spring', 'tropical', 'western'], col: 'or', pat: 'fl', draw: (c) => P(skirtD({ top: 182, hem: 314, flare: 42, edge: 'wave' }), c) + lines('M 92 192 Q 86 250 78 310 M 108 192 Q 114 250 122 310', c) },
    { id: 'puffskirt', name: 'Ball skirt', tags: ['royal', 'formal', 'fairy', 'wedding'], col: 'gd', pat: 'sp', draw: (c) => P(skirtD({ top: 182, hem: 324, flare: 68, style: 'puff', edge: 'wave' }), c) + lines('M 92 190 Q 76 260 62 320 M 100 190 L 100 328 M 108 190 Q 124 260 138 320', c) }
  ];

  // Shoes are drawn in foot space: origin at the ankle, toe pointing down; mirrored for the left foot.
  // tall: drawn over trousers.
  const SOLE = (c2) => P('M -9 7 L 9 7 L 9 10.5 Q 9 14 4 14 L -4 14 Q -9 14 -9 10.5 Z', c2 || WHITE);
  const SHOES = [
    { id: 'sneakers', name: 'Sneakers', tags: ['sport', 'casual', 'school', 'camping', 'safari'], col: 'wh', draw: (c) => P('M -7 -6 Q 0 -9 7 -6 L 8.5 7 Q 8.5 12 0 12 Q -8.5 12 -8.5 7 Z', c) + SOLE() + L('M -4 -2 L 4 -2 M -4.5 1.5 L 4.5 1.5', c.o, 1.2) + L('M -8 4 Q 0 6 8 4', '#ec4048', 1.4, 'opacity=".8"') },
    { id: 'maryjanes', name: 'Mary Janes', tags: ['school', 'cute', 'formal', 'wedding', 'royal'], col: 'rd', draw: (c) => P('M -6.5 1 Q 0 -1.5 6.5 1 L 8 8 Q 8 13.5 0 13.5 Q -8 13.5 -8 8 Z', c) + L('M -6.5 1.5 Q 0 -3 6.5 0', c.f, 2.4) + C(5.5, 0.6, 1.3, GOLD.f, GOLD.o) + L('M -4 6 Q -2 4 1 4.5', '#ffffff', 1.4, 'opacity=".7"') },
    { id: 'ballet', name: 'Ballet slippers', tags: ['ballet', 'dance', 'fairy', 'cute'], col: 'pk', draw: (c) => L('M -5 0 L 5 -12 M 5 0 L -5 -12 M -5 -12 L 5 -24 M 5 -12 L -5 -24', c.d, 1.8) + P('M -6.5 1 Q 0 -1.5 6.5 1 L 7.5 8 Q 7.5 13 0 13 Q -7.5 13 -7.5 8 Z', c) + L('M -4 6 Q -2 4 1 4.5', '#ffffff', 1.4, 'opacity=".7"') },
    { id: 'heels', name: 'Party shoes', tags: ['party', 'formal', 'glam', 'disco', 'movie', 'royal'], col: 'gd', pat: 'sp', draw: (c) => P('M -6.5 1 Q 0 -1 6.5 1 L 7.5 9 Q 7 13 0 13.5 Q -7 13 -7.5 9 Z', c) + L('M -6 -6 Q 0 -8 6 -6', c.f, 2.2) + P('M 0 3 L -4.5 0.5 L -4.5 5.5 Z M 0 3 L 4.5 0.5 L 4.5 5.5 Z', { f: c.d, o: c.o }) },
    { id: 'sandals', name: 'Sandals', tags: ['beach', 'summer', 'tropical', 'garden'], col: 'tn', bare: true, draw: (c) => P('M -8.5 9 L 8.5 9 L 8.5 12 Q 0 14.5 -8.5 12 Z', c) + L('M -6.4 0 L 6.4 0', c.o, 4.2) + L('M -6.4 0 L 6.4 0', c.f, 2.6) + L('M -7.2 6 L 7.2 6', c.o, 4.2) + L('M -7.2 6 L 7.2 6', c.f, 2.6) + C(0, 0, 2.2, '#f472b6', '#c2457f') },
    { id: 'boots', name: 'Ankle boots', tags: ['autumn', 'rock', 'western', 'detective', 'camping'], col: 'br', draw: (c) => P('M -6.8 -22 L 6.8 -22 L 7.6 6 Q 8.6 13 0 13 Q -8.6 13 -7.6 6 Z', c) + SOLE({ f: c.dd || c.d, o: c.o }) + P('M -7.4 -24 L 7.4 -24 L 7.2 -18 L -7.2 -18 Z', { f: c.d, o: c.o }) },
    { id: 'tallboots', name: 'Tall boots', tags: ['pirate', 'hero', 'royal', 'rock', 'medieval', 'western'], col: 'bk', tall: true, draw: (c) => P('M -8.6 -56 L 8.6 -56 L 7.8 6 Q 8.6 13 0 13 Q -8.6 13 -7.8 6 Z', c) + P('M -10 -60 L 10 -60 L 9.4 -49 L -9.4 -49 Z', { f: c.d, o: c.o }) + SOLE({ f: c.dd || c.d, o: c.o }) + L('M -4 -40 L -4 0', '#ffffff', 1.6, 'opacity=".25"') },
    { id: 'rainboots', name: 'Rain boots', tags: ['rain', 'farm', 'garden', 'camping'], col: 'ye', tall: true, draw: (c) => P('M -9 -40 L 9 -40 L 8.4 6 Q 9 13.5 0 13.5 Q -9 13.5 -8.4 6 Z', c) + P('M -9.4 -42 L 9.4 -42 L 9.2 -36 L -9.2 -36 Z', { f: c.d, o: c.o }) + L('M -5 -32 L -5 4', '#ffffff', 2.2, 'opacity=".55"') + P('M -9.4 8 L 9.4 8 L 9.4 11 Q 9 14.5 0 14.5 Q -9 14.5 -9.4 11 Z', { f: c.dd || c.d, o: c.o }) },
    { id: 'cowboy', name: 'Cowboy boots', tags: ['western', 'farm'], col: 'br', tall: true, draw: (c) => P('M -8.6 -46 L 8.6 -46 L 8 4 Q 8 12 0 16 Q -8 12 -8 4 Z', c) + L('M -5 -40 Q 0 -30 5 -40 M -5 -30 Q 0 -20 5 -30 M 0 -26 L 0 -12', c.l, 1.3) + P('M -9.2 -48 Q 0 -42 9.2 -48 L 8.8 -42 Q 0 -37 -8.8 -42 Z', { f: c.d, o: c.o }) },
    { id: 'snowboots', name: 'Snow boots', tags: ['winter', 'ski', 'cozy'], col: 'tn', draw: (c) => P('M -7.8 -20 L 7.8 -20 L 8.4 6 Q 9 13 0 13 Q -9 13 -8.4 6 Z', c) + SOLE({ f: c.dd || c.d, o: c.o }) + merged([-7, -2.4, 2.4, 7].map((x) => `M ${x - 4} -22 a 4 4 0 1 0 8 0 a 4 4 0 1 0 -8 0 Z`), WHITE, 2.4) },
    { id: 'flippers', name: 'Flippers', tags: ['beach', 'ocean', 'summer'], col: 'tl', draw: (c) => P('M -6.5 -4 L 6.5 -4 L 15 22 Q 0 28 -15 22 Z', c) + L('M -3 6 L -6 22 M 3 6 L 6 22 M 0 6 L 0 24', c.o, 1, 'opacity=".55"') + P('M -7 -6 Q 0 -9 7 -6 L 7.5 4 Q 0 7 -7.5 4 Z', { f: c.d, o: c.o }) },
    { id: 'spaceboots', name: 'Moon boots', tags: ['space', 'hero', 'winter'], col: 'sv', tall: true, draw: (c) => P('M -9.4 -34 L 9.4 -34 L 9.8 6 Q 10.4 14 0 14 Q -10.4 14 -9.8 6 Z', c) + P('M -10.4 -36 L 10.4 -36 L 10.2 -28 L -10.2 -28 Z', solid('#3f7ef0')) + P('M -10.6 7 L 10.6 7 L 10.6 11 Q 10.4 16 0 16 Q -10.4 16 -10.6 11 Z', solid('#3f7ef0')) + L('M -9.6 -12 L 9.6 -12', c.o, 1.2, 'opacity=".6"') },
    { id: 'slippers', name: 'Bunny slippers', tags: ['pajama', 'cozy', 'cute'], col: 'pk', draw: (c) => P('M -6 -12 Q -9 -24 -5 -24 Q -2 -22 -2.5 -8 Z M 6 -12 Q 9 -24 5 -24 Q 2 -22 2.5 -8 Z', c) + P('M -9 -6 Q 0 -12 9 -6 L 10 7 Q 10 14 0 14 Q -10 14 -10 7 Z', c) + C(-3, 2, 1.1, INK) + C(3, 2, 1.1, INK) + E(0, 5, 1.6, 1.1, '#ec4899') },
    { id: 'glass', name: 'Glass slippers', tags: ['royal', 'fairy', 'wedding', 'glam'], col: 'sk', pat: 'sp', draw: (c) => P('M -6.5 1 Q 0 -1 6.5 1 L 7.5 9 Q 7 13 0 13.5 Q -7 13 -7.5 9 Z', c, 'opacity=".85"') + F(glint(3, 4, 3), '#ffffff') + L('M -4.5 6 Q -2 3 1 3.5', '#ffffff', 1.4) },
    { id: 'skates', name: 'Roller skates', tags: ['disco', 'party', 'sport', 'candy'], col: 'wh', draw: (c) => P('M -7 -22 L 7 -22 L 8 7 Q 8 11 0 11 Q -8 11 -8 7 Z', c) + P('M -9 9 L 9 9 L 9 13 L -9 13 Z', solid('#f9a8d0')) + C(-5, 16, 3.4, '#a3e048', '#5e8d1f') + C(5, 16, 3.4, '#a3e048', '#5e8d1f') + L('M -4 -16 L 4 -16 M -4 -11 L 4 -11 M -4 -6 L 4 -6', c.o, 1.1) },
    { id: 'iceskates', name: 'Ice skates', tags: ['winter', 'ski', 'dance'], col: 'wh', draw: (c) => P('M -7 -22 L 7 -22 L 8 7 Q 8 11 0 11 Q -8 11 -8 7 Z', c) + L('M -8 15 L 8 15', '#7f8a99', 2.4) + L('M -4 11 L -4 15 M 4 11 L 4 15', '#7f8a99', 1.6) + L('M -4 -16 L 4 -16 M -4 -11 L 4 -11 M -4 -6 L 4 -6', c.o, 1.1) + merged(['M -8 -24 L 8 -24 L 8 -19 L -8 -19 Z'], solid('#f9a8d0'), 2) }
  ];

  // Hats: { back } goes behind the hair, { main } over it.
  const HATS = [
    { id: 'cap', name: 'Cap', tags: ['sport', 'casual', 'summer', 'camping'], col: 'rd', draw: (c) => P('M 62 46 C 60 12 140 12 138 46 Z', c) + lines('M 100 18 L 100 46 M 82 22 Q 78 34 78 46 M 118 22 Q 122 34 122 46', c) + C(100, 18, 2.6, c.d, c.o) + P('M 60 44 Q 100 54 140 44 Q 134 60 100 61 Q 66 60 60 44 Z', { f: c.d, o: c.o }) },
    { id: 'beanie', name: 'Bobble hat', tags: ['winter', 'ski', 'cozy', 'autumn', 'camping'], col: 'tl', pat: 'st', draw: (c) => P('M 61 50 C 58 6 142 6 139 50 Z', c) + P('M 58 42 Q 100 34 142 42 L 142 56 Q 100 48 58 56 Z', { f: c.d, o: c.o }) + lines('M 66 44 L 66 54 M 76 42 L 76 52 M 86 40 L 86 50 M 96 40 L 96 50 M 106 40 L 106 50 M 116 40 L 116 51 M 126 41 L 126 52 M 136 42 L 136 54', c) + merged([0, 72, 144, 216, 288].map((a) => { const x = 100 + Math.cos(a * Math.PI / 180) * 5, y = 8 + Math.sin(a * Math.PI / 180) * 5; return `M ${(x - 6).toFixed(1)} ${y.toFixed(1)} a 6 6 0 1 0 12 0 a 6 6 0 1 0 -12 0 Z`; }), { f: c.l, o: c.o }, 2.4) },
    { id: 'sunhat', name: 'Sun hat', tags: ['beach', 'summer', 'garden', 'tropical', 'spring'], col: 'cr', draw: (c) => E(100, 42, 68, 14, c.f, c.o) + E(100, 41, 58, 9, c.d, null, 'opacity=".35"') + P('M 72 42 C 72 12 128 12 128 42 Q 100 48 72 42 Z', c) + P('M 72 34 Q 100 40 128 34 L 128 42 Q 100 48 72 42 Z', solid('#f472b6')) + C(126, 36, 6, '#fcd34d', '#c99a08') + C(126, 36, 2.4, '#fb923c') },
    { id: 'crown', name: 'Crown', tags: ['royal', 'medieval', 'fairy', 'glam'], col: 'gd', draw: (c) => P('M 70 40 L 68 12 L 82 26 L 92 6 L 100 22 L 108 6 L 118 26 L 132 12 L 130 40 Q 100 46 70 40 Z', c) + P('M 70 34 Q 100 40 130 34 L 130 40 Q 100 46 70 40 Z', { f: c.d, o: c.o }) + C(100, 30, 3.4, '#ec4048', '#9b1d24') + C(84, 31, 2.4, '#3f7ef0', '#1d4bb5') + C(116, 31, 2.4, '#35b86a', '#1e7a43') + C(68, 12, 2.4, '#ffffff', c.o) + C(92, 6, 2.4, '#ffffff', c.o) + C(108, 6, 2.4, '#ffffff', c.o) + C(132, 12, 2.4, '#ffffff', c.o) },
    { id: 'tiara', name: 'Tiara', tags: ['royal', 'fairy', 'ballet', 'wedding', 'glam', 'formal'], col: 'sv', pat: 'sp', draw: (c) => P('M 72 40 Q 100 28 128 40 L 124 34 L 114 34 L 108 26 L 100 14 L 92 26 L 86 34 L 76 34 Z', c) + F(heart(100, 27, 4.4), '#f472b6', 'stroke="#c2457f" stroke-width="1"') + C(86, 33, 1.8, '#86cdf7') + C(114, 33, 1.8, '#86cdf7') },
    { id: 'wizard', name: 'Wizard hat', tags: ['magic', 'fairy', 'spooky', 'costume', 'night'], col: 'pu', pat: 'sr', draw: (c) => E(100, 44, 52, 9, c.f, c.o) + P('M 64 44 Q 100 54 136 44 L 110 2 Q 104 -10 96 -4 L 90 2 Z', c) + P('M 66 40 Q 100 48 134 40 L 132 46 Q 100 54 68 46 Z', GOLD) },
    { id: 'witch', name: 'Witch hat', tags: ['spooky', 'magic', 'costume', 'autumn'], col: 'bk', draw: (c) => E(100, 44, 56, 9, c.f, c.o) + P('M 66 44 Q 100 52 134 44 L 112 4 Q 120 -6 128 -2 Q 114 -16 98 0 Z', c) + P('M 68 38 Q 100 46 132 38 L 131 45 Q 100 53 69 45 Z', solid('#9045e0')) + P('M 94 38 L 106 38 L 106 48 L 94 48 Z', { f: 'none', o: GOLD.f }) },
    { id: 'pirate', name: 'Pirate hat', tags: ['pirate', 'costume', 'adventure', 'ocean'], col: 'bk', draw: (c) => P('M 52 46 C 54 20 78 12 100 12 C 122 12 146 20 148 46 Q 124 34 100 40 Q 76 34 52 46 Z', c) + L('M 54 44 Q 76 33 100 39 Q 124 33 146 44', GOLD.f, 2.2) + E(100, 26, 7, 6, '#ffffff', '#b9b3aa') + C(97.5, 25, 1.4, INK) + C(102.5, 25, 1.4, INK) + L('M 92 34 L 108 40 M 108 34 L 92 40', '#ffffff', 2) },
    { id: 'tophat', name: 'Top hat', tags: ['formal', 'magic', 'movie', 'wedding', 'royal', 'music'], col: 'bk', draw: (c) => P('M 76 40 L 78 0 Q 100 -4 122 0 L 124 40 Z', c) + P('M 77 30 L 123 30 L 123.6 40 L 76.4 40 Z', solid('#ec4048')) + E(100, 42, 38, 6.5, c.f, c.o) + L('M 86 4 L 86 28', '#ffffff', 2, 'opacity=".2"') },
    { id: 'cowboy', name: 'Cowboy hat', tags: ['western', 'farm', 'adventure'], col: 'tn', draw: (c) => P('M 74 40 C 72 14 86 10 100 18 C 114 10 128 14 126 40 Z', c) + P('M 74 34 Q 100 40 126 34 L 126 40 Q 100 46 74 40 Z', { f: c.dd, o: c.o }) + P('M 44 30 Q 56 48 100 46 Q 144 48 156 30 Q 152 56 100 56 Q 48 56 44 30 Z', c) },
    { id: 'beret', name: 'Beret', tags: ['art', 'autumn', 'detective', 'school'], col: 'rd', draw: (c) => `<g transform="rotate(-10 96 36)">${E(96, 36, 44, 14, c.f, c.o)}${L('M 56 40 Q 96 50 136 40', c.d, 2)}</g>` + P('M 96 22 L 97 16 L 100 17 L 99 23 Z', c) },
    { id: 'flowers', name: 'Flower crown', tags: ['garden', 'fairy', 'spring', 'tropical', 'wedding'], col: 'pk', draw: (c) => L('M 62 46 Q 100 26 138 46', '#35b86a', 3) + [[64, 44, '#ffffff'], [76, 36, c.f], [90, 31, '#fcd34d'], [104, 30, c.f], [118, 33, '#ffffff'], [131, 39, c.f], [138, 47, '#fcd34d']].map(([x, y, col], k) => (k % 2 ? E(x - 6, y + 4, 4, 2, '#35b86a', '#1e7a43') : '') + [0, 72, 144, 216, 288].map((a) => C((x + Math.cos(a * Math.PI / 180) * 4).toFixed(1), (y + Math.sin(a * Math.PI / 180) * 4).toFixed(1), 3.3, col, shade(col, -0.3))).join('') + C(x, y, 2.6, '#fb923c')).join('') },
    { id: 'bunny', name: 'Bunny ears', tags: ['cute', 'candy', 'pajama', 'spring', 'costume'], col: 'wh', draw: (c) => P('M 78 36 C 64 -10 80 -20 86 -8 C 90 4 90 20 88 32 Z', c) + F('M 80 30 C 72 0 80 -10 84 -4 C 87 6 87 18 85 28 Z', '#f9a8d0') + P(mirrorD('M 78 36 C 64 -10 80 -20 86 -8 C 90 4 90 20 88 32 Z'), c) + F(mirrorD('M 80 30 C 72 0 80 -10 84 -4 C 87 6 87 18 85 28 Z'), '#f9a8d0') + L('M 62 52 Q 100 14 138 52', c.o, 5.5) + L('M 62 52 Q 100 14 138 52', c.f, 3.6) },
    { id: 'cat', name: 'Cat ears', tags: ['cute', 'spooky', 'party', 'costume'], col: 'bk', draw: (c) => P('M 66 40 L 70 10 L 90 30 Z', c) + F('M 70.5 34 L 72.4 17 L 84 29 Z', '#f9a8d0') + P(mirrorD('M 66 40 L 70 10 L 90 30 Z'), c) + F(mirrorD('M 70.5 34 L 72.4 17 L 84 29 Z'), '#f9a8d0') + L('M 62 52 Q 100 14 138 52', c.o, 5.5) + L('M 62 52 Q 100 14 138 52', c.f, 3.6) },
    { id: 'bow', name: 'Big bow', tags: ['cute', 'party', 'candy', 'school', 'birthday'], col: 'hp', pat: 'dt', draw: (c) => P('M 122 32 C 104 14 100 36 108 44 C 114 46 120 38 122 32 Z', c) + P('M 122 32 C 140 14 146 38 138 44 C 132 46 124 38 122 32 Z', c) + C(122, 33, 4.4, c.d, c.o) },
    { id: 'party', name: 'Party hat', tags: ['party', 'birthday', 'candy'], col: 'sk', pat: 'dt', draw: (c) => P('M 84 34 L 108 -12 L 124 30 Q 104 40 84 34 Z', c) + merged([0, 72, 144, 216, 288].map((a) => { const x = 108 + Math.cos(a * Math.PI / 180) * 3.6, y = -14 + Math.sin(a * Math.PI / 180) * 3.6; return `M ${(x - 4.6).toFixed(1)} ${y.toFixed(1)} a 4.6 4.6 0 1 0 9.2 0 a 4.6 4.6 0 1 0 -9.2 0 Z`; }), solid('#fcd34d'), 2.4) + L('M 85 34 Q 104 40 124 30', '#fcd34d', 2.4) },
    { id: 'helmet', name: 'Space helmet', tags: ['space', 'costume', 'adventure'], col: 'wh', draw: (c) => ({ back: C(100, 72, 56, '#dff3ff', null, 'opacity=".35"'), main: C(100, 72, 56, '#bfe6ff', '#7f8a99', 'fill-opacity=".22"') + L('M 64 46 Q 76 28 96 22', '#ffffff', 5, 'opacity=".75"') + L('M 132 104 Q 140 92 142 80', '#ffffff', 3, 'opacity=".5"') + P('M 58 108 Q 100 132 142 108 L 140 122 Q 100 144 60 122 Z', c) + C(100, 128, 3, '#ec4048', '#9b1d24') }) },
    { id: 'chef', name: 'Chef hat', tags: ['chef'], col: 'wh', draw: (c) => merged(['M 66 20 a 14 14 0 1 0 28 0 a 14 14 0 1 0 -28 0 Z', 'M 86 12 a 15 15 0 1 0 30 0 a 15 15 0 1 0 -30 0 Z', 'M 106 20 a 14 14 0 1 0 28 0 a 14 14 0 1 0 -28 0 Z', 'M 72 22 L 128 22 L 126 46 L 74 46 Z'], c) + P('M 73 34 L 127 34 L 126 48 Q 100 52 74 48 Z', c) + lines('M 88 34 L 88 48 M 100 35 L 100 50 M 112 34 L 112 48', c) },
    { id: 'headphones', name: 'Headphones', tags: ['music', 'rock', 'party', 'disco'], col: 'hp', draw: (c) => L('M 58 74 C 54 14 146 14 142 74', c.o, 7.4) + L('M 58 74 C 54 14 146 14 142 74', c.f, 5) + P('M 52 66 Q 52 60 58 60 L 64 60 L 64 92 L 58 92 Q 52 92 52 86 Z', c) + P(mirrorD('M 52 66 Q 52 60 58 60 L 64 60 L 64 92 L 58 92 Q 52 92 52 86 Z'), c) },
    { id: 'sweatband', name: 'Sweatband', tags: ['sport', 'dance', 'disco'], col: 'wh', draw: (c) => P('M 60 54 Q 100 40 140 54 L 140 64 Q 100 50 60 64 Z', c) + L('M 60 59 Q 100 45 140 59', '#ec4048', 2) },
    { id: 'earmuffs', name: 'Earmuffs', tags: ['winter', 'ski', 'cozy'], col: 'lv', draw: (c) => L('M 60 74 C 56 20 144 20 140 74', c.o, 5.4) + L('M 60 74 C 56 20 144 20 140 74', c.f, 3.4) + merged([[59, 80], [141, 80]].map(([x, y]) => `M ${x - 11} ${y} a 11 11 0 1 0 22 0 a 11 11 0 1 0 -22 0 Z`), { f: c.l, o: c.o }) },
    { id: 'fedora', name: 'Fedora', tags: ['detective', 'formal', 'movie', 'music'], col: 'gy', draw: (c) => G(P('M 74 40 C 72 14 84 12 100 18 C 116 12 128 14 126 40 Z', c) + P('M 74 32 Q 100 38 126 32 L 126 40 Q 100 46 74 40 Z', solid('#2d2b36')) + P('M 54 40 Q 100 34 146 40 Q 148 48 100 50 Q 52 48 54 40 Z', c), 'transform="translate(0 6)"') },
    { id: 'halo', name: 'Halo', tags: ['fairy', 'cute', 'wedding'], col: 'gd', draw: (c) => E(100, 12, 30, 7.5, 'none', c.o, 'stroke-width="6"') + E(100, 12, 30, 7.5, 'none', c.f, 'stroke-width="3.6"') },
    { id: 'safari', name: 'Explorer hat', tags: ['safari', 'adventure', 'camping'], col: 'tn', draw: (c) => E(100, 44, 54, 11, c.f, c.o) + P('M 70 44 C 70 8 130 8 130 44 Q 100 50 70 44 Z', c) + P('M 70 36 Q 100 42 130 36 L 130 44 Q 100 50 70 44 Z', solid('#8a5a36')) },
    { id: 'holiday', name: 'Holiday hat', tags: ['winter', 'party', 'cozy'], col: 'rd', draw: (c) => P('M 64 44 C 70 10 100 -4 130 10 C 146 20 150 36 148 50 C 140 30 130 24 124 24 L 136 44 Z', c) + merged(['M 60 40 Q 100 30 140 40 L 140 52 Q 100 42 60 52 Z', 'M 140 54 a 7 7 0 1 0 14 0 a 7 7 0 1 0 -14 0 Z'], WHITE) },
    { id: 'clips', name: 'Star clips', tags: ['cute', 'space', 'party', 'school', 'night'], col: 'ye', draw: (c) => F(star(76, 50, 7, 3.2), c.f, `stroke="${c.o}" stroke-width="1.2" stroke-linejoin="round"`) + F(star(126, 44, 6, 2.8), c.f, `stroke="${c.o}" stroke-width="1.2" stroke-linejoin="round"`) + F(star(136, 56, 4.4, 2), c.f, `stroke="${c.o}" stroke-width="1.2" stroke-linejoin="round"`) }
  ];

  const GLASSES = [
    { id: 'round', name: 'Round glasses', tags: ['school', 'detective', 'art', 'science', 'magic'], col: 'br', draw: (c) => C(84, 84, 10, '#ffffff', null, 'opacity=".22"') + C(116, 84, 10, '#ffffff', null, 'opacity=".22"') + C(84, 84, 10, 'none', c.f, 'stroke-width="2.4"') + C(116, 84, 10, 'none', c.f, 'stroke-width="2.4"') + L('M 94 83 Q 100 79 106 83 M 74 82 L 62 78 M 126 82 L 138 78', c.f, 2.2) },
    { id: 'hearts', name: 'Heart shades', tags: ['party', 'cute', 'candy', 'beach', 'summer'], col: 'hp', draw: (c) => F(heart(84, 84, 9), shade(c.b, -0.1), `stroke="${c.o}" stroke-width="1.8" opacity=".92"`) + F(heart(116, 84, 9), shade(c.b, -0.1), `stroke="${c.o}" stroke-width="1.8" opacity=".92"`) + L('M 92 80 Q 100 76 108 80', c.o, 2) + L('M 78 79 Q 80 77 83 78 M 110 79 Q 112 77 115 78', '#ffffff', 1.6, 'opacity=".8"') },
    { id: 'stars', name: 'Star shades', tags: ['music', 'party', 'disco', 'movie', 'space'], col: 'ye', draw: (c) => F(star(84, 84, 12, 5.8), c.f, `stroke="${c.o}" stroke-width="1.6" stroke-linejoin="round"`) + F(star(116, 84, 12, 5.8), c.f, `stroke="${c.o}" stroke-width="1.6" stroke-linejoin="round"`) + C(84, 85, 5, INK, null, 'opacity=".75"') + C(116, 85, 5, INK, null, 'opacity=".75"') + L('M 93 82 L 107 82', c.o, 2) },
    { id: 'shades', name: 'Cool shades', tags: ['beach', 'summer', 'rock', 'music', 'movie', 'sport'], col: 'bk', draw: (c) => P('M 72 77 L 96 77 Q 97 92 86 92 Q 72 92 72 77 Z', DARK) + P(mirrorD('M 72 77 L 96 77 Q 97 92 86 92 Q 72 92 72 77 Z'), DARK) + L('M 96 79 L 104 79 M 72 78 L 62 76 M 128 78 L 138 76', c.f === DARK.f ? '#141219' : c.f, 2.4) + L('M 76 81 L 82 81 M 108 81 L 114 81', '#ffffff', 1.6, 'opacity=".6"') },
    { id: 'mask', name: 'Hero mask', tags: ['hero', 'costume', 'party'], col: 'rd', draw: (c) => `<path d="M 64 80 Q 70 70 84 72 Q 94 73 100 78 Q 106 73 116 72 Q 130 70 136 80 Q 136 94 118 95 Q 106 95 100 88 Q 94 95 82 95 Q 64 94 64 80 Z M 77 84 a 7 6 0 1 0 14 0 a 7 6 0 1 0 -14 0 Z M 109 84 a 7 6 0 1 0 14 0 a 7 6 0 1 0 -14 0 Z" fill="${c.f}" stroke="${c.o}" stroke-width="1.5" fill-rule="evenodd"/>` + L('M 64 80 L 56 74 M 64 82 L 55 84', c.f, 2.4) },
    { id: 'patch', name: 'Eye patch', tags: ['pirate', 'costume'], col: 'bk', draw: (c) => L('M 62 66 L 138 98', c.o, 2) + P('M 75 77 Q 84 74 93 77 Q 95 90 84 93 Q 73 90 75 77 Z', c) },
    { id: 'goggles', name: 'Ski goggles', tags: ['ski', 'winter', 'space', 'adventure'], col: 'or', draw: (c) => L('M 60 80 L 140 80', '#2d2b36', 6) + P('M 70 74 Q 100 70 130 74 Q 134 84 128 94 Q 112 98 100 90 Q 88 98 72 94 Q 66 84 70 74 Z', SILVER) + F('M 73 77 Q 100 73 127 77 Q 130 85 125 91 Q 111 94 100 87 Q 89 94 75 91 Q 70 85 73 77 Z', c.f, 'opacity=".9"') + L('M 78 80 Q 88 77 96 79', '#ffffff', 2, 'opacity=".7"') },
    { id: 'monocle', name: 'Monocle', tags: ['detective', 'royal', 'formal'], col: 'gd', draw: (c) => C(116, 84, 10, '#ffffff', null, 'opacity=".25"') + C(116, 84, 10, 'none', c.f, 'stroke-width="2.4"') + L('M 124 90 Q 132 110 126 130', c.f, 1.2) },
    { id: 'square', name: 'Square specs', tags: ['school', 'science', 'detective', 'art', 'chef'], col: 'bl', draw: (c) => P('M 74 77 L 95 77 L 95 92 L 74 92 Z', { f: '#ffffff', o: c.f }, 'fill-opacity=".2" stroke-width="2.6"') + P(mirrorD('M 74 77 L 95 77 L 95 92 L 74 92 Z'), { f: '#ffffff', o: c.f }, 'fill-opacity=".2" stroke-width="2.6"') + L('M 95 81 L 105 81 M 74 80 L 62 78 M 126 80 L 138 78', c.f, 2.2) }
  ];

  const qpt = (P0, P1, P2, t) => [(1 - t) * (1 - t) * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0], (1 - t) * (1 - t) * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1]];
  const along = (n, fn, P1, a, b) => { let s = ''; for (let k = 0; k < n; k++) { const p = qpt(a || [86, 122], P1 || [100, 152], b || [114, 122], k / (n - 1)); s += fn(p[0].toFixed(1), p[1].toFixed(1), k); } return s; };
  const NECK = [
    { id: 'pearls', name: 'Pearls', tags: ['royal', 'formal', 'wedding', 'glam', 'movie'], col: 'wh', draw: (c) => along(11, (x, y) => C(x, y, 2.6, c.f, c.o, 'stroke-width="1"') + C(+x - 0.8, +y - 0.8, 0.8, '#ffffff')) },
    { id: 'locket', name: 'Heart locket', tags: ['cute', 'formal', 'garden', 'candy', 'wedding'], col: 'gd', draw: (c) => L('M 88 122 Q 100 146 112 122', c.o, 1.2) + F(heart(100, 140, 5.4), c.f, `stroke="${c.o}" stroke-width="1.2"`) },
    { id: 'scarf', name: 'Scarf', tags: ['winter', 'autumn', 'cozy', 'ski', 'camping'], col: 'rd', pat: 'st', draw: (c) => P('M 104 126 L 117 127 L 121 178 L 106 180 Z', c) + lines('M 108 180 L 108 186 M 112 180 L 112 186 M 116 179 L 116 185 M 120 179 L 120 185', c, 1.4) + P('M 82 114 Q 100 124 118 114 L 121 128 Q 100 140 79 128 Z', c) },
    { id: 'bowtie', name: 'Bow tie', tags: ['formal', 'magic', 'party', 'wedding', 'music', 'movie'], col: 'rd', pat: 'dt', draw: (c) => P('M 100 128 L 89 121 Q 87 128 89 135 Z M 100 128 L 111 121 Q 113 128 111 135 Z', c) + C(100, 128, 3.2, c.d, c.o) },
    { id: 'tie', name: 'Necktie', tags: ['formal', 'school', 'detective', 'wedding'], col: 'bl', pat: 'st', draw: (c) => P('M 97 132 L 103 132 L 107 170 L 100 178 L 93 170 Z', c) + P('M 95.5 124 L 104.5 124 L 103 132 L 97 132 Z', { f: c.d, o: c.o }) },
    { id: 'medal', name: 'Gold medal', tags: ['sport', 'hero', 'royal'], col: 'bl', draw: (c) => P('M 88 122 L 95 122 L 102 150 L 97 150 Z', c) + P('M 112 122 L 105 122 L 98 150 L 103 150 Z', { f: c.d, o: c.o }) + C(100, 157, 8.6, GOLD.f, GOLD.o) + F(star(100, 157.5, 5.2, 2.3), GOLD.l) },
    { id: 'lei', name: 'Flower lei', tags: ['beach', 'tropical', 'summer', 'garden', 'party'], col: 'hp', draw: (c) => along(9, (x, y, k) => [0, 72, 144, 216, 288].map((a) => C((+x + Math.cos(a * Math.PI / 180) * 3.2).toFixed(1), (+y + Math.sin(a * Math.PI / 180) * 3.2).toFixed(1), 2.6, [c.f, '#ffffff', '#fcd34d'][k % 3], shade([c.b, '#ffffff', '#fcd34d'][k % 3], -0.3), 'stroke-width=".8"')).join('') + C(x, y, 1.6, '#fb923c'), [100, 158], [82, 122], [118, 122]) },
    { id: 'bandana', name: 'Bandana', tags: ['western', 'pirate', 'camping', 'farm', 'adventure'], col: 'rd', pat: 'dt', draw: (c) => P('M 85 120 Q 100 128 115 120 L 117 126 L 100 152 L 83 126 Z', c) + C(112, 122, 3, c.d, c.o) },
    { id: 'chain', name: 'Chunky chain', tags: ['rock', 'music', 'party'], col: 'sv', draw: (c) => along(9, (x, y, k) => E(x, y, k % 2 ? 2.2 : 3.4, k % 2 ? 3.4 : 2.2, 'none', c.o, 'stroke-width="3"') + E(x, y, k % 2 ? 2.2 : 3.4, k % 2 ? 3.4 : 2.2, 'none', c.f, 'stroke-width="1.6"'), [100, 156]) },
    { id: 'sash', name: 'Royal sash', tags: ['royal', 'formal', 'medieval'], col: 'bl', draw: (c) => P('M 76 132 L 86 126 L 123 190 L 114 198 Z', c) + L('M 79 133 L 117 196', GOLD.f, 1.4) + C(103, 172, 6.6, GOLD.f, GOLD.o) + F(star(103, 172.5, 4, 1.8), GOLD.l) },
    { id: 'starneck', name: 'Star necklace', tags: ['space', 'magic', 'night', 'party', 'music'], col: 'gd', draw: (c) => L('M 88 122 Q 100 146 112 122', c.o, 1.2) + F(star(100, 142, 6.8, 3), c.f, `stroke="${c.o}" stroke-width="1.2" stroke-linejoin="round"`) }
  ];

  const strap = (c, d) => L(d || 'M 83 127 L 121 190', c.o, 4.2) + L(d || 'M 83 127 L 121 190', c.f, 2.6);
  const BAGS = [
    { id: 'handbag', name: 'Handbag', tags: ['formal', 'party', 'glam', 'movie', 'wedding'], col: 'hp', draw: (c) => strap(c) + P('M 112 188 L 134 188 L 136 208 Q 124 212 110 208 Z', c) + P('M 112 188 L 134 188 L 131 198 Q 123 200 115 198 Z', { f: c.d, o: c.o }) + C(123, 199, 2, GOLD.f, GOLD.o) },
    { id: 'backpack', name: 'Backpack', tags: ['school', 'camping', 'adventure', 'safari', 'casual'], col: 'or', draw: (c) => ({ back: P('M 66 134 Q 64 124 80 122 L 120 122 Q 136 124 134 134 L 136 210 Q 100 216 64 210 Z', c), main: L('M 85 125 L 83 178', c.o, 6) + L('M 85 125 L 83 178', c.f, 4.4) + L(mirrorD('M 85 125 L 83 178'), c.o, 6) + L(mirrorD('M 85 125 L 83 178'), c.f, 4.4) + P('M 80 170 L 86 170 L 86 176 L 80 176 Z', SILVER) + P(mirrorD('M 80 170 L 86 170 L 86 176 L 80 176 Z'), SILVER) }) },
    { id: 'tote', name: 'Beach tote', tags: ['beach', 'summer', 'tropical', 'garden'], col: 'cr', pat: 'st', draw: (c) => L('M 84 126 Q 70 150 56 176 M 84 126 Q 78 152 76 176', solid('#8a5a36').o, 3.4) + L('M 84 126 Q 70 150 56 176 M 84 126 Q 78 152 76 176', '#c98b4b', 2) + P('M 48 174 L 84 174 L 86 210 Q 66 214 44 210 Z', c) + C(66, 192, 4, '#fb923c', '#b45309') },
    { id: 'heartbag', name: 'Heart purse', tags: ['cute', 'candy', 'party', 'pink'], col: 'rd', draw: (c) => strap(c) + F(heart(124, 199, 11), c.f, `stroke="${c.o}" stroke-width="1.5"`) + L('M 118 196 Q 120 192 124 193', '#ffffff', 1.6, 'opacity=".7"') },
    { id: 'starbag', name: 'Star purse', tags: ['space', 'magic', 'night', 'party'], col: 'ye', pat: 'sp', draw: (c) => strap(c) + F(star(124, 199, 13, 6.4), c.f, `stroke="${c.o}" stroke-width="1.5" stroke-linejoin="round"`) },
    { id: 'treasure', name: 'Treasure pouch', tags: ['pirate', 'adventure'], col: 'br', draw: (c) => strap({ f: '#c98b4b', o: '#7a4f23' }) + C(118, 190, 3.4, GOLD.f, GOLD.o) + C(126, 189, 3.4, GOLD.f, GOLD.o) + P('M 114 192 Q 108 212 124 212 Q 140 212 134 192 Q 124 196 114 192 Z', c) + L('M 115 194 Q 124 198 133 194', GOLD.f, 1.6) },
    { id: 'satchel', name: 'Satchel', tags: ['detective', 'school', 'safari', 'camping', 'art'], col: 'tn', draw: (c) => strap(c) + P('M 108 186 L 138 186 L 138 210 L 108 210 Z', c) + P('M 108 186 L 138 186 L 138 198 Q 123 202 108 198 Z', { f: c.d, o: c.o }) + P('M 120 196 L 126 196 L 126 202 L 120 202 Z', GOLD) }
  ];

  // Wings and capes. back: behind the whole doll; main: a collar or clasp drawn at the neck.
  const BACKS = [
    { id: 'fairy', sc: 1.25, name: 'Fairy wings', tags: ['fairy', 'garden', 'magic', 'cute', 'spring'], col: 'mt', pat: 'sp', draw: (c) => ({ back: G(P('M 96 150 C 70 96 26 88 30 126 C 33 152 70 160 96 156 Z', c) + P(mirrorD('M 96 150 C 70 96 26 88 30 126 C 33 152 70 160 96 156 Z'), c) + P('M 96 160 C 72 164 46 186 58 206 C 70 220 90 194 98 166 Z', c) + P(mirrorD('M 96 160 C 72 164 46 186 58 206 C 70 220 90 194 98 166 Z'), c), 'opacity=".72"') + L('M 94 152 Q 66 128 44 118 M 94 154 Q 70 146 50 140 M 106 152 Q 134 128 156 118 M 106 154 Q 130 146 150 140 M 96 164 Q 76 182 64 200 M 104 164 Q 124 182 136 200', '#ffffff', 1.2, 'opacity=".8"') }) },
    { id: 'butterfly', sc: 1.25, name: 'Butterfly wings', tags: ['garden', 'spring', 'fairy', 'costume'], col: 'or', draw: (c) => ({ back: P('M 98 148 C 72 84 14 82 20 128 C 24 156 64 162 98 156 Z', c) + P(mirrorD('M 98 148 C 72 84 14 82 20 128 C 24 156 64 162 98 156 Z'), c) + P('M 98 160 C 70 160 34 182 48 212 C 62 232 92 200 99 166 Z', c) + P(mirrorD('M 98 160 C 70 160 34 182 48 212 C 62 232 92 200 99 166 Z'), c) + [[42, 118, 8], [62, 108, 5], [158, 118, 8], [138, 108, 5], [60, 196, 6], [140, 196, 6]].map(([x, y, r]) => C(x, y, r, '#ffffff', c.o, 'opacity=".9" stroke-width="1"')).join('') + L('M 30 132 Q 60 150 96 152 M 170 132 Q 140 150 104 152', c.o, 1.2, 'opacity=".5"') }) },
    { id: 'angel', sc: 1.25, name: 'Angel wings', tags: ['fairy', 'wedding', 'cute', 'royal'], col: 'wh', draw: (c) => { const w = 'M 96 146 C 80 112 50 96 26 104 C 30 116 34 122 40 126 C 30 130 28 138 34 146 C 42 148 46 150 50 154 C 44 160 46 170 54 174 C 70 176 84 168 96 160 Z'; return { back: P(w, c) + P(mirrorD(w), c) + L('M 40 126 Q 64 124 90 144 M 50 154 Q 70 150 92 152', c.o, 1.2, 'opacity=".55"') + L(mirrorD('M 40 126 Q 64 124 90 144 M 50 154 Q 70 150 92 152'), c.o, 1.2, 'opacity=".55"') }; } },
    { id: 'cape', name: 'Hero cape', tags: ['hero', 'costume', 'magic'], col: 'rd', draw: (c) => ({ back: P('M 80 126 Q 100 122 120 126 L 156 296 Q 142 290 128 300 Q 114 292 100 302 Q 86 292 72 300 Q 58 290 44 296 Z', c) + lines('M 92 140 L 80 290 M 108 140 L 120 290', c), main: P('M 92.5 121 L 75 130 L 84 136 Z', c) + P(mirrorD('M 92.5 121 L 75 130 L 84 136 Z'), c) + C(87, 129, 2.6, GOLD.f, GOLD.o) + C(113, 129, 2.6, GOLD.f, GOLD.o) }) },
    { id: 'royalcape', name: 'Royal robe', tags: ['royal', 'medieval', 'formal', 'fairy'], col: 'pu', draw: (c) => ({ back: P('M 78 126 Q 100 120 122 126 L 164 324 Q 100 336 36 324 Z', c) + merged(['M 36 316 Q 100 330 164 316 L 166 328 Q 100 342 34 328 Z'], WHITE, 2.4) + [48, 64, 82, 100, 118, 136, 152].map((x) => F(`M ${x} 322 L ${x - 1.4} 326 L ${x + 1.4} 326 Z`, INK)).join(''), main: merged(['M 92 120 Q 72 120 70 136 Q 80 142 90 136 Q 96 130 100 132 Q 104 130 110 136 Q 120 142 130 136 Q 128 120 108 120 Z'], WHITE, 2.4) + [[78, 134], [90, 131], [110, 131], [122, 134]].map(([x, y]) => F(`M ${x} ${y - 2} L ${x - 1.3} ${y + 1.6} L ${x + 1.3} ${y + 1.6} Z`, INK)).join('') }) },
    { id: 'bat', sc: 1.25, name: 'Bat wings', tags: ['spooky', 'costume', 'night'], col: 'pu', draw: (c) => { const w = 'M 98 148 L 54 104 Q 34 112 22 104 Q 28 124 22 140 Q 36 138 42 150 Q 48 142 60 156 Q 68 150 78 166 Q 86 158 98 162 Z'; return { back: P(w, c) + P(mirrorD(w), c) + lines('M 54 104 L 42 150 M 54 104 L 60 156 M 54 104 L 78 166', c) + lines(mirrorD('M 54 104 L 42 150 M 54 104 L 60 156 M 54 104 L 78 166'), c) }; } },
    { id: 'jetpack', name: 'Jet pack', tags: ['space', 'hero', 'adventure'], col: 'sv', draw: (c) => ({ back: P('M 50 210 Q 58 236 62 212 Q 64 230 70 210 Z', solid('#fb923c')) + P(mirrorD('M 50 210 Q 58 236 62 212 Q 64 230 70 210 Z'), solid('#fb923c')) + F('M 54 210 Q 60 224 66 210 Z', '#fde68a') + F(mirrorD('M 54 210 Q 60 224 66 210 Z'), '#fde68a') + P('M 48 128 Q 48 118 60 118 Q 72 118 72 128 L 72 206 L 48 206 Z', c) + P(mirrorD('M 48 128 Q 48 118 60 118 Q 72 118 72 128 L 72 206 L 48 206 Z'), c) + P('M 48 196 L 72 196 L 70 212 L 50 212 Z', solid('#3f7ef0')) + P(mirrorD('M 48 196 L 72 196 L 70 212 L 50 212 Z'), solid('#3f7ef0')) + L('M 54 130 L 54 190 M 146 130 L 146 190', '#ffffff', 2, 'opacity=".6"') }) },
    { id: 'dragon', sc: 1.25, name: 'Dragon wings', tags: ['fairy', 'medieval', 'costume', 'adventure'], col: 'gr', draw: (c) => { const w = 'M 98 148 L 60 96 L 50 84 L 46 98 Q 30 104 18 100 Q 26 116 20 128 Q 34 126 38 140 Q 50 134 56 150 Q 66 146 74 162 Q 86 152 98 160 Z'; return { back: P(w, c) + P(mirrorD(w), c) + lines('M 60 96 L 38 140 M 60 96 L 56 150 M 60 96 L 74 162', c) + lines(mirrorD('M 60 96 L 38 140 M 60 96 L 56 150 M 60 96 L 74 162'), c) }; } },
    { id: 'cloak', name: 'Magic cloak', tags: ['magic', 'night', 'spooky', 'fairy', 'medieval'], col: 'nv', pat: 'sr', draw: (c) => ({ back: P('M 80 124 Q 100 118 120 124 L 150 322 Q 100 332 50 322 Z', c), main: P('M 92.5 121 L 74 128 Q 76 136 84 138 Z', c) + P(mirrorD('M 92.5 121 L 74 128 Q 76 136 84 138 Z'), c) + C(100, 126, 3, GOLD.f, GOLD.o) + L('M 88 128 L 97 126 M 112 128 L 103 126', GOLD.f, 1.2) }) }
  ];

  // Things to hold, drawn at the hand (0,0), upright. body: true = worn across the body instead.
  const HELD = [
    { id: 'umbrella', sc: 1, name: 'Umbrella', tags: ['rain', 'autumn', 'garden', 'formal'], col: 'hp', pat: 'dt', draw: (c) => L('M 0 6 L 0 -78', '#4b4555', 2.4) + L('M 0 6 Q 0 16 -6 16 Q -11 16 -11 10', '#4b4555', 2.6) + P('M -46 -76 Q -42 -118 0 -122 Q 42 -118 46 -76 Q 34 -84 23 -76 Q 12 -84 0 -76 Q -12 -84 -23 -76 Q -34 -84 -46 -76 Z', c) + lines('M 0 -121 Q -14 -100 -23 -76 M 0 -121 Q 14 -100 23 -76 M 0 -122 L 0 -76', c) + L('M 0 -122 L 0 -128', '#4b4555', 2.4) },
    { id: 'mic', name: 'Microphone', tags: ['music', 'rock', 'party', 'disco', 'movie'], col: 'bk', draw: (c) => P('M -3.4 -3 L 3.4 -3 L 2.2 16 L -2.2 16 Z', c) + C(0, -10, 7.4, '#cfd6e0', '#7f8a99') + L('M -5 -12 L 5 -12 M -5.6 -8.5 L 5.6 -8.5 M -2 -16 L -2 -4 M 2 -16 L 2 -4', '#7f8a99', 0.8) + P('M -4 -3.5 L 4 -3.5 L 4 0 L -4 0 Z', solid('#ec4899')) },
    { id: 'wand', name: 'Magic wand', tags: ['fairy', 'magic', 'royal', 'cute', 'ballet'], col: 'ye', pat: 'sp', draw: (c) => L('M 0 12 L 0 -32', '#8a5a36', 3.4) + L('M 0 12 L 0 -32', '#e8c08a', 1.6) + F(star(0, -42, 12, 5.4), c.f, `stroke="${c.o}" stroke-width="1.5" stroke-linejoin="round"`) + F(glint(14, -56, 4), '#ffffff') + F(glint(-13, -54, 3), '#fde68a') + C(12, -34, 1.6, '#ffffff') },
    { id: 'trophy', name: 'Trophy', tags: ['sport', 'hero', 'music'], col: 'gd', draw: (c) => P('M -9 4 L 9 4 L 8 -4 L -8 -4 Z', solid('#8a5a36')) + P('M -2.5 -4 L 2.5 -4 L 2 -14 L -2 -14 Z', c) + L('M -12 -34 Q -22 -34 -18 -24 Q -15 -18 -8 -20 M 12 -34 Q 22 -34 18 -24 Q 15 -18 8 -20', c.o, 3.4) + L('M -12 -34 Q -22 -34 -18 -24 Q -15 -18 -8 -20 M 12 -34 Q 22 -34 18 -24 Q 15 -18 8 -20', c.f, 1.8) + P('M -13 -38 L 13 -38 Q 13 -16 0 -14 Q -13 -16 -13 -38 Z', c) + F(star(0, -27, 5, 2.2), '#ffffff', 'opacity=".9"') },
    { id: 'football', name: 'Football', tags: ['sport', 'casual'], col: 'wh', draw: (c) => C(0, -12, 13, c.f, c.o) + F('M 0 -17 L 4.8 -13.4 L 3 -7.8 L -3 -7.8 L -4.8 -13.4 Z', INK) + L('M 0 -17 L 0 -25 M 4.8 -13.4 L 12 -16 M 3 -7.8 L 8 -2 M -3 -7.8 L -8 -2 M -4.8 -13.4 L -12 -16', INK, 1.2) },
    { id: 'beachball', name: 'Beach ball', tags: ['beach', 'summer', 'tropical', 'party'], col: 'rd', draw: (c) => C(0, -14, 14, '#ffffff', '#b9b3aa') + F('M 0 -28 Q -12 -14 0 0 Q -14 -2 -14 -14 Q -14 -26 0 -28 Z', c.f) + F('M 0 -28 Q 12 -14 0 0 Q 6 -14 0 -28 Z', '#3f7ef0') + F('M 0 -28 Q 14 -26 14 -14 Q 14 -2 0 0 Q 12 -14 0 -28 Z', '#fcd34d') + C(0, -14, 14, 'none', '#7f8a99', 'stroke-width="1.2"') + C(-5, -21, 2.4, '#ffffff', null, 'opacity=".8"') },
    { id: 'spyglass', name: 'Spyglass', tags: ['pirate', 'adventure', 'ocean', 'space', 'detective'], col: 'br', draw: (c) => P('M -4 10 L 4 10 L 4.6 -12 L -4.6 -12 Z', c) + P('M -6 -12 L 6 -12 L 7 -38 L -7 -38 Z', GOLD) + P('M -7.6 -38 L 7.6 -38 L 7.6 -43 L -7.6 -43 Z', c) + L('M -5 -24 L 5 -24', GOLD.o, 1) },
    { id: 'bouquet', name: 'Bouquet', tags: ['garden', 'wedding', 'spring', 'royal', 'formal'], col: 'pk', draw: (c) => L('M -4 10 L -2 -16 M 0 10 L 0 -18 M 4 10 L 2 -16', '#35b86a', 1.8) + [[-8, -22, c.f], [6, -26, '#ffffff'], [-1, -32, '#fcd34d'], [9, -16, c.f], [-10, -12, '#c7b6fb']].map(([x, y, col]) => [0, 72, 144, 216, 288].map((a) => C((x + Math.cos(a * Math.PI / 180) * 3.6).toFixed(1), (y + Math.sin(a * Math.PI / 180) * 3.6).toFixed(1), 3.2, col, shade(col, -0.3), 'stroke-width=".8"')).join('') + C(x, y, 2, '#fb923c')).join('') + P('M -10 -8 L 10 -8 L 3 10 L -3 10 Z', solid('#fbfaf7')) + L('M -4 2 L 4 2', '#ec4899', 2.4) },
    { id: 'icecream', name: 'Ice cream', tags: ['summer', 'beach', 'candy', 'party'], col: 'pk', draw: (c) => P('M -8 -8 L 8 -8 L 0 14 Z', solid('#e0a86a')) + L('M -5 -3 L 3 4 M 4 -6 L -3 5 M -2 -8 L 5 -2', '#b07a3c', 1) + C(0, -14, 9, c.f, c.o) + C(-5, -24, 7.4, '#97e6c8', '#4ea886') + C(5, -24, 7.4, '#f6e7c8', '#c4ad86') + C(0, -32, 3, '#ec4048', '#9b1d24') + F('M -8 -10 Q -6 -6 -3 -10 Q 0 -6 3 -10 Q 6 -6 8 -10', 'none', `stroke="${c.o}" stroke-width=".8"`) },
    { id: 'balloon', sc: 1, name: 'Balloon', tags: ['party', 'birthday', 'candy', 'cute'], col: 'rd', draw: (c) => L('M 0 2 Q 10 -30 2 -60 Q -4 -72 6 -82', '#7f8a99', 1.1) + E(6, -100, 16, 19, c.f, c.o) + P('M 3 -80.5 L 9 -80.5 L 6 -84 Z', c) + E(0, -107, 4, 7, '#ffffff', null, 'opacity=".55" transform="rotate(20 0 -107)"') },
    { id: 'lantern', name: 'Lantern', tags: ['camping', 'night', 'fairy', 'adventure', 'pirate'], col: 'gd', draw: (c) => L('M -6 2 Q 0 -8 6 2', c.o, 1.6) + P('M -7 2 L 7 2 L 9 6 L -9 6 Z', c) + F('M -8 6 L 8 6 L 10 30 L -10 30 Z', '#fde68a', 'stroke="#c99a08" stroke-width="1.4"') + C(0, 18, 9, '#fff6c9', null, 'opacity=".6"') + L('M -4 6 L -5 30 M 4 6 L 5 30', c.o, 1.2) + P('M -11 30 L 11 30 L 9 35 L -9 35 Z', c) },
    { id: 'teddy', name: 'Teddy bear', tags: ['pajama', 'cozy', 'cute'], col: 'tn', draw: (c) => E(0, 22, 10, 12, c.f, c.o) + E(0, 24, 5.6, 6.6, c.l) + C(-7.4, -1, 3.8, c.f, c.o) + C(7.4, -1, 3.8, c.f, c.o) + C(0, 6, 9, c.f, c.o) + E(0, 9, 4, 3, c.l) + C(-3.2, 4.4, 1.1, INK) + C(3.2, 4.4, 1.1, INK) + E(0, 8, 1.4, 1, INK) + C(-9, 30, 3.6, c.f, c.o) + C(9, 30, 3.6, c.f, c.o) },
    { id: 'palette', name: 'Paint palette', tags: ['art', 'school'], col: 'tn', draw: (c) => P('M -16 -6 Q -18 -22 0 -24 Q 18 -24 18 -10 Q 18 0 8 -2 Q 2 -2 4 4 Q 4 10 -6 8 Q -15 6 -16 -6 Z', c) + C(-8, -14, 3, '#ec4048') + C(1, -18, 3, '#3f7ef0') + C(10, -13, 3, '#fcd34d') + C(-9, -3, 3, '#35b86a') + L('M 12 6 L 26 -24', '#8a5a36', 2.2) + P('M 25 -24 L 28 -30 L 29 -23 Z', solid('#9045e0')) },
    { id: 'lollipop', name: 'Lollipop', tags: ['candy', 'party', 'cute', 'birthday'], col: 'hp', draw: (c) => L('M 0 12 L 0 -26', '#fbfaf7', 3.2) + C(0, -38, 13, c.f, c.o) + L('M 0 -38 m -9 0 a 9 9 0 1 1 9 9 a 6 6 0 1 1 -6 -6 a 3 3 0 1 1 3 3', '#ffffff', 2.2, 'opacity=".9"') },
    { id: 'magnifier', name: 'Magnifying glass', tags: ['detective', 'science', 'safari', 'adventure'], col: 'br', draw: (c) => L('M 0 12 L 0 -14', c.o, 5.4) + L('M 0 12 L 0 -14', c.f, 3.6) + C(0, -26, 11, '#dff3ff', null, 'opacity=".55"') + C(0, -26, 11, 'none', '#7f8a99', 'stroke-width="3"') + L('M -6 -30 Q -4 -34 0 -35', '#ffffff', 1.6) },
    { id: 'racket', name: 'Tennis racket', tags: ['sport', 'summer'], col: 'bl', draw: (c) => L('M 0 12 L 0 -16', '#2d2b36', 4.4) + E(0, -34, 13, 17, '#ffffff', null, 'fill-opacity=".4"') + L('M -6 -48 L -6 -20 M 0 -51 L 0 -17 M 6 -48 L 6 -20 M -11 -40 L 11 -40 M -12 -33 L 12 -33 M -11 -26 L 11 -26', '#b9b3aa', 0.8) + E(0, -34, 13, 17, 'none', c.o, 'stroke-width="4.4"') + E(0, -34, 13, 17, 'none', c.f, 'stroke-width="2.6"') + C(12, -22, 4.6, '#d6f264', '#8aa42b') },
    { id: 'surfboard', sc: 1, name: 'Surfboard', tags: ['beach', 'ocean', 'summer', 'tropical', 'sport'], col: 'sk', pat: 'st', draw: (c) => E(14, -30, 12, 62, c.f, c.o) + L('M 14 -90 L 14 30', '#ffffff', 2.4, 'opacity=".75"') + F('M 10 30 L 14 42 L 18 30 Z', c.o) },
    { id: 'pennant', name: 'Team flag', tags: ['sport', 'party', 'school'], col: 'rd', draw: (c) => L('M 0 12 L 0 -64', '#8a5a36', 2.6) + P('M 0 -64 L 38 -54 L 0 -42 Z', c) + F(star(13, -53, 4.4, 2), '#ffffff') },
    { id: 'map', name: 'Treasure map', tags: ['pirate', 'adventure', 'safari', 'camping'], col: 'cr', draw: (c) => P('M -18 -22 L 18 -22 L 18 4 L -18 4 Z', c) + E(-18, -9, 3, 13, c.d, c.o) + E(18, -9, 3, 13, c.d, c.o) + L('M -12 -2 Q -6 -16 2 -10 Q 8 -6 10 -14', '#8a5a36', 1.2, 'stroke-dasharray="2 2"') + L('M 8 -18 L 13 -12 M 13 -18 L 8 -12', '#ec4048', 1.8) },
    { id: 'whisk', name: 'Whisk', tags: ['chef', 'cute'], col: 'sv', draw: (c) => L('M 0 12 L 0 -6', '#ec4048', 4.4) + L('M 0 -6 Q -10 -26 0 -40 Q 10 -26 0 -6 M 0 -6 Q -4 -26 0 -40 Q 4 -26 0 -6', c.o, 1.4) },
    { id: 'book', name: 'Story book', tags: ['school', 'fairy', 'magic', 'detective', 'cozy'], col: 'pu', draw: (c) => P('M -13 -22 L 13 -22 L 13 8 L -13 8 Z', c) + P('M -11 -20 L 13 -20 L 13 6 L -11 6 Z', WHITE) + P('M -13 -22 L 11 -22 L 11 4 L -13 4 Z', c) + F(star(-1, -9, 6, 2.8), GOLD.f) },
    { id: 'guitar', sc: 1, name: 'Guitar', tags: ['rock', 'music', 'western', 'camping', 'party'], col: 'rd', body: true, draw: (c) => L('M 78 128 Q 100 120 124 182', '#2d2b36', 2.4) + P('M 66 120 L 72 116 L 110 168 L 104 172 Z', solid('#8a5a36')) + P('M 62 116 L 70 110 L 75 116 L 67 122 Z', DARK) + P('M 104 158 C 92 162 92 176 100 182 C 92 192 104 210 118 204 C 132 210 142 192 134 182 C 140 168 126 154 116 162 C 112 156 106 154 104 158 Z', c) + C(113, 182, 5.4, DARK.f, DARK.o) + L('M 100 158 L 126 196', '#f2f2f2', 0.8) + P('M 116 190 L 128 186 L 130 192 L 118 196 Z', DARK) }
  ];

  // ===================================================================================================
  // Registry
  // ===================================================================================================
  const SLOTS = [
    { k: 'top', name: 'Tops', icon: 'shirt', items: TOPS },
    { k: 'dress', name: 'Dresses', icon: 'sparkles', items: DRESSES },
    { k: 'bottom', name: 'Bottoms', icon: 'grid', items: BOTTOMS },
    { k: 'jacket', name: 'Jackets', icon: 'layers', items: JACKETS },
    { k: 'shoes', name: 'Shoes', icon: 'shoe', items: SHOES },
    { k: 'hat', name: 'Hats', icon: 'hat', items: HATS },
    { k: 'glasses', name: 'Glasses', icon: 'sun', items: GLASSES },
    { k: 'neck', name: 'Jewellery', icon: 'gem', items: NECK },
    { k: 'bag', name: 'Bags', icon: 'gift', items: BAGS },
    { k: 'back', name: 'Wings', icon: 'bird', items: BACKS },
    { k: 'held', name: 'Hold', icon: 'wand', items: HELD }
  ];
  const SLOT = {}; const ITEM = {};
  SLOTS.forEach((s) => { SLOT[s.k] = s; ITEM[s.k] = {}; s.items.forEach((it) => { it.slot = s.k; ITEM[s.k][it.id] = it; }); });
  const ACCESSORY_SLOTS = ['hat', 'glasses', 'neck', 'bag', 'back', 'held'];
  const getItem = (slot, id) => (ITEM[slot] ? ITEM[slot][id] : null);

  const DEFAULT_LOOK = { sk: 1, ey: 'sparkle', ec: 0, br: 'soft', mo: 'smile', bl: 'soft', hs: 'long', hc: '#5a3825', po: 'classic', bg: 'runway', it: {} };
  // Accepts anything (other players' data) and returns a clean outfit.
  function normalize(o) {
    o = o && typeof o === 'object' ? o : {};
    const pick = (v, list, def) => (list.some((x) => x[0] === v) ? v : def);
    const out = {
      sk: clamp(parseInt(o.sk, 10) || 0, 0, SKINS.length - 1),
      ey: pick(o.ey, EYES, 'sparkle'), ec: clamp(parseInt(o.ec, 10) || 0, 0, EYE_COLORS.length - 1),
      br: pick(o.br, BROWS, 'soft'), mo: pick(o.mo, MOUTHS, 'smile'), bl: pick(o.bl, BLUSH, 'soft'),
      hs: HAIR_BY[o.hs] ? o.hs : 'long', hc: /^#[0-9a-f]{6}$/i.test(o.hc || '') ? o.hc.toLowerCase() : '#5a3825',
      po: POSE_GEO[o.po] ? o.po : 'classic', bg: BGS.some((b) => b[0] === o.bg) ? o.bg : 'runway', it: {}
    };
    const it = o.it && typeof o.it === 'object' ? o.it : {};
    SLOTS.forEach((s) => {
      const v = it[s.k];
      if (Array.isArray(v) && getItem(s.k, v[0])) out.it[s.k] = [v[0], COL[v[1]] ? v[1] : getItem(s.k, v[0]).col, PATTERNS.some((p) => p[0] === v[2]) ? v[2] : 'so'];
    });
    if (out.it.dress && !getItem('dress', out.it.dress[0]).over) { delete out.it.top; delete out.it.bottom; }
    return out;
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ===================================================================================================
  // Backgrounds (drawn in the doll's view box: x -20..220, y -14..340)
  // ===================================================================================================
  function lg(id, stops, x2, y2) { return `<linearGradient id="${id}" x1="0" y1="0" x2="${x2 == null ? 0 : x2}" y2="${y2 == null ? 1 : y2}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`; }
  const RECT = (fill, x) => `<rect x="-20" y="-14" width="240" height="354" fill="${fill}"${x ? ' ' + x : ''}/>`;
  function sprinkle(n, seed, fn) { const r = CG.rng(seed); let s = ''; for (let k = 0; k < n; k++) s += fn(-20 + r() * 240, -14 + r() * 300, r(), k); return s; }
  function background(key, id, defs) {
    const g = id + 'bg';
    switch (key) {
      case 'studio':
        defs.push(lg(g, [[0, '#fde2f3'], [1, '#e0e7ff']]));
        return RECT(`url(#${g})`) + C(100, 130, 110, '#ffffff', null, 'opacity=".45"') + sprinkle(26, 7, (x, y, r, k) => C(x.toFixed(0), y.toFixed(0), (1.4 + r * 2.4).toFixed(1), ['#f472b6', '#a78bfa', '#60a5fa', '#fcd34d'][k % 4], null, 'opacity=".55"')) + F('M -20 300 L 220 300 L 220 340 L -20 340 Z', '#ffffff', 'opacity=".6"');
      case 'beach':
        defs.push(lg(g, [[0, '#7dd3fc'], [0.6, '#e0f7ff'], [1, '#fff7e0']]));
        return RECT(`url(#${g})`) + C(170, 40, 24, '#fde68a') + C(170, 40, 32, '#fde68a', null, 'opacity=".35"') + E(30, 50, 26, 9, '#ffffff', null, 'opacity=".9"') + E(50, 44, 16, 9, '#ffffff', null, 'opacity=".9"') + F('M -20 222 L 220 222 L 220 290 L -20 290 Z', '#38bdf8') + L('M -10 236 Q 0 232 10 236 M 40 248 Q 50 244 60 248 M 140 240 Q 150 236 160 240 M 180 258 Q 190 254 200 258', '#ffffff', 1.6, 'opacity=".8"') + F('M -20 278 Q 40 266 100 276 Q 160 286 220 272 L 220 340 L -20 340 Z', '#fcd9a0') + L('M 180 300 L 196 220', '#a16207', 4) + F('M 196 220 Q 170 208 160 222 Q 180 214 196 222 Q 214 204 226 214 Q 210 212 196 222 Q 206 236 200 250 Q 196 234 196 222 Z', '#22a35a') + C(20, 316, 3, '#f472b6') + F(star(56, 320, 5, 2.2), '#fb923c');
      case 'castle':
        defs.push(lg(g, [[0, '#c4b5fd'], [1, '#fbcfe8']]));
        return RECT(`url(#${g})`) + E(40, 60, 28, 10, '#ffffff', null, 'opacity=".7"') + E(170, 90, 24, 8, '#ffffff', null, 'opacity=".7"') + F('M 20 290 L 20 140 L 14 140 L 30 110 L 46 140 L 40 140 L 40 190 L 70 190 L 70 120 L 62 120 L 82 80 L 102 120 L 94 120 L 94 190 L 106 190 L 106 120 L 98 120 L 118 80 L 138 120 L 130 120 L 130 190 L 160 190 L 160 140 L 154 140 L 170 110 L 186 140 L 180 140 L 180 290 Z', '#a78bfa', 'opacity=".55"') + F('M 88 290 L 88 250 Q 100 236 112 250 L 112 290 Z', '#7c3aed', 'opacity=".35"') + F('M -20 290 L 220 290 L 220 340 L -20 340 Z', '#f5d0fe') + sprinkle(10, 3, (x, y) => F(glint(x, y * 0.6, 3), '#ffffff', 'opacity=".9"'));
      case 'space':
        defs.push(lg(g, [[0, '#0b1033'], [1, '#3b1d6e']]));
        return RECT(`url(#${g})`) + sprinkle(50, 11, (x, y, r) => C(x.toFixed(0), y.toFixed(0), (0.5 + r * 1.3).toFixed(1), '#ffffff', null, `opacity="${(0.5 + r * 0.5).toFixed(2)}"`)) + C(168, 56, 22, '#f472b6') + E(168, 56, 36, 7, 'none', '#fcd34d', 'stroke-width="3" opacity=".9"') + C(30, 110, 9, '#60a5fa') + F('M -20 296 Q 100 270 220 296 L 220 340 L -20 340 Z', '#c7c3d9') + E(40, 312, 12, 4, '#a8a2c0') + E(160, 306, 16, 5, '#a8a2c0');
      case 'city':
        defs.push(lg(g, [[0, '#fb923c'], [0.5, '#f9a8d4'], [1, '#a78bfa']]));
        return RECT(`url(#${g})`) + C(100, 220, 40, '#fde68a', null, 'opacity=".7"') + [[-20, 140, 40], [16, 180, 30], [40, 120, 34], [70, 200, 26], [120, 150, 36], [150, 100, 30], [176, 170, 44]].map(([x, y, w], k) => F(`M ${x} 300 L ${x} ${y} L ${x + w} ${y} L ${x + w} 300 Z`, k % 2 ? '#4c1d95' : '#6d28d9', 'opacity=".75"') + sprinkle(5, k + 20, (xx, yy, r) => F(`M ${(x + 4 + r * (w - 10)).toFixed(0)} ${(y + 8 + ((yy + 14) / 300) * (280 - y)).toFixed(0)} l 4 0 l 0 5 l -4 0 Z`, '#fde68a', 'opacity=".9"'))).join('') + F('M -20 300 L 220 300 L 220 340 L -20 340 Z', '#3f3a52');
      case 'garden':
        defs.push(lg(g, [[0, '#bae6fd'], [1, '#ecfccb']]));
        return RECT(`url(#${g})`) + E(150, 40, 26, 9, '#ffffff') + F('M -20 240 Q 40 200 100 236 Q 160 200 220 236 L 220 340 L -20 340 Z', '#86efac') + F('M -20 280 Q 60 260 120 284 Q 180 266 220 280 L 220 340 L -20 340 Z', '#4ade80') + sprinkle(16, 5, (x, y, r, k) => { const yy = 286 + r * 46; return [0, 72, 144, 216, 288].map((a) => C((x + Math.cos(a * Math.PI / 180) * 2.6).toFixed(1), (yy + Math.sin(a * Math.PI / 180) * 2.6).toFixed(1), 2.2, ['#f472b6', '#ffffff', '#fcd34d', '#c084fc'][k % 4])).join('') + C(x.toFixed(1), yy.toFixed(1), 1.4, '#fb923c'); });
      case 'snow':
        defs.push(lg(g, [[0, '#bfdbfe'], [1, '#eff6ff']]));
        return RECT(`url(#${g})`) + [[10, 260, 26], [190, 250, 30], [44, 280, 18]].map(([x, y, s]) => F(`M ${x} ${y - s * 2.6} L ${x + s} ${y} L ${x - s} ${y} Z`, '#2f7a5a') + F(`M ${x} ${y - s * 2.6} L ${x + s * 0.45} ${y - s * 1.4} L ${x - s * 0.45} ${y - s * 1.4} Z`, '#ffffff')).join('') + F('M -20 280 Q 100 260 220 280 L 220 340 L -20 340 Z', '#ffffff') + sprinkle(40, 9, (x, y, r) => C(x.toFixed(0), y.toFixed(0), (1 + r * 2).toFixed(1), '#ffffff', null, 'opacity=".9"'));
      case 'rain':
        defs.push(lg(g, [[0, '#94a3b8'], [1, '#cbd5e1']]));
        return RECT(`url(#${g})`) + merged(['M 10 40 a 22 22 0 1 0 44 0 a 22 22 0 1 0 -44 0 Z', 'M 40 30 a 26 26 0 1 0 52 0 a 26 26 0 1 0 -52 0 Z', 'M 120 50 a 22 22 0 1 0 44 0 a 22 22 0 1 0 -44 0 Z', 'M 150 40 a 28 28 0 1 0 56 0 a 28 28 0 1 0 -56 0 Z'], { f: '#e2e8f0', o: '#e2e8f0' }) + sprinkle(46, 13, (x, y) => L(`M ${x.toFixed(0)} ${(y + 40).toFixed(0)} l -3 9`, '#e0f2fe', 1.4, 'opacity=".8"')) + F('M -20 296 L 220 296 L 220 340 L -20 340 Z', '#64748b') + E(150, 320, 34, 6, '#93c5fd', null, 'opacity=".7"') + E(40, 312, 20, 4, '#93c5fd', null, 'opacity=".7"');
      case 'stage':
        defs.push(lg(g, [[0, '#1e1b4b'], [1, '#581c87']]));
        return RECT(`url(#${g})`) + F('M 20 -14 L 60 -14 L 130 300 L 40 300 Z', '#f472b6', 'opacity=".22"') + F('M 140 -14 L 180 -14 L 160 300 L 70 300 Z', '#60a5fa', 'opacity=".22"') + F('M 90 -14 L 110 -14 L 150 300 L 50 300 Z', '#fde68a', 'opacity=".18"') + sprinkle(18, 17, (x, y, r, k) => C(x.toFixed(0), (y * 0.3).toFixed(0), 2.4, ['#f472b6', '#60a5fa', '#fde68a'][k % 3], null, 'opacity=".9"')) + F('M -20 296 L 220 296 L 220 340 L -20 340 Z', '#2e1065') + F('M -14 230 L 20 230 L 20 296 L -14 296 Z', '#18181b') + C(3, 252, 9, '#3f3f46') + C(3, 280, 6, '#3f3f46') + F('M 180 230 L 214 230 L 214 296 L 180 296 Z', '#18181b') + C(197, 252, 9, '#3f3f46') + C(197, 280, 6, '#3f3f46');
      case 'forest':
        defs.push(lg(g, [[0, '#14532d'], [1, '#4d7c0f']]));
        return RECT(`url(#${g})`) + [[-6, 14], [30, 10], [160, 12], [196, 16]].map(([x, w]) => F(`M ${x} -14 L ${x + w} -14 L ${x + w + 4} 300 L ${x - 4} 300 Z`, '#3f2a14', 'opacity=".7"')).join('') + E(100, 0, 160, 50, '#166534', null, 'opacity=".8"') + F('M -20 290 Q 100 276 220 290 L 220 340 L -20 340 Z', '#65a30d') + [[30, 300], [170, 306]].map(([x, y]) => F(`M ${x - 4} ${y} L ${x + 4} ${y} L ${x + 3} ${y - 10} L ${x - 3} ${y - 10} Z`, '#fef3c7') + F(`M ${x - 12} ${y - 9} Q ${x} ${y - 26} ${x + 12} ${y - 9} Z`, '#ef4444') + C(x - 4, y - 14, 1.8, '#ffffff') + C(x + 4, y - 16, 1.6, '#ffffff')).join('') + sprinkle(16, 21, (x, y) => C(x.toFixed(0), y.toFixed(0), 2, '#fde68a', null, 'opacity=".85"'));
      case 'ocean':
        defs.push(lg(g, [[0, '#22d3ee'], [1, '#1e40af']]));
        return RECT(`url(#${g})`) + F('M -20 -14 L 40 -14 L 0 300 L -20 300 Z', '#ffffff', 'opacity=".08"') + F('M 120 -14 L 170 -14 L 120 300 L 90 300 Z', '#ffffff', 'opacity=".08"') + sprinkle(18, 23, (x, y, r) => C(x.toFixed(0), y.toFixed(0), (2 + r * 4).toFixed(1), 'none', '#e0f2fe', 'stroke-width="1.2" opacity=".7"')) + [[-4, 1], [16, -1], [186, 1], [204, -1]].map(([x, s]) => L(`M ${x} 330 Q ${x + 10 * s} 300 ${x} 270 Q ${x - 10 * s} 240 ${x} 210`, '#22c55e', 5)).join('') + F('M -20 300 Q 100 288 220 300 L 220 340 L -20 340 Z', '#fde68a') + F(star(40, 320, 7, 3), '#fb7185') + E(170, 322, 7, 4, '#f9a8d4');
      case 'stadium':
        defs.push(lg(g, [[0, '#7dd3fc'], [1, '#e0f2fe']]));
        return RECT(`url(#${g})`) + F('M -20 150 L 220 150 L 220 250 L -20 250 Z', '#64748b') + sprinkle(80, 29, (x, y, r, k) => C(x.toFixed(0), (156 + (y + 14) / 300 * 88).toFixed(0), 2.2, ['#ef4444', '#3b82f6', '#fcd34d', '#ffffff', '#22c55e'][k % 5])) + F('M -20 250 L 220 250 L 220 340 L -20 340 Z', '#22a35a') + L('M -20 300 L 220 300 M 100 250 L 100 340', '#ffffff', 2, 'opacity=".7"') + E(100, 300, 40, 10, 'none', '#ffffff', 'stroke-width="2" opacity=".7"') + [[10, 150], [190, 150]].map(([x, y]) => L(`M ${x} ${y} L ${x} 20`, '#94a3b8', 3) + F(`M ${x - 14} 8 L ${x + 14} 8 L ${x + 14} 26 L ${x - 14} 26 Z`, '#e2e8f0')).join('');
      case 'night':
        defs.push(lg(g, [[0, '#1e1b4b'], [1, '#4338ca']]));
        return RECT(`url(#${g})`) + sprinkle(40, 31, (x, y, r) => (r > 0.8 ? F(star(x, y * 0.8, 3.4, 1.4), '#fde68a') : C(x.toFixed(0), (y * 0.8).toFixed(0), (0.6 + r).toFixed(1), '#ffffff', null, 'opacity=".9"'))) + C(160, 50, 20, '#fef3c7') + C(170, 44, 18, '#2e2a6b') + F('M -20 280 Q 50 250 110 276 Q 170 254 220 272 L 220 340 L -20 340 Z', '#312e81');
      case 'candy':
        defs.push(lg(g, [[0, '#fbcfe8'], [1, '#fef9c3']]));
        return RECT(`url(#${g})`) + merged(['M 0 60 a 16 16 0 1 0 32 0 a 16 16 0 1 0 -32 0 Z', 'M 22 50 a 20 20 0 1 0 40 0 a 20 20 0 1 0 -40 0 Z', 'M 140 80 a 16 16 0 1 0 32 0 a 16 16 0 1 0 -32 0 Z', 'M 160 70 a 20 20 0 1 0 40 0 a 20 20 0 1 0 -40 0 Z'], { f: '#ffffff', o: '#ffffff' }) + [[10, 200, '#f472b6'], [190, 190, '#60a5fa']].map(([x, y, col]) => L(`M ${x} 300 L ${x} ${y}`, '#ffffff', 4) + C(x, y - 14, 16, col) + L(`M ${x} ${y - 14} m -10 0 a 10 10 0 1 1 10 10 a 6 6 0 1 1 -6 -6`, '#ffffff', 2.4, 'opacity=".9"')).join('') + L('M 40 300 L 40 240 Q 40 226 52 226 Q 64 226 64 238', '#ffffff', 7) + L('M 40 300 L 40 240 Q 40 226 52 226 Q 64 226 64 238', '#ef4444', 7, 'stroke-dasharray="6 6"') + F('M -20 296 Q 100 282 220 296 L 220 340 L -20 340 Z', '#f9a8d4') + sprinkle(20, 37, (x, y, r, k) => F(`M ${x.toFixed(0)} ${(300 + r * 36).toFixed(0)} l 4 -2`, 'none', `stroke="${['#fcd34d', '#60a5fa', '#ffffff'][k % 3]}" stroke-width="2" stroke-linecap="round"`));
      case 'desert':
        defs.push(lg(g, [[0, '#fdba74'], [1, '#fef3c7']]));
        return RECT(`url(#${g})`) + C(150, 70, 26, '#fef9c3') + F('M -20 250 L 0 190 L 50 190 L 66 250 Z', '#c2410c', 'opacity=".55"') + F('M 130 250 L 146 170 L 200 170 L 220 250 Z', '#c2410c', 'opacity=".45"') + F('M -20 260 Q 100 240 220 262 L 220 340 L -20 340 Z', '#fcd9a0') + L('M 180 310 L 180 250 M 180 286 Q 168 286 168 270 M 180 276 Q 192 276 192 262', '#16a34a', 7) + C(30, 316, 2.4, '#a16207') + C(64, 306, 1.6, '#a16207');
      default: // runway
        defs.push(lg(g, [[0, '#f5d0fe'], [1, '#c4b5fd']]));
        defs.push(lg(g + 'c', [[0, '#f9a8d4'], [1, '#ec4899']]));
        return RECT(`url(#${g})`) + F('M 10 -14 L 50 -14 L 110 300 L 30 300 Z', '#ffffff', 'opacity=".22"') + F('M 150 -14 L 190 -14 L 170 300 L 90 300 Z', '#ffffff', 'opacity=".22"') + sprinkle(12, 41, (x, y, r, k) => C((-12 + k * 21).toFixed(0), 2, 3.4, '#fef3c7', '#f59e0b', 'stroke-width="1"')) + F('M 70 270 L 130 270 L 190 340 L 10 340 Z', `url(#${g}c)`) + L('M 70 270 L 10 340 M 130 270 L 190 340', '#ffffff', 2, 'opacity=".7"') + F('M -20 270 L 70 270 L 10 340 L -20 340 Z', '#a78bfa', 'opacity=".5"') + F('M 220 270 L 130 270 L 190 340 L 220 340 Z', '#a78bfa', 'opacity=".5"') + sprinkle(10, 43, (x, y) => F(glint(x, y * 0.8, 3), '#ffffff', 'opacity=".9"'));
    }
  }

  // ===================================================================================================
  // The doll
  // ===================================================================================================
  const VIEWS = {
    full: '-20 -14 240 354', face: '58 54 84 58', head: '28 -14 144 140', top: '42 98 116 124', dress: '14 92 172 244', bottom: '36 172 128 164',
    shoes: '58 246 84 92', hat: '24 -24 152 122', glasses: '50 54 100 62', neck: '60 100 80 84', bag: '28 112 144 116', back: '-20 40 240 290', held: '-20 -14 240 354', body: '30 20 140 230'
  };
  // render(outfit, { bg, view, cls }) -> svg markup
  function render(o, opt) {
    opt = opt || {};
    const id = 'ss' + (++UID);
    const defs = [];
    const skin = SKINS[o.sk] || SKINS[1];
    const SK = { f: skin, o: shade(skin, -0.3) };
    const hc = o.hc || '#5a3825';
    const H = { f: hc, o: shade(hc, luma(hc) > 0.75 ? -0.32 : -0.45), d: shade(hc, -0.22), l: shade(hc, 0.5) };
    const hair = HAIR_BY[o.hs] || HAIR[0];
    const pose = o.po || 'classic';
    const gg = { pose, A: { L: armPts('L', pose), R: armPts('R', pose) } };
    const parts = {};
    const it = o.it || {};
    SLOTS.forEach((s) => {
      const v = it[s.k];
      if (!v) return;
      const item = getItem(s.k, v[0]);
      if (!item) return;
      const c = fabric(defs, id + s.k, v[1] || item.col, v[2] || 'so');
      let res = item.draw(c, gg);
      if (typeof res === 'string') res = { main: res };
      parts[s.k] = { item, c, res };
    });
    const part = (k, layer) => (parts[k] && parts[k].res[layer]) || '';
    const dress = parts.dress, top = parts.top, bottom = parts.bottom, shoes = parts.shoes, jacket = parts.jacket, held = parts.held;
    const overDress = dress && dress.item.over;
    let s = '';
    if (opt.bg) s += background(o.bg, id, defs);
    s += E(100, 330, 44, 7, '#1a1020', null, 'opacity=".16"');
    // behind the body
    s += (parts.back && parts.back.item.sc ? G(part('back', 'back'), `transform="translate(100 150) scale(${parts.back.item.sc}) translate(-100 -150)"`) : part('back', 'back')) + part('bag', 'back') + part('jacket', 'back') + part('dress', 'back') + part('hat', 'back');
    s += hair.back(H);
    // body
    const Lp = legPts('L', pose), Rp = legPts('R', pose);
    s += merged([limb(Lp, [10, 7, 5]), limb(Rp, [10, 7, 5])], SK);
    const footT = (P0) => `transform="translate(${P0.ank[0].toFixed(1)} ${P0.ank[1]}) scale(${P0.sx * 1.18} 1.18) rotate(-7)"`;
    const foot = P('M -5.5 -4 L 5.5 -4 Q 8 6 6.5 10.5 Q 0 14 -6.5 10.5 Q -8 6 -5.5 -4 Z', SK);
    if (!shoes || shoes.item.bare) s += G(foot, footT(Lp)) + G(foot, footT(Rp));
    s += P('M 93 100 L 107 100 L 107.5 126 Q 100 129 92.5 126 Z', SK) + F('M 93 108 Q 100 116 107 108 L 107 114 Q 100 120 93 114 Z', shade(skin, -0.12));
    s += P('M 92.5 121 Q 80 123 74.5 131.5 L 77.5 152 Q 83.5 166 84 182 Q 81 192 80 200 L 120 200 Q 119 192 116 182 Q 116.5 166 122.5 152 L 125.5 131.5 Q 120 123 107.5 121 Z', SK);
    // basics underneath
    if (!top && !dress) s += P(topD({ neck: 'tank', hem: 196 }), { f: '#f4f1ec', o: '#cfc8bd' });
    if (!bottom && !dress) s += merged(pantsD(pose, [11.4, 10.6, 9], 214, 188), { f: '#f4f1ec', o: '#cfc8bd' });
    const shoeDraw = (P0) => G(shoes.res.main, footT(P0));
    if (shoes && !shoes.item.tall) s += shoeDraw(Lp) + shoeDraw(Rp);
    if (bottom && bottom.item.pants) s += bottom.res.main;
    s += part('dress', 'legs');
    if (shoes && shoes.item.tall) s += shoeDraw(Lp) + shoeDraw(Rp);
    if (bottom && !bottom.item.pants) s += bottom.res.main;
    if (top && (!dress || overDress)) s += top.res.main;
    s += part('dress', 'main');
    s += part('jacket', 'main');
    s += part('neck', 'main') + part('back', 'main');
    if (held && held.item.body) s += held.res.main;
    // arms
    const slType = dress && !overDress ? dress.item.sl : (top ? top.item.sl : (dress ? dress.item.sl : 'none'));
    const slFab = dress && !overDress ? dress.c : (top ? top.c : null);
    ['L', 'R'].forEach((side) => {
      const A = gg.A[side];
      let a = strokeLimb(`M ${pt(A.S)} L ${pt(A.E)} L ${pt(A.W)}`, SK, 9.6);
      if (slFab) a += sleeve(A, slType, slFab);
      else if (!top && !dress) a += '';
      if (jacket && jacket.item.jsl && jacket.item.jsl !== 'none') a += jacketSleeve(A, jacket.item.jsl, jacket.c);
      if (side === 'R' && held && !held.item.body) a += G(held.res.main, `transform="translate(${A.W[0].toFixed(1)} ${A.W[1].toFixed(1)}) scale(${held.item.sc || 1.3})"`);
      a += C(A.W[0].toFixed(1), A.W[1].toFixed(1), 5.8, SK.f, SK.o);
      s += a;
    });
    s += part('bag', 'main');
    // head
    s += C(61.5, 82, 7, SK.f, SK.o) + C(138.5, 82, 7, SK.f, SK.o) + L('M 59 79 Q 62 83 60 86', SK.o, 1, 'opacity=".6"') + L('M 141 79 Q 138 83 140 86', SK.o, 1, 'opacity=".6"');
    s += P('M 100 32 C 126 32 140 50 140 74 C 140 98 122 113 100 113 C 78 113 60 98 60 74 C 60 50 74 32 100 32 Z', SK);
    s += face(o, skin, shade(hc, luma(hc) > 0.7 ? -0.45 : -0.2));
    s += hair.front(H);
    s += part('glasses', 'main');
    s += part('hat', 'main');
    const view = opt.view ? (VIEWS[opt.view] || opt.view) : VIEWS.full;
    return `<svg class="${opt.cls || 'ss-doll'}" viewBox="${view}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMid meet"><defs>${defs.join('')}</defs>${s}</svg>`;
  }
  function jacketSleeve(A, type, c) {
    if (type === 'three') return strokeLimb(armPart(A, 0.66), c, 14.5);
    const w = type === 'puffy' ? 17.5 : 15.2;
    const end = armEnd(A, 0.86);
    return strokeLimb(armPart(A, 0.86), c, w) + (type === 'puffy' ? L(`M ${pt(armEnd(A, 0.3))} L ${pt(armEnd(A, 0.31))}`, c.o, w + 2, 'opacity=".25"') : '') + C(end[0].toFixed(1), end[1].toFixed(1), w * 0.42, c.d, c.o);
  }

  // ===================================================================================================
  // Themes, judging and computer models
  // ===================================================================================================
  // tags: the item tags that fit; colors: colour keys that fit (empty = any); bg: the matching stage.
  const THEMES = [
    { id: 'beach', name: 'Beach Day', tags: ['beach', 'summer', 'tropical', 'ocean'], colors: ['ye', 'sk', 'co', 'tl', 'wh', 'or'], bg: 'beach', hint: 'Sun hats, sandals and bright summer colours' },
    { id: 'ball', name: 'Royal Ball', tags: ['royal', 'formal', 'glam', 'wedding'], colors: ['gd', 'pu', 'nv', 'pk', 'wh', 'lv'], bg: 'castle', hint: 'Gowns, crowns and something that sparkles' },
    { id: 'space', name: 'Space Explorer', tags: ['space', 'adventure', 'night'], colors: ['sv', 'nv', 'pu', 'wh', 'bl'], bg: 'space', hint: 'Helmets, moon boots and starry patterns' },
    { id: 'rain', name: 'Rainy Day', tags: ['rain', 'autumn', 'cozy'], colors: ['ye', 'sk', 'nv', 'bl', 'gr'], bg: 'rain', hint: 'Raincoats, rain boots and an umbrella' },
    { id: 'rock', name: 'Rock Star', tags: ['rock', 'music', 'party'], colors: ['bk', 'rd', 'pu', 'sv', 'hp'], bg: 'stage', hint: 'Leather, chains, a guitar and cool shades' },
    { id: 'fairy', name: 'Fairy Tale', tags: ['fairy', 'magic', 'royal', 'garden'], colors: ['pk', 'lv', 'mt', 'gd', 'sk'], bg: 'forest', hint: 'Wings, wands and flower crowns' },
    { id: 'sport', name: 'Sports Champion', tags: ['sport', 'hero'], colors: ['rd', 'bl', 'wh', 'gd', 'gr'], bg: 'stadium', hint: 'Jerseys, sneakers, a medal and a trophy' },
    { id: 'winter', name: 'Winter Wonderland', tags: ['winter', 'ski', 'cozy'], colors: ['wh', 'sk', 'nv', 'sv', 'rd', 'lv'], bg: 'snow', hint: 'Puffer coats, scarves and bobble hats' },
    { id: 'hero', name: 'Superhero', tags: ['hero', 'costume'], colors: ['rd', 'bl', 'ye', 'nv', 'gd'], bg: 'city', hint: 'Capes, masks and a hero emblem' },
    { id: 'pirate', name: 'Pirate Adventure', tags: ['pirate', 'adventure', 'ocean'], colors: ['br', 'rd', 'bk', 'gd', 'cr', 'wh'], bg: 'ocean', hint: 'Pirate hats, stripes and a treasure map' },
    { id: 'garden', name: 'Garden Party', tags: ['garden', 'spring', 'formal'], colors: ['pk', 'mt', 'ye', 'lv', 'wh', 'gr'], bg: 'garden', hint: 'Flowers, pastels and a pretty bouquet' },
    { id: 'sea', name: 'Under the Sea', tags: ['ocean', 'beach', 'fairy'], colors: ['tl', 'sk', 'bl', 'mt', 'lv'], bg: 'ocean', hint: 'Mermaid gowns, shimmer and sea colours' },
    { id: 'birthday', name: 'Birthday Party', tags: ['party', 'birthday', 'candy', 'cute'], colors: ['pk', 'ye', 'sk', 'hp', 'lv'], bg: 'studio', hint: 'Party hats, balloons and polka dots' },
    { id: 'sleepover', name: 'Pyjama Party', tags: ['pajama', 'cozy', 'cute'], colors: ['lv', 'pk', 'sk', 'mt', 'cr'], bg: 'night', hint: 'Onesies, bunny slippers and a teddy' },
    { id: 'west', name: 'Wild West', tags: ['western', 'farm', 'adventure'], colors: ['br', 'tn', 'rd', 'dn', 'cr'], bg: 'desert', hint: 'Cowboy hats, boots, plaid and denim' },
    { id: 'safari', name: 'Safari Explorer', tags: ['safari', 'adventure', 'camping'], colors: ['tn', 'gr', 'br', 'cr', 'or'], bg: 'forest', hint: 'Explorer hats, cargo shorts and binoculars' },
    { id: 'magic', name: 'Magic School', tags: ['magic', 'night', 'school'], colors: ['pu', 'nv', 'gd', 'bk', 'rd'], bg: 'castle', hint: 'Wizard hats, cloaks, wands and books' },
    { id: 'disco', name: 'Disco Night', tags: ['disco', 'party', 'glam', 'music', 'dance'], colors: ['gd', 'sv', 'pk', 'pu', 'hp'], bg: 'stage', hint: 'Sparkle, flares and roller skates' },
    { id: 'redcarpet', name: 'Red Carpet', tags: ['glam', 'formal', 'movie'], colors: ['rd', 'gd', 'bk', 'sv', 'wh'], bg: 'runway', hint: 'Gowns, tuxedos and star sunglasses' },
    { id: 'camping', name: 'Camping Trip', tags: ['camping', 'adventure', 'casual'], colors: ['gr', 'br', 'or', 'tn', 'rd'], bg: 'forest', hint: 'Backpacks, boots and a lantern' },
    { id: 'school', name: 'Back to School', tags: ['school', 'casual'], colors: ['nv', 'rd', 'wh', 'dn', 'gy'], bg: 'city', hint: 'Backpacks, cardigans and a story book' },
    { id: 'candy', name: 'Candy Land', tags: ['candy', 'cute', 'party'], colors: ['pk', 'mt', 'ye', 'hp', 'lv', 'sk'], bg: 'candy', hint: 'Sweet pastels, lollipops and ice cream' },
    { id: 'rainbow', name: 'Rainbow Bright', tags: ['party', 'cute'], colors: [], rainbow: true, bg: 'studio', hint: 'Wear as many colours as you can!' },
    { id: 'autumn', name: 'Autumn Leaves', tags: ['autumn', 'cozy'], colors: ['or', 'br', 'rd', 'ye', 'tn'], bg: 'forest', hint: 'Jumpers, plaid, boots and warm colours' },
    { id: 'spooky', name: 'Costume Party', tags: ['spooky', 'costume'], colors: ['pu', 'or', 'bk', 'gr'], bg: 'night', hint: 'Witch hats, bat wings or a pumpkin' },
    { id: 'ballet', name: 'Ballet Recital', tags: ['ballet', 'dance', 'fairy'], colors: ['pk', 'wh', 'lv', 'sv'], bg: 'stage', hint: 'Tutus, ballet slippers and a tiara' },
    { id: 'chef', name: 'Top Chef', tags: ['chef', 'cute'], colors: ['wh', 'rd', 'bk', 'cr'], bg: 'studio', hint: 'Chef hat, chef coat and a whisk' },
    { id: 'art', name: 'Art Studio', tags: ['art', 'school'], colors: [], rainbow: true, bg: 'studio', hint: 'A beret, dungarees and a paint palette' },
    { id: 'popstar', name: 'Pop Star Concert', tags: ['music', 'party', 'glam', 'dance'], colors: ['pk', 'pu', 'sv', 'hp', 'lv'], bg: 'stage', hint: 'Sparkles, headphones and a microphone' },
    { id: 'ski', name: 'Ski Trip', tags: ['ski', 'winter', 'sport'], colors: ['rd', 'bl', 'wh', 'ye', 'nv'], bg: 'snow', hint: 'Goggles, snow pants and a puffer' },
    { id: 'tropical', name: 'Tropical Holiday', tags: ['tropical', 'beach', 'summer', 'garden'], colors: ['co', 'tl', 'ye', 'gr', 'hp'], bg: 'beach', hint: 'Flower leis, florals and a surfboard' },
    { id: 'wedding', name: 'Wedding Guest', tags: ['wedding', 'formal', 'garden'], colors: ['lv', 'pk', 'wh', 'sk', 'nv'], bg: 'garden', hint: 'Smart suits, pretty dresses and pearls' },
    { id: 'detective', name: 'Detective Mystery', tags: ['detective', 'science'], colors: ['tn', 'br', 'gy', 'nv', 'bk'], bg: 'city', hint: 'Trench coat, fedora and a magnifying glass' },
    { id: 'farm', name: 'Farm Day', tags: ['farm', 'western', 'casual'], colors: ['dn', 'rd', 'ye', 'gr', 'tn'], bg: 'garden', hint: 'Dungarees, plaid and rain boots' },
    { id: 'medieval', name: 'Knights and Castles', tags: ['medieval', 'royal', 'fairy'], colors: ['pu', 'rd', 'gd', 'sv', 'br'], bg: 'castle', hint: 'Tunics, robes, crowns and dragon wings' },
    { id: 'pink', name: 'Pretty in Pink', tags: ['cute', 'candy', 'pink'], colors: ['pk', 'hp', 'lv', 'wh'], bg: 'candy', hint: 'Pink, pink and more pink!' },
    { id: 'mono', name: 'Black and White', tags: ['mono', 'formal', 'rock'], colors: ['bk', 'wh', 'gy', 'sv'], mono: true, bg: 'city', hint: 'Only black, white and grey' },
    { id: 'night', name: 'Starry Night', tags: ['night', 'magic', 'space'], colors: ['nv', 'pu', 'gd', 'sv', 'bk'], bg: 'night', hint: 'Stars, moons and midnight blue' },
    { id: 'science', name: 'Science Fair', tags: ['science', 'school', 'detective'], colors: ['wh', 'bl', 'mt', 'gy'], bg: 'studio', hint: 'Lab coat, goggles and specs' },
    { id: 'spring', name: 'Spring Picnic', tags: ['spring', 'garden', 'cute'], colors: ['mt', 'ye', 'pk', 'sk', 'lv'], bg: 'garden', hint: 'Florals, bunny ears and sunshine colours' }
  ];
  const THEME_BY = {}; THEMES.forEach((t) => { THEME_BY[t.id] = t; });
  const OPPOSITE = { beach: ['winter', 'ski'], summer: ['winter', 'ski'], winter: ['beach', 'summer', 'tropical'], ski: ['beach', 'summer'], tropical: ['winter'], formal: ['pajama'], royal: ['pajama'], pajama: ['formal', 'royal'] };

  function wornList(o) {
    const out = [];
    Object.keys(o.it || {}).forEach((slot) => { const v = o.it[slot]; const item = getItem(slot, v[0]); if (item) out.push({ slot, item, col: v[1] || item.col, pat: v[2] || 'so' }); });
    return out;
  }
  // 0..1: how well a look fits a theme (tags, colours, harmony, completeness).
  function lookScore(o, theme) {
    const worn = wornList(o);
    const has = (s) => worn.some((w) => w.slot === s);
    const tags = theme ? theme.tags : [];
    let fit = 0, clash = 0;
    worn.forEach((w) => {
      const main = ['top', 'dress', 'bottom', 'jacket'].includes(w.slot);
      if (w.item.tags.some((t) => tags.includes(t))) fit += main ? 1.25 : 1;
      if ((PAT_TAGS[w.pat] || []).some((t) => tags.includes(t))) fit += 0.3;
      if (tags.some((t) => (OPPOSITE[t] || []).some((x) => w.item.tags.includes(x)))) clash++;
    });
    if (theme && o.bg === theme.bg) fit += 0.4;
    if (theme && (HAIR_BY[o.hs].tags || []).some((t) => tags.includes(t))) fit += 0.25;
    const fitScore = Math.min(1, fit / 4.2) - clash * 0.12;
    const cols = worn.filter((w) => w.slot !== 'held' || !w.item.body).map((w) => w.col);
    let colScore = 0.6;
    if (theme && theme.colors.length && cols.length) colScore = cols.filter((c) => theme.colors.includes(c)).length / cols.length;
    if (theme && theme.mono) colScore = cols.length ? cols.filter((c) => ['bk', 'wh', 'gy', 'sv', 'cr'].includes(c)).length / cols.length : 0;
    const fams = new Set(cols.map((c) => (COL[c] ? COL[c].fam : 'n')).filter((f) => f !== 'n'));
    let harmony = fams.size <= 2 ? 1 : fams.size === 3 ? 0.85 : fams.size === 4 ? 0.6 : 0.35;
    if (theme && theme.rainbow) { harmony = Math.min(1, fams.size / 5); colScore = Math.min(1, fams.size / 4); }
    const acc = worn.filter((w) => ACCESSORY_SLOTS.includes(w.slot)).length;
    let complete = (has('dress') || (has('top') && has('bottom'))) ? 0.55 : (has('top') || has('bottom') ? 0.25 : 0);
    if (has('shoes')) complete += 0.2;
    complete += Math.min(acc, 3) * 0.08;
    if (acc > 5) complete -= 0.1;
    if (!theme) return clamp(0.3 * harmony + 0.7 * complete, 0, 1);
    return clamp(0.45 * fitScore + 0.2 * colScore + 0.15 * harmony + 0.2 * Math.min(1, complete), 0, 1);
  }
  const judgeStars = (o, theme, rand) => clamp(Math.round(1 + 4 * lookScore(o, theme) + (rand() - 0.5) * 1.3), 1, 5);

  const pickR = (arr, rand) => arr[Math.floor(rand() * arr.length)];
  function shuffle(arr, rand) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  const NATURAL_HAIR = HAIR_COLORS.slice(0, 8);
  const SHORT_HAIR = ['short', 'spiky', 'swoop', 'curtain', 'buzz', 'curly', 'afro', 'pixie'];
  // A look for a computer model (or "Randomise"). skill 0..1: how hard it tries to fit the theme.
  function makeLook(theme, skill, rand, persona, keep) {
    const tags = theme ? theme.tags : [];
    const fits = (it) => it.tags.some((t) => tags.includes(t));
    const palette = theme && theme.colors.length ? theme.colors : shuffle(COLORS.map((c) => c[0]), rand).slice(0, 3);
    const choose = (slot, filter) => {
      let list = SLOT[slot].items.filter(filter || (() => true));
      const good = list.filter(fits);
      if (good.length && rand() < skill) list = good;
      return pickR(list, rand);
    };
    const wantFit = (slot) => SLOT[slot].items.some(fits) && rand() < skill * 0.8;
    const o = keep ? clone(keep) : {
      sk: Math.floor(rand() * SKINS.length), ey: pickR(EYES, rand)[0], ec: Math.floor(rand() * EYE_COLORS.length), br: pickR(BROWS.slice(0, 5), rand)[0],
      mo: pickR(MOUTHS, rand)[0], bl: pickR(BLUSH, rand)[0],
      hs: persona === 'pants' ? pickR(SHORT_HAIR, rand) : pickR(HAIR, rand).id, hc: rand() < 0.75 ? pickR(NATURAL_HAIR, rand) : pickR(HAIR_COLORS, rand)
    };
    o.po = pickR(POSES, rand)[0];
    o.bg = theme && rand() < skill ? theme.bg : pickR(BGS, rand)[0];
    o.it = {};
    const put = (slot, item) => {
      if (!item) return;
      let col = rand() < skill * 0.9 || !theme ? pickR(palette, rand) : (rand() < 0.5 ? item.col : pickR(COLORS, rand)[0]);
      if (rand() < 0.35 && ['gd', 'sv', 'wh', 'bk'].includes(item.col)) col = item.col;
      let pat = item.pat || 'so';
      const fitPats = Object.keys(PAT_TAGS).filter((p) => PAT_TAGS[p].some((t) => tags.includes(t)));
      if (rand() < 0.3) pat = fitPats.length && rand() < skill ? pickR(fitPats, rand) : pickR(PATTERNS, rand)[0];
      o.it[slot] = [item.id, col, pat];
    };
    const dressy = persona === 'dress' ? 0.75 : persona === 'pants' ? 0.12 : 0.4;
    if (rand() < dressy) {
      const d = choose('dress');
      put('dress', d);
      if (d.over) put('top', choose('top'));
    } else {
      put('top', choose('top'));
      put('bottom', choose('bottom', persona === 'pants' ? (b) => b.pants : null));
    }
    if (wantFit('jacket') || rand() < 0.15) put('jacket', choose('jacket'));
    if (rand() < 0.92) put('shoes', choose('shoes'));
    ACCESSORY_SLOTS.forEach((slot) => { if (wantFit(slot) || rand() < 0.12) put(slot, choose(slot)); });
    return normalize(o);
  }

  const AI_NAMES = [['Ruby', 'dress'], ['Leo', 'pants'], ['Maya', 'any'], ['Kai', 'pants'], ['Zoe', 'dress'], ['Finn', 'pants'], ['Luna', 'dress'], ['Max', 'pants'], ['Ava', 'any'], ['Sam', 'any'], ['Mia', 'dress'], ['Noah', 'pants'], ['Ella', 'any'], ['Theo', 'pants']];

  // ===================================================================================================
  // Game
  // ===================================================================================================
  const DRESS_S = 90, EXTEND_S = 30, MAX_EXTENDS = 2, WALK_MS = 4600, INTRO_MS = 2600, VOTE_S = 30, TALLY_MS = 3500, PODIUM_MS = 7000;
  const KEY_ME = 'chow_style_me', KEY_WARD = 'chow_style_wardrobe', KEY_RECENT = 'chow_style_recent';
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  const I = (n, s) => CG.icon(n, s);
  const now = () => Date.now();
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmtTime = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const starsRow = (n, size) => [1, 2, 3, 4, 5].map((k) => `<span class="ss-st${k <= n ? ' on' : ''}">${I('star', size || 14)}</span>`).join('');

  let root, main;
  let mode = 'menu';          // menu | solo | free | multi
  let screen = '';            // menu | dress | runway | vote | results | gallery
  let look = normalize(store.get(KEY_ME, DEFAULT_LOOK));
  let history = [];
  let tab = 'top';
  let R = null;               // the current round
  let loopTimer = null;
  const thumbCache = new Map();

  function freshLook() {
    const o = clone(look);
    o.it = {};
    o.po = 'classic';
    return o;
  }
  function saveMe() { store.set(KEY_ME, look); }

  // ---------------------------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------------------------
  function setScreen(name, html) {
    screen = name;
    main.className = 'ss-main ss-' + name;
    main.innerHTML = html;
  }

  function showMenu() {
    mode = 'menu';
    R = null;
    const n = store.get(KEY_WARD, []).length;
    setScreen('menu', `<div class="ss-menu">
      <div class="ss-menu-doll">${render(look, { bg: true, cls: 'ss-doll' })}</div>
      <div class="ss-menu-card">
        <div class="ss-menu-badge">${CG.badge('style', 58)}</div>
        <h2>Style Star</h2>
        <p class="ss-sub">A theme is announced. Dress up, walk the runway and collect the most stars!</p>
        <button type="button" class="ss-btn primary big" data-a="solo">${I('play', 20)}<span>Theme challenge</span></button>
        <button type="button" class="ss-btn big" data-a="free">${I('palette', 20)}<span>Free style</span></button>
        <button type="button" class="ss-btn big" data-a="gallery">${I('layers', 20)}<span>My wardrobe</span>${n ? `<em>${n}</em>` : ''}</button>
        <p class="ss-hint">${I('users', 16)}<span>Tap <b>Play together</b> to dress up against the family.</span></p>
      </div>
    </div>`);
  }

  // ---------------------------------------------------------------------------------------------
  // Dressing room
  // ---------------------------------------------------------------------------------------------
  const TABS = [{ k: 'body', name: 'Skin', icon: 'user' }, { k: 'face', name: 'Face', icon: 'eye' }, { k: 'hair', name: 'Hair', icon: 'scissors' }]
    .concat(SLOTS.map((s) => ({ k: s.k, name: s.name, icon: s.icon })))
    .concat([{ k: 'pose', name: 'Pose', icon: 'footprints' }, { k: 'stage', name: 'Stage', icon: 'image' }]);
  const SLOT_VIEW = { top: 'top', dress: 'dress', bottom: 'bottom', jacket: 'top', shoes: 'shoes', hat: 'hat', glasses: 'glasses', neck: 'neck', bag: 'bag', back: 'back', held: 'held' };

  function showDress() {
    const free = mode === 'free';
    const solo = mode === 'solo';
    setScreen('dress', `<div class="ss-dress">
      <div class="ss-stage">
        <div class="ss-doll-wrap"></div>
        <div class="ss-hud">
          <div class="ss-theme">${free ? `<small>${I('palette', 13)} Free style</small><b>Dress up for fun</b>` : `<small>${I('sparkles', 13)} Theme</small><b>${esc(R.theme.name)}</b><span>${esc(R.theme.hint)}</span>`}</div>
          ${free ? '' : `<div class="ss-timer">${I('timer', 18)}<b>1:30</b></div>`}
        </div>
      </div>
      <div class="ss-ward">
        <div class="ss-tabs" role="tablist">${TABS.map((t) => `<button type="button" class="ss-tab" role="tab" data-tab="${t.k}" aria-label="${esc(t.name)}">${I(t.icon, 22)}<span>${esc(t.name)}</span></button>`).join('')}</div>
        <div class="ss-panel"></div>
        <div class="ss-swatches"></div>
        <div class="ss-actions">
          <button type="button" class="ss-btn icon" data-a="undo" aria-label="Undo">${I('undo', 20)}</button>
          <button type="button" class="ss-btn icon" data-a="random" aria-label="Surprise me">${I('shuffle', 20)}</button>
          ${solo ? `<button type="button" class="ss-btn" data-a="extend">${I('clock', 18)}<span>+30 s</span></button>` : ''}
          ${free ? `<button type="button" class="ss-btn icon" data-a="menu" aria-label="Back to the menu">${I('home', 20)}</button><button type="button" class="ss-btn" data-a="gallery">${I('layers', 18)}<span>Wardrobe</span></button><button type="button" class="ss-btn primary" data-a="save">${I('save', 18)}<span>Save look</span></button>`
        : `<button type="button" class="ss-btn primary" data-a="done">${I('check', 20)}<span>Done</span></button>`}
        </div>
      </div>
    </div>`);
    updateDoll();
    selectTab(tab);
    updateTimer();
  }

  function updateDoll(pop) {
    const w = main.querySelector('.ss-doll-wrap');
    if (!w) return;
    w.innerHTML = render(look, { bg: true, cls: 'ss-doll' });
    if (pop && !reduceMotion) { w.classList.remove('pop'); void w.offsetWidth; w.classList.add('pop'); }
  }

  function selectTab(k) {
    tab = TABS.some((t) => t.k === k) ? k : 'top';
    main.querySelectorAll('.ss-tab').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    const btn = main.querySelector(`.ss-tab[data-tab="${tab}"]`);
    if (btn && btn.scrollIntoView) { try { btn.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* old browsers */ } }
    renderPanel();
    const p = main.querySelector('.ss-panel');
    if (p) p.scrollTop = 0;
  }

  function thumb(o, view, key) {
    const k = key + '|' + view;
    if (thumbCache.has(k)) return thumbCache.get(k);
    const svg = render(o, { view, cls: 'ss-th' });
    if (thumbCache.size > 600) thumbCache.clear();
    thumbCache.set(k, svg);
    return svg;
  }
  const mannequin = (extra) => Object.assign({ sk: look.sk, ey: look.ey, ec: look.ec, br: look.br, mo: look.mo, bl: look.bl, hs: look.hs, hc: look.hc, po: 'classic', bg: look.bg, it: {} }, extra || {});
  const faceKey = () => [look.sk, look.ey, look.ec, look.br, look.mo, look.bl, look.hs, look.hc].join(',');
  const tile = (kind, v, on, svg, label, cls) => `<button type="button" class="ss-tile${on ? ' on' : ''}${cls ? ' ' + cls : ''}" data-k="${kind}" data-v="${esc(v)}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${esc(label)}">${svg}<span>${esc(label)}</span></button>`;
  const section = (title, inner, cls) => `<div class="ss-sec"><h4>${esc(title)}</h4><div class="${cls || 'ss-grid'}">${inner}</div></div>`;
  const swatch = (kind, v, hex, on, label) => `<button type="button" class="ss-sw${on ? ' on' : ''}" data-k="${kind}" data-v="${esc(v)}" style="--c:${hex}" aria-label="${esc(label)}" aria-pressed="${on ? 'true' : 'false'}"></button>`;

  function renderPanel() {
    const p = main.querySelector('.ss-panel');
    const sw = main.querySelector('.ss-swatches');
    if (!p) return;
    let html = '';
    sw.innerHTML = '';
    sw.hidden = true;
    if (tab === 'body') {
      html = section('Skin tone', SKINS.map((hex, i) => swatch('sk', i, hex, look.sk === i, 'Skin tone ' + (i + 1))).join(''), 'ss-swrow big');
    } else if (tab === 'face') {
      const part = (title, key, list, view) => section(title, list.map(([v, name]) => tile(key, v, look[key] === v, thumb(Object.assign(mannequin(), { [key]: v }), view, `face:${key}:${v}:${faceKey()}`), name)).join(''));
      html = part('Eyes', 'ey', EYES, 'face') + section('Eye colour', EYE_COLORS.map((hex, i) => swatch('ec', i, hex, look.ec === i, 'Eye colour ' + (i + 1))).join(''), 'ss-swrow') +
        part('Brows', 'br', BROWS, 'face') + part('Mouth', 'mo', MOUTHS, 'face') + part('Cheeks', 'bl', BLUSH, 'face');
    } else if (tab === 'hair') {
      html = section('Hair colour', HAIR_COLORS.map((hex) => swatch('hc', hex, hex, look.hc === hex, 'Hair colour')).join('') +
        `<label class="ss-sw ss-custom" style="--c:${look.hc}" aria-label="Any colour">${I('palette', 16)}<input type="color" value="${look.hc}" data-k="hcx" aria-label="Pick any hair colour"></label>`, 'ss-swrow') +
        section('Hairstyle', HAIR.map((h) => tile('hs', h.id, look.hs === h.id, thumb(Object.assign(mannequin(), { hs: h.id }), 'head', `hair:${h.id}:${faceKey()}`), h.name)).join(''));
    } else if (tab === 'pose') {
      html = section('Pose', POSES.map(([v, name]) => tile('po', v, look.po === v, thumb(Object.assign(mannequin(), { po: v, it: clone(look.it) }), 'full', `pose:${v}:${JSON.stringify(look)}`), name, 'tall')).join(''));
    } else if (tab === 'stage') {
      html = section('Stage', BGS.map(([v, name]) => tile('bg', v, look.bg === v, bgThumb(v), name, 'tall')).join(''));
    } else {
      const s = SLOT[tab];
      const cur = look.it[tab];
      const none = `<button type="button" class="ss-tile none${cur ? '' : ' on'}" data-k="item" data-v="" aria-pressed="${cur ? 'false' : 'true'}" aria-label="None">${I('close', 26)}<span>None</span></button>`;
      html = section(s.name, none + s.items.map((item) => {
        const m = mannequin({ it: { [tab]: [item.id, item.col, item.pat || 'so'] } });
        if (tab === 'held' || tab === 'back') m.po = 'classic';
        return tile('item', item.id, cur && cur[0] === item.id, thumb(m, SLOT_VIEW[tab], `item:${tab}:${item.id}:${['hat', 'glasses'].includes(tab) ? faceKey() : look.sk}`), item.name);
      }).join(''), 'ss-grid items');
      sw.hidden = false;
      if (cur) {
        sw.innerHTML = `<div class="ss-swrow">${COLORS.map(([k, name, hex]) => swatch('col', k, hex, cur[1] === k, name)).join('')}</div>` +
          `<div class="ss-swrow pats">${PATTERNS.map(([k, name]) => `<button type="button" class="ss-pat${cur[2] === k ? ' on' : ''}" data-k="pat" data-v="${k}" aria-label="${esc(name)}" aria-pressed="${cur[2] === k ? 'true' : 'false'}">${patSwatch(cur[1], k)}<span>${esc(name)}</span></button>`).join('')}</div>`;
      } else sw.innerHTML = `<p class="ss-hint">${I('palette', 16)}<span>Pick something to change its colour and pattern.</span></p>`;
    }
    p.innerHTML = html;
  }
  function patSwatch(col, pat) {
    const defs = [];
    const c = fabric(defs, 'ps' + (++UID), col, pat);
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><defs>${defs.join('')}</defs><rect x="1" y="1" width="22" height="22" rx="7" fill="${c.f}" stroke="${c.o}" stroke-width="1.2"/></svg>`;
  }
  function bgThumb(key) {
    const k = 'bg:' + key;
    if (thumbCache.has(k)) return thumbCache.get(k);
    const defs = [];
    const id = 'bt' + (++UID);
    const inner = background(key, id, defs);
    const svg = `<svg class="ss-th" viewBox="-20 -14 240 354" aria-hidden="true" preserveAspectRatio="xMidYMid slice"><defs>${defs.join('')}</defs>${inner}</svg>`;
    thumbCache.set(k, svg);
    return svg;
  }

  function change(fn, sound) {
    if (!canEdit()) return;
    history.push(clone(look));
    if (history.length > 60) history.shift();
    fn(look);
    look = normalize(look);
    afterChange(sound);
  }
  function afterChange(sound) {
    updateDoll(true);
    renderPanel();
    CG.sfx(sound || 'flip');
    if (mode === 'free' || mode === 'menu') saveMe();
    broadcast();
  }
  function canEdit() {
    if (screen !== 'dress') return false;
    if (mode === 'multi' && (R.phase !== 'dress' || R.ready)) return false;
    if (mode === 'solo' && R && R.paused != null) return false;
    return true;
  }
  function wear(slot, id) {
    change((l) => {
      if (!id) { delete l.it[slot]; return; }
      const item = getItem(slot, id);
      l.it[slot] = [id, item.col, item.pat || 'so'];
      if (slot === 'dress' && !item.over) { delete l.it.top; delete l.it.bottom; }
      if (slot === 'dress' && item.over) delete l.it.bottom;
      if ((slot === 'top' || slot === 'bottom') && l.it.dress) {
        const d = getItem('dress', l.it.dress[0]);
        if (!d.over || slot === 'bottom') delete l.it.dress;
      }
    });
  }

  function randomise() {
    change((l) => {
      const r = Math.random;
      const t = R && R.theme && mode !== 'free' ? R.theme : null;
      const n = makeLook(t, t ? 0.45 : 0, r, pickR(['dress', 'pants', 'any'], r), l);
      Object.assign(l, { it: n.it, po: n.po, bg: t ? l.bg : n.bg });
    }, 'whoosh');
  }
  function undo() {
    if (!canEdit() || !history.length) return;
    look = history.pop();
    afterChange('click');
  }

  function updateTimer() {
    const el = main.querySelector('.ss-timer b');
    if (!el || !R) return;
    let left = 0;
    if (mode === 'solo') left = R.paused != null ? R.paused : R.dressEnd - now();
    if (mode === 'multi') left = R.T0 + DRESS_S * 1000 - now();
    el.textContent = fmtTime(left);
    const box = el.parentElement;
    const low = left <= 10500;
    box.classList.toggle('low', low);
    const sec = Math.ceil(left / 1000);
    if (low && sec > 0 && sec !== R.lastTick) { R.lastTick = sec; CG.sfx('tick'); }
    const ex = main.querySelector('[data-a="extend"]');
    if (ex) ex.disabled = R.extends >= MAX_EXTENDS;
  }

  function splash(title, big, sub, ms) {
    const el = document.createElement('div');
    el.className = 'ss-splash';
    el.innerHTML = `<div class="ss-splash-card"><small>${title}</small><b>${esc(big)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
    root.appendChild(el);
    setTimeout(() => el.classList.add('out'), (ms || 2300) - 300);
    setTimeout(() => el.remove(), ms || 2300);
  }

  // ---------------------------------------------------------------------------------------------
  // Solo round
  // ---------------------------------------------------------------------------------------------
  function pickTheme(rand) {
    const recent = store.get(KEY_RECENT, []);
    const pool = THEMES.filter((t) => !recent.includes(t.id));
    const t = pickR(pool.length ? pool : THEMES, rand);
    store.set(KEY_RECENT, [t.id].concat(recent).slice(0, 12));
    return t;
  }
  function startSolo() {
    CG.closeModal();
    mode = 'solo';
    const rand = Math.random;
    const theme = pickTheme(rand);
    const names = shuffle(AI_NAMES.slice(), rand).slice(0, 3);
    const skills = shuffle([0.92, 0.68, 0.42], rand);
    look = freshLook();
    history = [];
    R = { theme, extends: 0, paused: null, dressEnd: now() + DRESS_S * 1000 + 2400, myVotes: {},
      models: [{ name: CG.me() || 'You', me: true, look: null }].concat(names.map(([n, persona], i) => ({ name: n, ai: true, skill: skills[i], look: makeLook(theme, skills[i], rand, persona) }))) };
    tab = 'top';
    showDress();
    splash('Today’s theme', theme.name, theme.hint);
    CG.sfx('go');
  }
  function finishDressing() {
    if (mode === 'solo') {
      R.models[0].look = clone(look);
      saveMe();
      CG.sfx('match');
      soloRunway();
    } else if (mode === 'multi') {
      R.ready = true;
      broadcast();
      CG.sfx('match');
      showReady();
    }
  }
  function showReady() {
    let ov = main.querySelector('.ss-ready');
    if (!R.ready) { if (ov) ov.remove(); return; }
    if (ov) return;
    ov = document.createElement('div');
    ov.className = 'ss-ready';
    ov.innerHTML = `<div class="ss-ready-card"><div class="ss-ready-ic">${I('check', 28)}</div><b>Looking fabulous!</b><span>The runway starts when the timer runs out.</span><button type="button" class="ss-btn" data-a="unready">${I('scissors', 18)}<span>Keep styling</span></button></div>`;
    main.querySelector('.ss-dress').appendChild(ov);
  }

  // Runway --------------------------------------------------------------------------------------
  function runwayHtml() {
    return `<div class="ss-rw">
      <div class="ss-rw-back"></div>
      <div class="ss-rw-scene"><div class="ss-rw-bg"></div><div class="ss-rw-lights"></div><div class="ss-rw-model"><div class="ss-rw-doll"></div></div></div>
      <div class="ss-rw-top"><span class="ss-chip">${I('sparkles', 15)}<span>${esc(R.theme.name)}</span></span><span class="ss-chip ss-rw-count"></span></div>
      <div class="ss-rw-flash"></div>
      <div class="ss-rw-name"><b></b><small></small></div>
      ${mode === 'solo' ? `<button type="button" class="ss-btn ss-rw-skip" data-a="skip">${I('chevronRight', 18)}<span>Next</span></button>` : ''}
    </div>`;
  }
  function runwayBackdrop() {
    const b1 = main.querySelector('.ss-rw-bg'), b2 = main.querySelector('.ss-rw-back');
    if (b1) b1.innerHTML = bgThumb(R.theme.bg);
    if (b2) b2.innerHTML = bgThumb(R.theme.bg);
  }
  function walk(m, i, n) {
    const bg = main.querySelector('.ss-rw-bg');
    if (!bg) return;
    const lk = m.look || normalize(DEFAULT_LOOK);
    bg.innerHTML = bgThumb(lk.bg);
    main.querySelector('.ss-rw-back').innerHTML = bgThumb(lk.bg);
    main.querySelector('.ss-rw-doll').innerHTML = render(lk, { cls: 'ss-doll' });
    main.querySelector('.ss-rw-count').textContent = `Model ${i + 1} of ${n}`;
    const nm = main.querySelector('.ss-rw-name');
    nm.querySelector('b').textContent = m.me ? `${m.name} (you)` : m.name;
    nm.querySelector('small').textContent = m.look ? R.theme.name : 'No look this time';
    const model = main.querySelector('.ss-rw-model');
    CG.sfx('whoosh');
    if (!reduceMotion && model.animate) {
      const frames = [];
      const steps = 10;
      for (let k = 0; k <= steps; k++) {
        const p = k / steps;
        const y = -26 * (1 - p) - (k % 2 ? 2.2 : 0);
        frames.push({ offset: 0.5 * p, opacity: Math.min(1, p * 4), transform: `translateY(${y.toFixed(1)}%) scale(${(0.48 + 0.52 * p).toFixed(3)}) rotate(${k % 2 ? 1.6 : -1.6}deg)` });
      }
      frames.push({ offset: 0.62, opacity: 1, transform: 'translateY(0%) scale(1.04) rotate(0deg)' });
      frames.push({ offset: 0.84, opacity: 1, transform: 'translateY(0%) scale(1) rotate(0deg)' });
      frames.push({ offset: 1, opacity: 0, transform: 'translateX(70%) translateY(0%) scale(.92) rotate(4deg)' });
      model.animate(frames, { duration: WALK_MS - 100, easing: 'linear', fill: 'both' });
      nm.animate([{ opacity: 0, transform: 'translateY(20px)' }, { opacity: 1, transform: 'none', offset: 0.15 }, { opacity: 1, transform: 'none', offset: 0.85 }, { opacity: 0, transform: 'translateY(10px)' }], { duration: WALK_MS - 100, fill: 'both' });
    }
    clearTimeout(R.flashT);
    R.flashT = setTimeout(() => {
      const f = main.querySelector('.ss-rw-flash');
      if (!f) return;
      CG.sfx('coin');
      f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
      sparkles(main.querySelector('.ss-rw-model'));
    }, WALK_MS * 0.52);
  }
  function sparkles(el) {
    if (!el || reduceMotion) return;
    for (let k = 0; k < 10; k++) {
      const s = document.createElement('i');
      s.className = 'ss-spark';
      s.innerHTML = `<svg viewBox="-10 -10 20 20"><path d="${glint(0, 0, 9)}" fill="${['#fde68a', '#ffffff', '#f9a8d4', '#a5f3fc'][k % 4]}"/></svg>`;
      s.style.left = (10 + Math.random() * 80) + '%';
      s.style.top = (8 + Math.random() * 70) + '%';
      s.style.animationDelay = (Math.random() * 0.4).toFixed(2) + 's';
      el.appendChild(s);
      setTimeout(() => s.remove(), 1500);
    }
  }
  function soloRunway() {
    R.order = shuffle(R.models.slice(), Math.random);
    R.runIdx = -1;
    setScreen('runway', runwayHtml());
    runwayBackdrop();
    splash('Lights, camera…', 'Runway time!', R.theme.name, 1900);
    clearTimeout(R.walkT);
    R.walkT = setTimeout(nextWalk, 1700);
  }
  function nextWalk() {
    if (mode !== 'solo' || screen !== 'runway') return;
    clearTimeout(R.walkT);
    R.runIdx++;
    if (R.runIdx >= R.order.length) { soloVote(); return; }
    walk(R.order[R.runIdx], R.runIdx, R.order.length);
    R.walkT = setTimeout(nextWalk, WALK_MS);
  }

  // Voting --------------------------------------------------------------------------------------
  function voteTargets() { return R.voteList || []; }
  function soloVote() {
    R.voteList = R.order.filter((m) => !m.me);
    R.voteIdx = 0;
    // the computer models judge everyone (fairly, from the look) right away
    const rand = Math.random;
    R.votes = {};
    R.models.filter((m) => m.ai).forEach((v) => {
      R.votes[v.name] = {};
      R.models.forEach((t) => { if (t !== v) R.votes[v.name][t.name] = judgeStars(t.look, R.theme, rand); });
    });
    showVote();
  }
  function showVote() {
    setScreen('vote', `<div class="ss-vote">
      <div class="ss-vote-head"><b>Rate the looks</b><span class="ss-sub">${esc(R.theme.name)}</span></div>
      <div class="ss-vote-card"></div>
      <div class="ss-vote-nav"></div>
    </div>`);
    renderVote();
  }
  function renderVote() {
    const list = voteTargets();
    const card = main.querySelector('.ss-vote-card');
    if (!card) return;
    if (!list.length) {
      card.innerHTML = `<div class="ss-vote-empty">${I('users', 30)}<b>Nobody else to rate this time</b><span>Waiting for the results…</span></div>`;
      main.querySelector('.ss-vote-nav').innerHTML = '';
      return;
    }
    R.voteIdx = clamp(R.voteIdx || 0, 0, list.length - 1);
    const m = list[R.voteIdx];
    const mine = R.myVotes[m.name] || 0;
    const allDone = list.every((t) => R.myVotes[t.name]);
    card.innerHTML = `<div class="ss-vote-doll">${render(m.look, { bg: true, cls: 'ss-doll' })}</div>
      <div class="ss-vote-who"><b>${esc(m.name)}</b><span>${I('star', 14)} How well does it fit “${esc(R.theme.name)}”?</span></div>
      <div class="ss-stars" role="group" aria-label="Stars for ${esc(m.name)}">${[1, 2, 3, 4, 5].map((k) => `<button type="button" class="ss-star${k <= mine ? ' on' : ''}" data-k="vote" data-v="${k}" aria-label="${k} star${k > 1 ? 's' : ''}">${I('star', 34)}</button>`).join('')}</div>`;
    main.querySelector('.ss-vote-nav').innerHTML = `<button type="button" class="ss-btn icon" data-a="vprev" aria-label="Previous look"${R.voteIdx ? '' : ' disabled'}>${I('arrowLeft', 20)}</button>
      <div class="ss-dots">${list.map((t, i) => `<i class="${R.myVotes[t.name] ? 'done' : ''}${i === R.voteIdx ? ' cur' : ''}"></i>`).join('')}${mode === 'multi' ? `<span class="ss-timer">${I('timer', 16)}<b></b></span>` : ''}</div>
      ${mode === 'solo' ? `<button type="button" class="ss-btn primary" data-a="results"${allDone ? '' : ' disabled'}>${I('trophy', 18)}<span>Results</span></button>` : (allDone ? `<span class="ss-wait">${I('check', 16)} All rated!</span>` : '')}
      <button type="button" class="ss-btn icon" data-a="vnext" aria-label="Next look"${R.voteIdx < list.length - 1 ? '' : ' disabled'}>${I('arrowRight', 20)}</button>`;
    updateVoteTimer();
  }
  function castVote(n) {
    if (screen !== 'vote') return;
    if (mode === 'multi' && R.phase !== 'vote') return;
    const list = voteTargets();
    const m = list[R.voteIdx];
    if (!m) return;
    R.myVotes[m.name] = n;
    CG.sfx(n >= 4 ? 'coin' : 'point');
    broadcast();
    renderVote();
    const stars = main.querySelectorAll('.ss-star');
    stars.forEach((s, i) => { if (i < n && !reduceMotion) { s.classList.remove('pop'); void s.offsetWidth; s.style.animationDelay = (i * 0.04) + 's'; s.classList.add('pop'); } });
    clearTimeout(R.advT);
    R.advT = setTimeout(() => {
      if (screen !== 'vote') return;
      const next = list.findIndex((t, i) => i > R.voteIdx && !R.myVotes[t.name]);
      const any = list.findIndex((t) => !R.myVotes[t.name]);
      if (next >= 0 || any >= 0) { R.voteIdx = next >= 0 ? next : any; renderVote(); }
      else if (mode === 'solo') setTimeout(() => { if (screen === 'vote' && mode === 'solo') soloResults(); }, 500);
    }, 420);
  }
  function updateVoteTimer() {
    const el = main.querySelector('.ss-vote-nav .ss-timer b');
    if (!el || mode !== 'multi') return;
    const left = R.voteEnd - now();
    el.textContent = fmtTime(left);
    el.parentElement.classList.toggle('low', left < 10500);
  }

  // Results -------------------------------------------------------------------------------------
  // models: [{ name, look }], votes: { voter: { target: stars } }. Self-votes and junk are ignored.
  function tally(models, votes) {
    const names = models.map((m) => m.name);
    const rows = models.map((m) => {
      const got = [];
      names.forEach((v) => {
        if (v === m.name) return;
        const s = votes[v] && votes[v][m.name];
        const n = Math.round(Number(s));
        if (n >= 1 && n <= 5) got.push(n);
      });
      const avg = got.length ? got.reduce((a, b) => a + b, 0) / got.length : 0;
      return { m, name: m.name, got, avg: Math.round(avg * 100) / 100 };
    });
    rows.sort((a, b) => b.avg - a.avg || b.got.length - a.got.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    let place = 0;
    rows.forEach((r, i) => { if (i === 0 || r.avg !== rows[i - 1].avg) place = i; r.place = place; });
    return rows;
  }
  const PLACE = ['1st place!', '2nd place!', '3rd place!', '4th place', '5th place', '6th place', '7th place', '8th place'];
  function soloResults() {
    R.votes[R.models[0].name] = Object.assign({}, R.myVotes);
    const rows = tally(R.models, R.votes);
    const me = rows.find((r) => r.m.me);
    R.myScore = Math.round(me.avg * 100);
    R.place = me.place;
    showResults(rows, me);
    clearTimeout(R.overT);
    R.overT = setTimeout(soloGameOver, PODIUM_MS + 2500);
  }
  function soloGameOver() {
    if (mode !== 'solo' || !R || R.overShown) return;
    R.overShown = true;
    clearTimeout(R.overT);
    CG.gameOver({ score: R.myScore, title: PLACE[R.place] || 'Well done!', again: startSolo });
  }
  function showResults(rows, me) {
    const top = rows.slice(0, 3);
    const order = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
    const winner = rows[0];
    const iWon = me && me.place === 0;
    const tie = rows.length > 1 && rows[1].place === 0;
    const headline = tie ? (iWon ? 'You tied for first!' : 'It’s a tie!') : iWon ? 'You won!' : `${esc(winner.name)} wins!`;
    const pod = (r) => `<div class="ss-pod p${r.place + 1}${r === me ? ' me' : ''}">
        <div class="ss-pod-doll">${render(r.m.look || normalize(DEFAULT_LOOK), { bg: true, cls: 'ss-doll' })}</div>
        <div class="ss-pod-name"><span class="cg-rank${r.place < 3 ? ` r${r.place + 1}` : ''}">${r.place + 1}</span><b>${esc(r.name)}</b></div>
        <div class="ss-pod-stars">${I('star', 16)}<b>${r.avg.toFixed(1)}</b></div>
        <div class="ss-pod-block"></div></div>`;
    const rest = rows.slice(3);
    setScreen('results', `<div class="ss-res">
      <canvas class="ss-confetti"></canvas>
      <div class="ss-res-head">${I(iWon ? 'crown' : 'trophy', 26)}<h2>${headline}</h2><p class="ss-sub">${esc(R.theme.name)}</p></div>
      <div class="ss-podium">${order.map(pod).join('')}</div>
      ${rest.length ? `<ol class="ss-rest">${rest.map((r) => `<li class="${r === me ? 'me' : ''}"><span class="cg-rank">${r.place + 1}</span><b>${esc(r.name)}</b><span class="ss-rs">${I('star', 14)} ${r.avg.toFixed(1)}</span></li>`).join('')}</ol>` : ''}
      ${me ? `<div class="ss-mine"><span>Your stars</span><span class="ss-mine-row">${me.got.length ? me.got.map((n) => `<em>${starsRow(n, 12)}</em>`).join('') : 'No votes this time'}</span><b>${me.avg.toFixed(1)} → ${Math.round(me.avg * 100)} points</b></div>` : ''}
      <div class="ss-res-actions">
        <button type="button" class="ss-btn" data-a="savelook">${I('save', 18)}<span>Save my look</span></button>
        ${mode === 'solo' ? `<button type="button" class="ss-btn primary" data-a="continue">${I('chevronRight', 18)}<span>Continue</span></button>` : `<span class="ss-wait">${I('clock', 16)} Final standings coming up…</span>`}
      </div>
    </div>`);
    CG.sfx(iWon ? 'win' : 'score');
    confetti(main.querySelector('.ss-confetti'), iWon ? 160 : 70);
  }

  function confetti(cv, n) {
    if (!cv || reduceMotion) return;
    const box = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = box.width * dpr; cv.height = box.height * dpr;
    const cx = cv.getContext('2d');
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cols = ['#f472b6', '#facc15', '#60a5fa', '#a78bfa', '#34d399', '#fb923c'];
    const ps = [];
    for (let i = 0; i < n; i++) ps.push({ x: box.width * (0.2 + Math.random() * 0.6), y: box.height * 0.35, vx: (Math.random() - 0.5) * 9, vy: -4 - Math.random() * 9, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, s: 4 + Math.random() * 5, c: cols[i % cols.length] });
    const t0 = performance.now();
    function frame(t) {
      if (!cv.isConnected) return;
      const age = t - t0;
      cx.clearRect(0, 0, box.width, box.height);
      ps.forEach((p) => {
        p.vy += 0.22; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.globalAlpha = Math.max(0, 1 - age / 4200);
        cx.fillStyle = p.c; cx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); cx.restore();
      });
      if (age < 4200) requestAnimationFrame(frame); else cx.clearRect(0, 0, box.width, box.height);
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------------------------------
  // Wardrobe (saved looks on this device)
  // ---------------------------------------------------------------------------------------------
  function saveLook(o) {
    const list = store.get(KEY_WARD, []);
    list.unshift({ look: o, at: now() });
    if (store.set(KEY_WARD, list.slice(0, 30))) { CG.toast('Saved to your wardrobe'); CG.sfx('match'); }
    else CG.toast('Couldn’t save on this device');
  }
  function showGallery() {
    if (mode !== 'multi') mode = 'menu';
    const list = store.get(KEY_WARD, []);
    setScreen('gallery', `<div class="ss-gal">
      <div class="ss-gal-head"><button type="button" class="ss-btn icon" data-a="menu" aria-label="Back to menu">${I('arrowLeft', 20)}</button><h2>My wardrobe</h2><span class="ss-sub">${list.length} saved look${list.length === 1 ? '' : 's'}</span></div>
      ${list.length ? `<div class="ss-gal-grid">${list.map((e, i) => `<div class="ss-gal-card"><div class="ss-gal-doll">${render(normalize(e.look), { bg: true, cls: 'ss-doll' })}</div><div class="ss-gal-row"><span>${new Date(e.at || 0).toLocaleDateString()}</span><button type="button" class="ss-btn icon sm" data-a="wear" data-i="${i}" aria-label="Wear this look">${I('shirt', 18)}</button><button type="button" class="ss-btn icon sm" data-a="del" data-i="${i}" aria-label="Delete this look">${I('trash', 18)}</button></div></div>`).join('')}</div>`
        : `<div class="ss-empty">${I('layers', 34)}<b>No saved looks yet</b><span>Dress up in Free style and press Save look.</span><button type="button" class="ss-btn primary" data-a="free">${I('palette', 18)}<span>Free style</span></button></div>`}
    </div>`);
  }
  function startFree(o) {
    CG.closeModal();
    mode = 'free';
    R = null;
    if (o) look = normalize(o);
    history = [];
    showDress();
  }

  // ---------------------------------------------------------------------------------------------
  // Multiplayer: every phase is timed from the round's start, so all devices stay in step.
  // ---------------------------------------------------------------------------------------------
  function broadcast() {
    if (mode !== 'multi' || !R || R.over) return;
    CG.race.update({ score: R.myScore || 0, alive: true, phase: R.ready && R.phase === 'dress' ? 'ready' : R.phase, outfit: look, votes: R.myVotes });
  }
  function startMulti(info) {
    CG.closeModal();
    mode = 'multi';
    const rand = CG.rng(info.seed);
    const theme = THEMES[Math.floor(rand() * THEMES.length)];
    const s = CG.session();
    const t0 = s && s.startAt ? Date.parse(s.startAt) : now();
    look = freshLook();
    history = [];
    R = { theme, multi: true, T0: isFinite(t0) ? t0 : now(), seed: info.seed, phase: 'dress', ready: false, myVotes: {}, cache: {}, roster: null, myScore: 0, over: false };
    tab = 'top';
    showDress();
    splash('Today’s theme', theme.name, theme.hint);
    broadcast();
  }
  function pullOthers() {
    CG.race.others().forEach((o) => {
      const st = o.state || {};
      if (st.outfit) R.cache[o.name] = { look: normalize(st.outfit), votes: st.votes && typeof st.votes === 'object' ? st.votes : {}, phase: st.phase };
    });
  }
  function multiModels() {
    return R.roster.map((name) => (name === CG.me() ? { name, me: true, look: clone(look) } : { name, look: R.cache[name] ? R.cache[name].look : null }));
  }
  function multiTick() {
    pullOthers();
    const t = now() - R.T0;
    const dressEnd = DRESS_S * 1000;
    if (!R.roster && t >= dressEnd) {
      const s = CG.session();
      R.roster = (s && s.players && s.players.length ? s.players : [CG.me()]).slice();
      R.n = R.roster.length;
      R.runStart = R.T0 + dressEnd + INTRO_MS;
      R.voteStart = R.runStart + R.n * WALK_MS;
      R.voteEnd = R.voteStart + VOTE_S * 1000;
      R.tallyAt = R.voteEnd + TALLY_MS;
    }
    let phase = 'dress';
    if (R.roster) phase = now() < R.voteStart ? 'runway' : now() < R.voteEnd ? 'vote' : now() < R.tallyAt ? 'tally' : 'results';
    if (phase !== R.phase) enterPhase(phase);
    if (phase === 'dress') updateTimer();
    if (phase === 'runway') {
      const idx = Math.floor((now() - R.runStart) / WALK_MS);
      if (idx >= 0 && idx < R.n && idx !== R.runIdx) {
        R.runIdx = idx;
        const models = multiModels();
        walk(models[idx], idx, R.n);
      }
    }
    if (phase === 'vote') {
      const before = (R.voteList || []).length;
      R.voteList = multiModels().filter((m) => !m.me && m.look);
      if (R.voteList.length !== before) renderVote(); else updateVoteTimer();
    }
    if (phase === 'results' && !R.over && now() >= R.tallyAt + PODIUM_MS) {
      R.over = true;
      CG.gameOver({ score: R.myScore });
    }
  }
  function enterPhase(phase) {
    R.phase = phase;
    if (phase === 'runway') {
      R.ready = false;
      saveMe();
      R.runIdx = -1;
      setScreen('runway', runwayHtml());
      runwayBackdrop();
      splash('Lights, camera…', 'Runway time!', R.theme.name, 1900);
      CG.sfx('go');
    } else if (phase === 'vote') {
      R.voteIdx = 0;
      R.voteList = multiModels().filter((m) => !m.me && m.look);
      showVote();
    } else if (phase === 'tally') {
      setScreen('results', `<div class="ss-tally"><div class="ss-tally-ic">${I('star', 40)}</div><b>Counting the stars…</b></div>`);
    } else if (phase === 'results') {
      multiResults();
    }
    broadcast();
  }
  function multiResults() {
    const models = multiModels().filter((m) => m.look);
    const votes = {};
    models.forEach((m) => { votes[m.name] = m.me ? R.myVotes : (R.cache[m.name] ? R.cache[m.name].votes : {}); });
    const rows = tally(models, votes);
    const me = rows.find((r) => r.m.me);
    R.myScore = me ? Math.round(me.avg * 100) : 0;
    R.rows = rows;
    showResults(rows, me);
    broadcast();
  }

  function loop() {
    if (!R) return;
    if (mode === 'solo' && screen === 'dress' && R.paused == null) {
      updateTimer();
      if (R.dressEnd - now() <= 0) finishDressing();
    }
    if (mode === 'multi') multiTick();
  }

  // ---------------------------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------------------------
  function onClick(e) {
    const t = e.target.closest('button, [data-k]');
    if (!t || !root.contains(t) || t.disabled) return;
    if (t.matches('input')) return;
    if (t.dataset.tab) { CG.sfx('click'); selectTab(t.dataset.tab); return; }
    const k = t.dataset.k, v = t.dataset.v;
    if (k) {
      if (k === 'vote') { castVote(+v); return; }
      if (!canEdit()) return;
      if (k === 'item') wear(tab, v || null);
      else if (k === 'col') change((l) => { if (l.it[tab]) l.it[tab][1] = v; }, 'click');
      else if (k === 'pat') change((l) => { if (l.it[tab]) l.it[tab][2] = v; }, 'click');
      else if (k === 'sk' || k === 'ec') change((l) => { l[k] = +v; }, 'click');
      else if (k === 'hc') change((l) => { l.hc = v; }, 'click');
      else if (['ey', 'br', 'mo', 'bl', 'hs', 'po', 'bg'].includes(k)) change((l) => { l[k] = v; });
      return;
    }
    const a = t.dataset.a;
    switch (a) {
      case 'solo': startSolo(); break;
      case 'free': startFree(); break;
      case 'gallery': CG.sfx('click'); showGallery(); break;
      case 'menu': CG.sfx('click'); if (mode === 'multi') return; showMenu(); break;
      case 'undo': undo(); break;
      case 'random': if (canEdit()) randomise(); break;
      case 'extend': if (mode === 'solo' && R.extends < MAX_EXTENDS && R.paused == null) { R.extends++; R.dressEnd += EXTEND_S * 1000; CG.sfx('score'); CG.toast('+30 seconds!'); updateTimer(); } break;
      case 'done': if (canEdit()) finishDressing(); break;
      case 'unready': if (mode === 'multi' && R.phase === 'dress') { R.ready = false; broadcast(); showReady(); CG.sfx('click'); } break;
      case 'save': saveLook(clone(look)); break;
      case 'savelook': { const me = R && (R.models ? R.models.find((m) => m.me) : null); saveLook(clone(me && me.look ? me.look : look)); break; }
      case 'skip': if (mode === 'solo') nextWalk(); break;
      case 'vprev': R.voteIdx = Math.max(0, R.voteIdx - 1); CG.sfx('click'); renderVote(); break;
      case 'vnext': R.voteIdx = Math.min(voteTargets().length - 1, R.voteIdx + 1); CG.sfx('click'); renderVote(); break;
      case 'results': if (mode === 'solo') soloResults(); break;
      case 'continue': soloGameOver(); break;
      case 'resume': if (mode === 'solo' && R && R.paused != null) { R.dressEnd = now() + R.paused; R.paused = null; const p = main.querySelector('.ss-paused'); if (p) p.remove(); } break;
      case 'wear': { const e2 = store.get(KEY_WARD, [])[+t.dataset.i]; if (e2) startFree(e2.look); break; }
      case 'del': { const list = store.get(KEY_WARD, []); list.splice(+t.dataset.i, 1); store.set(KEY_WARD, list); CG.sfx('drop'); showGallery(); break; }
      default: break;
    }
  }
  function onInput(e) {
    if (e.target.dataset.k === 'hcx' && /^#[0-9a-f]{6}$/i.test(e.target.value) && canEdit()) {
      const v = e.target.value.toLowerCase();
      if (v === look.hc) return;
      history.push(clone(look));
      look.hc = v;
      updateDoll(false);
      const lab = e.target.closest('.ss-custom');
      if (lab) lab.style.setProperty('--c', v);
      main.querySelectorAll('.ss-sw[data-k="hc"]').forEach((b) => b.classList.remove('on'));
      broadcast();
    }
  }
  function onChangeInput(e) { if (e.target.dataset.k === 'hcx') { renderPanel(); if (mode === 'free') saveMe(); } }
  function onKey(e) {
    if (CG.modalOpen() || e.target.matches('input, textarea')) return;
    if (screen === 'dress') {
      if (e.key === 'z' || e.key === 'Z') { undo(); e.preventDefault(); }
      else if (e.key === 'r' || e.key === 'R') { if (canEdit()) randomise(); }
      else if (e.key === 'Enter' && mode !== 'free' && !e.target.closest('button')) { if (canEdit()) finishDressing(); }
    } else if (screen === 'vote' && /^[1-5]$/.test(e.key)) castVote(+e.key);
    else if (screen === 'vote' && e.key === 'ArrowRight') { R.voteIdx = Math.min(voteTargets().length - 1, R.voteIdx + 1); renderVote(); }
    else if (screen === 'vote' && e.key === 'ArrowLeft') { R.voteIdx = Math.max(0, R.voteIdx - 1); renderVote(); }
    else if (screen === 'runway' && mode === 'solo' && (e.key === ' ' || e.key === 'ArrowRight')) { nextWalk(); e.preventDefault(); }
  }
  function onPause() {
    if (mode === 'solo' && screen === 'dress' && R && R.paused == null) {
      R.paused = Math.max(0, R.dressEnd - now());
      const st = main.querySelector('.ss-dress');
      if (st && !st.querySelector('.ss-paused')) {
        const ov = document.createElement('div');
        ov.className = 'ss-ready ss-paused';
        ov.innerHTML = `<div class="ss-ready-card"><div class="ss-ready-ic">${I('pause', 26)}</div><b>Paused</b><span>The clock is stopped.</span><button type="button" class="ss-btn primary" data-a="resume">${I('play', 18)}<span>Keep going</span></button></div>`;
        st.appendChild(ov);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------------------------
  CG.mount({
    id: 'style', title: 'Style Star', mode: 'race', scoreLabel: 'stars', syncMs: 500,
    help: '<ul><li>A <b>theme</b> is announced, like Beach Day or Royal Ball.</li><li>Dress your model before the clock runs out: tap a tab (tops, dresses, shoes, hats, wings…), pick an item, then choose its colour and pattern.</li><li><b>Undo</b> takes back a change, <b>Surprise me</b> picks a random outfit. In a solo game you can add 30 seconds twice.</li><li>Everyone walks the <b>runway</b>, then you rate each look from 1 to 5 stars. The best average wins. Your score is your stars × 100.</li><li>Solo: you compete with 3 computer models. Together: everyone gets the same theme and rates each other.</li><li><b>Free style</b>: no timer, save your favourite looks to your wardrobe.</li><li>Keys: Z undo, R surprise, Enter done, 1–5 to vote.</li></ul>',
    onReady(ctx) {
      root = ctx.root;
      root.classList.add('ss-root');
      root.innerHTML = '<div class="ss-main"></div>';
      main = root.querySelector('.ss-main');
      root.addEventListener('click', onClick);
      root.addEventListener('input', onInput);
      root.addEventListener('change', onChangeInput);
      document.addEventListener('keydown', onKey);
      showMenu();
      clearInterval(loopTimer);
      loopTimer = setInterval(loop, 250);
    }
  });
  CG.on('pause', onPause);
  CG.on('multiStart', (info) => { if (root) startMulti(info); });
  CG.on('multiEnd', () => { if (root) { R = null; showMenu(); } });
  window.__SS = { render, normalize, lookScore, tally, makeLook, THEMES, SLOTS, HAIR, state: () => ({ mode, screen, look, R }) };
})();
