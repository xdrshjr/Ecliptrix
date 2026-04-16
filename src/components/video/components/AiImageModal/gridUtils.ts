/** Compute optimal grid layout (mirrors backend logic). For UI preview only. */
export function computeOptimalGrid(frameCount: number): { rows: number; cols: number } {
  if (frameCount <= 0 || frameCount === 1) return { rows: 1, cols: 1 };

  let cols = Math.ceil(Math.sqrt(frameCount));
  while (true) {
    const rows = Math.ceil(frameCount / cols);
    if (rows <= cols) return { rows, cols };
    cols++;
  }
}
