import type { CoverDocument, CoverReadinessIssue, CoverTextField,
  CoverTextMeasurement } from '@/types/videoCover';
import { CoverError } from '@/types/videoCover';
import { fitCoverText } from './layout';

const fields: CoverTextField[] = ['title', 'subtitle', 'label'];
export function validateCoverStructure(doc: CoverDocument,
  backgroundUrl?: string): CoverReadinessIssue[] {
  const issues: CoverReadinessIssue[] = [];
  if (doc.mode !== 'ai' && !`${doc.fields.title}${doc.fields.subtitle}`.trim()) {
    issues.push({ code: 'content-empty' });
  }
  if (doc.mode !== 'html' && doc.background.kind !== 'asset') {
    issues.push({ code: 'background-required' });
  } else if (doc.background.kind === 'asset' &&
    (!doc.background.assetId || !backgroundUrl?.startsWith('/api/storage/files/'))) {
    issues.push({ code: 'background-missing' });
  }
  return issues;
}

export function assertCoverStructure(doc: CoverDocument, url?: string) {
  const issue = validateCoverStructure(doc, url)[0];
  if (!issue) return;
  const code = issue.code === 'background-missing'
    ? 'COVER_ASSET_MISSING' : 'COVER_DRAFT_NOT_READY';
  throw new CoverError(code, code);
}

export function findCoverCanvas(root: HTMLElement): HTMLElement | undefined {
  const nodes = [...(root.matches('[data-cover-canvas]') ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>('[data-cover-canvas]'))];
  return nodes.length === 1 ? nodes[0] : undefined;
}

function hasLayout(node: HTMLElement) {
  const box = node.getBoundingClientRect();
  return node.isConnected && node.clientWidth > 0 && node.clientHeight > 0 &&
    box.width > 0 && box.height > 0;
}

/** Missing or hidden DOM is pending layout, never evidence of fitting text. */
export function measureCoverText(root: HTMLElement): CoverTextMeasurement {
  const unavailable = { measurable: false, overflowFields: [] };
  const canvas = findCoverCanvas(root);
  if (!canvas || !hasLayout(canvas)) return unavailable;
  const nodes = Array.from(canvas.querySelectorAll<HTMLElement>('[data-cover-text]'));
  if (canvas.dataset.coverMode === 'ai') {
    return { measurable: nodes.length === 0, overflowFields: [] };
  }
  if (!['html', 'mixed'].includes(canvas.dataset.coverMode ?? '') ||
    nodes.length !== fields.length) return unavailable;
  const ordered = fields.map(field => nodes.filter(n => n.dataset.coverText === field));
  if (ordered.some(matches => matches.length !== 1)) return unavailable;
  for (const [node] of ordered) {
    if (!hasLayout(node)) return unavailable;
    if (node.textContent?.trim()) {
      const range = node.ownerDocument.createRange();
      range.selectNodeContents(node);
      if (typeof range.getClientRects !== 'function' ||
        !Array.from(range.getClientRects()).some(r => r.width > 0 && r.height > 0)) {
        return unavailable;
      }
    }
  }
  return { measurable: true, overflowFields: fields.filter((_, index) => {
    const node = ordered[index][0];
    return !fitCoverText(node, { initial: Number(node.dataset.initial),
      minimum: Number(node.dataset.minimum), maxLines: Number(node.dataset.lines) });
  }) };
}
