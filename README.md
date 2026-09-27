## Dual Dash
https://a4-hungdao.onrender.com/

**Dual Dash** is a two-lane rhythm runner inspired by Geometry Dash. Two cubes run in opposite directions: the top one to the right and the bottom one to the left. You jump each one over spikes with its own key. Every spike is placed on a beat of the song, so you play by ear as much as by eye. It's built with **Canvas** for the graphics and the **Web Audio API** for playback, timing and sound effects, served by a small **Express** server.

### Goal of the application
The goal was a small but complete rhythm game in which two independent inputs play one song. The main challenge for the player is splitting attention between two lanes that scroll in opposite directions, with both locked to the music.

### How to play
The how-to-play screen appears when the page loads. In short:
- <kbd>F</kbd> jumps the **top** cube and <kbd>J</kbd> jumps the **bottom** cube.
- On touch screens or with a mouse, tap the upper part of the screen for the top cube and the lower part for the bottom cube. Two fingers work at once, via the Pointer Events API.
- Hold a button to jump again the moment you land.
- Hit a spike and you crash. Press any key or tap to retry. The bar along the top shows your progress, and the yellow marker shows your best run.

### User-controlled parameters (settings panel, top left)
| Parameter | Range | Effect |
|---|---|---|
| Scroll speed | 250–700 px/s | How early you see spikes coming. The timing stays on the beat. |
| Jump height | 70–140 px | Jump height, and with it how long each jump lasts |
| Audio offset | −200 to +200 ms | Shifts the visuals against the audio to fix latency on a given device |
| Volume | 0–100% | Music and sound effects, through a Web Audio `GainNode` |

Settings are saved in `localStorage`, and **Reset** restores the defaults.

### Technical notes
- **Everything runs on the audio clock.** Spike positions come from `audioContext.currentTime`, not from frame time: `x = cubeX ± (spikeTime − songTime) × speed`. The visuals therefore stay in sync with the music even when frames drop. Frame time is used only for the jump physics.
- **The chart** (`public/chart.js`) lists `[beat, lanes]` entries on a 130 BPM grid. I generated it offline by beat-tracking the song and detecting its drum hits with librosa. Loudness sets the density: quiet sections get sparse spikes, mid sections quarter notes, and loud sections eighth notes plus both-lane hits. Spikes in the same lane are always at least 1.5 beats apart, so every one can be cleared.
- **Synthesized crash sound:** a square-wave pitch drop plus a noise burst, generated with Web Audio nodes instead of loaded from a file.
- **Forgiving hitboxes,** like Geometry Dash: the cube's box is slightly inset, and the tip of each spike is harmless.

### Challenges
- **Audio/visual sync.** My first version used frame time, which drifts from the music. Switching everything to `AudioContext.currentTime`, and scheduling the song to start slightly in the future, fixed it. The audio-offset slider handles device latency.
- **Making the chart beatable.** At the default physics one jump lasts about 1.1 beats, so two spikes one beat apart in the same lane can't be cleared. I derived spacing rules from the jump arc, then verified them with an autoplay mode (below) that clears the whole song at the default settings.
- **Browser autoplay rules.** Audio can't start until the user interacts, so the how-to-play screen doubles as the start button.
- **Deploying.** Express serves `public/` using an absolute path, and JS, CSS and MP3 files get explicit content types. With a relative path, a host that starts the app from another folder returns HTML 404 pages, and the browser refuses to run them as modules ("MIME type text/html").

### Extras for testing
- `?auto`: the cubes jump by themselves (demo / chart check).
- `?t=60`: start 60 s into the song. It applies to the first run only, with a 1-second grace period.

### Credits
Music: "My World (Blood Oath Tale ver.)" (Rossi EP), from *Arknights: Endfield*. It's used for a non-commercial class project, and all rights belong to their owners.
