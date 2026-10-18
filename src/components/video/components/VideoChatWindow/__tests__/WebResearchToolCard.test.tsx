import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import WebResearchToolCard, { safeResearchSourceUrl } from '../WebResearchToolCard';
let locale = 'en';
vi.mock('@/contexts/LocaleContext', () => ({ useLocale: () => ({ t: translations[locale], locale }) }));
afterEach(() => { locale = 'en'; });

const report = {
  brief: 'Research brief', quality: 'mixed', degraded: 'partial_sources',
  coverage: { selected: 2, page_text: 1, search_snippet: 1, unavailable: 0 },
  sources: [{ id: 'a', title: 'Page A', url: 'https://example.org/a', evidence_kind: 'page_text' },
    { id: 'b', title: 'Page B', url: 'https://example.org/b', evidence_kind: 'search_snippet' }],
  facts: [{ text: 'Mixed fact', source_ids: ['a', 'b', 'missing'], evidence_kind: 'includes_snippet' }],
  model_usage: {
    query: { status: 'succeeded', attempts: 1, model_name: 'Model', error_code: null, reason: null },
    synthesis: { status: 'skipped', attempts: 0, model_name: null, error_code: null, reason: 'no_sources' },
  },
};

describe('研究质量与引用', () => {
  it.each(['en', 'zh-CN'])('双语 %s 显示摘要限制和真实查询阶段', language => {
    locale = language;
    render(<WebResearchToolCard toolCall={{ id: 'r', name: 'web_research', params: {}, status: 'completed', result: report }} />);
    fireEvent.click(screen.getByRole('button'));
    const copy = translations[language].webResearch;
    expect(screen.getByText(copy.qualityMixed)).toBeInTheDocument();
    expect(screen.getByText(copy.sourceSnippet)).toBeInTheDocument();
    expect(screen.getByText(copy.modelQueryOnly)).toBeInTheDocument();
    expect(screen.getByText(copy.citationMissing)).toBeInTheDocument();
    expect(screen.getByText(copy.factIncludesSnippet)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/已扩展搜索|expanded search/i);
  });

  it('多卡片同ID引用拥有唯一目标且点击后聚焦正确来源', () => {
    render(<>{['one', 'two'].map(id => <WebResearchToolCard key={id} toolCall={{ id,
      name: 'web_research', params: {}, status: 'completed', result: report }} />)}</>);
    screen.getAllByRole('button').forEach(button => fireEvent.click(button));
    const refs = screen.getAllByRole('link', { name: '[1]' });
    expect(refs).toHaveLength(2);
    expect(refs[0].getAttribute('href')).not.toBe(refs[1].getAttribute('href'));
    fireEvent.click(refs[1]);
    expect(document.activeElement?.id).toBe(refs[1].getAttribute('href')?.slice(1));
  });

  it.each(['cancelled', 'error', 'executing'] as const)('外层 %s 隐藏迟到成功', status => {
    render(<WebResearchToolCard toolCall={{ id: 'r', name: 'web_research', params: {}, status,
      result: { ...report, quality: 'full_text', model_usage: { ...report.model_usage,
        synthesis: { ...report.model_usage.query } } } }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('Research brief')).toBeNull();
    expect(document.body.textContent).not.toContain('Model');
    expect(screen.queryByText(translations.en.webResearch.qualityFullText)).toBeNull();
  });

  it.each([
    { selected: 2, page_text: 2, search_snippet: 0, unavailable: 0 },
    { selected: 2, page_text: 1.5, search_snippet: 0.5, unavailable: 0 },
  ])('非法或与来源不符的覆盖按未知展示', coverage => {
    render(<WebResearchToolCard toolCall={{ id: 'r', name: 'web_research', params: {},
      status: 'completed', result: { ...report, coverage } }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getAllByText(translations.en.webResearch.sourceUnrecorded).length).toBeGreaterThan(0);
    expect(screen.queryByText(translations.en.webResearch.qualityMixed)).toBeNull();
  });

  it('旧模型名称和未知阶段不证明整理成功', () => {
    render(<WebResearchToolCard toolCall={{ id: 'r', name: 'web_research', params: {}, status: 'completed',
      result: { brief: 'Old report', model_used: 'legacy-model', model_usage: { synthesis: { status: 'future' } } } }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getAllByText(translations.en.webResearch.sourceUnrecorded).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('legacy-model');
  });

  it('无可用资料时不声称已保留摘录', () => {
    render(<WebResearchToolCard toolCall={{ id: 'r', name: 'web_research', params: {}, status: 'completed',
      result: { ...report, quality: 'none', coverage: { selected: 0, page_text: 0, search_snippet: 0, unavailable: 0 },
        sources: [], facts: [] } }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getAllByText(translations.en.webResearch.qualityNone).length).toBeGreaterThan(0);
    expect(screen.queryByText(translations.en.webResearch.modelQueryOnly)).toBeNull();
  });

  it.each([
    ['research_model_rejected', 'Check the research synthesis model configuration'],
    ['research_model_rate_limited', 'The research model is temporarily busy'],
    ['research_model_timeout', 'Research synthesis timed out'],
    ['research_model_report_invalid', 'The research model response was invalid'],
  ])('模型错误 %s 不使有资料的研究变为失败', (error_code, label) => {
    render(<WebResearchToolCard toolCall={{ id: 'r', name: 'web_research', params: {}, status: 'completed',
      result: { ...report, model_usage: { ...report.model_usage, synthesis: {
        status: 'failed', attempts: 1, model_name: 'Model', error_code, reason: null,
      } } } }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(translations.en.webResearch.modelSynthesisFallback)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('完成状态中外层success=false不能被内层成功覆盖', () => {
    render(<WebResearchToolCard toolCall={{ id: 'r', name: 'web_research', params: {}, status: 'completed',
      result: { success: false, details: { ...report, success: true } } }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('Research brief')).toBeNull();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('合法失败阶段的未知错误码显示通用失败并保留摘录说明', () => {
    render(<WebResearchToolCard toolCall={{ id: 'r', name: 'web_research', params: {}, status: 'completed',
      result: { ...report, model_usage: { ...report.model_usage, synthesis: {
        status: 'failed', attempts: 1, model_name: 'Model', error_code: 'future_model_failure', reason: null,
      } } } }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(translations.en.webResearch.modelFailed)).toBeInTheDocument();
    expect(screen.getByText(translations.en.webResearch.modelSynthesisFallback)).toBeInTheDocument();
    expect(screen.queryByText(translations.en.webResearch.modelUnknown)).toBeNull();
  });

  it.each([null, 123, [], {}, '', '   '])('非法错误码 %j 不作为合法失败阶段', error_code => {
    render(<WebResearchToolCard toolCall={{ id: 'r', name: 'web_research', params: {}, status: 'completed',
      result: { ...report, model_usage: { ...report.model_usage, synthesis: {
        status: 'failed', attempts: 1, model_name: 'Model', error_code, reason: null,
      } } } }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(translations.en.webResearch.modelUnknown)).toBeInTheDocument();
    expect(screen.queryByText(translations.en.webResearch.modelSynthesisFallback)).toBeNull();
  });

  it('零请求未知失败码不被推断为配置失败', () => {
    render(<WebResearchToolCard toolCall={{ id: 'r', name: 'web_research', params: {}, status: 'completed',
      result: { ...report, model_usage: { ...report.model_usage, query: {
        status: 'failed', attempts: 0, model_name: null, error_code: 'future_configuration_failure', reason: null,
      } } } }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(translations.en.webResearch.modelUnknown)).toBeInTheDocument();
  });

  it('重复来源ID使覆盖未知且引用不可导航', () => {
    render(<WebResearchToolCard toolCall={{ id: 'r', name: 'web_research', params: {}, status: 'completed',
      result: { ...report, sources: report.sources.map(source => ({ ...source, id: 'a' })) } }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByRole('link', { name: '[1]' })).toBeNull();
    expect(screen.getAllByText(translations.en.webResearch.sourceUnrecorded).length).toBeGreaterThan(0);
  });

  it.each(['disabled', 'succeeded'] as const)('合法 %s 模型阶段展示真实状态', status => {
    const stage = status === 'disabled' ? { status, attempts: 0, model_name: null, error_code: null, reason: null }
      : { status, attempts: 1, model_name: 'Research Model', error_code: null, reason: null };
    render(<WebResearchToolCard toolCall={{ id: 'r', name: 'web_research', params: {}, status: 'completed',
      result: { ...report, model_usage: { query: stage, synthesis: stage } } }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(status === 'disabled' ? translations.en.webResearch.modelDisabled :
      'Research synthesis: Research Model')).toBeInTheDocument();
  });
});

describe('网络研究卡片', () => {
  it.each([
    ['provider_rejected', 'Search credentials were rejected'],
    ['provider_quota_exceeded', 'Search quota is exhausted'],
    ['provider_rate_limited', 'Search is rate limited. Try again later'],
  ])('错误码 %s 不被 configuration 遮蔽', (code, text) => {
    render(<WebResearchToolCard toolCall={{ id: 'call', name: 'web_search',
      params: {}, status: 'error', result: { error_code: code,
        error_details: { failure_class: 'configuration' } } }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(text);
  });
  it('保留普通来源 query 但不提供敏感签名或嵌入凭证链接', () => {
    expect(safeResearchSourceUrl('https://example.org/page?q=one')).toBe('https://example.org/page?q=one');
    expect(safeResearchSourceUrl('https://example.org/image?X-Amz-Signature=secret')).toBeUndefined();
    expect(safeResearchSourceUrl('https://user:password@example.org')).toBeUndefined();
    expect(safeResearchSourceUrl('file:///etc/passwd')).toBeUndefined();
    expect(safeResearchSourceUrl('https://example.org/page#token=secret')).toBeUndefined();
    expect(safeResearchSourceUrl('https://example.org/pa\nge')).toBeUndefined();
  });
  it('只在展开预览后请求本地截图，Escape 还原焦点', () => {
    render(<WebResearchToolCard toolCall={{ id: 'call', name: 'browser_read', params: {}, status: 'completed', result: { screenshot_artifact_id: 'image-id', project_id: 'project-id' } }} />);
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Read browser/ }));
    const preview = screen.getByRole('button', { name: 'Preview screenshot' });
    fireEvent.click(preview);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/web-research/artifacts/image-id/image?project_id=project-id');
    fireEvent.keyDown(screen.getByRole('img'), { key: 'Escape' });
    expect(screen.queryByRole('img')).toBeNull();
    expect(preview).toHaveFocus();
  });
  it('危险链接不生成 anchor，来源保留未知授权提示', () => {
    render(<WebResearchToolCard toolCall={{ id: 'call', name: 'web_search', params: {}, status: 'completed', result: { sources: [{ id: 'source', title: '页面', url: 'javascript:alert(1)', license_status: 'unknown' }] } }} />);
    fireEvent.click(screen.getByRole('button', { name: /Search the web/ }));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('License information not provided')).toBeInTheDocument();
  });
  it('配置错误与取消状态分别展示', () => {
    render(<WebResearchToolCard toolCall={{ id: 'call', name: 'web_search', params: {}, status: 'error', result: { error_code: 'provider_not_configured' } }} />);
    expect(screen.getByText('Configuration required')).toBeInTheDocument();
  });

  it.each([
    ['cancelled', {}, 'Stopped'],
    ['cancelled', { error_code: 'provider_quota_exceeded' }, 'Stopped'],
    ['error', { error_code: 'robots_disallowed' }, 'The website or network policy blocked this request.'],
    ['error', { error_code: 'upstream_timeout' }, 'Search service timed out'],
    ['completed', { results: [] }, 'No results found'],
    ['completed', { reused: true }, 'Material already in library'],
    ['completed', { degraded: true, results: [] }, 'Research is incomplete; available sources are retained.'],
    ['completed', { material: { id: 'local-material' } }, 'Imported'],
    ['completed', {}, 'Completed'],
  ] as const)('区分 %s 的结果 %o', (status, result, label) => {
    render(<WebResearchToolCard toolCall={{ id: 'call', name: 'web_search', params: {}, status, result }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it.each([
    ['web_search', 'Searching'],
    ['browser_read', 'Reading'],
    ['download_web_media', 'Downloading'],
  ])('执行中的 %s 保留非错误进度', (name, label) => {
    render(<WebResearchToolCard toolCall={{ id: 'call', name, params: {},
      status: 'executing' }} />);
    expect(screen.getByRole('status')).toHaveTextContent(label);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('实际工具结果 details 中的协议错误只显示本地化白名单文案', () => {
    render(<WebResearchToolCard toolCall={{ id: 'call', name: 'web_search',
      params: {}, status: 'completed', result: { details: {
        success: false, error_code: 'provider_response_too_large',
        failureClass: 'internal', message: 'private-provider-error',
      } } }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Search service returned an invalid response');
    fireEvent.click(screen.getByRole('button', { name: /Search the web/ }));
    expect(screen.queryByText('private-provider-error')).toBeNull();
  });

  it('远程候选图片不由 renderer 加载', () => {
    render(<WebResearchToolCard toolCall={{ id: 'call', name: 'extract_web_images', params: {}, status: 'completed', result: {
      images: [{ candidate_id: 'candidate', image_url: 'https://example.org/a.png', source_page_url: 'https://example.org/page' }],
    } }} />);
    fireEvent.click(screen.getByRole('button', { name: /Find web images/ }));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.org/page');
  });

  it('磁盘缓存复用不冒充项目中已存在的素材', () => {
    render(<WebResearchToolCard toolCall={{ id: 'call', name: 'fetch_web_image', params: {}, status: 'completed', result: {
      reused: true, already_in_library: false, status: 'ready',
    } }} />);
    expect(screen.getByText('Imported')).toBeInTheDocument();
    expect(screen.queryByText('Material already in library')).toBeNull();
  });

  it('按来源 ID 合并搜索摘要，不丢失独立 sources 中的出处', () => {
    render(<WebResearchToolCard toolCall={{ id: 'call', name: 'web_search', params: {}, status: 'completed', result: {
      sources: [{ id: 'source-1', title: 'Source title', url: 'https://example.org/page', license_status: 'unknown' }],
      results: [{ source_id: 'source-1', snippet: 'Useful search excerpt' }],
    } }} />);
    fireEvent.click(screen.getByRole('button', { name: /Search the web/ }));
    expect(screen.getByText('Useful search excerpt')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Source title' })).toHaveAttribute('href', 'https://example.org/page');
  });
});
