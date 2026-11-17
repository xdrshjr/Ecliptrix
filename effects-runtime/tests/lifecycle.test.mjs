import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('Electron controller 鉴权、重放、单任务、reset 与强杀后的子进程清理', {
  skip: process.env.EFFECTS_REAL_RUNTIME_TEST !== '1', timeout: 180000,
}, async () => {
  const child = spawn(process.execPath, ['desktop/scripts/effects-smoke.js',
    '--controller', '--packaged'], { cwd: root, windowsHide: true, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', resolve);
  });
  assert.equal(code, 0);
});
