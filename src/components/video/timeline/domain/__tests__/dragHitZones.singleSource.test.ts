/**
 * @vitest-environment node
 *
 * N-17: trim hot zones live in the drag machine only. The service kept a dead
 * fixed 8 px copy (and a second `InteractionType`) that nothing called.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf-8');

describe('drag hit zones', () => {
  it('trim hot zones are defined only by the drag machine', () => {
    const service = read('../services/DragCalculationService.ts');
    const barrel = read('../index.ts');
    expect({
      serviceDetects: service.includes('detectInteractionType'),
      serviceHandleWidth: service.includes('RESIZE_HANDLE_WIDTH'),
      barrelServiceTypes: /ResizeResult|InteractionType\s*\}\s*from '\.\/services\/DragCalculationService'/.test(barrel),
      machineDetects: read('../machines/dragMachine.ts').includes('export function detectInteractionType'),
    }).toEqual({ serviceDetects: false, serviceHandleWidth: false, barrelServiceTypes: false, machineDetects: true });
  });
});
