// Seasonal decorations for Chowaniec themes (loaded on demand by /theme.js).
// window.ChowaniecFX.set(kind, { dark, still })  kind: 'autumn'|'winter'|'spring'|'summer'|'halloween'|'christmas'|''
// Everything is pointer-events:none, drawn on one small canvas, paused while the tab is hidden,
// and "still" (no movement at all) when animations are reduced.
(function () {
  'use strict';
  if (window.ChowaniecFX) return;
  var box = null, canvas = null, ctx = null, parts = [], raf = 0, last = 0, kind = '', opt = { dark: false, still: false };
  var W = 0, H = 0, DPR = 1;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function ensureBox() {
    if (box) return;
    box = document.createElement('div');
    box.id = 'cz-fx';
    box.setAttribute('aria-hidden', 'true');
    canvas = document.createElement('canvas');
    box.appendChild(canvas);
    ctx = canvas.getContext('2d');
    document.body.appendChild(box);
    window.addEventListener('resize', size);
  }

  function size() {
    if (!canvas) return;
    DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  }

  var COUNT = { autumn: 16, winter: 34, spring: 20, summer: 14, halloween: 4, christmas: 30 };

  function make(k, scatter) {
    var p = { x: rand(0, W), y: scatter ? rand(-20, H) : rand(-60, -10), r: rand(0.6, 1), rot: rand(0, 6.28), vr: rand(-1.2, 1.2), ph: rand(0, 6.28), t: 0 };
    if (k === 'autumn') { p.s = rand(11, 19); p.vy = rand(28, 52); p.vx = rand(-8, 8); p.c = pick(['#d9772b', '#b8481c', '#e0a030', '#9a3f17', '#c2621f']); }
    else if (k === 'winter' || k === 'christmas') { p.s = rand(1.4, 3.6); p.vy = rand(22, 52); p.vx = rand(-8, 8); p.c = opt.dark ? '#ffffff' : '#9ec3e6'; }
    else if (k === 'spring') { p.s = rand(5, 9); p.vy = rand(20, 40); p.vx = rand(-10, 10); p.c = pick(['#f7b6d2', '#fbd0e4', '#ffffff', '#f4a6c6']); }
    else if (k === 'summer') { p.y = rand(0, H); p.s = rand(5, 11); p.vy = -rand(4, 10); p.vx = rand(-4, 4); p.c = opt.dark ? '#ffd36b' : '#f5a623'; }
    else if (k === 'halloween') { p.dir = Math.random() < 0.5 ? 1 : -1; p.x = p.dir > 0 ? rand(-300, -40) : rand(W + 40, W + 300); p.y = rand(60, Math.max(120, H * 0.45)); p.s = rand(14, 22); p.vx = p.dir * rand(40, 75); p.vy = 0; p.c = opt.dark ? '#a78bfa' : '#2a1a3a'; }
    return p;
  }

  function fill() {
    parts = [];
    var n = COUNT[kind] || 0;
    if (W < 500) n = Math.ceil(n * 0.65);
    for (var i = 0; i < n; i++) parts.push(make(kind, true));
  }

  function drawLeaf(p) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
    var s = p.s;
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.bezierCurveTo(s * 0.9, -s * 0.5, s * 0.7, s * 0.6, 0, s); ctx.bezierCurveTo(-s * 0.7, s * 0.6, -s * 0.9, -s * 0.5, 0, -s); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(0, s); ctx.stroke();
    ctx.restore();
  }
  function drawPetal(p) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
    ctx.beginPath(); ctx.ellipse(0, 0, p.s * 0.55, p.s, 0, 0, 6.283); ctx.fill(); ctx.restore();
  }
  function drawSpark(p, a) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.globalAlpha *= a; ctx.fillStyle = p.c; var s = p.s;
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * 0.12, -s * 0.12, s, 0); ctx.quadraticCurveTo(s * 0.12, s * 0.12, 0, s); ctx.quadraticCurveTo(-s * 0.12, s * 0.12, -s, 0); ctx.quadraticCurveTo(-s * 0.12, -s * 0.12, 0, -s); ctx.fill();
    ctx.restore();
  }
  function drawBat(p, t) {
    var flap = Math.sin(t * 9 + p.ph) * 0.55;
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(p.dir, 1); ctx.fillStyle = p.c;
    var s = p.s;
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.28, s * 0.4, 0, 0, 6.283); ctx.fill();
    [-1, 1].forEach(function (side) {
      ctx.save(); ctx.scale(side, 1); ctx.rotate(flap * -1);
      ctx.beginPath(); ctx.moveTo(s * 0.2, -s * 0.1); ctx.quadraticCurveTo(s * 1.1, -s * 0.9, s * 1.5, -s * 0.2); ctx.quadraticCurveTo(s * 1.15, -s * 0.2, s * 1.0, s * 0.15); ctx.quadraticCurveTo(s * 0.75, -s * 0.05, s * 0.55, s * 0.2); ctx.quadraticCurveTo(s * 0.4, s * 0.05, s * 0.2, s * 0.25); ctx.closePath(); ctx.fill();
      ctx.restore();
    });
    ctx.beginPath(); ctx.moveTo(-s * 0.18, -s * 0.35); ctx.lineTo(-s * 0.1, -s * 0.62); ctx.lineTo(0, -s * 0.38); ctx.lineTo(s * 0.1, -s * 0.62); ctx.lineTo(s * 0.18, -s * 0.35); ctx.fill();
    ctx.restore();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = kind === 'halloween' ? 0.55 : kind === 'summer' ? 0.7 : 0.6;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.t += dt;
      if (kind === 'halloween') {
        p.x += p.vx * dt; p.y += Math.sin(p.t * 1.6 + p.ph) * 0.6;
        if ((p.dir > 0 && p.x > W + 80) || (p.dir < 0 && p.x < -80)) parts[i] = make(kind, false);
        drawBat(p, p.t); continue;
      }
      if (kind === 'summer') {
        p.x += (p.vx + Math.sin(p.t + p.ph) * 4) * dt; p.y += p.vy * dt;
        if (p.y < -20) { p.y = H + 10; p.x = rand(0, W); }
        drawSpark(p, 0.35 + 0.65 * Math.abs(Math.sin(p.t * 1.4 + p.ph))); continue;
      }
      p.y += p.vy * dt; p.x += (p.vx + Math.sin(p.t * 1.3 + p.ph) * 14) * dt; p.rot += p.vr * dt;
      if (p.y > H + 20 || p.x < -30 || p.x > W + 30) parts[i] = make(kind, false);
      if (kind === 'autumn') drawLeaf(p);
      else if (kind === 'spring') drawPetal(p);
      else { ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.283); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }

  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function start() {
    stop();
    if (!kind || opt.still || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // Corner cobwebs (Halloween) and a string of lights along the top (Christmas).
  function decorDom() {
    box.querySelectorAll('.cz-web, .cz-lights').forEach(function (n) { n.remove(); });
    if (kind === 'halloween') {
      ['tl', 'tr'].forEach(function (pos) {
        var d = document.createElement('div');
        d.className = 'cz-web ' + pos;
        d.innerHTML = '<svg viewBox="0 0 100 100" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"><path d="M0 0 L100 0 M0 0 L0 100 M0 0 L86 52 M0 0 L52 86 M0 0 L100 24 M0 0 L24 100"/><path d="M30 0 Q24 18 0 30 M58 0 Q46 36 0 58 M86 0 Q68 54 0 86"/></svg>';
        box.appendChild(d);
      });
    }
    if (kind === 'christmas') {
      var lights = document.createElement('div');
      lights.className = 'cz-lights';
      var n = Math.max(8, Math.round((window.innerWidth || 400) / 46));
      var cols = ['#ff4d5e', '#ffd04d', '#4dd67a', '#58b6ff'];
      var html = '<svg class="cz-wire" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><path d="M0 2 Q 12.5 9 25 2 T 50 2 T 75 2 T 100 2" fill="none" stroke="currentColor" stroke-width="0.7"/></svg>';
      for (var i = 0; i < n; i++) html += '<i style="--c:' + cols[i % 4] + ';animation-delay:' + ((i % 4) * 0.45).toFixed(2) + 's;left:' + ((i + 0.5) * 100 / n).toFixed(2) + '%;top:' + (i % 2 ? 8 : 4) + 'px"></i>';
      lights.innerHTML = html;
      box.appendChild(lights);
    }
  }

  window.ChowaniecFX = {
    set: function (k, o) {
      opt = { dark: !!(o && o.dark), still: !!(o && o.still) };
      kind = k || '';
      if (!kind) { stop(); if (box) { box.remove(); box = null; canvas = null; ctx = null; } parts = []; return; }
      ensureBox(); size();
      box.className = 'k-' + kind + (opt.dark ? ' dark' : '') + (opt.still ? ' still' : '');
      decorDom(); fill();
      if (opt.still && ctx) { ctx.clearRect(0, 0, W, H); }
      start();
    },
    resume: start,
    stop: stop
  };
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
})();
