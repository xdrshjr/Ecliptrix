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
 * Ratchet: portal files that carry no marker of their own and are not covered by
 * a marked shared dialog (see `delegatesToMarkedDialog`). None may be added; the
 * list may only shrink. Iteration 2 (W5) marked StoryboardSegmentCard, DropHintBadge
 * and PortalTooltip directly and resolved AgentChatDock / EffectsStudioModal
 * structurally: they render `ConfirmationDialog` / `Modal`, whose own source carries
 * `role="dialog"`. A new exemption needs a written reason and a revert condition
 * here — a geometric "it never overlaps" argument is NOT accepted.
 */
const KNOWN_UNMARKED = new Set<string>([]);

/**
 * A portal file that only hosts a shared UI dialog (`@/components/ui/<Name>`) is
 * covered when that component's source carries a marker. Structural, not geometric.
 */
function delegatesToMarkedDialog(source: string): boolean {
  const imports = Array.from(source.matchAll(/from\s+['"]@\/components\/ui\/(\w+)['"]/g));
  return imports.some(([, name]) => {
    try {
      return MARKER.test(readFileSync(join(ROOT, 'components', 'ui', `${name}.tsx`), 'utf-8'));
    } catch {
      return false;
    }
  });
}

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
      .filter(({ source }) => !MARKER.test(source) && !delegatesToMarkedDialog(source))
      .map(({ path }) => relative(path))
      .filter((path) => !KNOWN_UNMARKED.has(path));
    expect(offenders).toEqual([]);
  });

  it('the_ratchet_list_only_shrank_in_iteration_2', () => {
    expect(KNOWN_UNMARKED.size).toBeLessThanOrEqual(3);
  });

  it('shared_dialogs_that_portal_hosts_rely_on_carry_a_role', () => {
    for (const name of ['Modal', 'ConfirmationDialog']) {
      expect(MARKER.test(readFileSync(join(ROOT, 'components', 'ui', `${name}.tsx`), 'utf-8')), name).toBe(true);
    }
  });

  it('the_known_unmarked_list_only_names_files_that_still_exist_and_still_lack_a_marker', () => {
    for (const path of Array.from(KNOWN_UNMARKED)) {
      const source = readFileSync(join(ROOT, path.slice('src/'.length)), 'utf-8');
      expect(MARKER.test(source), `${path} is marked now — drop it from the ratchet`).toBe(false);
    }
  });
});
