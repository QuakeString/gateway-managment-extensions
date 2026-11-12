# gateway-management-extension — agent notes

This is a SENTIENT UI extension (fork of ThingsBoard's gateway extension).
It is loaded into the SENTIENT UI at runtime; its `@shared/...`, `@core/...`,
`@home/...` and `@angular/*` imports are NOT bundled — they resolve through
SENTIENT's module map (`modules-map.ts`) at load time.

## Compile-time contract: sentient-ui-types
- `package.json` depends on `sentient-ui-types` (github QuakeString/sentient-ui-types),
  generated from SENTIENT's `ui-ngx`. NOT upstream `thingsboard-ui-types` —
  SENTIENT has diverged (e.g. `WidgetContext.units` is `TbUnit`, not `string`).
- The pinned tag MUST equal the SENTIENT release (image tag, e.g. 4.3.0.22)
  this build will run in — not ui-ngx's package.json version. New SENTIENT
  release → `scripts/publish-ui-types.sh <release-tag>` in the SENTIENT repo
  → bump the pin here → rebuild.
- `@angular/*`, `@ngrx/store`, echarts pins mirror SENTIENT `ui-ngx` exactly;
  the runtime supplies them. The `thingsboard/echarts` tarball URL is the
  shared fork — it is correct, don't "fix" it.
- Four places hard-code the types package path: `tsconfig.json` paths,
  `src/tsconfig.lib.json` rootDirs, `bundle.js`
  (reads `modules-map.ts` to decide externals), `load-tb-classes.js`
  (reads `styles.css` for the Tailwind blocklist).

## Build
- No global yarn: `corepack yarn install && corepack yarn build`
  (node from `~/.nvm/versions/node/v20.20.2/bin`). Output:
  `target/generated-resources/gateway-management-extension.js`.
- The build has three steps (Angular 22 and later): `ng build` (ng-packagr writes
  an ES module to `dist/gateway-extension/fesm2022`), `node bundle.js` (rollup
  turns it into the one SystemJS file, externals = the ids in `modules-map.ts`,
  `ngDevMode` replaced by `false`), `node install.js` (moves it to `target/`).
  ng-packagr itself is NOT patched any more: it moved from rollup to rolldown,
  which cannot write SystemJS.
- Bumping `@angular/compiler-cli` breaks `patches/@angular+compiler-cli+<ver>.patch`
  (it nulls `classDebugInfo` in a hash-named bundle chunk; three lines in 22).
  Move the old patch aside before install, re-apply the one-line edits in the
  new chunk, then write the patch by hand with `diff -u` against the pristine
  file (`patch-package <name>` tends to produce a huge wrong diff).
- Sanity check a build: the bundle's `System.register([...])` externals
  (33 ids today) must all exist in SENTIENT's `modules-map.ts`, and the source
  map must list no `node_modules/@angular/...` source: an Angular entry point
  that is bundled instead of shared fails at runtime ("inject() must be called
  from an injection context"). If one shows up, add it to SENTIENT's
  `modules-map.ts`, as was done for `@angular/core/rxjs-interop`.
- An extension bundle built for Angular 18 does not load in an Angular 22
  SENTIENT and the other way round: rebuild with the matching types.
- Lint is still on angular-eslint 18 / eslint 8; `.eslintrc.json` ignores
  `src/**` anyway.

## Ship
Copy the built bundle to SENTIENT `data/resources/js_modules/` (committed
artifact there); SENTIENT upserts it into its resource table on start/upgrade.
