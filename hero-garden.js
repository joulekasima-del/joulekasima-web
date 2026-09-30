/*
  HERO GARDEN
  -----------
  Gentle motion for the inline SVG garden in the Hero section: three butterflies
  drifting on slow wandering paths (one occasionally settles by the text edge, then
  lifts off) and a songbird that crosses now and then. Leaf sprigs sway via CSS.

  Everything is decorative. The frame loop runs only while the hero is on screen and
  the tab is visible, at ~30fps, and never runs for visitors who prefer reduced
  motion (they get the static arrangement that's already in the markup).
*/

(function () {
  const svg = document.getElementById('heroGarden');
  if (!svg) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduce.matches) return;

  const bird = document.getElementById('gardenBird');
  const birdPos = document.getElementById('birdPos');
  const birdNear = document.getElementById('birdNear');
  const birdFar = document.getElementById('birdFar');
  const headline = document.querySelector('.hero-headline');

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);
  const fmt = (n) => n.toFixed(2);

  // Each butterfly wanders on a sum of two slow sines per axis (never faster than ~20px/s).
  const flies = [
    { cx: 190, cy: 250, ax: 95, ay: 62, bx: 26, by: 22, w: [0.11, 0.27, 0.09, 0.23], scale: 0.8 },
    { cx: 150, cy: 310, ax: 70, ay: 48, bx: 22, by: 18, w: [0.13, 0.31, 0.1, 0.29], scale: 0.62 },
    { cx: 215, cy: 180, ax: 80, ay: 44, bx: 24, by: 16, w: [0.09, 0.25, 0.12, 0.21], scale: 0.7 },
  ].map((f, i) => {
    const el = document.getElementById('bf' + i);
    return Object.assign(f, {
      el,
      wl: el.querySelector('.wl'),
      wr: el.querySelector('.wr'),
      p: [rand(0, TAU), rand(0, TAU), rand(0, TAU), rand(0, TAU)],
      flapPhase: rand(0, TAU),
      heading: 0,
      settle: 0, // 0 = wandering, 1 = resting at the edge
    });
  });

  // One butterfly at a time settles: approach -> rest -> lift off, then a long wait.
  const rest = { fly: null, stage: 'wait', at: rand(10, 18), sx: 12, sy: 200 };

  const birdState = { on: false, t0: 0, dur: 15, dir: 1, y: 40, next: rand(6, 12), phase: 0 };

  let T = 0;
  let last = 0;
  let lastDraw = 0;
  let raf = 0;
  let onScreen = false;

  function wander(f, t) {
    const [w1, w2, w3, w4] = f.w;
    const [p1, p2, p3, p4] = f.p;
    return {
      x: f.cx + f.ax * Math.sin(w1 * t + p1) + f.bx * Math.sin(w2 * t + p2),
      y: f.cy + f.ay * Math.sin(w3 * t + p3) + f.by * Math.sin(w4 * t + p4),
      vx: f.ax * w1 * Math.cos(w1 * t + p1) + f.bx * w2 * Math.cos(w2 * t + p2),
      vy: f.ay * w3 * Math.cos(w3 * t + p3) + f.by * w4 * Math.cos(w4 * t + p4),
    };
  }

  // Pick a resting spot just outside the right end of the headline (falls back to the hero edge).
  function pickRestSpot() {
    let x = 12;
    let y = rand(150, 300);
    try {
      const box = svg.getBoundingClientRect();
      const r = document.createRange();
      r.selectNodeContents(headline);
      const text = r.getBoundingClientRect();
      x = Math.min(60, Math.max(10, text.right - box.left + 10));
      y = Math.min(330, Math.max(90, rand(text.top, text.bottom) - box.top));
    } catch (e) { /* keep defaults */ }
    rest.sx = x;
    rest.sy = y;
  }

  function stepRest(dt) {
    if (rest.stage === 'wait') {
      if (T < rest.at) return;
      const pool = flies.filter((f) => f.settle === 0);
      rest.fly = pool[Math.floor(Math.random() * pool.length)];
      pickRestSpot();
      rest.stage = 'approach';
      rest.t = 0;
      rest.len = 6;
    } else if (rest.stage === 'approach') {
      rest.t += dt;
      rest.fly.settle = ease(Math.min(1, rest.t / rest.len));
      if (rest.t >= rest.len) { rest.stage = 'rest'; rest.t = 0; rest.len = rand(6, 10); }
    } else if (rest.stage === 'rest') {
      rest.t += dt;
      if (rest.t >= rest.len) { rest.stage = 'lift'; rest.t = 0; rest.len = 4; }
    } else if (rest.stage === 'lift') {
      rest.t += dt;
      rest.fly.settle = 1 - ease(Math.min(1, rest.t / rest.len));
      if (rest.t >= rest.len) { rest.fly.settle = 0; rest.stage = 'wait'; rest.at = T + rand(25, 45); }
    }
  }

  function drawFly(f, dt) {
    const w = wander(f, T);
    const e = f.settle;
    const x = lerp(w.x, f === rest.fly ? rest.sx : w.x, e);
    const y = lerp(w.y, f === rest.fly ? rest.sy : w.y, e);

    // Soft heading: follows the drift direction, eased, and levels out when resting.
    const target = lerp((Math.atan2(w.vx, -w.vy) * 180) / Math.PI * 0.6, 8, e);
    let d = target - f.heading;
    d = ((d + 540) % 360) - 180;
    f.heading += d * (1 - Math.exp(-dt * 2.5));

    // Wings open and close slowly; slower and mostly open while resting.
    f.flapPhase += dt * TAU * lerp(0.55, 0.14, e);
    const open = 0.5 + 0.5 * Math.cos(f.flapPhase);
    const sx = lerp(0.26, 0.6, e) + (1 - lerp(0.26, 0.6, e)) * open;

    f.el.setAttribute('transform', 'translate(' + fmt(x) + ' ' + fmt(y) + ') rotate(' + fmt(f.heading) + ') scale(' + f.scale + ')');
    const wing = 'scale(' + fmt(sx) + ' 1)';
    f.wl.setAttribute('transform', wing);
    f.wr.setAttribute('transform', wing);
  }

  function drawBird(dt) {
    const b = birdState;
    if (!b.on) {
      if (T >= b.next) {
        b.on = true;
        b.t0 = T;
        b.dir = Math.random() < 0.5 ? 1 : -1;
        b.y = rand(32, 46);
        b.dur = rand(14, 18);
        b.phase = 0;
        bird.style.visibility = 'visible';
      } else {
        return;
      }
    }
    const u = (T - b.t0) / b.dur;
    if (u >= 1) {
      b.on = false;
      b.next = T + rand(35, 60);
      bird.style.visibility = 'hidden';
      return;
    }
    const x = b.dir > 0 ? lerp(-40, 380, u) : lerp(380, -40, u);
    const y = b.y + 6 * Math.sin(u * TAU * 1.5);

    // Bursts of slow wingbeats between long glides.
    const cycle = (T - b.t0) % 6;
    const burst = cycle < 2.6 ? Math.sin((cycle / 2.6) * Math.PI) : 0;
    b.phase += dt * TAU * 1.7 * burst;
    const beat = Math.cos(b.phase) * 0.9 - 0.05;
    const ws = lerp(0.55, beat, Math.min(1, burst * 3));

    birdPos.setAttribute('transform', 'translate(' + fmt(x) + ' ' + fmt(y) + ') scale(' + fmt(0.75 * b.dir) + ' 0.75)');
    birdNear.setAttribute('transform', 'translate(0 -3) scale(1 ' + fmt(ws * 0.7) + ')');
    birdFar.setAttribute('transform', 'translate(-4 -3) scale(1 ' + fmt(ws * 0.5) + ')');
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (now - lastDraw < 33) return; // ~30fps is plenty for this pace
    lastDraw = now;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    T += dt;
    stepRest(dt);
    flies.forEach((f) => drawFly(f, dt));
    drawBird(dt);
  }

  function sync() {
    const run = onScreen && !document.hidden && !reduce.matches;
    svg.classList.toggle('is-paused', !run);
    if (run && !raf) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    } else if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  // The bird starts hidden; the static arrangement in the markup is for reduced-motion only.
  bird.style.visibility = 'hidden';

  new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    sync();
  }).observe(svg);
  document.addEventListener('visibilitychange', sync);
  reduce.addEventListener('change', sync);
})();
