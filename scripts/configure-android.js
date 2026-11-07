'use strict';
/* Verifies AND corrects the Android side of the AdMob integration. Run in CI after `npx cap sync android`,
   before the Gradle build:
       ADMOB_APP_ID=ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY node scripts/configure-android.js
   Options:  --check-only          verify only; report every needed correction as an error, change nothing
             --skip-plugin-check   skip node_modules / package checks (fixtures only)
             --skip-sync-check     skip the `cap sync` registration check
   Default ADMOB_APP_ID = Google's public TEST app id. Exit code 1 on any error. No dependencies. */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const root = path.resolve(args.find((a) => !a.startsWith('--')) || process.cwd());
const CHECK_ONLY = flag('--check-only');
const TEST_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
const APP_ID = process.env.ADMOB_APP_ID || TEST_APP_ID;
const META_NAME = 'com.google.android.gms.ads.APPLICATION_ID';
const META_TAG = '<meta-data android:name="' + META_NAME + '" android:value="@string/admob_app_id" />';
const API_NAMES = ['initialize', 'requestConsentInfo', 'showConsentForm', 'showPrivacyOptionsForm', 'prepareRewardVideoAd', 'showRewardVideoAd'];
const EVENT_NAMES = ['onRewardedVideoAdReward', 'onRewardedVideoAdDismissed', 'onRewardedVideoAdFailedToLoad', 'onRewardedVideoAdFailedToShow'];

const errors = [], warnings = [], fixes = [], info = [];
const err = (m) => errors.push(m), warn = (m) => warnings.push(m), fixed = (m) => fixes.push(m), note = (m) => info.push(m);
const P = (...x) => path.join(root, ...x);
const read = (f) => fs.readFileSync(f, 'utf8');
function readJson(f) { try { return JSON.parse(read(f)); } catch (e) { return null; } }
// a needed correction: apply it, or (check-only) report it as an error
function correct(msg, apply) { if (CHECK_ONLY) err('needs correction: ' + msg); else { apply(); fixed(msg); } }

/* ---------- tiny semver helpers (enough for ^ ~ >= > <= < = x-ranges ||) ---------- */
const ver = (v) => { const m = String(v).trim().replace(/^[v=]+/, '').match(/^(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/); return m ? [+m[1], isNaN(+m[2]) ? null : +m[2], isNaN(+m[3]) ? null : +m[3]] : null; };
const cmp = (a, b) => { for (let i = 0; i < 3; i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };
function satisfiesOne(v, comp) {
  const m = comp.match(/^(\^|~|>=|<=|>|<|=)?\s*(.+)$/); if (!m) return null;
  const op = m[1] || '=', t = ver(m[2]); if (!t) return null;
  if (op === '^') return cmp(v, [t[0], t[1] || 0, t[2] || 0]) >= 0 && v[0] === t[0];
  if (op === '~') return cmp(v, [t[0], t[1] || 0, t[2] || 0]) >= 0 && v[0] === t[0] && v[1] === (t[1] || 0);
  if (op === '>=') return cmp(v, t) >= 0; if (op === '>') return cmp(v, t) > 0;
  if (op === '<=') return cmp(v, t) <= 0; if (op === '<') return cmp(v, t) < 0;
  return v[0] === t[0] && (t[1] === null || v[1] === t[1]) && (t[2] === null || v[2] === t[2]);
}
function satisfies(version, range) {            // true | false | null (range not understood)
  const v = ver(version); if (!v) return null;
  let unknown = false;
  for (const alt of String(range).split('||')) {
    const parts = alt.trim().split(/\s+/).filter(Boolean); if (!parts.length || alt.trim() === '*') return true;
    const rs = parts.map((c) => satisfiesOne(v, c)); if (rs.includes(null)) { unknown = true; continue; }
    if (rs.every(Boolean)) return true;
  }
  return unknown ? null : false;
}

/* ---------- 1. app id ---------- */
if (!/^ca-app-pub-\d{16}~\d{10}$/.test(APP_ID)) err('ADMOB_APP_ID is not a valid AdMob APP id (expected ca-app-pub-<16 digits>~<10 digits>): ' + APP_ID);
const usingTestId = APP_ID === TEST_APP_ID;
note('AdMob app id: ' + APP_ID + (usingTestId ? '  [Google TEST id]' : '  [custom id]'));

/* ---------- 2. consistency with game.js (test vs production) ---------- */
const gameJs = P('game.js');
if (fs.existsSync(gameJs)) {
  const g = read(gameJs);
  const t = g.match(/useTestAds:\s*(true|false)/);
  if (!t) warn('could not read useTestAds from game.js');
  else if (t[1] === 'false') {
    const prod = (g.match(/production:\s*\{[^}]*\}/) || [''])[0];
    const unit = (prod.match(/rewardedUnitId:\s*'([^']+)'/) || [])[1];
    if (usingTestId) err('game.js is in PRODUCTION mode (useTestAds:false) but the app id is Google\'s TEST id - set ADMOB_APP_ID');
    if (!unit) err('game.js is in PRODUCTION mode but production.rewardedUnitId is not set');
    else {
      if (!/^ca-app-pub-\d{16}\/\d{10}$/.test(unit)) err('production.rewardedUnitId is not a valid ad unit id: ' + unit);
      else if (unit.split('/')[0] !== APP_ID.split('~')[0]) err('production ad unit and app id belong to different AdMob publishers');
    }
  } else if (!usingTestId) warn('game.js uses Google TEST ad units while the manifest has a real app id - fine for development, never ship like this');
} else warn('game.js not found next to the project root; test/production consistency not checked');

/* ---------- 3. AndroidManifest.xml ---------- */
const manifest = P('android/app/src/main/AndroidManifest.xml');
if (!fs.existsSync(manifest)) err('AndroidManifest.xml not found - run `npx cap add android` / `npx cap sync android` first');
else {
  let m = read(manifest);
  const appOpen = m.search(/<application\b/), appClose = m.indexOf('</application>');
  if (appOpen < 0 || appClose < 0) err('AndroidManifest.xml has no <application> element');
  else {
    const re = new RegExp('<meta-data\\b[^>]*android:name\\s*=\\s*"' + META_NAME.replace(/\./g, '\\.') + '"[^>]*>(?:\\s*</meta-data>)?', 'g');
    const found = []; let mm; while ((mm = re.exec(m))) found.push({ text: mm[0], index: mm.index });
    const valueOf = (t) => ((t.match(/android:value\s*=\s*"([^"]*)"/) || [])[1]);
    const good = found.length === 1 && found[0].index > appOpen && found[0].index < appClose && valueOf(found[0].text) === '@string/admob_app_id';
    if (good) note('manifest: AdMob APPLICATION_ID meta-data is correct');
    else {
      const desc = found.length ? found.map((f) => 'value="' + valueOf(f.text) + '"' + (f.index > appOpen && f.index < appClose ? '' : ' (outside <application>)')).join(', ') : 'none';
      correct('manifest AdMob meta-data replaced by the canonical single tag (found: ' + desc + ')', () => {
        for (const f of found.slice().reverse()) m = m.slice(0, f.index) + m.slice(f.index + f.text.length);
        const close = m.indexOf('</application>');
        m = m.slice(0, close) + '    ' + META_TAG + '\n    ' + m.slice(close);
        fs.writeFileSync(manifest, m);
      });
    }
    if (!/android\.permission\.INTERNET/.test(m)) warn('manifest has no INTERNET permission (Capacitor normally adds it; ads need it)');
  }
}

/* ---------- 4. strings.xml (+ duplicate definitions elsewhere) ---------- */
const resDir = P('android/app/src/main/res');
const strings = path.join(resDir, 'values/strings.xml');
if (!fs.existsSync(strings)) err('res/values/strings.xml not found');
else {
  let x = read(strings);
  const sre = /[ \t]*<string\b[^>]*name\s*=\s*"admob_app_id"[^>]*>[^<]*<\/string>[ \t]*\r?\n?/g;
  const defs = x.match(sre) || [];
  const values = defs.map((d) => (d.match(/>([^<]*)</) || [])[1]);
  if (defs.length === 1 && values[0] === APP_ID) note('strings.xml: admob_app_id is correct');
  else if (!x.includes('</resources>')) err('strings.xml has no </resources>');
  else correct('strings.xml admob_app_id set to ' + APP_ID + ' (found ' + (defs.length ? defs.length + ' definition(s): ' + values.join(' | ') : 'none') + ')', () => {
    x = x.replace(sre, '');
    x = x.replace('</resources>', '    <string name="admob_app_id">' + APP_ID + '</string>\n</resources>');
    fs.writeFileSync(strings, x);
  });
  if (fs.existsSync(resDir)) for (const d of fs.readdirSync(resDir)) {
    if (!d.startsWith('values')) continue;
    for (const f of fs.readdirSync(path.join(resDir, d))) {
      const full = path.join(resDir, d, f);
      if (full !== strings && f.endsWith('.xml') && /name\s*=\s*"admob_app_id"/.test(read(full))) err('admob_app_id is also defined in ' + path.relative(root, full) + ' (duplicate resource)');
    }
  }
}

/* ---------- 5. plugin installation, versions, peer dependencies, API surface ---------- */
if (!flag('--skip-plugin-check')) {
  const rootPkg = readJson(P('package.json')) || {};
  const deps = Object.assign({}, rootPkg.dependencies, rootPkg.devDependencies);
  const spec = deps['@capacitor-community/admob'];
  const EXACT = /^\d+\.\d+\.\d+$/;
  if (!spec) err('package.json does not list @capacitor-community/admob');
  else if (!EXACT.test(spec)) err('@capacitor-community/admob must be pinned to an exact version in package.json (no ^ ~ or ranges); found "' + spec + '"');
  const pj = readJson(P('node_modules/@capacitor-community/admob/package.json'));
  if (!pj) err('@capacitor-community/admob is not installed in node_modules (add it to package.json, then npm install)');
  else {
    const core = readJson(P('node_modules/@capacitor/core/package.json')), android = readJson(P('node_modules/@capacitor/android/package.json'));
    if (spec && EXACT.test(spec) && pj.version !== spec) err('installed @capacitor-community/admob ' + pj.version + ' differs from the pinned ' + spec);
    note('versions: admob ' + pj.version + ' | @capacitor/core ' + (core ? core.version : '?') + ' | @capacitor/android ' + (android ? android.version : '?'));
    if (!core) err('@capacitor/core is not installed');
    else {
      if (android && ver(android.version)[0] !== ver(core.version)[0]) err('@capacitor/android ' + android.version + ' and @capacitor/core ' + core.version + ' have different major versions');
      if (ver(pj.version)[0] !== ver(core.version)[0]) err('AdMob plugin major ' + ver(pj.version)[0] + ' does not match Capacitor major ' + ver(core.version)[0] + ' (plugin 6.x is for Capacitor 6)');
      // This plugin family declares @capacitor/core under "dependencies" (seen in 4.x and 8.x package.json), not
      // "peerDependencies" - so check BOTH kinds, for every @capacitor/* package they mention.
      const declared = [['dependency', pj.dependencies || {}], ['peer dependency', pj.peerDependencies || {}]];
      note('plugin declares: dependencies ' + JSON.stringify(pj.dependencies || {}) + ' | peerDependencies ' + JSON.stringify(pj.peerDependencies || {}));
      let anyCapacitorRange = false;
      declared.forEach(([kind, map]) => Object.keys(map).forEach((n) => {
        if (!n.startsWith('@capacitor/')) return;
        anyCapacitorRange = true;
        const inst = readJson(P('node_modules', n, 'package.json')); if (!inst) { warn(kind + ' ' + n + ' (' + map[n] + ') is not installed'); return; }
        const ok = satisfies(inst.version, map[n]);
        if (ok === false) err(kind + ' not satisfied: ' + n + '@' + inst.version + ' vs required ' + map[n]);
        else if (ok === null) warn('could not evaluate ' + kind + ' range ' + n + ' ' + map[n]);
        else note(kind + ' ok: ' + n + ' ' + map[n] + ' <- ' + inst.version);
      }));
      if (!anyCapacitorRange) warn('plugin declares no @capacitor/* dependency or peerDependency (only the major-version rule protects you)');
      const nested = readJson(P('node_modules/@capacitor-community/admob/node_modules/@capacitor/core/package.json'));
      if (nested) err('duplicate @capacitor/core ' + nested.version + ' is nested under the AdMob plugin (project has ' + core.version + ') - two copies of Capacitor core will break the app');
    }
    // API surface: scan the installed package for every method / event name game.js relies on
    let blob = '';
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'ios') walk(f); }
        else if (/\.(js|ts|json|java|kt)$/.test(e.name)) blob += read(f) + '\n';
      }
    })(P('node_modules/@capacitor-community/admob'));
    const missingApi = API_NAMES.filter((n) => !blob.includes(n)), missingEv = EVENT_NAMES.filter((n) => !blob.includes(n));
    if (missingApi.length) err('installed AdMob plugin lacks API used by game.js: ' + missingApi.join(', '));
    if (missingEv.length) err('installed AdMob plugin lacks reward event names used by game.js: ' + missingEv.join(', '));
    note('privacy options API (showPrivacyOptionsForm): ' + (blob.includes('showPrivacyOptionsForm') ? 'present' : 'NOT in this plugin version (button stays hidden)'));
    note('canRequestAds: ' + (blob.includes('canRequestAds') ? 'present' : 'NOT in this plugin version (consent gate uses status)'));
  }
}

/* ---------- 6. native registration (cap sync must run AFTER the plugin is installed) ---------- */
if (!flag('--skip-sync-check')) {
  const pj = P('android/app/src/main/assets/capacitor.plugins.json');
  if (!fs.existsSync(pj)) err('capacitor.plugins.json missing - run `npx cap sync android` after installing the plugin');
  else if (!read(pj).includes('@capacitor-community/admob')) err('AdMob plugin is not registered in capacitor.plugins.json - run `npx cap sync android` after `npm install`');
  else note('native registration: AdMob is in capacitor.plugins.json');
  const gs = P('android/capacitor.settings.gradle');
  if (fs.existsSync(gs) && !/capacitor-community-admob/.test(read(gs))) warn('capacitor.settings.gradle does not mention capacitor-community-admob');
}

/* ---------- 7. SDK levels (Capacitor 8 / AdMob requirements + Play warning) ---------- */
const vars = P('android/variables.gradle');
if (fs.existsSync(vars)) {
  const v = read(vars), get = (k) => { const r = v.match(new RegExp(k + '\\s*=\\s*(\\d+)')); return r ? +r[1] : null; };
  const min = get('minSdkVersion');
  const compile = get('compileSdkVersion');
  const t = get('targetSdkVersion');
  note('android minSdk ' + min + ' | compileSdk ' + compile + ' | targetSdk ' + t);
  if (min === null) err('minSdkVersion could not be read from android/variables.gradle');
  else if (min < 24) err('AdMob plugin 8.x requires minSdkVersion 24 or higher; found ' + min);
  if (t !== null && t < 36) warn('targetSdkVersion ' + t + ' is below 36: Google Play requires API 36 for new apps and updates (debug APKs are unaffected)');
} else {
  err('android/variables.gradle not found; Android SDK levels could not be verified');
}


/* ---------- report ---------- */
const out = (t, a) => a.forEach((m) => console.log(t + ' ' + m));
console.log('configure-android' + (CHECK_ONLY ? ' (check-only)' : '') + ' - project: ' + root);
out('info   ', info); out('FIXED  ', fixes); out('warning', warnings); out('ERROR  ', errors);
console.log(errors.length ? 'RESULT: FAILED (' + errors.length + ' error(s))' : 'RESULT: OK' + (fixes.length ? ' (' + fixes.length + ' correction(s) applied)' : ''));
process.exit(errors.length ? 1 : 0);
