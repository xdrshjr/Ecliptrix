import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, writeFile, cp, mkdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const { createSubmission, runChild } = require(
  '../../desktop/scripts/effects-smoke.js',
);
const projectsRoot = join(root, 'desktop/build/effects/smoke/projects');
const previewsRoot = join(root, 'public/effects/previews');
const catalog = JSON.parse(await readFile(join(root,
  'src/lib/effects/catalog.json'), 'utf8'));
const projectId = randomUUID();
const fixture = await createSubmission(projectId);
const fixtureRoot = join(projectsRoot, projectId, '.work', fixture.jobId);
const secondImage = join(fixtureRoot, 'inputs/second.png');
const imageResult = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi',
  '-i', 'color=c=steelblue:s=128x128', '-frames:v', '1', secondImage], {
  encoding: 'utf8', windowsHide: true, timeout: 30000,
});
if (imageResult.status !== 0) throw new Error(imageResult.stderr);
const imageBytes = await readFile(secondImage);
fixture.inputs.push({ assetId: randomUUID(), fileName: 'second.png',
  bytes: imageBytes.length,
  sha256: createHash('sha256').update(imageBytes).digest('hex') });
await mkdir(previewsRoot, { recursive: true });

/** Use only self-created local images/video, with every required slot filled. */
function createPreviewDocument(template) {
  const document = structuredClone(fixture.document);
  document.templateId = template.id;
  document.params = structuredClone(template.defaults);
  document.durationFrames = 60;
  document.content = { title: '让创意开始流动', subtitle: 'Ecliptrix · 特效工作室' };
  document.inputs = [];
  let imageIndex = 0;
  for (const slot of template.slots.filter((item) => item.required)) {
    const count = slot.min || 1;
    for (let index = 0; index < count; index++) {
      const isVideo = slot.kinds.length === 1 && slot.kinds[0] === 'video';
      const input = isVideo ? fixture.inputs[0]
        : fixture.inputs[1 + imageIndex++ % 2];
      document.inputs.push({ slot: slot.id, assetId: input.assetId,
        kind: isVideo ? 'video' : 'image', fit: 'cover',
        focalX: 0.5, focalY: 0.5,
        ...(isVideo ? { trimStartSeconds: 0.5 } : {}),
        ...(slot.id === 'images' ? { index } : {}),
      });
    }
  }
  return document;
}

const selected = process.argv[2];
const templates = catalog.templates.filter((template) => !selected
  || template.id === selected);
if (!templates.length) throw new Error('Unknown preview template');
const results = [];
for (const template of templates) {
  const submission = { ...fixture, jobId: randomUUID(),
    document: createPreviewDocument(template) };
  const directory = join(projectsRoot, projectId, '.work', submission.jobId);
  await mkdir(directory, { recursive: true });
  await cp(join(fixtureRoot, 'inputs'), join(directory, 'inputs'), {
    recursive: true,
  });
  console.log(`effects previews: rendering ${template.id}`);
  await runChild(submission, 'render');
  const video = join(directory, 'video.part.mp4');
  await cp(video, join(previewsRoot, `${template.id}.mp4`));
  const poster = spawnSync('ffmpeg', ['-y', '-v', 'error', '-ss', '1',
    '-i', video, '-frames:v', '1', '-q:v', '2',
    join(previewsRoot, `${template.id}.jpg`)], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  if (poster.status !== 0) throw new Error(poster.stderr);
  results.push({ id: template.id, frames: 60, status: 'rendered' });
}
await writeFile(join(root, 'desktop/build/effects/preview-report.json'),
  JSON.stringify({ templates: results }, null, 2) + '\n');
console.log(`effects previews: ${results.length} real video/poster pairs written`);
