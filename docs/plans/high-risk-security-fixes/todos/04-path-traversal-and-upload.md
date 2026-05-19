# TODO 04：路径穿越与文件上传加固

> 对应 spec：[`specs/04-path-traversal-and-upload.md`](../specs/04-path-traversal-and-upload.md)

## Dependencies

- **depends_on:** `01`（需要 `Depends(get_current_user)` 已加到 storage router）
- **blocks:** 无
- **parallel_group:** B

**依赖原因**：spec/04 阶段 B 的上传 endpoint 改造假设 `Depends(get_current_user)` 已生效（spec/01 阶段 D 引入了 `storage_files_router`），否则要在 spec/04 内同时引入鉴权 + 路径校验，违反"小步快跑"原则。

## 任务清单

### 阶段 A：盘点

- [ ] A1 — Read `backend-services/basic-service/app/services/storage_service.py` 全文，特别是 `_validate_path()` 与 `_sanitize_filename()`
- [ ] A2 — Read `backend-services/basic-service/app/routers/storage_router.py` 全文，列出所有 upload_* endpoint 与 form 参数
- [ ] A3 — `Grep -rn "UploadFile" backend-services/basic-service/app/routers/` 列出所有上传 endpoint
- [ ] A4 — Read 其余命中文件（`image_pack_router.py`、`frame_pack_router.py`、`voice_clone_router.py`、`material_router.py` 等）的上传逻辑
- [ ] A5 — 测试当前 `_validate_path` 对 `../`、绝对路径、null byte、symlink 的行为（建议直接写 pytest 跑现状）

### 阶段 B：强化 `_validate_path` 与 `_sanitize_filename`

- [ ] B1 — 改造 `_validate_path(relative)`：
  - 拒绝空字符串
  - 拒绝含 `\x00` null byte
  - 拒绝长度 > 4096 字节
  - 拒绝以 `/`、`\` 开头（绝对路径）或含 Windows drive 前缀（如 `C:`）
  - 用 `(STORAGE_ROOT / relative).resolve(strict=False)` + `is_relative_to(STORAGE_ROOT.resolve())` 校验
  - 目标若已存在且是 symlink → 拒绝
- [ ] B2 — 改造 `_sanitize_filename(name)`：
  - 保留 Unicode 字母数字（中文 OK）
  - 替换危险字符 `/ \ : * ? " < > |` 与控制字符
  - 限长 200
  - 黑名单可执行扩展：`.html .htm .svg .xml .js .mjs .cjs .php .py .sh .bat .ps1 .exe`
    - 命中后强制改写为 `.txt` 或拒绝
  - 拒绝 filename 含 `..` 或 `/`

### 阶段 C：上传 endpoint 接入

- [ ] C1 — 修改 `storage_router.py` 所有 `upload_*` endpoint：
  - 加 `current_user = Depends(get_current_user)`（如 spec/01 阶段 D 已加，可省略）
  - 用 `_sanitize_filename(file.filename)` 处理
  - `bucket_path` 校验通过 `_validate_path`
  - 默认按 `user_id` 隔离目录
  - 加 uuid4 前缀防覆盖
  - 加 MIME 白名单（按上传类别）
- [ ] C2 — 其他 router（image_pack 等）：盘点结果若直接调用 `storage_service.upload_file()`，则跟随其改造无需额外动作；若自己拼路径 → 同样接入校验

### 阶段 D：下载侧（与 spec/01 V01-C 协同）

- [ ] D1 — 在 spec/01 引入的 `storage_files_router.py` 中：
  - 对扩展名属于危险类别（svg/html 等）的下载，强制 `Content-Disposition: attachment` + `Content-Type: text/plain`
  - 始终带 `X-Content-Type-Options: nosniff`（spec/02 已全局加，这里 double-down）
- [ ] D2 — 如果 spec/01 还未完成，在 spec/04 完成后通过 SendMessage 通知 spec/01 的 DEV agent 补这块

### 阶段 E：测试

- [ ] E1 — 新建 `backend-services/basic-service/tests/security/test_04_path_traversal.py`
- [ ] E2 — 单元测试 `_validate_path`：
  - 正向：合法相对路径 → 返回 Path
  - 攻击：`../../etc`、`/etc`、`C:\Windows`、含 null byte、过长路径 → ValueError
  - symlink：预先在 STORAGE_ROOT 下创建符号链接指向 `/etc/passwd` → 上传同名 → 拒绝
- [ ] E3 — 单元测试 `_sanitize_filename`：
  - 中文文件名保留
  - `../evil.sh` → sanitize 或拒绝
  - `foo.html` → 改写为 `foo.txt` 或拒绝
- [ ] E4 — 集成测试：MIME 与扩展不符 → 415
- [ ] E5 — 跑 `pytest backend-services/basic-service/tests/security/test_04_path_traversal.py -v`

### 阶段 F：回归

- [ ] F1 — `pytest backend-services/basic-service/tests/ -v`
- [ ] F2 — 烟测：通过 `/api/storage/upload-audio` 上传一个合法 mp3 → 200 + 文件在 STORAGE_ROOT 下落地

## 完成准则

- [ ] V04-A、V04-B、V04-D 均有补丁（V04-C 顺便覆盖）
- [ ] `_validate_path` 与 `_sanitize_filename` 单元测试覆盖 ≥ 15 个用例
- [ ] 所有上传 endpoint 均接入 MIME 与 sanitize
- [ ] 测试套 100% 绿；合法上传仍工作
