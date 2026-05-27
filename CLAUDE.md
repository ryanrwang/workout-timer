# Workout Timer

Vanilla JS/CSS/HTML workout routine manager with timer, drag-and-drop, and optional cloud sync via PHP backend. No build tools, no frameworks, no npm. Deployed via FTP to Bluehost.

## Tech Stack

- Frontend: Vanilla JS (ES6+), CSS3, HTML5 — single-file architecture (script.js, style.css, index.html)
- Backend: PHP (api.php) with file-based JSON storage in `data/users/`
- Auth: HttpOnly cookies (wt_token), fallback to Bearer token
- Icons/Fonts: Google Fonts (Inter, Material Icons) — loaded via CDN

## Key Files

| File | Purpose |
|---|---|
| `index.html` | Page shell, modal markup, script/style includes |
| `script.js` | All client logic — routing, STATE, timer, drag/drop, audio, sync |
| `style.css` | All styles, CSS variable theme at `:root` |
| `api.php` | Sync endpoint — `save` / `load` / `check` actions, cookie+Bearer auth |

## Key Commands

- **Deploy**: Push to `main` — GitHub Actions FTPs to Bluehost (`.github/workflows/deploy.yml`)
- **Run locally**: PHP-capable server required (sync calls `api.php`).
  - **Windows:** PHP 8.4 via winget at `C:\Users\DarkD\AppData\Local\Microsoft\WinGet\Packages\PHP.PHP.8.4_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe`
  - **Mac:** PHP via Homebrew at `/opt/homebrew/bin/php`
  - `.claude/launch.json` has two configs: `workout-mac` and `workout-win`. Use the one matching the current OS with `preview_start`.
- **No tests exist.**

## Architecture

- **Routing**: Hash-based (`#home`, `#edit/{id}`, `#workout/{id}`). `_programmaticHashChanges` counter prevents race conditions with back button.
- **State**: Runtime `STATE` object + `localStorage` for persistence. Key: `workoutTimerData`.
- **Sync**: Debounced (500ms) save to server. Local data wins on conflict. Token stored in `syncToken` localStorage key.
- **Audio**: Web Audio API oscillator chime (4-note Westminster). No audio files.
- **Drag & drop**: Custom implementation for both exercise and group reordering.

## Rules / Constraints

- **No build process** — all files are served directly. Do not introduce bundlers, transpilers, or package managers.
- **Never modify `data/users/*.json`** — these are live user data files, excluded from git and deploys.
- **Never remove `.htaccess` files** — root handles auth header passthrough; `data/.htaccess` blocks direct file access.
- **Keep single-file architecture** — all JS lives in `script.js`, all CSS in `style.css`. Do not split into modules.
- **localStorage keys are API** — changing key names (`workoutTimerData`, `workoutProgress_{id}`, `syncToken`, `syncName`, `workoutAudioMuted`) breaks existing users' data.
- **`api.php` auth flow**: cookie → Bearer header → query param (for sendBeacon). All three paths must work.
- **CSS variables define the theme** — all colors use custom properties at `:root`. Never use hardcoded color values.
- **Backward compat**: `globalRest` on groups migrates to per-exercise `betweenRest`. Don't remove migration code.

## Deployment

- FTP via GitHub Actions on push to `main`
- Target: `./apps/workout/` on Bluehost
- Excludes: `.git*`, `data/users/**`
- Secrets: `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`
