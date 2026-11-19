/**
 * @vitest-environment node
 *
 * The relay is deliberately NOT a generic integration (spec RV-03): it has a
 * single write channel, `/api/skillrouter`. If it ever shows up in the
 * generated registry fixture, the generic `/api/integrations/{id}` routes and
 * the wizard cards would give it a second, unreviewed way in.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import schema from '@/lib/api/__fixtures__/integrations-schema.json';
import {
  ALLOWED_LINK_HOSTS,
  INTEGRATION_LINKS,
  findCredentialLink,
  safeExternalUrl,
} from '@/lib/credentialLinks';

describe('integrations registry fixture', () => {
  it('does not contain the relay', () => {
    expect(JSON.stringify(schema).toLowerCase()).not.toContain('skillrouter');
  });
});

describe('relay credential links', () => {
  it('registers the sign-up, key and docs pages on the allow-listed host', () => {
    expect(INTEGRATION_LINKS.skillrouter_register.consoleUrl).toBe(
      'https://www.skillrouter.net/login',
    );
    expect(INTEGRATION_LINKS.skillrouter.consoleUrl).toBe(
      'https://www.skillrouter.net/console/my-keys',
    );
    expect(INTEGRATION_LINKS.skillrouter.docsUrl).toBe('https://www.skillrouter.net/console/docs');
    expect(ALLOWED_LINK_HOSTS).toContain('www.skillrouter.net');
    expect(findCredentialLink('skillrouter')).not.toBeNull();
  });

  it('still rejects look-alike hosts', () => {
    expect(safeExternalUrl('https://www.skillrouter.net.evil.example/login')).toBeNull();
    expect(safeExternalUrl('http://www.skillrouter.net/login')).toBeNull();
  });
});

describe('model settings panel', () => {
  it('never reads the key the resolve endpoint returns (spec RV-01)', () => {
    const file = path.resolve(__dirname, '../../../components/settings/ModelSettingsPanel.tsx');
    const source = readFileSync(file, 'utf8');
    const start = source.indexOf('const fetchEffectiveConfigs');
    const end = source.indexOf('const domesticKnown', start);
    expect(start).toBeGreaterThan(0);
    expect(source.slice(start, end)).not.toMatch(/api_key/);
  });
});
