
'use strict';
/* Run with:  node test.js
   WHAT THESE TESTS ARE (and are not):
     LOGIC    pure JavaScript (engine, levels, save, hints) - no mocks needed
     MOCK-UI  the game UI driven in a FAKE browser (no real DOM, no WebView)
     MOCK-ADS rewarded-ad / consent code driven by a FAKE AdMob plugin written by us
     FIXTURE  scripts/configure-android.js run against FABRICATED android/ and node_modules/ folders
   No test in this file runs native Android code, the real AdMob plugin, Gradle, an emulator or a device.
   "Native Android integration tests run: 0" is printed at the end on purpose. */
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), crypto = require('crypto');

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
    id, dataset: {}, style: {}, textContent: '', offsetWidth: 0, disabled: false, listeners: L,
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
                 toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; on ? cls.add(c) : cls.delete(c); return on; } },
    appendChild() {}, getContext: () => ctx, getBoundingClientRect: () => ({ width: 360, height: 420, left: 0, top: 0 }),
    addEventListener(ev, fn) { LISTENERS++; (L[ev] = L[ev] || []).push(fn); }
  };
}
let els = {}, dpad = [];
function resetDom() {
  els = {};
  dpad = ['U', 'L', 'R', 'D'].map((a) => { const e = mk('dpad' + a); e.dataset.a = a; return e; });
}
resetDom();
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
let store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
global.requestAnimationFrame = (f) => { rafCount++; raf = f; };

const api = require('./game.js');
const { Engine, LEVELS, Save, Ads, ADS_CONFIG, AD_EVENTS, TutorialFlow } = api;
const firstLaunchUI = global.ShadowLoop;      // booted automatically with empty storage = first launch

const queue = []; let curKind = 'LOGIC';
function test(name, fn) { queue.push({ name, fn, kind: curKind }); }
function section(t, kind) { if (kind) curKind = kind; queue.push({ section: '[' + curKind + '] ' + t }); }
const run = (e, s) => s.split('').map((a) => e.step(a));
const sleep = () => new Promise((r) => setImmediate(r));
async function settle() { for (let i = 0; i < 12; i++) await sleep(); }
function playSolution(def, sol) {
  const e = new Engine(def);
  sol.forEach((s, i) => { run(e, s); if (i < sol.length - 1) assert.ok(e.loop(), 'loop failed after attempt ' + (i + 1)); });
  return e;
}
function clone(e) {
  const c = Object.create(Engine.prototype);
  for (const k in e) c[k] = e[k];
  c.player = { ...e.player }; c.rec = e.rec.slice(); c.echoes = e.echoes.map((q) => ({ ...q }));
  c.latched = { ...e.latched }; c.active = { ...e.active }; c.doorOpen = { ...e.doorOpen };
  return c;
}
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
section('Engine (Echo mechanics unchanged)', 'LOGIC');
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

section('Levels', 'LOGIC');
LEVELS.forEach((def, i) => {
  test('Level ' + (i + 1) + ' (' + def.name + '): layout is valid', () => {
    const L = api.parseLevel(def);
    def.map.forEach((r) => assert.strictEqual(r.length, def.map[0].length, 'rectangular map'));
    assert.ok(L.start && L.exit);
    assert.strictEqual(def.map.join('').split('S').length - 1, 1, 'exactly one start');
    assert.strictEqual(def.map.join('').split('E').length - 1, 1, 'exactly one exit');
    L.doors.forEach((d) => d.needs.forEach((id) => assert.ok(L.controls.some((c) => c.id === id), 'door needs unknown control ' + id)));
    assert.ok(def.hints.length >= 1);
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
test('Phase 1 BASELINE fingerprint: all 5 levels + solutions and the whole Engine are unchanged', () => {
  const strip = (l) => { const o = { ...l }; delete o.goal; delete o.tips; return o; };
  const lv = crypto.createHash('sha256').update(JSON.stringify(LEVELS.map(strip))).digest('hex');
  const src = [Engine.toString(), api.parseLevel.toString()].concat(Object.getOwnPropertyNames(Engine.prototype).filter((k) => k !== 'constructor').sort().map((k) => k + ':' + Engine.prototype[k].toString())).join('\n');
  const en = crypto.createHash('sha256').update(src).digest('hex');
  assert.strictEqual(lv, '4bdf49cde6ed4f910276322f5d6b37169aaa92961420b86261ce35caeab730f7', 'levels/solutions drifted from Phase 1');
  assert.strictEqual(en, 'af28d3c2d515a2c021589393db92df8eeda3cc69bf042f3f34d0e0ec6d5d00ee', 'Engine drifted from Phase 1');
  assert.strictEqual(Save.KEY, 'shadowloop.save.v2');
});
test('Level 4 and 5 need BOTH Echoes (one Echo is not enough)', () => {
  assert.ok(!canWin(LEVELS[3], [LEVELS[3].solution[0]], 70));
  assert.ok(!canWin(LEVELS[3], [LEVELS[3].solution[1]], 70));
  assert.ok(!canWin(LEVELS[4], [LEVELS[4].solution[0]], 90));
  assert.ok(canWin(LEVELS[3], [LEVELS[3].solution[0], LEVELS[3].solution[1]], 70));
});

section('Save', 'LOGIC');
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


section('Save (Phase 2 fields)', 'LOGIC');
test('Tutorial flag and per-level hints: defaults, clamping, garbage input', () => {
  const b = Save.blank(); assert.strictEqual(b.tutorial, false); assert.deepStrictEqual(b.hints, [0, 0, 0, 0, 0]);
  const s = Save.sanitize({ hints: [1, 7, -2, 'x', 3.9], tutorial: 'yes' });
  assert.deepStrictEqual(s.hints, [1, 3, 0, 0, 3]); assert.strictEqual(s.tutorial, false);
  assert.strictEqual(Save.sanitize({ tutorial: true }).tutorial, true);
});
test('Existing players (any cleared level) never get the auto tutorial; v1 migration too', () => {
  assert.strictEqual(Save.sanitize({ done: [true] }).tutorial, true);
  assert.strictEqual(Save.migrate({ cleared: true, best: 9 }).tutorial, true);
  assert.strictEqual(Save.migrate({ cleared: false }).tutorial, false);
});
test('privacyOptions flag: default false, only a real boolean is accepted', () => {
  assert.strictEqual(Save.blank().privacyOptions, false);
  assert.strictEqual(Save.sanitize({ privacyOptions: true }).privacyOptions, true);
  assert.strictEqual(Save.sanitize({ privacyOptions: 'yes' }).privacyOptions, false);
  assert.strictEqual(Save.sanitize({ done: [true] }).privacyOptions, false);
});
test('Phase 1 save (no tutorial/hints fields) loads with progress intact', () => {
  const s = Save.sanitize({ v: 2, unlocked: 3, done: [true, true, false, false, false], best: [14, 20, null, null, null], sound: false, fx: false });
  assert.strictEqual(s.unlocked, 3); assert.deepStrictEqual(s.best.slice(0, 2), [14, 20]); assert.strictEqual(s.sound, false);
  assert.deepStrictEqual(s.hints, [0, 0, 0, 0, 0]);
});

section('Hints: content validated against the real puzzles', 'LOGIC');
const TOKEN = /(Up|Down|Left|Right|Wait) (\d+)/g, NAME = { U: 'Up', D: 'Down', L: 'Left', R: 'Right', W: 'Wait' };
const rle = (s) => { const o = []; for (const ch of s) { const n = NAME[ch]; if (o.length && o[o.length - 1][0] === n) o[o.length - 1][1]++; else o.push([n, 1]); } return o; };
function parseWalkthrough(text) {
  return text.split('\n').map((line) => { const m = []; let r; TOKEN.lastIndex = 0; while ((r = TOKEN.exec(line))) m.push([r[1], +r[2]]); return m; });
}
LEVELS.forEach((def, i) => {
  test('Level ' + (i + 1) + ': three non-empty, distinct hints exist', () => {
    assert.strictEqual(def.tips.length, 3);
    def.tips.forEach((t) => assert.ok(typeof t === 'string' && t.length > 40));
    assert.strictEqual(new Set(def.tips).size, 3);
    assert.ok(def.goal && def.goal.length > 10);
  });
  test('Level ' + (i + 1) + ': hint 3 matches the intended solution move-for-move', () => {
    const lines = parseWalkthrough(def.tips[2]);
    assert.strictEqual(lines.length, def.solution.length, 'one line per attempt');
    lines.forEach((m, k) => assert.deepStrictEqual(m, rle(def.solution[k]), 'attempt ' + (k + 1)));
  });
  test('Level ' + (i + 1) + ': following ONLY the moves written in hint 3 really wins', () => {
    const NAMEINV = { Up: 'U', Down: 'D', Left: 'L', Right: 'R', Wait: 'W' };
    const attempts = parseWalkthrough(def.tips[2]).map((m) => m.map(([n, c]) => NAMEINV[n].repeat(c)).join(''));
    const e = playSolution(def, attempts);
    assert.ok(e.won && !e.dead);
  });
  test('Level ' + (i + 1) + ': hints 1 and 2 do not spell out the move list', () => {
    TOKEN.lastIndex = 0; assert.ok(!TOKEN.test(def.tips[0]));
    TOKEN.lastIndex = 0; assert.ok(!TOKEN.test(def.tips[1]));
  });
});
test('Hint wording matches real rules (spot checks)', () => {
  assert.ok(/switch/i.test(LEVELS[1].tips[0]) && /plate/i.test(LEVELS[1].tips[0]));
  assert.ok(/ghost|safely/i.test(LEVELS[2].tips[1]) && /only hurt you/i.test(LEVELS[2].tips[1]));
  assert.ok(/second plate/i.test(LEVELS[3].tips[1]) && /Echo 1/.test(LEVELS[3].tips[1]));
  assert.ok(/switch/i.test(LEVELS[4].tips[1]) && /laser/i.test(LEVELS[4].tips[1]));
});

/* ---------- UI helpers ---------- */
const fire = (id, ev, arg) => (els[id].listeners[ev] || []).forEach((f) => f(arg || { preventDefault() {} }));
const screenOn = (id) => els[id].classList.contains('active');
const hidden = (id) => els[id].classList.contains('hidden');
function frames(n) {
  for (let i = 0; i < n; i++) { const before = rafCount, f = raf; raf = null; f(i * 16); assert.strictEqual(rafCount - before, 1, 'exactly one rAF scheduled per frame'); }
}
function bootFresh(seed) {
  store = {}; if (seed) store['shadowloop.save.v2'] = JSON.stringify(seed);
  resetDom(); timeouts.clear(); Ads.setPlugin(null);
  return api.startUI();
}
function bootKeep() { resetDom(); timeouts.clear(); Ads.setPlugin(null); return api.startUI(); }
const READY = { v: 2, tutorial: true };
const EV = AD_EVENTS;
function fakePlugin(scenario) {
  const p = { scenario, calls: { init: 0, consent: 0, form: 0, prepare: 0, show: 0 }, handlers: {},
              consentInfo: { status: 'NOT_REQUIRED', isConsentFormAvailable: false }, formResult: { status: 'OBTAINED' } };
  p.initialize = async () => { p.calls.init++; };
  p.requestConsentInfo = async () => { p.calls.consent++; return p.consentInfo; };
  p.showConsentForm = async () => { p.calls.form++; return p.formResult; };
  p.privacyCalls = 0; p.privacyMode = 'ok';
  p.showPrivacyOptionsForm = async () => {
    p.privacyCalls++;
    if (p.privacyMode === 'reject') throw new Error('form failed');
    if (p.privacyMode === 'unimplemented') throw new Error('"AdMob.showPrivacyOptionsForm()" is not implemented on android');
  };
  p.addListener = async (name, fn) => { (p.handlers[name] = p.handlers[name] || []).push(fn); return { remove() { p.handlers[name] = (p.handlers[name] || []).filter((f) => f !== fn); } }; };
  p.emit = (name, arg) => (p.handlers[name] || []).slice().forEach((f) => f(arg));
  p.prepareRewardVideoAd = async (o) => {
    p.calls.prepare++; p.lastOptions = o;
    if (p.scenario === 'noFill') { p.emit(EV.failedToLoad, { message: 'No fill' }); throw new Error('No fill'); }
    if (p.scenario === 'prepareReject') throw new Error('Network error');
  };
  p.showRewardVideoAd = async () => {
    p.calls.show++;
    if (p.scenario === 'reward') { p.emit(EV.rewarded, { type: 'coin', amount: 1 }); return { type: 'coin', amount: 1 }; }
    if (p.scenario === 'rewardPromiseOnly') return { type: 'coin', amount: 1 };
    if (p.scenario === 'dismiss') { p.emit(EV.dismissed); return undefined; }
    if (p.scenario === 'failedShow') { p.emit(EV.failedToShow, { message: 'x' }); throw new Error('x'); }
    if (p.scenario === 'showReject') throw new Error('boom');
  };
  return p;
}
function openHintPanel(g, level) { g.startLevel(level); flush(); fire('btnHint', 'click'); assert.strictEqual(g.getState(), 'hint'); }
const savedHints = () => JSON.parse(store['shadowloop.save.v2']).hints;

section('Tutorial (real engine, fake browser)', 'MOCK-UI');
test('First launch: tutorial starts automatically and the title screen is skipped', () => {
  assert.ok(firstLaunchUI.getTut(), 'tutorial active'); assert.ok(!hidden('coach')); assert.ok(hidden('hintBar'));
  assert.strictEqual(firstLaunchUI.getTut().step().id, 'move'); assert.strictEqual(firstLaunchUI.getState(), 'playing');
});
test('Tutorial progression follows REAL engine state, step by step, and finishes without touching level progress', () => {
  const g = bootFresh(); const t = () => g.getTut().step().id, E = () => g.engine();
  assert.strictEqual(t(), 'move');
  g.loop(); assert.strictEqual(E().attempt, 1, 'LOOP is blocked before the plate step');
  'D'.split('').forEach((a) => g.act(a)); assert.strictEqual(t(), 'move', 'one step is not enough');
  g.act('D'); assert.strictEqual(t(), 'plate'); assert.deepStrictEqual([E().player.x, E().player.y], [1, 3]);
  'DDRRRRRR'.split('').forEach((a) => g.act(a)); assert.strictEqual(t(), 'plate', 'not on the plate yet');
  g.act('U'); assert.strictEqual(t(), 'plate'); g.act('U');
  assert.ok(E().active.a, 'plate really held by the player'); assert.strictEqual(t(), 'loop');
  assert.strictEqual(E().attempt, 1);
  g.loop(); assert.strictEqual(E().attempt, 2); assert.strictEqual(E().recs[0].join(''), 'DDDDRRRRRRUU'); assert.strictEqual(t(), 'echo');
  'DDDDRRR'.split('').forEach((a) => g.act(a));
  assert.ok(!E().doorOpen.D && t() === 'echo', 'door is NOT opened by a script, only by the Echo');
  for (let i = 0; i < 4; i++) g.act('W'); assert.ok(!E().doorOpen.D && t() === 'echo');
  g.act('W'); assert.ok(E().doorOpen.D && E().echoes[0].x === 7 && E().echoes[0].y === 3, 'Echo reached the plate'); assert.strictEqual(t(), 'exit');
  'DDD'.split('').forEach((a) => g.act(a));
  assert.strictEqual(g.getState(), 'complete'); flush(); assert.ok(screenOn('scrTutDone'));
  const s = JSON.parse(store['shadowloop.save.v2']); assert.strictEqual(s.tutorial, true);
  assert.deepStrictEqual(s.done, [false, false, false, false, false]); assert.strictEqual(s.unlocked, 1);
});
test('Tutorial completion persists: next launch goes straight to the title', () => {
  const g = bootKeep(); assert.strictEqual(g.getTut(), null); assert.ok(screenOn('scrTitle'));
});
test('Skip Tutorial: goes to the title, is saved, and does not return on next launch', () => {
  const g = bootFresh(); assert.ok(g.getTut()); fire('btnTutSkip', 'click');
  assert.strictEqual(g.getTut(), null); assert.ok(screenOn('scrTitle')); assert.strictEqual(JSON.parse(store['shadowloop.save.v2']).tutorial, true);
  const g2 = bootKeep(); assert.strictEqual(g2.getTut(), null); assert.ok(screenOn('scrTitle'));
});
test('Replay Tutorial from Settings and from the title, any time', () => {
  let g = bootFresh(READY); fire('btnSettings', 'click'); assert.ok(screenOn('scrSettings'));
  fire('btnTutorial', 'click'); assert.ok(g.getTut()); assert.strictEqual(g.getTut().step().id, 'move'); assert.strictEqual(g.getState(), 'playing');
  g = bootFresh(READY); fire('btnTutTitle', 'click'); assert.ok(g.getTut());
});
test('Existing player with progress does not see the tutorial on launch', () => {
  const g = bootFresh({ v: 2, unlocked: 2, done: [true, false, false, false, false], best: [12, null, null, null, null] });
  assert.strictEqual(g.getTut(), null); assert.ok(screenOn('scrTitle')); assert.strictEqual(g.getSave().unlocked, 2);
});
test('Tutorial restart/pause behave; leaving to the menu clears tutorial state', () => {
  const g = bootFresh(); 'DD'.split('').forEach((a) => g.act(a)); assert.strictEqual(g.getTut().step().id, 'plate');
  fire('btnPause', 'click'); assert.strictEqual(g.getState(), 'paused'); fire('btnRestart2', 'click');
  assert.strictEqual(g.getTut().step().id, 'move'); assert.strictEqual(g.engine().tick, 0); assert.strictEqual(g.getState(), 'playing');
  fire('btnPause', 'click'); fire('btnMenu', 'click'); assert.strictEqual(g.getTut(), null); assert.ok(screenOn('scrTitle'));
});
test('Tutorial does not interfere with normal levels (hint bar back, free LOOP, no leftover highlight)', () => {
  const g = bootFresh(); fire('btnTutSkip', 'click'); g.startLevel(0); flush();
  assert.strictEqual(g.getTut(), null); assert.ok(!hidden('hintBar')); assert.ok(hidden('coach'));
  assert.ok(!els.btnLoop.classList.contains('hl') && !els.dpad.classList.contains('hl'));
  g.act('D'); assert.ok(g.loop() === undefined && g.engine().attempt === 2, 'LOOP works freely outside the tutorial');
});
test('TutorialFlow unit: steps advance only forward and canLoop only on the loop step', () => {
  const e = new Engine(LEVELS[0]), t = new TutorialFlow();
  assert.ok(!t.canLoop()); run(e, 'DD'); t.update(e); assert.strictEqual(t.step().id, 'plate');
  run(e, 'DDRRRRRRUU'); t.update(e); assert.strictEqual(t.step().id, 'loop'); assert.ok(t.canLoop());
  run(e, 'DD'); t.update(e); assert.strictEqual(t.step().id, 'loop', 'never goes backwards');
});

section('Rewarded hints and AdMob reward handling (FAKE plugin)', 'MOCK-ADS');
test('Test ad unit IDs are Google sample IDs; production config is separate and empty', () => {
  assert.strictEqual(ADS_CONFIG.useTestAds, true);
  assert.strictEqual(ADS_CONFIG.test.rewardedUnitId, 'ca-app-pub-3940256099942544/5224354917');
  assert.strictEqual(ADS_CONFIG.test.appId, 'ca-app-pub-3940256099942544~3347511713');
  assert.deepStrictEqual(ADS_CONFIG.production, { appId: null, rewardedUnitId: null });
});
test('Hint panel starts fully locked; opening/closing/pausing/restarting/finishing a level NEVER triggers an ad', async () => {
  const g = bootFresh(READY); const p = fakePlugin('reward'); Ads.setPlugin(p);
  g.startLevel(0); flush(); fire('btnPause', 'click'); fire('btnResume', 'click'); fire('btnRestart', 'click');
  fire('btnHint', 'click'); assert.strictEqual(g.getState(), 'hint');
  fire('btnHintClose', 'click'); assert.strictEqual(g.getState(), 'playing');
  LEVELS[0].solution.forEach((s, k) => { s.split('').forEach((a) => g.act(a)); if (k < LEVELS[0].solution.length - 1) g.loop(); });
  flush(); await settle(); assert.ok(screenOn('scrComplete'));
  assert.deepStrictEqual(p.calls, { init: 0, consent: 0, form: 0, prepare: 0, show: 0 }, 'no ad activity without pressing Watch Ad');
  assert.deepStrictEqual(g.getSave().hints, [0, 0, 0, 0, 0]);
});
test('Watch Ad button does nothing outside the hint panel', async () => {
  const g = bootFresh(READY); const p = fakePlugin('reward'); Ads.setPlugin(p); g.startLevel(0); flush();
  fire('btnHintAd', 'click'); await settle(); assert.strictEqual(p.calls.prepare, 0); assert.strictEqual(g.getSave().hints[0], 0);
});
test('Reward ONLY after the genuine reward callback; hints unlock strictly 1 -> 2 -> 3 and persist', async () => {
  const g = bootFresh(READY); const p = fakePlugin('reward'); Ads.setPlugin(p); openHintPanel(g, 2);
  assert.ok(!hidden('btnHintAd')); assert.ok(els.btnHintAd.textContent.includes('HINT 1'));
  fire('btnHintAd', 'click'); assert.ok(els.btnHintAd.disabled, 'busy while loading'); await settle();
  assert.strictEqual(g.getSave().hints[2], 1); assert.deepStrictEqual(savedHints(), [0, 0, 1, 0, 0]);
  assert.strictEqual(p.lastOptions.adId, ADS_CONFIG.test.rewardedUnitId); assert.strictEqual(p.lastOptions.isTesting, true);
  assert.ok(els.btnHintAd.textContent.includes('HINT 2'));
  fire('btnHintAd', 'click'); await settle(); assert.strictEqual(g.getSave().hints[2], 2);
  fire('btnHintAd', 'click'); await settle(); assert.strictEqual(g.getSave().hints[2], 3); assert.ok(hidden('btnHintAd'), 'no more ads once all hints are open');
  const before = p.calls.show; fire('btnHintAd', 'click'); await settle(); assert.strictEqual(p.calls.show, before); assert.strictEqual(g.getSave().hints[2], 3);
  assert.strictEqual(p.calls.init, 1, 'plugin initialised once'); assert.strictEqual(p.calls.consent, 1, 'UMP consent info requested once');
});
test('Reward detected from the showRewardVideoAd() result too (still a real callback)', async () => {
  const g = bootFresh(READY); Ads.setPlugin(fakePlugin('rewardPromiseOnly')); openHintPanel(g, 0);
  fire('btnHintAd', 'click'); await settle(); assert.strictEqual(g.getSave().hints[0], 1);
});
for (const sc of ['dismiss', 'noFill', 'prepareReject', 'failedShow', 'showReject']) {
  test('No reward when the ad scenario is "' + sc + '" (closed early / no-fill / network / show failure)', async () => {
    const g = bootFresh(READY); Ads.setPlugin(fakePlugin(sc)); openHintPanel(g, 1);
    fire('btnHintAd', 'click'); await settle();
    assert.strictEqual(g.getSave().hints[1], 0, 'must stay locked');
    assert.ok(els.adMsg.textContent.length > 10 && /no hint|No ad|could not/i.test(els.adMsg.textContent), 'honest message: ' + els.adMsg.textContent);
    assert.ok(!els.btnHintAd.disabled, 'button usable again'); assert.strictEqual(g.getState(), 'hint', 'game not blocked');
    assert.ok(!hidden('btnHintAd'));
  });
}
test('In a plain browser (no native AdMob) nothing is granted and the message is honest', async () => {
  const g = bootFresh(READY); openHintPanel(g, 0); fire('btnHintAd', 'click'); await settle();
  assert.strictEqual(g.getSave().hints[0], 0); assert.ok(/Android app/.test(els.adMsg.textContent));
});
test('Production mode without owner IDs refuses to request any ad (no fake fallback)', async () => {
  const g = bootFresh(READY); const p = fakePlugin('reward'); Ads.setPlugin(p); openHintPanel(g, 0);
  ADS_CONFIG.useTestAds = false;
  try { fire('btnHintAd', 'click'); await settle(); } finally { ADS_CONFIG.useTestAds = true; }
  assert.strictEqual(p.calls.prepare, 0); assert.strictEqual(g.getSave().hints[0], 0); assert.ok(/not configured/.test(els.adMsg.textContent));
});
test('UMP consent: still REQUIRED after the form => no ad is requested; obtained => ad allowed', async () => {
  let g = bootFresh(READY); let p = fakePlugin('reward'); p.consentInfo = { status: 'REQUIRED', isConsentFormAvailable: true }; p.formResult = { status: 'REQUIRED' };
  Ads.setPlugin(p); openHintPanel(g, 0); fire('btnHintAd', 'click'); await settle();
  assert.strictEqual(p.calls.form, 1); assert.strictEqual(p.calls.prepare, 0); assert.strictEqual(g.getSave().hints[0], 0);
  g = bootFresh(READY); p = fakePlugin('reward'); p.consentInfo = { status: 'REQUIRED', isConsentFormAvailable: true }; p.formResult = { status: 'OBTAINED' };
  Ads.setPlugin(p); openHintPanel(g, 0); fire('btnHintAd', 'click'); await settle();
  assert.strictEqual(p.calls.form, 1); assert.strictEqual(p.calls.prepare, 1); assert.strictEqual(g.getSave().hints[0], 1);
});
test('Double-pressing Watch Ad grants at most one hint per ad', async () => {
  const g = bootFresh(READY); const p = fakePlugin('reward'); Ads.setPlugin(p); openHintPanel(g, 3);
  fire('btnHintAd', 'click'); fire('btnHintAd', 'click'); await settle();
  assert.strictEqual(g.getSave().hints[3], 1); assert.strictEqual(p.calls.show, 1);
});
test('Unlocked hints survive an app restart and open WITHOUT another ad', async () => {
  let g = bootFresh(READY); let p = fakePlugin('reward'); Ads.setPlugin(p); openHintPanel(g, 4);
  fire('btnHintAd', 'click'); await settle(); fire('btnHintAd', 'click'); await settle(); assert.strictEqual(g.getSave().hints[4], 2);
  g = bootKeep(); p = fakePlugin('reward'); Ads.setPlugin(p);
  assert.deepStrictEqual(g.getSave().hints, [0, 0, 0, 0, 2]); openHintPanel(g, 4);
  assert.deepStrictEqual(p.calls, { init: 0, consent: 0, form: 0, prepare: 0, show: 0 }, 'viewing unlocked hints needs no ad');
  assert.ok(els.btnHintAd.textContent.includes('HINT 3'));
});
test('Hints for other levels are unaffected by unlocking one level', async () => {
  const g = bootFresh(READY); Ads.setPlugin(fakePlugin('reward')); openHintPanel(g, 0); fire('btnHintAd', 'click'); await settle();
  assert.deepStrictEqual(g.getSave().hints, [1, 0, 0, 0, 0]);
});

section('Consent gate and call order (fake plugin, plugin-6.x shape: no canRequestAds)', 'MOCK-ADS');
function logged(p) {
  p.log = [];
  ['initialize', 'requestConsentInfo', 'showConsentForm', 'prepareRewardVideoAd', 'showRewardVideoAd', 'showPrivacyOptionsForm'].forEach((n) => { const f = p[n]; p[n] = (...a) => { p.log.push(n); return f(...a); }; });
  return p;
}
const V6 = (st, form) => ({ status: st, isConsentFormAvailable: !!form });                       // plugin 6.x shape
const NEW_INFO = (priv, can) => ({ status: 'NOT_REQUIRED', isConsentFormAvailable: false, canRequestAds: can !== false, privacyOptionsRequirementStatus: priv });   // >= 7.0.3 shape
const pressAd = async () => { fire('btnHintAd', 'click'); await settle(); };
const toastText = () => els.toast.textContent;

test('Order: initialize -> requestConsentInfo -> prepare -> show when consent is NOT_REQUIRED', async () => {
  const g = bootFresh(READY); const p = logged(fakePlugin('reward')); p.consentInfo = V6('NOT_REQUIRED'); Ads.setPlugin(p); openHintPanel(g, 0);
  await pressAd();
  assert.deepStrictEqual(p.log, ['initialize', 'requestConsentInfo', 'prepareRewardVideoAd', 'showRewardVideoAd']);
  assert.strictEqual(g.getSave().hints[0], 1);
});
test('REQUIRED + form available: NO ad is requested while the consent form is still open', async () => {
  const g = bootFresh(READY); const p = logged(fakePlugin('reward')); p.consentInfo = V6('REQUIRED', true);
  let finish; p.showConsentForm = () => { p.log.push('showConsentForm'); p.calls.form++; return new Promise((r) => { finish = r; }); };
  Ads.setPlugin(p); openHintPanel(g, 0); await pressAd();
  assert.deepStrictEqual(p.log, ['initialize', 'requestConsentInfo', 'showConsentForm']); assert.strictEqual(p.calls.prepare, 0);
  finish({ status: 'OBTAINED', isConsentFormAvailable: true }); await settle();
  assert.deepStrictEqual(p.log, ['initialize', 'requestConsentInfo', 'showConsentForm', 'prepareRewardVideoAd', 'showRewardVideoAd']);
  assert.strictEqual(g.getSave().hints[0], 1);
});
test('UNKNOWN status blocks ads; the refusal is NOT cached; a later OBTAINED allows ads; SDK initialised once', async () => {
  const g = bootFresh(READY); const p = logged(fakePlugin('reward')); p.consentInfo = V6('UNKNOWN'); Ads.setPlugin(p); openHintPanel(g, 0);
  await pressAd();
  assert.strictEqual(p.calls.prepare, 0); assert.strictEqual(g.getSave().hints[0], 0); assert.ok(/consent/i.test(els.adMsg.textContent));
  p.consentInfo = V6('OBTAINED'); await pressAd();
  assert.strictEqual(p.calls.consent, 2); assert.strictEqual(p.calls.prepare, 1); assert.strictEqual(g.getSave().hints[0], 1);
  assert.strictEqual(p.log.filter((n) => n === 'initialize').length, 1);
});
test('REQUIRED without an available form => no ad; form closed without consent (still REQUIRED) => no ad', async () => {
  let g = bootFresh(READY); let p = fakePlugin('reward'); p.consentInfo = V6('REQUIRED', false); Ads.setPlugin(p); openHintPanel(g, 0); await pressAd();
  assert.strictEqual(p.calls.prepare, 0); assert.strictEqual(g.getSave().hints[0], 0);
  g = bootFresh(READY); p = fakePlugin('reward'); p.consentInfo = V6('REQUIRED', true); p.formResult = V6('REQUIRED', true); Ads.setPlugin(p); openHintPanel(g, 0); await pressAd();
  assert.strictEqual(p.calls.form, 1); assert.strictEqual(p.calls.prepare, 0); assert.strictEqual(g.getSave().hints[0], 0);
});
test('Form call returns nothing usable => consent is re-requested (not guessed): OBTAINED allows, REQUIRED blocks', async () => {
  for (const [second, expectAd] of [['OBTAINED', 1], ['REQUIRED', 0]]) {
    const g = bootFresh(READY); const p = fakePlugin('reward'); let n = 0;
    p.requestConsentInfo = async () => { p.calls.consent++; return n++ === 0 ? V6('REQUIRED', true) : V6(second, true); };
    p.showConsentForm = async () => { p.calls.form++; return undefined; };
    Ads.setPlugin(p); openHintPanel(g, 0); await pressAd();
    assert.strictEqual(p.calls.consent, 2); assert.strictEqual(p.calls.prepare, expectAd); assert.strictEqual(g.getSave().hints[0], expectAd);
  }
});
test('canRequestAds (plugin >= 7.0.3) is honoured: false blocks, true cannot override REQUIRED', async () => {
  const cases = [[{ status: 'OBTAINED', isConsentFormAvailable: false, canRequestAds: false }, 0], [{ status: 'REQUIRED', isConsentFormAvailable: false, canRequestAds: true }, 0],
                 [{ status: 'NOT_REQUIRED', isConsentFormAvailable: false, canRequestAds: true }, 1], [{ canRequestAds: true }, 1]];
  for (const [info, expectAd] of cases) {
    const g = bootFresh(READY); const p = fakePlugin('reward'); p.consentInfo = info; Ads.setPlugin(p); openHintPanel(g, 0); await pressAd();
    assert.strictEqual(p.calls.prepare, expectAd, JSON.stringify(info));
  }
});
test('Status spelling variants allowed; garbage / missing consent info blocked', async () => {
  const cases = [[V6('notRequired'), 1], [V6('obtained'), 1], [V6('NOT_REQUIRED'), 1], [V6('weird'), 0], [V6(undefined), 0], [undefined, 0], [null, 0], ['x', 0]];
  for (const [info, expectAd] of cases) {
    const g = bootFresh(READY); const p = fakePlugin('reward'); p.consentInfo = info; Ads.setPlugin(p); openHintPanel(g, 0); await pressAd();
    assert.strictEqual(p.calls.prepare, expectAd, JSON.stringify(info)); assert.strictEqual(g.getSave().hints[0], expectAd);
  }
});
test('requestConsentInfo / showConsentForm / initialize failures block ads with an honest message', async () => {
  for (const which of ['initialize', 'requestConsentInfo', 'showConsentForm']) {
    const g = bootFresh(READY); const p = fakePlugin('reward'); p.consentInfo = V6('REQUIRED', true);
    p[which] = async () => { throw new Error(which + ' failed'); }; Ads.setPlugin(p); openHintPanel(g, 0); await pressAd();
    assert.strictEqual(p.calls.prepare, 0, which); assert.strictEqual(g.getSave().hints[0], 0); assert.ok(/could not start/i.test(els.adMsg.textContent), els.adMsg.textContent);
  }
});
test('Plugin acquired through Capacitor.registerPlugin("AdMob") when the native build includes it', () => {
  const p = fakePlugin('reward'); let asked = null;
  global.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true, registerPlugin: (n) => { asked = n; return p; } };
  try { bootFresh(READY); assert.strictEqual(asked, 'AdMob'); assert.strictEqual(Ads.plugin, p); } finally { delete global.Capacitor; }
});
test('Native build WITHOUT the plugin: honest message, no reward, no crash', async () => {
  global.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => false, registerPlugin: () => { throw new Error('must not be called'); } };
  try {
    const g = bootFresh(READY); assert.strictEqual(Ads.plugin, null); assert.strictEqual(Ads.missing, true);
    openHintPanel(g, 0); await pressAd();
    assert.strictEqual(g.getSave().hints[0], 0); assert.ok(/does not include the ads component/.test(els.adMsg.textContent));
  } finally { delete global.Capacitor; }
});

section('Ad privacy options (fake plugins; button comes from a saved flag, Settings never calls the plugin)', 'MOCK-ADS');
const settingsOpen = (g) => { fire('btnSettings', 'click'); assert.ok(screenOn('scrSettings')); };

test('OLDER plugin (6.x shape): button always hidden, privacy form never called, honest message if triggered', async () => {
  const g = bootFresh(READY); const p = logged(fakePlugin('reward')); p.consentInfo = V6('NOT_REQUIRED'); p.privacyMode = 'unimplemented'; Ads.setPlugin(p);
  settingsOpen(g); assert.ok(hidden('btnAdPrivacy')); assert.deepStrictEqual(p.log, [], 'opening Settings makes NO plugin call');
  fire('btnLevelsBack', 'click'); openHintPanel(g, 0); await pressAd(); assert.strictEqual(g.getSave().hints[0], 1);
  fire('btnHintClose', 'click'); settingsOpen(g); assert.ok(hidden('btnAdPrivacy')); assert.strictEqual(g.getSave().privacyOptions, false);
  fire('btnAdPrivacy', 'click'); await settle(); assert.strictEqual(p.privacyCalls, 0); assert.strictEqual(toastText(), 'Privacy options not available here');
});
test('NEWER plugin: flag learned from a real consent flow, saved, shown after restart; tap validates in documented order', async () => {
  let g = bootFresh(READY); let p = logged(fakePlugin('reward')); p.consentInfo = NEW_INFO('REQUIRED'); Ads.setPlugin(p);
  settingsOpen(g); assert.ok(hidden('btnAdPrivacy'), 'unknown until a consent check happened'); assert.deepStrictEqual(p.log, []);
  fire('btnLevelsBack', 'click'); openHintPanel(g, 0); await pressAd(); fire('btnHintClose', 'click');
  assert.strictEqual(g.getSave().privacyOptions, true); assert.strictEqual(JSON.parse(store['shadowloop.save.v2']).privacyOptions, true);
  settingsOpen(g); assert.ok(!hidden('btnAdPrivacy'));
  g = bootKeep(); p = logged(fakePlugin('reward')); p.consentInfo = NEW_INFO('REQUIRED'); Ads.setPlugin(p);       // app restart
  settingsOpen(g); assert.ok(!hidden('btnAdPrivacy'), 'visible from the saved flag'); assert.deepStrictEqual(p.log, [], 'still no plugin call from opening Settings');
  fire('btnAdPrivacy', 'click'); await settle();
  assert.deepStrictEqual(p.log, ['initialize', 'requestConsentInfo', 'showPrivacyOptionsForm']);
  assert.strictEqual(toastText(), 'Privacy choices updated'); assert.strictEqual(p.calls.prepare, 0); assert.strictEqual(p.calls.show, 0);
});
test('Stale saved flag: plugin no longer reports "required" => form not opened, flag cleared, button hidden', async () => {
  const g = bootFresh({ v: 2, tutorial: true, privacyOptions: true }); const p = logged(fakePlugin('reward')); p.consentInfo = NEW_INFO('NOT_REQUIRED'); Ads.setPlugin(p);
  settingsOpen(g); assert.ok(!hidden('btnAdPrivacy')); fire('btnAdPrivacy', 'click'); await settle();
  assert.strictEqual(p.privacyCalls, 0); assert.strictEqual(toastText(), 'Privacy options not available here');
  assert.strictEqual(g.getSave().privacyOptions, false); assert.ok(hidden('btnAdPrivacy'));
});
test('Privacy form rejected / unimplemented / consent lookup failing: honest message, nothing crashes, ads unaffected', async () => {
  for (const mode of ['reject', 'unimplemented', 'lookup']) {
    const g = bootFresh({ v: 2, tutorial: true, privacyOptions: true }); const p = fakePlugin('reward'); p.consentInfo = NEW_INFO('REQUIRED'); p.privacyMode = mode; Ads.setPlugin(p);
    if (mode === 'lookup') p.requestConsentInfo = async () => { throw new Error('UMP down'); };
    settingsOpen(g); fire('btnAdPrivacy', 'click'); await settle();
    assert.strictEqual(toastText(), 'Could not open privacy options', mode); assert.ok(!hidden('btnAdPrivacy'));
    p.requestConsentInfo = async () => { p.calls.consent++; return p.consentInfo; }; p.privacyMode = 'ok';
    fire('btnLevelsBack', 'click'); openHintPanel(g, 0); await pressAd(); assert.strictEqual(g.getSave().hints[0], 1, mode);
  }
});
test('After the privacy form, consent is re-checked; withdrawn consent blocks the next ad request', async () => {
  const g = bootFresh({ v: 2, tutorial: true, privacyOptions: true }); const p = logged(fakePlugin('reward')); p.consentInfo = NEW_INFO('REQUIRED'); Ads.setPlugin(p);
  settingsOpen(g); fire('btnAdPrivacy', 'click'); await settle(); assert.strictEqual(p.privacyCalls, 1);
  p.consentInfo = NEW_INFO('REQUIRED', false);                                  // user withdrew consent inside the form
  fire('btnLevelsBack', 'click'); openHintPanel(g, 1); const before = p.calls.consent; await pressAd();
  assert.ok(p.calls.consent > before, 'consent looked up again'); assert.strictEqual(p.calls.prepare, 0); assert.strictEqual(g.getSave().hints[1], 0);
});
test('Plain browser (no plugin): button hidden, honest message if triggered', async () => {
  const g = bootFresh({ v: 2, tutorial: true, privacyOptions: true }); settingsOpen(g); assert.ok(hidden('btnAdPrivacy'));
  fire('btnAdPrivacy', 'click'); await settle(); assert.strictEqual(toastText(), 'Privacy options need the Android app');
});
test('learnPrivacy: case-tolerant, needs the method AND "required", notifies the UI hook', () => {
  const p = fakePlugin('reward'); Ads.setPlugin(p); const seen = []; Ads.onPrivacyLearned = (v) => seen.push(v);
  try {
    assert.strictEqual(Ads.learnPrivacy({ privacyOptionsRequirementStatus: 'required' }), true);
    assert.strictEqual(Ads.learnPrivacy({ privacyOptionsRequirementStatus: 'NOT_REQUIRED' }), false);
    assert.strictEqual(Ads.learnPrivacy({ privacyOptionsRequirementStatus: undefined }), false);
    assert.strictEqual(Ads.learnPrivacy(null), false);
    const noFn = fakePlugin('reward'); delete noFn.showPrivacyOptionsForm; Ads.setPlugin(noFn);
    assert.strictEqual(Ads.learnPrivacy({ privacyOptionsRequirementStatus: 'REQUIRED' }), false);
    assert.deepStrictEqual(seen, [true, false, false, false, false]);
  } finally { Ads.onPrivacyLearned = null; }
});

section('configure-android.js against FABRICATED project folders (not a real Android build)', 'FIXTURE');
const SCRIPT = path.join(__dirname, 'scripts/configure-android.js');
const MANIFEST = (inside) => '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <uses-permission android:name="android.permission.INTERNET" />\n' + (inside && inside.before ? inside.before : '') +
  '    <application android:label="x">\n        <activity android:name=".MainActivity"/>\n' + (inside && inside.inside ? inside.inside : '') + '    </application>\n</manifest>\n';
function mkProject(o = {}) {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'slp-'));
  const w = (f, c) => { fs.mkdirSync(path.dirname(path.join(T, f)), { recursive: true }); fs.writeFileSync(path.join(T, f), c); };
  w('android/app/src/main/AndroidManifest.xml', o.manifest || MANIFEST());
  w('android/app/src/main/res/values/strings.xml', o.strings || '<resources>\n    <string name="app_name">x</string>\n</resources>\n');
  if (o.extraRes) w('android/app/src/main/res/values/' + o.extraRes[0], o.extraRes[1]);
  w('android/variables.gradle', 'ext {\n    minSdkVersion = 22\n    compileSdkVersion = 34\n    targetSdkVersion = ' + (o.target || 34) + '\n}\n');
  if (o.sync !== false) { w('android/app/src/main/assets/capacitor.plugins.json', o.pluginsJson || '[{"pkg":"@capacitor-community/admob","classpath":"com.getcapacitor.community.admob.AdMob"}]'); w('android/capacitor.settings.gradle', "include ':capacitor-community-admob'\n"); }
  const core = o.core || '6.2.0', adm = o.admob || '6.2.0';
  w('package.json', JSON.stringify({ dependencies: Object.assign({ '@capacitor/core': '^6.2.0', '@capacitor/android': '^6.2.0' }, o.noDep ? {} : { '@capacitor-community/admob': o.spec || adm }) }));
  w('node_modules/@capacitor/core/package.json', JSON.stringify({ version: core }));
  w('node_modules/@capacitor/android/package.json', JSON.stringify({ version: o.androidVer || core }));
  if (!o.noPlugin) {
    const pkg = { version: adm }; if (o.peer !== null) pkg.peerDependencies = { '@capacitor/core': o.peer || '^6.0.0' }; if (o.dep) pkg.dependencies = { '@capacitor/core': o.dep };
    w('node_modules/@capacitor-community/admob/package.json', JSON.stringify(pkg));
    if (o.nestedCore) w('node_modules/@capacitor-community/admob/node_modules/@capacitor/core/package.json', JSON.stringify({ version: o.nestedCore }));
    const names = ['initialize', 'requestConsentInfo', 'showConsentForm', 'prepareRewardVideoAd', 'showRewardVideoAd'].filter((n) => !(o.missingApi || []).includes(n)).concat(o.privacy ? ['showPrivacyOptionsForm'] : []);
    w('node_modules/@capacitor-community/admob/dist/esm/definitions.d.ts', names.map((n) => n + '(): Promise<void>;').join('\n'));
    const ev = ['onRewardedVideoAdReward', 'onRewardedVideoAdDismissed', 'onRewardedVideoAdFailedToLoad', 'onRewardedVideoAdFailedToShow'].filter((n) => !(o.missingEvents || []).includes(n));
    w('node_modules/@capacitor-community/admob/dist/esm/reward/events.js', ev.map((n) => "'" + n + "'").join(','));
  }
  w('game.js', o.gameJs || "var ADS_CONFIG = { useTestAds: true, test: {}, production: { appId: null, rewardedUnitId: null } };");
  return T;
}
const runCfg = (T, extra = [], env = {}) => cp.spawnSync('node', [SCRIPT, T].concat(extra), { encoding: 'utf8', env: Object.assign({}, process.env, { ADMOB_APP_ID: '' }, env) });
const rd = (T, f) => fs.readFileSync(path.join(T, f), 'utf8');
const MF = 'android/app/src/main/AndroidManifest.xml', SF = 'android/app/src/main/res/values/strings.xml';
const countOf = (str, re) => (str.match(re) || []).length;
const META = /com\.google\.android\.gms\.ads\.APPLICATION_ID/g;
const TESTID = 'ca-app-pub-3940256099942544~3347511713';

test('Fresh project: adds ONE canonical meta-data and the app id string, then reports OK', () => {
  const T = mkProject(); const r = runCfg(T); assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(countOf(rd(T, MF), META), 1); assert.ok(rd(T, MF).includes('android:value="@string/admob_app_id"'));
  assert.ok(rd(T, SF).includes('<string name="admob_app_id">' + TESTID + '</string>')); assert.ok(/FIXED/.test(r.stdout) && /RESULT: OK/.test(r.stdout));
  assert.ok(/below 36/.test(r.stdout), 'warns that targetSdk 34 is below the Play requirement');
});
test('Idempotent: a second run changes nothing and reports no corrections', () => {
  const T = mkProject(); runCfg(T); const a = rd(T, MF) + rd(T, SF); const r = runCfg(T);
  assert.strictEqual(r.status, 0); assert.ok(!/FIXED/.test(r.stdout)); assert.strictEqual(rd(T, MF) + rd(T, SF), a);
});
test('WRONG literal app id in the manifest is corrected to the string resource (not silently accepted)', () => {
  const T = mkProject({ manifest: MANIFEST({ inside: '        <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="ca-app-pub-1111111111111111~2222222222"/>\n' }) });
  const r = runCfg(T); assert.strictEqual(r.status, 0, r.stdout);
  assert.strictEqual(countOf(rd(T, MF), META), 1); assert.ok(rd(T, MF).includes('@string/admob_app_id')); assert.ok(!rd(T, MF).includes('1111111111111111'));
  assert.ok(/FIXED.*ca-app-pub-1111111111111111~2222222222/.test(r.stdout), 'the incorrect value is reported');
});
test('Duplicate tags and a tag OUTSIDE <application> collapse into one correct tag inside <application>', () => {
  const tag = '<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="@string/other"/>\n';
  const T = mkProject({ manifest: MANIFEST({ before: '    ' + tag, inside: '        ' + tag + '        ' + tag }) });
  const r = runCfg(T); assert.strictEqual(r.status, 0, r.stdout); const m = rd(T, MF);
  assert.strictEqual(countOf(m, META), 1); assert.ok(m.indexOf('APPLICATION_ID') > m.indexOf('<application') && m.indexOf('APPLICATION_ID') < m.indexOf('</application>'));
  assert.ok(!m.includes('@string/other'));
});
test('Correct tag with reordered attributes over several lines is recognised and left untouched', () => {
  const manifest = MANIFEST({ inside: '        <meta-data\n            android:value="@string/admob_app_id"\n            android:name="com.google.android.gms.ads.APPLICATION_ID" />\n' });
  const T = mkProject({ manifest, strings: '<resources>\n    <string name="admob_app_id">' + TESTID + '</string>\n</resources>\n' });
  const r = runCfg(T); assert.strictEqual(r.status, 0, r.stdout); assert.strictEqual(rd(T, MF), manifest); assert.ok(!/FIXED/.test(r.stdout));
});
test('strings.xml: wrong id corrected, duplicate definitions removed; a duplicate in ANOTHER values file is an error', () => {
  let T = mkProject({ strings: '<resources>\n    <string name="admob_app_id">ca-app-pub-1111111111111111~2222222222</string>\n    <string name="admob_app_id" translatable="false">zzz</string>\n</resources>\n' });
  let r = runCfg(T); assert.strictEqual(r.status, 0, r.stdout); assert.strictEqual(countOf(rd(T, SF), /name="admob_app_id"/g), 1); assert.ok(rd(T, SF).includes(TESTID));
  T = mkProject({ extraRes: ['ids.xml', '<resources><string name="admob_app_id">x</string></resources>'] });
  r = runCfg(T); assert.strictEqual(r.status, 1); assert.ok(/duplicate resource/.test(r.stdout));
});
test('--check-only: reports every needed correction as an error and changes NOTHING; passes on a correct project', () => {
  const T = mkProject({ manifest: MANIFEST({ inside: '        <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="oops"/>\n' }) });
  const before = rd(T, MF) + rd(T, SF); const r = runCfg(T, ['--check-only']);
  assert.strictEqual(r.status, 1); assert.ok(/needs correction/.test(r.stdout)); assert.strictEqual(rd(T, MF) + rd(T, SF), before);
  runCfg(T); assert.strictEqual(runCfg(T, ['--check-only']).status, 0);
});
test('ADMOB_APP_ID: a valid custom id is written; an invalid one is rejected', () => {
  const id = 'ca-app-pub-1234567890123456~1234567890'; let T = mkProject(); let r = runCfg(T, [], { ADMOB_APP_ID: id });
  assert.strictEqual(r.status, 0, r.stdout); assert.ok(rd(T, SF).includes(id));
  T = mkProject(); r = runCfg(T, [], { ADMOB_APP_ID: 'not-an-id' }); assert.strictEqual(r.status, 1); assert.ok(/not a valid AdMob APP id/.test(r.stdout));
});
test('Plugin checks: not installed / not in package.json / major mismatch / unmet peer / missing API / missing events => fail', () => {
  const bad = [[{ noPlugin: true }, /not installed/], [{ noDep: true }, /does not list/], [{ admob: '7.0.3' }, /does not match Capacitor major/],
    [{ peer: '^7.0.0' }, /peer dependency not satisfied/], [{ peer: '^5.0.0' }, /peer dependency not satisfied/], [{ androidVer: '7.0.0' }, /different major/],
    [{ missingApi: ['requestConsentInfo'] }, /lacks API/], [{ missingEvents: ['onRewardedVideoAdReward'] }, /lacks reward event/]];
  for (const [o, re] of bad) { const r = runCfg(mkProject(o)); assert.strictEqual(r.status, 1, JSON.stringify(o) + r.stdout); assert.ok(re.test(r.stdout), JSON.stringify(o) + '\n' + r.stdout); }
  for (const peer of ['>=6.0.0', '^6.0.0', '6.x', '>=6.0.0 <7.0.0', '^5.0.0 || ^6.0.0']) assert.strictEqual(runCfg(mkProject({ peer })).status, 0, peer);
});
test('@capacitor/core declared under "dependencies" (as this plugin family does) is checked too; duplicates are rejected', () => {
  let r = runCfg(mkProject({ peer: null, dep: '^6.0.0' })); assert.strictEqual(r.status, 0, r.stdout); assert.ok(/dependency ok: @capacitor\/core \^6\.0\.0 <- 6\.2\.0/.test(r.stdout));
  r = runCfg(mkProject({ peer: null, dep: '^7.0.0' })); assert.strictEqual(r.status, 1); assert.ok(/dependency not satisfied: @capacitor\/core@6\.2\.0/.test(r.stdout));
  r = runCfg(mkProject({ peer: null, dep: '^6.0.0', nestedCore: '6.0.0' })); assert.strictEqual(r.status, 1); assert.ok(/duplicate @capacitor\/core 6\.0\.0 is nested/.test(r.stdout));
  r = runCfg(mkProject({ peer: null })); assert.strictEqual(r.status, 0, r.stdout); assert.ok(/declares no @capacitor\/\* dependency/.test(r.stdout));
});
test('The reported shape of the real 6.2.0 package (dependencies: @capacitor/core ^6.0.0, no peerDependencies) with Capacitor 6.2.0 passes', () => {
  const r = runCfg(mkProject({ admob: '6.2.0', core: '6.2.0', peer: null, dep: '^6.0.0' }));
  assert.strictEqual(r.status, 0, r.stdout); assert.ok(/versions: admob 6\.2\.0 \| @capacitor\/core 6\.2\.0/.test(r.stdout)); assert.ok(/dependency ok: @capacitor\/core \^6\.0\.0 <- 6\.2\.0/.test(r.stdout));
});
test('The AdMob dependency must be pinned exactly; the installed version must equal the pin', () => {
  for (const spec of ['^6.2.0', '~6.2.0', '>=6.2.0', '6.x', 'latest']) { const r = runCfg(mkProject({ spec })); assert.strictEqual(r.status, 1, spec); assert.ok(/pinned to an exact version/.test(r.stdout), spec); }
  const r = runCfg(mkProject({ spec: '6.2.0', admob: '6.1.0' })); assert.strictEqual(r.status, 1); assert.ok(/differs from the pinned 6\.2\.0/.test(r.stdout));
});
test('Docs: README and INTEGRATION pin exactly 6.2.0 (no other pinned AdMob version, no caret)', () => {
  for (const f of ['README.md', 'INTEGRATION.md']) {
    const t = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.ok(t.includes('6.2.0'), f); assert.ok(!/"@capacitor-community\/admob":\s*"\^/.test(t), f + ' must not show a caret pin'); assert.ok(!/"@capacitor-community\/admob":\s*"6\.1\.0"/.test(t), f + ' must not pin 6.1.0');
  }
  assert.ok(/"@capacitor-community\/admob": "6\.2\.0"/.test(fs.readFileSync(path.join(__dirname, 'INTEGRATION.md'), 'utf8')));
});
test('Reward event strings agree everywhere: game.js AD_EVENTS = configure-android.js EVENT_NAMES = INTEGRATION.md (verified v6.2.0 README strings)', () => {
  const VERIFIED = ['onRewardedVideoAdDismissed', 'onRewardedVideoAdFailedToLoad', 'onRewardedVideoAdFailedToShow', 'onRewardedVideoAdReward'];
  assert.deepStrictEqual(Object.values(AD_EVENTS).sort(), VERIFIED, 'game.js');
  const script = fs.readFileSync(SCRIPT, 'utf8'); const arr = script.match(/const EVENT_NAMES = \[([^\]]+)\]/)[1].match(/'([^']+)'/g).map((x) => x.replace(/'/g, ''));
  assert.deepStrictEqual(arr.sort(), VERIFIED, 'configure-android.js');
  const doc = fs.readFileSync(path.join(__dirname, 'INTEGRATION.md'), 'utf8');
  VERIFIED.forEach((e) => assert.ok(doc.includes(e), 'INTEGRATION.md mentions ' + e)); assert.ok(/VERIFIED \(reported\)/.test(doc));
});
test('Reports whether the installed plugin has the privacy-options API (6.x: no, 7.0.3+: yes)', () => {
  assert.ok(/NOT in this plugin version/.test(runCfg(mkProject()).stdout));
  const r = runCfg(mkProject({ admob: '7.0.3', core: '7.0.0', peer: '^7.0.0', privacy: true })); assert.strictEqual(r.status, 0, r.stdout); assert.ok(/showPrivacyOptionsForm\): present/.test(r.stdout));
});
test('Native registration: missing / empty capacitor.plugins.json fails (cap sync not run after install); --skip-sync-check bypasses', () => {
  let r = runCfg(mkProject({ sync: false })); assert.strictEqual(r.status, 1); assert.ok(/capacitor\.plugins\.json missing/.test(r.stdout));
  r = runCfg(mkProject({ pluginsJson: '[]' })); assert.strictEqual(r.status, 1); assert.ok(/not registered/.test(r.stdout));
  assert.strictEqual(runCfg(mkProject({ sync: false }), ['--skip-sync-check']).status, 0);
});
test('Test/production consistency between game.js and the app id is enforced', () => {
  const prod = (unit) => "var ADS_CONFIG = { useTestAds: false, test: {}, production: { appId: null, rewardedUnitId: " + unit + " } };";
  const OK_ID = 'ca-app-pub-1234567890123456~1234567890';
  let r = runCfg(mkProject({ gameJs: prod("'ca-app-pub-1234567890123456/1234567890'") })); assert.strictEqual(r.status, 1); assert.ok(/TEST id/.test(r.stdout));
  r = runCfg(mkProject({ gameJs: prod("'ca-app-pub-1234567890123456/1234567890'") }), [], { ADMOB_APP_ID: OK_ID }); assert.strictEqual(r.status, 0, r.stdout);
  r = runCfg(mkProject({ gameJs: prod("'ca-app-pub-9999999999999999/1234567890'") }), [], { ADMOB_APP_ID: OK_ID }); assert.strictEqual(r.status, 1); assert.ok(/different AdMob publishers/.test(r.stdout));
  r = runCfg(mkProject({ gameJs: prod('null') }), [], { ADMOB_APP_ID: OK_ID }); assert.strictEqual(r.status, 1); assert.ok(/rewardedUnitId is not set/.test(r.stdout));
});
test('The REAL game.js config (useTestAds:true) is parsed correctly by the script; targetSdk 36 raises no Play warning', () => {
  const r = runCfg(mkProject({ gameJs: fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8'), target: 36 }), ['--skip-plugin-check', '--skip-sync-check']);
  assert.strictEqual(r.status, 0, r.stdout); assert.ok(!/could not read useTestAds/.test(r.stdout)); assert.ok(!/below 36/.test(r.stdout));
});

section('Pause / restart / progression regression (fake browser)', 'MOCK-UI');
test('Boots to title with saved tutorial, draws frames, one rAF loop', () => {
  const g = bootFresh(READY); assert.strictEqual(g.getState(), 'title'); assert.ok(screenOn('scrTitle')); frames(30);
});
test('Pause / resume / retry / restart work and ignore input while paused', () => {
  const g = bootFresh(READY); fire('btnPlay', 'click'); flush(); assert.strictEqual(g.getState(), 'playing');
  g.act('D'); assert.strictEqual(g.engine().tick, 1);
  fire('btnPause', 'click'); assert.strictEqual(g.getState(), 'paused'); g.act('D'); assert.strictEqual(g.engine().tick, 1);
  fire('btnResume', 'click'); assert.strictEqual(g.getState(), 'playing');
  fire('btnPause', 'click'); fire('btnRestart2', 'click'); assert.strictEqual(g.engine().tick, 0);
});
test('Touch d-pad buttons move the player', () => {
  const g = bootFresh(READY); g.startLevel(0);
  const D = dpad.find((d) => d.dataset.a === 'D'); D.listeners.pointerdown.forEach((f) => f({ preventDefault() {} })); D.listeners.pointerup.forEach((f) => f({}));
  assert.strictEqual(g.engine().player.y, 2);
});
test('Death shows SIGNAL LOST and retry keeps the Echo', () => {
  const g = bootFresh(READY); g.startLevel(2); g.act('U'); g.act('R'); g.act('R'); g.act('R');
  assert.strictEqual(g.getState(), 'dead'); flush(); assert.ok(screenOn('scrDead'));
  fire('btnDeadRetry', 'click'); assert.strictEqual(g.getState(), 'playing'); assert.strictEqual(g.engine().tick, 0);
});
test('Level banner shows the goal when a level starts', () => {
  const g = bootFresh(READY); g.startLevel(3);
  assert.ok(els.bnTitle.textContent.includes('ECHO CHAMBER')); assert.strictEqual(els.bnGoal.textContent, LEVELS[3].goal); assert.ok(els.banner.classList.contains('go'));
});
test('Full campaign through the real UI: 5 levels, unlocking, final screen, saved', () => {
  const g = bootFresh(READY); g.startLevel(0);
  LEVELS.forEach((def, i) => {
    assert.strictEqual(g.level(), i); assert.ok(g.getSave().unlocked >= i + 1);
    def.solution.forEach((s, k) => { s.split('').forEach((a) => g.act(a)); if (k < def.solution.length - 1) g.loop(); });
    assert.strictEqual(g.getState(), 'complete'); flush(); frames(5);
    if (i < LEVELS.length - 1) { assert.ok(screenOn('scrComplete')); fire('btnNext', 'click'); flush(); } else assert.ok(screenOn('scrFinal'));
  });
  const s = g.getSave(); assert.deepStrictEqual(s.done, [true, true, true, true, true]); assert.strictEqual(s.unlocked, 5);
  assert.deepStrictEqual(Save.load().done, s.done);
});
test('Repeated restarts, hint panel, tutorial replays and level changes add no listeners or loops', () => {
  const g = bootFresh(READY); g.startLevel(0); flush(); frames(2); const base = LISTENERS;
  for (let n = 0; n < 100; n++) {
    g.startLevel(n % 5); g.act('D'); fire('btnRestart', 'click'); fire('btnHint', 'click'); fire('btnHintClose', 'click');
    fire('btnPause', 'click'); fire('btnResume', 'click'); if (n % 10 === 0) { fire('btnTutorial', 'click'); fire('btnTutSkip', 'click'); }
    flush();
  }
  frames(10); assert.strictEqual(LISTENERS, base, 'listener count must not grow'); assert.ok(timeouts.size <= 1, 'no pile-up of timers');
});

(async () => {
  let passed = 0, failed = 0; const by = {};
  for (const t of queue) {
    if (t.section) { console.log(t.section); continue; }
    by[t.kind] = by[t.kind] || { ok: 0, bad: 0 };
    try { await t.fn(); passed++; by[t.kind].ok++; console.log('  ok   ' + t.name); }
    catch (e) { failed++; by[t.kind].bad++; console.log('  FAIL ' + t.name + '\n       ' + (e && e.message)); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  Object.keys(by).forEach((k) => console.log('  ' + k.padEnd(8) + ' ' + by[k].ok + ' passed, ' + by[k].bad + ' failed'));
  console.log('Native Android integration tests run: 0 | real AdMob plugin tests: 0 | real Gradle/APK builds: 0 | real-device tests: 0');
  process.exit(failed ? 1 : 0);
})();
