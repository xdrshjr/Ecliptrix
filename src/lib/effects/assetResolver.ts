import type { EffectAsset, EffectDocument } from '@/types/effects';
import { EffectError } from '@/types/effects';

/** Resolve durable IDs to same-origin URLs only at the preview boundary. */
export function resolveEffectAssets(
  document: EffectDocument, assets: readonly EffectAsset[],
): Record<string, string> {
  return Object.fromEntries(document.inputs.map(binding => {
    const asset = assets.find(item => item.id === binding.assetId);
    if (!asset || !asset.url.startsWith('/api/storage/files/')) {
      throw new EffectError('EFFECT_INPUT_NOT_LOCAL');
    }
    return [asset.id, asset.url];
  }));
}
