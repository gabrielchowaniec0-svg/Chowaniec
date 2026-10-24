// Mini Golf: the two hand-designed 9-hole courses (world units; the ball has a radius of 6, the cup 11).
// Each hole: green polygon(s) (their edges are walls), tee, cup, par and its obstacles:
//   walls     open polylines (thick wooden or stone walls)       blocks   [x, y, w, h] boxes
//   posts     [x, y, r] round posts                                bumpers  [x, y, r] bouncy bumpers
//   sand / water  shapes: ['r', x, y, w, h] | ['e', cx, cy, rx, ry] | ['p', [[x, y]...]]
//   slopes    { s: shape, g: [ax, ay] } (constant push, units/s²)  hills    [x, y, r, k] (k > 0 bump, k < 0 bowl)
//   conveyors [x, y, w, h, dirX, dirY, speed]                      pipes    [ax, ay, bx, by, exitDegrees]
//   mill      { x, y, gap, period, phase } (windmill gate)         loop     { x, y, len } (entry line, heading up)
//   bridge    { kind: 'slide' | 'draw', x0, x1, y0, y1, bw, cx, amp, period, down }
(function () {
  'use strict';
  const oct = (x0, y0, x1, y1, c) => [[x0 + c, y1], [x1 - c, y1], [x1, y1 - c], [x1, y0 + c], [x1 - c, y0], [x0 + c, y0], [x0, y0 + c], [x0, y1 - c]];

  const garden = {
    id: 'garden', name: 'Garden', theme: 'garden', blurb: 'Flower beds, a windmill and a lily pond',
    holes: [
      { name: 'First Putt', par: 2, tee: [180, 510], cup: [180, 130],
        green: [[120, 560], [240, 560], [240, 230], [275, 195], [275, 95], [245, 65], [115, 65], [85, 95], [85, 195], [120, 230]],
        decor: [['flowers', 180, 600, 1.2]] },
      { name: 'Dog Leg', par: 2, tee: [120, 555], cup: [262, 118],
        green: [[60, 600], [180, 600], [180, 230], [320, 230], [320, 70], [150, 70], [60, 160]] },
      { name: 'Flower Hill', par: 2, tee: [180, 555], cup: [168, 112],
        green: oct(60, 60, 300, 600, 26),
        hills: [[200, 335, 78, 250]],
        posts: [[104, 205, 16], [256, 470, 16]] },
      { name: 'Sand Snake', par: 3, tee: [96, 606], cup: [252, 118],
        green: oct(40, 40, 320, 660, 22),
        walls: [[[40, 452], [222, 452]], [[320, 252], [138, 252]]],
        sand: [['e', 182, 352, 46, 24], ['e', 98, 120, 34, 20], ['e', 238, 566, 34, 19]] },
      { name: 'Windmill Lane', par: 3, tee: [180, 612], cup: [180, 126],
        green: [[90, 660], [270, 660], [270, 430], [250, 410], [250, 92], [220, 62], [140, 62], [110, 92], [110, 410], [90, 430]],
        mill: { x: 180, y: 345, gap: 40, period: 4.4, phase: 0.3 },
        walls: [[[112, 418], [158, 370]], [[248, 418], [202, 370]]],
        sand: [['e', 140, 200, 22, 16]] },
      { name: 'Lily Bridge', par: 3, tee: [180, 612], cup: [180, 122],
        green: oct(80, 60, 280, 660, 24),
        bridge: { kind: 'slide', x0: 80, x1: 280, y0: 300, y1: 382, bw: 66, cx: 180, amp: 64, period: 5.6 },
        sand: [['e', 124, 178, 26, 17]] },
      { name: 'Garden Slope', par: 3, tee: [108, 592], cup: [196, 118],
        green: oct(50, 60, 310, 640, 26),
        slopes: [{ s: ['r', 50, 236, 260, 206], g: [150, 0] }],
        water: [['e', 276, 340, 32, 76]],
        blocks: [[146, 478, 70, 22]] },
      { name: 'Hose Pipe', par: 3, tee: [120, 616], cup: [112, 132],
        green: [[40, 660], [200, 660], [200, 452], [40, 452]],
        green2: [[220, 472], [320, 472], [320, 112], [268, 60], [60, 60], [60, 212], [220, 212]],
        pipes: [[120, 492, 270, 428, -90]],
        posts: [[74, 546, 13], [166, 546, 13]] },
      { name: 'Loop the Loop', par: 3, tee: [180, 612], cup: [102, 118],
        green: [[100, 660], [260, 660], [260, 502], [212, 462], [212, 382], [300, 332], [300, 60], [60, 60], [60, 332], [148, 382], [148, 462], [100, 502]],
        loop: { x: 180, y: 452, len: 52 },
        bumpers: [[150, 176, 15], [254, 214, 15], [204, 106, 14]] }
    ]
  };

  const pirate = {
    id: 'pirate', name: 'Pirate Cove', theme: 'pirate', blurb: 'Planks, barrels, pipes and a drawbridge',
    holes: [
      { name: 'Plank Walk', par: 2, tee: [180, 572], cup: [180, 118],
        green: oct(60, 60, 300, 620, 24),
        water: [['r', 60, 232, 88, 226], ['r', 212, 232, 88, 226]],
        planks: [148, 232, 64, 226] },
      { name: 'Barrel Bumpers', par: 2, tee: [180, 572], cup: [180, 110],
        green: oct(60, 60, 300, 620, 30),
        bumpers: [[180, 332, 18], [112, 238, 16], [248, 238, 16], [128, 452, 16], [232, 452, 16]] },
      { name: 'Treasure Bowl', par: 2, tee: [180, 572], cup: [180, 172],
        green: [[120, 620], [240, 620], [300, 560], [300, 120], [240, 60], [120, 60], [60, 120], [60, 560]],
        walls: [[[132, 392], [228, 392]]],
        hills: [[180, 172, 70, -120]],
        sand: [['e', 96, 262, 22, 34], ['e', 264, 262, 22, 34]] },
      { name: 'Conveyor Dock', par: 3, tee: [180, 612], cup: [180, 118],
        green: oct(50, 60, 310, 660, 24),
        conveyors: [[50, 420, 212, 50, 1, 0, 170], [98, 250, 212, 50, -1, 0, 170]],
        water: [['e', 288, 445, 34, 54], ['e', 72, 275, 34, 54]] },
      { name: 'Barrel Pipes', par: 3, tee: [180, 612], cup: [244, 136],
        green: oct(40, 452, 320, 660, 18),
        green2: oct(40, 60, 320, 422, 22),
        pipes: [[90, 502, 92, 112, 90], [270, 502, 280, 372, -90]],
        sand: [['e', 250, 262, 40, 24], ['e', 160, 140, 26, 34]],
        posts: [[168, 262, 16], [180, 528, 15]] },
      { name: 'Windmill Fort', par: 3, tee: [180, 612], cup: [232, 128],
        green: oct(60, 60, 300, 660, 26),
        mill: { x: 180, y: 382, gap: 40, period: 4.0, phase: 1.1 },
        walls: [[[60, 382], [130, 382]], [[230, 382], [300, 382]]],
        water: [['e', 104, 150, 40, 44]] },
      { name: 'Sandbar Bay', par: 3, tee: [130, 612], cup: [226, 120],
        green: [[60, 660], [212, 660], [300, 572], [300, 60], [150, 60], [60, 150]],
        water: [['e', 112, 340, 46, 74]],
        slopes: [{ s: ['r', 60, 250, 240, 180], g: [-130, 0] }],
        sand: [['e', 236, 474, 32, 21], ['e', 150, 160, 32, 19]] },
      { name: 'Drawbridge', par: 3, tee: [180, 612], cup: [232, 116],
        green: oct(70, 60, 290, 660, 24),
        bridge: { kind: 'draw', x0: 70, x1: 290, y0: 300, y1: 376, bw: 72, cx: 180, period: 5.2, down: 0.62 },
        posts: [[112, 186, 15], [252, 210, 15], [190, 150, 13]] },
      { name: 'Treasure Island', par: 4, tee: [180, 632], cup: [104, 116],
        green: [[90, 680], [270, 680], [270, 532], [212, 492], [212, 412], [310, 362], [310, 50], [50, 50], [50, 362], [148, 412], [148, 492], [90, 532]],
        loop: { x: 180, y: 482, len: 52 },
        hills: [[104, 116, 60, -140]],
        water: [['e', 112, 262, 38, 40]],
        bumpers: [[262, 250, 16], [186, 150, 15]],
        sand: [['e', 236, 104, 34, 21]] }
    ]
  };

  window.GOLF_COURSES = [garden, pirate];
})();
