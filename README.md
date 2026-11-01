# SHADOW LOOP: ECHO DIMENSION

Neon sci-fi puzzle game for Android (HTML5 + Capacitor). Record a run, press **LOOP**, and your run becomes a translucent **Echo** that replays your exact moves, holding plates while you race for the exit.

## Play
D-pad / swipe / arrow keys / WASD to move. **WAIT** passes one beat (Echoes also advance one move). **LOOP** saves the run as an Echo and rewinds. **HINT** opens the hint panel.

1. THE AWAKENING - one plate, one door.
2. DUAL LOCK - door needs a held plate AND a latch switch.
3. DEAD SIGNAL - lasers on a fixed rhythm; Echoes are immune, you are not.
4. ECHO CHAMBER - two Echoes; the second plate is behind a door the first Echo holds open.
5. THE RIFT - lasers, two plates, a switch and two Echoes combined.

## Tutorial
Runs automatically on first launch (never for players who already cleared a level). It uses the real Level 1 engine: each step advances only when the real game state allows it (reach the marker, stand on the plate, press LOOP, wait for the Echo to open the door, reach the exit). It can be skipped, and replayed from the title screen or Settings. Tutorial progress never changes level progress.

## Hints and rewarded ads
Each level has 3 hints: gentle, strategy, detailed solution. Each one is unlocked by one **optional** rewarded ad that starts only when the player presses "Watch ad". A hint is granted only after the AdMob reward callback; closing early, no-fill or errors grant nothing. Unlocked hints are saved per level and never need another ad. Hint 3 uses the notation "Down 4, Wait 3" and `test.js` replays exactly those moves through the engine.

### AdMob setup (owner) - see INTEGRATION.md for the exact edits
- Plugin: `@capacitor-community/admob` **6.2.0**, pinned exactly (no caret). It is the Capacitor 6 line and declares `@capacitor/core ^6.0.0`. `scripts/configure-android.js` checks the exact pin, the installed version, the Capacitor ranges, the API and event names, and the native registration at build time.
- Consent (plugin 6.x documented order): `initialize` -> `requestConsentInfo` -> `showConsentForm` (only if REQUIRED) -> ads. No ad is requested unless consent status is NOT_REQUIRED or OBTAINED (or, on plugin >= 7.0.3, `canRequestAds` is true). A refusal is never cached.
- Privacy options (`showPrivacyOptionsForm`) exist only in plugin >= 7.0.3. On 6.x the Settings button stays hidden. Opening Settings never calls the plugin.
- Development uses Google's public TEST ids (`ADS_CONFIG` in `game.js`, default of `scripts/configure-android.js`). Production needs your AdMob App ID (repo variable `ADMOB_APP_ID`), your Rewarded ad unit id in `ADS_CONFIG.production.rewardedUnitId`, and `useTestAds:false`; the script refuses inconsistent combinations.
- `node test.js` uses fake browsers/plugins/folders only. It does NOT test native Android, the real plugin, Gradle, or a device.

## Files
`index.html`, `style.css`, `game.js`, `test.js` (`node test.js`), `scripts/configure-android.js`, `INTEGRATION.md`, `package.json`, `capacitor.config.json`, `.github/workflows/build-apk.yml`.

## Save data
localStorage `shadowloop.save.v2`: unlocked/cleared levels, best steps, sound, effects, tutorial done, unlocked hints per level. Phase 1 and v1 saves load unchanged.
