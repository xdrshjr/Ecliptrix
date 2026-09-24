import * as React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- Vite raw source for the JSX-preserve test loader.
import containerSource from '../Container.tsx?raw';
import {
  compileComponent, localeContextModule, reactModules,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import type { Task, TaskType, MaterialItem } from '@/types';
import type { OpenTaskOptions } from '@/hooks/useTasks';

interface ContainerProps {
  activeTask: Task | null;
  onOpenTask?: (type: TaskType, options?: OpenTaskOptions) => void;
}

let Container: React.FC<ContainerProps>;
let navigateToVideo: ((materials: MaterialItem[]) => void) | undefined;

beforeAll(() => {
  const ChatInterface = (props: { onNavigateToVideoEditing?: (m: MaterialItem[]) => void }) => {
    navigateToVideo = props.onNavigateToVideoEditing;
    return null;
  };
  Container = compileComponent<ContainerProps>(containerSource, {
    ...reactModules(),
    ...localeContextModule(),
    './chat/ChatInterface': { __esModule: true, default: ChatInterface },
    './video/projects': { VideoProjectListView: () => null, VideoEditorContainer: () => null },
    '@/lib/utils/dateFormat': { formatDate: () => '' },
  });
});

afterEach(() => {
  cleanup();
  navigateToVideo = undefined;
});

const chatTask: Task = {
  id: 'chat-1', title: 'AI Chat', type: 'chat', status: 'active',
  createdAt: new Date(0), updatedAt: new Date(0), content: null,
};

describe('Container — import materials to video editing', () => {
  it('import_to_video_opens_video_task_with_pending_materials', () => {
    const onOpenTask = vi.fn();
    render(React.createElement(Container, { activeTask: chatTask, onOpenTask }));
    const materials = [{ id: 'm1' }] as unknown as MaterialItem[];

    navigateToVideo?.(materials);

    expect(onOpenTask).toHaveBeenCalledTimes(1);
    const [type, options] = onOpenTask.mock.calls[0] as [TaskType, OpenTaskOptions];
    expect(type).toBe('video');
    const content = options.updateContent?.(null) as Record<string, unknown>;
    expect(content.pendingMaterials).toBe(materials);
    expect(content.markdownContent).toBe('');
  });

  it('keeps_existing_video_content_when_importing', () => {
    const onOpenTask = vi.fn();
    render(React.createElement(Container, { activeTask: chatTask, onOpenTask }));
    navigateToVideo?.([]);
    const options = onOpenTask.mock.calls[0][1] as OpenTaskOptions;
    const content = options.updateContent?.({ markdownContent: '# kept' }) as Record<string, unknown>;
    expect(content.markdownContent).toBe('# kept');
  });
});
