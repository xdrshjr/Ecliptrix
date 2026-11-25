/**
 * @vitest-environment node
 *
 * AC-D13: every floating layer the app renders through a portal into <body> must
 * be seen by the occlusion detector (spec §4.2.3 item 4), or it would silently
 * hide behind the native page while the Dock is open.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const MARKER = /role=["'](dialog|alertdialog|menu|listbox|tooltip)["']|data-native-occluder|data-overlay/;

/**
 * Ratchet: portal files that pre-date the convention and carry no marker in the
 * same file. None may be added; fix one by marking its layer and deleting it from
 * this list. (Several wrap a dialog defined in another file — review before
 * trusting that they are safe.)
 */
const KNOWN_UNMARKED = new Set([
  'src/components/video/components/AgentChatDock/AgentChatDock.tsx',
  'src/components/video/components/StoryboardScriptTab/StoryboardSegmentCard.tsx',
  'src/components/video/effects/EffectsStudioModal.tsx',
  'src/components/video/timeline/DropHintBadge.tsx',
  'src/components/video/timeline/PortalTooltip.tsx',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') continue;
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx$/.test(name)) out.push(path);
  }
  return out;
}

const relative = (path: string) => `src${path.slice(ROOT.length)}`.split(sep).join('/');

describe('portal layers carry an occluder marker (AC-D13)', () => {
  it('every_createPortal_to_body_in_components_names_its_layer', () => {
    const offenders = walk(join(ROOT, 'components'))
      .map((path) => ({ path, source: readFileSync(path, 'utf-8') }))
      .filter(({ source }) => /createPortal\([\s\S]*?document\.body/.test(source))
      .filter(({ source }) => !MARKER.test(source))
      .map(({ path }) => relative(path))
      .filter((path) => !KNOWN_UNMARKED.has(path));
    expect(offenders).toEqual([]);
  });

  it('the_known_unmarked_list_only_names_files_that_still_exist_and_still_lack_a_marker', () => {
    for (const path of Array.from(KNOWN_UNMARKED)) {
      const source = readFileSync(join(ROOT, path.slice('src/'.length)), 'utf-8');
      expect(MARKER.test(source), `${path} is marked now — drop it from the ratchet`).toBe(false);
    }
  });
});
