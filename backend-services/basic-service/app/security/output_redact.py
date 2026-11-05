"""工具输出脱敏：出站前把凭据形态替换成 `sk-***`（spec §4.4）。

为什么单独一个模块而不是直接用 `log_redact`：日志脱敏是"不要写进文件"，
这里是"不要交给模型"，两者口径相同但调用点完全不同；薄封装保证只有一处
正则来源（`app/security/log_redact.py:62-83`），也方便未来给模型侧加规则。
"""
from app.security.log_redact import redact_string

REDACTED = "***"


def redact_text(payload):
    """对一段文本应用凭据正则；非字符串原样返回（None 保持 None）。"""
    if not payload:
        return payload
    return redact_string(payload)


def clip_text(payload, max_bytes):
    """按字节截断并标注；返回 `(text, truncated)`。

    按 UTF-8 字节而不是字符数限幅：模型的上下文预算与网络传输都以字节计。
    """
    if payload is None:
        return "", False
    encoded = payload.encode("utf-8", "replace")
    if len(encoded) <= max_bytes:
        return payload, False
    clipped = encoded[:max_bytes]
    # 回退到字符边界，避免把多字节字符切成半个。
    while clipped:
        try:
            return clipped.decode("utf-8"), True
        except UnicodeDecodeError:
            clipped = clipped[:-1]
    return "", True


__all__ = ["REDACTED", "clip_text", "redact_text"]
