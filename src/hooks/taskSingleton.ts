import type {
  AppState,
  ChatTaskContent,
  Conversation,
  Tab,
  Task,
  TaskType,
} from '@/types';

/**
 * One task per type (editor-shell-ui-consolidation W3, invariant I-1).
 * The taskbar shows at most one AI chat and one video-editing entry; chat
 * keeps several conversations inside itself and video keeps several projects
 * in its project list, so extra task instances only piled up in storage.
 */
export const SINGLETON_TAB_ORDER: readonly TaskType[] = ['chat', 'video'];

const tabOrderIndex = (type: TaskType): number => {
  const index = SINGLETON_TAB_ORDER.indexOf(type);
  return index === -1 ? SINGLETON_TAB_ORDER.length : index;
};

export const sortTabsBySingletonOrder = (tabs: Tab[]): Tab[] =>
  [...tabs].sort((a, b) => tabOrderIndex(a.type) - tabOrderIndex(b.type));

const timeOf = (value: Date | string | undefined): number => {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

/** 多个聊天任务的 content 合并：会话按 id 去重（先出现者胜），保留 kept 的
 *  activeConversationId 与 uiState。 */
export function mergeChatContents(
  kept: ChatTaskContent | null,
  others: Array<ChatTaskContent | null>,
): ChatTaskContent | null {
  const sources = [kept, ...others].filter(
    (content): content is ChatTaskContent => !!content,
  );
  if (sources.length === 0) return kept;

  const seen = new Set<string>();
  const conversations: Conversation[] = [];
  for (const source of sources) {
    for (const conversation of source.conversations ?? []) {
      if (seen.has(conversation.id)) continue;
      seen.add(conversation.id);
      conversations.push(conversation);
    }
  }

  const base = kept ?? sources[0];
  return {
    ...base,
    conversations,
    activeConversationId:
      base.activeConversationId ?? conversations[0]?.id ?? null,
  };
}

const pickKeptTask = (group: Task[], activeTaskId: string | null): Task => {
  const active = group.find(task => task.id === activeTaskId);
  if (active) return active;
  return group.reduce((newest, task) =>
    timeOf(task.updatedAt) > timeOf(newest.updatedAt) ? task : newest,
  );
};

const isAlreadySingleton = (
  state: AppState,
  labelFor: (type: TaskType) => string,
): boolean => {
  const types = new Set<TaskType>();
  for (const task of state.tasks) {
    if (types.has(task.type) || task.title !== labelFor(task.type)) {
      return false;
    }
    types.add(task.type);
  }
  const taskIds = new Set(state.tasks.map(task => task.id));
  const tabTaskIds = new Set<string>();
  for (const tab of state.tabs) {
    if (!taskIds.has(tab.taskId) || tabTaskIds.has(tab.taskId)) return false;
    if (tab.title !== labelFor(tab.type)) return false;
    if (tab.isActive !== (tab.id === state.activeTabId)) return false;
    tabTaskIds.add(tab.taskId);
  }
  const sorted = sortTabsBySingletonOrder(state.tabs);
  if (sorted.some((tab, index) => tab !== state.tabs[index])) return false;
  const activeValid = state.activeTabId === null
    ? state.tabs.length === 0
    : state.tabs.some(tab => tab.id === state.activeTabId);
  return activeValid;
};

/** Keeps one task per type; merges chat conversations of the dropped ones. */
const collapseTasks = (
  state: AppState,
  activeTaskId: string | null,
  labelFor: (type: TaskType) => string,
): { tasks: Task[]; keptIdByType: Map<TaskType, string> } => {
  const groups = new Map<TaskType, Task[]>();
  for (const task of state.tasks) {
    groups.set(task.type, [...(groups.get(task.type) ?? []), task]);
  }

  const tasks: Task[] = [];
  const keptIdByType = new Map<TaskType, string>();
  groups.forEach((group, type) => {
    const kept = pickKeptTask(group, activeTaskId);
    const others = group
      .filter(task => task !== kept)
      .sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt));
    const content = type === 'chat' && others.length > 0
      ? mergeChatContents(
          kept.content as ChatTaskContent | null,
          others.map(task => task.content as ChatTaskContent | null),
        )
      : kept.content;
    tasks.push({ ...kept, title: labelFor(type), content });
    keptIdByType.set(type, kept.id);
  });
  return { tasks, keptIdByType };
};

/** 把任意历史 AppState 规整为满足 I-1 的状态；已满足时原样返回同一引用。
 *  labelFor：由 useTasks 传入 buildTaskTypeLabel（纯函数不直接依赖 i18n）。 */
export function collapseToSingletonTasks(
  state: AppState,
  labelFor: (type: TaskType) => string,
): AppState {
  if (isAlreadySingleton(state, labelFor)) return state;

  const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);
  const { tasks, keptIdByType } = collapseTasks(
    state, activeTab?.taskId ?? null, labelFor,
  );
  const keptIds = new Set(keptIdByType.values());

  const seenTaskIds = new Set<string>();
  const tabs: Tab[] = [];
  for (const tab of state.tabs) {
    if (!keptIds.has(tab.taskId) || seenTaskIds.has(tab.taskId)) continue;
    seenTaskIds.add(tab.taskId);
    tabs.push({ ...tab, title: labelFor(tab.type) });
  }

  let activeTabId: string | null = null;
  if (activeTab && tabs.some(tab => tab.id === activeTab.id)) {
    activeTabId = activeTab.id;
  } else if (activeTab) {
    const keptId = keptIdByType.get(activeTab.type);
    activeTabId = tabs.find(tab => tab.taskId === keptId)?.id ?? null;
  }
  const orderedTabs = sortTabsBySingletonOrder(tabs);
  if (activeTabId === null && orderedTabs.length > 0) {
    activeTabId = orderedTabs[0].id;
  }

  return {
    tasks,
    tabs: orderedTabs.map(tab => ({ ...tab, isActive: tab.id === activeTabId })),
    activeTabId,
  };
}

/** Maps a `?task=<id>` that pointed at a dropped task to the kept task of the
 *  same type, so old deep links keep landing on the right workspace. */
export function resolveSingletonTaskId(
  before: AppState,
  after: AppState,
  taskId: string,
): string | null {
  if (after.tasks.some(task => task.id === taskId)) return taskId;
  const original = before.tasks.find(task => task.id === taskId);
  if (!original) return null;
  return after.tasks.find(task => task.type === original.type)?.id ?? null;
}
