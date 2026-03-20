---
estimated_steps: 4
estimated_files: 2
---

# T01: Add minification and tree-shaking flags to esbuild build scripts

**Slice:** S03 — Bundle Optimization & Async I/O
**Milestone:** M016

## Description

Add `--minify` and `--tree-shaking=true` to the two esbuild build commands in `package.json` to reduce bundle sizes below the R005 targets (extension ≤100KB, webview ≤220KB). Add `--metafile` for diagnostic bundle analysis output. Update `.vscodeignore` to exclude metafiles from VSIX.

Current sizes: extension 159KB, webview 345KB. Research shows minification alone drops these to ~91KB and ~193KB respectively.

Watch scripts must NOT be modified — minification adds rebuild latency that hurts developer iteration.

## Steps

1. Edit `package.json` — add `--minify --tree-shaking=true --metafile=dist/meta-extension.json` to the `build:extension` script. The current command is:
   ```
   esbuild src/extension/index.ts --bundle --outfile=dist/extension.js --external:vscode --format=cjs --platform=node --sourcemap
   ```
   Append the three new flags. Do NOT touch `watch:extension`.

2. Edit `package.json` — add `--minify --tree-shaking=true --metafile=dist/meta-webview.json` to the `build:webview` script. The current command is:
   ```
   esbuild src/webview/index.ts --bundle --outfile=dist/webview/index.js --format=iife --platform=browser --sourcemap --loader:.css=css --define:process.env.NODE_ENV=\"production\"
   ```
   Append the three new flags. Do NOT touch `watch:webview`.

3. Edit `.vscodeignore` — add `dist/meta-*.json` on a new line to exclude metafile output from VSIX packaging. The file already excludes `**/*.map`.

4. Run `npm run build` and verify:
   - `dist/extension.js` ≤ 100KB (102400 bytes)
   - `dist/webview/index.js` ≤ 220KB (225280 bytes)
   - `dist/meta-extension.json` and `dist/meta-webview.json` exist
   - Run `npm test` — all 618+ tests still pass

## Must-Haves

- [ ] `--minify` flag on both build scripts
- [ ] `--tree-shaking=true` flag on both build scripts
- [ ] `--metafile` flag on both build scripts with distinct output paths
- [ ] Watch scripts unchanged (no `--minify` on watch:extension or watch:webview)
- [ ] `.vscodeignore` excludes `dist/meta-*.json`
- [ ] Extension bundle ≤ 100KB
- [ ] Webview bundle ≤ 220KB
- [ ] All 618+ tests pass

## Verification

- `npm run build` succeeds and reports smaller sizes
- `node -e "const fs=require('fs'); const e=fs.statSync('dist/extension.js').size; const w=fs.statSync('dist/webview/index.js').size; console.log('ext:',e,'web:',w); if(e>102400||w>225280) process.exit(1)"` exits 0
- `test -f dist/meta-extension.json && test -f dist/meta-webview.json && echo OK` prints OK
- `grep "meta-\*" .vscodeignore` finds the exclusion line
- `npm test` — all tests pass
- Confirm watch scripts don't contain `--minify`: `grep "watch:" package.json | grep -c "minify"` returns 0

## Inputs

- `package.json` — current build scripts without minification flags
- `.vscodeignore` — current exclusion list (already has `**/*.map`)

## Expected Output

- `package.json` — build scripts include `--minify --tree-shaking=true --metafile=dist/meta-*.json`
- `.vscodeignore` — includes `dist/meta-*.json` line
- `dist/extension.js` — minified bundle ≤100KB
- `dist/webview/index.js` — minified bundle ≤220KB
- `dist/meta-extension.json` — esbuild metafile for extension bundle analysis
- `dist/meta-webview.json` — esbuild metafile for webview bundle analysis
