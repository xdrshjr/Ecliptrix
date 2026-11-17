import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('Electron 实际打包资源：中文路径五秒带图视频、字体、音轨、取消和 IPC 清理', {
  skip: process.env.EFFECTS_REAL_RUNTIME_TEST !== '1', timeout: 180000,
}, async () => {
  const child = spawn(process.execPath, ['desktop/scripts/effects-smoke.js',
    '--render', '--packaged'], { cwd: root, windowsHide: true, stdio: 'inherit',
    env: { ...process.env, ECLIPTRIX_EFFECTS_PROJECTS_ROOT:
      join(root, 'desktop/build/effects/smoke/中文 空格/projects') } });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', resolve);
  });
  assert.equal(code, 0);
});
