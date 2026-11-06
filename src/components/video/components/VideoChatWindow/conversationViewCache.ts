import type { MaterialMention } from '@/types/agentSteering';
import { MAX_MENTIONS } from './composerTriggers';

export interface ConversationDraft {
  version: 2;
  text: string;
  skill: { id: string; name: string } | null;
  mentions: MaterialMention[];
}
export interface ConversationScroll { top: number; follow: boolean }
export interface YoloNoticeState { remainingMs: number; dismissed: boolean }
interface Entry {
  draft: ConversationDraft;
  revision: number;
  generation: number;
  removed: boolean;
  scroll: ConversationScroll;
  restored: Set<number>;
  timer?: ReturnType<typeof setTimeout>;
}
export interface ConversationViewCache {
  notice: YoloNoticeState;
  getDraft(id: string): ConversationDraft;
  getRevision(id: string): number;
  setDraft(id: string, draft: ConversationDraft): void;
  clearDraft(id: string): void;
  flushDraft(id: string): void;
  flushAll(): void;
  applyRestore(id: string, restore: { nonce: number; text: string }):
    ConversationDraft;
  getScroll(id: string): ConversationScroll;
  setScroll(id: string, scroll: ConversationScroll): void;
  hasContent(id: string): boolean;
  remove(id: string): void;
  dispose(): void;
}
export function emptyDraft(): ConversationDraft {
  return { version: 2, text: '', skill: null, mentions: [] };
}
export function structuredDraftKey(project: string, id: string): string {
  return `ecliptrix.agentDraft.v2.${project}.${id}`;
}
function legacyKey(project: string, id: string): string {
  return `ecliptrix.agentDraft.v1.${project}.${id}`;
}
export function parseDraft(raw: string): ConversationDraft | null {
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 2 || typeof value.text !== 'string' ||
        !Array.isArray(value.mentions)) return null;
    const skill = value.skill;
    if (skill !== null && (typeof skill?.id !== 'string' ||
        typeof skill?.name !== 'string')) return null;
    const seen = new Set<string>();
    const mentions: MaterialMention[] = [];
    for (const item of value.mentions) {
      if (typeof item?.materialId !== 'string' ||
          typeof item?.label !== 'string') return null;
      if (!seen.has(item.materialId) && mentions.length < MAX_MENTIONS) {
        mentions.push({ materialId: item.materialId, label: item.label });
        seen.add(item.materialId);
      }
    }
    return { version: 2, text: value.text, skill, mentions };
  } catch { return null; }
}
function saveDraft(project: string, id: string, draft: ConversationDraft) {
  try {
    window.localStorage.setItem(structuredDraftKey(project, id),
      JSON.stringify(draft));
    window.localStorage.removeItem(legacyKey(project, id));
  } catch { /* 存储不可用时，当前项目实例的内存仍是权威值。 */ }
}
function readDraft(project: string, id: string): ConversationDraft {
  try {
    const raw = window.localStorage.getItem(structuredDraftKey(project, id));
    const draft = raw === null ? null : parseDraft(raw);
    if (draft) return draft;
    const text = window.localStorage.getItem(legacyKey(project, id)) ?? '';
    const migrated = { ...emptyDraft(), text };
    saveDraft(project, id, migrated);
    return migrated;
  } catch { return emptyDraft(); }
}

/** 缓存先于 React state 更新；已删除 entry 是永久墓碑，旧 cleanup 无法复活。 */
export function createConversationViewCache(
  projectKey: string,
): ConversationViewCache {
  const entries = new Map<string, Entry>();
  const get = (id: string): Entry => {
    let entry = entries.get(id);
    if (!entry) {
      entry = { draft: readDraft(projectKey, id), revision: 0,
        generation: 0, removed: false, restored: new Set(),
        scroll: { top: 0, follow: true } };
      entries.set(id, entry);
    }
    return entry;
  };
  const flushDraft = (id: string) => {
    const entry = entries.get(id);
    if (!entry || entry.removed) return;
    clearTimeout(entry.timer);
    saveDraft(projectKey, id, entry.draft);
  };
  const setDraft = (id: string, draft: ConversationDraft) => {
    const entry = get(id);
    if (entry.removed) return;
    entry.draft = draft;
    entry.revision++;
    clearTimeout(entry.timer);
    const generation = entry.generation;
    entry.timer = setTimeout(() => {
      if (!entry.removed && generation === entry.generation) flushDraft(id);
    }, 300);
  };
  const flushAll = () => entries.forEach((_entry, id) => flushDraft(id));
  return {
    notice: { remainingMs: 8000, dismissed: false },
    getDraft: id => get(id).draft,
    getRevision: id => get(id).revision,
    setDraft, flushDraft, flushAll,
    clearDraft(id) { setDraft(id, emptyDraft()); flushDraft(id); },
    applyRestore(id, restore) {
      const entry = get(id);
      if (!entry.removed && !entry.restored.has(restore.nonce)) {
        entry.restored.add(restore.nonce);
        const text = entry.draft.text.trim()
          ? `${entry.draft.text}\n\n${restore.text}` : restore.text;
        setDraft(id, { ...entry.draft, text });
        flushDraft(id);
      }
      return entry.draft;
    },
    getScroll: id => get(id).scroll,
    setScroll(id, scroll) { if (!get(id).removed) get(id).scroll = scroll; },
    hasContent(id) {
      const draft = get(id).draft;
      return !!(draft.text.trim() || draft.skill || draft.mentions.length);
    },
    remove(id) {
      const entry = get(id);
      entry.removed = true;
      entry.generation++;
      clearTimeout(entry.timer);
      try {
        window.localStorage.removeItem(structuredDraftKey(projectKey, id));
        window.localStorage.removeItem(legacyKey(projectKey, id));
      } catch { /* 删除的内存墓碑在存储被禁用时仍阻止旧回调写入。 */ }
    },
    dispose() {
      flushAll();
      entries.forEach(entry => clearTimeout(entry.timer));
    },
  };
}
