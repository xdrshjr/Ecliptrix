import { describe, expect, it } from 'vitest';
import { getTranslations } from '../i18n';
import {
  describeTtsFailure,
  getLegacyTtsFailure,
  getTtsFailure,
  sanitizeTtsText,
  TTS_ERROR_CODES,
} from '../ttsErrors';

describe('TTS 错误的可信边界', () => {
  it('只接纳结构化 TTS 错误且不会把未知类别当成欠费', () => {
    expect(getTtsFailure({ error_code: 'BACKEND_ERROR' })).toBeUndefined();
    expect(getTtsFailure({ success: true, error_code: 'TTS_TIMEOUT' }))
      .toBeUndefined();
    expect(getTtsFailure({ error_code: 'TTS_FUTURE_CODE' })?.error_code)
      .toBe('TTS_UNKNOWN_ERROR');
  });

  it('严格过滤字段类型、数值范围和未知字段', () => {
    const failure = getTtsFailure({
      error_code: 'TTS_AUTH_FAILED',
      error: { private: '不要输出' },
      error_details: {
        source: 'provider', provider: 'volcengine', retryable: false,
        provider_code: {}, request_id: 'bad.id', attempts: true,
        http_status: '401', provider_message: ['private'], secret: 'private',
      },
    });
    expect(failure?.error_details).toEqual({
      source: 'provider', provider: 'volcengine', retryable: false,
    });
    expect(getTtsFailure({
      error_code: 'TTS_TIMEOUT',
      error_details: { source: 'provider', retryable: 'true' },
    })?.error_details).toBeUndefined();
  });

  it('保留真实的零次尝试、HTTP 状态和安全的供应商标识', () => {
    expect(getTtsFailure({
      error_code: 'TTS_CONFIG_MISSING',
      error_details: {
        source: 'local', retryable: false, attempts: 0,
        http_status: 200, provider_code: 45000000, request_id: 'req-1',
      },
    })?.error_details).toEqual({
      source: 'local', retryable: false, attempts: 0,
      http_status: 200, provider_code: '45000000', request_id: 'req-1',
    });
  });

  it('来源不能是数组，错误码和请求 ID 不能夹带末尾换行', () => {
    const details = getTtsFailure({
      error_code: 'TTS_PROVIDER_ERROR', error_details: {
        source: ['provider'], retryable: false,
        provider_code: 'code\n', request_id: 'request-id\n',
      },
    })?.error_details;
    expect(details).toEqual({ retryable: false });
  });

  it('先清理已知凭据与正文，再过滤诊断和原文', () => {
    const credential = ['invalid', 'fixture', 'credential'].join('-');
    const speech = '仅用于本次请求的私人配音正文';
    const failure = getTtsFailure({
      error_code: 'TTS_PROVIDER_ERROR',
      error: `failed ${credential} ${speech}`,
      error_details: {
        source: 'provider', retryable: false,
        provider_code: credential, request_id: credential,
        provider_message: `insufficient balance ${credential} ${speech}`,
      },
    }, [credential, speech]);
    expect(JSON.stringify(failure)).not.toContain(credential);
    expect(JSON.stringify(failure)).not.toContain(speech);
    expect(failure?.error_details?.provider_code).toBeUndefined();
    expect(failure?.error_details?.request_id).toBeUndefined();
  });

  it.each([
    '<html>insufficient balance</html>',
    'Traceback (most recent call last): /private/audio/file.wav',
    'insufficient balance Authorization: Bearer fixture-private',
    'speech text: a private sentence',
    `unknown ${'a'.repeat(80)}`,
  ])('不保留疑似 HTML、路径、头部、正文或随机数据: %s', value => {
    expect(sanitizeTtsText(value)).toBe('');
  });

  it('旧错误只保留确认的短原因，不从通用失败推断欠费', () => {
    expect(getLegacyTtsFailure('语音转换失败 (尝试3次): 语音合成失败')
      .error_code).toBe('TTS_UNKNOWN_ERROR');
    expect(getLegacyTtsFailure('HTTP 403').error_code)
      .toBe('TTS_UNKNOWN_ERROR');
    expect(getLegacyTtsFailure('<html>insufficient balance</html>').error)
      .not.toContain('<html>');
  });

  it('清理 Unicode 控制字符并识别受控制字符分隔的凭据头', () => {
    expect(sanitizeTtsText('服务\u202e返回\u200b错误')).toBe('服务 返回 错误');
    expect(sanitizeTtsText('Bearer\u202e fixture-value'))
      .not.toContain('fixture-value');
    expect(sanitizeTtsText('api_\u200bkey=fixture-value'))
      .not.toContain('fixture-value');
  });

  it('先移除最长的已知私密内容，避免重叠前缀留下正文片段', () => {
    expect(sanitizeTtsText('私密完整正文', ['私密', '私密完整正文']))
      .not.toContain('完整正文');
  });

  it.each([
    ['"', 'api_key'], ['\'', 'access_token'], ['"', 'secret'],
    ['"', 'tok\u200ben'], ['"', 'authori\u200bzation'],
    ['"', 'text'], ['\'', 'prompt'], ['"', 'headers'],
  ])('不保留 %s 引号包装的 %s 凭据或请求回显', (quote, key) => {
    const privateValue = ['invalid', 'review', 'private'].join('-');
    const message = `insufficient balance; {${quote}${key}${quote}: ` +
      `${quote}${privateValue}${quote}}`;
    expect(getLegacyTtsFailure(message).error_details).toBeUndefined();
    expect(getTtsFailure({
      error_code: 'TTS_PROVIDER_ERROR', error_details: {
        source: 'provider', retryable: false, provider_message: message,
      },
    })?.error_details).not.toHaveProperty('provider_message');
  });

  it('单层绝对路径与 Windows 相对路径也不进入旧错误诊断', () => {
    expect(sanitizeTtsText('permission denied /private.mp3')).toBe('');
    expect(sanitizeTtsText('permission denied temp\\private.mp3')).toBe('');
  });

  it.each(['"', '\''])('不保留 %s 引号中的绝对文件路径', quote => {
    expect(getLegacyTtsFailure(
      `insufficient balance ${quote}/home/review/private.txt${quote}`,
    ).error_details).toBeUndefined();
  });

  it('已知私密正文插入 Unicode 控制字符后仍不进入诊断', () => {
    const speech = '仅用于本次请求的私人配音正文';
    const echoed = speech.slice(0, 10) + '\u200b' + speech.slice(10);
    const failure = getTtsFailure({
      error_code: 'TTS_PROVIDER_ERROR', error_details: {
        retryable: false, provider_message: `insufficient balance ${echoed}`,
      },
    }, [speech]);
    expect(failure?.error_details).not.toHaveProperty('provider_message');
  });

  it('中英文均覆盖全部十六种类别的摘要和行动建议', () => {
    for (const locale of ['zh-CN', 'en']) {
      const copy = getTranslations(locale).ttsErrors;
      expect(Object.keys(copy.summary)).toEqual([...TTS_ERROR_CODES]);
      expect(TTS_ERROR_CODES.every(code => copy.summary[code] && copy.action[code]))
        .toBe(true);
    }
  });

  it('摘要和行动建议分别翻译，并区分客户端超时', () => {
    const failure = getTtsFailure({
      error_code: 'TTS_INSUFFICIENT_BALANCE',
      error_details: { source: 'provider', retryable: false },
    })!;
    const zh = describeTtsFailure(failure, getTranslations('zh-CN'));
    const en = describeTtsFailure(failure, getTranslations('en'));
    expect(zh.summary).toContain('余额不足');
    expect(zh.summary).not.toContain('充值');
    expect(zh.action).toContain('充值');
    expect(en.summary).toContain('balance');
    expect(en.action).toContain('Volcengine');
    const timeout = getTtsFailure({
      error_code: 'TTS_TIMEOUT',
      error_details: { source: 'client', retryable: false },
    })!;
    expect(describeTtsFailure(timeout, getTranslations('zh-CN')).summary)
      .toContain('尚未确认');
  });
});
