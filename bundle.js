///
/// Copyright © 2016-2026 The SENTIENT Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///

// Turns the package that `ng build` wrote (dist/gateway-extension/fesm2022) into the single
// SystemJS file the SENTIENT UI loads at runtime (dist/gateway-extension/system).
//
// Imports that the UI provides through its module map stay external; everything else
// (xlsx, ...) is bundled in. The module map is read from the sentient-ui-types package, so the
// list of externals always matches the UI release the extension is built against.

const fs = require('fs');
const path = require('path');
const { rollup } = require('rollup');
const { nodeResolve } = require('@rollup/plugin-node-resolve');
const commonJs = require('@rollup/plugin-commonjs');
const json = require('@rollup/plugin-json');
const replace = require('@rollup/plugin-replace');
const terser = require('@rollup/plugin-terser');

const root = __dirname;
const entryName = 'gateway-management-extension';
const entry = path.join(root, 'dist', 'gateway-extension', 'fesm2022', entryName + '.mjs');
const systemDir = path.join(root, 'dist', 'gateway-extension', 'system');
const modulesMapFile = path.join(root, 'node_modules', 'sentient-ui-types', 'src', 'app', 'modules', 'common', 'modules-map.ts');

function externalModuleIds() {
  const data = fs.readFileSync(modulesMapFile, 'utf8');
  const match = /private modulesMap: {\[key: string\]: any} = {([^;]*)};/gsm.exec(data);
  if (!match) {
    throw new Error(`Module map not found in ${modulesMapFile}`);
  }
  return match[1].split(/,\r?\n/)
    .map(line => line.trim().split(':')[0].replaceAll("'", '').trim())
    .filter(id => id.length);
}

async function bundle() {
  const externals = new Set(externalModuleIds());
  const build = await rollup({
    context: 'this',
    input: entry,
    external: id => !(id.startsWith('.') || id.startsWith('/') || path.isAbsolute(id)) && externals.has(id),
    plugins: [
      nodeResolve(),
      json(),
      // ngDevMode: the compiler guards development-only code with it and the production UI does not define it
      replace({ preventAssignment: true, 'process.env.NODE_ENV': '"production"', ngDevMode: 'false' }),
      commonJs(),
      terser()
    ],
    onwarn: warning => {
      switch (warning.code) {
        case 'CIRCULAR_DEPENDENCY':
        case 'UNUSED_EXTERNAL_IMPORT':
        case 'THIS_IS_UNDEFINED':
        case 'EMPTY_BUNDLE':
          break;
        default:
          console.warn(warning.message);
      }
    },
    // same as the Angular packager: no tree shaking of the packaged sources
    treeshake: false
  });
  await build.write({
    format: 'system',
    dir: systemDir,
    inlineDynamicImports: false,
    hoistTransitiveImports: false,
    chunkFileNames: entryName + '-[name]-[hash].js',
    entryFileNames: entryName + '.js',
    compact: true,
    banner: '',
    sourcemap: true
  });
  await build.close();
}

module.exports = { bundle };

if (require.main === module) {
  bundle().then(
    () => console.log(`SystemJS bundle written to ${path.relative(root, systemDir)}`),
    error => {
      console.error(error);
      process.exit(1);
    }
  );
}
