"""语音服务错误分类与公开诊断；不保存请求间共享的错误状态。"""

import re
import unicodedata
from dataclasses import dataclass
from typing import Optional

from app.models.tts_models import TTSErrorDetails


ERROR_MESSAGES = {
    'TTS_INSUFFICIENT_BALANCE': '语音服务余额不足或已欠费。'
                                '请在火山引擎控制台充值后重试。',
    'TTS_RATE_LIMITED': '语音请求过于频繁或并发超限，请稍后重试。',
    'TTS_QUOTA_EXHAUSTED': '语音服务额度已用完，请检查资源包或开通服务。',
    'TTS_AUTH_FAILED': '语音服务凭据无效，请在设置中检查 TTS API Key。',
    'TTS_VOICE_UNAVAILABLE': '当前音色不可用，请检查音色与所选资源是否匹配。',
    'TTS_PERMISSION_DENIED': '语音服务或音色未获授权，请检查开通状态及权限。',
    'TTS_INVALID_REQUEST': '语音请求参数无效，请检查文本、音色和语速。',
    'TTS_TIMEOUT': '语音服务响应超时，请稍后重试。',
    'TTS_NETWORK_ERROR': '无法连接语音服务，请检查网络后重试。',
    'TTS_PROVIDER_ERROR': '语音服务返回错误。',
    'TTS_INVALID_RESPONSE': '语音服务返回了无效音频数据。',
    'TTS_LOCAL_IO_ERROR': '无法保存语音文件，请检查存储空间和目录权限。',
    'TTS_UNKNOWN_ERROR': '语音生成失败，服务未返回可识别的原因。',
    'TTS_CONFIG_MISSING': '尚未配置语音服务凭据，请在设置中配置 TTS API Key。',
    'TTS_BACKEND_TIMEOUT': '本地语音处理等待超时，生成结果尚未确认。',
    'TTS_BACKEND_UNAVAILABLE': '本地语音服务不可用，请检查桌面本地服务。',
}
RETRYABLE_CODES = {'TTS_RATE_LIMITED', 'TTS_TIMEOUT', 'TTS_NETWORK_ERROR'}


class TTSServiceError(RuntimeError):
    """异常字符串仅包含安全摘要，旧句子调用链也能保留具体原因。"""

    def __init__(self, error_code: str,
                 error_details: Optional[TTSErrorDetails] = None):
        self.error_code = (error_code if error_code in ERROR_MESSAGES
                           else 'TTS_UNKNOWN_ERROR')
        self.message = ERROR_MESSAGES[self.error_code]
        self.error_details = error_details or TTSErrorDetails(
            source='local', retryable=False,
        )
        super().__init__(self.message)

    def with_attempts(self, attempts: int) -> 'TTSServiceError':
        details = self.error_details.model_dump()
        details['attempts'] = attempts
        return TTSServiceError(self.error_code, TTSErrorDetails(**details))


def make_tts_error(code: str, source: str = 'local',
                   attempts: Optional[int] = None) -> TTSServiceError:
    return TTSServiceError(code, TTSErrorDetails(
        source=source,
        provider='volcengine' if source == 'provider' else None,
        attempts=attempts, retryable=code in RETRYABLE_CODES,
    ))


def remove_known_values(value: str, sensitive_values: tuple[str, ...]) -> str:
    for sensitive in sorted(filter(None, sensitive_values), key=len,
                            reverse=True):
        value = value.replace(sensitive, '[已隐藏]')
    return value


def safe_identifier(value: object, sensitive_values: tuple[str, ...] = (),
                    request_id: bool = False) -> Optional[str]:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    cleaned = remove_known_values(str(value), sensitive_values)
    limit = 128 if request_id else 64
    pattern = r'[A-Za-z0-9_-]+' if request_id else r'[A-Za-z0-9._-]+'
    if len(cleaned) > limit or not re.fullmatch(pattern, cleaned):
        return None
    return cleaned


def safe_provider_message(value: object,
                          sensitive_values: tuple[str, ...] = ()) -> Optional[str]:
    """只接收 JSON message；可疑路径、头部、堆栈原文整体丢弃。"""
    if not isinstance(value, str):
        return None
    value = remove_known_values(value, sensitive_values)
    # 先移除隐藏格式字符，避免凭据键被零宽字符分隔而绕过匹配。
    value = ''.join(
        (' ' if char.isspace() else '')
        if unicodedata.category(char).startswith('C') else char
        for char in value
    )
    # 格式字符与空白归一化可能重新拼出敏感值，归一化后再次移除。
    value = remove_known_values(' '.join(value.split()), sensitive_values)
    suspicious = (
        r'(?i)<[^>]*>|\b(?:bearer|x-api-key|authorization)\b|'
        r'\b(?:api[_-]?key|token|secret)["\x27]?\s*[=:]|'
        r'[A-Za-z]:[/\\]|(?:^|[\s"\x27(=:])/(?!/)[^\s]+|'
        r'\b[\w.-]+\\[\w.\\-]+|'
        r'\\\\|traceback|\bstack\b|\bfile\s+["\x27]|'
        r'\b(?:text|input|prompt|headers)["\x27]?\s*[=:]|'
        r'[A-Za-z0-9_+/=-]{80,}'
    )
    if re.search(suspicious, value):
        return None
    value = re.sub(r'(https?://[^\s?#]+)[?#][^\s]*', r'\1', value)
    return ' '.join(value.split())[:240] or None


def classify_semantics(message: str) -> Optional[str]:
    """明确业务语义优先；冲突语义和裸 quota 均保守兜底。"""
    normalized = ' '.join(message.lower().split())
    patterns = {
        'TTS_INSUFFICIENT_BALANCE': (
            r'欠费|余额不足|账户余额不够|insufficient balance|'
            r'balance is insufficient|account in arrears'),
        'TTS_RATE_LIMITED': (
            r'quota exceeded for types:\s*concurrency|并发超限|rate limit'),
        'TTS_QUOTA_EXHAUSTED': (
            r'quota exceeded.*lifetime|lifetime.*quota exceeded|'
            r'试用额度.*(?:用完|耗尽)|用量额度.*(?:用完|耗尽)'),
        'TTS_AUTH_FAILED': r'invalid api key|authentication failed|鉴权失败',
        'TTS_PERMISSION_DENIED': (
            r'resource access denied|permission denied|未开通|未授权'),
        'TTS_INVALID_REQUEST': (
            r'invalid (?:parameter|argument|text)|'
            r'(?:参数|文本).*(?:错误|无效|为空|过长)'),
    }
    matched = [code for code, pattern in patterns.items()
               if re.search(pattern, normalized)]
    voice = re.search(r'speaker|voice|音色', normalized)
    unavailable = re.search(
        r'not found|unsupported|does not exist|不存在|不支持', normalized,
    )
    if voice and unavailable:
        matched.append('TTS_VOICE_UNAVAILABLE')
    if len(matched) == 1:
        return matched[0]
    if matched or 'quota exceeded' in normalized:
        return 'TTS_PROVIDER_ERROR'
    return None


@dataclass(frozen=True)
class ProviderFailureContext:
    http_status: int
    request_id: object = None
    sensitive_values: tuple[str, ...] = ()


def provider_failure(payload: object,
                     context: ProviderFailureContext) -> TTSServiceError:
    """仅读取已知错误对象字段，不把任意 body/对象带入日志或响应。"""
    fields = payload if isinstance(payload, dict) else {}
    if isinstance(fields.get('error'), dict):
        fields = fields['error']
    raw_message = fields.get('message')
    normalized = remove_known_values(
        raw_message if isinstance(raw_message, str) else '',
        context.sensitive_values,
    )
    semantic = classify_semantics(normalized)
    status = context.http_status
    fallback = {401: 'TTS_AUTH_FAILED', 403: 'TTS_PERMISSION_DENIED',
                429: 'TTS_RATE_LIMITED', 400: 'TTS_INVALID_REQUEST',
                422: 'TTS_INVALID_REQUEST'}
    code = semantic or fallback.get(status, 'TTS_PROVIDER_ERROR')
    retryable = code in RETRYABLE_CODES or (
        semantic is None and code == 'TTS_PROVIDER_ERROR' and status >= 500
    )
    return TTSServiceError(code, TTSErrorDetails(
        source='provider', provider='volcengine', http_status=status,
        provider_code=safe_identifier(fields.get('code'),
                                      context.sensitive_values),
        provider_message=safe_provider_message(raw_message,
                                               context.sensitive_values),
        request_id=safe_identifier(context.request_id,
                                   context.sensitive_values, True),
        attempts=1, retryable=retryable,
    ))
