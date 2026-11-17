import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { EffectsRuntimeController } = require('../dist/server.js');

for (const mode of ['heartbeat', 'cancel']) {
  test(`IPC ${mode} tolerates a peer disconnecting before its actual exit`, async () => {
    const controller = new EffectsRuntimeController({});
    const job = controller.createJob({ jobId: randomUUID(), requestHash: 'a'.repeat(64) }, 'hash');
    const child = spawn(process.execPath, ['-e', `
      process.send({type:'ready'});
      process.disconnect();
      setTimeout(() => process.exit(0), 300);
    `], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    job.child = child;
    const errors = [];
    // Mirror the controller: an unhandled send error would settle before exit.
    child.once('error', error => { errors.push(error.code); controller.finishChild(job, 1); });
    const exited = new Promise(resolve => child.once('exit', code => {
      controller.finishChild(job, code); resolve(code);
    }));
    await new Promise(resolve => child.once('message', resolve));
    // The OS peer closes while this event loop has not observed disconnect yet.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    assert.equal(child.connected, true);
    const cancellation = mode === 'cancel' ? controller.cancel(job) : undefined;
    if (mode === 'heartbeat') controller.heartbeatChild(job);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(job.child, child, 'the renderer slot remains owned until exit');
    assert.equal(await exited, 0);
    await cancellation;
    assert.deepEqual(errors, []);
  });
}
