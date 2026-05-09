/**
 * @vitest-environment node
 *
 * iter4 Bug #3: when the user filters by a material type whose collection
 * is empty (e.g., picks "image" while only audio materials exist), the
 * library should show a *type-specific* empty hint, not a blank grid.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PANEL = resolve(__dirname, '..', 'MaterialsPanel.tsx');
const I18N = resolve(__dirname, '..', '..', '..', '..', '..', 'lib', 'i18n.ts');

const panelSrc = readFileSync(PANEL, 'utf-8');
const i18nSrc = readFileSync(I18N, 'utf-8');

describe('MaterialsPanel — filtered empty state', () => {
  it('derives visibleMaterials filtered by selectedMaterialType', () => {
    expect(panelSrc).toMatch(/visibleMaterials\s*=\s*useMemo/);
    expect(panelSrc).toMatch(/m\.type\s*===\s*selectedMaterialType/);
  });

  it('derives visiblePacks via switch on selectedMaterialType', () => {
    expect(panelSrc).toMatch(/visiblePacks\s*=\s*useMemo/);
    expect(panelSrc).toMatch(/case\s+'storyboard_pack':/);
    expect(panelSrc).toMatch(/case\s+'character_pack':/);
    expect(panelSrc).toMatch(/case\s+'scene_pack':/);
    expect(panelSrc).toMatch(/case\s+'frame_pack':/);
  });

  it('uses isFilteredEmpty as the empty-state gate', () => {
    expect(panelSrc).toMatch(/isFilteredEmpty\s*=\s*visibleMaterials\.length\s*===\s*0/);
    expect(panelSrc).toMatch(/\{isFilteredEmpty\s*\?/);
  });

  it('derives a type-keyed emptyHint for the title/description', () => {
    expect(panelSrc).toMatch(/emptyHint\s*=\s*useMemo/);
    expect(panelSrc).toMatch(/case\s+'video':\s*return\s*\{\s*title:\s*m\.videoTitle/);
    expect(panelSrc).toMatch(/case\s+'audio':\s*return\s*\{\s*title:\s*m\.audioTitle/);
    expect(panelSrc).toMatch(/case\s+'image':\s*return\s*\{\s*title:\s*m\.imageTitle/);
  });

  it('drops the old condition that ignored the active filter', () => {
    // The pre-iter4 condition required *all* collections to be empty.
    expect(panelSrc).not.toMatch(/materials\.length\s*===\s*0\s*&&\s*storyboardPacks\.length\s*===\s*0\s*&&\s*characterPacks/);
  });
});

describe('i18n schema — materialsPanel.empty', () => {
  it('declares all empty-hint keys in the locale interface', () => {
    expect(i18nSrc).toMatch(/empty:\s*\{[\s\S]*?allTitle:\s*string;[\s\S]*?dragHint:\s*string;\s*\};/);
  });

  it('ships the EN frame/audio/image empty hints', () => {
    expect(i18nSrc).toMatch(/audioTitle:\s*'No audio materials'/);
    expect(i18nSrc).toMatch(/imageTitle:\s*'No image materials'/);
    expect(i18nSrc).toMatch(/frameTitle:\s*'No frame packs'/);
  });

  it('ships the ZH frame/audio/image empty hints', () => {
    expect(i18nSrc).toMatch(/audioTitle:\s*'暂无音频素材'/);
    expect(i18nSrc).toMatch(/imageTitle:\s*'暂无图片素材'/);
    expect(i18nSrc).toMatch(/frameTitle:\s*'暂无帧素材'/);
  });
});
