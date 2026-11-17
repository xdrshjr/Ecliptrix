import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEffectDocument } from '../catalog';
import { acquireEffectEditor, clearPending, clearProjectPending,
  readPending, writePending } from '../pendingWrites';

const locks = new Set<string>();
beforeEach(() => {
  localStorage.clear(); locks.clear();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: vi.fn(async (name, options, callback) => {
      if (locks.has(name)) return callback(null);
      locks.add(name);
      try { return await callback({ name }); } finally { locks.delete(name); }
    }),
  } });
});
const submission = () => ({ schemaVersion: 1 as const, projectId: 'p',
  requestId: crypto.randomUUID(), draftId: crypto.randomUUID(),
  expectedVersion: 1, profile: 'mp4-1080p' as const,
  state: 'submitting' as const, createdAt: new Date().toISOString() });

describe('特效本地记录与独占编辑租约', () => {
  it('两个记录独立且旧身份不能清除新提交', async () => {
    const first = await writePending('p', 'submission', submission(),
      { kind: 'absent' });
    const save = { schemaVersion: 1 as const, projectId: 'p',
      draftId: crypto.randomUUID(), recordRevision: 1, baseVersion: null,
      working: { name: '工作稿', document: createEffectDocument() },
      createdAt: new Date().toISOString() };
    await writePending('p', 'save', save, { kind: 'absent' });
    await clearPending('p', 'submission', first.identity);
    const second = await writePending('p', 'submission', submission(),
      { kind: 'absent' });
    await expect(clearPending('p', 'submission', first.identity))
      .rejects.toThrow('EFFECT_VERSION_CONFLICT');
    expect((await readPending('p', 'submission')).record)
      .toEqual(second.record);
    expect((await readPending('p', 'save')).record).toEqual(save);
  });
  it('损坏记录和配额错误不可被静默覆盖', async () => {
    localStorage.setItem('ecliptrix:effects:pending:v1:p', '{');
    await expect(writePending('p', 'submission', submission(),
      { kind: 'absent' })).rejects.toThrow('EFFECT_LOCAL_STATE_UNAVAILABLE');
    localStorage.clear();
    const failure = vi.spyOn(localStorage, 'setItem')
      .mockImplementation(() => { throw new Error('quota'); });
    await expect(writePending('p', 'submission', submission(),
      { kind: 'absent' })).rejects.toThrow('EFFECT_LOCAL_STATE_UNAVAILABLE');
    failure.mockRestore();
  });
  it('working 保留超长文字，CAS 拒绝旧 revision 和错误项目', async () => {
    const record = { schemaVersion: 1 as const, projectId: 'p',
      draftId: crypto.randomUUID(), recordRevision: 1, baseVersion: null,
      working: { name: '', document: { ...createEffectDocument(),
        content: { title: '字'.repeat(500), subtitle: '' } } },
      createdAt: new Date().toISOString() };
    const first = await writePending('p', 'save', record, { kind: 'absent' });
    await writePending('p', 'save', { ...record, recordRevision: 2 },
      first.identity);
    await expect(writePending('p', 'save', { ...record, recordRevision: 2 },
      first.identity)).rejects.toThrow('EFFECT_VERSION_CONFLICT');
    await expect(writePending('other', 'save', record, { kind: 'absent' }))
      .rejects.toThrow('EFFECT_LOCAL_STATE_UNAVAILABLE');
  });
  it.each([
    { templateId: 'missing-template' },
    { templateVersion: 99 },
    { params: {} },
    { params: { value: 100, suffix: '', bars: 'broken' } },
    { params: { value: 100, suffix: '', bars: [30, 60, 90],
      extra: 'unknown' } },
  ])('损坏的模板结构不能进入工作台且原记录保留：%j', async change => {
    const key = 'ecliptrix:effects:save:v1:p';
    const record = { schemaVersion: 1, projectId: 'p',
      draftId: crypto.randomUUID(), recordRevision: 1, baseVersion: null,
      working: { name: '保留原稿', document: {
        ...createEffectDocument('counter-bars'), ...change } },
      createdAt: new Date().toISOString() };
    const raw = JSON.stringify(record);
    localStorage.setItem(key, raw);
    await expect(readPending('p', 'save'))
      .rejects.toThrow('EFFECT_LOCAL_STATE_UNAVAILABLE');
    expect(localStorage.getItem(key)).toBe(raw);
  });
  it('已知模板的越界编辑值仍可完整恢复供修正', async () => {
    const document = createEffectDocument('counter-bars');
    document.params = { value: -20, suffix: '待修正'.repeat(20),
      bars: [-10, 150, 200] };
    const record = { schemaVersion: 1 as const, projectId: 'p',
      draftId: crypto.randomUUID(), recordRevision: 1, baseVersion: null,
      working: { name: '待修正', document },
      createdAt: new Date().toISOString() };
    await writePending('p', 'save', record, { kind: 'absent' });
    expect((await readPending('p', 'save')).record).toEqual(record);
  });
  it('同项目仅一个编辑器且删除立即撤销租约', async () => {
    const first = await acquireEffectEditor('p');
    expect(first?.isActive()).toBe(true);
    expect(await acquireEffectEditor('p')).toBeUndefined();
    const other = await acquireEffectEditor('q');
    expect(other?.isActive()).toBe(true);
    await clearProjectPending('p');
    expect(first?.isActive()).toBe(false);
    expect(other?.isActive()).toBe(true);
    first?.release(); other?.release();
  });
  it('缺 Web Locks 时拒绝退化为非原子的写入', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true,
      value: undefined });
    await expect(writePending('p', 'submission', submission(),
      { kind: 'absent' })).rejects.toThrow('EFFECT_LOCAL_STATE_UNAVAILABLE');
  });
  it('删除的持久失效标记阻止延迟storage事件之前的旧absent写入', async () => {
    const observed = await readPending('p', 'submission');
    await clearProjectPending('p');
    await expect(writePending('p', 'submission', submission(), observed.identity))
      .rejects.toThrow('EFFECT_NOT_FOUND');
    expect((await readPending('p', 'submission')).record).toBeUndefined();
    expect(await acquireEffectEditor('p')).toBeUndefined();
  });
});
