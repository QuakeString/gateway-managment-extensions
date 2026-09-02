# gateway-management-extension — agent notes

This is a SENTIENT UI extension (fork of ThingsBoard's gateway extension).
It is loaded into the SENTIENT UI at runtime; its `@shared/...`, `@core/...`,
`@home/...` and `@angular/*` imports are NOT bundled — they resolve through
SENTIENT's module map (`modules-map.ts`) at load time.

## Compile-time contract: sentient-ui-types
- `package.json` depends on `sentient-ui-types` (github QuakeString/sentient-ui-types),
  generated from SENTIENT's `ui-ngx`. NOT upstream `thingsboard-ui-types` —
  SENTIENT has diverged (e.g. `WidgetContext.units` is `TbUnit`, not `string`).
- The pinned tag MUST equal the SENTIENT version this build will run in.
  New SENTIENT release → run `scripts/publish-ui-types.sh` in the SENTIENT
  repo → bump the pin here → rebuild.
- `@angular/*`, `@ngrx/store`, echarts pins mirror SENTIENT `ui-ngx` exactly;
  the runtime supplies them. The `thingsboard/echarts` tarball URL is the
  shared fork — it is correct, don't "fix" it.
- Four places hard-code the types package path: `tsconfig.json` paths,
  `src/tsconfig.lib.json` rootDirs, `patches/ng-packagr+*.patch`
  (reads `modules-map.ts` to decide externals), `load-tb-classes.js`
  (reads `styles.css` for the Tailwind blocklist).

## Build
- No global yarn: `corepack yarn install && corepack yarn build`
  (node from `~/.nvm/versions/node/v20.20.2/bin`). Output:
  `target/generated-resources/gateway-management-extension.js`.
- Bumping `@angular/compiler-cli` breaks `patches/@angular+compiler-cli+<ver>.patch`
  (it nulls `classDebugInfo` in a hash-named bundle chunk). Move the old patch
  aside before install, re-apply the two one-line edits in the new chunk,
  then `corepack yarn patch-package @angular/compiler-cli`.
- Sanity check a build: the bundle's `System.register([...])` externals
  (27 ids today) must all exist in SENTIENT's `modules-map.ts`.

## Ship
Copy the built bundle to SENTIENT `data/resources/js_modules/` (committed
artifact there); SENTIENT upserts it into its resource table on start/upgrade.
