'use strict';
/* Adds release signing + version numbers to the GENERATED Android project.

   `android/` is recreated on every CI run by `npx cap add android`, so a signing
   block cannot be committed to the repository. This script injects it into
   android/app/build.gradle after `cap sync`, and reads every secret from the
   environment - no secret is ever written to disk, printed or committed.

   Run in CI:
     ANDROID_KEYSTORE_PATH=/tmp/release.p12 \
     ANDROID_KEYSTORE_PASSWORD=... ANDROID_KEY_ALIAS=... ANDROID_KEY_PASSWORD=... \
     node scripts/configure-release-signing.js --version-code 1 --version-name 1.0.0

   Options:
     --version-code N   versionCode written into defaultConfig (integer >= 1)
     --version-name X   versionName written into defaultConfig
     --check-only       verify only; report problems, change nothing

   Exit code 1 on any problem. No dependencies. */

const fs = require('fs');
const path = require('path');

const MARK = '// >>> release signing (scripts/configure-release-signing.js)';
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const argOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const CHECK_ONLY = flag('--check-only');
const root = process.cwd();
const gradlePath = path.join(root, 'android/app/build.gradle');

const errors = [], info = [], fixes = [];
const err = (m) => errors.push(m), note = (m) => info.push(m), fixed = (m) => fixes.push(m);
const report = () => {
  const out = (t, a) => a.forEach((m) => console.log(t + ' ' + m));
  console.log('configure-release-signing' + (CHECK_ONLY ? ' (check-only)' : '') + ' - project: ' + root);
  out('info   ', info); out('FIXED  ', fixes); out('ERROR  ', errors);
  console.log(errors.length ? 'RESULT: FAILED (' + errors.length + ' error(s))' : 'RESULT: OK' + (fixes.length ? ' (' + fixes.length + ' correction(s) applied)' : ''));
  process.exit(errors.length ? 1 : 0);
};

/* ---------- 1. inputs - names only, never values ---------- */
const NEEDED = ['ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'];
const missing = NEEDED.filter((k) => !process.env[k]);
if (missing.length) err('missing environment value(s): ' + missing.join(', ') + ' - supply them from the GitHub "release" environment secrets');
const KEYSTORE = process.env.ANDROID_KEYSTORE_PATH || '';
if (KEYSTORE) {
  if (!fs.existsSync(KEYSTORE)) err('keystore file not found at ANDROID_KEYSTORE_PATH (' + path.basename(KEYSTORE) + '); the base64 decode step must run first');
  else if (fs.statSync(KEYSTORE).size < 100) err('keystore file looks empty or truncated (' + fs.statSync(KEYSTORE).size + ' bytes); check ANDROID_KEYSTORE_BASE64');
}

const vCodeRaw = argOf('--version-code');
const vName = argOf('--version-name');
const vCode = vCodeRaw === undefined ? null : Number(vCodeRaw);
if (vCodeRaw === undefined) err('--version-code is required (Google Play needs a versionCode that increases with every upload)');
else if (!Number.isInteger(vCode) || vCode < 1) err('--version-code must be an integer >= 1; got "' + vCodeRaw + '"');
if (!vName) err('--version-name is required (it is the version users see)');

/* ---------- 2. the generated gradle file ---------- */
if (!fs.existsSync(gradlePath)) err('android/app/build.gradle not found - run `npx cap add android` and `npx cap sync android` first');
if (errors.length) report();

let g = fs.readFileSync(gradlePath, 'utf8');
const already = g.includes(MARK);
const codeRe = /(defaultConfig\s*\{[\s\S]*?\bversionCode\s+)(\d+)/;
const nameRe = /(defaultConfig\s*\{[\s\S]*?\bversionName\s+")([^"]*)(")/;
const curCode = (g.match(codeRe) || [])[2];
const curName = (g.match(nameRe) || [])[2];

if (CHECK_ONLY) {
  if (!already) err('release signing block is not in android/app/build.gradle');
  if (curCode === undefined) err('versionCode not found inside defaultConfig');
  else if (+curCode !== vCode) err('versionCode is ' + curCode + ', expected ' + vCode);
  if (curName === undefined) err('versionName not found inside defaultConfig');
  else if (curName !== vName) err('versionName is "' + curName + '", expected "' + vName + '"');
  if (!errors.length) note('release signing block present; versionCode ' + curCode + ' | versionName "' + curName + '"');
  report();
}

if (already) err('release signing block is already present in android/app/build.gradle (this script ran twice)');
if (curCode === undefined) err('could not find `versionCode` inside defaultConfig in android/app/build.gradle');
if (curName === undefined) err('could not find `versionName` inside defaultConfig in android/app/build.gradle');
if (errors.length) report();

/* ---------- 3. version numbers ---------- */
g = g.replace(codeRe, (m, p) => p + vCode);
g = g.replace(nameRe, (m, p, _old, q) => p + vName + q);
if (+curCode !== vCode) fixed('versionCode ' + curCode + ' -> ' + vCode);
else note('versionCode already ' + vCode);
if (curName !== vName) fixed('versionName "' + curName + '" -> "' + vName + '"');
else note('versionName already "' + vName + '"');

/* ---------- 4. signing block (appended; Groovy merges android {} blocks) ---------- */
const BLOCK = [
  '',
  MARK,
  '// Injected at build time. android/ is generated by CI and is never committed.',
  '// The keystore path and all passwords come from the environment and are never stored here.',
  'android {',
  '    signingConfigs {',
  '        release {',
  '            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))',
  '            storeType = "PKCS12"',
  '            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")',
  '            keyAlias System.getenv("ANDROID_KEY_ALIAS")',
  '            keyPassword System.getenv("ANDROID_KEY_PASSWORD")',
  '            enableV1Signing = true',
  '            enableV2Signing = true',
  '        }',
  '    }',
  '    buildTypes {',
  '        release {',
  '            signingConfig signingConfigs.release',
  '        }',
  '    }',
  '}',
  ''
].join('\n');

g = g + BLOCK;
fs.writeFileSync(gradlePath, g);
fixed('release signingConfig injected into android/app/build.gradle (PKCS12, signingConfigs.release -> buildTypes.release)');

/* ---------- 5. safe summary ---------- */
note('keystore: ' + path.basename(KEYSTORE) + ' (' + fs.statSync(KEYSTORE).size + ' bytes, type PKCS12)');
note('store password, key alias and key password: read from environment, not printed');
report();
