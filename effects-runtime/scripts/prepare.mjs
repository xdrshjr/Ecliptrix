import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ensureBrowser } from '@remotion/renderer';

const require = createRequire(import.meta.url);
const runtimeRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const projectRoot = dirname(runtimeRoot);
const outputRoot = join(projectRoot, 'desktop/build/effects');
const fontRoot = join(projectRoot, 'public/effects/fonts');
const definitions = [
  ['sans', 'notosanssc', 'NotoSansSC[wght].ttf'],
  ['serif', 'notoserifsc', 'NotoSerifSC[wght].ttf'],
  ['mono', 'notosansmono', 'NotoSansMono[wdth,wght].ttf'],
];

/** Download licensed fonts once at build time, never in the installed app. */
async function prepareFonts() {
  await mkdir(fontRoot, { recursive: true });
  const fonts = [];
  for (const [family, directory, name] of definitions) {
    for (const fileName of [name, 'OFL.txt']) {
      const localName = fileName === 'OFL.txt'
        ? `${directory}-OFL.txt` : name;
      const destination = join(fontRoot, localName);
      let bytes;
      try { bytes = await readFile(destination); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const response = await fetch(
          `https://raw.githubusercontent.com/google/fonts/main/ofl/`
          + `${directory}/${encodeURIComponent(fileName)}`,
          { signal: AbortSignal.timeout(120000) },
        );
        if (!response.ok) throw new Error(`Font ${name}: ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
        await writeFile(destination, bytes);
      }
      fonts.push({ family, path: localName,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length, weight: '100 900',
      });
    }
  }
  await writeFile(join(fontRoot, 'manifest.json'),
    JSON.stringify({ fonts }, null, 2) + '\n');
  await cp(fontRoot, join(outputRoot, 'fonts'), { recursive: true });
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
