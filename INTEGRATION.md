# Phase 2 integration notes (read before uploading)

Nothing here has been run against your real repository, a real `npm install`, a real Gradle build, an emulator or a device.
Nothing has been uploaded. Your workflow keeps `npm install` (there is no lockfile and none is fabricated).

## 1. Chosen plugin version: `@capacitor-community/admob` 6.2.0, pinned exactly

Facts below marked "reported" were supplied by you from the official GitHub source; I have not independently re-verified them (my sandbox has no registry access).

| Fact | Evidence level |
|---|---|
| v6.2.0 `package.json` declares `@capacitor/core: ^6.0.0`; dev dependencies `@capacitor/android`, `@capacitor/cli`, `@capacitor/core` at `^6.0.0` | reported |
| Your repo uses Capacitor `^6.2.0` (package.json contains only the three Capacitor dependencies) | reported |
| v6.2.0 Android class uses `@CapacitorPlugin` and exposes `initialize`, `requestConsentInfo`, `showConsentForm`, `prepareRewardVideoAd`, `showRewardVideoAd` | reported |
| 6.2.0 `build.gradle` uses the same Capacitor Android dependency and SDK configuration as 6.1.0 | reported |
| Both 6.1.0 and 6.2.0 document `initialize -> requestConsentInfo -> showConsentForm` as the Android flow | reported (matches game.js) |
| v6.2.0 exists as a stable release (commit `a95cd79476c8e2fd87a301bc9c580819248f6ff3`; notes concern iOS SPM syntax) | confirmed earlier from the plugin's GitHub release page |
| The 4 reward event strings game.js listens for: `onRewardedVideoAdReward`, `onRewardedVideoAdDismissed`, `onRewardedVideoAdFailedToLoad`, `onRewardedVideoAdFailedToShow` | **VERIFIED (reported)**: you checked them in the official capacitor-community/admob README at tag v6.2.0 and all four match game.js exactly. This is README-level evidence; the build script still checks that the installed package contains the same strings and fails the build if not. |
| Plugin registration (`capacitor.plugins.json`) | produced by `npx cap sync android`; the script only checks the package name is listed (not the class path). Not run. |
| A real build, plugin registration run, manifest edit on the real project, APK, real AdMob ad | NOT DONE |

Known limits that remain: no lockfile means Capacitor `^6.2.0` and other transitive packages float within their ranges on every build; Capacitor 6 defaults to targetSdk 34 (Google Play needs 36 for new apps/updates; a debug APK is unaffected; the script prints a warning); plugin 6.x has no privacy-options form, so that Settings button stays hidden.

## 2. package.json - exactly one line added
Inside the existing `"dependencies"` object add this as the FIRST line and keep your three Capacitor lines untouched:
```json
    "@capacitor-community/admob": "6.2.0",
```
The block then looks like this (your Capacitor version strings stay whatever they are now):
```json
  "dependencies": {
    "@capacitor-community/admob": "6.2.0",
    "@capacitor/android": "^6.2.0",
    "@capacitor/cli": "^6.2.0",
    "@capacitor/core": "^6.2.0"
  }
```
Rules: no `^`, no `~`; every line except the last ends with a comma; do not create `package-lock.json`.

## 3. Workflow (`.github/workflows/build-apk.yml`) - keep `npm install`
Order inside the job must be: `npm install` -> (create Android project, as you do today) -> `npx cap sync android` -> **new step** -> Gradle `assembleDebug`.
Add exactly this step between the cap sync step and the Gradle step (same indentation as the neighbouring `- name:` lines):
```yaml
      - name: Configure and verify AdMob
        run: node scripts/configure-android.js
        env:
          ADMOB_APP_ID: ${{ vars.ADMOB_APP_ID }}
```
`ADMOB_APP_ID` is optional: when the repository variable is not set, the script uses Google's public TEST app id. Change nothing else in the workflow.
If the web files are copied into `www/` by a step, make sure `scripts/` is not required there; the script runs from the repository root.

What the step does (all of it fails the build on error): pins and versions (exact `6.2.0` in package.json = installed version), Capacitor major 6 for core/android/plugin, `@capacitor/core` range satisfied and no nested duplicate core, the 5 API names and 4 reward event strings present in the installed package, plugin listed in `capacitor.plugins.json`, exactly one correct `com.google.android.gms.ads.APPLICATION_ID` meta-data in the manifest, `admob_app_id` in `strings.xml`, and test/production consistency with `game.js`.

## 4. Upload checklist (do nothing until you approve)
1. Open the repo in a browser ("Desktop site" helps). Note the latest commit on `main` as your rollback point.
2. Create the branch `phase2-ads` when committing the first file ("Create a new branch for this commit").
3. On that branch upload: `index.html`, `style.css`, `game.js`, `README.md`, `test.js`, `INTEGRATION.md` (Add file -> Upload files; confirm replacing the Phase 1 ones).
4. Add the script: Add file -> Create new file; in the name box type `scripts/configure-android.js` (typing the slash makes the folder); paste the file contents; commit to `phase2-ads`.
5. Edit `package.json` on `phase2-ads` (pencil icon): add the one line from section 2; commit.
6. Edit the workflow on `phase2-ads`: add the step from section 3; commit.
7. Run the workflow on `phase2-ads` (Actions tab; if the workflow has no manual or branch trigger, open a Pull request from `phase2-ads` first). Open the run and read the step "Configure and verify AdMob": it must end with `RESULT: OK`.
8. Download the APK artifact. Only after a green build merge `phase2-ads` into `main`. Rollback = revert the merge commit.
9. After the first green build, tell me the exact "Configure and verify AdMob" log text; I will compare it with what the checks should print.
