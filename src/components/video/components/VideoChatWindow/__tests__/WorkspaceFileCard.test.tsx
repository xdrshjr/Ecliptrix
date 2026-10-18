import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { AgentToolCallRecord } from '@/types';
import WorkspaceFileCard from '../WorkspaceFileCard';

let locale = 'en';
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations[locale], locale }),
}));
afterEach(() => { locale = 'en'; });

const copy = translations.en.agentToolkit;

function record(
  name: string, result: unknown, status: AgentToolCallRecord['status'] = 'completed',
): AgentToolCallRecord {
  return { id: `call-${name}`, name, params: {}, status, result };
}

const stdout = Array.from({ length: 25 }, (_, index) => `line ${index + 1}`).join('\n');

describe('WorkspaceFileCard', () => {
  it('分析结果只展示 stdout 前 20 行与产物文件', () => {
    const { container } = render(<WorkspaceFileCard toolCall={record('run_analysis', {
      success: true, status: 'ok', stdout, stderr: '', exit_code: 0,
      duration_ms: 1234, truncated: true,
      files: [{ name: 'chart.svg', bytes: 2048, kind: 'image' }],
    })} />);
    expect(screen.getByText(copy.tools.run_analysis)).toBeInTheDocument();
    expect(screen.getByText(copy.analysisOutput)).toBeInTheDocument();
    expect(screen.getByText(copy.analysisFiles)).toBeInTheDocument();
    expect(screen.getByText('1234 ms', { exact: false })).toBeInTheDocument();
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toContain('line 20');
    expect(pre?.textContent).not.toContain('line 21');
    expect(screen.getByText('chart.svg', { exact: false })).toBeInTheDocument();
  });

  it('analysis 超时给出原因文案', () => {
    render(<WorkspaceFileCard toolCall={record('run_analysis', {
      success: false, error_code: 'analysis_timeout', status: 'timeout', stdout: '',
    })} />);
    expect(screen.getByText(copy.timeout)).toBeInTheDocument();
  });

  it('success:false 用白名单文案并以 role=alert 显示', () => {
    render(<WorkspaceFileCard toolCall={record('workspace_write', {
      success: false, error_code: 'workspace_quota_exceeded',
      message: 'workspace quota exceeded; delete files or raise the quota',
    })} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(copy.quotaExceeded);
    // 后端原文永不出现在界面上。
    expect(screen.queryByText(/delete files or raise the quota/)).toBeNull();
  });

  it('read_document 显示文件名与页码、续读提示', () => {
    render(<WorkspaceFileCard toolCall={record('read_document', {
      success: true, document_id: 'd-1', name: 'brief.pdf', page: 2, pages: 5,
      next_page: 3, next_offset: 800, chars: 1200, content: 'text',
    })} />);
    expect(screen.getByText(copy.tools.read_document)).toBeInTheDocument();
    expect(screen.getByText('brief.pdf')).toBeInTheDocument();
    expect(screen.getByText('2/5')).toBeInTheDocument();
    expect(screen.getByText('→ 3')).toBeInTheDocument();
    expect(screen.getByText('→ 800')).toBeInTheDocument();
  });

  it('导入素材显示字节数与导入提示', () => {
    render(<WorkspaceFileCard toolCall={record('workspace_import_material', {
      success: true, name: 'clip.mp4', size: 4096, type: 'video',
      local_url: '/api/storage/files/cached_materials/workspace/clip.mp4',
    })} />);
    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    expect(screen.getByText('4.0 KB')).toBeInTheDocument();
    expect(screen.getByText(copy.importHint)).toBeInTheDocument();
  });

  it('空工作区列表给出空态文案', () => {
    render(<WorkspaceFileCard toolCall={record('workspace_list', {
      success: true, files: [], documents: [], total_files: 0, total_bytes: 0,
      quota_bytes: 104857600, truncated: false,
    })} />);
    expect(screen.getByText(copy.emptyFiles)).toBeInTheDocument();
    expect(screen.getByText(copy.emptyDocuments)).toBeInTheDocument();
  });

  it('记忆写入显示已保存与文本片段', () => {
    render(<WorkspaceFileCard toolCall={record('memory_write', {
      success: true, memory_id: 'm-1', deduplicated: false,
      text: 'The user prefers a warm narrator voice.',
    })} />);
    expect(screen.getByText(copy.tools.memory_write)).toBeInTheDocument();
    expect(screen.getByText(copy.saved)).toBeInTheDocument();
    expect(screen.getByText('The user prefers a warm narrator voice.')).toBeInTheDocument();
  });

  it('运行中的工具播报加载文案', () => {
    render(<WorkspaceFileCard toolCall={record('workspace_read', {}, 'executing')} />);
    expect(screen.getByRole('status')).toHaveTextContent(copy.loading);
  });
});
