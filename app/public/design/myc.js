/* REP Labs v4. The mycelium: fine ink threads that grow toward each other.
   Everything is generated here, no images. Respects prefers-reduced-motion. */
(function () {
  "use strict";
  var STILL = /[?&](still|state=)/.test(location.search);
  var RM = STILL || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (STILL) document.documentElement.classList.add("still");
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var INK = "19,19,22", BLUE = "59,91,255";

  function rng(seed) {
    var s = (seed * 2654435761) >>> 0 || 1;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /* one hypha from a to b: a wandering line plus short side branches */
  function hypha(r, ax, ay, bx, by, o) {
    o = o || {};
    var dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    var N = Math.max(10, Math.round(L / 5));
    var amp = (o.amp == null ? .09 : o.amp) * L, p1 = r() * 6.28, p2 = r() * 6.28, f1 = .8 + r() * 1.4, f2 = 2.5 + r() * 3;
    var pts = [];
    for (var i = 0; i <= N; i++) {
      var t = i / N, env = Math.sin(Math.PI * t);
      var off = env * (amp * .75 * Math.sin(p1 + t * Math.PI * f1) + amp * .25 * Math.sin(p2 + t * Math.PI * f2));
      if (i > 0 && i < N) off += (r() - .5) * Math.min(L * .012, 2.2);
      pts.push([ax + dx * t + nx * off, ay + dy * t + ny * off]);
    }
    var br = [], nb = o.branches == null ? Math.round(L / 46) : o.branches;
    for (var k = 0; k < nb; k++) {
      var bt = .1 + r() * .8, j = Math.round(bt * N), q = pts[j], q2 = pts[Math.min(N, j + 1)];
      var ang = Math.atan2(q2[1] - q[1], q2[0] - q[0]) + (r() < .5 ? -1 : 1) * (.45 + r() * .7);
      var len = Math.min(L * (.05 + r() * .1), 46) * (o.blen || 1), steps = 7, curl = (r() - .5) * .45, cx = q[0], cy = q[1], bp = [[cx, cy]];
      for (var s = 0; s < steps; s++) { ang += curl + (r() - .5) * .35; cx += Math.cos(ang) * len / steps; cy += Math.sin(ang) * len / steps; bp.push([cx, cy]); }
      br.push({ t: bt, pts: bp, fork: r() < .45 ? fork(r, bp, len) : null });
    }
    return { pts: pts, br: br, L: L };
  }
  function fork(r, bp, len) {
    var q = bp[3], q2 = bp[4], ang = Math.atan2(q2[1] - q[1], q2[0] - q[0]) + (r() < .5 ? -1 : 1) * (.6 + r() * .5);
    var out = [[q[0], q[1]]], cx = q[0], cy = q[1];
    for (var s = 0; s < 4; s++) { ang += (r() - .5) * .4; cx += Math.cos(ang) * len * .1; cy += Math.sin(ang) * len * .1; out.push([cx, cy]); }
    return out;
  }

  function stroke(ctx, pts, a, b) {
    var n = pts.length - 1; if (n < 1 || b <= a) return;
    var i0 = a * n, i1 = b * n, s = Math.floor(i0), e = Math.ceil(i1);
    ctx.beginPath();
    for (var i = s; i <= e && i <= n; i++) {
      var x = pts[i][0], y = pts[i][1];
      if (i === s && i0 > s) { var f = i0 - s; x = pts[s][0] + (pts[s + 1][0] - pts[s][0]) * f; y = pts[s][1] + (pts[s + 1][1] - pts[s][1]) * f; }
      if (i === e && i1 < e) { var g = 1 - (e - i1); x = pts[e - 1][0] + (pts[e][0] - pts[e - 1][0]) * g; y = pts[e - 1][1] + (pts[e][1] - pts[e - 1][1]) * g; }
      if (i === s) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  /* draw a hypha grown to p. meet=true grows from both ends toward the middle */
  function drawH(ctx, h, p, o) {
    if (p <= 0) return;
    o = o || {};
    var w = o.w || .8, col = o.col || INK, al = o.a == null ? .7 : o.a, strands = o.strands || 1;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (var k = 0; k < strands; k++) {
      var off = strands > 1 ? (k - (strands - 1) / 2) * 1.5 : 0;
      ctx.save(); if (off) ctx.translate(off * .6, off);
      ctx.strokeStyle = "rgba(" + col + "," + (k === 0 ? al : al * .55) + ")"; ctx.lineWidth = k === 0 ? w : w * .7;
      if (o.meet) { stroke(ctx, h.pts, 0, p / 2); stroke(ctx, h.pts, 1 - p / 2, 1); }
      else stroke(ctx, h.pts, 0, p);
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(" + col + "," + al * .75 + ")"; ctx.lineWidth = w * .6;
    for (var i = 0; i < h.br.length; i++) {
      var b = h.br[i], seen = o.meet ? (b.t < .5 ? p / 2 - b.t : b.t - (1 - p / 2)) : p - b.t;
      var bp = clamp(seen * 5, 0, 1);
      if (bp > 0) { stroke(ctx, b.pts, 0, bp); if (b.fork && bp > .5) stroke(ctx, b.fork, 0, (bp - .5) * 2); }
    }
  }
  function at(pts, t) { var n = pts.length - 1, f = clamp(t, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)); f -= i; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]; }
  /* a nutrient pulse travelling along a thread: a soft halo and a bright core */
  function pulse(ctx, pts, t, col, r, a) {
    var p = at(pts, t), R = r * 5, g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], R), al = a == null ? 1 : a;
    g.addColorStop(0, "rgba(" + col + "," + .32 * al + ")"); g.addColorStop(1, "rgba(" + col + ",0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p[0], p[1], R, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "rgba(" + col + "," + al + ")"; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 6.2832); ctx.fill();
  }
  function onScreen(el, fn) {
    if (!("IntersectionObserver" in window)) return fn(true);
    new IntersectionObserver(function (es) { fn(es[0].isIntersecting); }, { rootMargin: "80px" }).observe(el);
  }
  function dot(ctx, x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fillStyle = fill; ctx.fill(); }

  function setup(cv) {
    var w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * DPR) || cv.height !== Math.round(h * DPR)) { cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR); }
    var ctx = cv.getContext("2d"); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  /* a field of nodes, each joined to its nearest neighbours, every thread growing toward the other end */
  function field(seed, w, h, density, o) {
    o = o || {};
    var r = rng(seed), n = Math.max(6, Math.round(w * h / density)), nodes = [], th = [];
    for (var i = 0; i < n; i++) {
      var x = r() * w, y = r() * h;
      if (o.avoid && Math.hypot(x - o.avoid[0], y - o.avoid[1]) < o.avoid[2]) { i--; n--; continue; }
      nodes.push({ x: x, y: y, ag: r() < (o.agents || 0), d: r() * .55 });
    }
    if (o.extra) o.extra.forEach(function (e) { nodes.push({ x: e[0], y: e[1], ag: !!e[2], d: 0, fixed: true }); });
    var seen = {};
    nodes.forEach(function (a, ia) {
      var near = nodes.map(function (b, ib) { return [Math.hypot(a.x - b.x, a.y - b.y), ib]; }).sort(function (p, q) { return p[0] - q[0]; });
      for (var k = 1; k <= (o.k || 2) && k < near.length; k++) {
        var ib = near[k][1], key = ia < ib ? ia + "_" + ib : ib + "_" + ia;
        if (seen[key]) continue; seen[key] = 1;
        var b = nodes[ib];
        th.push({ h: hypha(r, a.x, a.y, b.x, b.y, { amp: .14 }), d: Math.min(a.d, b.d) + r() * .25 });
      }
      if (o.tips) for (var t = 0; t < o.tips; t++) {
        var ang = r() * 6.28, len = 20 + r() * 60;
        th.push({ h: hypha(r, a.x, a.y, a.x + Math.cos(ang) * len, a.y + Math.sin(ang) * len, { amp: .25, branches: 1 }), d: a.d + .1 + r() * .3, tip: true });
      }
    });
    return { nodes: nodes, th: th };
  }
  function drawField(ctx, F, P, o) {
    o = o || {};
    F.th.forEach(function (t) {
      var p = clamp((P - t.d) / .45, 0, 1);
      drawH(ctx, t.h, ease(p), { meet: !t.tip, a: o.a || .2, w: o.w || .7 });
    });
    F.nodes.forEach(function (n) {
      var p = clamp((P - n.d) / .15, 0, 1); if (p <= 0 || n.fixed) return;
      ctx.globalAlpha = p;
      if (n.ag) { ctx.strokeStyle = "rgba(" + INK + "," + (o.na || .35) + ")"; ctx.lineWidth = .8; ctx.strokeRect(n.x - 2.5, n.y - 2.5, 5, 5); }
      else dot(ctx, n.x, n.y, 1.6, "rgba(" + INK + "," + (o.na || .35) + ")");
      ctx.globalAlpha = 1;
    });
  }

  /* ---------- 1. the living field: behind the home statement, and quietly behind every page head ---------- */
  function living(cv, o) {
    o = o || {};
    var F, E = [], PU = [], P = RM ? .8 : .22, t0 = null, raf = null, vis = true, grow = RM ? 1 : 0, ptr = null, reach = null, rp = 0;
    function build() {
      var s = setup(cv), cr = cv.getBoundingClientRect(), r = rng(o.seed || 23);
      F = field(o.seed || 11, s.w, s.h, o.density || 30000, { tips: 1, agents: .2 });
      E = [];
      var st = o.statement && document.querySelector(".statement");
      if (st) {
        var b = st.getBoundingClientRect(), L = b.left - cr.left, R = Math.min(b.right - cr.left, s.w * .78), T = b.top - cr.top, B = b.bottom - cr.top, my = (T + B) / 2;
        var ends = s.w < 700
          ? [[[s.w + 4, T + 10], [s.w * .82, T + 2]], [[s.w + 4, B - 30], [s.w * .74, B + 18]], [[-4, s.h - 10], [L + 30, B + 22]]]
          : [[[s.w + 4, s.h * .16], [R + 40, T + 30]], [[s.w + 4, s.h * .78], [R + 26, my + 40]], [[s.w * .7, -4], [R - 40, T - 26]], [[-4, s.h - 6], [L + 80, B + 20]]];
        E = ends.map(function (e) { return hypha(r, e[0][0], e[0][1], e[1][0], e[1][1], { amp: .12, branches: 4, blen: 1.3 }); });
      }
      var main = F.th.filter(function (t) { return !t.tip; });
      PU = [];
      for (var i = 0; i < (o.pulses || 16) && main.length; i++) PU.push({ t: main[Math.floor(r() * main.length)], ph: r(), sp: .1 + r() * .16, blue: r() < .38, back: r() < .5 });
      E.forEach(function (h, i) { PU.push({ h: h, ph: i * .27, sp: .12, blue: i === 0 }); });
    }
    function draw(ts) {
      var s = setup(cv), c = s.ctx, T = (ts || 0) / 1000;
      drawField(c, F, P, { a: o.a || .26, na: .42, w: .75 });
      E.forEach(function (h, i) {
        var p = ease(clamp(grow * 1.25 - i * .08, 0, 1));
        drawH(c, h, p, { a: .62, w: 1 });
        if (p >= 1) { var q = h.pts[h.pts.length - 1]; dot(c, q[0], q[1], 2.2 + (i === 0 ? Math.sin(T * 2.2) * .5 : 0), i === 0 ? "rgb(" + BLUE + ")" : "rgba(" + INK + ",.7)"); }
      });
      if (!RM) PU.forEach(function (u) {
        var pts = u.h ? u.h.pts : u.t.h.pts, ready = u.h ? grow >= 1 : P - u.t.d > .45;
        if (!ready) return;
        var x = (T * u.sp + u.ph) % 1, fade = Math.sin(Math.PI * x);
        pulse(c, pts, u.back ? 1 - x : x, u.blue ? BLUE : INK, u.blue ? 1.9 : 1.3, (u.blue ? .95 : .5) * fade);
      });
      if (reach && rp > 0) {
        drawH(c, reach, ease(rp), { a: .55, w: .85, col: BLUE });
        if (rp > .98) { var e = reach.pts[reach.pts.length - 1]; dot(c, e[0], e[1], 2, "rgba(" + BLUE + ",.9)"); }
      }
    }
    function target() {
      if (!o.statement) return 1;
      var r = cv.getBoundingClientRect(); return .5 + .5 * clamp(-r.top / Math.max(1, r.height * .8), 0, 1);
    }
    function tick(ts) {
      if (t0 == null) t0 = ts;
      var intro = clamp((ts - t0) / 4200, 0, 1), goal = Math.max((o.statement ? .55 : .9) * ease(intro), intro >= 1 ? target() : 0);
      grow = clamp((ts - t0) / 2400, 0, 1); P += (goal - P) * .06;
      rp += ((ptr ? 1 : 0) - rp) * .05;
      draw(ts);
      raf = vis ? requestAnimationFrame(tick) : null;
    }
    /* a thread reaches from the nearest node toward the pointer, and lets go when it leaves */
    function reachTo(x, y) {
      var best = null, bd = 1e9;
      F.nodes.forEach(function (n) { var d = Math.hypot(n.x - x, n.y - y); if (d < bd && d > 30) { bd = d; best = n; } });
      if (!best || bd > 260) { ptr = null; return; }
      if (reach && ptr && Math.hypot(ptr[0] - x, ptr[1] - y) < 40) return;
      ptr = [x, y]; rp = 0; reach = hypha(rng(Math.round(x * 7 + y)), best.x, best.y, x, y, { amp: .16, branches: 2 });
    }
    build(); draw(0);
    if (RM) return;
    onScreen(cv, function (v) { vis = v; if (v && !raf) raf = requestAnimationFrame(tick); });
    if (o.pointer && window.matchMedia("(hover: hover)").matches) {
      var host = cv.parentNode;
      host.addEventListener("pointermove", function (e) { var r = cv.getBoundingClientRect(); reachTo(e.clientX - r.left, e.clientY - r.top); });
      host.addEventListener("pointerleave", function () { ptr = null; });
    }
    window.addEventListener("resize", function () { build(); draw(0); });
  }

  /* a single thread along the footer rule, grown once it is seen */
  function footThread(foot) {
    var cv = document.createElement("canvas"); cv.className = "foot-field"; cv.setAttribute("aria-hidden", "true"); foot.insertBefore(cv, foot.firstChild);
    var s = setup(cv), r = rng(61), h = hypha(r, 0, 24, s.w, 24, { amp: .012, branches: Math.round(s.w / 70), blen: .5 }), t0 = null;
    function draw(p, T) { var c = setup(cv).ctx; drawH(c, h, p, { a: .5, w: .8 }); if (p >= 1 && T != null && !RM) pulse(c, h.pts, (T / 9) % 1, BLUE, 1.6, .9); }
    if (RM) return draw(1);
    draw(0);
    onScreen(cv, function (v) {
      if (!v) return;
      (function step(ts) { if (t0 == null) t0 = ts; var t = (ts - t0) / 1000; draw(ease(clamp(t / 2.4, 0, 1)), t); requestAnimationFrame(step); })(performance.now());
    });
  }

  /* ---------- 2. the graph explainer ---------- */
  var KEYS = ["lit", "verdict", "ctx", "ask", "thick", "field"];
  var STATES = [
    { lit: 1, verdict: 1, ctx: 0, ask: 0, thick: 0, field: 0 },
    { lit: 1, verdict: 1, ctx: 1, ask: 0, thick: 0, field: 0 },
    { lit: 1, verdict: 1, ctx: 1, ask: 1, thick: 0, field: 0 },
    { lit: 1, verdict: 1, ctx: 1, ask: 1, thick: 1, field: 0 },
    { lit: 1, verdict: 1, ctx: 1, ask: 1, thick: 1, field: 1 }
  ];
  var ZERO = { lit: 0, verdict: 0, ctx: 0, ask: 0, thick: 0, field: 0 };
  var CTX = [["travel", 196], ["music", 146], ["ai", 238], ["games", 22], ["rides", 96]];

  function scene(w, h) {
    var r = rng(7), u = Math.min(w, h * 1.25);
    var P = [w * .42, h * .6], A = [w * .86, h * .3], V = [w * .42, h * .13];
    var ctx = CTX.map(function (c, i) {
      var a = c[1] * Math.PI / 180, d = u * (.24 + (i % 2) * .05);
      var x = P[0] + Math.cos(a) * d, y = P[1] + Math.sin(a) * d * .9;
      return { name: c[0], x: x, y: y, h: hypha(r, P[0], P[1], x, y, { amp: .16, branches: 2 }) };
    });
    var Q = [[.86, .86], [.1, .22], [.12, .9], [.68, .07]].map(function (q) { return [w * q[0], h * q[1]]; });
    var G2 = [w * .05, h * .58], G3 = [w * .63, h * .93];
    var F = field(5, w, h, 9000, { k: 2, agents: .25, avoid: [P[0], P[1], u * .14], extra: [[P[0], P[1]], [A[0], A[1], 1]].concat(Q).concat([[G2[0], G2[1], 1], [G3[0], G3[1], 1]]) });
    function H(a, b, o) { return hypha(r, a[0], a[1], b[0], b[1], o || { amp: .12, branches: 2 }); }
    var bridges = [[A, Q[0]], [A, Q[3]], [G2, Q[1]], [G2, Q[2]], [G2, P], [G3, Q[0]], [G3, P]].map(function (p, i) { return { h: H(p[0], p[1]), d: i * .06 }; });
    var tufts = [];
    Q.forEach(function (q, i) { for (var k = 0; k < 3; k++) { var a = r() * 6.28, l = u * (.05 + r() * .05); tufts.push({ h: H(q, [q[0] + Math.cos(a) * l, q[1] + Math.sin(a) * l], { amp: .2, branches: 1 }), d: .1 + i * .05 }); } });
    return {
      P: P, A: A, V: V, u: u, ctx: ctx, F: F, Q: Q, G: [G2, G3], bridges: bridges, tufts: tufts,
      verdict: hypha(r, P[0], P[1] - 10, V[0], V[1] + 16, { amp: .05, branches: 1 }),
      ask: hypha(r, A[0] - 8, A[1] + 4, P[0] + 10, P[1] - 4, { amp: .1, branches: 3 })
    };
  }
  function label(c, txt, x, y, o) {
    o = o || {};
    c.font = (o.size || 11) + "px 'Geist Mono', ui-monospace, Menlo, monospace";
    c.fillStyle = o.col || "rgba(" + INK + ",.62)"; c.textAlign = o.align || "center"; c.textBaseline = "middle";
    c.globalAlpha = o.a == null ? 1 : o.a;
    var tw = c.measureText(txt).width, cw = c.canvas.clientWidth || 9999, lx = o.align === "left" ? x : o.align === "right" ? x - tw : x - tw / 2;
    var nx = clamp(lx, 6, cw - 6 - tw); x += nx - lx; lx = nx;
    if (o.bg !== false) {
      c.fillStyle = "rgba(246,244,239,.92)"; c.fillRect(lx - 3, y - (o.size || 11) * .62, tw + 6, (o.size || 11) * 1.24);
      c.fillStyle = o.col || "rgba(" + INK + ",.62)";
    }
    c.fillText(txt, x, y); c.globalAlpha = 1;
  }
  function drawScene(cv, S, v, T) {
    var s = setup(cv), c = s.ctx, P = S.P, A = S.A, V = S.V, u = S.u, sm = s.w < 520;
    var fs = sm ? 10 : 11;
    /* 5: the field, many people and agents */
    if (v.field > 0) {
      drawField(c, S.F, v.field, { a: .2, na: .32, w: .7 });
      S.tufts.forEach(function (t) { drawH(c, t.h, ease(clamp((v.field - t.d) / .6, 0, 1)), { a: .55, w: .8 }); });
      S.bridges.forEach(function (b) { drawH(c, b.h, ease(clamp((v.field - b.d) / .6, 0, 1)), { a: .62, w: .95, meet: true }); });
      var fa = clamp(v.field * 2, 0, 1);
      S.Q.forEach(function (q) { dot(c, q[0], q[1], 4.2, "rgba(" + INK + "," + .8 * fa + ")"); });
      c.globalAlpha = fa; c.fillStyle = "#F6F4EF"; c.strokeStyle = "rgba(" + INK + ",.85)"; c.lineWidth = 1;
      S.G.forEach(function (g) { c.fillRect(g[0] - 5, g[1] - 5, 10, 10); c.strokeRect(g[0] - 5, g[1] - 5, 10, 10); });
      c.globalAlpha = 1;
    }
    /* 2: other contexts, same person */
    S.ctx.forEach(function (k, i) {
      var p = clamp(v.ctx * 1.4 - i * .08, 0, 1);
      if (p <= 0) return;
      drawH(c, k.h, ease(p), { a: .75, w: .9 });
      if (p > .9) { dot(c, k.x, k.y, 2.4, "rgba(" + INK + ",.75)"); label(c, k.name, k.x, k.y + (k.y > P[1] ? 14 : -13), { size: fs, a: (p - .9) * 10 }); }
    });
    /* 3 + 4: the agent's thread */
    if (v.ask > 0) {
      drawH(c, S.ask, ease(v.ask), { a: .8, w: .9 + v.thick * .9, strands: v.thick > .4 ? 3 : 1, col: v.thick > .5 ? BLUE : INK });
      c.strokeStyle = "rgba(" + INK + ",.9)"; c.lineWidth = 1.1; c.fillStyle = "#F6F4EF";
      c.globalAlpha = clamp(v.ask * 3, 0, 1); c.fillRect(A[0] - 7, A[1] - 7, 14, 14); c.strokeRect(A[0] - 7, A[1] - 7, 14, 14); c.globalAlpha = 1;
      if (v.field > .5) label(c, "one agent, many people", A[0], A[1] - 22, { size: fs, a: (v.field - .5) * 2 });
      else if (v.thick > .5) label(c, "agent · track record", A[0], A[1] - 22, { size: fs });
      else label(c, "an agent", A[0], A[1] - 22, { size: fs, a: clamp(v.ask * 3, 0, 1) });
      var mid = S.ask.pts[Math.round(S.ask.pts.length * .5)];
      if (v.ask > .95 && v.thick < .5) label(c, (sm ? "asks one question" : "asks one question"), mid[0] + 14, mid[1] + 22, { size: fs, a: 1 - v.thick * 2, align: "left", col: "rgba(" + BLUE + ",1)" });
      if (v.thick > .5) {
        label(c, "stay booked. outcome, proven", mid[0] + 14, mid[1] + 22, { size: fs, a: (v.thick - .5) * 2 * (1 - v.field), align: "left", col: "rgba(" + BLUE + ",1)" });
      }
    }
    /* 1: one fact, only the verdict leaves */
    drawH(c, S.verdict, ease(v.verdict), { a: .85, w: 1, col: v.lit > .5 ? BLUE : INK });
    if (v.verdict > .9) {
      c.font = fs + "px 'Geist Mono', ui-monospace, Menlo, monospace"; var bw = c.measureText("hotel stays · tier 4 of 5").width + 24, bh = 28, va = (v.verdict - .9) * 10;
      c.globalAlpha = va; c.fillStyle = "#FFFFFF"; c.fillRect(V[0] - bw / 2, V[1] - bh / 2, bw, bh);
      c.strokeStyle = "rgba(" + BLUE + ",.9)"; c.lineWidth = 1; c.strokeRect(V[0] - bw / 2 + .5, V[1] - bh / 2 + .5, bw - 1, bh - 1); c.globalAlpha = 1;
      label(c, "hotel stays · tier 4 of 5", V[0], V[1] + .5, { size: fs, col: "rgba(" + BLUE + ",1)", a: va, bg: false });
      label(c, "only this leaves", V[0], V[1] - 26, { size: fs - 1, a: va * (1 - v.field) });
    }
    /* pulses: nutrients moving through the threads */
    if (T != null && !RM) {
      var tt = T / 1000;
      S.ctx.forEach(function (k, i) { if (v.ctx * 1.4 - i * .08 >= 1) pulse(c, k.h.pts, 1 - ((tt * .32 + i * .21) % 1), INK, 1.5, .55); });
      if (v.verdict >= 1 && v.field < .5) pulse(c, S.verdict.pts, (tt * .55) % 1, BLUE, 2.2, 1);
      if (v.ask >= 1) { var q = (tt * .42) % 1; pulse(c, S.ask.pts, v.thick > .5 ? 1 - q : q, BLUE, 2 + v.thick, 1); if (v.thick > .5) pulse(c, S.ask.pts, (q + .5) % 1, INK, 1.6, .6); }
      if (v.field >= 1) S.bridges.forEach(function (b, i) { pulse(c, b.h.pts, (tt * .2 + i * .17) % 1, i % 3 ? INK : BLUE, 1.4, .6); });
    }
    /* the person */
    var pr = 6.5, br = T != null && !RM ? Math.sin(T / 520) * 1.6 : 0;
    c.beginPath(); c.arc(P[0], P[1], pr + 7 + br, 0, 6.2832); c.strokeStyle = "rgba(" + BLUE + "," + (.35 * v.lit) + ")"; c.lineWidth = 1; c.stroke();
    dot(c, P[0], P[1], pr, v.lit > .5 ? "rgb(" + BLUE + ")" : "rgba(" + INK + ",.85)");
    label(c, "a person", P[0], P[1] + 26, { size: fs });
    if (v.ctx < .5) label(c, "bookings, amounts, places, dates stay on the phone", P[0], P[1] + 44, { size: fs - 1, a: v.lit * (1 - v.ctx * 2), col: "rgba(" + INK + ",.45)" });
  }

  function explainer(root) {
    var big = root.querySelector(".x-canvas"), steps = [].slice.call(root.querySelectorAll(".x-step"));
    var S = null, cur = Object.assign({}, ZERO), goal = STATES[0], raf = null, idx = -1;
    var forced = (location.search.match(/state=(\d)/) || [])[1];
    function sizeScene() { S = scene(big.clientWidth, big.clientHeight); }
    function frame() {
      var moving = false;
      KEYS.forEach(function (k) { var d = goal[k] - cur[k]; if (Math.abs(d) > .002) { cur[k] += RM ? d : d * .055 + Math.sign(d) * .004; if (Math.abs(goal[k] - cur[k]) < .004) cur[k] = goal[k]; moving = true; } });
      drawScene(big, S, cur, performance.now());
      raf = (moving || live) && !RM ? requestAnimationFrame(frame) : null;
    }
    var live = false;
    function set(i) {
      if (i === idx) return; idx = i; goal = STATES[i];
      big.parentNode.setAttribute("data-n", "0" + (i + 1)); big.parentNode.style.setProperty("--xp", ((i + 1) / 5).toFixed(2));
      steps.forEach(function (st, j) { st.classList.toggle("on", j === i); st.classList.toggle("past", j < i); });
      if (!raf) raf = requestAnimationFrame(frame);
    }
    function onScroll() {
      if (!big.clientWidth) return;
      var r = root.getBoundingClientRect(), span = r.height - window.innerHeight;
      var p = clamp(-r.top / Math.max(1, span), 0, .999);
      set(Math.floor(p * 5));
    }
    /* stacked (mobile): each step draws its own state once in view */
    function minis() {
      steps.forEach(function (st, j) {
        var cv = st.querySelector(".x-mini"); if (!cv || !cv.clientWidth || cv._done) return;
        var go = function () {
          cv._done = true; var M = scene(cv.clientWidth, cv.clientHeight), from = j ? STATES[j - 1] : ZERO, to = STATES[j], t0 = null;
          if (RM) { drawScene(cv, M, to); return; }
          (function step(ts) {
            if (t0 == null) t0 = ts; var t = ease(clamp((ts - t0) / 1800, 0, 1)), v = {};
            KEYS.forEach(function (k) { v[k] = from[k] + (to[k] - from[k]) * t; }); drawScene(cv, M, v);
            if (t < 1) requestAnimationFrame(step);
          })(performance.now());
        };
        if (!("IntersectionObserver" in window) || forced || STILL) return go();
        var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); go(); } }, { threshold: .35 });
        io.observe(cv);
      });
    }
    sizeScene();
    if (forced) { document.documentElement.classList.add("solo"); root.classList.add("solo"); sizeScene(); cur = Object.assign({}, STATES[+forced - 1]); set(+forced - 1); drawScene(big, S, cur); minis(); return; }
    cur = Object.assign({}, STATES[0]); set(0); onScroll(); if (big.clientWidth) drawScene(big, S, cur); minis();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", function () { sizeScene(); drawScene(big, S, cur); minis(); onScroll(); });
    onScreen(root, function (v) { live = v; if (v && !raf) raf = requestAnimationFrame(frame); });
  }

  /* ---------- 3. growth marks: maturity drawn as growth ---------- */
  function mark(cv) {
    var n = parseInt(cv.getAttribute("data-n") || "1", 10), hi = cv.getAttribute("data-i"), seed = parseInt(cv.getAttribute("data-seed") || "1", 10);
    var s = setup(cv), r = rng(seed), w = s.w, h = s.h, ox = w * .14, oy = h * .86, th = [];
    for (var i = 0; i < n; i++) {
      var a = -Math.PI * (.08 + .42 * (n === 1 ? .5 : i / (n - 1))) + (r() - .5) * .12, l = Math.min(w, h) * (.66 + r() * .18);
      th.push(hypha(r, ox, oy, ox + Math.cos(a) * l, oy + Math.sin(a) * l, { amp: .18, branches: n > 4 ? 0 : 1, blen: .5 }));
    }
    function draw(p) {
      var c = setup(cv).ctx;
      th.forEach(function (t, i) {
        var on = hi != null && +hi === i, q = clamp(p * 1.3 - i * (.3 / n), 0, 1);
        drawH(c, t, ease(q), { a: on ? 1 : .78, w: on ? 1.2 : .85, col: on ? BLUE : INK });
        if (q >= 1) { var e = t.pts[t.pts.length - 1]; dot(c, e[0], e[1], 1.7, on ? "rgb(" + BLUE + ")" : "rgba(" + INK + ",.85)"); }
      });
      dot(c, ox, oy, 2.2, "rgba(" + INK + ",.9)");
    }
    if (RM || !("IntersectionObserver" in window)) return draw(1);
    draw(0);
    var io = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting) return; io.disconnect(); var t0 = null;
      (function step(ts) { if (t0 == null) t0 = ts; var t = clamp((ts - t0) / 1800, 0, 1); draw(t); if (t < 1) requestAnimationFrame(step); })(performance.now());
    }, { threshold: .6 });
    io.observe(cv);
  }

  /* ---------- 3b. one person, five threads, one verdict out (Work) ---------- */
  function crossFig(cv) {
    var M = scene(cv.clientWidth, cv.clientHeight), to = STATES[1];
    if (RM || !("IntersectionObserver" in window)) return drawScene(cv, M, to);
    drawScene(cv, M, ZERO);
    var io = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting) return; io.disconnect(); var t0 = null;
      (function step(ts) {
        if (t0 == null) t0 = ts; var t = ease(clamp((ts - t0) / 2400, 0, 1)), v = {};
        KEYS.forEach(function (k) { v[k] = to[k] * t; }); drawScene(cv, M, v);
        if (t < 1) requestAnimationFrame(step);
      })(performance.now());
    }, { threshold: .3 });
    io.observe(cv);
  }

  /* ---------- 4. a still graph figure for the Lab ---------- */
  function still(cv) {
    var s = setup(cv), seed = parseInt(cv.getAttribute("data-seed") || "3", 10);
    var F = field(seed, s.w, s.h, 5200, { k: 3, agents: .28, tips: 1 });
    function draw(P) { var c = setup(cv).ctx; drawField(c, F, P, { a: .38, na: .7, w: .8 }); }
    if (RM || !("IntersectionObserver" in window)) return draw(1);
    draw(.08);
    var io = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting) return; io.disconnect(); var t0 = null;
      (function step(ts) { if (t0 == null) t0 = ts; var t = clamp((ts - t0) / 5000, 0, 1); draw(.08 + .92 * ease(t)); if (t < 1) requestAnimationFrame(step); })(performance.now());
    }, { threshold: .3 });
    io.observe(cv);
  }

  function boot() {
    var hf = document.querySelector(".hero-field");
    if (hf && !hf.getAttribute("data-myc")) {
      hf.setAttribute("data-myc", "1");
      living(hf, { statement: true, pointer: true, pulses: 18 });
    } else if (!hf) {
      var head = document.querySelector(".journal,.essay,.paper,.read-head,.index-head");
      if (head && !document.querySelector("canvas.page-field")) {
        var pf = document.createElement("canvas"); pf.className = "page-field"; pf.setAttribute("aria-hidden", "true"); document.body.insertBefore(pf, document.body.firstChild); living(pf, { seed: 17, density: 16000, a: .2, pulses: 10 });
      }
    }
    [].forEach.call(document.querySelectorAll(".site-foot"), function (el) {
      if (!el.getAttribute("data-myc")) { el.setAttribute("data-myc", "1"); footThread(el); }
    });
    var x = document.querySelector(".explain"); if (x && !x.getAttribute("data-myc")) { x.setAttribute("data-myc", "1"); explainer(x); }
    [].forEach.call(document.querySelectorAll("canvas.gm"), mark);
    [].forEach.call(document.querySelectorAll("canvas.still"), still);
    [].forEach.call(document.querySelectorAll("canvas.crossc"), crossFig);
  }
  window.BookerBobMyc = { boot: boot };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(boot); else window.addEventListener("load", boot);
})();
