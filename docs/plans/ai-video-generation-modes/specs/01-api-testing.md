# Spec 01: ARK API 首尾帧调用测试

## 目标

在编写业务代码之前，通过独立测试脚本验证 ARK API 对三种调用模式的支持情况，确认请求格式、参数名称和返回结构正确。

## 测试场景

### 场景 1: 纯文本生成（基线）

```pseudo
request = {
  model: "doubao-seedance-1-5-pro-251215",
  content: [
    { type: "text", text: "一只猫在草地上奔跑" }
  ],
  duration: 5,
  ratio: "16:9",
  resolution: "720p"
}
```

**验证点：** 返回 task_id，轮询后 status=succeeded，content.video_url 可访问。

### 场景 2: 首帧图 + 描述

```pseudo
request = {
  model: "doubao-seedance-1-5-pro-251215",
  content: [
    { type: "text", text: "镜头缓慢推进，花朵绽放" },
    { type: "image_url", image_url: { url: "<公网可访问的测试图片>" }, role: "first_frame" }
  ],
  duration: 5,
  ratio: "adaptive",
  resolution: "720p"
}
```

**验证点：** 任务创建成功，生成的视频首帧与输入图片视觉一致。

### 场景 3: 首帧 + 尾帧 + 描述

```pseudo
request = {
  model: "doubao-seedance-1-5-pro-251215",
  content: [
    { type: "text", text: "从白天过渡到黑夜的延时效果" },
    { type: "image_url", image_url: { url: "<首帧图片URL>" }, role: "first_frame" },
    { type: "image_url", image_url: { url: "<尾帧图片URL>" }, role: "last_frame" }
  ],
  duration: 5,
  ratio: "adaptive",
  resolution: "720p"
}
```

**验证点：** 任务创建成功，视频起始画面接近首帧、结尾画面接近尾帧。

### 场景 4: 仅尾帧（无首帧）

```pseudo
request = {
  model: "doubao-seedance-1-5-pro-251215",
  content: [
    { type: "text", text: "一段旅程的终点" },
    { type: "image_url", image_url: { url: "<尾帧图片URL>" }, role: "last_frame" }
  ],
  duration: 5,
  ratio: "adaptive",
  resolution: "720p"
}
```

**验证点：** 确认 API 是否允许只传尾帧不传首帧。如果报错，需要在前端/后端做限制。

## 测试脚本设计

- 位置：`backend-services/basic-service/tests/test_ark_api_modes.py`
- 使用 `httpx` 直接调用 ARK API（不经过业务层）
- 读取 `.env` 中的 `ARK_API_KEY`
- 每个场景独立函数，可单独运行
- 提交任务后轮询 status，最长等待 180 秒
- 打印完整的请求/响应 JSON 用于调试
- 测试图片使用公网 URL（如 Pexels 上的免费图片）

## 成功标准

- [ ] 场景 1-3 全部成功生成视频
- [ ] 场景 4 明确知道 API 行为（成功或报错）
- [ ] 记录任何与文档不符的 API 行为
- [ ] 确认 `ratio: "adaptive"` 在有图片时必须使用
