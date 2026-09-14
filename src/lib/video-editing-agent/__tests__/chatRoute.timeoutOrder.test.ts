/**
 * @vitest-environment node
 *
 * AG3-02: the server's inactivity timeout reaches the client. The client
 * stops reading at `cancelled`, so the route must send its timeout error
 * first — it used to send it after, and the user saw a silent "stopped".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROUTE = resolve(__dirname, '..', '..', '..', 'app', 'api', 'video-editing-agent', 'chat', 'route.ts');
const source = readFileSync(ROUTE, 'utf-8');

describe('chat route server timeout', () => {
  it('the timeout error is sent before cancelled', () => {
    const watchdog = source.slice(source.indexOf('timeoutId = setTimeout('), source.indexOf('}, AGENT_TIMEOUT);'));
    const errorAt = watchdog.indexOf("code: 'server_timeout'");
    const abortAt = watchdog.indexOf("triggerAbort('server_timeout')");

    expect({ hasError: errorAt >= 0, hasAbort: abortAt >= 0, errorFirst: errorAt < abortAt })
      .toEqual({ hasError: true, hasAbort: true, errorFirst: true });
  });

  it('the timeout catch branch sends no second error', () => {
    const start = source.indexOf("message === 'Agent timeout'");
    const branch = source.slice(start, source.indexOf('} else {', start));

    expect({ found: start >= 0, sends: branch.includes('send(') }).toEqual({ found: true, sends: false });
  });

  it('an unexpected route error carries a code the UI can localise', () => {
    const timeoutBranch = source.indexOf("message === 'Agent timeout'");
    const otherBranch = source.slice(
      source.indexOf('} else {', timeoutBranch),
      source.indexOf('} finally {', timeoutBranch),
    );

    expect({ coded: otherBranch.includes("code: 'agent_error'"), rawPrefix: otherBranch.includes('Agent error:') })
      .toEqual({ coded: true, rawPrefix: false });
  });
});
