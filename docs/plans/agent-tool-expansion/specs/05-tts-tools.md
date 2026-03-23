# Spec 05: TTS 语音合成工具 (TTS Tools)

## 1. 概述

为 Agent 添加 TTS 语音合成工具：`generate_tts`（单段语音合成）和 `batch_generate_tts`（批量语音合成，适用于脚本分段合成）。合成结果自动注入 materialStore。

## 2. 工具定义

### 2.1 generate_tts

```
Tool: generate_tts
Description: "将文本转换为语音。支持 100+ 音色选择，生成完成后自动添加到素材库。"
Parameters:
  - text: string (required) — 要转换的文本
  - voice_type: string (optional) — 音色 ID，不指定时使用默认音色
  - speed: number (optional, default: 1.0) — 语速倍率 (0.5-2.0)
  - volume: number (optional, default: 1.0) — 音量倍率 (0.1-2.0)
Returns:
  - success: boolean
  - material: { id, name, type: "audio", duration, url, format } | null
  - message: string
```

**实现路径**：调用 `/api/tts/convert`。TTS 通常在几秒内完成，可同步等待。

### 2.2 batch_generate_tts

```
Tool: batch_generate_tts
Description: "批量将多段文本转换为语音。适用于脚本的多个段落，每段生成独立音频。"
Parameters:
  - segments: Array<{ text: string, voice_type?: string }> (required)
  - speed: number (optional, default: 1.0)
  - volume: number (optional, default: 1.0)
Returns:
  - success: boolean
  - taskId: string — 异步任务 ID
  - total_segments: number
  - message: string — "批量语音合成已启动，共 N 段"
```

**实现路径**：调用 `/api/tts/batch-convert` 或 `/api/tts/convert-sentences`。批量合成采用异步模式。

## 3. 音色选择

Agent 需要能够查看可用音色列表。两种方案：

**方案 A（推荐）**：在 `explore_tools({ category: "tts_tools" })` 的返回中包含常用音色列表摘要（前 10 个热门音色的 ID + 描述），Agent 可直接使用。

**方案 B**：添加 `list_voices` 工具，返回完整音色列表。但这会增加工具数量。

选择方案 A，在 tts_tools 类别的 `usage_hints` 中包含：
```
常用音色：
- zh_female_shuangkuaisisi_moon_bigtts: 双快丝丝(女)
- zh_male_chunhou_moon_bigtts: 醇厚(男)
- zh_female_tianmei_moon_bigtts: 甜美(女)
- en_female_arabellaexpressive: Arabella(女,英文)
- en_male_caleb: Caleb(男,英文)
...完整列表请参考系统音色配置
```

## 4. 处理流程

### 单段 TTS（同步）
```
Agent 调用 generate_tts({ text: "欢迎来到海洋世界", voice_type: "zh_female_tianmei" })
    ↓
Handler:
    1. POST /api/tts/convert { text, voice_type, speed, volume }
    2. 等待响应（通常 2-5s）
    3. 将结果转换为 MaterialItem
    4. materialStore.addMaterial(item)
    5. 返回 { success, material: { id, name, duration, url }, message }
```

### 批量 TTS（异步）
```
Agent 调用 batch_generate_tts({ segments: [...] })
    ↓
Handler:
    1. POST /api/tts/batch-convert { segments, speed, volume }
    2. 获取 taskId
    3. asyncTaskStore.addTask({ taskId, type: "batch_tts", status: "pending" })
    4. 返回 { success, taskId, message }
    ↓
前端轮询 → 完成后批量添加音频素材到 materialStore
```

## 5. 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/lib/video-editing-agent/tools/generateTts.ts` | 新建 | 单段 TTS 工具 |
| `src/lib/video-editing-agent/tools/batchGenerateTts.ts` | 新建 | 批量 TTS 工具 |
| `src/lib/video-editing-agent/registry/categories.ts` | 修改 | 注册 tts_tools 类别 |

## 6. 边界条件

- 文本为空 → 返回参数错误
- 音色 ID 无效 → 使用默认音色并在 message 中告知
- 单段文本超长（>5000字） → 自动分段调用 batch 接口
- TTS 服务不可用 → 返回 `{ success: false, message: "TTS service unavailable" }`
