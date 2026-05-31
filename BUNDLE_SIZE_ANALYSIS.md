# Bundle Size Analysis & Optimization Plan

**Date:** 2026-04-12
**Current bundle size:** ~2.5 MiB (minified), ~700-800 KB (gzipped)
**Target bundle size:** ~965 KB (minified), ~280-320 KB (gzipped)

---

## 1. Current Bundle Composition

Total unminified source rolled into a single SystemJS bundle: **9,324 KB (9.1 MB)**

| Category | Unminified | Minified (est.) | % of total | Files |
|---|---|---|---|---|
| Project code | 4,951 KB | ~1,980 KB | 53.0% | 176 |
| ECharts + ZRender | 3,498 KB | ~1,400 KB | 37.5% | 468 |
| XLSX (SheetJS) | 875 KB | ~350 KB | 9.4% | 1 |
| Angular rxjs-interop | 10 KB | ~4 KB | 0.1% | 1 |

**Key finding:** Two third-party libraries (echarts + xlsx) account for **46.9%** of the entire bundle while being used in only **3 out of 176** project files.

### Project Code Breakdown

| Area | Unminified | % of project | Files | Note |
|---|---|---|---|---|
| Connectors | 3,444 KB | 69.6% | 109 | All 19 connector types statically imported |
| Configuration | 468 KB | 9.5% | 12 | |
| Service RPC | 384 KB | 7.8% | 15 | |
| Shared | 209 KB | 4.2% | 21 | Models, directives, pipes |
| Statistics | 204 KB | 4.1% | 6 | Only consumer of echarts |
| Form | 153 KB | 3.1% | 3 | |
| Logs | 42 KB | 0.8% | 3 | |
| Remote Shell | 16 KB | 0.3% | 2 | |
| Device Command | 15 KB | 0.3% | 2 | |
| Other | 16 KB | 0.3% | 3 | |

---

## 2. Root Causes

### 2.1 ECharts bundled instead of externalized (37.5% of bundle)

ECharts + ZRender (468 modules) are bundled because they are **not listed in ThingsBoard's `modules-map.ts`** externals. The parent ThingsBoard app already loads echarts (custom fork `5.5.0-TB`), so this is **pure duplication**.

- Used only in: `gateway-statistics-chart.component.ts`
- Import: `import * as echarts from 'echarts/core'` (line 27)
- Registered modules (lines 203-219): BarChart, CustomChart, LineChart, PieChart, RadarChart, plus grid/tooltip/zoom components

### 2.2 XLSX bundled for rare use case (9.4% of bundle)

`xlsx` (SheetJS, 875 KB unminified) is imported with `import * as XLSX` in only 2 dialog components that open on user action:

- `src/app/gateway/states/gateway-connectors/components/s7/s7-tag-import-dialog/s7-tag-import-dialog.component.ts:26`
- `src/app/gateway/states/gateway-connectors/components/ethernet-ip/ethernet-ip-tag-import-dialog/ethernet-ip-tag-import-dialog.component.ts:23`

### 2.3 All locale files statically imported (~179 KB)

`src/app/gateway/shared/models/gateway-locale.constant.ts` (lines 18-32) statically imports all 15 language JSON files even though only 1 language is active at a time.

Largest locale files:
- `en_US.json` — 52 KB
- `ar_AE.json` — 20 KB
- `es_ES.json`, `zh_CN.json`, `pl_PL.json`, `lt_LT.json` — 16 KB each

### 2.4 All connector default configs statically imported (~120 KB)

`src/app/gateway/shared/models/connectors-default-config.constant.ts` (lines 16-33) statically imports all 18 connector JSON config files.

Largest config files:
- `modbus.json` — 20 KB
- `mqtt.json` — 16 KB
- `rest.json` — 12 KB

### 2.5 All connector components eagerly loaded (69.6% of project code)

`gateway-connectors.component.ts` (lines 103-127) statically imports all 19 connector component variants:
- MQTT, OPC-UA, Modbus, Socket, BACnet, REST, S7, Ethernet-IP, IEC61850
- Each has both legacy and current versions
- A typical gateway uses only 1-3 connector types

### 2.6 No lazy loading or code splitting

- No `loadChildren` route-based lazy loading (this is a library, not an app)
- No `import()` dynamic imports anywhere
- No Angular `@defer` blocks
- All 105 standalone components imported statically in `gateway-extension.module.ts`

---

## 3. Optimization Plan

### 3.1 Externalize ECharts (estimated savings: ~1,400 KB minified)

**Effort:** Low (config change)
**Risk:** Low

ECharts is already available in the parent ThingsBoard application. Add echarts module IDs to the Rollup externals so they resolve from the host at runtime instead of being duplicated in this bundle.

**Option A — Add to `modules-map.ts` in ThingsBoard** (preferred if you control the parent):
```
'echarts/core'
'echarts/charts'
'echarts/components'
'echarts/features'
'echarts/renderers'
'echarts/types/dist/shared'
```

**Option B — Modify the patched `isExternalDependency` in `patches/ng-packagr+18.2.1.patch`:**
```javascript
function isExternalDependency(moduleId, externalModuleIds) {
    if (moduleId.startsWith('.') || moduleId.startsWith('/') || path.isAbsolute(moduleId)) {
        return false;
    }
    // Force echarts as external (provided by host app)
    if (moduleId.startsWith('echarts/') || moduleId.startsWith('zrender/')) {
        return true;
    }
    if (externalModuleIds.indexOf(moduleId) === -1) {
        return false;
    }
    return true;
}
```

### 3.2 Dynamic import XLSX (estimated savings: ~350 KB minified deferred)

**Effort:** Low (2 files to change)
**Risk:** Low

Replace static wildcard import with dynamic import in both tag-import dialog components:

**Before:**
```typescript
import * as XLSX from 'xlsx';
```

**After:**
```typescript
// Remove top-level import, load on demand
async onFileSelected(event: Event) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(data, { type: 'array' });
  // ...
}
```

Files to modify:
- `src/app/gateway/states/gateway-connectors/components/s7/s7-tag-import-dialog/s7-tag-import-dialog.component.ts`
- `src/app/gateway/states/gateway-connectors/components/ethernet-ip/ethernet-ip-tag-import-dialog/ethernet-ip-tag-import-dialog.component.ts`

### 3.3 Lazy-load locale files (estimated savings: ~50 KB minified deferred)

**Effort:** Low (1 file refactor)
**Risk:** Low

**File:** `src/app/gateway/shared/models/gateway-locale.constant.ts`

**Before:**
```typescript
import enUS from '../../assets/locale/locale.constant-en_US.json';
import arAE from '../../assets/locale/locale.constant-ar_AE.json';
// ... 13 more static imports
```

**After:**
```typescript
const localeImports: Record<AvailableLanguages, () => Promise<any>> = {
  [AvailableLanguages.English]: () => import('../../assets/locale/locale.constant-en_US.json'),
  [AvailableLanguages.Arabic]: () => import('../../assets/locale/locale.constant-ar_AE.json'),
  // ...
};

export const addGatewayLocale = async (translate: TranslateService) => {
  const lang = (translate.currentLang as AvailableLanguages) ?? AvailableLanguages.English;
  const enData = (await localeImports[AvailableLanguages.English]()).default;
  const langData = lang !== AvailableLanguages.English
    ? (await localeImports[lang]()).default
    : enData;
  // merge and set...
};
```

### 3.4 Lazy-load connector default configs (estimated savings: ~35 KB minified deferred)

**Effort:** Low (1 file refactor)
**Risk:** Low

**File:** `src/app/gateway/shared/models/connectors-default-config.constant.ts`

**Before:**
```typescript
import mqtt from '../../assets/connector-default-configs/mqtt.json';
import modbus from '../../assets/connector-default-configs/modbus.json';
// ... 16 more static imports
```

**After:**
```typescript
const configImports: Record<ConnectorType, () => Promise<any>> = {
  [ConnectorType.MQTT]: () => import('../../assets/connector-default-configs/mqtt.json'),
  [ConnectorType.MODBUS]: () => import('../../assets/connector-default-configs/modbus.json'),
  // ...
};

export async function getDefaultConfig(type: ConnectorType): Promise<GatewayVersionedDefaultConfig | GatewayConnector> {
  const mod = await configImports[type]();
  return mod.default;
}
```

### 3.5 Defer connector components with @defer (estimated savings: ~700 KB minified deferred)

**Effort:** Medium (template and component changes)
**Risk:** Medium — requires Angular 17+ `@defer` support

**File:** `src/app/gateway/states/gateway-connectors/gateway-connectors.component.html`

**Before:** All 19 connector config components are statically imported and switched via `ngSwitch`.

**After:** Use `@defer` to load each connector's UI on demand:
```html
@defer (when selectedConnectorType === ConnectorType.MQTT) {
  <app-mqtt-basic-config [formGroup]="connectorForm" />
}
@defer (when selectedConnectorType === ConnectorType.MODBUS) {
  <app-modbus-basic-config [formGroup]="connectorForm" />
}
@defer (when selectedConnectorType === ConnectorType.S7) {
  <app-s7-basic-config [formGroup]="connectorForm" />
}
<!-- ... other connector types -->
```

Remove the static imports from the component's `imports` array and let `@defer` handle chunk loading.

### 3.6 Source map handling (no size savings, but reduces transfer)

**Effort:** Low
**Risk:** None

The `system/gateway-management-extension.js.map` is 13 MB. Ensure:
- Production server does NOT serve `.map` files to regular users
- Or configure `X-SourceMap` header so maps are only fetched when DevTools are open

---

## 4. Projected Results

| Change | Minified Savings | Type |
|---|---|---|
| Externalize echarts | ~1,400 KB | Removed (already in parent app) |
| Dynamic import XLSX | ~350 KB | Deferred to on-demand |
| Lazy-load locales | ~50 KB | Deferred to on-demand |
| Lazy-load connector configs | ~35 KB | Deferred to on-demand |
| @defer connector components | ~700 KB | Deferred to on-demand |
| **Total** | **~2,535 KB** | |

### Before vs After

| Metric | Before | After | Reduction |
|---|---|---|---|
| Initial bundle (minified) | ~2,500 KB | **~965 KB** | **~61%** |
| Gzipped transfer size | ~700-800 KB | **~280-320 KB** | **~60%** |

---

## 5. Implementation Priority

| Priority | Task | Impact | Effort |
|---|---|---|---|
| 1 | Externalize echarts | ~1,400 KB | Low |
| 2 | Dynamic import XLSX | ~350 KB | Low |
| 3 | Lazy-load locales | ~50 KB | Low |
| 4 | Lazy-load connector configs | ~35 KB | Low |
| 5 | @defer connector components | ~700 KB | Medium |

Items 1-4 are quick wins with minimal code changes. Item 5 requires more careful refactoring but provides the largest improvement to project code loading.

---

## 6. Key Files Reference

### Build & Config
- `angular.json` — Build configuration
- `src/ng-package.json` — ng-packagr entry point
- `src/tsconfig.lib.prod.json` — Production TypeScript config
- `patches/ng-packagr+18.2.1.patch` — Custom Rollup/SystemJS build patch
- `tailwind.config.js` — Tailwind configuration

### Files to Modify
- `src/app/gateway/shared/models/gateway-locale.constant.ts` — Locale imports
- `src/app/gateway/shared/models/connectors-default-config.constant.ts` — Connector config imports
- `src/app/gateway/states/gateway-connectors/gateway-connectors.component.ts` — Connector component imports
- `src/app/gateway/states/gateway-connectors/components/s7/s7-tag-import-dialog/s7-tag-import-dialog.component.ts` — XLSX import
- `src/app/gateway/states/gateway-connectors/components/ethernet-ip/ethernet-ip-tag-import-dialog/ethernet-ip-tag-import-dialog.component.ts` — XLSX import

### External Dependency
- `node_modules/thingsboard/src/app/modules/common/modules-map.ts` — Controls which modules are treated as external
