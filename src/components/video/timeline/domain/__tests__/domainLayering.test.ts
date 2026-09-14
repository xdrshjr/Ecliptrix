/**
 * @vitest-environment node
 *
 * TL2-15: entities sit below domain services. An entity importing a service
 * (TimelineItem → DurationCalculationService → Track → TimelineItem) formed a
 * cycle just to read one constant.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DOMAIN_DIR = resolve(__dirname, '..');

describe('domain layering', () => {
  it('entities do not import from domain services', () => {
    const entitiesDir = resolve(DOMAIN_DIR, 'entities');
    const offenders = readdirSync(entitiesDir)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => /from '\.\.\/services\//.test(readFileSync(resolve(entitiesDir, file), 'utf-8')));
    expect(offenders).toEqual([]);
  });

  it('DurationCalculationService depends on Track for its type only', () => {
    const source = readFileSync(resolve(DOMAIN_DIR, 'services/DurationCalculationService.ts'), 'utf-8');
    expect(source).toMatch(/import type \{ Track \} from '\.\.\/entities\/Track';/);
  });
});
