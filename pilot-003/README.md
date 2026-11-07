# PILOT-003 visual evidence (390×844 Before/After)

Temporary evidence for Issue #11: click/tap on `#scene` skips to the next greeting (`script.js` only).

| File | Revision |
| --- | --- |
| `before-click-390x844.png` | `main` @ 06be65e35f03d11766dc9949c88a22d24c809258 (no click-to-skip) |
| `after-click-390x844.png` | `agent/add-click-skip-greeting-5ef62595cd28` @ 0d04165fb3ad459e1fa2c67d0447f1327412cf84 (click-to-skip) |
| `after-final-390x844.png` | branch @ 0d04165fb3ad459e1fa2c67d0447f1327412cf84, `final` after skipping to the last greeting |
| `measurements-before.json` | raw state recorded by the baseline capture run |
| `measurements-after.json` | raw state recorded by the changed capture run |

Same scenario in the two click captures: 390×844 CSS viewport, DPR 2, dark theme, page loaded with the first greeting「今晚月色很好」in its `hold` phase, one real mouse click at the centre of `#scene`, screenshot 1.0 s after the click.

- Baseline (`main` @ 06be65e): the click is ignored; `今晚月色很好` (message index 0, phase `hold`) is still on screen.
- Changed (@ 0d04165): the click skips the first greeting; `西安有月亮` (message index 1, phase `hold`) is on screen.

`after-final-390x844.png` shows the last greeting「中秋快乐 ♡」frozen in the `final` phase after skipping to it.

Captured with headless Chromium 154 and a scratch CDP script; the script is not committed because Issue #11 limits the change to `script.js`. This branch is evidence only: it is not part of the PR diff and is not deployed.
