import { describe, expect, it } from 'vitest';
import { MATERIAL_DRAG_MIME_PREFIX, readDraggedMaterialType } from '../materialDragTypes';

describe('readDraggedMaterialType', () => {
  it('reads the material type from drag types without getData', () => {
    expect(readDraggedMaterialType(['application/json', `${MATERIAL_DRAG_MIME_PREFIX}video`])).toBe('video');
    expect(readDraggedMaterialType([`${MATERIAL_DRAG_MIME_PREFIX}IMAGE`])).toBe('image');
  });

  it('subtitle materials stay droppable onto subtitle lanes', () => {
    expect(readDraggedMaterialType([`${MATERIAL_DRAG_MIME_PREFIX}subtitle`])).toBe('subtitle');
  });

  it('returns null for files, plain JSON and non-placeable material types', () => {
    expect(readDraggedMaterialType(['Files'])).toBeNull();
    expect(readDraggedMaterialType(['application/json'])).toBeNull();
    expect(readDraggedMaterialType([`${MATERIAL_DRAG_MIME_PREFIX}storyboard_pack`])).toBeNull();
  });
});
