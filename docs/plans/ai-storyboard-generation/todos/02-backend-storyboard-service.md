# TODO 02: 后端分镜服务

**对应 Spec**: `specs/02-backend-storyboard-service.md`

## Dependencies

- `depends_on: []` — 无前置依赖，后端可独立开发
- `blocks: [03, 04, 05]` — 所有前端功能依赖后端 API
- `parallel_group: A` — 可以与 TODO 01 的前端类型定义并行开发

## Tasks

### 数据模型
- [ ] 创建 `app/models/storyboard_models.py` — 所有 Pydantic 模型
  - [ ] StoryboardGenerateRequest
  - [ ] StoryboardDescribeRequest
  - [ ] StoryboardBatchVideoRequest / StoryboardVideoSegment
  - [ ] StoryboardComposeRequest
  - [ ] StoryboardFrame / StoryboardPack
  - [ ] 所有 Response 模型

### 核心服务
- [ ] 创建 `app/services/storyboard_service.py`
- [ ] 实现 `build_storyboard_prompt()` — 系统提示词构建 (含宫格布局指令和白色分隔线要求)
- [ ] 实现 `generate_storyboard()` — ARK Seedream API 调用 + 图片下载
- [ ] 实现 `crop_storyboard()` — PIL 均等分割裁剪 (含 4px 内缩去白线)
- [ ] 实现分镜包目录创建和 metadata.json 写入
- [ ] 实现 `list_packs()` — 扫描目录列出所有分镜包
- [ ] 实现 `get_pack()` — 读取单个分镜包
- [ ] 实现 `delete_pack()` — 删除分镜包目录

### VL描述生成
- [ ] 实现 `generate_frame_descriptions()` — VL_LLM 帧识图描述
  - [ ] 构建 VL_LLM 系统提示词 (视频分镜描述专家)
  - [ ] 帧图片 base64 编码发送
  - [ ] asyncio.Semaphore(3) 并发控制
  - [ ] 单帧失败不阻塞其他帧

### 批量视频生成
- [ ] 实现 `batch_generate_videos()` — 调用 ark_video_service 批量提交
  - [ ] 描述模式 + 帧图作参考图
  - [ ] 并发控制 (同时最多 3 个)
  - [ ] 返回 task_id 映射
- [ ] 实现 `get_batch_video_status()` — 聚合查询批量任务状态

### 视频合成
- [ ] 实现 `compose_storyboard_video()` — FFmpeg concat 拼接
  - [ ] stream copy 优先，失败回退重编码
  - [ ] 生成缩略图
  - [ ] 清理临时文件

### 路由注册
- [ ] 创建 `app/routers/storyboard_router.py` — 所有 API 端点
- [ ] 修改 `app/main.py` — 注册 storyboard_router (前缀 /api)

### 存储
- [ ] 确认 Pillow 已安装
- [ ] 创建存储目录结构 (install.sh 中添加 storyboard 目录)
