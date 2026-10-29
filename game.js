'use strict';
/* SHADOW LOOP: ECHO DIMENSION - game.js
   Part 1: pure game engine (no DOM). Part 2: UI, rendering, sound. */
(function (root) {

  /* ---------- LEVELS ----------
     # wall   . floor   S start   E exit   P pressure plate   D door */
  var LEVELS = [{
    name: 'LEVEL 1 \u00B7 FIRST ECHO',
    map: [
      '#########',
      '#S..#...#',
      '#.#.#.#.#',
      '#.#...#P#',
      '#.#####.#',
      '#.......#',
      '####D####',
      '####.####',
      '####E####'
    ]
  }];

  var DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0], W: [0, 0] };

  /* ---------- ENGINE ---------- */
  function parseLevel(def) {
    var grid = def.map.map(function (r) { return r.split(''); });
    var L = { name: def.name, w: grid[0].length, h: grid.length, grid: grid };
    grid.forEach(function (row, y) {
      row.forEach(function (c, x) {
        if (c === 'S') { L.start = { x: x, y: y }; row[x] = '.'; }
        else if (c === 'E') L.exit = { x: x, y: y };
        else if (c === 'P') L.plate = { x: x, y: y };
        else if (c === 'D') L.door = { x: x, y: y };
      });
    });
    return L;
  }

  function Engine(def) {
    this.L = parseLevel(def);
    this.echoRec = null;
    this.attempt = 1;
    this.begin();
  }

  Engine.prototype.begin = function () {
    var L = this.L;
    this.player = { x: L.start.x, y: L.start.y };
    this.rec = [];
    this.tick = 0;
    this.won = false;
    this.echo = this.echoRec ? { x: L.start.x, y: L.start.y } : null;
    this.doorOpen = false;
    this.plateDown = false;
    this.refresh();
  };

  Engine.prototype.on = function (e, p) { return !!e && e.x === p.x && e.y === p.y; };

  Engine.prototype.refresh = function () {
    var L = this.L;
    var pd = this.on(this.player, L.plate) || this.on(this.echo, L.plate);
    // the door stays open while anyone stands in it, so nobody gets crushed
    var open = pd || this.on(this.player, L.door) || this.on(this.echo, L.door);
    var ev = { plateChanged: pd !== this.plateDown, doorChanged: open !== this.doorOpen };
    this.plateDown = pd;
    this.doorOpen = open;
    return ev;
  };

  Engine.prototype.blocked = function (x, y) {
    var L = this.L;
    if (x < 0 || y < 0 || x >= L.w || y >= L.h) return true;
    if (L.grid[y][x] === '#') return true;
    if (x === L.door.x && y === L.door.y && !this.doorOpen) return true;
    return false;
  };

  // One player action = one tick. The echo performs its recorded action for the same tick.
  Engine.prototype.step = function (a) {
    if (this.won || !DIRS[a]) return { ok: false };
    var d = DIRS[a], p = this.player, nx = p.x + d[0], ny = p.y + d[1];
    if (a !== 'W' && this.blocked(nx, ny)) return { ok: false, blocked: true };
    p.x = nx; p.y = ny;
    this.rec.push(a);
    this.tick++;
    var echoMoved = false;
    if (this.echo && this.tick <= this.echoRec.length) {
      var ea = this.echoRec[this.tick - 1], ed = DIRS[ea];
      var ex = this.echo.x + ed[0], ey = this.echo.y + ed[1];
      if (ea !== 'W' && !this.blocked(ex, ey)) { this.echo.x = ex; this.echo.y = ey; echoMoved = true; }
    }
    var ev = this.refresh();
    if (p.x === this.L.exit.x && p.y === this.L.exit.y) this.won = true;
    return { ok: true, moved: a !== 'W', echoMoved: echoMoved,
             plateChanged: ev.plateChanged, doorChanged: ev.doorChanged, won: this.won };
  };

  // LOOP: save this run as the Echo, rewind the world, start a new attempt
  Engine.prototype.loop = function () {
    if (this.won || !this.rec.length) return false;
    this.echoRec = this.rec.slice();
    this.attempt++;
    this.begin();
    return true;
  };
  Engine.prototype.retry = function () { this.begin(); };            // keeps the Echo
  Engine.prototype.restart = function () { this.echoRec = null; this.attempt = 1; this.begin(); };

  /* ---------- SAVE ---------- */
  var SAVE_KEY = 'shadowloop.save.v1';
  function loadSave() {
    var s = { cleared: false, best: null, sound: true };
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (raw) { var o = JSON.parse(raw); for (var k in s) if (o && k in o) s[k] = o[k]; }
    } catch (e) {}
    return s;
  }
  function writeSave(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) {} }

  /* ---------- SOUND (WebAudio, no files) ---------- */
  var Sound = {
    ac: null, on: true,
    init: function () {
      if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
      try { var C = window.AudioContext || window.webkitAudioContext; if (C) this.ac = new C(); } catch (e) {}
    },
    tone: function (f, d, type, v, f2, delay) {
      if (!this.on || !this.ac) return;
      var t = this.ac.currentTime + (delay || 0);
      var o = this.ac.createOscillator(), g = this.ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
      g.gain.setValueAtTime(v || 0.08, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(this.ac.destination);
      o.start(t); o.stop(t + d + 0.03);
    },
    move: function () { this.tone(420, 0.07, 'triangle', 0.06, 520); },
    wait: function () { this.tone(260, 0.06, 'sine', 0.04); },
    bump: function () { this.tone(120, 0.12, 'square', 0.05, 70); },
    plate: function () { this.tone(520, 0.1, 'sine', 0.08); this.tone(780, 0.14, 'sine', 0.08, null, 0.08); },
    door: function () { this.tone(200, 0.35, 'sawtooth', 0.05, 700); },
    loop: function () { this.tone(900, 0.4, 'sine', 0.08, 180); this.tone(450, 0.4, 'triangle', 0.05, 90, 0.05); },
    win: function () { var n = [523, 659, 784, 1047]; for (var i = 0; i < n.length; i++) this.tone(n[i], 0.25, 'triangle', 0.08, null, i * 0.12); },
    ui: function () { this.tone(600, 0.05, 'sine', 0.05); }
  };

  /* ---------- UI / RENDER ---------- */
  function startUI() {
    var $ = function (id) { return document.getElementById(id); };
    var canvas = $('game'), ctx = canvas.getContext('2d'), stage = $('stage');
    var engine = new Engine(LEVELS[0]);
    var save = loadSave();
    Sound.on = !!save.sound;
    var state = 'title'; // title | playing | paused | complete
    var dpr = 1, cw = 0, ch = 0, cell = 0, ox = 0, oy = 0;
    var vp = { x: engine.player.x, y: engine.player.y }, ve = null;
    var doorAnim = 0, shake = 0, particles = [], trail = [], stars = [], last = 0;
    var toastTimer = null;

    for (var i = 0; i < 50; i++) stars.push({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 1.5, p: Math.random() * 6 });

    function resize() {
      var r = stage.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      cw = r.width; ch = r.height;
      canvas.width = Math.max(1, Math.round(cw * dpr));
      canvas.height = Math.max(1, Math.round(ch * dpr));
      cell = Math.floor(Math.min(cw / engine.L.w, ch / engine.L.h));
      ox = (cw - cell * engine.L.w) / 2;
      oy = (ch - cell * engine.L.h) / 2;
    }

    function snap() {
      vp = { x: engine.player.x, y: engine.player.y };
      ve = engine.echo ? { x: engine.echo.x, y: engine.echo.y } : null;
      doorAnim = engine.doorOpen ? 1 : 0;
      trail = [];
      updateHud();
    }

    function burst(tx, ty, color, n) {
      for (var i = 0; i < n; i++) {
        var a = Math.random() * 6.283, s = 30 + Math.random() * 90;
        particles.push({ x: (tx + 0.5) * cell, y: (ty + 0.5) * cell, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, c: color });
      }
    }

    function toast(msg) {
      var t = $('toast');
      t.textContent = msg; t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1600);
    }

    /* ----- HUD ----- */
    function hintText() {
      var e = engine, L = e.L;
      if (e.won) return 'Exit reached!';
      if (!e.echo) {
        return e.plateDown
          ? 'Plate active! Now press LOOP to record this run as your ECHO.'
          : 'Reach the glowing plate. The sealed door opens only while something stands on it. Then press LOOP.';
      }
      if (e.on(e.echo, L.plate)) return 'Your ECHO holds the plate. The door is open. Run for the exit!';
      return 'Your ECHO is replaying your last run. Go to the door and use WAIT until it opens.';
    }

    function updateHud() {
      var e = engine;
      $('lvlName').textContent = e.L.name;
      var echoTxt = e.echoRec ? ' \u00B7 ECHO ' + Math.min(e.tick, e.echoRec.length) + '/' + e.echoRec.length : '';
      $('hudStats').textContent = 'ATTEMPT ' + e.attempt + ' \u00B7 STEP ' + e.tick + echoTxt;
      $('hint').textContent = hintText();
      $('btnLoop').classList.toggle('ready', !e.echo && e.plateDown);
    }

    /* ----- screens ----- */
    function showScreen(name) {
      var ov = $('overlay');
      ['scrTitle', 'scrPause', 'scrComplete'].forEach(function (id) { $(id).classList.toggle('active', id === name); });
      ov.classList.toggle('show', !!name);
    }
    function refreshTitle() {
      $('bestLine').textContent = save.best ? 'BEST: ' + save.best + ' STEPS \u00B7 LEVEL CLEARED' : 'NEW SIGNAL DETECTED';
      $('btnPlay').textContent = save.cleared ? 'PLAY AGAIN' : 'START';
    }
    function refreshSoundBtns() {
      var t = 'SOUND: ' + (Sound.on ? 'ON' : 'OFF');
      $('btnSound').textContent = t; $('btnSound2').textContent = t;
    }
    function startGame() { engine.restart(); snap(); state = 'playing'; showScreen(null); }
    function pause() { if (state !== 'playing') return; state = 'paused'; showScreen('scrPause'); }
    function resume() { if (state !== 'paused') return; state = 'playing'; showScreen(null); }
    function toMenu() { state = 'title'; refreshTitle(); showScreen('scrTitle'); }

    /* ----- actions ----- */
    function act(a) {
      Sound.init();
      if (state !== 'playing') return;
      var before = engine.echo ? { x: engine.echo.x, y: engine.echo.y } : null;
      var r = engine.step(a);
      if (!r.ok) {
        if (r.blocked) { Sound.bump(); shake = 0.18; if (navigator.vibrate) try { navigator.vibrate(20); } catch (e) {} }
        return;
      }
      if (r.moved) Sound.move(); else Sound.wait();
      if (before && r.echoMoved) { trail.push(before); if (trail.length > 4) trail.shift(); }
      if (r.plateChanged) { Sound.plate(); if (engine.plateDown) burst(engine.L.plate.x, engine.L.plate.y, '#39ff88', 16); }
      if (r.doorChanged) { Sound.door(); burst(engine.L.door.x, engine.L.door.y, '#ff2d75', 14); }
      updateHud();
      if (r.won) onWin();
    }

    function doLoop() {
      Sound.init();
      if (state !== 'playing') return;
      if (engine.loop()) {
        Sound.loop(); burst(engine.L.start.x, engine.L.start.y, '#c04bff', 24);
        snap(); toast('ECHO RECORDED \u2014 ' + engine.echoRec.length + ' moves');
      } else toast('Move first to record an Echo');
    }

    function onWin() {
      Sound.win(); burst(engine.L.exit.x, engine.L.exit.y, '#7dfff0', 40);
      var steps = engine.tick;
      if (!save.best || steps < save.best) save.best = steps;
      save.cleared = true; writeSave(save);
      state = 'complete';
      $('cAttempts').textContent = engine.attempt;
      $('cSteps').textContent = steps;
      $('cBest').textContent = save.best;
      setTimeout(function () { if (state === 'complete') showScreen('scrComplete'); }, 900);
    }

    /* ----- input ----- */
    Array.prototype.forEach.call(document.querySelectorAll('[data-a]'), function (b) {
      var to = null, iv = null;
      function stop() { clearTimeout(to); clearInterval(iv); }
      b.addEventListener('pointerdown', function (e) {
        e.preventDefault(); act(b.dataset.a); stop();
        to = setTimeout(function () { iv = setInterval(function () { act(b.dataset.a); }, 170); }, 350);
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { b.addEventListener(ev, stop); });
    });
    $('btnWait').addEventListener('click', function () { act('W'); });
    $('btnLoop').addEventListener('click', doLoop);
    $('btnPause').addEventListener('click', function () { Sound.init(); Sound.ui(); pause(); });
    $('btnRestart').addEventListener('click', function () { Sound.init(); if (state === 'playing') { engine.restart(); snap(); toast('Level restarted'); } });

    var sx = 0, sy = 0, sw = false;
    stage.addEventListener('pointerdown', function (e) { sx = e.clientX; sy = e.clientY; sw = true; });
    stage.addEventListener('pointerup', function (e) {
      if (!sw) return; sw = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      act(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U'));
    });
    stage.addEventListener('pointercancel', function () { sw = false; });

    window.addEventListener('keydown', function (e) {
      var m = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', w: 'U', s: 'D', a: 'L', d: 'R', ' ': 'W' };
      if (m[e.key]) { e.preventDefault(); act(m[e.key]); }
      else if (e.key === 'e' || e.key === 'Enter') doLoop();
      else if (e.key === 'Escape' || e.key === 'p') { state === 'paused' ? resume() : pause(); }
    });
    document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); });
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () { setTimeout(resize, 200); });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    $('btnPlay').addEventListener('click', function () { Sound.init(); Sound.ui(); startGame(); });
    $('btnResume').addEventListener('click', function () { Sound.ui(); resume(); });
    $('btnRetry').addEventListener('click', function () { Sound.ui(); engine.retry(); snap(); state = 'playing'; showScreen(null); toast('Attempt reset \u2014 Echo kept'); });
    $('btnRestart2').addEventListener('click', function () { Sound.ui(); startGame(); });
    $('btnMenu').addEventListener('click', function () { Sound.ui(); toMenu(); });
    $('btnReplay').addEventListener('click', function () { Sound.ui(); startGame(); });
    $('btnMenu2').addEventListener('click', function () { Sound.ui(); toMenu(); });
    function toggleSound() { Sound.init(); Sound.on = !Sound.on; save.sound = Sound.on; writeSave(save); refreshSoundBtns(); Sound.ui(); }
    $('btnSound').addEventListener('click', toggleSound);
    $('btnSound2').addEventListener('click', toggleSound);

    /* ----- drawing helpers ----- */
    function rr(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    function glow(c, b) { ctx.shadowColor = c; ctx.shadowBlur = b; }
    function noGlow() { ctx.shadowBlur = 0; }

    function update(dt) {
      var k = Math.min(1, dt * 16), e = engine;
      vp.x += (e.player.x - vp.x) * k; vp.y += (e.player.y - vp.y) * k;
      if (e.echo) {
        if (!ve) ve = { x: e.echo.x, y: e.echo.y };
        ve.x += (e.echo.x - ve.x) * k; ve.y += (e.echo.y - ve.y) * k;
      } else ve = null;
      doorAnim += ((e.doorOpen ? 1 : 0) - doorAnim) * Math.min(1, dt * 9);
      shake = Math.max(0, shake - dt);
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 1.6;
        if (p.life <= 0) particles.splice(i, 1);
      }
    }

    function draw(t) {
      var L = engine.L, x, y;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, cw, ch);
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        ctx.globalAlpha = 0.2 + 0.25 * Math.sin(t * 1.5 + s.p);
        ctx.fillStyle = '#7fa6ff'; ctx.fillRect(s.x * cw, s.y * ch, s.r, s.r);
      }
      ctx.globalAlpha = 1;
      ctx.save();
      var amt = shake > 0 ? shake / 0.18 : 0;
      ctx.translate(ox + (Math.random() - 0.5) * 6 * amt, oy + (Math.random() - 0.5) * 6 * amt);

      // tiles
      for (y = 0; y < L.h; y++) for (x = 0; x < L.w; x++) {
        var px = x * cell, py = y * cell;
        if (L.grid[y][x] === '#') {
          ctx.fillStyle = '#0c1238'; rr(px + 1, py + 1, cell - 2, cell - 2, cell * 0.16); ctx.fill();
          ctx.strokeStyle = 'rgba(70,120,255,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(22,34,80,0.45)'; rr(px + 2, py + 2, cell - 4, cell - 4, cell * 0.12); ctx.fill();
          ctx.fillStyle = 'rgba(120,160,255,0.18)'; ctx.fillRect(px + cell / 2 - 1, py + cell / 2 - 1, 2, 2);
        }
      }

      // exit portal
      var ex = (L.exit.x + 0.5) * cell, ey = (L.exit.y + 0.5) * cell;
      var pr = cell * (0.26 + 0.04 * Math.sin(t * 3));
      glow('#7dfff0', 16); ctx.strokeStyle = '#7dfff0'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(ex, ey, pr, 0, 6.283); ctx.stroke();
      ctx.beginPath(); ctx.arc(ex, ey, cell * 0.38, t * 2, t * 2 + 3.8); ctx.stroke();
      ctx.fillStyle = 'rgba(125,255,240,0.25)'; ctx.beginPath(); ctx.arc(ex, ey, pr * 0.6, 0, 6.283); ctx.fill();
      noGlow();

      // plate
      var plx = (L.plate.x + 0.5) * cell, ply = (L.plate.y + 0.5) * cell;
      var pc = engine.plateDown ? '#39ff88' : '#ffb020';
      glow(pc, engine.plateDown ? 20 : 10); ctx.strokeStyle = pc; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(plx, ply, cell * 0.28, 0, 6.283); ctx.stroke();
      ctx.fillStyle = pc; ctx.globalAlpha = engine.plateDown ? 0.55 : 0.18;
      ctx.beginPath(); ctx.arc(plx, ply, cell * (engine.plateDown ? 0.2 : 0.14), 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1; noGlow();

      // door (two panels that slide apart)
      var dx = L.door.x * cell, dy = L.door.y * cell, half = cell / 2;
      var pw = Math.max(0, half * (1 - doorAnim));
      glow('#ff2d75', 14); ctx.fillStyle = '#ff2d75';
      ctx.globalAlpha = 0.85;
      if (pw > 1) {
        rr(dx + 1, dy + cell * 0.3, pw, cell * 0.4, 4); ctx.fill();
        rr(dx + cell - pw - 1, dy + cell * 0.3, pw, cell * 0.4, 4); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillRect(dx + 1, dy + cell * 0.18, 4, cell * 0.64);
      ctx.fillRect(dx + cell - 5, dy + cell * 0.18, 4, cell * 0.64);
      noGlow();

      // echo trail + echo
      var i2, tc;
      for (i2 = 0; i2 < trail.length; i2++) {
        tc = trail[i2];
        ctx.globalAlpha = 0.05 + 0.04 * i2; ctx.fillStyle = '#c04bff';
        ctx.beginPath(); ctx.arc((tc.x + 0.5) * cell, (tc.y + 0.5) * cell, cell * 0.22, 0, 6.283); ctx.fill();
      }
      if (ve) {
        var exx = (ve.x + 0.5) * cell, eyy = (ve.y + 0.5) * cell;
        ctx.globalAlpha = 0.5 + 0.12 * Math.sin(t * 7);
        glow('#c04bff', 20); ctx.fillStyle = '#b13cff';
        ctx.beginPath(); ctx.arc(exx, eyy, cell * 0.27, 0, 6.283); ctx.fill();
        ctx.globalAlpha = 0.9; ctx.strokeStyle = '#e6b0ff'; ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(exx, eyy, cell * 0.34, t * 1.5, t * 1.5 + 6.283); ctx.stroke(); ctx.setLineDash([]);
        noGlow(); ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = 1;

      // player
      var ppx = (vp.x + 0.5) * cell, ppy = (vp.y + 0.5) * cell;
      glow('#27e6ff', 22); ctx.fillStyle = '#27e6ff';
      ctx.beginPath(); ctx.arc(ppx, ppy, cell * 0.27, 0, 6.283); ctx.fill();
      noGlow(); ctx.fillStyle = '#eaffff';
      ctx.beginPath(); ctx.arc(ppx, ppy, cell * 0.11, 0, 6.283); ctx.fill();

      // particles
      for (var j = 0; j < particles.length; j++) {
        var p = particles[j];
        ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    function frame(ts) {
      var dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
      last = ts;
      update(dt); draw(ts / 1000);
      requestAnimationFrame(frame);
    }

    resize(); snap(); refreshTitle(); refreshSoundBtns(); showScreen('scrTitle');
    requestAnimationFrame(frame);
    return { engine: engine, act: act, loop: doLoop, startGame: startGame, getState: function () { return state; } };
  }

  var api = { Engine: Engine, LEVELS: LEVELS, startUI: startUI };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') {
    var boot = function () { root.ShadowLoop = startUI(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
