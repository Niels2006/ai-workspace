/* 三维演示：手写正交投影渲染器（无外部依赖）
   演示 A：L 形块 → 主视 / 俯视 / 左视
   演示 B：矩形套筒 → 半空间剖切 + 45° 剖面线 */
(function () {
  'use strict';

  /* ---------- 向量与相机 ---------- */
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function norm(a) {
    var l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }

  var RAD = Math.PI / 180;

  /* yaw / pitch → 正交投影基向量。v 指向观察者，屏幕 x=r，屏幕上=u */
  function basis(yaw, pitch) {
    var y = yaw * RAD, p = pitch * RAD;
    var v = [Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y)];
    var r = [Math.cos(y), 0, -Math.sin(y)];
    var u = cross(v, r);
    return { v: v, r: r, u: u };
  }
  function project(P, B) {
    return { x: dot(P, B.r), y: dot(P, B.u), d: dot(P, B.v) };
  }

  /* ---------- 长方体 ---------- */
  function makeBox(x0, x1, y0, y1, z0, z1) {
    var v = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
    ];
    return {
      v: v,
      z0: z0, z1: z1, x0: x0, x1: x1, y0: y0, y1: y1,
      faces: [
        { idx: [0, 3, 2, 1], n: [0, 0, -1] },
        { idx: [4, 5, 6, 7], n: [0, 0, 1] },
        { idx: [0, 1, 5, 4], n: [0, -1, 0] },
        { idx: [3, 7, 6, 2], n: [0, 1, 0] },
        { idx: [0, 4, 7, 3], n: [-1, 0, 0] },
        { idx: [1, 2, 6, 5], n: [1, 0, 0] }
      ]
    };
  }

  /* 保留 z <= c 的半空间，对凸多边形做 Sutherland–Hodgman 裁剪 */
  function clipZ(poly, c) {
    var out = [];
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      var ain = a[2] <= c + 1e-9, bin = b[2] <= c + 1e-9;
      if (ain) out.push(a);
      if (ain !== bin) {
        var t = (c - a[2]) / (b[2] - a[2]);
        out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), c]);
      }
    }
    return out;
  }

  /* ---------- 渲染器 ---------- */
  function Renderer(canvas, boxes) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.boxes = boxes;
    this.center = [0, 0, 0];
    this.radius = 1;
    this.computeBounds();
    this.resize();
  }
  Renderer.prototype.computeBounds = function () {
    var min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    this.boxes.forEach(function (b) {
      b.v.forEach(function (p) {
        for (var i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], p[i]);
          max[i] = Math.max(max[i], p[i]);
        }
      });
    });
    this.center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    var R = 0, c = this.center;
    this.boxes.forEach(function (b) {
      b.v.forEach(function (p) {
        R = Math.max(R, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
      });
    });
    this.radius = R;
  };
  Renderer.prototype.resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (!w || !h) return;
    this.w = w; this.h = h;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = Math.min(w, h) / (this.radius * 2.35);
  };
  Renderer.prototype.toScreen = function (p) {
    return [this.w / 2 + p.x * this.scale, this.h / 2 - p.y * this.scale];
  };

  /* 收集面片：普通面 + 剖切面，画家算法排序 */
  Renderer.prototype.collect = function (B, clipC) {
    var self = this, out = [];
    this.boxes.forEach(function (b) {
      if (clipC !== null && b.z0 > clipC) return;           // 整个被移除
      b.faces.forEach(function (f) {
        if (dot(f.n, B.v) <= 1e-6) return;                   // 背面剔除
        var poly = f.idx.map(function (i) { return b.v[i]; });
        if (clipC !== null) {
          poly = clipZ(poly, clipC);
          if (poly.length < 3) return;
        }
        out.push(self.makeFace(poly, B, 'face'));
      });
      if (clipC !== null && b.z0 < clipC && b.z1 > clipC) {  // 剖切平面封口
        var cut = [
          [b.x0, b.y0, clipC], [b.x1, b.y0, clipC],
          [b.x1, b.y1, clipC], [b.x0, b.y1, clipC]
        ];
        if (dot([0, 0, 1], B.v) > 1e-6) out.push(self.makeFace(cut, B, 'cut'));
      }
    });
    out.sort(function (a, b) { return a.depth - b.depth; });
    return out;
  };
  Renderer.prototype.makeFace = function (poly, B, kind) {
    var pts = [], depth = 0;
    for (var i = 0; i < poly.length; i++) {
      var p = project(sub(poly[i], this.center), B);
      depth += p.d;
      pts.push(this.toScreen(p));
    }
    return { pts: pts, depth: depth / poly.length, kind: kind };
  };

  Renderer.prototype.draw = function (yaw, pitch, clipC, colors) {
    var ctx = this.ctx;
    if (!this.w) this.resize();
    ctx.clearRect(0, 0, this.w, this.h);
    var B = basis(yaw, pitch);
    var faces = this.collect(B, clipC === undefined ? null : clipC);
    var self = this;
    faces.forEach(function (f) {
      ctx.beginPath();
      f.pts.forEach(function (p, i) { i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
      ctx.closePath();
      if (f.kind === 'cut') {
        ctx.fillStyle = colors.cutFill;
        ctx.fill();
        self.hatch(f.pts, colors.cutLine);
        ctx.strokeStyle = colors.cutLine;
        ctx.lineWidth = 1.8;
        ctx.stroke();
      } else {
        ctx.fillStyle = colors.faceFill;
        ctx.fill();
        ctx.strokeStyle = colors.edge;
        ctx.lineWidth = 1.6;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    });
  };

  /* 45° 剖面线：旋转坐标后按水平线与凸多边形求交 */
  Renderer.prototype.hatch = function (pts, color) {
    var ctx = this.ctx, ang = -Math.PI / 4;
    var c = Math.cos(ang), s = Math.sin(ang);
    var rot = pts.map(function (p) { return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; });
    var ys = rot.map(function (p) { return p[1]; });
    var min = Math.min.apply(null, ys), max = Math.max.apply(null, ys);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    for (var y = Math.ceil(min / 7) * 7; y < max; y += 7) {
      var xs = [];
      for (var i = 0; i < rot.length; i++) {
        var a = rot[i], b = rot[(i + 1) % rot.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
      }
      if (xs.length < 2) continue;
      xs.sort(function (p, q) { return p - q; });
      var x0 = xs[0], x1 = xs[xs.length - 1];
      var p0 = [x0 * c + y * s, -x0 * s + y * c];
      var p1 = [x1 * c + y * s, -x1 * s + y * c];
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
    }
    ctx.stroke();
    ctx.restore();
  };

  /* ---------- 视图切换动画 ---------- */
  function Animator(render) {
    this.render = render;
    this.yaw = -35; this.pitch = 25;
    this.raf = null;
  }
  Animator.prototype.goTo = function (yaw, pitch) {
    var self = this;
    if (this.raf) cancelAnimationFrame(this.raf);
    var y0 = this.yaw, p0 = this.pitch;
    var dy = ((yaw - y0 + 540) % 360) - 180;
    var t0 = performance.now(), dur = 420;
    function step(t) {
      var k = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      self.yaw = y0 + dy * e;
      self.pitch = p0 + (pitch - p0) * e;
      self.render(self.yaw, self.pitch);
      if (k < 1) self.raf = requestAnimationFrame(step);
      else self.raf = null;
    }
    this.raf = requestAnimationFrame(step);
  };
  Animator.prototype.attachDrag = function (el, onChange) {
    var self = this, dragging = false, lx = 0, ly = 0;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', function (e) {
      dragging = true; lx = e.clientX; ly = e.clientY;
      el.setPointerCapture(e.pointerId);
      if (self.raf) { cancelAnimationFrame(self.raf); self.raf = null; }
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      self.yaw += (e.clientX - lx) * 0.45;
      self.pitch = Math.max(-85, Math.min(85, self.pitch + (e.clientY - ly) * 0.45));
      lx = e.clientX; ly = e.clientY;
      self.render(self.yaw, self.pitch);
      if (onChange) onChange();
    });
    function end() { dragging = false; el.classList.remove('dragging'); }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ---------- 演示 A：L 形块 → 三视图 ---------- */
  function initDemoA() {
    var cv = document.getElementById('cvA');
    if (!cv) return;
    var boxes = [
      makeBox(0, 100, 0, 20, -25, 25),
      makeBox(0, 24, 0, 70, -25, 25)
    ];
    var R = new Renderer(cv, boxes);
    var colors = { faceFill: cssVar('--bg2'), edge: cssVar('--ink'), cutFill: '', cutLine: '' };
    function render(y, p) { R.draw(y, p, null, colors); }
    var anim = new Animator(render);
    anim.attachDrag(cv, function () { setActive('iso'); });
    window.addEventListener('resize', function () { R.resize(); render(anim.yaw, anim.pitch); });

    var views = {
      iso: [-35, 25],
      front: [0, 0],
      top: [0, 90],
      left: [-90, 0]
    };
    var captions = {
      iso: '轴测观察：这就是你手里那个真实的零件。',
      front: '主视图：从正前方看，只能看到长和高——深度方向被"压扁"了。',
      top: '俯视图：从正上方向下看，看到长和深，高度信息消失。',
      left: '左视图：从左侧向右看，看到深和高。虚线是被挡住的台阶棱边。'
    };
    var projViews = ['front', 'top', 'left'];
    function setActive(name) {
      document.querySelectorAll('#demoA .vbtn').forEach(function (b) {
        b.classList.toggle('on', b.dataset.view === name);
      });
    }
    document.querySelectorAll('#demoA .vbtn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.dataset.view;
        anim.goTo(views[name][0], views[name][1]);
        setActive(name);
        if (projViews.indexOf(name) >= 0) {
          projViews.forEach(function (v) {
            var el = document.getElementById('proj-' + v);
            if (el) el.style.display = v === name ? 'block' : 'none';
          });
          var label = document.getElementById('projLabel');
          if (label) label.textContent = btn.textContent;
        }
        var cap = document.getElementById('capA');
        if (cap) cap.textContent = captions[name];
      });
    });
    render(anim.yaw, anim.pitch);
  }

  /* ---------- 演示 B：套筒剖切 ---------- */
  function initDemoB() {
    var cv = document.getElementById('cvB');
    if (!cv) return;
    /* 矩形套筒：外 80×90×60，内孔 40×30 贯通，由 4 个长方体围成 */
    var boxes = [
      makeBox(0, 20, 0, 90, -30, 30),
      makeBox(60, 80, 0, 90, -30, 30),
      makeBox(20, 60, 0, 90, 15, 30),
      makeBox(20, 60, 0, 90, -30, -15)
    ];
    var R = new Renderer(cv, boxes);
    var colors = {
      faceFill: cssVar('--bg2'),
      edge: cssVar('--ink'),
      cutFill: 'rgba(184,73,28,.16)',
      cutLine: cssVar('--accent2')
    };
    var slider = document.getElementById('cutRange');
    var readout = document.getElementById('cutVal');
    function cut() { return Number(slider.value); }
    function render(y, p) { R.draw(y, p, cut(), colors); }
    var anim = new Animator(render);
    anim.attachDrag(cv);
    window.addEventListener('resize', function () { R.resize(); render(anim.yaw, anim.pitch); });
    slider.addEventListener('input', function () {
      var c = cut();
      readout.textContent = c >= 30 ? '不剖切（完整零件）' : '剖切平面 z = ' + c + ' mm';
      render(anim.yaw, anim.pitch);
    });
    document.querySelectorAll('#demoB .vbtn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('#demoB .vbtn').forEach(function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        if (btn.dataset.view === 'front') anim.goTo(0, 0);
        else anim.goTo(-35, 25);
      });
    });
    render(anim.yaw, anim.pitch);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initDemoA(); initDemoB(); });
  } else {
    initDemoA(); initDemoB();
  }
})();
