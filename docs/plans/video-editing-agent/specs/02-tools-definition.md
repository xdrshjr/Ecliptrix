# Spec 02: 工具定义

## 1. 概述

本文档定义视频编辑 Agent 的 7 个工具。每个工具遵循 pi-agent-core 的 `AgentTool` 接口，使用 TypeBox 定义参数 schema。所有工具的 name、description、parameters 字段均为英文。

工具执行采用"服务端计算 + 前端应用"模式：
- **服务端（API Route）**: 工具的 `execute` 函数验证参数、计算变更，返回操作指令
- **前端**: 接收到 `tool_result` SSE 事件后，实际应用变更到时间线状态

## 2. 工具执行上下文

每个工具执行时可访问以下上下文（通过闭包注入）：

```
伪代码:

interface ToolContext {
    timelineState: TimelineState     // 当前时间线状态（实时更新）
    materials: MaterialItem[]        // 当前素材库
    updateTimeline: (operation) => void  // 记录操作到变更列表
}
```

工具不直接修改时间线，而是产出操作指令（operation），由前端统一执行。

## 3. 工具详细定义

### 3.1 get_timeline

获取当前时间线的完整状态。

```
AgentTool:
    name: "get_timeline"
    label: "Get Timeline"
    description: "Get the current timeline state including all tracks, clips, and their properties. Use this to understand what's currently on the timeline before making changes."
    parameters: Type.Object({})  // 无参数

    execute(toolCallId, params, signal, onUpdate):
        tracks = context.timelineState.tracks
        result = []
        for each track in tracks:
            trackInfo = {
                id: track.id,
                name: track.name,
                type: track.type,  // video, audio, image, subtitle
                muted: track.muted,
                locked: track.locked,
                volume: track.volume,
                clips: []
            }
            for each item in track.items:
                material = findMaterial(item.materialId)
                clipInfo = {
                    id: item.id,
                    materialId: item.materialId,
                    materialName: material?.name,
                    startTime: item.startTime,
                    duration: item.duration,
                    clipStart: item.clipStart,
                    clipEnd: item.clipEnd,
                    originalDuration: item.originalDuration,
                    volume: item.volume
                }
                trackInfo.clips.push(clipInfo)
            result.push(trackInfo)

        return {
            success: true,
            totalDuration: context.timelineState.totalDuration,
            tracks: result
        }
```

### 3.2 search_materials

在素材库中搜索素材。

```
AgentTool:
    name: "search_materials"
    label: "Search Materials"
    description: "Search the material library for videos, images, or audio files. Returns matching materials that can be added to the timeline."
    parameters: Type.Object({
        query: Type.String({ description: "Search keyword to match material names" }),
        type: Type.Optional(Type.Union([
            Type.Literal("video"),
            Type.Literal("image"),
            Type.Literal("audio"),
            Type.Literal("subtitle")
        ], { description: "Filter by material type. If omitted, searches all types." }))
    })

    execute(toolCallId, params, signal, onUpdate):
        query = params.query.toLowerCase()
        results = context.materials.filter(m =>
            m.name.toLowerCase().includes(query) &&
            (!params.type || m.type === params.type)
        )

        return {
            success: true,
            count: results.length,
            materials: results.map(m => ({
                id: m.id,
                name: m.name,
                type: m.type,
                duration: m.duration,
                thumbnailUrl: m.thumbnailUrl
            }))
        }
```

### 3.3 add_to_track

将素材添加到时间线轨道。

```
AgentTool:
    name: "add_to_track"
    label: "Add to Track"
    description: "Add a material from the library to a timeline track. If no track is specified, automatically selects the appropriate track based on material type. If no start time is specified, places it at the end of the track."
    parameters: Type.Object({
        materialId: Type.String({ description: "The ID of the material to add" }),
        trackId: Type.Optional(Type.String({ description: "Target track ID. Auto-selected if omitted." })),
        startTime: Type.Optional(Type.Number({ description: "Start position in seconds on the timeline. Defaults to end of track." }))
    })

    execute(toolCallId, params, signal, onUpdate):
        material = findMaterial(params.materialId)
        if not material:
            return { success: false, error: "Material not found: " + params.materialId }

        // 确定目标轨道
        trackId = params.trackId
        if not trackId:
            trackId = getDefaultTrackForType(material.type)
            // video → video-track-1, audio → audio-track-1, etc.

        track = findTrack(trackId)
        if not track:
            return { success: false, error: "Track not found: " + trackId }
        if track.locked:
            return { success: false, error: "Track is locked: " + trackId }

        // 确定开始时间
        startTime = params.startTime
        if startTime is undefined:
            startTime = getTrackEndTime(track)  // 放在轨道末尾

        // 生成新片段
        newClip = {
            id: generateId(),
            materialId: material.id,
            trackId: trackId,
            startTime: startTime,
            duration: material.duration || 5,  // 图片默认5秒
            clipStart: 0,
            clipEnd: material.duration || 5,
            originalDuration: material.duration || 5,
            volume: 1.0
        }

        context.updateTimeline({
            type: "add_clip",
            clip: newClip,
            material: material
        })

        return {
            success: true,
            clip: {
                id: newClip.id,
                materialName: material.name,
                trackId: trackId,
                startTime: startTime,
                duration: newClip.duration
            }
        }
```

### 3.4 trim_clip

裁剪片段的入点/出点。

```
AgentTool:
    name: "trim_clip"
    label: "Trim Clip"
    description: "Trim a clip by adjusting its in-point (clipStart) and/or out-point (clipEnd). This changes which portion of the source material is shown, without moving the clip on the timeline."
    parameters: Type.Object({
        clipId: Type.String({ description: "The ID of the clip to trim" }),
        clipStart: Type.Optional(Type.Number({ description: "New in-point in seconds within the source material" })),
        clipEnd: Type.Optional(Type.Number({ description: "New out-point in seconds within the source material" }))
    })

    execute(toolCallId, params, signal, onUpdate):
        clip = findClip(params.clipId)
        if not clip:
            return { success: false, error: "Clip not found: " + params.clipId }

        // 验证范围
        newStart = params.clipStart ?? clip.clipStart
        newEnd = params.clipEnd ?? clip.clipEnd

        if newStart < 0:
            return { success: false, error: "clipStart cannot be negative" }
        if newEnd > clip.originalDuration:
            return { success: false, error: "clipEnd exceeds original duration" }
        if newStart >= newEnd:
            return { success: false, error: "clipStart must be less than clipEnd" }

        newDuration = newEnd - newStart

        context.updateTimeline({
            type: "trim_clip",
            clipId: params.clipId,
            clipStart: newStart,
            clipEnd: newEnd,
            duration: newDuration
        })

        return {
            success: true,
            clip: {
                id: params.clipId,
                clipStart: newStart,
                clipEnd: newEnd,
                duration: newDuration
            }
        }
```

### 3.5 delete_clip

从时间线删除片段。

```
AgentTool:
    name: "delete_clip"
    label: "Delete Clip"
    description: "Remove a clip from the timeline. The source material remains in the library."
    parameters: Type.Object({
        clipId: Type.String({ description: "The ID of the clip to delete" })
    })

    execute(toolCallId, params, signal, onUpdate):
        clip = findClip(params.clipId)
        if not clip:
            return { success: false, error: "Clip not found: " + params.clipId }

        context.updateTimeline({
            type: "delete_clip",
            clipId: params.clipId,
            trackId: clip.trackId
        })

        return {
            success: true,
            message: "Clip deleted successfully",
            deletedClipId: params.clipId
        }
```

### 3.6 move_clip

移动片段到新的时间位置或轨道。

```
AgentTool:
    name: "move_clip"
    label: "Move Clip"
    description: "Move a clip to a different position on the timeline, and optionally to a different track."
    parameters: Type.Object({
        clipId: Type.String({ description: "The ID of the clip to move" }),
        newStartTime: Type.Number({ description: "New start position in seconds" }),
        newTrackId: Type.Optional(Type.String({ description: "Move to a different track. If omitted, stays on the same track." }))
    })

    execute(toolCallId, params, signal, onUpdate):
        clip = findClip(params.clipId)
        if not clip:
            return { success: false, error: "Clip not found: " + params.clipId }

        if params.newStartTime < 0:
            return { success: false, error: "Start time cannot be negative" }

        targetTrackId = params.newTrackId ?? clip.trackId
        targetTrack = findTrack(targetTrackId)
        if not targetTrack:
            return { success: false, error: "Target track not found: " + targetTrackId }
        if targetTrack.locked:
            return { success: false, error: "Target track is locked" }

        context.updateTimeline({
            type: "move_clip",
            clipId: params.clipId,
            fromTrackId: clip.trackId,
            toTrackId: targetTrackId,
            newStartTime: params.newStartTime
        })

        return {
            success: true,
            clip: {
                id: params.clipId,
                trackId: targetTrackId,
                startTime: params.newStartTime
            }
        }
```

### 3.7 resize_clip

拉伸或压缩片段的显示时长，填充指定的时间范围。

```
AgentTool:
    name: "resize_clip"
    label: "Resize Clip"
    description: "Stretch or compress a clip's display duration on the timeline. This changes how long the clip appears without altering the source material's in/out points."
    parameters: Type.Object({
        clipId: Type.String({ description: "The ID of the clip to resize" }),
        newDuration: Type.Number({ description: "New display duration in seconds" })
    })

    execute(toolCallId, params, signal, onUpdate):
        clip = findClip(params.clipId)
        if not clip:
            return { success: false, error: "Clip not found: " + params.clipId }

        if params.newDuration <= 0:
            return { success: false, error: "Duration must be positive" }

        context.updateTimeline({
            type: "resize_clip",
            clipId: params.clipId,
            newDuration: params.newDuration
        })

        return {
            success: true,
            clip: {
                id: params.clipId,
                previousDuration: clip.duration,
                newDuration: params.newDuration
            }
        }
```

## 4. 辅助函数

```
伪代码:

function findMaterial(materialId):
    return context.materials.find(m => m.id === materialId)

function findTrack(trackId):
    return context.timelineState.tracks.find(t => t.id === trackId)

function findClip(clipId):
    for each track in context.timelineState.tracks:
        for each item in track.items:
            if item.id === clipId:
                return { ...item, trackId: track.id }
    return null

function getDefaultTrackForType(type):
    switch type:
        case "video": return "video-track-1"
        case "image": return "image-track-1"
        case "audio": return "audio-track-1"
        case "subtitle": return "subtitle-track-1"

function getTrackEndTime(track):
    if track.items.length === 0: return 0
    lastItem = track.items[track.items.length - 1]
    return lastItem.startTime + lastItem.duration
```

## 5. 工具注册

```
伪代码:

function buildVideoEditingTools(context: ToolContext): AgentTool[]:
    return [
        createGetTimelineTool(context),
        createSearchMaterialsTool(context),
        createAddToTrackTool(context),
        createTrimClipTool(context),
        createDeleteClipTool(context),
        createMoveClipTool(context),
        createResizeClipTool(context)
    ]
```

## 6. 操作指令类型汇总

前端需处理的操作指令类型：

| type | 描述 | 关键字段 |
|------|------|----------|
| `add_clip` | 添加新片段 | clip, material |
| `trim_clip` | 裁剪片段 | clipId, clipStart, clipEnd, duration |
| `delete_clip` | 删除片段 | clipId, trackId |
| `move_clip` | 移动片段 | clipId, fromTrackId, toTrackId, newStartTime |
| `resize_clip` | 缩放片段时长 | clipId, newDuration |

注意：`get_timeline` 和 `search_materials` 是只读工具，不产出操作指令。
