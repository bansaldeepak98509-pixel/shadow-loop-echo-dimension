'use strict';
/* SHADOW LOOP: ECHO DIMENSION - game.js (Phase 1)
   1) LEVELS  2) Engine (no DOM, unit-tested)  3) Save  4) Sound  5) UI + rendering */
(function (root) {

  /* =====================================================================
     1) LEVELS
     Map legend:  # wall   . floor   S start   E exit
                  a b c    hold-plates (active only while something stands on them)
                  x y z    latch switches (stay on for the rest of the attempt)
                  D G H    doors (see "doors": which controls must be active)
                  L M      lasers (see "lasers": fixed on/off rhythm by tick)
     "solution" = intended attempts. All but the last end with LOOP.
     ===================================================================== */
  var LEVELS = [
    {
      name: 'THE AWAKENING', sub: 'Learn the Echo', theme: 'lab', maxEchoes: 1,
      doors: { D: ['a'] }, lasers: {}, tutorial: true,
      hints: [
        'Reach the glowing plate. The sealed door opens only while something stands on it. Then press LOOP.',
        'Your ECHO replays your last run. Go to the door and use WAIT until it opens.'
      ],
      map: [
        '#########',
        '#S..#...#',
        '#.#.#.#.#',
        '#.#...#a#',
        '#.#####.#',
        '#.......#',
        '####D####',
        '####.####',
        '####E####'
      ],
      solution: ['DDDDRRRRRRUU', 'DDDDRRR' + 'WWWWW' + 'DDD']
    },
    {
      name: 'DUAL LOCK', sub: 'Plate + switch', theme: 'grid', maxEchoes: 1,
      doors: { D: ['a', 'x'] }, lasers: {},
      hints: [
        'The door needs BOTH locks: the plate held and the switch flipped. Record a run to the plate, then LOOP.',
        'Your Echo holds the plate. Flip the switch (it stays on) and walk to the door.'
      ],
      map: [
        '#########',
        '#S..#...#',
        '#.#.#.#.#',
        '#.#...#x#',
        '#.#####.#',
        '#.......#',
        '#a##D####',
        '####.####',
        '####E####'
      ],
      solution: ['DDDDD', 'RRDDRRUURRDD' + 'DD' + 'LLL' + 'DDD']
    },
    {
      name: 'DEAD SIGNAL', sub: 'Laser gauntlet', theme: 'signal', maxEchoes: 1,
      doors: { D: ['a'] },
      lasers: { L: { period: 4, on: 2, phase: 0 }, M: { period: 4, on: 2, phase: 2 } },
      hints: [
        'Lasers pulse on a fixed rhythm: bright red = deadly, orange flicker = about to fire. Cross the gauntlet, hold the plate, press LOOP.',
        'Your Echo is immune to lasers and holds the plate. Reach the door and WAIT for it.'
      ],
      map: [
        '#########',
        '#...LM.a#',
        '#S#######',
        '#.#######',
        '#.#######',
        '#.......#',
        '####D####',
        '####.####',
        '####E####'
      ],
      solution: ['U' + 'RR' + 'WWW' + 'RRRR', 'DDD' + 'RRR' + 'WWWW' + 'DDD']
    },
    {
      name: 'ECHO CHAMBER', sub: 'Two Echoes', theme: 'chamber', maxEchoes: 2,
      doors: { D: ['a'], G: ['a', 'b'] }, lasers: {},
      hints: [
        'The second plate hides behind a door. Record a run to the first plate, then LOOP.',
        'Echo 1 holds the plate and opens the inner door. Follow it to the second plate and LOOP again.',
        'Two Echoes now hold both plates. Go to the exit door and WAIT for it to open.'
      ],
      map: [
        '#########',
        '#S.....a#',
        '#.#####.#',
        '#.#####D#',
        '#.#####.#',
        '#.###b..#',
        '#.#######',
        '#.......#',
        '####G####',
        '####E####',
        '#########'
      ],
      solution: ['RRRRRR', 'RRRRRRDDDDLL', 'DDDDDD' + 'RRR' + 'WWW' + 'DD']
    },
    {
      name: 'THE RIFT', sub: 'Everything at once', theme: 'rift', maxEchoes: 2,
      doors: { D: ['a'], G: ['a', 'b', 'x'] },
      lasers: { L: { period: 4, on: 2, phase: 0 }, M: { period: 4, on: 2, phase: 2 } },
      hints: [
        'Time the lasers, reach the far plate and LOOP. The exit needs two plates and a switch.',
        'Your Echo opens the inner door. Reach the second plate behind it and LOOP again.',
        'Two Echoes hold the plates. Flip the switch, then reach the exit.'
      ],
      map: [
        '#########',
        '#...LM.a#',
        '#S#####.#',
        '#.#####D#',
        '#.#####.#',
        '#.###b..#',
        '#.#######',
        '#......x#',
        '####G####',
        '####E####',
        '#########'
      ],
      solution: [
        'U' + 'RR' + 'WWW' + 'RRRR',
        'U' + 'RR' + 'WWW' + 'RRRR' + 'DDDD' + 'LL',
        'DDDDD' + 'RRRRRR' + 'LLL' + 'WW' + 'DD'
      ]
    }
  ];

  var DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0], W: [0, 0] };

  /* =====================================================================
     2) ENGINE  (deterministic, tick based, no DOM)
     One player action = one tick. Every Echo performs its own recorded
     action for that same tick. Echoes are immune to lasers.
     ===================================================================== */
  function parseLevel(def) {
    var grid = def.map.map(function (r) { return r.split(''); });
    var L = { name: def.name, sub: def.sub, theme: def.theme, w: grid[0].length, h: grid.length, grid: grid,
              controls: [], doors: [], lasers: [], doorAt: {} };
    var doorDefs = def.doors || {}, laserDefs = def.lasers || {};
    grid.forEach(function (row, y) {
      row.forEach(function (c, x) {
        if (c === 'S') { L.start = { x: x, y: y }; row[x] = '.'; }
        else if (c === 'E') { L.exit = { x: x, y: y }; row[x] = '.'; }
        else if (c >= 'a' && c <= 'c') { L.controls.push({ id: c, kind: 'plate', x: x, y: y }); row[x] = '.'; }
        else if (c >= 'x' && c <= 'z') { L.controls.push({ id: c, kind: 'latch', x: x, y: y }); row[x] = '.'; }
        else if (doorDefs[c]) { var d = { id: c, x: x, y: y, needs: doorDefs[c].slice() }; L.doors.push(d); L.doorAt[x + ',' + y] = d; row[x] = '.'; }
        else if (laserDefs[c]) { var q = laserDefs[c]; L.lasers.push({ x: x, y: y, period: q.period, on: q.on, phase: q.phase }); row[x] = '.'; }
      });
    });
    return L;
  }

  function Engine(def) {
    this.L = parseLevel(def);
    this.max = def.maxEchoes || 1;
    this.recs = [];      // saved recordings; recs[i] drives echoes[i]
    this.attempt = 1;
    this.begin();
  }

  Engine.prototype.begin = function () {
    var s = this.L.start;
    this.player = { x: s.x, y: s.y };
    this.rec = [];
    this.tick = 0;
    this.won = false;
    this.dead = false;
    this.echoes = this.recs.map(function () { return { x: s.x, y: s.y }; });
    this.latched = {};
    this.active = {};
    this.doorOpen = {};
    this.sig = '';
    this.refresh();
  };

  Engine.prototype.entities = function () { return [this.player].concat(this.echoes); };

  Engine.prototype.refresh = function () {
    var L = this.L, ents = this.entities(), self = this;
    var cs = '', ds = '';
    L.controls.forEach(function (c) {
      var on = ents.some(function (e) { return e.x === c.x && e.y === c.y; });
      if (c.kind === 'latch') { if (on) self.latched[c.id] = true; self.active[c.id] = !!self.latched[c.id]; }
      else self.active[c.id] = on;
      cs += self.active[c.id] ? '1' : '0';
    });
    L.doors.forEach(function (d) {
      // a door stays open while anyone stands in it, so nobody gets crushed
      var open = d.needs.every(function (id) { return self.active[id]; }) ||
        ents.some(function (e) { return e.x === d.x && e.y === d.y; });
      self.doorOpen[d.id] = open;
      ds += open ? '1' : '0';
    });
    var prev = this.sig.split('|');
    var ev = { controlChanged: prev[0] !== undefined && this.sig !== '' && prev[0] !== cs,
               doorChanged: this.sig !== '' && prev[1] !== ds };
    this.sig = cs + '|' + ds;
    return ev;
  };

  Engine.prototype.blocked = function (x, y) {
    var L = this.L;
    if (x < 0 || y < 0 || x >= L.w || y >= L.h) return true;
    if (L.grid[y][x] === '#') return true;
    var d = L.doorAt[x + ',' + y];
    return !!(d && !this.doorOpen[d.id]);
  };

  Engine.prototype.laserOn = function (l, t) { return ((t + l.phase) % l.period) < l.on; };
  Engine.prototype.laserWarn = function (l, t) { return !this.laserOn(l, t) && this.laserOn(l, t + 1); };
  Engine.prototype.hazardAt = function (x, y, t) {
    for (var i = 0; i < this.L.lasers.length; i++) {
      var l = this.L.lasers[i];
      if (l.x === x && l.y === y && this.laserOn(l, t)) return true;
    }
    return false;
  };

  Engine.prototype.step = function (a) {
    if (this.won || this.dead || !DIRS[a]) return { ok: false };
    var d = DIRS[a], p = this.player, nx = p.x + d[0], ny = p.y + d[1];
    if (a !== 'W' && this.blocked(nx, ny)) return { ok: false, blocked: true };
    p.x = nx; p.y = ny;
    this.rec.push(a);
    this.tick++;
    var echoMoved = false;
    for (var i = 0; i < this.echoes.length; i++) {
      var rec = this.recs[i];
      if (this.tick <= rec.length) {
        var ea = rec[this.tick - 1], ed = DIRS[ea], e = this.echoes[i];
        var ex = e.x + ed[0], ey = e.y + ed[1];
        if (ea !== 'W' && !this.blocked(ex, ey)) { e.x = ex; e.y = ey; echoMoved = true; }
      }
    }
    var ev = this.refresh();
    if (this.hazardAt(p.x, p.y, this.tick)) this.dead = true;
    else if (p.x === this.L.exit.x && p.y === this.L.exit.y) this.won = true;
    return { ok: true, moved: a !== 'W', echoMoved: echoMoved, controlChanged: ev.controlChanged,
             doorChanged: ev.doorChanged, dead: this.dead, won: this.won };
  };

  // LOOP: save this run as a new Echo (oldest dropped when over the limit), rewind the world
  Engine.prototype.loop = function () {
    if (this.won || this.dead || !this.rec.length) return false;
    this.recs.push(this.rec.slice());
    if (this.recs.length > this.max) this.recs.shift();
    this.attempt++;
    this.begin();
    return true;
  };
  Engine.prototype.retry = function () { this.begin(); };                         // keeps Echoes
  Engine.prototype.restart = function () { this.recs = []; this.attempt = 1; this.begin(); };

  /* =====================================================================
     3) SAVE  (v2, migrates v1, tolerates missing / malformed / blocked storage)
     ===================================================================== */
  var Save = {
    KEY: 'shadowloop.save.v2', OLD: 'shadowloop.save.v1',
    blank: function () {
      var n = LEVELS.length, d = [], b = [];
      for (var i = 0; i < n; i++) { d.push(false); b.push(null); }
      return { v: 2, unlocked: 1, done: d, best: b, sound: true, fx: true };
    },
    sanitize: function (o) {
      var s = this.blank(), n = LEVELS.length, i;
      if (!o || typeof o !== 'object') return s;
      if (Array.isArray(o.done)) for (i = 0; i < n; i++) s.done[i] = o.done[i] === true;
      if (Array.isArray(o.best)) for (i = 0; i < n; i++) {
        var b = o.best[i];
        s.best[i] = (typeof b === 'number' && isFinite(b) && b > 0 && b < 100000) ? Math.floor(b) : null;
      }
      var u = Math.floor(Number(o.unlocked));
      if (!isFinite(u)) u = 1;
      u = Math.max(1, Math.min(n, u));
      for (i = 0; i < n; i++) if (s.done[i]) u = Math.max(u, Math.min(n, i + 2));
      s.unlocked = u;
      if (typeof o.sound === 'boolean') s.sound = o.sound;
      if (typeof o.fx === 'boolean') s.fx = o.fx;
      return s;
    },
    migrate: function (old) {          // v1 was { cleared, best, sound }
      var s = this.blank();
      if (!old || typeof old !== 'object') return s;
      if (old.cleared === true) { s.done[0] = true; s.unlocked = 2; }
      if (typeof old.best === 'number' && old.best > 0) s.best[0] = old.best;
      if (typeof old.sound === 'boolean') s.sound = old.sound;
      return this.sanitize(s);
    },
    load: function () {
      var raw;
      try { raw = localStorage.getItem(this.KEY); if (raw) return this.sanitize(JSON.parse(raw)); } catch (e) {}
      try { raw = localStorage.getItem(this.OLD); if (raw) return this.migrate(JSON.parse(raw)); } catch (e) {}
      return this.blank();
    },
    write: function (s) { try { localStorage.setItem(this.KEY, JSON.stringify(s)); } catch (e) {} }
  };

  /* =====================================================================
     4) SOUND  (WebAudio synth, no audio files)
     ===================================================================== */
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
    zap: function () { this.tone(900, 0.35, 'sawtooth', 0.07, 60); this.tone(140, 0.4, 'square', 0.05, 40, 0.05); },
    win: function () { var n = [523, 659, 784, 1047]; for (var i = 0; i < n.length; i++) this.tone(n[i], 0.25, 'triangle', 0.08, null, i * 0.12); },
    ui: function () { this.tone(600, 0.05, 'sine', 0.05); }
  };

  /* =====================================================================
     5) UI + RENDERING  (started once; no listeners/loops are added afterwards)
     ===================================================================== */
  var THEMES = {
    lab:     { bg: '#05060f', wall: '#0c1238', edge: 'rgba(70,120,255,0.5)',  floor: 'rgba(22,34,80,0.45)', fog: '40,70,255',   dot: 'rgba(120,160,255,0.18)' },
    grid:    { bg: '#050814', wall: '#0a1640', edge: 'rgba(60,170,255,0.55)', floor: 'rgba(16,40,90,0.5)',  fog: '30,120,255',  dot: 'rgba(110,190,255,0.2)' },
    signal:  { bg: '#0a0509', wall: '#1a0a1c', edge: 'rgba(255,60,110,0.5)',  floor: 'rgba(50,16,40,0.5)',  fog: '255,40,90',   dot: 'rgba(255,120,150,0.2)' },
    chamber: { bg: '#07050f', wall: '#150c36', edge: 'rgba(170,80,255,0.55)', floor: 'rgba(40,20,80,0.5)',  fog: '150,60,255',  dot: 'rgba(190,140,255,0.2)' },
    rift:    { bg: '#050410', wall: '#120a30', edge: 'rgba(125,255,240,0.5)', floor: 'rgba(30,20,80,0.5)',  fog: '110,60,255',  dot: 'rgba(160,230,255,0.22)' }
  };
  var ECHO_COLORS = ['#b13cff', '#ff4fd8'];
  var ECHO_LIGHT = ['#e6b0ff', '#ffc0f0'];

  function startUI() {
    var $ = function (id) { return document.getElementById(id); };
    var canvas = $('game'), ctx = canvas.getContext('2d'), stage = $('stage'), fade = $('fade'), flash = $('flash');
    var save = Save.load();
    Sound.on = !!save.sound;
    var rmq = null;
    try { rmq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)'); } catch (e) {}
    function fxOn() { return save.fx && !(rmq && rmq.matches); }

    var state = 'title';              // title | playing | paused | complete | dead
    var cur = 0, engine = new Engine(LEVELS[0]);
    var dpr = 1, cw = 0, ch = 0, cell = 0, ox = 0, oy = 0;
    var vp, ve, doorAnim, trail, deadT, shake = 0, particles = [], rings = [], motes = [], last = 0;
    var vig = document.createElement('canvas');
    var timers = [], trId = null, toastTimer = null, holdTO = null, holdIV = null;

    for (var i = 0; i < 24; i++) motes.push({ x: Math.random(), y: Math.random(), s: 0.01 + Math.random() * 0.02, r: 1 + Math.random() * 1.5, p: Math.random() * 6 });

    /* ----- timers (all tracked so level changes can cancel them) ----- */
    function later(fn, ms) {
      var id = setTimeout(function () { var k = timers.indexOf(id); if (k >= 0) timers.splice(k, 1); fn(); }, ms);
      timers.push(id);
    }
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }
    function go(fn) {                  // fade out, run fn, fade in
      if (trId) clearTimeout(trId);
      fade.classList.add('on');
      trId = setTimeout(function () { trId = null; fn(); fade.classList.remove('on'); }, 220);
    }
    function stopHold() { clearTimeout(holdTO); clearInterval(holdIV); holdTO = holdIV = null; }

    /* ----- layout ----- */
    function resize() {
      var r = stage.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      cw = r.width; ch = r.height;
      canvas.width = Math.max(1, Math.round(cw * dpr));
      canvas.height = Math.max(1, Math.round(ch * dpr));
      cell = Math.floor(Math.min(cw / engine.L.w, ch / engine.L.h));
      ox = (cw - cell * engine.L.w) / 2;
      oy = (ch - cell * engine.L.h) / 2;
      vig.width = canvas.width; vig.height = canvas.height;
      var vg = vig.getContext('2d');
      var g = vg.createRadialGradient(vig.width / 2, vig.height / 2, Math.min(vig.width, vig.height) * 0.35,
                                      vig.width / 2, vig.height / 2, Math.max(vig.width, vig.height) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.65)');
      vg.fillStyle = g; vg.fillRect(0, 0, vig.width, vig.height);
    }

    function snap() {
      vp = { x: engine.player.x, y: engine.player.y };
      ve = engine.echoes.map(function (e) { return { x: e.x, y: e.y }; });
      doorAnim = {};
      engine.L.doors.forEach(function (d) { doorAnim[d.id] = engine.doorOpen[d.id] ? 1 : 0; });
      trail = []; deadT = 1; shake = 0; particles = []; rings = [];
      updateHud();
    }

    function burst(tx, ty, color, n) {
      if (!fxOn()) n = Math.ceil(n / 3);
      for (var i = 0; i < n && particles.length < 200; i++) {
        var a = Math.random() * 6.283, s = 30 + Math.random() * 100;
        particles.push({ x: (tx + 0.5) * cell, y: (ty + 0.5) * cell, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, c: color });
      }
    }
    function ring(tx, ty, color) { rings.push({ x: (tx + 0.5) * cell, y: (ty + 0.5) * cell, r: cell * 0.2, life: 1, c: color }); }

    function toast(msg) {
      var t = $('toast');
      t.textContent = msg; t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1600);
    }

    /* ----- HUD ----- */
    function hintText() {
      var e = engine, def = LEVELS[cur];
      if (e.won) return 'Exit reached!';
      if (def.tutorial && !e.echoes.length && e.plateDownAny()) return 'Plate active! Now press LOOP to record this run as your ECHO.';
      var h = def.hints, k = Math.min(e.echoes.length, h.length - 1);
      return h[k];
    }
    Engine.prototype.plateDownAny = function () {
      var self = this;
      return this.L.controls.some(function (c) { return c.kind === 'plate' && self.active[c.id]; });
    };
    function updateHud() {
      var e = engine;
      $('lvlName').textContent = (cur + 1) + ' \u00B7 ' + e.L.name;
      $('hudStats').textContent = 'ATTEMPT ' + e.attempt + ' \u00B7 STEP ' + e.tick + ' \u00B7 ECHOES ' + e.echoes.length + '/' + e.max;
      $('hint').textContent = hintText();
      $('btnLoop').classList.toggle('ready', LEVELS[cur].tutorial && !e.echoes.length && e.plateDownAny());
    }

    /* ----- screens ----- */
    var SCREENS = ['scrTitle', 'scrLevels', 'scrSettings', 'scrPause', 'scrComplete', 'scrDead', 'scrFinal'];
    function showScreen(name) {
      SCREENS.forEach(function (id) { $(id).classList.toggle('active', id === name); });
      $('overlay').classList.toggle('show', !!name);
    }
    function nextIndex() {
      for (var i = 0; i < LEVELS.length; i++) if (i < save.unlocked && !save.done[i]) return i;
      return -1;
    }
    function refreshTitle() {
      var n = nextIndex(), any = save.done.some(function (d) { return d; });
      $('btnPlay').textContent = n < 0 ? 'PLAY AGAIN' : (any ? 'CONTINUE' : 'START');
      var cleared = save.done.filter(function (d) { return d; }).length;
      $('bestLine').textContent = cleared + ' / ' + LEVELS.length + ' LEVELS CLEARED';
    }
    function refreshSettings() {
      $('btnSound').textContent = 'SOUND FX: ' + (save.sound ? 'ON' : 'OFF');
      $('btnFx').textContent = 'EFFECTS: ' + (save.fx ? 'FULL' : 'REDUCED');
    }
    var cards = [];
    function buildLevelCards() {
      var list = $('levelList');
      LEVELS.forEach(function (def, i) {
        var b = document.createElement('button');
        b.className = 'card';
        var n = document.createElement('span'); n.className = 'cn'; n.textContent = String(i + 1);
        var m = document.createElement('span'); m.className = 'cm';
        var t = document.createElement('b'); t.textContent = def.name;
        var s = document.createElement('small'); s.textContent = def.sub;
        m.appendChild(t); m.appendChild(s);
        var st = document.createElement('span'); st.className = 'cs';
        b.appendChild(n); b.appendChild(m); b.appendChild(st);
        b.addEventListener('click', function () {
          Sound.init();
          if (i >= save.unlocked) { Sound.bump(); toast('Clear level ' + i + ' to unlock this'); return; }
          Sound.ui(); go(function () { startLevel(i); });
        });
        list.appendChild(b);
        cards.push({ b: b, st: st });
      });
    }
    function refreshLevels() {
      cards.forEach(function (c, i) {
        var locked = i >= save.unlocked;
        c.b.classList.toggle('locked', locked);
        c.b.classList.toggle('done', !!save.done[i]);
        c.st.textContent = locked ? 'LOCKED' : (save.done[i] ? 'CLEARED \u00B7 BEST ' + save.best[i] : 'READY');
      });
    }
    function openLevels() {
      if (state !== 'title') state = 'title';
      stopHold(); refreshLevels(); showScreen('scrLevels');
    }
    function toMenu() { state = 'title'; stopHold(); clearTimers(); refreshTitle(); showScreen('scrTitle'); }

    /* ----- level flow ----- */
    function startLevel(i) {
      clearTimers(); stopHold();
      cur = i; engine = new Engine(LEVELS[i]);
      state = 'playing';
      resize(); snap(); showScreen(null);
    }
    function pause() { if (state !== 'playing') return; stopHold(); state = 'paused'; showScreen('scrPause'); }
    function resume() { if (state !== 'paused') return; state = 'playing'; showScreen(null); }
    function retryAttempt() { clearTimers(); engine.retry(); snap(); state = 'playing'; showScreen(null); }
    function restartLevel() { clearTimers(); engine.restart(); snap(); state = 'playing'; showScreen(null); }

    function act(a) {
      Sound.init();
      if (state !== 'playing') { stopHold(); return; }
      var before = engine.echoes.map(function (e) { return { x: e.x, y: e.y, i: 0 }; });
      var r = engine.step(a);
      if (!r.ok) {
        if (r.blocked) { Sound.bump(); if (fxOn()) shake = 0.18; if (navigator.vibrate) try { navigator.vibrate(20); } catch (e) {} }
        return;
      }
      if (r.moved) Sound.move(); else Sound.wait();
      if (r.echoMoved) { before.forEach(function (b, k) { b.i = k; trail.push(b); }); while (trail.length > 6) trail.shift(); }
      if (r.controlChanged) {
        Sound.plate();
        engine.L.controls.forEach(function (c) { if (engine.active[c.id]) burst(c.x, c.y, '#39ff88', 8); });
      }
      if (r.doorChanged) {
        Sound.door();
        engine.L.doors.forEach(function (d) { if (engine.doorOpen[d.id]) burst(d.x, d.y, '#ff2d75', 10); });
      }
      updateHud();
      if (r.dead) onDead();
      else if (r.won) onWin();
    }

    function doLoop() {
      Sound.init();
      if (state !== 'playing') return;
      if (engine.loop()) {
        Sound.loop(); burst(engine.L.start.x, engine.L.start.y, '#c04bff', 24); ring(engine.L.start.x, engine.L.start.y, '#c04bff');
        snap();
        toast('ECHO RECORDED \u2014 ' + engine.recs[engine.recs.length - 1].length + ' moves');
      } else toast('Move first to record an Echo');
    }

    function onDead() {
      state = 'dead'; stopHold();
      Sound.zap(); if (fxOn()) shake = 0.35;
      flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
      burst(engine.player.x, engine.player.y, '#ff2d55', 34);
      later(function () { if (state === 'dead') showScreen('scrDead'); }, 750);
    }

    function onWin() {
      state = 'complete'; stopHold();
      var steps = engine.tick;
      save.done[cur] = true;
      if (!save.best[cur] || steps < save.best[cur]) save.best[cur] = steps;
      if (cur + 1 < LEVELS.length) save.unlocked = Math.max(save.unlocked, cur + 2);
      Save.write(save); refreshLevels();
      Sound.win();
      burst(engine.L.exit.x, engine.L.exit.y, '#7dfff0', 44);
      ring(engine.L.exit.x, engine.L.exit.y, '#7dfff0');
      var last = cur === LEVELS.length - 1;
      if (last) { ring(engine.L.exit.x, engine.L.exit.y, '#c04bff'); }
      later(function () {
        if (state !== 'complete') return;
        if (last) {
          var total = 0; save.best.forEach(function (b) { total += b || 0; });
          $('fTotal').textContent = total;
          showScreen('scrFinal');
        } else {
          $('cName').textContent = engine.L.name + ' \u00B7 CLEARED';
          $('cAttempts').textContent = engine.attempt;
          $('cSteps').textContent = steps;
          $('cBest').textContent = save.best[cur];
          showScreen('scrComplete');
        }
      }, last ? 1500 : 900);
    }

    /* ----- input (registered exactly once) ----- */
    Array.prototype.forEach.call(document.querySelectorAll('[data-a]'), function (b) {
      function start(e) {
        e.preventDefault(); act(b.dataset.a); stopHold();
        holdTO = setTimeout(function () { holdIV = setInterval(function () { act(b.dataset.a); }, 170); }, 350);
      }
      b.addEventListener('pointerdown', start);
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { b.addEventListener(ev, stopHold); });
    });
    $('btnWait').addEventListener('click', function () { act('W'); });
    $('btnLoop').addEventListener('click', doLoop);
    $('btnPause').addEventListener('click', function () { Sound.init(); Sound.ui(); pause(); });
    $('btnRestart').addEventListener('click', function () { Sound.init(); if (state === 'playing') { restartLevel(); toast('Level restarted'); } });

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
      else if (e.key === 'Escape' || e.key === 'p') { if (state === 'paused') resume(); else pause(); }
    });
    document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); });
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () { later(resize, 200); });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    function ui(id, fn) { $(id).addEventListener('click', function () { Sound.init(); Sound.ui(); fn(); }); }
    ui('btnPlay', function () { var n = nextIndex(); if (n < 0) openLevels(); else go(function () { startLevel(n); }); });
    ui('btnLevels', openLevels);
    ui('btnSettings', function () { refreshSettings(); showScreen('scrSettings'); });
    ui('btnLevelsBack', toMenu);
    ui('btnSettingsBack', toMenu);
    ui('btnSound', function () { Sound.on = !Sound.on; save.sound = Sound.on; Save.write(save); refreshSettings(); Sound.ui(); });
    ui('btnFx', function () { save.fx = !save.fx; Save.write(save); refreshSettings(); });
    ui('btnResume', resume);
    ui('btnRetry', function () { retryAttempt(); toast('Attempt reset \u2014 Echoes kept'); });
    ui('btnRestart2', function () { restartLevel(); });
    ui('btnLevels2', openLevels);
    ui('btnMenu', toMenu);
    ui('btnDeadRetry', retryAttempt);
    ui('btnDeadRestart', restartLevel);
    ui('btnNext', function () { var n = cur + 1; go(function () { startLevel(n); }); });
    ui('btnReplay', function () { var n = cur; go(function () { startLevel(n); }); });
    ui('btnLevels3', openLevels);
    ui('btnFinalLevels', openLevels);
    ui('btnFinalMenu', toMenu);

    /* ----- drawing ----- */
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
    function circ(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); }

    function update(dt) {
      var k = Math.min(1, dt * 16), e = engine, i;
      vp.x += (e.player.x - vp.x) * k; vp.y += (e.player.y - vp.y) * k;
      for (i = 0; i < ve.length; i++) {
        if (!e.echoes[i]) continue;
        ve[i].x += (e.echoes[i].x - ve[i].x) * k; ve[i].y += (e.echoes[i].y - ve[i].y) * k;
      }
      e.L.doors.forEach(function (d) { doorAnim[d.id] += ((e.doorOpen[d.id] ? 1 : 0) - doorAnim[d.id]) * Math.min(1, dt * 9); });
      shake = Math.max(0, shake - dt);
      deadT = e.dead ? Math.max(0, deadT - dt * 2.5) : 1;
      for (i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 1.6;
        if (p.life <= 0) particles.splice(i, 1);
      }
      for (i = rings.length - 1; i >= 0; i--) {
        var q = rings[i];
        q.r += dt * cell * 5; q.life -= dt * 1.3;
        if (q.life <= 0) rings.splice(i, 1);
      }
    }

    function drawBackdrop(t, th, L) {
      ctx.fillStyle = th.bg; ctx.fillRect(0, 0, cw, ch);
      var full = fxOn(), i;
      if (L.theme === 'rift') {      // slow dimensional swirl behind the maze
        var cx = cw / 2, cy = ch / 2, R = Math.max(cw, ch) * 0.45;
        for (i = 0; i < 4; i++) {
          var a0 = (full ? t * (0.15 + i * 0.05) : 0) + i * 1.6;
          ctx.strokeStyle = i % 2 ? 'rgba(125,255,240,0.10)' : 'rgba(190,100,255,0.12)';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(cx, cy, R * (0.45 + i * 0.18), a0, a0 + 2.2); ctx.stroke();
        }
      }
      var n = full ? 3 : 1;
      for (i = 0; i < n; i++) {
        var fx0 = cw * (0.5 + 0.45 * Math.sin(full ? t * 0.07 + i * 2.1 : i * 2.1));
        var fy0 = ch * (0.5 + 0.4 * Math.cos(full ? t * 0.05 + i * 1.7 : i * 1.7));
        var g = ctx.createRadialGradient(fx0, fy0, 0, fx0, fy0, cw * 0.7);
        g.addColorStop(0, 'rgba(' + th.fog + ',0.10)'); g.addColorStop(1, 'rgba(' + th.fog + ',0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
      }
      if (full) {
        ctx.fillStyle = th.dot.replace(/[\d.]+\)$/, '0.5)');
        for (i = 0; i < motes.length; i++) {
          var m = motes[i];
          m.y -= m.s * 0.016; if (m.y < 0) { m.y = 1; m.x = Math.random(); }
          ctx.globalAlpha = 0.25 + 0.25 * Math.sin(t * 1.3 + m.p);
          ctx.fillRect(m.x * cw, m.y * ch, m.r, m.r);
        }
        ctx.globalAlpha = 1;
      }
    }

    function draw(t) {
      var L = engine.L, th = THEMES[L.theme] || THEMES.lab, x, y, i, j;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBackdrop(t, th, L);
      ctx.save();
      var amt = shake > 0 ? shake / 0.18 : 0;
      ctx.translate(ox + (Math.random() - 0.5) * 6 * amt, oy + (Math.random() - 0.5) * 6 * amt);

      for (y = 0; y < L.h; y++) for (x = 0; x < L.w; x++) {
        var px = x * cell, py = y * cell;
        if (L.grid[y][x] === '#') {
          ctx.fillStyle = th.wall; rr(px + 1, py + 1, cell - 2, cell - 2, cell * 0.16); ctx.fill();
          ctx.strokeStyle = th.edge; ctx.lineWidth = 1.5; ctx.stroke();
        } else {
          ctx.fillStyle = th.floor; rr(px + 2, py + 2, cell - 4, cell - 4, cell * 0.12); ctx.fill();
          ctx.fillStyle = th.dot; ctx.fillRect(px + cell / 2 - 1, py + cell / 2 - 1, 2, 2);
        }
      }

      // exit portal
      var ex = (L.exit.x + 0.5) * cell, ey = (L.exit.y + 0.5) * cell;
      var pr = cell * (0.26 + 0.04 * Math.sin(t * 3)), rift = L.theme === 'rift';
      glow(rift ? '#c04bff' : '#7dfff0', 16); ctx.strokeStyle = '#7dfff0'; ctx.lineWidth = 2.5;
      circ(ex, ey, pr); ctx.stroke();
      ctx.beginPath(); ctx.arc(ex, ey, cell * 0.38, t * 2, t * 2 + 3.8); ctx.stroke();
      if (rift) {
        ctx.strokeStyle = '#c04bff';
        ctx.beginPath(); ctx.arc(ex, ey, cell * 0.46, -t * 1.6, -t * 1.6 + 2.6); ctx.stroke();
        ctx.beginPath(); ctx.arc(ex, ey, cell * 0.16, t * 4, t * 4 + 4); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(125,255,240,0.25)'; circ(ex, ey, pr * 0.6); ctx.fill();
      noGlow();

      // controls (plates = rings, latch switches = diamonds)
      L.controls.forEach(function (c) {
        var cx = (c.x + 0.5) * cell, cy = (c.y + 0.5) * cell, on = engine.active[c.id];
        var col = on ? '#39ff88' : (c.kind === 'latch' ? '#b78cff' : '#ffb020');
        glow(col, on ? 20 : 10); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 3;
        if (c.kind === 'plate') {
          circ(cx, cy, cell * 0.28); ctx.stroke();
          ctx.globalAlpha = on ? 0.55 : 0.18; circ(cx, cy, cell * (on ? 0.2 : 0.14)); ctx.fill();
        } else {
          var s = cell * 0.24;
          ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy); ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s, cy); ctx.closePath(); ctx.stroke();
          ctx.globalAlpha = on ? 0.6 : 0.15; ctx.fill();
        }
        ctx.globalAlpha = 1; noGlow();
      });

      // doors: sliding panels + one dot per required control
      L.doors.forEach(function (d) {
        var dx = d.x * cell, dy = d.y * cell, a = doorAnim[d.id], half = cell / 2;
        var pw = Math.max(0, half * (1 - a));
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
        var n = d.needs.length;
        for (i = 0; i < n; i++) {
          var ok = engine.active[d.needs[i]];
          ctx.fillStyle = ok ? '#39ff88' : 'rgba(255,255,255,0.35)';
          circ(dx + cell / 2 + (i - (n - 1) / 2) * cell * 0.2, dy + cell * 0.5, cell * 0.055); ctx.fill();
        }
      });

      // lasers: emitters + beam (bright = deadly, flicker = about to fire)
      L.lasers.forEach(function (l) {
        var lx = l.x * cell, ly = l.y * cell, on = engine.laserOn(l, engine.tick), warn = engine.laserWarn(l, engine.tick);
        ctx.fillStyle = on ? '#ff2d55' : '#7a2a44';
        ctx.fillRect(lx + cell * 0.38, ly + 1, cell * 0.24, cell * 0.14);
        ctx.fillRect(lx + cell * 0.38, ly + cell - cell * 0.14 - 1, cell * 0.24, cell * 0.14);
        if (on) {
          glow('#ff2d55', 16); ctx.strokeStyle = '#ff5a7a'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(lx + cell / 2, ly + cell * 0.14); ctx.lineTo(lx + cell / 2, ly + cell * 0.86); ctx.stroke(); noGlow();
        } else if (warn) {
          ctx.strokeStyle = 'rgba(255,170,60,' + (0.45 + 0.35 * Math.sin(t * 24)) + ')'; ctx.lineWidth = 3;
          ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(lx + cell / 2, ly + cell * 0.14); ctx.lineTo(lx + cell / 2, ly + cell * 0.86); ctx.stroke(); ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = 'rgba(255,60,100,0.14)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(lx + cell / 2, ly + cell * 0.14); ctx.lineTo(lx + cell / 2, ly + cell * 0.86); ctx.stroke();
        }
      });

      // echo trails, then echoes (diamond silhouette, dashed outline, glitch offset)
      for (i = 0; i < trail.length; i++) {
        var tc = trail[i];
        ctx.globalAlpha = 0.05 + 0.03 * i; ctx.fillStyle = ECHO_COLORS[tc.i % 2];
        circ((tc.x + 0.5) * cell, (tc.y + 0.5) * cell, cell * 0.22); ctx.fill();
      }
      for (i = 0; i < ve.length; i++) {
        var ecx = (ve[i].x + 0.5) * cell, ecy = (ve[i].y + 0.5) * cell, s2 = cell * 0.3;
        var col2 = ECHO_COLORS[i % 2], lt = ECHO_LIGHT[i % 2];
        ctx.globalAlpha = 0.5 + 0.12 * Math.sin(t * 7 + i);
        glow(col2, 20); ctx.fillStyle = col2;
        ctx.beginPath(); ctx.moveTo(ecx, ecy - s2); ctx.lineTo(ecx + s2, ecy); ctx.lineTo(ecx, ecy + s2); ctx.lineTo(ecx - s2, ecy); ctx.closePath(); ctx.fill();
        noGlow(); ctx.globalAlpha = 0.9; ctx.strokeStyle = lt; ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]); circ(ecx, ecy, cell * 0.36); ctx.stroke(); ctx.setLineDash([]);
        if (fxOn() && Math.sin(t * 5 + i * 2) > 0.85) {
          ctx.globalAlpha = 0.25; ctx.strokeStyle = '#27e6ff';
          ctx.beginPath(); ctx.moveTo(ecx - s2 + 3, ecy); ctx.lineTo(ecx + 3, ecy - s2); ctx.lineTo(ecx + s2 + 3, ecy); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = 1;

      // player (round, solid cyan) - fades out when destroyed
      var ppx = (vp.x + 0.5) * cell, ppy = (vp.y + 0.5) * cell;
      if (deadT > 0.01) {
        ctx.globalAlpha = deadT;
        glow(engine.dead ? '#ff2d55' : '#27e6ff', 22); ctx.fillStyle = engine.dead ? '#ff5a7a' : '#27e6ff';
        circ(ppx, ppy, cell * 0.27); ctx.fill();
        noGlow(); ctx.fillStyle = '#eaffff'; circ(ppx, ppy, cell * 0.11); ctx.fill();
        ctx.globalAlpha = 1;
      }

      for (j = 0; j < rings.length; j++) {
        var q = rings[j];
        ctx.globalAlpha = Math.max(0, q.life); ctx.strokeStyle = q.c; ctx.lineWidth = 2.5;
        circ(q.x, q.y, q.r); ctx.stroke();
      }
      for (j = 0; j < particles.length; j++) {
        var p = particles[j];
        ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(vig, 0, 0);
    }

    function frame(ts) {
      var dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
      last = ts;
      update(dt); draw(ts / 1000);
      requestAnimationFrame(frame);          // the ONLY rAF loop; it is started once below
    }

    buildLevelCards(); refreshLevels();
    resize(); snap(); refreshTitle(); refreshSettings(); showScreen('scrTitle');
    requestAnimationFrame(frame);
    return {
      engine: function () { return engine; }, act: act, loop: doLoop, startLevel: startLevel,
      getState: function () { return state; }, getSave: function () { return save; },
      level: function () { return cur; }
    };
  }

  var api = { Engine: Engine, LEVELS: LEVELS, Save: Save, parseLevel: parseLevel, startUI: startUI };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') {
    var boot = function () { root.ShadowLoop = startUI(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
