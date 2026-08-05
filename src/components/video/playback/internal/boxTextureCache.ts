/**
 * boxTextureCache — box-sized, transparently padded image textures for the 3D
 * camera-motion path.
 *
 * Plan: docs/plans/camera-motion-stills-and-desktop-gate/experiment-plan.md §3.2.
 *
 * Why this exists at all: `PerspectiveQuadRenderer` maps a texture's whole UV
 * square onto the projected quad, and the quad is the still's BOX. The export
 * side feeds `perspective` a picture that has already been `scale`d
 * contain-style into the box and `pad`ded with transparency, so its UV space IS
 * the box. To match, the preview must upload the same thing — an image whose
 * natural ratio differs from the box would otherwise be stretched to fill it,
 * and the two sides would diverge by exactly the letterbox gap.
 *
 * Why it is cached: a fresh offscreen canvas per frame is a per-frame
 * allocation + a full re-raster at 60fps, which would eat the whole 1.0ms /
 * layer budget and hand the GC a steady stream of megabyte-sized canvases (L5).
 * The key is `src|width|height`, so a resize (or a swapped image) misses and
 * re-rasters exactly once.
 *
 * The fast path skips the canvas entirely: when the box ratio already equals the
 * image ratio, `contain` fills the box exactly and the `HTMLImageElement` is its
 * own box texture.
 */

/** Largest number of rasterised box textures kept alive. */
export const BOX_TEXTURE_CACHE_CAPACITY = 8;

/**
 * Sub-pixel tolerance for "the image already fills the box".
 *
 * Half a pixel: below that the padding cannot round to a visible column, so
 * rasterising a padded copy would cost memory for a texture identical to the
 * source.
 */
const FILLS_BOX_EPSILON = 0.5;

/** Anything `texImage2D` accepts — an image or an offscreen canvas here. */
export type BoxTexture = HTMLImageElement | HTMLCanvasElement;

interface CacheEntry {
  key: string;
  canvas: HTMLCanvasElement;
}

/**
 * Contain-fit rect of a source inside a box at the ORIGIN.
 *
 * Box-local by construction: the transform that positions the box is applied by
 * the caller, so anything computed here must not know where the box sits.
 */
export function containInBox(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
): { x: number; y: number; width: number; height: number } {
  if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(boxWidth > 0) || !(boxHeight > 0)) {
    return { x: 0, y: 0, width: boxWidth, height: boxHeight };
  }
  const sourceAspect = sourceWidth / sourceHeight;
  const boxAspect = boxWidth / boxHeight;
  const width = sourceAspect >= boxAspect ? boxWidth : boxHeight * sourceAspect;
  const height = sourceAspect >= boxAspect ? boxWidth / sourceAspect : boxHeight;
  return {
    x: (boxWidth - width) / 2,
    y: (boxHeight - height) / 2,
    width,
    height,
  };
}

/**
 * LRU cache of box-sized textures with a transparent contain pad.
 *
 * Not a singleton: the compositor and the panel each own one, so tearing either
 * down frees its own rasters without touching the other's.
 */
export class BoxTextureCache {
  private _entries: CacheEntry[] = [];
  private _capacity: number;

  constructor(capacity: number = BOX_TEXTURE_CACHE_CAPACITY) {
    this._capacity = Math.max(1, capacity);
  }

  /**
   * The texture to upload for `image` drawn into a `boxWidth × boxHeight` box.
   *
   * @param image     A decoded, complete image element.
   * @param boxWidth  Box width in canvas pixels.
   * @param boxHeight Box height in canvas pixels.
   * @returns The image itself on the fast path, a padded offscreen canvas
   *   otherwise, or `null` when the inputs cannot produce one (not decoded yet,
   *   degenerate box, no `document`). `null` means "fall back", never "skip the
   *   layer" — the caller still has the 2D affine shadow.
   */
  acquire(
    image: HTMLImageElement,
    boxWidth: number,
    boxHeight: number,
  ): BoxTexture | null {
    if (!image.complete || !(image.naturalWidth > 0) || !(image.naturalHeight > 0)) {
      return null;
    }
    if (!(boxWidth > 0) || !(boxHeight > 0)) return null;
    const width = Math.max(1, Math.round(boxWidth));
    const height = Math.max(1, Math.round(boxHeight));

    const rect = containInBox(image.naturalWidth, image.naturalHeight, width, height);
    if (rect.x <= FILLS_BOX_EPSILON && rect.y <= FILLS_BOX_EPSILON) {
      // Contain already fills the box: the source IS the box texture.
      return image;
    }

    const key = `${image.src}|${width}|${height}`;
    const hit = this._take(key);
    if (hit) {
      this._entries.push(hit);
      return hit.canvas;
    }

    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // No fill: an untouched 2D canvas is fully transparent, and transparency is
    // precisely what the export's `pad=…:black@0` produces. Painting black here
    // would occlude the track below wherever the 3D move lifts the picture off
    // its box (N3).
    ctx.clearRect(0, 0, width, height);
    try {
      ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    } catch {
      // A tainted (cross-origin) source throws on draw, not on load.
      return null;
    }

    this._entries.push({ key, canvas });
    while (this._entries.length > this._capacity) this._entries.shift();
    return canvas;
  }

  /** Drop every rasterised texture (compositor detach / panel unmount). */
  clear(): void {
    this._entries = [];
  }

  /** Test-only: how many rasters are currently held. */
  size(): number {
    return this._entries.length;
  }

  private _take(key: string): CacheEntry | null {
    const index = this._entries.findIndex((entry) => entry.key === key);
    if (index < 0) return null;
    return this._entries.splice(index, 1)[0];
  }
}
