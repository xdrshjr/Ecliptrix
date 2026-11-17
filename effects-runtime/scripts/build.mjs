import { bundle } from '@remotion/bundler';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import {
  cp, mkdir, readdir, readFile, writeFile, stat, rm,
} from 'node:fs/promises';

const runtimeRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const projectRoot = dirname(runtimeRoot);
const outputRoot = join(projectRoot, 'desktop/build/effects');
const require = createRequire(import.meta.url);
const rootRequire = createRequire(join(projectRoot, 'package.json'));
for (const name of ['remotion', 'react', 'react-dom']) {
  const rootVersion = rootRequire(`${name}/package.json`).version;
  if (rootVersion !== require(`${name}/package.json`).version) {
    throw new Error(`Effects version mismatch: ${name}`);
  }
}
execFileSync(process.execPath, [require.resolve('typescript/lib/tsc.js'),
  '--noEmit', '--project', join(runtimeRoot, 'tsconfig.json')], {
  stdio: 'inherit', windowsHide: true,
});

/** Include every packaged byte, with stable relative paths in the manifest. */
async function hashTree(directory) {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const target = join(directory, name);
    if ((await stat(target)).isDirectory()) {
      files.push(...await hashTree(target));
      continue;
    }
    const bytes = await readFile(target);
    files.push({
      path: relative(outputRoot, target).replaceAll('\\', '/'),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return files;
}

console.log('effects build: compiling controller and shared composition');
await mkdir(join(runtimeRoot, 'dist'), { recursive: true });
for (const name of await readdir(join(runtimeRoot, 'src'))) {
  if (!name.endsWith('.ts')) continue;
  const source = await readFile(join(runtimeRoot, 'src', name), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: name,
  });
  await writeFile(join(runtimeRoot, 'dist', name.replace(/\.ts$/, '.js')),
    compiled.outputText);
}
const textLayout = await readFile(join(projectRoot, 'src/lib/effects/textLayout.json'));
await writeFile(join(projectRoot, 'backend-services/basic-service/app/services/effects/text-layout.generated.json'), textLayout);
await bundle({
  entryPoint: join(projectRoot,
    'src/lib/effects/compositions/EffectRoot.tsx'),
  outDir: join(outputRoot, 'bundle'),
  publicDir: join(projectRoot, 'public/effects/fonts'),
  webpackOverride: (configuration) => ({
    ...configuration,
    resolve: { ...configuration.resolve,
      alias: { ...configuration.resolve?.alias,
        '@': join(projectRoot, 'src') },
    },
  }),
  onProgress: (progress) => {
    if (progress % 25 === 0) console.log(`effects bundle: ${progress}%`);
  },
});
await cp(join(runtimeRoot, 'dist'), join(outputRoot, 'runtime'), {
  recursive: true,
});
await cp(join(runtimeRoot, 'package.json'),
  join(outputRoot, 'runtime/package.json'));
await cp(join(runtimeRoot, 'package-lock.json'),
  join(outputRoot, 'runtime/package-lock.json'));
await writeFile(join(outputRoot, 'runtime/text-layout.json'), textLayout);
const groups = {};
const browserVersion = execFileSync(join(outputRoot,
  'browser/chrome-headless-shell.exe'), ['--version', '--disable-logging',
  `--log-file=${join(outputRoot, 'browser-build.log')}`], {
  encoding: 'utf8', windowsHide: true, timeout: 10000,
}).trim();
// Chrome on Windows can leave diagnostics beside its executable. They are
// not installation resources and must never affect the immutable identity.
await rm(join(outputRoot, 'browser/debug.log'), { force: true });
for (const group of ['bundle', 'browser', 'native', 'fonts', 'runtime']) {
  const files = await hashTree(join(outputRoot, group));
  groups[group] = {
    hash: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    files,
  };
}
const catalog = await readFile(join(projectRoot,
  'src/lib/effects/catalog.json'));
if (JSON.parse(catalog).templates.length !== 24) {
  throw new Error('Effects catalog must contain exactly 24 templates');
}
await writeFile(join(outputRoot, 'catalog.json'), catalog);
await writeFile(join(projectRoot,
  'backend-services/basic-service/app/services/effects/catalog.generated.json'),
catalog);
const manifest = {
  protocolVersion: 1,
  engineVersion: '4.0.544',
  reactVersion: require('react/package.json').version,
  reactDomVersion: require('react-dom/package.json').version,
  platform: process.platform, arch: process.arch,
  bundleHash: groups.bundle.hash,
  catalogHash: createHash('sha256').update(catalog).digest('hex'),
  textLayoutHash: createHash('sha256').update(textLayout).digest('hex'),
  fontHash: groups.fonts.hash, browserHash: groups.browser.hash,
  nativeHash: groups.native.hash,
  runtimeHash: groups.runtime.hash,
  browserVersion,
  supportedTemplates: JSON.parse(catalog).templates.length,
  browserExecutable: 'browser/chrome-headless-shell.exe',
  binariesDirectory: 'native',
  files: Object.values(groups).flatMap((group) => group.files),
};
manifest.runtimeFingerprint = createHash('sha256')
  .update(JSON.stringify(manifest)).digest('hex');
await writeFile(join(outputRoot, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n');
console.log('effects build: immutable bundle and manifest ready');
