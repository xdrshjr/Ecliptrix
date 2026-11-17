import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const visual = require('../../desktop/scripts/lib/effects-visual-acceptance.js');
const fontUsage = require('../../desktop/scripts/lib/effects-font-usage.js');
const resources = join(root, 'desktop/build/effects');
const real = { skip: process.env.EFFECTS_REAL_RUNTIME_TEST !== '1', timeout: 120000 };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function renderText(templateId, title, params = {}, frames = [29], subtitle = '') {
  const catalog = JSON.parse(await readFile(join(resources, 'catalog.json'), 'utf8'));
  const template = catalog.templates.find(t => t.id === templateId);
  const vector = { schemaVersion: 1, templateId, templateVersion: 1,
    canvas: { width: 1920, height: 1080, fps: 30 }, durationFrames: 60, seed: 1,
    content: { title, subtitle }, palette: { background: '#15171A', foreground: '#F5F4F1', accent: '#C87758' },
    typography: { family: 'sans', scale: 1, align: 'center' }, motion: { speed: 1, intensity: 1 },
    params: { ...template.defaults, ...params }, inputs: [] };
  const outputDirectory = join(resources, 'r3-browser', randomUUID());
  await mkdir(join(outputDirectory, 'inputs'), { recursive: true });
  const request = { entryRoot: join(root, 'effects-runtime/dist'), resourceRoot: resources,
    outputDirectory, jobDirectory: outputDirectory, frames,
    submission: { document: vector, inputs: [], requestHash: digest(JSON.stringify(vector)) },
    fontBinding: { case_id: 'browser-text', family: 'sans', input_sha256: digest(JSON.stringify(vector)) } };
  const input = join(outputDirectory, 'request.json');
  await writeFile(input, JSON.stringify(request));
  await visual.renderStillsWorker(input);
  const layouts = JSON.parse(await readFile(join(outputDirectory, 'layouts.json'), 'utf8'));
  const usages = JSON.parse(await readFile(join(outputDirectory, 'font-usage.json'), 'utf8'));
  return { layouts, usages, vector, outputDirectory };
}
test('uses_browser_bounds_for_text', real, async () => {
  const result = await renderText('title-rise', 'Wi文Cafe\u0301 A\u030a\t混排 🎬✨😀 '.repeat(4));
  const lines = result.layouts[0].lines;
  assert(lines.length > 0);
  for (const line of lines) {
    assert(line.x >= 0 && line.x + line.width <= 1921);
    assert(line.y >= 0 && line.y + line.height <= 1081);
  }
  assert(result.usages[0].nodes.every(node => node.fonts.length && node.fonts.every(font => font.isCustomFont)));
  assert(result.usages[0].nodes.some(node => node.fonts.some(font => font.familyName === 'Noto Emoji')));
});
test('preserves_explicit_empty_lines', real, async () => {
  for (const template of ['type-lines', 'type-cursor']) {
    const result = await renderText(template, 'First\r\n\r\nSecond\r\n', {}, [0, 29]);
    const lines = result.layouts.find(layout => layout.frame === 29).lines;
    const first = lines.find(line => line.text.includes('First') || line.text === 'F');
    const second = lines.find(line => line.text.includes('Second') || line.text === 'S');
    assert(first && second);
    assert(Math.abs(second.y - first.y - first.line_height * 2) <= 1);
    assert.equal(result.layouts.find(layout => layout.frame === 29).text_boxes[0].line_count, 4);
  }
});
test('keeps_callout_text_inside_safe_area', real, async () => {
  for (const pointY of [0.5, 0.500001]) {
    const result = await renderText('callout-line', '一\n二\n三', { pointY });
    for (const line of result.layouts[0].lines) assert(line.y + line.height <= 1080 * 0.94 + 1);
  }
  await renderText('counter-up', 'Counter', { value: 1000000, suffix: 'ABCDEFGH' });
  await renderText('countdown-ring', 'Countdown');
  await renderText('product-float', 'Product', { cardScale: 0.9 }, [29], 'Subtitle');
});
test('reports_text_overflow_without_publishing_output', real, async () => {
  // Valid 120-code-point input passes structural and explicit-line admission;
  // its actual browser wrapping exceeds the narrow callout box.
  await assert.rejects(renderText('callout-line', '文'.repeat(120)), /EFFECT_TEXT_OVERFLOW/);
  const projects = join(resources, 'r3-child-projects'), projectId = randomUUID(), jobId = randomUUID();
  const directory = join(projects, projectId, '.work', jobId);
  await mkdir(join(directory, 'inputs'), { recursive: true });
  const catalog = JSON.parse(await readFile(join(resources, 'catalog.json'), 'utf8'));
  const document = { schemaVersion: 1, templateId: 'callout-line', templateVersion: 1,
    canvas: { width: 1920, height: 1080, fps: 30 }, durationFrames: 15, seed: 1,
    content: { title: '文'.repeat(120), subtitle: '' },
    palette: { background: '#15171A', foreground: '#F5F4F1', accent: '#C87758' },
    typography: { family: 'sans', scale: 1, align: 'center' }, motion: { speed: 1, intensity: 1 },
    params: catalog.templates.find(t => t.id === 'callout-line').defaults, inputs: [] };
  const nonce = randomUUID();
  const child = spawn(require('../../desktop/node_modules/electron'), [join(root, 'effects-runtime/dist/renderChild.js')], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', EFFECTS_CHILD_NONCE: nonce,
      EFFECTS_RESOURCE_ROOT: resources, EFFECTS_PROJECTS_ROOT: projects } });
  const events = []; child.on('message', event => events.push(event));
  const heartbeat = setInterval(() => { if (child.connected) child.send({ type: 'heartbeat', nonce }); }, 2000);
  const exited = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  child.send({ type: 'start', nonce, submission: { projectId, jobId, document, inputs: [],
    requestHash: digest(JSON.stringify(document)), output: { profile: 'mp4-1080p' } } });
  try {
    assert.equal(await exited, 1);
    assert.deepEqual(events.filter(event => event.type === 'error'), [{ type: 'error', errorCode: 'EFFECT_TEXT_OVERFLOW' }]);
    assert(!events.some(event => event.type === 'result'));
    await assert.rejects(access(join(directory, 'video.part.mp4')));
  } finally { clearInterval(heartbeat); if (child.exitCode === null) child.kill(); }
});
test('collects_fonts_from_both_renderers', real, async () => {
  const context = { entryRoot: join(root, 'effects-runtime/dist'), resourceRoot: resources,
    evidenceRoot: join(resources, 'r3-font-slice'), electron: require('../../desktop/node_modules/electron') };
  for (const side of ['renderer', 'player']) {
    const reference = await fontUsage.probeTargetFonts(context, side);
    assert.equal(reference.fonts.length, 8);
    assert(reference.fonts.every(probe => probe.fonts.every(font => font.isCustomFont)));
  }
});

test('Electron 实际打包资源：中文路径五秒带图视频、字体、音轨、取消和 IPC 清理', {
  skip: process.env.EFFECTS_REAL_RUNTIME_TEST !== '1', timeout: 180000,
}, async () => {
  const child = spawn(process.execPath, ['desktop/scripts/effects-smoke.js',
    '--render', '--packaged', '--report', join(root,
      'desktop/build/effects/evidence', randomUUID(), 'render-report.json')],
  { cwd: root, windowsHide: true, stdio: 'inherit', env: process.env });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', resolve);
  });
  assert.equal(code, 0);
});
