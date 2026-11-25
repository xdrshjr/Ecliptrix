import { describe, expect, it } from 'vitest';
import { displayUrl, resolveOmnibox } from '../omnibox';

describe('resolveOmnibox', () => {
  it('returns_null_for_blank_input', () => {
    expect(resolveOmnibox('   ')).toBeNull();
  });

  it('keeps_full_http_urls_as_navigation', () => {
    expect(resolveOmnibox('https://www.bbc.com/news?edition=uk')).toEqual({
      kind: 'url', url: 'https://www.bbc.com/news?edition=uk',
    });
    expect(resolveOmnibox('http://example.com/')).toEqual({ kind: 'url', url: 'http://example.com/' });
  });

  it('adds_https_to_bare_domains', () => {
    expect(resolveOmnibox('example.com')).toEqual({ kind: 'url', url: 'https://example.com/' });
    expect(resolveOmnibox('news.example.co.uk/path')).toEqual({
      kind: 'url', url: 'https://news.example.co.uk/path',
    });
  });

  it('uses_http_for_localhost_and_ip_addresses', () => {
    expect(resolveOmnibox('localhost:3000')).toEqual({ kind: 'url', url: 'http://localhost:3000' });
    expect(resolveOmnibox('192.168.1.5:8080/x')).toEqual({ kind: 'url', url: 'http://192.168.1.5:8080/x' });
  });

  it('turns_words_and_sentences_into_a_search_with_the_chosen_engine', () => {
    expect(resolveOmnibox('hello world')).toMatchObject({
      kind: 'search', url: 'https://www.bing.com/search?q=hello%20world',
    });
    expect(resolveOmnibox('今日新闻', 'baidu')).toMatchObject({
      kind: 'search', url: `https://www.baidu.com/s?wd=${encodeURIComponent('今日新闻')}`,
    });
    expect(resolveOmnibox('cats', 'duckduckgo')?.url).toBe('https://duckduckgo.com/?q=cats');
  });

  it.each([
    'javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,<script>1</script>',
    'chrome://settings', 'about:blank', 'ftp://example.com/x', 'vbscript:msgbox',
  ])('treats_%s_as_a_search_term_never_a_navigation', (input) => {
    const result = resolveOmnibox(input);
    expect(result?.kind).toBe('search');
    expect(result?.url.startsWith('https://www.bing.com/search?q=')).toBe(true);
  });

  it('searches_instead_of_navigating_to_an_address_with_credentials', () => {
    expect(resolveOmnibox('https://user:pass@example.com/')?.kind).toBe('search');
  });
});

describe('displayUrl', () => {
  it('drops_the_query_string_and_fragment', () => {
    expect(displayUrl('https://example.com/a/b?token=secret#x')).toBe('example.com/a/b');
    expect(displayUrl('https://example.com/')).toBe('example.com');
  });
  it('is_empty_for_non_http_and_garbage', () => {
    expect(displayUrl('about:blank')).toBe('');
    expect(displayUrl('not a url')).toBe('');
  });
});
