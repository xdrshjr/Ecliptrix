# Bug 分析报告：导出视频后中文字幕显示为方框（豆腐块/tofu）

- **Bug slug**: `chinese-subtitle-tofu-on-export`
- **分析人**: Subtask #0（问题定位与分析）
- **日期**: 2026-06-02
- **生产环境**: ecliptrix-prod `47.84.198.68`，Ubuntu 24.04.2 LTS，ffmpeg 6.1.1，应用目录 `/root/ecliptrix`
- **结论一句话**: 生产服务器上**未安装任何中文（CJK）字体**，字幕烧录时 `SubtitleService._get_font_path()` 在所有 CJK 候选字体缺失后**回退到拉丁字体 `DejaVuSans.ttf`**，而该字体没有任何中文字形，FFmpeg `drawtext` 因此把每个中文字符渲染成"缺字符方框"。**这是部署环境问题（缺字体），并被代码的静默回退逻辑放大。**

---

## 1. 问题描述（Problem description）

用户在视频编辑器中点击"导出视频"，后端合成视频成功，但**中文字幕**在最终成片里不是中文，而是一连串方框（□□□，俗称"豆腐块/tofu"）。英文字幕正常。

- 触发条件：字幕文本包含中文字符（CJK）。
- 现象：导出的 MP4 中字幕位置出现等宽方框，数量与中文字数一致；字号、描边、背景框、位置都正常，唯独**字形缺失**。
- 影响版本：当前生产部署（`feat/api-authz-rate-limiting` 分支对应的线上代码），与本地仓库代码一致。

> 该症状是典型的"字体缺少目标字符的字形"问题：FFmpeg `drawtext` 用了一个只含拉丁字形的字体去画中文，于是每个汉字都被替换成 `.notdef` 缺省字形（方框）。

---

## 2. 复现步骤（Reproduction steps）

### 2.1 端到端复现（用户视角）
1. 打开视频编辑器，新建/打开一个项目，时间轴上放入至少 1 段视频。
2. 添加**中文字幕**（subtitle track），例如文本：`这是中文字幕测试`。
3. 点击"导出视频"，等待合成完成并下载成片。
4. 播放成片：字幕区域显示为方框 `□□□□□□□□`，而非中文。

### 2.2 后端直接复现（最小可复现，绕过前端）

在生产同构环境（Ubuntu 24.04，**未安装 CJK 字体**）上：

```bash
# 1) 准备一段测试视频和一个中文 SRT
printf '1\n00:00:00,000 --> 00:00:05,000\n这是中文字幕测试\n' > /tmp/zh.srt
ffmpeg -y -f lavfi -i color=c=black:s=1280x720:d=5 /tmp/base.mp4

# 2) 用与服务相同的字体（系统无 CJK 时它会选到 DejaVuSans）烧录
ffmpeg -y -i /tmp/base.mp4 \
  -vf "drawtext=textfile=/tmp/zh.srt_text:fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf':fontsize=40:fontcolor=white:x=(w-text_w)/2:y=h-100" \
  /tmp/out.mp4
# 直接用中文文本亦可：text='这是中文字幕测试'
# => 成片中文为方框
```

### 2.3 一条命令验证环境根因（最快）
```bash
ssh root@47.84.198.68 'fc-list :lang=zh | wc -l'   # 生产实测输出: 0  （= 系统没有任何中文字体）
```

> 证据见 §3：在生产上 `fc-list :lang=zh` 返回 0，且代码探测的 11 个 CJK 字体路径全部不存在。

---

## 3. 根因分析（Root cause analysis，含证据）

### 3.1 调用链：导出 → 字幕烧录 → 选字体

导出走 `VideoCompositionService`，字幕部分最终都汇聚到 `SubtitleService._get_font_path()` 来挑选 `drawtext` 的 `fontfile=`：

- 合成主流程在处理字幕时分两条路径，都会用到同一个字体选择逻辑：
  - 图片叠加 + 字幕合并烧录：`_process_overlays_and_subtitles_combined()`，内部调用
    `self.subtitle_service.build_drawtext_filters(...)`
    — `backend-services/basic-service/app/services/video_composition_service.py:1340`、`:2417`、`:2506`
  - 仅字幕烧录：`_process_subtitle_tracks()` → `SubtitleService.add_subtitles()`
    — `backend-services/basic-service/app/services/video_composition_service.py:1382`、`:2209`、`:2310`
- 两条路径里，每条 `drawtext` 的字体都来自 `_get_font_path()` 的返回值：
  - `backend-services/basic-service/app/services/subtitle_service.py:746-750`（标准/横屏）
  - `backend-services/basic-service/app/services/subtitle_service.py:863-867`（竖屏多行居中）
  - `build_drawtext_filters()` 入口：`backend-services/basic-service/app/services/subtitle_service.py:573-609`

### 3.2 关键缺陷：CJK 候选缺失后**静默回退到拉丁字体**

`_get_font_path()`（`subtitle_service.py:356`）在 Linux 分支里把字体候选列表组织成
`default_fonts = chinese_fonts + latin_fonts`（检测到中文时，`subtitle_service.py:480-482`）：

- `chinese_fonts`（11 个候选）：`subtitle_service.py:453-470`，例如
  `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`、`/usr/share/fonts/truetype/wqy/wqy-microhei.ttc` 等。
- `latin_fonts`（3 个候选，**不含中文字形**）：`subtitle_service.py:472-477`
  ```
  /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
  /usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf
  /usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf
  ```

随后的查找循环"返回第一个**存在**的字体文件"（`subtitle_service.py:518-524`）。当 11 个 CJK 文件全部不存在时，循环继续走到第 12 个候选 `DejaVuSans.ttf`——它**存在**，于是被返回，并打日志 `Using 'DejaVuSans.ttf' for Chinese subtitle rendering`。

> 注意：因为拉丁字体总能找到，`subtitle_service.py:531` 的 `"No suitable font found on the system!"` **永远不会触发**——系统等于"看起来有字体可用"，但那字体根本画不了中文。这正是 bug 被长期掩盖的原因。

### 3.3 生产环境取证（决定性证据）

通过 SSH 在生产机 `47.84.198.68` 实测（只读命令）：

```
# OS / ffmpeg
Ubuntu 24.04.2 LTS (noble)
ffmpeg version 6.1.1-3ubuntu5

# 系统是否注册了任何中文字体？
fc-list :lang=zh | wc -l   => 0           # 一个中文字体都没有

# 代码探测的 11 个 CJK 字体路径逐一检查 => 全部 MISS
MISS  /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
MISS  /usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc
MISS  /usr/share/fonts/truetype/wqy/wqy-microhei.ttc
... (其余 8 个同样 MISS)

# 是否安装了中文字体包？
dpkg -l | grep -iE 'fonts-(noto|wqy|cjk|source-han|arphic)'  => NO_CJK_FONT_PACKAGES
```

**运行时日志**（`/root/ecliptrix/backend-services/basic-service/logs/app.log` 与 systemd `ecliptrix-backend`，时间戳 2026-06-02 23:38:30，为今天的真实导出）：

```
subtitle_service - _get_font_path:482 - Chinese characters detected, prioritizing Chinese fonts
subtitle_service - Searching for default fonts, checking 14 font paths
subtitle_service - Font search priority: NotoSansCJK-Regular.ttc, NotoSansCJK-Regular.ttc, NotoSansCJK.ttc
subtitle_service - Found suitable font (#12/14): /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
subtitle_service - _get_font_path:521 - Font selection result: Using 'DejaVuSans.ttf' for Chinese subtitle rendering
```

**实际执行的 FFmpeg 命令**（日志原文，已证明 `fontfile` 指向拉丁字体）：

```
ffmpeg -i static/video/composed/composed_8ed9c046-...-c4c33a.mp4 \
  -vf "drawtext=textfile=/tmp/ecliptrix_subs_xxx/sub_1.txt:\
       fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf':\
       fontsize=40:fontcolor=#FFFFFF:borderw=2:bordercolor=#000000:\
       x=(w-text_w)/2:y=h-text_h-50:enable='between(t,0.39,12.07)':box=1:boxcolor=#000000@0.5:boxborderw=5, ...(sub_2, sub_3 同样用 DejaVuSans.ttf)" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a copy -y \
  static/video/subtitled/composed_8ed9c046-..._subtitled_1780414710.mp4
```

> 结论链：**系统无 CJK 字体（fc-list=0，11 路径全 MISS，无字体包）** → `_get_font_path` 回退到 `DejaVuSans.ttf`（#12/14） → FFmpeg `drawtext fontfile='.../DejaVuSans.ttf'` 画中文 → DejaVu 无 CJK 字形 → 成片字幕全是方框。证据齐全，非推测。

### 3.4 为什么部署后会反复出现（部署侧根因）

部署脚本安装了 ffmpeg，但**从不安装任何中文字体包**，因此每台全新 Ubuntu 机器都会复现：

- `ops/_sysdeps_install.sh:22-30`：`apt install` 列表含 `ffmpeg`，无 `fonts-noto-cjk` / `fonts-wqy-*`。
- `ops/install-deps.sh:96-109`：`PKGS=(... ffmpeg nginx ...)`，无任何 CJK 字体。
- 根目录 `install.sh`：仅在缺 ffmpeg 时打印手动安装提示，完全不涉及字体。
- 既有文档 `backend-services/basic-service/docs/apis/video_compose_chinese_subtitle_fix.md:95-110` 已明确写出"系统需 `apt-get install fonts-noto-cjk fonts-wqy-microhei`"，但该要求**从未落进任何自动化部署脚本**——属于"文档说了、脚本没做"的缺口。

仓库内也**没有内置任何 CJK 字体文件**（全仓 `*.ttf/*.ttc/*.otf` 仅 `node_modules` 里一个拉丁 Noto，不相关），且无字体路径的环境变量覆盖，因此运行时完全依赖系统字体存在与否。

---

## 4. 影响面（Impact surface）

- **受影响功能**：所有"烧录式"字幕输出——
  - 视频编辑器"导出视频"（时间轴含字幕）；
  - 工作流 `VideoExport` 节点；
  - `/api/audio/subtitle/add`（`SubtitleService.add_subtitles`）单独烧字幕。
- **受影响内容**：任何含中文（及其他 CJK：日文汉字/繁体）的字幕文本。纯英文/拉丁字幕不受影响（DejaVu 能正常渲染）。
- **受影响用户/环境**：**所有在该生产服务器（及任何用本仓库部署脚本搭建的 Ubuntu 机器）上导出中文字幕的用户**。本地 Windows/macOS 开发机不受影响（系统自带微软雅黑/PingFang，`_get_font_path` 会命中中文字体），所以问题"本地正常、线上乱码"。
- **数据安全**：无数据损坏，纯渲染缺陷；但成片不可用，需重新导出。

---

## 5. 候选修复方案对比（Candidate fixes）

| # | 方案 | 改动点 | 侵入性 | 风险 | 工作量 | 是否解决"复现" | 是否防"再次部署复发" |
|---|------|--------|--------|------|--------|----------------|----------------------|
| **A** | **服务器安装 CJK 字体 + 写进部署脚本** | 在 `ops/_sysdeps_install.sh`、`ops/install-deps.sh` 的 apt 列表加入 `fonts-noto-cjk`（可选再加轻量 `fonts-wqy-microhei`）；线上立即 `apt-get install -y fonts-noto-cjk && fc-cache -f` 后重启 backend | 低（仅 ops 脚本 + 一次运维） | 低 | 小 | ✅ 立即 | ✅ 是 |
| **B** | **仓库内置 CJK 字体 + 代码优先使用** | 在 `backend-services/.../assets/fonts/` 放一个 OFL 字体（如 wqy-microhei ~5–15MB 或 Noto CJK 子集），`_get_font_path` 优先返回该内置路径（或经环境变量 `SUBTITLE_CJK_FONT` 指定） | 中（代码 + 二进制资产） | 中（仓库体积、字体许可需 OFL） | 中 | ✅ | ✅ 与系统无关，最"部署无关" |
| **C** | **加固 `_get_font_path`：中文文本下不再静默回退拉丁字体 + 用 fontconfig 动态发现** | 检测到中文时不把 `latin_fonts` 混入候选；若只剩拉丁字体则 `fc-match :lang=zh`/记 ERROR 而非静默使用；用 `fc-list/fc-match` 替代硬编码路径以适配不同发行版 | 中（仅 `subtitle_service.py`） | 低–中（行为变化需测试） | 中 | ⚠️ 单独用不解决（无字体时仍无中文，只是从"乱码"变"报错/告警"） | ⚠️ 仅防"再次静默"，仍需 A/B 提供字体 |

补充说明：
- **方案 A 无需改任何业务代码**：`fonts-noto-cjk` 在 Ubuntu 24.04 会安装到
  `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`——**恰好是 `_get_font_path` 列表里的第 1 个候选**（`subtitle_service.py:456`），装上并 `fc-cache` 后，下一次导出会自动命中它。`fonts-wqy-microhei`（路径 `subtitle_service.py:461`，#5 候选）同理且体积更小（~5MB）。
- `fonts-noto-cjk` 体积较大（约数百 MB，含中日韩全字重）；若在意磁盘/安装时长，可只装 `fonts-wqy-microhei`，两者其一即可消除方框。
- 方案 C 是"防御性加固"：它让"缺字体"从**静默产出垃圾成片**变成**显式报错/告警**，从而避免本类问题再被掩盖；但它不"凭空"提供中文字形，必须与 A 或 B 搭配。

---

## 6. 推荐方案（Recommended fix）及理由

**主修复 = 方案 A**：在两个部署脚本（`ops/_sysdeps_install.sh`、`ops/install-deps.sh`）的 apt 安装列表中加入 `fonts-noto-cjk`（推荐，覆盖最全；如需控制体积可改/加 `fonts-wqy-microhei`），并在当前生产机立即执行：

```bash
apt-get update && apt-get install -y fonts-noto-cjk fonts-wqy-microhei
fc-cache -f
systemctl restart ecliptrix-backend     # 让新字体在下次导出生效
# 验证：fc-list :lang=zh | wc -l  应 > 0
```

**强烈建议同时实施方案 C 的最小子集（防回归）**：在 `_get_font_path` 中，当 `has_chinese=True` 且最终只能匹配到拉丁字体时，**记 ERROR 并明确告警**（而不是打印 "Using DejaVuSans for Chinese"），最好用 `fc-match` 动态发现已安装 CJK 字体以适配不同发行版/路径。这样即使将来又漏装字体，问题会"响"而不是"静默出方框"。

**理由**：
1. **直击根因且最小**：bug 的本质是"环境缺中文字体"。方案 A 直接补齐，且因为新字体落点正好命中代码现有的第 1 候选路径，**零业务代码改动**即可让线上立即恢复正常。
2. **满足用户的两点诉求**：用户要求"现在修好（可连生产）"且"以后部署别再犯"。方案 A 一次运维 + 写进部署脚本，既修当下又防复发——正是诉求 ①②。
3. **风险低、可回滚**：仅新增系统字体包，不动数据、不动合成逻辑；如有问题可单独卸载字体包。
4. **C 作为护栏**：把"静默回退拉丁字体"这一放大缺陷堵上，避免同类问题在未来部署/换机时再次以"无声乱码"形式出现，符合"确保以后不再出现"的目标。
5. **方案 B（内置字体）作为可选增强**：若团队希望成片渲染完全不依赖系统环境（例如多机、容器、最小镜像），可在 A 之上叠加 B；但 B 引入二进制资产与体积成本，非必需，故列为可选。

> 交接给 Subtask #2 落地时建议范围：① ops 两个脚本加 `fonts-noto-cjk`（+可选 `fonts-wqy-microhei`）；② 生产机执行上面三条命令并验证；③ 可选加固 `subtitle_service.py:_get_font_path` 的"中文却只剩拉丁字体"分支为显式告警/`fc-match` 动态发现。改动应保持最小，勿牵连无关文件。

---

## 7. 关键证据索引（便于评审复核）

代码：
- `backend-services/basic-service/app/services/subtitle_service.py:356`（`_get_font_path` 定义）
- `backend-services/basic-service/app/services/subtitle_service.py:453-470`（Linux `chinese_fonts` 11 个候选路径）
- `backend-services/basic-service/app/services/subtitle_service.py:472-477`（`latin_fonts`，含 `DejaVuSans.ttf`）
- `backend-services/basic-service/app/services/subtitle_service.py:480-482`（`default_fonts = chinese_fonts + latin_fonts`）
- `backend-services/basic-service/app/services/subtitle_service.py:518-524`（返回第一个存在的字体 → 命中 DejaVu）
- `backend-services/basic-service/app/services/subtitle_service.py:531`（"No suitable font found" 分支，因总能找到拉丁字体而**从不触发**）
- `backend-services/basic-service/app/services/subtitle_service.py:746-750`、`:863-867`（把 `fontfile=` 拼进 `drawtext`）
- `backend-services/basic-service/app/services/video_composition_service.py:1340`、`:2417`、`:2506`（合并烧录路径）、`:2209`、`:2310`（仅字幕烧录路径）
- 部署脚本缺字体：`ops/_sysdeps_install.sh:22-30`、`ops/install-deps.sh:96-109`、根 `install.sh`
- 既有文档已声明运行时字体要求却未自动化：`backend-services/basic-service/docs/apis/video_compose_chinese_subtitle_fix.md:95-110`

生产取证（2026-06-02，`47.84.198.68`，只读 SSH）：
- `fc-list :lang=zh | wc -l` → `0`
- 11 个 CJK 路径逐一 `test -f` → 全部 `MISS`
- `dpkg -l | grep fonts-(noto|wqy|cjk|...)` → `NO_CJK_FONT_PACKAGES`
- 日志：`Font selection result: Using 'DejaVuSans.ttf' for Chinese subtitle rendering`
- 日志：`Found suitable font (#12/14): /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`
- 日志中真实 ffmpeg 命令 `fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'`

---

## 8. 评审结论（Review Verdict）

> 本节由 Subtask #1（分析报告评审与修复）填写。评审人独立复核了全部被引代码、排查了替代解释、审计了候选方案的边界/回归，并补充了若干**决定性新证据**（见 §8.4）。结论：**根因成立、证据链闭合，推荐方案 A 为唯一修复主方案**（细节与精化见下）。

### 8.1 评审方法

不信任上游结论，逐条**重读被引源码行号**核对、**重连生产环境**复验、并**实证候选修复**的关键假设（"装包即命中现有候选路径"）。所有生产侧命令均为只读 / 非破坏性（仅 `apt-get download` 到 `/tmp` 后 `dpkg -c` 列内容，随即删除，**未实际安装任何包、未改动生产**）。

### 8.2 根因证据复核（逐条，均已独立核对 ✅）

| 报告主张 | 复核结果 |
|---|---|
| `_get_font_path` 定义在 `subtitle_service.py:356` | ✅ 行号准确 |
| Linux `chinese_fonts` 11 候选 `:453-470`，第 1 候选 = `NotoSansCJK-Regular.ttc`(`:455`)、第 5 = `wqy-microhei.ttc`(`:460`) | ✅ 准确 |
| `latin_fonts` `:472-477`，含 `DejaVuSans.ttf`(`:474`) | ✅ 准确 |
| 检测到中文时 `default_fonts = chinese_fonts + latin_fonts` `:480-482` | ✅ 准确 |
| 查找循环"返回第一个**存在**的字体" `:518-524`，无字体时回退 `:531` 永不触发 | ✅ 准确：拉丁字体恒存在，故 `:531` 的 `❌ No suitable font` 分支被旁路 |
| `fontfile=` 拼进 drawtext：标准 `:746-750`、竖屏 `:863-867`，入口 `build_drawtext_filters:573-609` | ✅ 准确；二者均以 `subtitle.text` 逐条做中文检测、以**绝对路径** `fontfile='...'` 注入 |
| 合成主流程：合并烧录 `video_composition_service.py:1340`、仅字幕 `:1382` | ✅ 准确；`build_drawtext_filters` 调用点在 `:2506`，`add_subtitles` 调用点在 `:2292-2310` |
| 部署脚本只装 ffmpeg、不装中文字体：`ops/_sysdeps_install.sh:23-30`、`ops/install-deps.sh:96-109` | ✅ 准确，两脚本均无 `fonts-*` |
| 既有文档已声明字体要求却未自动化：`video_compose_chinese_subtitle_fix.md` | ✅ 准确，见 `:103-109`（手动 `apt-get install fonts-noto-cjk` / `fonts-wqy-microhei`）与 `:132`（**期望**日志命中 `#1 NotoSansCJK-Regular.ttc`） |

**结论**：被引代码确实位于失败路径，证据与症状（缺字形方框 / `.notdef`）一一对应，**根因成立**。

### 8.3 反例与替代解释排查（已逐一排除）

1. **是否存在另一条字幕烧录路径（libass / `subtitles=` 滤镜 / ASS）绕过 `_get_font_path`？** —— 否。全 `app/` 仅 `drawtext` 一种烧录机制；`audio_router.py` 中的 `subtitles=` 只是**响应字段**而非 ffmpeg 滤镜。故 DejaVu 回退是**唯一且普适**的失败点，不存在反例路径。
2. **是否是编码乱码（mojibake）而非缺字形？** —— 否。临时文本以 `encoding='utf-8'` 写入（`:738`、`:856`），且症状是等宽**方框**（`.notdef`）而非错字 / 问号，正是"字体缺目标字形"的特征，非编码问题。
3. **是否 ffmpeg 缺 freetype/fontconfig？** —— 否。drawtext 已成功渲染出方框，证明 freetype 链路正常，仅所选字体无 CJK 字形。
4. **是否字号 / 颜色 / 透明导致不可见？** —— 否，方框清晰可见、数量与汉字数一致。

### 8.4 评审补充证据（决定性，评审人 2026-06-02 实测于 `47.84.198.68`）

> 这些是原报告"推断"但未实证、而方案 A 的成立**完全依赖**的关键事实，评审予以实证补全，使证据链闭合：

- **Bug 当前仍 live**：`fc-list :lang=zh | wc -l → 0`（再次复验，至今无任何 CJK 字体）。
- **回退字体确实存在、CJK 候选确实缺失**：`/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf` → `EXIST`；候选 #1 `NotoSansCJK-Regular.ttc` 与 #5 `wqy-microhei.ttc` → 均 `MISS`；`dpkg -l | grep fonts-(noto|wqy|cjk|...)` → `NO_CJK_PKG`。
- **"装包即命中现有候选路径"已被证明（而非假设）** —— 服务器侧 `apt-get download` 后 `dpkg -c` 列出包内文件：
  - `fonts-noto-cjk` 安装 `./usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc` → **正是 `_get_font_path` 候选 #1（`subtitle_service.py:455`）**；同包还含 `NotoSerifCJK-Regular.ttc` → 命中 serif 家族候选 #1（`:491`）。安装体积 ~91MB（下载 61MB）。
  - `fonts-wqy-microhei` 安装 `./usr/share/fonts/truetype/wqy/wqy-microhei.ttc` → **正是候选 #5（`subtitle_service.py:460`）**。安装体积 ~5MB（下载 1.6MB），`apt-get install -s` 显示可干净安装。
- **本生产机的"真正部署路径"已定位**：`ops/_ssh_run_sysdeps.py` 把 `ops/_sysdeps_install.sh` 上传并以 `systemd-run` 运行 —— 因此 **`_sysdeps_install.sh` 才是该生产机的权威 provisioner**，"防复发"的字体行必须落到此脚本（`install-deps.sh` 为 web-deployer 备用脚本，建议同步加上以防换路径部署）。全仓 grep 确认**当前没有任何脚本安装字体或执行 `fc-cache`**。
- **修复无需重启 / `fc-cache`（最小化精化）**：`_get_font_path` 为普通方法、**无 `lru_cache`/模块级缓存**，每次导出按 `os.path.exists` 实时重判（`:518-524`）；且 drawtext 用**绝对** `fontfile=` 直接读文件、**不经 fontconfig**。故只要字体文件落盘，**下一次导出即自动命中**，`systemctl restart` 与 `fc-cache -f` 均非必需（保留亦无害，作为兜底）。

### 8.5 候选方案审计（边界 / 最小化 / 回归）

**方案 A（安装 CJK 字体 + 写进部署脚本）—— 采纳为主方案**
- *是否最小且直击根因*：是。根因即"环境缺中文字体"；装包后新字体精确落在代码现有第 1 候选路径，**零业务代码改动**即恢复正常。
- *边界*：并发——字体选择为只读 `os.path.exists`、无共享可变态，线程安全；装包为一次性幂等 apt 操作。错误路径——装包后"缺字体"条件消失。
- *回归*：对**英文/拉丁字幕**无影响——非中文时 `default_fonts = latin_fonts + chinese_fonts`，DejaVu 仍为 #1，渲染不变；唯一新效果是中文不再是方框。无逻辑改动 ⇒ 无行为回归。代价仅磁盘 +91MB（noto）/+5MB（wqy）。

**方案 B（仓库内置字体）—— 列为可选增强，本次不采纳**
- 价值：渲染彻底脱离系统环境（适合多机/容器/最小镜像）。代价：引入二进制资产 + 仓库体积 + OFL 许可合规，非必需。可在 A 之上按需叠加。

**方案 C（加固 `_get_font_path`）—— 采纳其"最小护栏子集"，但须修正实现方向以免引入回归**
- *单独不解决 Bug*：无字体时它不"凭空"产生字形，只把"静默出方框"变成"显式告警"，必须与 A 搭配。
- ⚠️ **回归红线（评审强调）**：C 的加固**绝不能**让中文文本在只剩拉丁字体时 `return None`。一旦返回 `None`，`:747`/`:864` 的 `if font_path:` 为假 → drawtext **不带 `fontfile=`** → ffmpeg 退回 fontconfig 默认 `Sans`（在无 CJK 机器上仍解析为 DejaVu → **照样方框**），更糟者在合并烧录路径可能令该 ffmpeg pass 直接失败、**拖垮整次导出**。故 C 的正确最小形态是：**仍返回可渲染字体以保证出图**，同时在"中文却只命中拉丁字体"时**记 `ERROR` 显式告警**（替换当前误导性的 `Using DejaVuSans for Chinese` info 日志），可选用 `fc-match :lang=zh` 动态发现已装 CJK 字体以适配不同发行版路径。
- *边界遗留（记录但不在本 Bug 范围内）*：`_contains_chinese`（`:327-354`）仅覆盖**汉字（Han）区段**，不含**假名 / 谚文**；纯日文假名或纯韩文谚文字幕会被判为 `has_chinese=False` → 仍优先拉丁字体 → 即便装了 noto 也会方框。这是先于本 Bug 的潜在缺陷，本次不扩范围；未来可在 C 中放宽检测或把 CJK 字体作为"拉丁 `.notdef` 之前"的通用兜底。

### 8.6 最终推荐修复（单一主方案 + 理由）

> **唯一修复主方案 = 方案 A**：在生产机安装 CJK 字体，并把该安装写进**真正运行的** provisioner，使本次修好、且**今后任何全新部署都自带中文字体**。

**精确落地（交接 Subtask #2，改动须最小、勿牵连无关文件）：**

1. **改部署脚本（防复发，核心）**：在 `ops/_sysdeps_install.sh` 的 apt 安装段（`:23-30`，**该机权威 provisioner**）加入中文字体包；并同步在 `ops/install-deps.sh` 的 `PKGS`（`:96-109`）加入，避免换部署路径时漏装。
   - 字体包二选一即可消除方框；推荐**单装 `fonts-noto-cjk`**（覆盖最全：sans+serif、SC/TC/JP/KR，且精确命中候选 #1）。**若在意镜像体积/安装时长**，改用**轻量 `fonts-wqy-microhei`（~5MB，命中候选 #5）**。**无需两者都装**（冗余）。
2. **修当前生产机（立刻生效）**：
   ```bash
   apt-get update && apt-get install -y fonts-noto-cjk     # 或仅 fonts-wqy-microhei
   # 验证：fc-list :lang=zh | wc -l   应 > 0
   ```
   —— 装包后**下一次导出即自动命中**（`_get_font_path` 实时 `os.path.exists`，无缓存）；`fc-cache -f` 与 `systemctl restart ecliptrix-backend` **非必需**，如求稳可保留为兜底。
3. **（强烈建议、非阻断）方案 C 最小护栏**：把 `_get_font_path` 中"`has_chinese=True` 却只能匹配到拉丁字体"的分支由"静默 info"改为"**显式 `ERROR` 告警**"（可选叠加 `fc-match` 动态发现）。**严禁改为 `return None` 或硬失败**（见 §8.5 回归红线）。此项确保"将来再漏装字体"时问题**会响**而非**无声出方框**，正面回应用户"以后部署别再犯"的诉求。

**理由汇总**：
1. **直击根因且零代码即可恢复**：Bug 本质是环境缺字体；A 补齐后新字体精确落在现有候选 #1，已实证（§8.4），无需改业务代码。
2. **同时满足用户两点诉求**：① 现在修好（可连生产，一条 `apt-get install`）；② 写进真正运行的 `_sysdeps_install.sh`，今后全新机器自带字体、不复发。
3. **风险低、可回滚**：仅新增系统字体包，不动数据 / 合成逻辑 / 英文字幕渲染；如需可单独卸载。
4. **护栏 C 堵住放大缺陷**：把"静默回退拉丁字体"从"无声产出垃圾成片"变为"显式告警"，杜绝同类问题再以无声形式复发；但必须按 §8.5 的安全方向实现，避免把渲染改成硬失败。

### 8.7 Definition of Done 自检

- [x] 证据链闭合：根因代码已逐行独立核对，失败路径唯一（无 libass 反例），生产侧关键假设（装包→命中候选 #1/#5）已由 `dpkg -c` 实证。
- [x] Review Verdict 给出**单一**推荐主方案（A）并附明确理由与精确落地清单。
- [x] 仅修改 `analysis.md`；未写修复代码、未 `git commit`（留待 Subtask #2/#3）。
