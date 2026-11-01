import { describe, expect, it } from 'vitest';
import schema from '@/lib/api/__fixtures__/integrations-schema.json';
import {
  ALLOWED_LINK_HOSTS,
  INTEGRATION_LINKS,
  PROVIDER_LINKS,
  findCredentialLink,
  safeExternalUrl,
  type CredentialLink,
} from '@/lib/credentialLinks';

function allUrls(link: CredentialLink): string[] {
  return [link.consoleUrl, link.docsUrl, link.activationUrl].filter(
    (url): url is string => typeof url === 'string',
  );
}

describe('credential link registry shape', () => {
  const everyLink = [...Object.values(INTEGRATION_LINKS), ...Object.values(PROVIDER_LINKS)];

  it('only holds https URLs on allow-listed hosts', () => {
    for (const url of everyLink.flatMap(allUrls)) {
      const parsed = new URL(url);
      expect(parsed.protocol).toBe('https:');
      expect(ALLOWED_LINK_HOSTS).toContain(parsed.hostname);
      expect(safeExternalUrl(url)).not.toBeNull();
    }
  });

  it('has a console link for every integration in the backend registry', () => {
    for (const integration of schema.integrations) {
      expect(INTEGRATION_LINKS).toHaveProperty(integration.id);
      expect(INTEGRATION_LINKS[integration.id as keyof typeof INTEGRATION_LINKS].consoleUrl).toBeTruthy();
    }
    expect(INTEGRATION_LINKS.tavily.consoleUrl).toBeTruthy();
  });

  it('has a link for every preset provider the backend ships (no backend needed)', () => {
    for (const id of schema.providerPresetIds) {
      expect(PROVIDER_LINKS).toHaveProperty(id);
    }
  });

  it('keeps the Ark model-activation step and no other integration needs one', () => {
    expect(INTEGRATION_LINKS.ark.activationUrl).toBeTruthy();
    const withActivation = Object.entries(INTEGRATION_LINKS)
      .filter(([, link]) => link.activationUrl)
      .map(([id]) => id);
    expect(withActivation).toEqual(['ark']);
  });

  it('uses no host that is not actually referenced (the allow-list stays tight)', () => {
    const used = new Set(everyLink.flatMap(allUrls).map((url) => new URL(url).hostname));
    expect([...ALLOWED_LINK_HOSTS].sort()).toEqual(Array.from(used).sort());
  });
});

describe('safeExternalUrl', () => {
  it.each([
    'http://www.pexels.com/api/',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,<script>1</script>',
    'https://evil.example/www.pexels.com',
    'https://www.pexels.com.evil.example/',
    'https://user:pass@www.pexels.com/api/',
    'not a url',
    '',
  ])('rejects %s', (raw) => {
    expect(safeExternalUrl(raw)).toBeNull();
  });

  it('accepts an allow-listed https URL', () => {
    expect(safeExternalUrl('https://www.pexels.com/api/')).toBe('https://www.pexels.com/api/');
  });
});

describe('findCredentialLink', () => {
  it('finds integrations and providers and nothing else', () => {
    expect(findCredentialLink('ark')).toBe(INTEGRATION_LINKS.ark);
    expect(findCredentialLink('zhipu')).toBe(PROVIDER_LINKS.zhipu);
    expect(findCredentialLink('custom')).toBeNull();
    expect(findCredentialLink('toString')).toBeNull();
  });
});
