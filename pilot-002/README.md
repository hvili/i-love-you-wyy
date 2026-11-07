# PILOT-002 visual evidence (390×844 Before/After)

Temporary evidence for Issue #9: `.music-toggle` `font-size` `16px` → `20px`.

| File | Revision |
| --- | --- |
| `before-full-390x844.png` | `main` @ 06be65e (font-size: 16px) |
| `after-full-390x844.png` | `agent/music-toggle-font-size-2a185e943de6` @ 2ba6e0d (font-size: 20px) |
| `before-button-crop.png` | `main` @ 06be65e, top-right button area at 8× |
| `after-button-crop.png` | `agent/music-toggle-font-size-2a185e943de6` @ 2ba6e0d, top-right button area at 8× |

Captured with headless Chromium 154 at a 390×844 CSS viewport (DPR 2 for the full screenshots, DPR 8 for the button crops), with the first greeting「今晚月色很好」in its hold phase. The music button is hidden by default because `script.js` ships `MUSIC_ENABLED = false`; the captures used a scratch copy with that flag set to `true` so the button is visible, matching the enabled-music state. No deployed project files were changed for the captures.

This branch is evidence only. It is not part of `main` and not part of the PR change.
