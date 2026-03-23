# TODO 01: 树形工具注册系统

**Spec**: `specs/01-tool-registry-system.md`

## Dependencies
- **depends_on**: [] (无依赖，基础设施)
- **blocks**: [03, 04, 05, 06, 07, 08, 10] (所有工具类别和系统提示依赖此模块)
- **parallel_group**: A

## Tasks

- [ ] 创建 `src/lib/video-editing-agent/registry/` 目录
- [ ] 实现 `ToolRegistry` 类 — 管理工具类别注册、查询
  - [ ] `registerCategory(category: ToolCategory)` 方法
  - [ ] `getCategorySummaries()` 方法 — 返回所有类别的 id/name/description
  - [ ] `getCategoryTools(categoryId)` 方法 — 返回完整工具定义
  - [ ] `getAlwaysAvailableTools()` 方法 — 返回始终可用工具集
- [ ] 实现 `categories.ts` — 定义所有 8 个工具类别的元数据
  - [ ] query_tools 类别定义
  - [ ] editing_tools 类别定义
  - [ ] search_tools 类别定义（工具实现在 spec 03）
  - [ ] ai_gen_tools 类别定义（工具实现在 spec 04）
  - [ ] tts_tools 类别定义（工具实现在 spec 05）
  - [ ] script_tools 类别定义（工具实现在 spec 06）
  - [ ] storyboard_tools 类别定义（工具实现在 spec 07）
  - [ ] material_tools 类别定义（工具实现在 spec 08）
- [ ] 实现 `exploreTools.ts` — explore_tools meta tool
  - [ ] 工具参数定义（category enum）
  - [ ] Handler：从 ToolRegistry 获取类别工具并返回格式化描述
  - [ ] 确认 pi-agent-core 的动态工具注入能力（方案 A/B/C 选择）
  - [ ] 实现选定方案的工具注入逻辑
- [ ] 修改 `tools/index.ts` — 从硬编码列表改为 ToolRegistry 驱动
  - [ ] `buildVideoEditingTools()` 改为从 registry 获取始终可用工具
  - [ ] 保留现有 helper 函数（findMaterial, findTrack 等）
- [ ] 修改 `agent.ts` — 使用 ToolRegistry 初始化 Agent
  - [ ] 创建 ToolRegistry 实例并注册所有类别
  - [ ] 用 `registry.getAlwaysAvailableTools()` + explore_tools 初始化 Agent
- [ ] 创建 `registry/index.ts` 导出文件
