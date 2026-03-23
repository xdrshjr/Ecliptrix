# Spec 08: 素材管理工具 (Material Management Tools)

## 1. 概述

为 Agent 添加素材库直接管理工具：`add_material_to_library`（手动添加素材到库）和 `remove_material`（从素材库移除素材）。这些工具补充了搜索和 AI 生成工具的自动入库行为，提供 Agent 对素材库的完整控制能力。

## 2. 工具定义

### 2.1 add_material_to_library

```
Tool: add_material_to_library
Description: "将指定的外部素材添加到素材库。支持通过 URL 添加视频、图片、音频。"
Parameters:
  - url: string (required) — 素材的 URL 地址
  - name: string (required) — 素材名称
  - type: string (required) — "video" | "image" | "audio"
  - metadata: object (optional) — { duration, width, height, format, description }
Returns:
  - success: boolean
  - material: { id, name, type, url } | null
  - message: string
```

**用途场景**：
- Agent 从对话中获取用户提供的 URL
- Agent 从工作流中获得的中间产物

### 2.2 remove_material

```
Tool: remove_material
Description: "从素材库中移除指定素材。不会影响已添加到时间线上的片段。"
Parameters:
  - material_id: string (required) — 要移除的素材 ID
Returns:
  - success: boolean
  - message: string
```

## 3. 处理流程

```
add_material_to_library handler:
    1. 验证 URL 格式和可访问性（HEAD 请求）
    2. 创建 MaterialItem { id: generateId(), name, type, url, ...metadata }
    3. materialStore.addMaterial(item)
    4. 返回结果

remove_material handler:
    1. 检查素材是否存在于 materialStore
    2. materialStore.removeMaterial(id)
    3. 返回结果
```

## 4. 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/lib/video-editing-agent/tools/addMaterialToLibrary.ts` | 新建 | 添加素材工具 |
| `src/lib/video-editing-agent/tools/removeMaterial.ts` | 新建 | 移除素材工具 |
| `src/lib/video-editing-agent/registry/categories.ts` | 修改 | 注册 material_tools 类别 |

## 5. 边界条件

- URL 无法访问 → 返回 warning 但仍然添加（用户可能在本地网络）
- 移除不存在的素材 → 返回 `{ success: false, message: "Material not found" }`
- 移除正在时间线上使用的素材 → 允许移除，但在 message 中提示"该素材在时间线上有引用"
