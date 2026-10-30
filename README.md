# SHADOW LOOP: ECHO DIMENSION

Neon sci-fi puzzle game for Android (HTML5 + Capacitor). Record a run, press **LOOP**, and your run becomes a translucent **Echo** that replays your exact moves, holding switches while you race for the exit.

## Controls
D-pad / swipe / arrow keys / WASD to move. **WAIT** passes a tick (Echoes also advance one move). **LOOP** saves the run as an Echo and rewinds. Pause menu: resume, retry attempt (keeps Echoes), restart level, level select.

## Campaign
1. THE AWAKENING - one plate, one door. Learn the Echo.
2. DUAL LOCK - door needs a held plate AND a latch switch.
3. DEAD SIGNAL - lasers on a fixed tick rhythm. Echoes are immune; you are not.
4. ECHO CHAMBER - two Echoes at once; the second plate is behind a door the first Echo holds open.
5. THE RIFT - lasers, two plates, a switch and two Echoes combined.

Rules: plates are active only while something stands on them; latch switches stay on until the attempt ends; a door stays open while anyone stands in it; the oldest Echo is dropped when you exceed the level's Echo limit. Intended solutions are stored in `game.js` (`solution`) and checked by the tests.

## Files
`index.html`, `style.css`, `game.js` (engine + levels + save + sound + rendering), `test.js` (run `node test.js`), `package.json`, `capacitor.config.json`, `.github/workflows/build-apk.yml`.

## Save data
localStorage key `shadowloop.save.v2` (unlocked levels, cleared levels, best steps, sound/effects). Old `v1` saves are migrated automatically.

## Android
The GitHub Actions workflow copies `index.html`, `style.css` and `game.js` into `www/` and builds a debug APK. Download it from the workflow run's Artifacts section.
