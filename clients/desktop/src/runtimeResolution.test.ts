import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'vite';

const configs = [
  new URL('../vite.config.ts', import.meta.url),
  new URL('../../../cmd/client/SubmodHub/frontend/vite.config.ts', import.meta.url),
];

for (const config of configs) {
  test(`Wails runtime is bundled once: ${fileURLToPath(config)}`, async () => {
    const result = await build({
      configFile: fileURLToPath(config),
      root: fileURLToPath(new URL('../', import.meta.url)),
      logLevel: 'silent',
      build: { write: false, minify: false },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const runtimeModules = outputs.flatMap(output => 'output' in output
      ? output.output.flatMap(chunk => chunk.type === 'chunk'
        ? Object.keys(chunk.modules).filter(module => /[/\\]@wailsio[/\\]runtime[/\\]dist[/\\]runtime\.js$/.test(module))
        : [])
      : []);

    assert.equal(new Set(runtimeModules).size, 1, runtimeModules.join('\n'));
  });
}
