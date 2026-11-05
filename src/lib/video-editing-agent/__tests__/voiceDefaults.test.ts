import { describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_TTS_VOICE_ID, readVoiceId, resolveVoiceType,
} from '../voiceDefaults';

// 回归护栏：docs/diagnoses/agent-tts-ignores-project-default-voice/analysis.md
// §8.6 / §9.1 —— 音色缺省值只允许有一个来源，解析优先级固定。

const PROJECT_DEFAULT = 'zh_male_yangguangqingnian_uranus_bigtts';
/** 后端 `config/batch_tts_config.yaml` 里最长的真实音色 id（39 字符）。 */
const LONGEST_REAL_VOICE = 'zh_female_tianmeixiaoyuan_uranus_bigtts';

describe('resolveVoiceType（用户显式 > 工程默认 > 兜底）', () => {
  it('用户显式指定时以用户为准', () => {
    expect(resolveVoiceType('custom-voice', PROJECT_DEFAULT)).toBe('custom-voice');
  });

  it('未指定时用工程「全片默认音色」', () => {
    expect(resolveVoiceType(undefined, PROJECT_DEFAULT)).toBe(PROJECT_DEFAULT);
  });

  it('工程默认也缺失时落到与界面缺省同值的兜底音色', () => {
    expect(resolveVoiceType(undefined, undefined)).toBe(FALLBACK_TTS_VOICE_ID);
    expect(FALLBACK_TTS_VOICE_ID).toBe('zh_male_shaonianzixin_uranus_bigtts');
  });

  it.each([
    ['空串', ''],
    ['纯空白', '   '],
    ['两侧带空格', '  voice-a  '],
  ])('%s：空/空白视为未指定，合法值两侧空白被 trim', (_label, value) => {
    expect(resolveVoiceType(value, PROJECT_DEFAULT)).toBe(
      value.trim() ? value.trim() : PROJECT_DEFAULT);
  });

  it('永远不会返回空串（后端会以 tts_voice_empty 422 拒绝）', () => {
    expect(resolveVoiceType('', '')).toBe(FALLBACK_TTS_VOICE_ID);
    expect(resolveVoiceType('  ', '  ')).toBe(FALLBACK_TTS_VOICE_ID);
  });
});

describe('readVoiceId（route 请求体白名单）', () => {
  const warn = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  it('合法音色 id 原样透传（含真实最长 id）', () => {
    expect(readVoiceId(LONGEST_REAL_VOICE)).toBe(LONGEST_REAL_VOICE);
    expect(readVoiceId(` ${PROJECT_DEFAULT} `)).toBe(PROJECT_DEFAULT);
  });

  it.each([
    ['非字符串', 42],
    ['对象', { voice: 'a' }],
    ['空串', ''],
    ['纯空白', '   '],
    ['含空格', 'zh male'],
    ['含斜杠', '../etc/passwd'],
    ['超长', 'a'.repeat(97)],
  ])('%s 一律降级为 undefined（脏值才告警）', (_label, value) => {
    const spy = warn();
    expect(readVoiceId(value)).toBeUndefined();
    // 非法值必须留痕：静默丢弃会让「设了新音色却没生效」再次不可排查（§8.7 Q-4）。
    expect(spy).toHaveBeenCalledTimes(value === '' || value === '   ' || typeof value !== 'string' ? 0 : 1);
    spy.mockRestore();
  });

  it('undefined / null 不告警（旧客户端没带这个字段是正常情况）', () => {
    const spy = warn();
    expect(readVoiceId(undefined)).toBeUndefined();
    expect(readVoiceId(null)).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
