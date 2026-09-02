Thingsboard Gateway Management Extensions
=====================
An extension to ThingsBoard, focused on configuring and managing multiple gateway devices, with real-time status updates and streamlined configuration tools. Automatically synchronized with ThingsBoard 3.9+ platform instances.
## ThingsBoard Dependencies
To add some of ThingsBoard dependencies imports to your "extension" Angular component,
please use this import structure:

```
import { <dependency> } from '<TB-module>/public-api';
```
"TB-module" - any of the following modules:
```
@app/*
@core/*
@shared/*
@modules/*
@home/*
```
"dependency" - name of dependency/type located in "TB-module".
Refer to [modules-map](https://github.com/thingsboard/thingsboard-pe-ui-types/blob/master/src/app/modules/common/modules-map.ts)
to see what you can use.

Example:

```
import { WidgetConfig } from '@shared/public-api';
```
## External Dependencies
In case you want to use your own dependencies package from the npm registry (unless you have specified another one in your package.json), you can easily add them to yarn packet manager running the next command:
```
yarn add <package-name>
```

Example:

```
yarn add lodash
```
If it's not the npm/yarn registry, and you want to add it in another way, please refer to [yarn docs](https://classic.yarnpkg.com/en/docs/cli/add).

## Run project in development mode
```
cd ${TB_GATEWAY_EXTENSION_DIR}
yarn install
yarn start
```
In widgets library create a new widget and in the resources tab of the widget editor add this file path:

```
http://localhost:4201/static/gateway/gateway-management-extension.js
```
You must also check "Is module"

## SENTIENT UI types (the compile-time contract)

This extension is loaded into the SENTIENT UI at runtime and resolves its
imports (`@shared/...`, `@core/...`, `@home/...`, `@angular/...`) through
SENTIENT's module map. It therefore compiles against **SENTIENT's own** type
definitions, published from `ui-ngx` as
[`sentient-ui-types`](https://github.com/QuakeString/sentient-ui-types) — not
against upstream `thingsboard-ui-types`, which SENTIENT has diverged from.

The pinned tag **must equal the SENTIENT release (image tag) the extension will run in**:

```
"sentient-ui-types": "https://github.com/QuakeString/sentient-ui-types.git#4.3.0.22"
```

When SENTIENT is released, publish its types with
`scripts/publish-ui-types.sh <release-tag>` in the SENTIENT repo, bump this pin
to that tag, and rebuild. A mismatch
fails here at compile time rather than on a running plant.

The `@angular/*` pins in `package.json` are kept identical to SENTIENT's
`ui-ngx` for the same reason — the runtime supplies those packages.

## Build project

```
cd ${TB_GATEWAY_EXTENSION_DIR}
yarn build
```

You can find the compiled file at the following path:
```
${TB_GATEWAY_EXTENSION_DIR}/target/generated-resources/gateway-management-extension.js
```
