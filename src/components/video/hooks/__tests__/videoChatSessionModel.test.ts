import { describe, expect, it } from 'vitest';
import {
  createConversation, defaultConversationTitle, isValidConversationTitle,
  removeConversation, resolveActiveConversationId,
} from '../videoChatSessionModel';

describe('会话模型', () => {
  it('保留历史顺序，并修复无效活动 ID', () => {
    const a = createConversation('a', 'A');
    const b = createConversation('b', 'B');
    expect(resolveActiveConversationId([a, b], 'missing')).toBe('a');
    expect(resolveActiveConversationId([a, b], 'b')).toBe('b');
  });
  it('默认名称跳过两种语言已占用的编号', () => {
    const list = [createConversation('a', '新会话 1'),
      createConversation('b', 'New chat 2')];
    expect(defaultConversationTitle(list, '新会话 {n}')).toBe('新会话 3');
  });
  it('标题按 Unicode 码点校验', () => {
    expect(isValidConversationTitle('😀'.repeat(40))).toBe(true);
    expect(isValidConversationTitle('😀'.repeat(41))).toBe(false);
    expect(isValidConversationTitle('  ')).toBe(false);
  });
  it('删除选中项激活右邻居，最后一项原子替补', () => {
    const list = ['a', 'b', 'c'].map(id => createConversation(id, id));
    const fallback = createConversation('d', '新会话 1');
    expect(removeConversation(list, 'b', 'b', fallback)
      .activeConversationId).toBe('c');
    expect(removeConversation([list[0]], 'a', 'a', fallback)).toEqual({
      conversations: [fallback], activeConversationId: 'd',
    });
  });
});
