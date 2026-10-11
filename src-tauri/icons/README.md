# App icons

## Source

- **`gitoza-icon.svg`** — edit this, then regenerate raster icons.

## Regenerate

From the repository root:

```bash
npm run icons:regenerate
```

`icons:regenerate` runs Tauri’s icon command on the SVG.

Equivalent manual command:

```bash
npm run tauri icon src-tauri/icons/gitoza-icon.svg
```

## What to commit

| Keep in git | Purpose |
|-------------|---------|
| `gitoza-icon.svg` | Single source of truth |
| `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico` | Referenced in `tauri.conf.json` → `bundle.icon` |
| `icon.ico` | Also used as the Windows NSIS installer icon (`tauri.windows.conf.json` → `installerIcon`) |
| Other root PNGs / `Square*.png` / `StoreLogo.png` | Desktop and Windows tile assets |

## What not to commit

`ios/` and `android/` under this folder are listed in the root `.gitignore`. They are optional outputs of `tauri icon` for mobile; this repo targets desktop only unless you initialize Tauri mobile projects.
