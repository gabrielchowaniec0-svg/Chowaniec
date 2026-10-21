// Chowaniec's AI helper robots: seven robots, accessories, seasonal outfits and a picker.
//
//   window.ChowaniecRobot.catalog()          -> { robots:[{id,name,blurb}], accessories:[{id,name,slot,seasonal?}], slots:[...] }
//   window.ChowaniecRobot.prefs()            -> { type, accessories:[ids], seasonal }   (this person's choice, cached on the device)
//   window.ChowaniecRobot.save(partial)      -> Promise<prefs>   saves to the account, fires 'chowaniec-robot-change'
//   window.ChowaniecRobot.face(cls, opts)    -> small inline SVG face (profile pictures)
//   window.ChowaniecRobot.mascot(opts)       -> HTML for the animated robot (see robot.css); states via data-state:
//                                               asleep | idle | listening | thinking | talking | celebrate
//   window.ChowaniecRobot.mountPicker(el, {onChange}) -> full picker UI with a live animated preview
//   window.ChowaniecRobot.effective(prefs?)  -> accessory ids actually worn (includes seasonal extras)
//   window.ChowaniecRobot.season()           -> 'autumn' | 'winter' | 'spring' | 'summer' | 'halloween' | 'christmas'
// opts (all optional) override the saved choice, for previews: { robot, accessories, seasonal, live:false }.
// Anything made with live (the default) re-draws itself when the choice or the theme changes.
(function () {
  'use strict';
  const f = (x) => Math.round(x * 10) / 10;
  const lp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const pts = (list) => list.map((p) => `${f(p[0])},${f(p[1])}`).join(' ');

  // ---------- shapes
  function gearPoints(cx, cy, r1, r2, teeth) {
    const out = [];
    const step = (Math.PI * 2) / teeth;
    for (let i = 0; i < teeth; i++) {
      const a = i * step;
      const d1 = step * 0.3, d2 = step * 0.17;
      [[r1, a - d1], [r2, a - d2], [r2, a + d2], [r1, a + d1]].forEach(([r, t]) => out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]));
    }
    return pts(out);
  }
  function starPoints(cx, cy, ro, ri) {
    const out = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? ri : ro;
      const t = -Math.PI / 2 + (i * Math.PI) / 5;
      out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    return pts(out);
  }

  // ---------- the robots
  // Every robot supplies the same hooks so one set of animations (robot.css) drives them all:
  //   .bob-eyes > .bob-eye   .bob-mouth-closed / .bob-mouth-open   .bob-arm.l / .bob-arm.r   .bob-bulb   .bob-ant (antenna)
  // and anchor points `a` so accessories fit: cx, top (top of head), hl/hr (head left/right), eyeY, el/er (eye x),
  // mouthY, neckY, bl/br/bt/bb (body box), sl/sr (hands), face = square crop used for profile pictures.
  const ROBOTS = [
    {
      id: 'bob', name: 'Bob', blurb: 'Friendly, tidy and always ready to help.', hello: "Hi! I'm Bob. What do you need?",
      a: { cx: 60, top: 24, hl: 26, hr: 94, eyeY: 46, el: 46, er: 74, mouthY: 64, neckY: 76, bl: 40, br: 80, bt: 76, bb: 98, sl: 22, sr: 98, face: '12 2 96' },
      art: () => ({
        ant: `<g class="bob-ant"><line x1="60" y1="10" x2="60" y2="24" stroke="#4c1d95" stroke-width="3" stroke-linecap="round"/><circle class="bob-bulb" cx="60" cy="9" r="5" fill="#fbbf24"/></g>`,
        head: `<rect x="26" y="24" width="68" height="50" rx="18" fill="#ede9fe" stroke="#4c1d95" stroke-width="3"/>
          <rect x="18" y="40" width="8" height="18" rx="4" fill="#c4b5fd" stroke="#4c1d95" stroke-width="2"/><rect x="94" y="40" width="8" height="18" rx="4" fill="#c4b5fd" stroke="#4c1d95" stroke-width="2"/>
          <g class="bob-eyes"><ellipse class="bob-eye l" cx="46" cy="46" rx="7" ry="8" fill="#3b0764"/><ellipse class="bob-eye r" cx="74" cy="46" rx="7" ry="8" fill="#3b0764"/>
            <circle cx="48" cy="43" r="2.2" fill="#fff"/><circle cx="76" cy="43" r="2.2" fill="#fff"/></g>
          <g class="bob-mouth"><path class="bob-mouth-closed" d="M46 62 Q60 70 74 62" fill="none" stroke="#3b0764" stroke-width="3.5" stroke-linecap="round"/>
            <ellipse class="bob-mouth-open" cx="60" cy="64" rx="9" ry="6" fill="#3b0764"/></g>`,
        torso: `<rect x="40" y="76" width="40" height="22" rx="8" fill="#c4b5fd" stroke="#4c1d95" stroke-width="3"/>
          <circle cx="52" cy="87" r="3" fill="#7c3aed"/><circle cx="68" cy="87" r="3" fill="#a78bfa"/>`,
        arms: `<g class="bob-arm l"><rect x="22" y="80" width="20" height="9" rx="4.5" fill="#c4b5fd" stroke="#4c1d95" stroke-width="2.5"/></g>
          <g class="bob-arm r"><rect x="78" y="80" width="20" height="9" rx="4.5" fill="#c4b5fd" stroke="#4c1d95" stroke-width="2.5"/></g>`
      })
    },
    {
      id: 'pixel', name: 'Pixel', blurb: 'A retro screen with a big heart. Loves games and tidy lists.', hello: 'Beep boop! Pixel here.',
      a: { cx: 60, top: 22, hl: 28, hr: 92, eyeY: 46, el: 46, er: 74, mouthY: 61, neckY: 76, bl: 42, br: 78, bt: 76, bb: 98, sl: 24, sr: 96, face: '14 6 92' },
      art: () => ({
        ant: `<g class="bob-ant"><line x1="48" y1="22" x2="42" y2="10" stroke="#1e293b" stroke-width="3" stroke-linecap="round"/><rect x="38" y="5" width="8" height="8" rx="2" fill="#f472b6" stroke="#1e293b" stroke-width="2"/>
          <line x1="72" y1="22" x2="78" y2="10" stroke="#1e293b" stroke-width="3" stroke-linecap="round"/><rect x="74" y="5" width="8" height="8" rx="2" fill="#38bdf8" stroke="#1e293b" stroke-width="2"/></g>`,
        head: `<rect x="28" y="22" width="64" height="52" rx="9" fill="#e2e8f0" stroke="#1e293b" stroke-width="3"/>
          <rect x="34" y="28" width="52" height="40" rx="5" fill="#052e16"/>
          <g class="bob-scan" opacity=".14"><rect x="34" y="34" width="52" height="1.6" fill="#86efac"/><rect x="34" y="42" width="52" height="1.6" fill="#86efac"/><rect x="34" y="50" width="52" height="1.6" fill="#86efac"/><rect x="34" y="58" width="52" height="1.6" fill="#86efac"/></g>
          <circle class="bob-bulb" cx="82" cy="71" r="2.6" fill="#fbbf24"/>
          <g class="bob-eyes"><rect class="bob-eye l" x="41.5" y="39" width="9" height="13" rx="1.5" fill="#4ade80"/><rect class="bob-eye r" x="69.5" y="39" width="9" height="13" rx="1.5" fill="#4ade80"/></g>
          <g class="bob-mouth"><path class="bob-mouth-closed" d="M49 60 H71" fill="none" stroke="#4ade80" stroke-width="3.6" stroke-linecap="square"/>
            <rect class="bob-mouth-open" x="50" y="56" width="20" height="10" rx="2" fill="#4ade80"/></g>`,
        torso: `<rect x="52" y="73" width="16" height="5" fill="#94a3b8" stroke="#1e293b" stroke-width="2"/>
          <rect x="42" y="76" width="36" height="22" rx="5" fill="#cbd5e1" stroke="#1e293b" stroke-width="3"/>
          <rect x="48" y="82" width="10" height="3" rx="1" fill="#1e293b"/><rect x="48" y="88" width="24" height="3" rx="1" fill="#94a3b8"/>
          <rect x="64" y="81.5" width="5" height="5" rx="1" fill="#f472b6"/><rect x="71" y="81.5" width="3" height="5" rx="1" fill="#38bdf8"/>`,
        arms: `<g class="bob-arm l"><rect x="24" y="80" width="18" height="9" rx="2.5" fill="#cbd5e1" stroke="#1e293b" stroke-width="2.5"/></g>
          <g class="bob-arm r"><rect x="78" y="80" width="18" height="9" rx="2.5" fill="#cbd5e1" stroke="#1e293b" stroke-width="2.5"/></g>`
      })
    },
    {
      id: 'sparky', name: 'Sparky', blurb: 'Round, bright and full of energy. Zaps through your to-do list.', hello: 'Zzzap! Sparky is on it!',
      a: { cx: 60, top: 22, hl: 32, hr: 88, eyeY: 46, el: 48, er: 72, mouthY: 62, neckY: 77, bl: 42, br: 78, bt: 77, bb: 98, sl: 26, sr: 94, face: '14 0 92' },
      art: () => ({
        ant: `<g class="bob-ant"><line x1="60" y1="12" x2="60" y2="23" stroke="#92400e" stroke-width="3" stroke-linecap="round"/>
          <polygon class="bob-bulb" points="${starPoints(60, 8, 7.5, 3.4)}" fill="#f59e0b" stroke="#92400e" stroke-width="1.6" stroke-linejoin="round"/>
          <polyline class="bob-spark" points="70,5 74,10 70,10 75,16" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <polyline class="bob-spark s2" points="50,5 46,10 50,10 45,16" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>`,
        head: `<circle cx="60" cy="50" r="28" fill="#fef3c7" stroke="#92400e" stroke-width="3"/>
          <circle cx="39" cy="58" r="5" fill="#fda4af" opacity=".55"/><circle cx="81" cy="58" r="5" fill="#fda4af" opacity=".55"/>
          <g class="bob-eyes"><circle class="bob-eye l" cx="48" cy="46" r="7" fill="#451a03"/><circle class="bob-eye r" cx="72" cy="46" r="7" fill="#451a03"/>
            <circle cx="50" cy="43.5" r="2.3" fill="#fff"/><circle cx="74" cy="43.5" r="2.3" fill="#fff"/></g>
          <g class="bob-mouth"><path class="bob-mouth-closed" d="M50 60 Q60 69 70 60" fill="none" stroke="#451a03" stroke-width="3.4" stroke-linecap="round"/>
            <ellipse class="bob-mouth-open" cx="60" cy="63" rx="8.5" ry="6" fill="#451a03"/></g>`,
        torso: `<ellipse cx="60" cy="88" rx="19" ry="12" fill="#fde68a" stroke="#92400e" stroke-width="3"/>
          <polygon points="62,80 55,89 60,89 58,96 66,86 61,86" fill="#f59e0b" stroke="#92400e" stroke-width="1.4" stroke-linejoin="round"/>`,
        arms: `<g class="bob-arm l"><rect x="26" y="80" width="18" height="9" rx="4.5" fill="#fcd34d" stroke="#92400e" stroke-width="2.5"/></g>
          <g class="bob-arm r"><rect x="76" y="80" width="18" height="9" rx="4.5" fill="#fcd34d" stroke="#92400e" stroke-width="2.5"/></g>`
      })
    },
    {
      id: 'boxy', name: 'Boxy', blurb: 'Tall, calm and very organised. Never forgets a deadline.', hello: 'Greetings. Boxy is ready.',
      a: { cx: 60, top: 18, hl: 34, hr: 86, eyeY: 38, el: 50, er: 70, mouthY: 53, neckY: 66, bl: 36, br: 84, bt: 66, bb: 100, sl: 22, sr: 98, face: '20 0 80' },
      art: () => ({
        ant: `<g class="bob-ant"><line x1="44" y1="18" x2="44" y2="9" stroke="#134e4a" stroke-width="3" stroke-linecap="round"/><circle class="bob-bulb" cx="44" cy="7" r="4.5" fill="#fbbf24" stroke="#134e4a" stroke-width="1.6"/></g>`,
        head: `<rect x="34" y="18" width="52" height="42" rx="6" fill="#ccfbf1" stroke="#134e4a" stroke-width="3"/>
          <rect x="38" y="27" width="44" height="21" rx="10" fill="#0f2f2c"/>
          <g class="bob-eyes"><ellipse class="bob-eye l" cx="50" cy="38" rx="5.5" ry="6.5" fill="#5eead4"/><ellipse class="bob-eye r" cx="70" cy="38" rx="5.5" ry="6.5" fill="#5eead4"/></g>
          <g class="bob-mouth"><path class="bob-mouth-closed" d="M48 54 H72" fill="none" stroke="#134e4a" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 2.4"/>
            <rect class="bob-mouth-open" x="50" y="50" width="20" height="9" rx="2.5" fill="#134e4a"/></g>`,
        torso: `<rect x="52" y="59" width="16" height="8" fill="#5eead4" stroke="#134e4a" stroke-width="2.5"/>
          <rect x="36" y="66" width="48" height="34" rx="6" fill="#99f6e4" stroke="#134e4a" stroke-width="3"/>
          <rect x="46" y="72" width="28" height="14" rx="3" fill="#0f2f2c"/>
          <circle cx="53" cy="79" r="2.4" fill="#f472b6"/><circle cx="60" cy="79" r="2.4" fill="#fbbf24"/><circle cx="67" cy="79" r="2.4" fill="#38bdf8"/>
          <rect x="44" y="91" width="32" height="3" rx="1.5" fill="#14b8a6"/>`,
        arms: `<g class="bob-arm l"><rect x="22" y="74" width="18" height="9" rx="3" fill="#99f6e4" stroke="#134e4a" stroke-width="2.5"/></g>
          <g class="bob-arm r"><rect x="80" y="74" width="18" height="9" rx="3" fill="#99f6e4" stroke="#134e4a" stroke-width="2.5"/></g>`
      })
    },
    {
      id: 'luna', name: 'Luna', blurb: 'Soft, curious and a little bit cat. Purrs when you say thanks.', hello: 'Mew! Luna here, how can I help?',
      a: { cx: 60, top: 24, hl: 28, hr: 92, eyeY: 48, el: 46, er: 74, mouthY: 62, neckY: 76, bl: 38, br: 82, bt: 76, bb: 98, sl: 24, sr: 96, face: '10 4 100' },
      art: () => ({
        back: `<g class="bob-ear l"><polygon points="30,38 33,12 54,27" fill="#fce7f3" stroke="#831843" stroke-width="3" stroke-linejoin="round"/><polygon points="35,31 36,20 46,27" fill="#f9a8d4"/></g>
          <g class="bob-ear r"><polygon points="90,38 87,12 66,27" fill="#fce7f3" stroke="#831843" stroke-width="3" stroke-linejoin="round"/><polygon points="85,31 84,20 74,27" fill="#f9a8d4"/></g>`,
        ant: '',
        head: `<ellipse cx="60" cy="50" rx="32" ry="26" fill="#fce7f3" stroke="#831843" stroke-width="3"/>
          <path class="bob-bulb" d="M60 27 l4.2 5 -4.2 5.4 -4.2 -5.4z" fill="#f472b6" stroke="#831843" stroke-width="1.4" stroke-linejoin="round"/>
          <circle cx="37" cy="60" r="5" fill="#f9a8d4" opacity=".6"/><circle cx="83" cy="60" r="5" fill="#f9a8d4" opacity=".6"/>
          <g stroke="#831843" stroke-width="1.6" stroke-linecap="round" opacity=".7"><line x1="31" y1="55" x2="19" y2="52"/><line x1="31" y1="59" x2="19" y2="61"/><line x1="89" y1="55" x2="101" y2="52"/><line x1="89" y1="59" x2="101" y2="61"/></g>
          <g class="bob-eyes"><ellipse class="bob-eye l" cx="46" cy="48" rx="7" ry="9" fill="#4a044e"/><ellipse class="bob-eye r" cx="74" cy="48" rx="7" ry="9" fill="#4a044e"/>
            <circle cx="48" cy="44.5" r="2.4" fill="#fff"/><circle cx="76" cy="44.5" r="2.4" fill="#fff"/></g>
          <g class="bob-mouth"><path class="bob-mouth-closed" d="M52 61 Q56 66 60 61 Q64 66 68 61" fill="none" stroke="#4a044e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            <ellipse class="bob-mouth-open" cx="60" cy="63" rx="7" ry="5.5" fill="#4a044e"/></g>`,
        torso: `<path d="M80 92 Q106 92 100 70" fill="none" stroke="#831843" stroke-width="9" stroke-linecap="round"/><path class="bob-tail" d="M80 92 Q106 92 100 70" fill="none" stroke="#fbcfe8" stroke-width="4.6" stroke-linecap="round"/>
          <ellipse cx="60" cy="88" rx="22" ry="13" fill="#fbcfe8" stroke="#831843" stroke-width="3"/><ellipse cx="60" cy="90" rx="10" ry="7" fill="#fdf2f8"/>`,
        arms: `<g class="bob-arm l"><rect x="24" y="80" width="18" height="9" rx="4.5" fill="#fbcfe8" stroke="#831843" stroke-width="2.5"/></g>
          <g class="bob-arm r"><rect x="78" y="80" width="18" height="9" rx="4.5" fill="#fbcfe8" stroke="#831843" stroke-width="2.5"/></g>`
      })
    },
    {
      id: 'orbit', name: 'Orbit', blurb: 'A floating sphere with its own little ring. Calm, curious, a bit cosmic.', hello: 'Orbit online. Hello, friend.',
      a: { cx: 60, top: 22, hl: 32, hr: 88, eyeY: 48, el: 49, er: 71, mouthY: 61, neckY: 78, bl: 46, br: 74, bt: 80, bb: 96, sl: 30, sr: 90, face: '8 2 104' },
      art: () => ({
        back: `<g class="rt bob-ring" transform="rotate(-18 60 50)"><path d="M16 50 A44 11 0 0 1 104 50" fill="none" stroke="#7dd3fc" stroke-width="5" stroke-linecap="round"/><path d="M16 50 A44 11 0 0 1 104 50" fill="none" stroke="#0c4a6e" stroke-width="1.4" stroke-linecap="round" opacity=".6"/></g>`,
        ant: '',
        head: `<circle cx="60" cy="50" r="28" fill="#e0f2fe" stroke="#0c4a6e" stroke-width="3"/>
          <path d="M40 34 A24 24 0 0 1 58 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity=".75"/>
          <g class="bob-eyes"><ellipse class="bob-eye l" cx="49" cy="48" rx="6.5" ry="8" fill="#082f49"/><ellipse class="bob-eye r" cx="71" cy="48" rx="6.5" ry="8" fill="#082f49"/>
            <circle cx="51" cy="45" r="2.1" fill="#fff"/><circle cx="73" cy="45" r="2.1" fill="#fff"/></g>
          <g class="bob-mouth"><path class="bob-mouth-closed" d="M52 60 Q60 66 68 60" fill="none" stroke="#082f49" stroke-width="3.2" stroke-linecap="round"/>
            <ellipse class="bob-mouth-open" cx="60" cy="62" rx="8" ry="6" fill="#082f49"/></g>
          <g class="rt bob-ring" transform="rotate(-18 60 50)"><path d="M16 50 A44 11 0 0 0 104 50" fill="none" stroke="#7dd3fc" stroke-width="5" stroke-linecap="round"/><path d="M16 50 A44 11 0 0 0 104 50" fill="none" stroke="#0c4a6e" stroke-width="1.4" stroke-linecap="round" opacity=".6"/>
            <circle class="bob-bulb" cx="104" cy="50" r="4.6" fill="#fbbf24" stroke="#0c4a6e" stroke-width="1.6"/></g>`,
        torso: `<ellipse class="bob-glow" cx="60" cy="86" rx="15" ry="4" fill="#38bdf8" opacity=".4"/><ellipse cx="60" cy="82" rx="7" ry="3" fill="#0c4a6e" opacity=".35"/>`,
        arms: `<g class="bob-arm l"><circle cx="34" cy="86" r="6.5" fill="#e0f2fe" stroke="#0c4a6e" stroke-width="2.5"/></g>
          <g class="bob-arm r"><circle cx="86" cy="86" r="6.5" fill="#e0f2fe" stroke="#0c4a6e" stroke-width="2.5"/></g>`
      })
    },
    {
      id: 'cog', name: 'Cog', blurb: 'Built from gears and good ideas. Slow to rush, quick to fix.', hello: 'Clink, whirr! Cog at your service.',
      a: { cx: 60, top: 18, hl: 28, hr: 92, eyeY: 45, el: 50, er: 70, mouthY: 59, neckY: 82, bl: 42, br: 78, bt: 82, bb: 98, sl: 24, sr: 96, face: '16 2 88' },
      art: () => ({
        back: `<g class="bob-gear"><polygon points="${gearPoints(60, 48, 33, 28, 10)}" fill="#fdba74" stroke="#7c2d12" stroke-width="3" stroke-linejoin="round"/></g>`,
        ant: `<g class="bob-ant"><line x1="60" y1="15" x2="60" y2="11" stroke="#7c2d12" stroke-width="3" stroke-linecap="round"/><circle class="bob-bulb" cx="60" cy="8" r="4.4" fill="#fbbf24" stroke="#7c2d12" stroke-width="1.6"/></g>`,
        head: `<circle cx="60" cy="48" r="23" fill="#fff7ed" stroke="#7c2d12" stroke-width="3"/>
          <circle cx="43" cy="36" r="2" fill="#c2410c"/><circle cx="77" cy="36" r="2" fill="#c2410c"/><circle cx="43" cy="60" r="2" fill="#c2410c"/><circle cx="77" cy="60" r="2" fill="#c2410c"/>
          <g class="bob-eyes"><circle class="bob-eye l" cx="50" cy="45" r="6.3" fill="#431407"/><circle class="bob-eye r" cx="70" cy="45" r="6.3" fill="#431407"/>
            <circle cx="52" cy="42.6" r="2" fill="#fff"/><circle cx="72" cy="42.6" r="2" fill="#fff"/></g>
          <g class="bob-mouth"><path class="bob-mouth-closed" d="M51 58 Q60 65 69 58" fill="none" stroke="#431407" stroke-width="3.2" stroke-linecap="round"/>
            <ellipse class="bob-mouth-open" cx="60" cy="60" rx="8" ry="5.8" fill="#431407"/></g>`,
        torso: `<rect x="42" y="82" width="36" height="16" rx="6" fill="#fdba74" stroke="#7c2d12" stroke-width="3"/>
          <circle cx="50" cy="90" r="2.4" fill="#7c2d12"/><circle cx="70" cy="90" r="2.4" fill="#7c2d12"/><polygon points="${gearPoints(60, 90, 5.6, 4, 6)}" fill="#f97316" stroke="#7c2d12" stroke-width="1.2"/>`,
        arms: `<g class="bob-arm l"><rect x="24" y="84" width="18" height="9" rx="4.5" fill="#fdba74" stroke="#7c2d12" stroke-width="2.5"/></g>
          <g class="bob-arm r"><rect x="78" y="84" width="18" height="9" rx="4.5" fill="#fdba74" stroke="#7c2d12" stroke-width="2.5"/></g>`
      })
    }
  ];
  const ROBOT_BY_ID = {};
  ROBOTS.forEach((r) => { ROBOT_BY_ID[r.id] = r; });

  // ---------- accessories
  // draw(a) returns SVG for this robot's anchors, or { back, front } for things that go behind the body (capes, backpacks).
  const hwOf = (a) => a.hr - a.hl;
  const ACC = [
    // --- hats (slot: head)
    { id: 'tophat', name: 'Top hat', slot: 'head', draw: (a) => { const w = hwOf(a); return `<rect x="${f(a.cx - w * .28)}" y="${f(a.top - 27)}" width="${f(w * .56)}" height="25" rx="3" fill="#111827" stroke="#030712" stroke-width="1.5"/><rect x="${f(a.cx - w * .28)}" y="${f(a.top - 10)}" width="${f(w * .56)}" height="5" fill="#dc2626"/><rect x="${f(a.cx - w * .44)}" y="${f(a.top - 3)}" width="${f(w * .88)}" height="6" rx="3" fill="#1f2937" stroke="#030712" stroke-width="1.5"/>`; } },
    { id: 'partyhat', name: 'Party hat', slot: 'head', draw: (a) => {
      const w = hwOf(a), L = [a.cx - w * .22, a.top + 3], R = [a.cx + w * .22, a.top + 3], A = [a.cx + w * .1, a.top - 32];
      return `<polygon points="${pts([L, R, A])}" fill="#ec4899" stroke="#9d174d" stroke-width="1.6" stroke-linejoin="round"/><polygon points="${pts([lp(L, A, .3), lp(R, A, .3), lp(R, A, .46), lp(L, A, .46)])}" fill="#fde047"/><polygon points="${pts([lp(L, A, .62), lp(R, A, .62), lp(R, A, .74), lp(L, A, .74)])}" fill="#38bdf8"/><circle cx="${f(A[0])}" cy="${f(A[1])}" r="4.2" fill="#fde047" stroke="#a16207" stroke-width="1.2"/>`; } },
    { id: 'crown', name: 'Crown', slot: 'head', draw: (a) => { const w = hwOf(a), x0 = a.cx - w * .3, x1 = a.cx + w * .3, y = a.top + 3;
      return `<polygon points="${pts([[x0, y], [x0, y - 17], [a.cx - w * .15, y - 8], [a.cx, y - 21], [a.cx + w * .15, y - 8], [x1, y - 17], [x1, y]])}" fill="#fbbf24" stroke="#b45309" stroke-width="1.8" stroke-linejoin="round"/><circle cx="${f(x0)}" cy="${f(y - 17)}" r="2.2" fill="#ef4444"/><circle cx="${f(a.cx)}" cy="${f(y - 21)}" r="2.4" fill="#38bdf8"/><circle cx="${f(x1)}" cy="${f(y - 17)}" r="2.2" fill="#ef4444"/><rect x="${f(x0)}" y="${f(y - 4)}" width="${f(x1 - x0)}" height="4" fill="#f59e0b" stroke="#b45309" stroke-width="1.2"/>`; } },
    { id: 'beanie', name: 'Beanie', slot: 'head', draw: (a) => { const w = hwOf(a), y = a.top + 7, rx = w * .4, ry = w * .34;
      return `<path d="M${f(a.cx - rx)} ${f(y)} A${f(rx)} ${f(ry)} 0 0 1 ${f(a.cx + rx)} ${f(y)} Z" fill="#3b82f6" stroke="#1e3a8a" stroke-width="1.8"/><rect x="${f(a.cx - w * .42)}" y="${f(a.top)}" width="${f(w * .84)}" height="9" rx="3.5" fill="#1d4ed8" stroke="#1e3a8a" stroke-width="1.6"/><circle cx="${f(a.cx)}" cy="${f(y - ry - 2)}" r="5" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1.2"/>`; } },
    { id: 'headphones', name: 'Headphones', slot: 'head', draw: (a) => { const mid = (a.top + a.eyeY) / 2 + 2;
      return `<path d="M${a.hl - 1} ${f(mid)} C${a.hl - 1} ${a.top - 17}, ${a.hr + 1} ${a.top - 17}, ${a.hr + 1} ${f(mid)}" fill="none" stroke="#374151" stroke-width="5" stroke-linecap="round"/><rect x="${a.hl - 9}" y="${f(mid - 9)}" width="11" height="18" rx="5" fill="#ef4444" stroke="#7f1d1d" stroke-width="2"/><rect x="${a.hr - 2}" y="${f(mid - 9)}" width="11" height="18" rx="5" fill="#ef4444" stroke="#7f1d1d" stroke-width="2"/>`; } },
    { id: 'flower', name: 'Flower', slot: 'head', draw: (a) => { const w = hwOf(a), x = a.cx - w * .24, y = a.top + 2; let s = '';
      for (let i = 0; i < 5; i++) { const t = -Math.PI / 2 + i * Math.PI * 2 / 5; s += `<circle cx="${f(x + 4 * Math.cos(t))}" cy="${f(y + 4 * Math.sin(t))}" r="3.4" fill="#f9a8d4" stroke="#be185d" stroke-width="1"/>`; }
      return `${s}<circle cx="${f(x)}" cy="${f(y)}" r="2.8" fill="#fde047" stroke="#a16207" stroke-width="1"/>`; } },
    { id: 'santahat', name: 'Santa hat', slot: 'head', seasonal: ['christmas'], draw: (a) => { const w = hwOf(a), t = a.top;
      return `<path d="M${f(a.cx - w * .36)} ${t} C${f(a.cx - w * .36)} ${t - 22}, ${f(a.cx + w * .02)} ${t - 33}, ${f(a.cx + w * .38)} ${t - 19} L${f(a.cx + w * .36)} ${t} Z" fill="#dc2626" stroke="#7f1d1d" stroke-width="1.6" stroke-linejoin="round"/><rect x="${f(a.cx - w * .43)}" y="${t - 3}" width="${f(w * .86)}" height="9" rx="4.5" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.4"/><circle cx="${f(a.cx + w * .38)}" cy="${t - 18}" r="5.2" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.4"/>`; } },
    { id: 'witchhat', name: 'Witch hat', slot: 'head', seasonal: ['halloween'], draw: (a) => { const w = hwOf(a), t = a.top;
      return `<polygon points="${pts([[a.cx - w * .27, t + 1], [a.cx + w * .02, t - 30], [a.cx + w * .26, t - 33], [a.cx + w * .13, t - 25], [a.cx + w * .27, t + 1]])}" fill="#2e1065" stroke="#0f0720" stroke-width="1.6" stroke-linejoin="round"/><rect x="${f(a.cx - w * .26)}" y="${t - 8}" width="${f(w * .52)}" height="6" fill="#f97316"/><ellipse cx="${a.cx}" cy="${t + 2}" rx="${f(w * .56)}" ry="5" fill="#1e1b4b" stroke="#0f0720" stroke-width="1.6"/><rect x="${f(a.cx - 3)}" y="${t - 9}" width="6" height="8" rx="1" fill="none" stroke="#fde047" stroke-width="1.5"/>`; } },
    { id: 'sunhat', name: 'Sun hat', slot: 'head', seasonal: ['summer'], draw: (a) => { const w = hwOf(a), t = a.top;
      return `<path d="M${f(a.cx - w * .3)} ${t + 2} Q${a.cx} ${t - 24} ${f(a.cx + w * .3)} ${t + 2} Z" fill="#fcd34d" stroke="#b45309" stroke-width="1.6"/><rect x="${f(a.cx - w * .29)}" y="${t - 7}" width="${f(w * .58)}" height="5" fill="#38bdf8"/><ellipse cx="${a.cx}" cy="${t + 3}" rx="${f(w * .62)}" ry="5.5" fill="#fde68a" stroke="#b45309" stroke-width="1.6"/>`; } },
    { id: 'leaf', name: 'Autumn leaf', slot: 'head', seasonal: ['autumn'], draw: (a) => { const w = hwOf(a), x = a.cx + w * .16, y = a.top + 4;
      return `<g class="rt" transform="rotate(28 ${f(x)} ${f(y)})"><path d="M${f(x)} ${f(y)} C${f(x + 7)} ${f(y - 6)}, ${f(x + 7)} ${f(y - 17)}, ${f(x)} ${f(y - 24)} C${f(x - 7)} ${f(y - 17)}, ${f(x - 7)} ${f(y - 6)}, ${f(x)} ${f(y)} Z" fill="#ea580c" stroke="#9a3412" stroke-width="1.6"/><line x1="${f(x)}" y1="${f(y)}" x2="${f(x)}" y2="${f(y - 20)}" stroke="#9a3412" stroke-width="1.2"/></g><g class="rt" transform="rotate(-24 ${f(x - 10)} ${f(y + 1)})"><path d="M${f(x - 10)} ${f(y + 1)} C${f(x - 5)} ${f(y - 3)}, ${f(x - 5)} ${f(y - 10)}, ${f(x - 10)} ${f(y - 14)} C${f(x - 15)} ${f(y - 10)}, ${f(x - 15)} ${f(y - 3)}, ${f(x - 10)} ${f(y + 1)} Z" fill="#facc15" stroke="#a16207" stroke-width="1.3"/></g>`; } },
    { id: 'bunnyears', name: 'Bunny ears', slot: 'head', seasonal: ['spring'], draw: (a) => { const w = hwOf(a), t = a.top, xl = a.cx - w * .2, xr = a.cx + w * .2;
      return `<g class="rt" transform="rotate(-10 ${f(xl)} ${t + 2})"><ellipse cx="${f(xl)}" cy="${t - 12}" rx="6" ry="15" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.8"/><ellipse cx="${f(xl)}" cy="${t - 11}" rx="2.8" ry="10" fill="#fbcfe8"/></g><g class="rt" transform="rotate(10 ${f(xr)} ${t + 2})"><ellipse cx="${f(xr)}" cy="${t - 12}" rx="6" ry="15" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.8"/><ellipse cx="${f(xr)}" cy="${t - 11}" rx="2.8" ry="10" fill="#fbcfe8"/></g>`; } },
    // --- face
    { id: 'glasses', name: 'Glasses', slot: 'face', draw: (a) => `<g fill="rgba(255,255,255,.2)" stroke="#111827" stroke-width="2.4"><circle cx="${a.el}" cy="${a.eyeY}" r="10"/><circle cx="${a.er}" cy="${a.eyeY}" r="10"/></g><path d="M${a.el + 10} ${a.eyeY - 1} Q${a.cx} ${a.eyeY - 5} ${a.er - 10} ${a.eyeY - 1}" fill="none" stroke="#111827" stroke-width="2.4"/><path d="M${a.el - 10} ${a.eyeY - 1} L${a.hl - 2} ${a.eyeY - 3} M${a.er + 10} ${a.eyeY - 1} L${a.hr + 2} ${a.eyeY - 3}" stroke="#111827" stroke-width="2.4" stroke-linecap="round"/>` },
    { id: 'sunglasses', name: 'Sunglasses', slot: 'face', draw: (a) => `<g fill="#111827" stroke="#030712" stroke-width="1.6"><rect x="${a.el - 11}" y="${a.eyeY - 8}" width="22" height="16" rx="6"/><rect x="${a.er - 11}" y="${a.eyeY - 8}" width="22" height="16" rx="6"/></g><path d="M${a.el + 11} ${a.eyeY - 3} L${a.er - 11} ${a.eyeY - 3}" stroke="#111827" stroke-width="2.6"/><path d="M${a.el - 11} ${a.eyeY - 3} L${a.hl - 2} ${a.eyeY - 5} M${a.er + 11} ${a.eyeY - 3} L${a.hr + 2} ${a.eyeY - 5}" stroke="#111827" stroke-width="2.4" stroke-linecap="round"/><path d="M${a.el - 6} ${a.eyeY - 4} l5 -1 M${a.er - 6} ${a.eyeY - 4} l5 -1" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".6"/>` },
    { id: 'monocle', name: 'Monocle', slot: 'face', draw: (a) => `<circle cx="${a.er}" cy="${a.eyeY}" r="10" fill="rgba(255,255,255,.22)" stroke="#d4a017" stroke-width="2.6"/><path d="M${a.er + 5} ${a.eyeY + 9} Q${a.er + 14} ${a.eyeY + 18} ${a.er + 8} ${a.mouthY + 16}" fill="none" stroke="#d4a017" stroke-width="1.6" stroke-dasharray="2.4 1.8" stroke-linecap="round"/>` },
    { id: 'mustache', name: 'Moustache', slot: 'face', draw: (a) => { const y = a.mouthY - 5, x = a.cx;
      return `<path d="M${x} ${y} Q${x - 6} ${y - 6} ${x - 16} ${y - 1} Q${x - 10} ${y + 6} ${x} ${y + 2} Z M${x} ${y} Q${x + 6} ${y - 6} ${x + 16} ${y - 1} Q${x + 10} ${y + 6} ${x} ${y + 2} Z" fill="#4a2c12" stroke="#2a1809" stroke-width="1.2" stroke-linejoin="round"/>`; } },
    // --- neck
    { id: 'bowtie', name: 'Bow tie', slot: 'neck', draw: (a) => { const y = a.neckY;
      return `<polygon points="${pts([[a.cx - 13, y - 5], [a.cx - 1, y + 1], [a.cx - 13, y + 7]])}" fill="#dc2626" stroke="#7f1d1d" stroke-width="1.6" stroke-linejoin="round"/><polygon points="${pts([[a.cx + 13, y - 5], [a.cx + 1, y + 1], [a.cx + 13, y + 7]])}" fill="#dc2626" stroke="#7f1d1d" stroke-width="1.6" stroke-linejoin="round"/><rect x="${a.cx - 3.2}" y="${y - 3}" width="6.4" height="8" rx="2" fill="#b91c1c" stroke="#7f1d1d" stroke-width="1.4"/>`; } },
    { id: 'scarf', name: 'Scarf', slot: 'neck', draw: (a) => { const y = a.neckY, w = a.br - a.bl + 8;
      return `<rect x="${a.cx + 5}" y="${y}" width="10" height="20" rx="3" fill="#f59e0b" stroke="#92400e" stroke-width="1.6"/><rect x="${a.cx + 5}" y="${y + 8}" width="10" height="3" fill="#b45309"/><rect x="${a.bl - 4}" y="${y - 4}" width="${w}" height="9" rx="4.5" fill="#f59e0b" stroke="#92400e" stroke-width="1.8"/><path d="M${a.bl + 6} ${y - 3} v7 M${a.cx - 4} ${y - 3} v7 M${a.br - 6} ${y - 3} v7" stroke="#b45309" stroke-width="2"/>`; } },
    { id: 'snowscarf', name: 'Snow scarf', slot: 'neck', seasonal: ['winter', 'christmas'], draw: (a) => { const y = a.neckY, w = a.br - a.bl + 8;
      return `<rect x="${a.cx - 15}" y="${y}" width="10" height="20" rx="3" fill="#dbeafe" stroke="#2563eb" stroke-width="1.6"/><rect x="${a.cx - 15}" y="${y + 8}" width="10" height="3" fill="#3b82f6"/><rect x="${a.bl - 4}" y="${y - 4}" width="${w}" height="9" rx="4.5" fill="#dbeafe" stroke="#2563eb" stroke-width="1.8"/><path d="M${a.bl + 6} ${y - 3} v7 M${a.cx - 4} ${y - 3} v7 M${a.br - 6} ${y - 3} v7" stroke="#ef4444" stroke-width="2"/>`; } },
    // --- body
    { id: 'cape', name: 'Cape', slot: 'body', draw: (a) => ({
      back: `<path d="M${a.bl - 6} ${a.neckY - 2} L${a.br + 6} ${a.neckY - 2} L${a.br + 15} ${a.bb + 12} Q${a.cx} ${a.bb + 20} ${a.bl - 15} ${a.bb + 12} Z" fill="#dc2626" stroke="#7f1d1d" stroke-width="2" stroke-linejoin="round"/>`,
      front: `<circle cx="${a.bl + 3}" cy="${a.neckY + 1}" r="3" fill="#fbbf24" stroke="#92400e" stroke-width="1.2"/><circle cx="${a.br - 3}" cy="${a.neckY + 1}" r="3" fill="#fbbf24" stroke="#92400e" stroke-width="1.2"/>` }) },
    { id: 'backpack', name: 'Backpack', slot: 'body', draw: (a) => ({
      back: `<rect x="${a.bl - 7}" y="${a.bt + 1}" width="${a.br - a.bl + 14}" height="${a.bb - a.bt - 1}" rx="7" fill="#f97316" stroke="#7c2d12" stroke-width="2.4"/><rect x="${a.bl - 3}" y="${a.bb - 11}" width="${a.br - a.bl + 6}" height="8" rx="3" fill="#fb923c" stroke="#7c2d12" stroke-width="1.6"/>`,
      front: `<path d="M${a.bl + 6} ${a.bt} L${a.bl + 8} ${a.bb - 3} M${a.br - 6} ${a.bt} L${a.br - 8} ${a.bb - 3}" stroke="#9a3412" stroke-width="3" stroke-linecap="round"/>` }) },
    { id: 'badge', name: 'ID badge', slot: 'body', draw: (a) => `<rect x="${a.bl + 4}" y="${a.bt + 4}" width="11" height="14" rx="2" fill="#fff" stroke="#334155" stroke-width="1.6"/><circle cx="${a.bl + 9.5}" cy="${a.bt + 9}" r="2.4" fill="#94a3b8"/><path d="M${a.bl + 6.5} ${a.bt + 14} h6 M${a.bl + 6.5} ${a.bt + 16.2} h4" stroke="#94a3b8" stroke-width="1.2" stroke-linecap="round"/><rect x="${a.bl + 7.5}" y="${a.bt + 1}" width="4" height="4" rx="1" fill="#475569"/>` },
    // --- held items (slot: side)
    { id: 'balloon', name: 'Balloon', slot: 'side', draw: (a) => { const x = a.sr + 8;
      return `<path d="M${a.sr - 2} ${a.bt + 6} Q${x - 6} ${a.bt - 14} ${x} 52" fill="none" stroke="#64748b" stroke-width="1.4"/><g class="bob-sway"><ellipse cx="${x}" cy="40" rx="9.5" ry="12" fill="#f472b6" stroke="#9d174d" stroke-width="2"/><path d="M${x - 3} 50.5 l3 4 l3 -4 z" fill="#9d174d"/><ellipse cx="${x - 3.5}" cy="35" rx="2.4" ry="4" fill="#fff" opacity=".5"/></g>`; } },
    { id: 'wrench', name: 'Wrench', slot: 'side', draw: (a) => { const x = a.sl - 1, y = a.bt + 8;
      return `<g class="rt" transform="rotate(35 ${x} ${y})"><rect x="${x - 3}" y="${y - 10}" width="6" height="24" rx="3" fill="#94a3b8" stroke="#334155" stroke-width="1.6"/><circle cx="${x}" cy="${y - 12}" r="6.5" fill="#94a3b8" stroke="#334155" stroke-width="1.6"/><rect x="${x - 2.4}" y="${y - 20}" width="4.8" height="8" fill="#e2e8f0"/></g>`; } },
    { id: 'pumpkin', name: 'Pumpkin lantern', slot: 'side', seasonal: ['halloween'], draw: (a) => { const x = a.sl - 3, y = a.bb - 3;
      return `<rect x="${x - 1.6}" y="${y - 15}" width="3.2" height="5" rx="1" fill="#15803d"/><ellipse cx="${x}" cy="${y - 2}" rx="12" ry="10" fill="#f97316" stroke="#9a3412" stroke-width="1.8"/><path d="M${x - 5} ${y - 11} Q${x - 8} ${y - 2} ${x - 5} ${y + 7} M${x + 5} ${y - 11} Q${x + 8} ${y - 2} ${x + 5} ${y + 7}" fill="none" stroke="#c2410c" stroke-width="1.2"/><polygon points="${pts([[x - 6, y - 6], [x - 2, y - 6], [x - 4, y - 2]])}" fill="#fde68a"/><polygon points="${pts([[x + 6, y - 6], [x + 2, y - 6], [x + 4, y - 2]])}" fill="#fde68a"/><path d="M${x - 6} ${y + 2} L${x - 3} ${y + 4} L${x} ${y + 2} L${x + 3} ${y + 4} L${x + 6} ${y + 2} L${x + 4} ${y + 6} L${x - 4} ${y + 6} Z" fill="#fde68a"/>`; } },
    { id: 'blossom', name: 'Blossom', slot: 'side', seasonal: ['spring'], draw: (a) => { const x = a.sr + 7, y = 48; let s = '';
      for (let i = 0; i < 5; i++) { const t = -Math.PI / 2 + i * Math.PI * 2 / 5; s += `<circle cx="${f(x + 5 * Math.cos(t))}" cy="${f(y + 5 * Math.sin(t))}" r="4.4" fill="#fbcfe8" stroke="#be185d" stroke-width="1.1"/>`; }
      return `<path d="M${a.sr - 1} ${a.bt + 8} Q${x - 4} ${a.bt - 8} ${x} ${y + 6}" fill="none" stroke="#15803d" stroke-width="2.4" stroke-linecap="round"/><g class="bob-sway">${s}<circle cx="${x}" cy="${y}" r="3.2" fill="#fde047" stroke="#a16207" stroke-width="1"/></g>`; } }
  ];
  const ACC_BY_ID = {};
  ACC.forEach((x) => { ACC_BY_ID[x.id] = x; });
  const SLOTS = [
    { id: 'head', name: 'Hats' }, { id: 'face', name: 'Face' }, { id: 'neck', name: 'Neck' }, { id: 'body', name: 'Back & body' }, { id: 'side', name: 'Holding' }
  ];
  const SEASON_LABEL = { christmas: 'Christmas', winter: 'Winter', spring: 'Spring', summer: 'Summer', autumn: 'Autumn', halloween: 'Halloween' };
  // What a robot wears on its own in each season (only in slots you left empty), when "seasonal extras" is on.
  const SEASON_AUTO = {
    christmas: ['santahat', 'snowscarf'], winter: ['snowscarf'], halloween: ['witchhat', 'pumpkin'],
    autumn: ['leaf'], spring: ['bunnyears', 'blossom'], summer: ['sunhat', 'sunglasses']
  };

  function season() {
    try {
      const t = window.ChowaniecTheme;
      if (t && typeof t.season === 'function') { const s = t.season(); if (s) return s; }
    } catch (e) { /* fall back to the date */ }
    const d = new Date(), m = d.getMonth() + 1, day = d.getDate();
    if (m === 12 && day <= 26) return 'christmas';
    if (m === 12 || m <= 2) return 'winter';
    if (m <= 5) return 'spring';
    if (m <= 8) return 'summer';
    if ((m === 10 && day >= 15) || (m === 11 && day <= 1)) return 'halloween';
    return 'autumn';
  }

  // ---------- choices
  const DEFAULT_PREFS = { type: 'bob', accessories: [], seasonal: true };
  const CACHE_KEY = 'chowaniec_robot';

  function norm(p) {
    const src = p || {};
    const type = ROBOT_BY_ID[src.type] ? src.type : 'bob';
    const bySlot = {};
    (Array.isArray(src.accessories) ? src.accessories : []).forEach((id) => { const a = ACC_BY_ID[id]; if (a) bySlot[a.slot] = id; });
    return { type, accessories: SLOTS.map((s) => bySlot[s.id]).filter(Boolean), seasonal: typeof src.seasonal === 'boolean' ? src.seasonal : true };
  }
  function prefs() {
    try { const raw = localStorage.getItem(CACHE_KEY); if (raw) return norm(JSON.parse(raw)); } catch (e) { /* no cache yet */ }
    return norm(DEFAULT_PREFS);
  }
  function effective(p) {
    const c = norm(p || prefs());
    const used = new Set(c.accessories.map((id) => ACC_BY_ID[id].slot));
    const list = c.accessories.slice();
    if (c.seasonal) (SEASON_AUTO[season()] || []).forEach((id) => { const a = ACC_BY_ID[id]; if (a && !used.has(a.slot)) { used.add(a.slot); list.push(id); } });
    return list;
  }
  function catalog() {
    return {
      robots: ROBOTS.map((r) => ({ id: r.id, name: r.name, blurb: r.blurb })),
      accessories: ACC.map((x) => (x.seasonal ? { id: x.id, name: x.name, slot: x.slot, seasonal: x.seasonal.slice() } : { id: x.id, name: x.name, slot: x.slot })),
      slots: SLOTS.map((s) => ({ ...s }))
    };
  }

  const user = () => (typeof window.getChowaniecUser === 'function' ? window.getChowaniecUser() : null);
  let pushTimer = null, pushWaiters = [];
  function save(partial) {
    const next = norm({ ...prefs(), ...(partial || {}) });
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch (e) { /* storage unavailable */ }
    window.dispatchEvent(new CustomEvent('chowaniec-robot-change', { detail: next }));
    return new Promise((resolve) => {
      pushWaiters.push(resolve);
      clearTimeout(pushTimer);
      pushTimer = setTimeout(async () => {
        const waiters = pushWaiters; pushWaiters = [];
        const u = user();
        if (u && u.key) {
          try {
            await fetch('/.netlify/functions/settings', {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Chowaniec-Key': u.key },
              body: JSON.stringify({ settings: { robot: prefs() } })
            });
          } catch (e) { /* the choice is still saved on this device */ }
        }
        waiters.forEach((r) => r(prefs()));
      }, 250);
    });
  }

  // Pulls this person's saved choice from their account (once per page load) so it follows them between devices.
  let synced = false;
  async function sync() {
    if (synced) return;
    const u = user();
    if (!u || !u.key) return;
    synced = true;
    try {
      const res = await fetch('/.netlify/functions/settings', { headers: { 'X-Chowaniec-Key': u.key }, cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.settings || !data.settings.robot) return;
      const remote = norm(data.settings.robot);
      if (JSON.stringify(remote) !== JSON.stringify(prefs())) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(remote)); } catch (e) { /* ignore */ }
        window.dispatchEvent(new CustomEvent('chowaniec-robot-change', { detail: remote }));
      }
    } catch (e) { /* offline: keep the cached choice */ }
  }

  // ---------- drawing
  function resolve(opts) {
    const o = opts || {};
    const base = prefs();
    const p = norm({
      type: o.robot || base.type,
      accessories: Array.isArray(o.accessories) ? o.accessories : base.accessories,
      seasonal: typeof o.seasonal === 'boolean' ? o.seasonal : base.seasonal
    });
    const robot = ROBOT_BY_ID[p.type];
    return { robot, prefs: p, worn: effective(p), season: season() };
  }
  function layersFor(worn, a) {
    const L = { back: '', neck: '', body: '', face: '', head: '', side: '' };
    worn.forEach((id) => {
      const acc = ACC_BY_ID[id];
      if (!acc) return;
      const out = acc.draw(a);
      if (typeof out === 'string') L[acc.slot] += out;
      else { L.back += out.back || ''; L[acc.slot] += out.front || ''; }
    });
    return L;
  }
  const hasHat = (worn) => worn.some((id) => ACC_BY_ID[id] && ACC_BY_ID[id].slot === 'head');

  const LAPTOP = `<g class="bob-laptop"><path d="M22 118 L30 100 H90 L98 118 Z" fill="#374151" stroke="#111827" stroke-width="2.5" stroke-linejoin="round"/>
    <rect x="14" y="118" width="92" height="7" rx="3.5" fill="#6b7280" stroke="#111827" stroke-width="2.5"/>
    <circle cx="60" cy="109" r="3" fill="#a78bfa"/></g>`;

  function mascotInner(cfg) {
    const r = cfg.robot.art(), a = cfg.robot.a, L = layersFor(cfg.worn, a);
    return `<g class="bob-body">${L.back}${r.back || ''}${r.torso}${r.arms}${r.ant || ''}${r.head}${L.neck}${L.body}${L.face}${L.head}${L.side}</g>${LAPTOP}<text class="bob-z" x="98" y="26" font-size="14" font-weight="700" fill="#7c3aed">z</text>`;
  }
  function faceInner(cfg) {
    const r = cfg.robot.art(), a = cfg.robot.a, L = layersFor(cfg.worn.filter((id) => ['head', 'face'].includes(ACC_BY_ID[id].slot)), a);
    return `${r.back || ''}${hasHat(cfg.worn) ? '' : (r.ant || '')}${r.head}${L.face}${L.head}`;
  }
  const FX_KIND = { christmas: 'snow', winter: 'snow', autumn: 'leaf', spring: 'petal', summer: 'spark', halloween: 'ember' };
  function fxInner(cfg) {
    const kind = cfg.prefs.seasonal ? FX_KIND[cfg.season] : null;
    if (!kind) return '';
    let s = '';
    for (let i = 0; i < 7; i++) s += `<i class="fx fx-${kind}" style="--x:${8 + i * 13}%;--d:${(i * 0.9).toFixed(1)}s;--t:${(3.6 + (i % 3) * 0.9).toFixed(1)}s;--r:${(i * 47) % 360}deg"></i>`;
    return s;
  }

  function mascot(opts) {
    const o = opts || {};
    const cfg = resolve(o);
    const live = o.live !== false && !o.robot && !o.accessories && typeof o.seasonal !== 'boolean';
    const name = cfg.robot.name;
    return `<div class="bob${live ? '' : ' bob-static'}" data-state="${o.state || 'asleep'}" data-robot="${cfg.robot.id}"${hasHat(cfg.worn) ? ' data-hat="1"' : ''}${live ? ' data-live="1"' : ''} role="button" tabindex="0" aria-label="${name}, the AI helper. Tap to wake.">
    <div class="bob-fx" aria-hidden="true">${fxInner(cfg)}</div>
    <div class="bob-bubbles" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="bob-say hidden" role="status"></div>
    <svg class="bob-svg" viewBox="0 0 120 130" aria-hidden="true" focusable="false">${mascotInner(cfg)}</svg></div>`;
  }
  const vb = (t) => { const q = t.split(' '); return `${q[0]} ${q[1]} ${q[2]} ${q[2]}`; };
  function face(cls, opts) {
    const o = opts || {};
    const cfg = resolve(o);
    const live = o.live !== false && !o.robot && !o.accessories && typeof o.seasonal !== 'boolean';
    return `<svg class="bob-face ${cls || ''}" viewBox="${vb(cfg.robot.a.face)}" data-robot="${cfg.robot.id}"${live ? ' data-live="1"' : ''} aria-hidden="true" focusable="false">${faceInner(cfg)}</svg>`;
  }

  // Redraws everything on the page that follows the saved choice.
  function refreshAll() {
    document.querySelectorAll('.bob[data-live]').forEach((el) => {
      const svg = el.querySelector('.bob-svg');
      if (!svg) return;
      const cfg = resolve({});
      el.dataset.robot = cfg.robot.id;
      if (hasHat(cfg.worn)) el.dataset.hat = '1'; else delete el.dataset.hat;
      svg.innerHTML = mascotInner(cfg);
      const fx = el.querySelector('.bob-fx');
      if (fx) fx.innerHTML = fxInner(cfg);
      el.classList.remove('bob-pop'); void el.offsetWidth; el.classList.add('bob-pop');
      setTimeout(() => el.classList.remove('bob-pop'), 700);
    });
    document.querySelectorAll('svg.bob-face[data-live]').forEach((el) => {
      const cfg = resolve({});
      el.setAttribute('viewBox', vb(cfg.robot.a.face));
      el.dataset.robot = cfg.robot.id;
      el.innerHTML = faceInner(cfg);
    });
  }
  window.addEventListener('chowaniec-robot-change', refreshAll);
  window.addEventListener('chowaniec-theme-change', refreshAll);
  window.addEventListener('storage', (e) => { if (e.key === CACHE_KEY) refreshAll(); });

  // ---------- the picker
  function mountPicker(host, options) {
    const opt = options || {};
    let work = prefs();
    let sayTimer = null, waveTimer = null;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    host.classList.add('rp');
    host.innerHTML = `
      <div class="rp-stage">
        <div class="rp-bot" id="rp-bot-${Math.random().toString(36).slice(2, 7)}"></div>
        <div class="rp-states" role="group" aria-label="Preview how it moves">
          <button type="button" data-st="asleep">Sleep</button><button type="button" data-st="listening">Listen</button><button type="button" data-st="thinking">Think</button><button type="button" data-st="talking">Talk</button>
        </div>
        <p class="rp-blurb" aria-live="polite"></p>
        <p class="rp-hint">Tap the robot to wave.</p>
      </div>
      <div class="rp-label">Choose a robot</div>
      <div class="rp-robots" role="radiogroup" aria-label="Robot"></div>
      <div class="rp-label">Accessories</div>
      <div class="rp-slots"></div>
      <label class="rp-seasonal"><input type="checkbox" role="switch" class="rp-season-sw"><span class="rp-track"></span>
        <span class="rp-seasonal-text"><strong>Seasonal extras</strong><small></small></span></label>`;
    const botBox = host.querySelector('.rp-bot');
    const blurb = host.querySelector('.rp-blurb');
    const robotsBox = host.querySelector('.rp-robots');
    const slotsBox = host.querySelector('.rp-slots');
    const sw = host.querySelector('.rp-season-sw');

    function bot() { return botBox.querySelector('.bob'); }
    function setState(state, text) {
      const b = bot();
      if (!b) return;
      clearTimeout(sayTimer);
      b.dataset.state = state;
      const say = b.querySelector('.bob-say');
      if (state === 'talking') {
        say.textContent = text || ROBOT_BY_ID[work.type].hello;
        say.classList.remove('hidden');
        sayTimer = setTimeout(() => { say.classList.add('hidden'); b.dataset.state = 'idle'; }, 3600);
      } else say.classList.add('hidden');
    }
    function drawBot(state) {
      botBox.innerHTML = mascot({ robot: work.type, accessories: work.accessories, seasonal: work.seasonal, live: false, state: state || 'idle' });
      const b = bot();
      b.setAttribute('aria-label', `${ROBOT_BY_ID[work.type].name}. Tap to see it wave.`);
      b.addEventListener('click', wave);
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wave(); } });
    }
    function wave() {
      clearTimeout(waveTimer);
      setState('listening');
      waveTimer = setTimeout(() => { setState('thinking'); waveTimer = setTimeout(() => setState('talking'), 1300); }, 700);
      if (window.ChowaniecHaptics) window.ChowaniecHaptics.tap('light');
    }
    function paintRobots() {
      robotsBox.innerHTML = ROBOTS.map((r) => `<button type="button" role="radio" class="rp-robot" data-robot="${r.id}" aria-checked="${r.id === work.type}" title="${esc(r.blurb)}">
        <span class="rp-thumb">${face('', { robot: r.id, accessories: [], seasonal: false, live: false })}</span><span class="rp-rname">${esc(r.name)}</span></button>`).join('');
    }
    function paintSlots() {
      const wornSlots = {};
      work.accessories.forEach((id) => { wornSlots[ACC_BY_ID[id].slot] = id; });
      slotsBox.innerHTML = SLOTS.map((s) => {
        const chips = ACC.filter((x) => x.slot === s.id).map((x) => {
          const tag = x.seasonal ? ` <em>${esc(SEASON_LABEL[x.seasonal[0]] || '')}</em>` : '';
          return `<button type="button" class="rp-chip" data-acc="${x.id}" aria-pressed="${wornSlots[s.id] === x.id}">${esc(x.name)}${tag}</button>`;
        }).join('');
        return `<div class="rp-slot" role="group" aria-label="${esc(s.name)}"><div class="rp-slot-name">${esc(s.name)}</div><div class="rp-chips"><button type="button" class="rp-chip rp-none" data-slot="${s.id}" aria-pressed="${!wornSlots[s.id]}">None</button>${chips}</div></div>`;
      }).join('');
    }
    function paintMeta() {
      const r = ROBOT_BY_ID[work.type];
      blurb.innerHTML = `<strong>${esc(r.name)}</strong> &middot; ${esc(r.blurb)}`;
      sw.checked = work.seasonal;
      host.querySelector('.rp-seasonal-text small').textContent = work.seasonal
        ? `Dresses up for the season and adds little decorations. Right now: ${SEASON_LABEL[season()] || season()}.`
        : 'Off: only the accessories you picked.';
    }
    function commit() {
      work = norm(work);
      paintMeta(); paintRobots(); paintSlots();
      const keep = bot() && bot().dataset.state;
      drawBot(keep === 'asleep' ? 'asleep' : 'idle');
      save(work);
      if (typeof opt.onChange === 'function') opt.onChange({ ...work });
    }
    host.addEventListener('click', (e) => {
      const rb = e.target.closest('[data-robot].rp-robot');
      if (rb) { work.type = rb.dataset.robot; commit(); setState('talking'); return; }
      const chip = e.target.closest('.rp-chip');
      if (chip) {
        if (chip.dataset.slot) work.accessories = work.accessories.filter((id) => ACC_BY_ID[id].slot !== chip.dataset.slot);
        else {
          const acc = ACC_BY_ID[chip.dataset.acc];
          const on = work.accessories.includes(acc.id);
          work.accessories = work.accessories.filter((id) => ACC_BY_ID[id].slot !== acc.slot);
          if (!on) work.accessories.push(acc.id);
        }
        commit();
        return;
      }
      const st = e.target.closest('[data-st]');
      if (st) { clearTimeout(waveTimer); setState(st.dataset.st); }
    });
    sw.addEventListener('change', () => { work.seasonal = sw.checked; commit(); });
    robotsBox.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const i = ROBOTS.findIndex((r) => r.id === work.type);
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      work.type = ROBOTS[(i + step + ROBOTS.length) % ROBOTS.length].id;
      commit();
      const next = robotsBox.querySelector(`[data-robot="${work.type}"]`);
      if (next) next.focus();
    });
    const onExternal = () => { work = prefs(); paintMeta(); paintRobots(); paintSlots(); drawBot('idle'); };
    window.addEventListener('chowaniec-robot-change', onExternal);

    paintMeta(); paintRobots(); paintSlots(); drawBot('asleep');
    // wake up shortly after opening, like a greeting
    setTimeout(() => { if (bot() && bot().dataset.state === 'asleep') setState('talking'); }, 500);
    return {
      destroy() { window.removeEventListener('chowaniec-robot-change', onExternal); clearTimeout(sayTimer); clearTimeout(waveTimer); host.innerHTML = ''; host.classList.remove('rp'); },
      refresh: onExternal,
      prefs: () => ({ ...work })
    };
  }

  window.ChowaniecRobot = { catalog, prefs, save, face, mascot, mountPicker, effective, season, refresh: refreshAll };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else sync();

  // The robot's own stylesheet comes with it, so every page that shows a robot looks right.
  if (!document.querySelector('link[href$="/robot.css"], link[href$="robot.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/robot.css';
    document.head.appendChild(link);
  }
})();
