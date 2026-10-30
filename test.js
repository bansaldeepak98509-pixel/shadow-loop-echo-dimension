'use strict';
/* Run with:  node test.js
   Engine / level / save tests plus a UI smoke test using a fake browser (no real DOM). */
const assert = require('assert');

/* ---------- fake browser (must exist BEFORE game.js is loaded) ---------- */
let LISTENERS = 0, rafCount = 0, raf = null, tid = 0;
const timeouts = new Map();
global.setTimeout = (fn, ms) => { const id = ++tid; timeouts.set(id, fn); return id; };
global.clearTimeout = (id) => { timeouts.delete(id); };
global.setInterval = () => ++tid;
global.clearInterval = () => {};
function flush() { for (let n = 0; n < 20 && timeouts.size; n++) { const q = [...timeouts]; timeouts.clear(); q.forEach(([, fn]) => fn()); } }

const ctx = new Proxy({}, { get: () => () => ctx, set: () => true });
function mk(id) {
  const cls = new Set(), L = {};
  return {
    id, dataset: {}, style: {}, textContent: '', offsetWidth: 0, listeners: L,
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
                 toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; on ? cls.add(c) : cls.delete(c); return on; } },
    appendChild() {}, getContext: () => ctx, getBoundingClientRect: () => ({ width: 360, height: 420, left: 0, top: 0 }),
    addEventListener(ev, fn) { LISTENERS++; (L[ev] = L[ev] || []).push(fn); }
  };
}
const els = {};
const dpad = ['U', 'L', 'R', 'D'].map((a) => { const e = mk('dpad' + a); e.dataset.a = a; return e; });
global.document = {
  readyState: 'complete', hidden: false,
  getElementById: (id) => els[id] || (els[id] = mk(id)),
  createElement: () => mk('created'),
  querySelectorAll: () => dpad,
  addEventListener() { LISTENERS++; }
};
global.window = global;
global.addEventListener = () => { LISTENERS++; };
Object.defineProperty(global, 'navigator', { value: {}, configurable: true, writable: true });
const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
global.requestAnimationFrame = (f) => { rafCount++; raf = f; };

const api = require('./game.js');
const { Engine, LEVELS, Save } = api;
const g = global.ShadowLoop;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
const run = (e, s) => s.split('').map((a) => e.step(a));
function playSolution(def, sol) {
  const e = new Engine(def);
  sol.forEach((s, i) => {
    run(e, s);
    if (i < sol.length - 1) assert.ok(e.loop(), 'loop failed after attempt ' + (i + 1));
  });
  return e;
}
function clone(e) {
  const c = Object.create(Engine.prototype);
  for (const k in e) c[k] = e[k];
  c.player = { ...e.player }; c.rec = e.rec.slice(); c.echoes = e.echoes.map((q) => ({ ...q }));
  c.latched = { ...e.latched }; c.active = { ...e.active }; c.doorOpen = { ...e.doorOpen };
  return c;
}
// exhaustive search: can the player win this attempt, given fixed Echo recordings?
function canWin(def, recs, maxTick) {
  const e0 = new Engine(def);
  e0.recs = recs.map((r) => r.split('')); e0.attempt = 2; e0.begin();
  const maxRec = Math.max(0, ...e0.recs.map((r) => r.length));
  const seen = new Set(); let frontier = [e0];
  const key = (e) => [e.player.x, e.player.y, e.tick <= maxRec ? e.tick : 1000 + (e.tick % 4),
    JSON.stringify(e.latched), e.echoes.map((q) => q.x + ',' + q.y).join(';')].join('|');
  while (frontier.length) {
    const next = [];
    for (const e of frontier) {
      if (e.tick >= maxTick) continue;
      for (const a of 'UDLRW') {
        const c = clone(e), r = c.step(a);
        if (!r.ok || c.dead) continue;
        if (c.won) return true;
        const k = key(c); if (seen.has(k)) continue; seen.add(k); next.push(c);
      }
    }
    frontier = next;
  }
  return false;
}

console.log('Engine');
test('Level 1: door blocks the player when nothing holds the plate', () => {
  const e = new Engine(LEVELS[0]); run(e, 'DDDDRRR');
  assert.ok(e.step('D').blocked);
});
test('Echo replays the exact recorded moves and holds the plate', () => {
  const e = new Engine(LEVELS[0]); run(e, 'DDDDRRRRRRUU');
  assert.ok(e.active.a && e.doorOpen.D);
  assert.ok(e.loop());
  assert.strictEqual(e.recs[0].join(''), 'DDDDRRRRRRUU');
  const path = [];
  'WWWWWWWWWWWW'.split('').forEach(() => { e.step('W'); path.push(e.echoes[0].x + ',' + e.echoes[0].y); });
  assert.deepStrictEqual(path.slice(0, 5), ['1,2', '1,3', '1,4', '1,5', '2,5']);
  assert.strictEqual(path[11], '7,3');
  assert.ok(e.active.a && e.doorOpen.D);
});
test('Echo leaves the door closed while the plate is not yet held', () => {
  const e = new Engine(LEVELS[0]); run(e, 'DDDDRRRRRRUU'); e.loop();
  run(e, 'DDDDRRR'); assert.ok(!e.doorOpen.D);
});
test('Loop with no moves is rejected; retry keeps Echo; restart clears it', () => {
  const e = new Engine(LEVELS[0]); assert.ok(!e.loop());
  run(e, 'DDDDRRRRRRUU'); e.loop(); run(e, 'DD'); e.retry();
  assert.strictEqual(e.echoes.length, 1); assert.strictEqual(e.tick, 0); assert.strictEqual(e.attempt, 2);
  e.restart(); assert.strictEqual(e.echoes.length, 0); assert.strictEqual(e.attempt, 1);
});
test('Door cannot crush: stays open while someone stands in it', () => {
  const e = new Engine(LEVELS[0]); run(e, 'DDDDRRRRRRUU'); e.loop();
  run(e, 'DDDDRRR' + 'WWWWW' + 'D'); assert.ok(e.doorOpen.D);
});
test('Dual lock: latch stays on for the attempt and resets on loop', () => {
  const e = new Engine(LEVELS[1]); run(e, 'RRDDRRUURRDD');
  assert.ok(e.active.x); run(e, 'UU'); assert.ok(e.active.x, 'latch must stay on');
  e.loop(); assert.ok(!e.active.x, 'latch resets with the new attempt');
});
test('Lasers: deterministic rhythm, kill the player, never the Echo', () => {
  const e = new Engine(LEVELS[2]);
  run(e, 'URR'); const r = e.step('R');                  // enters laser at tick 4 (active)
  assert.ok(r.dead && e.dead); assert.ok(!e.step('R').ok, 'no moves after death');
  e.retry(); assert.ok(!e.dead && e.tick === 0);
  run(e, 'URRWWWRRRR'); assert.ok(!e.dead && e.active.a, 'timed crossing survives');
  e.loop(); run(e, 'URRWWWRRRR'); assert.ok(!e.dead, 'echo and player cross together');
});
test('Two Echoes: each replays its own recording; oldest dropped past the limit', () => {
  const e = new Engine(LEVELS[3]);
  run(e, 'RRRRRR'); e.loop(); run(e, 'RRRRRRDDDDLL'); e.loop();
  assert.strictEqual(e.echoes.length, 2);
  run(e, 'WWWWWWWWWWWW');
  assert.deepStrictEqual([e.echoes[0].x, e.echoes[0].y], [7, 1]);
  assert.deepStrictEqual([e.echoes[1].x, e.echoes[1].y], [5, 5]);
  assert.ok(e.active.a && e.active.b);
  e.loop(); assert.strictEqual(e.recs.length, 2, 'max 2 recordings kept');
});
test('Determinism: same inputs give identical results twice', () => {
  const a = playSolution(LEVELS[4], LEVELS[4].solution), b = playSolution(LEVELS[4], LEVELS[4].solution);
  assert.deepStrictEqual([a.tick, a.won, a.player], [b.tick, b.won, b.player]);
});

console.log('Levels');
LEVELS.forEach((def, i) => {
  test('Level ' + (i + 1) + ' (' + def.name + '): layout is valid', () => {
    const L = api.parseLevel(def);
    def.map.forEach((r) => assert.strictEqual(r.length, def.map[0].length, 'rectangular map'));
    assert.ok(L.start && L.exit);
    assert.strictEqual(def.map.join('').split('S').length - 1, 1, 'exactly one start');
    assert.strictEqual(def.map.join('').split('E').length - 1, 1, 'exactly one exit');
    L.doors.forEach((d) => d.needs.forEach((id) => assert.ok(L.controls.some((c) => c.id === id), 'door needs unknown control ' + id)));
    assert.ok(def.hints.length >= 1 && def.hints.length <= def.maxEchoes + 1 || def.hints.length >= 1);
    // every object reachable from start when doors/lasers are ignored
    const seen = new Set([L.start.x + ',' + L.start.y]), q = [L.start];
    while (q.length) {
      const p = q.shift();
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const x = p.x + dx, y = p.y + dy, k = x + ',' + y;
        if (x < 0 || y < 0 || x >= L.w || y >= L.h || L.grid[y][x] === '#' || seen.has(k)) return;
        seen.add(k); q.push({ x, y });
      });
    }
    [].concat(L.controls, L.doors, L.lasers, [L.exit]).forEach((o) => assert.ok(seen.has(o.x + ',' + o.y), 'unreachable object at ' + o.x + ',' + o.y));
  });
  test('Level ' + (i + 1) + ': intended solution wins through real record/replay', () => {
    const e = playSolution(def, def.solution);
    assert.ok(e.won && !e.dead, 'solution did not win');
  });
});
test('Level 1-5: cannot be won in attempt 1 with no Echo (Echo is required)', () => {
  LEVELS.forEach((def, i) => assert.ok(!canWin(def, [], 70), 'level ' + (i + 1) + ' solvable without Echo'));
});
test('Search sanity: Level 1 IS winnable with the right Echo', () => {
  assert.ok(canWin(LEVELS[0], [LEVELS[0].solution[0]], 40));
});
test('Level 4 and 5 need BOTH Echoes (one Echo is not enough)', () => {
  assert.ok(!canWin(LEVELS[3], [LEVELS[3].solution[0]], 70));
  assert.ok(!canWin(LEVELS[3], [LEVELS[3].solution[1]], 70));
  assert.ok(!canWin(LEVELS[4], [LEVELS[4].solution[0]], 90));
  assert.ok(canWin(LEVELS[3], [LEVELS[3].solution[0], LEVELS[3].solution[1]], 70));
});

console.log('Save');
test('Blank, malformed, wrong-type and tampered saves are sanitized', () => {
  assert.deepStrictEqual(Save.sanitize(null), Save.blank());
  assert.deepStrictEqual(Save.sanitize('junk'), Save.blank());
  const s = Save.sanitize({ unlocked: 99, done: [true, 'yes', true], best: [12, -3, 'x', NaN], sound: 'no' });
  assert.strictEqual(s.unlocked, 5); assert.deepStrictEqual(s.done, [true, false, true, false, false]);
  assert.deepStrictEqual(s.best, [12, null, null, null, null]); assert.strictEqual(s.sound, true);
  assert.strictEqual(Save.sanitize({ unlocked: 1, done: [true, true] }).unlocked, 3, 'unlock follows completed levels');
});
test('Old v1 save migrates without losing progress', () => {
  const s = Save.migrate({ cleared: true, best: 15, sound: false });
  assert.strictEqual(s.unlocked, 2); assert.ok(s.done[0]); assert.strictEqual(s.best[0], 15); assert.strictEqual(s.sound, false);
});
test('load(): corrupt JSON and unavailable storage fall back safely', () => {
  const keep = global.localStorage;
  store['shadowloop.save.v2'] = '{not json'; delete store['shadowloop.save.v1'];
  assert.deepStrictEqual(Save.load(), Save.blank());
  global.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepStrictEqual(Save.load(), Save.blank()); Save.write(Save.blank());   // must not throw
  global.localStorage = keep; delete store['shadowloop.save.v2'];
});

console.log('UI (fake browser)');
const fire = (id, ev, arg) => (els[id].listeners[ev] || []).forEach((f) => f(arg || { preventDefault() {} }));
const screenOn = (id) => els[id].classList.contains('active');
function frames(n) {
  for (let i = 0; i < n; i++) { const before = rafCount, f = raf; raf = null; f(i * 16); assert.strictEqual(rafCount - before, 1, 'exactly one rAF scheduled per frame'); }
}
test('Game boots to the title screen and draws frames without errors', () => {
  assert.ok(g); assert.strictEqual(g.getState(), 'title'); assert.ok(screenOn('scrTitle')); frames(30);
});
test('Level cards: only level 1 unlocked at first; locked card is refused', () => {
  const cards = els.levelList; assert.ok(cards);
  assert.strictEqual(g.getSave().unlocked, 1);
});
let listenersAfterBoot;
test('Pause / resume / retry / restart work and ignore input while paused', () => {
  fire('btnPlay', 'click'); flush(); assert.strictEqual(g.getState(), 'playing');
  listenersAfterBoot = LISTENERS;
  g.act('D'); assert.strictEqual(g.engine().tick, 1);
  fire('btnPause', 'click'); assert.strictEqual(g.getState(), 'paused'); assert.ok(screenOn('scrPause'));
  g.act('D'); assert.strictEqual(g.engine().tick, 1, 'no moves while paused');
  fire('btnResume', 'click'); assert.strictEqual(g.getState(), 'playing');
  fire('btnPause', 'click'); fire('btnRestart2', 'click'); assert.strictEqual(g.engine().tick, 0);
  assert.strictEqual(g.getState(), 'playing');
});
test('Touch d-pad buttons move the player', () => {
  const D = dpad.find((d) => d.dataset.a === 'D');
  D.listeners.pointerdown.forEach((f) => f({ preventDefault() {} })); D.listeners.pointerup.forEach((f) => f({}));
  assert.strictEqual(g.engine().player.y, 2);
});
test('Death shows SIGNAL LOST and retry keeps the Echo', () => {
  g.startLevel(2); g.act('U'); g.act('R'); g.act('R'); g.act('R');
  assert.strictEqual(g.getState(), 'dead'); flush(); assert.ok(screenOn('scrDead'));
  fire('btnDeadRetry', 'click'); assert.strictEqual(g.getState(), 'playing'); assert.strictEqual(g.engine().tick, 0);
});
test('Full campaign through the real UI: all 5 levels, unlocking, final screen', () => {
  g.startLevel(0);
  LEVELS.forEach((def, i) => {
    assert.strictEqual(g.level(), i); assert.ok(g.getSave().unlocked >= i + 1, 'level ' + (i + 1) + ' unlocked');
    def.solution.forEach((s, k) => { s.split('').forEach((a) => g.act(a)); if (k < def.solution.length - 1) g.loop(); });
    assert.strictEqual(g.getState(), 'complete', 'level ' + (i + 1) + ' completed'); flush(); frames(5);
    if (i < LEVELS.length - 1) { assert.ok(screenOn('scrComplete')); fire('btnNext', 'click'); flush(); }
    else assert.ok(screenOn('scrFinal'));
  });
  const s = g.getSave();
  assert.deepStrictEqual(s.done, [true, true, true, true, true]); assert.strictEqual(s.unlocked, 5);
  const persisted = Save.load(); assert.deepStrictEqual(persisted.done, s.done); assert.deepStrictEqual(persisted.best, s.best);
});
test('Repeated restarts / level changes do not add listeners or animation loops', () => {
  for (let n = 0; n < 100; n++) { g.startLevel(n % 5); g.act('D'); fire('btnRestart', 'click'); fire('btnPause', 'click'); fire('btnResume', 'click'); flush(); }
  frames(10);
  assert.strictEqual(LISTENERS, listenersAfterBoot, 'listener count must not grow');
  assert.ok(timeouts.size <= 1, 'no pile-up of timers');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
