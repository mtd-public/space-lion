# Space Lion

A top-down mobile space shooter in the spirit of *Xevious* / *Sinistar*: your ship
flies continuously, steered with a virtual thumbstick, while you tap anywhere to
fire at a reticle fixed ahead of your nose.

## Status: early prototype

This is a proof-of-concept slice covering the core moment-to-moment gameplay:

- Always-forward ship movement steered by a virtual thumbstick (bottom-left)
- Tap/hold anywhere else to fire at the reticle
- A fixed reticle projected ahead of the ship
- Camera-follows-player, bounded open world
- Basic tower enemies that track and shoot the player, with health bars and
  score on destruction
- Simple placeholder vector art (no image/audio assets yet)
- Score, player health bar, game over / retry flow

Not yet built: gold pickups, ring courses, the recurring Sentinel UFO boss,
and the Space Lion final boss/win state.

## Running locally

No build step — it's plain ES modules. Serve the folder with any static
file server and open it on a phone (or narrow a desktop browser window):

```
npx http-server -p 8080
# or: python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Controls

- **Thumbstick** (bottom-left of the screen): drag to steer. The ship keeps
  flying in the last direction you set even after you let go.
- **Tap or hold anywhere else**: fire.
- Desktop testing: WASD/arrow keys to steer, Space to fire.
