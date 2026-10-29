# SHADOW LOOP: ECHO DIMENSION

A neon sci-fi puzzle game for Android. Walk a grid maze, press **LOOP** to rewind time, and your last run becomes a translucent **Echo Shadow** that replays your exact moves. Use the Echo to hold a switch while you run through the door to the exit.

## How to play
- Move with the D-pad, by swiping on the maze, or with arrow keys / WASD.
- **WAIT** passes one tick (the Echo also advances one move).
- **LOOP** saves the current run as the Echo and restarts the level.
- Pause menu: resume, retry attempt (keeps the Echo), restart level, sound, menu.
- Best score and sound setting are saved on the device (localStorage). Everything works offline.

## Level 1 solution (spoiler)
Attempt 1: walk to the amber plate and press LOOP. Attempt 2: walk to the door, WAIT until the Echo reaches the plate and the door opens, then go to the exit.

## Files
- `index.html` - screens and controls
- `style.css` - neon styling
- `game.js` - engine (movement, recording, echo replay, switch/door) + rendering + sound
- `package.json`, `capacitor.config.json` - Android packaging with Capacitor

## Android build
The APK is built by GitHub Actions (workflow added in a later step). Capacitor serves the `www` folder, which the workflow fills with `index.html`, `style.css` and `game.js`.
