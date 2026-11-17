import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, cp, readFile } from 'node:fs/promises';
import { prepareFontResources } from './font-resources.mjs';
import { ensureBrowser } from '@remotion/renderer';

const require = createRequire(import.meta.url);
const runtimeRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const projectRoot = dirname(runtimeRoot);
const outputRoot = join(projectRoot, 'desktop/build/effects');
const fontRoot = join(projectRoot, 'public/effects/fonts');
async function prepareFonts() {
  const lock = JSON.parse(await readFile(join(fontRoot, 'source-lock.json'), 'utf8'));
  await prepareFontResources({ lock, root: fontRoot, outputRoot: join(outputRoot, 'fonts') });
}

console.log('effects prepare: downloading build-only browser/fonts');
await mkdir(outputRoot, { recursive: true });
const browser = await ensureBrowser({ logLevel: 'info' });
if (!('path' in browser) || !browser.path) {
  throw new Error(`Unable to prepare browser: ${browser.type}`);
}
await cp(dirname(browser.path), join(outputRoot, 'browser'), {
  recursive: true,
});
const nativeRoot = dirname(require.resolve(
  '@remotion/compositor-win32-x64-msvc/package.json',
));
await cp(nativeRoot, join(outputRoot, 'native'), { recursive: true });
await prepareFonts();
console.log('effects prepare: browser, native resources and fonts ready');
