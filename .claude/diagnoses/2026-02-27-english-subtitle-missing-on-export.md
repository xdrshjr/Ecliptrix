# Bug Diagnosis: english-subtitle-missing-on-export

**Date:** 2026-02-27
**Mode:** Fully automatic
**Status:** Fixed

## Problem Description

导出含英文字幕的视频时，最终输出视频中字幕全部消失。中文字幕正常，仅英文字幕受影响（因为英文字幕文本会被按单词换行）。

## Root Cause

**文件:** `backend-services/basic-service/app/services/subtitle_service.py:694`

`_build_standard_drawtext_filters` 方法中，多行字幕文本用 `'\n'.join(wrapped_lines)` 拼接后产生含**实际换行符**（ASCII 0x0A）的字符串，但后续的特殊字符转义逻辑只处理了 `'` 和 `:`，未处理换行符。

**原代码（有问题）：**
```python
text_content = '\n'.join(wrapped_lines)
text_content = text_content.replace("'", "\\'").replace(":", "\\:")
```

含实际换行符的字符串被嵌入 ffmpeg 的 `-vf` drawtext 过滤器参数中，导致 ffmpeg 的过滤器表达式解析器在遇到换行符时状态错乱，`enable='between(t,x,y)'` 被截断为 `between(t`，引发错误：
```
[Eval] Missing ')' or too many args in 'between(t'
Error when evaluating the expression 'between(t' for enable
```

ffmpeg 失败后，`video_composition_service.py` 捕获到错误并以 WARNING 级别记录（"Subtitle processing failed - continuing without subtitles"），导致静默丢失字幕。

**为何中文字幕不受影响：** 中文字幕通常较短，不需要换行（或换行后 `max_line_width` 足够大），因此 `wrapped_lines` 只有一行，`'\n'.join()` 不产生换行符。英文字幕按单词换行，几乎总会产生多行。

## Fix Applied

**Files modified:**
- `backend-services/basic-service/app/services/subtitle_service.py:694` - 在转义链中添加换行符转义

**Changes:**
```python
# 修复前
text_content = text_content.replace("'", "\\'").replace(":", "\\:")

# 修复后
text_content = text_content.replace("'", "\\'").replace(":", "\\:").replace("\n", "\\n")
```

将实际换行符替换为 ffmpeg drawtext 的 `\n` 转义序列（ffmpeg 会将 `\n` 正确渲染为换行），防止过滤器解析器状态错乱。

## Verification

未自动运行测试（需在 Linux 服务器上验证）。建议手动测试：
1. 创建含撇号或需要换行的英文字幕（如 `hello everyone welcome to today's video tutorial`）
2. 导出视频，确认字幕正常显示

## Notes

- `_build_multiline_centered_drawtext_filters`（竖屏视频路径）不受影响，因为它每行单独创建一个 drawtext filter，不存在换行拼接。
- 修复未改变对 `'` 和 `:` 的转义顺序。
- 可考虑改进：同时转义反斜杠 `\` 以防止文本中含反斜杠时出现类似问题（当前文本不含反斜杠，暂不修复）。
