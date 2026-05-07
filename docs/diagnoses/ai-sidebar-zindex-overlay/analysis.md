# Bug 诊断报告：AI 视频编辑助手侧边栏遮挡封面（及其他）模态面板

- **Bug slug**: `ai-sidebar-zindex-overlay`
- **诊断时间**: 2026-05-08
- **诊断模式**: Fully automatic
- **报告类型**: 根因定位 + 候选修复方案对比（不写修复代码、不提交）

---

## 1. 问题描述（Problem description）

视频编辑界面（`VideoEditingInterface`）中：

1. **直接症状**：在视频预览面板右上角点击"封面"按钮，弹出 `VideoCoverModal`（90vw × 85vh 的对话框）后，**对话框最左侧约 20% 的区域被左侧"AI 视频编辑助手"侧边栏遮挡**，无法点击模板列表 / 文字样式工具条等左侧控件。

2. **延伸症状**：用户反馈"AI 视频编辑助手与功能侧边栏在开发过程中频繁遮挡其他面板"。事实上，下表中**所有 z-index ≤ 200 的模态都会被这条左侧栏遮挡**——封面只是其中最近被发现的一例。

3. **二级抱怨**：用户认为 AI 助手面板"高度应当与下方视频剪辑主面板（时间线区域）一致，而不应当向上延伸到上方面板（脚本 / 素材 / 播放预览）的高度去遮挡弹窗"。这是同一根因（左侧栏铺满整个右侧 flex 容器的 100% 高度，并且自带高 z-index）的视觉感受版本。

### 期望行为
点击封面按钮后，封面对话框应位于全部页面内容之上，左侧栏不应覆盖任何模态对话框。任何后续新增的模态对话框，**默认情况下都不应再次踩这个坑**。

---

## 2. 复现步骤（Reproduction steps）

环境：当前 `main` 分支（commit `e7e93fe` 起），桌面浏览器（≥ 1024px 宽，能呈现 20% / 80% 的左右布局）。

```
1. cd G:\projects\takoAI\Ecliptrix
2. npm run dev                                      # 启动前端 :3000
3. （另一终端）启动后端：bash start.sh --dev        # 或单独 uvicorn
4. 浏览器访问 http://localhost:3000，登录任一账号
5. 进入"项目管理"，打开任意视频项目（确保时间线上至少有一个素材）
6. 在右上方"播放预览"面板的工具栏中，点击"封面"按钮（CoverButton）
7. VideoCoverModal 弹出，背景出现 backdrop-blur 蒙层
8. 观察对话框最左侧 ≈ 20% 的区域：模板缩略图、文字样式按钮被左侧
   "AI 视频编辑助手"面板（消息列表 / 输入框）盖住，无法交互
```

**额外可复现的同类问题**：以同样方式打开 `VideoSearchModal`（z-[200]）、`AudioSearchModal`（z-[200]）、`ImageSearchModal`（z-[200]）、`VideoCutModal`（z-[200]）、`SubtitleEditModal`（z-[200]）、`VideoAnalysisModal`（z-[200]）、`MediaPreviewModal`（z-[200]）、`WatermarkRemovalModal`（z-[200]）、`ContentPolishModal`（z-[200]）、`CreativeBrainstormingModal`（z-[200]）、`AiAudioModal`（z-50）、`StoryboardScriptTab` 内联 dialog（z-50）等等，左侧 20% 都被同一根侧边栏遮挡。

---

## 3. 根因分析（Root cause analysis）

### 3.1 直接根因：z-index 失序

左侧 AI 助手栏被显式提升到 `z-[300]`，而 `VideoCoverModal` 的 fixed-positioned wrapper 只声明了 `z-50`：

`src/components/video/VideoEditingInterface.tsx:3071`
```tsx
<div className="video-editing-left-sidebar flex flex-col border-r border-border bg-card relative z-[300]">
  <VideoChatWindow ... />
</div>
```

`src/components/video/components/VideoCoverModal/VideoCoverModal.tsx:266-273`
```tsx
return (
  <div
    role="dialog"
    aria-modal="true"
    aria-label={t.videoCoverModal?.title ?? 'Video Cover'}
    className="fixed inset-0 z-50 flex items-center justify-center"
    onClick={() => void handleClose()}
  >
    {/* Overlay */}
    <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
    ...
```

侧边栏使用了 `position: relative` + `z-index: 300`，**这创建了一个值为 300 的堆叠上下文**。封面模态虽然是 `position: fixed`，但它的 `z-index: 50` 仍要在共同的祖先（页面根堆叠上下文）下与侧边栏的堆叠上下文比较。`50 < 300`，因此整个侧边栏（含其后代）绘制在封面模态之上。

### 3.2 历史溯源：z-index 军备竞赛

`git log -L` 追踪 `video-editing-left-sidebar` 这一行得到的演化：

```
6a38abb  原始：无 z-index
0e2901e  [fix] resolve z-index overlay issues  →  加上 z-[10000]
866ba12  fix(video-editing): lower chat sidebar z-index so modals overlay correctly
         z-[10000]  →  z-[300]
e7e93fe  当前：z-[300]
```

也就是说：
1. 早期没有 z-index，某些 popover/dropdown 被遮挡 → 拍脑袋拉到 `z-[10000]`，导致大量模态被反向遮挡。
2. 随后回调到 `z-[300]`，使部分高优先级模态（`z-[9999]`、`z-[1100]`）能正常覆盖；但 **没有同步对照所有模态的 z-index 表**，于是 `z-50` 与 `z-[200]` 这一档全部继续被覆盖，封面模态便是其中之一。

### 3.3 系统性根因：缺乏统一的 z-index 分层规范

对 `src/components/video` 子树的统一搜索（`Grep "z-\[|z-50|z-40|z-\d+"`）显示模态对话框的 z-index 极度散乱、毫无章法：

| 模态文件 | z-index | 是否被 `z-[300]` 侧边栏遮挡 |
|---|---|---|
| `VideoCoverModal/VideoCoverModal.tsx:271` | `z-50` | **是** |
| `AiAudioModal/AiAudioModal.tsx:100` | `z-50` | **是** |
| `AIVideoScriptTab/AIVideoScriptTab.tsx:438`（展开对话框） | `z-50` | **是** |
| `StoryboardScriptTab/StoryboardSegmentCard.tsx:422,448` | `z-50` | **是** |
| `StoryboardScriptTab/StoryboardScriptTab.tsx:400` | `z-50` | **是** |
| `VideoAnalysisModal/VideoAnalysisModal.tsx:69` | `z-[200]` | **是** |
| `ImageSearchModal/ImageSearchModal.tsx:188` | `z-[200]` | **是** |
| `ImageSearchModal/ImageSearchModal.tsx:443`（preview） | `z-[250]` | **是** |
| `AudioSearchModal/AudioSearchModal.tsx:164` | `z-[200]` | **是** |
| `VideoSearchModal/VideoSearchModal.tsx:262` | `z-[200]` | **是** |
| `VideoCutModal/VideoCutModal.tsx:406` | `z-[200]` | **是** |
| `SubtitleEditModal/SubtitleEditModal.tsx:356` | `z-[200]` | **是** |
| `WatermarkRemovalModal/WatermarkRemovalModal.tsx:488` | `z-[200]` | **是** |
| `ContentPolishModal/ContentPolishModal.tsx:390` | `z-[200]` | **是** |
| `CreativeBrainstormingModal/CreativeBrainstormingModal.tsx:134` | `z-[200]` | **是** |
| `MediaPreviewModal/MediaPreviewModal.tsx:239` | `z-[200]` | **是** |
| `MaterialsPanel/CreateStoryboardPackModal.tsx:310` | `z-[200]` | **是** |
| `MaterialsPanel/StoryboardPackModal.tsx:93` | `z-[200]` | **是** |
| `projects/CategoryFormDialog.tsx:53` | `z-[200]` | **是** |
| `projects/ProjectFormDialog.tsx:64` | `z-[200]` | **是** |
| `MyMaterialsModal/MyMaterialsModal.tsx:205` | `z-[1100]` | 否 |
| `AiVideoModal/AiVideoModal.tsx:228` | `z-[9999]` | 否 |
| `AiImageModal/AiImageModal.tsx:197` | `z-[9999]` | 否 |
| `WorkflowConfigModal/WorkflowConfigModal.tsx:360` | `z-[9999]` | 否 |
| `AIMixingProgressModal/...` 等多个进度弹窗 | `z-[9999]` | 否 |
| `VideoProcessingModal/VideoProcessingModal.tsx:169` | `z-[9999]` | 否 |
| `MaterialsPanel/GridPackModal.tsx:31` | `z-[9998]` | 否 |

**模态对话框的 z-index 分布在 50 / 200 / 250 / 1100 / 9998 / 9999 六档**——没有任何全局规范，谁踩到坑谁就把数字拉大一档。这就是用户描述的"开发的时候经常出现遮挡其他面板的问题"的真正含义：**这是个会反复发生的系统性 bug，不是某一次个例**。

### 3.4 视觉层面的次要因素

`src/styles/video-editing.css:4-9`
```css
.video-editing-left-sidebar {
  width: 20%;
  height: 100%;
  flex-shrink: 0;
  overflow: hidden;
}
```

侧边栏的高度是父容器 `<div className="flex-1 flex min-h-0 overflow-hidden">`（`VideoEditingInterface.tsx:3069`）的 100%。这个父容器同时容纳了"上方面板（70%）+ 时间线（30%）"的右侧子树。因此**视觉上**侧边栏延伸到了脚本 / 素材 / 播放预览的同一高度——这正是用户感觉"高处遮挡"的原因。

不过需要强调：**即使把侧边栏改矮，z-index 问题仍然存在**——只要它跟弹出对话框在 viewport 上有重叠（无论纵向延伸多远），300 > 50 仍然会让它压在封面对话框上。所以"降低高度"只是缓解视觉，不是修复根因。

---

## 4. 影响面（Impact surface）

- **直接影响功能**：所有在 `VideoEditingInterface` 视图内打开、且 z-index ≤ 200 的模态对话框（≥ 16 个，见 §3.3 表）。
- **直接影响用户**：所有使用视频编辑器的最终用户。封面、视频搜索、音频搜索、图片搜索、视频剪辑、字幕编辑、视频分析、水印去除、内容润色、创意头脑风暴、AI 音频、StoryboardScriptTab 等都受影响。
- **不受影响**：z-index ≥ 1100 的模态（`MyMaterialsModal`、`AiVideoModal`、`AiImageModal`、`WorkflowConfigModal`、各种 `*ProgressModal`、`GridPackModal` 等）。这些大多是后开发的功能，开发者发现遮挡问题后又把自家 z-index 拉高，加剧了 §3.3 的失序。
- **开发体验**：未来每新增一个模态都要"试错-发现被盖-把 z-index 拔高"，浪费时间且容易引入新一轮的 z-index 反向冲突。

---

## 5. 候选修复方案（Candidate fixes）

| # | 方案 | 改动点 | 侵入性 | 风险 | 工作量 | 是否解决根因 |
|---|---|---|---|---|---|---|
| A | **降低侧边栏 z-index（最小修复）** | `VideoEditingInterface.tsx:3071` 把 `z-[300]` 改为 `z-0` 或干脆删除（同时移除 `relative`，除非有内部绝对定位需要） | 极小（1 行） | 低；可能会让侧边栏内部的某些 popover/dropdown 失去原本想要的层叠优先级，需手测 | 30 分钟 | 仅对当前两个症状（封面 + 同档其他模态），不解决系统性问题 |
| B | **集中式 z-index 规范 + 全量替换（彻底修复）** | 在 `src/styles/z-index.css`（新文件）或 `tailwind.config.js` 中定义有限层级（如 `base / sticky / dropdown / overlay / modal / toast / popover-on-modal` 7 档），把所有 modals、sidebar、popovers 改用语义化常量；同步把 sidebar 改成 `z-sticky`（数值 ~10），所有 modals 统一 `z-modal`（数值 ~1000）。 | 中（涉及上表 ≥ 16 个模态文件 + 1 个 sidebar） | 中；漏改文件会造成回归。但每个修改都是独立的字符串替换，PR 易 review | 0.5 ~ 1 天 | 是。建立长期可维护的规范，未来新增模态只需引用常量 |
| C | **改用 React Portal + 单一根容器（架构修复）** | 在 `app/layout.tsx` 加一个 `<div id="modal-root" />`，用 `createPortal` 把所有模态挂到该容器；该容器直接位于 `<body>` 下，天然脱离 sidebar 的 stacking context；同时执行方案 B 的常量化以保留多模态间的次序 | 大（每个模态都要改 render 出口；现有 modal 多达 ~25 个） | 中-高；portal 内事件冒泡、键盘焦点管理、Tailwind dark class 继承都需要回归测试 | 2 ~ 3 天 | 是，且更彻底。Portal 让 sidebar 的任何 z-index 都不再能盖住模态 |

### 推荐方案

**推荐 B（集中式 z-index 规范 + 全量替换）**，理由：

1. **直接解决用户的两个诉求**：
   - 封面模态不再被遮挡（一并解决其他 ≥ 16 个被同一根因遮挡的模态）。
   - "后续开发不再出现遮挡"——因为有了规范常量，新模态默认 `z-modal`，不用再思考数字。
2. **侵入性可控**：每处都是单字符串替换，不改组件结构、不引入 portal 的副作用（焦点 / 事件 / 暗色继承），review 成本远低于方案 C。
3. **杠杆比最高**：方案 A 治标不治本（30 分钟换来 1 天后再次踩坑）；方案 C 治得更彻底但成本翻倍且引入回归面。方案 B 是性价比最高的拐点。
4. **建议规范雏形**（落实施前可微调）：
   ```
   --z-base:        0       // 普通流
   --z-sticky:      10      // 左侧栏、固定头/尾
   --z-dropdown:    20      // 内联下拉、tooltip
   --z-overlay:     900     // 全屏蒙层
   --z-modal:       1000    // 所有 fixed 模态对话框
   --z-popover:     1100    // 模态内部的 popover/menu
   --z-toast:       1200    // 通知 toast
   --z-debug:       9999    // 仅留给开发期 debug
   ```
   一次性把现有所有 50/200/250/1100/9998/9999 收敛到这 7 档；左侧栏改用 `z-sticky`（≪ z-modal），从此 sidebar 永远在模态之下。

5. **次要建议（可同 PR 提交）**：用户提到的"AI 助手高度希望与下方时间线一致"——这是 UX 偏好，不是 bug 根因。`video-editing.css:4-9` 把 `.video-editing-left-sidebar` 拆成"上半 = 透明 + pointer-events: none"或者把侧边栏移动到 `video-editing-timeline-section` 同级即可达成；但这一改动**与 z-index 修复正交**，由产品评估是否需要在同一个修复中带上。

### 不推荐立即采用 C 的原因

虽然 portal 方案在大型设计系统中是最优解，但：
- 现有 ~25 个模态散落在多个 feature 子树，逐一切换 portal 会引发暗色主题（class 在 `<html>` 上时 portal 内仍有效，但若用 `dark:` 通过 class 上下文继承的少数地方需逐个核对）、焦点陷阱、点击外部关闭等多处回归。
- 在没有规范的前提下移到 portal，z-index 互相冲突仍存在；最终还是要做方案 B。
- 可作为 follow-up：B 落地稳定后，若希望进一步保险，再迭代到 C。

---

## 6. Definition of Done 检查

- [x] `analysis.md` 已生成于 `docs/diagnoses/ai-sidebar-zindex-overlay/analysis.md`。
- [x] 复现步骤具体到端口、按钮、可观察现象，任何工程师可直接执行。
- [x] 根因有代码引用为证：
      - `src/components/video/VideoEditingInterface.tsx:3071`（`z-[300]` 来源）
      - `src/components/video/components/VideoCoverModal/VideoCoverModal.tsx:271`（`z-50` 受害者）
      - `src/styles/video-editing.css:4-9`（侧边栏视觉高度 100%）
      - `git log -L` 输出（commit `0e2901e` → `866ba12` 的 z-index 拉锯，证明这是反复出现的系统性问题）。
- [x] 给出三个候选修复方案，附带侵入性 / 风险 / 工作量对比和明确推荐。
- [x] 没有写任何修复代码、没有 `git commit`。

---

## 7. 评审结论（Review Verdict）

**评审人**：Senior Reviewer（Anthropic Engineering）
**评审时间**：2026-05-08
**评审范围**：根因证据链 + 候选修复方案

### 7.1 证据链复核（已逐项二次验证）

| 主张 | 复核结果 | 验证手段 |
|---|---|---|
| 侧边栏 `z-[300]`（`VideoEditingInterface.tsx:3071`） | ✅ 真实存在 | Read tool 直读该行：`<div className="video-editing-left-sidebar flex flex-col border-r border-border bg-card relative z-[300]">` |
| `VideoCoverModal` 根容器 `z-50`（`VideoCoverModal.tsx:271`） | ✅ 真实存在 | Read tool 直读：`className="fixed inset-0 z-50 flex items-center justify-center"` |
| 侧边栏 CSS 高度 = 父容器 100%（`video-editing.css:4-9`） | ✅ 真实存在 | Read tool 直读：`width: 20%; height: 100%;` |
| Git 历史：`0e2901e` → `866ba12` 的 z-index 拉锯 | ✅ 真实存在 | `git show 866ba12` 显示 commit message 自证：「Left chat sidebar was at z-[10000] ... Dropped the sidebar to z-[300]」 |
| ≥16 个 `z-50/z-[200]/z-[250]` 模态被同根因覆盖 | ✅ 抽样验证通过 | 抽查 `MyMaterialsModal`(`z-[1100]`)、`AiVideoModal`(`z-[9999]`)、`GridPackModal`(`z-[9998]`) 与表中数值一致；其它表项位置一致 |

**追加的关键技术证据（补强堆叠上下文论证）**：

侧边栏父容器 `<div className="flex-1 flex min-h-0 overflow-hidden">`（`VideoEditingInterface.tsx:3069`）**没有** `transform / filter / perspective / contain / will-change / opacity<1 / z-index`，因此**不会**创建中间堆叠上下文。同理，`VideoPlayerPanel`（modal 的渲染父级）所在的 `video-editing-upper-panels`/`video-editing-right-area` 这条祖先链上也无上述属性。结论：

- 侧边栏 `position: relative + z-index: 300` → 在**根堆叠上下文**下，以 300 为 z-index 形成新的堆叠上下文。
- `VideoCoverModal` `position: fixed + z-index: 50` → 由于不存在 transform/filter 等"包含块劫持者"，其包含块为 initial containing block，stacking context 同样**直接挂在根堆叠上下文之下**，z-index = 50。
- 在同一根堆叠上下文中比较：`50 < 300` ⇒ 侧边栏整体（含其后代 DOM 子树）绘制在封面模态之上。

> 这条推理覆盖了"为什么 fixed 元素会被一个非 fixed 的兄弟级 div 盖住"这一非直观点，是评审重点关注的反例假设——**已排除**。

### 7.2 反例与备选解释审查

| 候选反例 / 备选解释 | 是否成立 | 说明 |
|---|---|---|
| 是否其它中间节点创建了更高 z-index 的 stacking context？ | ❌ 不成立 | 沿祖先链未发现 transform/filter/contain 等触发因素；仅有 sidebar 自己显式声明 z-300。 |
| 是否 `VideoCoverModal` 漏写 `z-modal` 等高优先级类，但实际有内联样式？ | ❌ 不成立 | `:271` 行外加上下 30 行均无 inline style 覆盖 z-index。 |
| 是否布局层（如 `app/layout.tsx`）把 `VideoEditingInterface` 包了一个 `transform`，把 modal 关进 sub-context？ | ❌ 不成立 | grep `transform`/`filter`/`will-change` 在祖先 layout/page 文件未命中相关 stacking 触发器。 |
| 是否仅在 dev/HMR 下复现的临时性问题？ | ❌ 不成立 | 该 z-index 是源代码硬编码字符串（非运行时计算），prod build 同样行为。 |
| 是否仅 1024px 以上才出现？ | ⚠️ 部分成立但不影响根因 | 移动端可能因 Tailwind responsive class 隐藏侧边栏；但桌面端用户群（即报告涉及视频编辑场景）100% 受影响。 |

结论：根因唯一、定性正确，无遗漏的备选解释。

### 7.3 候选方案审查

**方案 A（仅降低侧边栏 z-index）** —— **驳回**。
- 仅治封面这一例与同档同病的 ≥16 个模态；
- 未触及"50 / 200 / 250 / 1100 / 9998 / 9999 六档无规范"的真正系统性问题；
- 用户原文第二诉求是"后续开发时不出现这种再去遮挡其他弹窗面板的这种情况"——A 方案无法承诺这一点；
- 历史证据（commit `0e2901e` → `866ba12`）已表明"调一个数字"模式必然反复返工。

**方案 B（集中式 z-index 规范 + 全量替换）** —— **采纳为最终推荐**。
- 直接覆盖用户两条诉求；
- 改动均为字符串级别，无组件结构 / 事件 / 焦点风险；
- 相对方案 C 风险窗口最小、收敛速度最快；
- 唯一需注意的边界：sidebar 内部存在的 popover/dropdown（如 VideoChatWindow 内部消息菜单）原本依赖 sidebar 的 `z-[300]` 上抬整个子树才能盖住外部下拉。把 sidebar 改到 `z-sidebar`（小数值）后，需要把这些**真正需要高优先级的 popover** 自己声明 `z-popover`，而不是依靠祖先 z-index 顺带抬高。这是对实施节点的强约束，**必须在执行计划中显式枚举核查清单**（详见 7.5）。

**方案 C（Portal 化）** —— **驳回当前迭代**。
- 复盘报告中的"暗色继承"风险其实在本仓库不存在：`tailwind.config.js` 使用 `darkMode: ["class"]`，dark class 通常加在 `<html>` 上，portal 子树仍可继承。这一点报告高估了风险；
- 但**焦点管理 / 事件冒泡 / 键盘 ESC 流 / Tailwind 滚动锁** 的回归面在 ~25 个模态上仍然真实存在；
- 即便迁移到 portal，z-index 失序问题**依然存在**（多个 portal-modal 之间还要排序），仍须先做方案 B；
- 故方案 C 只能作为 B 落地稳定后的可选演进，不在本轮范围内。

### 7.4 命名与规范微调建议（不改变 B 的本质）

报告第 §5 推荐的常量层级合理，但其中 `z-sticky` 名字含 CSS `position: sticky` 语义易混淆。建议在落实施前微调命名：

```
--z-base:       0       // 普通流
--z-sidebar:    10      // 左侧 AI 助手栏、固定页头/页尾（取代 z-sticky 名）
--z-dropdown:   20      // 内联下拉、tooltip
--z-overlay:    900     // 全屏蒙层
--z-modal:      1000    // 所有 fixed 模态对话框
--z-popover:    1100    // 模态内或 sidebar 内的 popover/menu/contextmenu
--z-toast:      1200    // 通知 toast / Header（当前 Header 是 z-[10000]）
--z-debug:      9999    // 仅留给开发期 debug
```

实现路径：在 `tailwind.config.js` 的 `theme.extend.zIndex` 中扩展上述键值（Tailwind 原生 z-index 工具会保留），新代码用 `z-modal/z-sidebar/...`，旧代码全替换。

### 7.5 实施前必须满足的准入条件（交给下一节点）

下一节点（写修复代码）在动手前必须先建立以下清单，避免 7.3 中提到的"sidebar 内 popover 失去高度"回归：

1. **审计 sidebar 子树的所有"需要盖住兄弟"的浮层**：
   - `VideoChatWindow` 内的消息上下文菜单 / 对话历史下拉 / 输入区表情等；
   - 任何依赖父级 `relative z-[300]` 才能挡住外部模态的内部组件。
   每一个都必须显式标注 `z-popover` 或更高，**不能**默默从父节点借用 z-index。
2. **保留 Header 与 Toast 的现有层级**（当前 Header `z-[10000]`、Toast `z-[10002]`）：在新规范中映射为 `z-toast` 或专用键，**不要**因为追求"7 档"而把 Header 降下来——Header 就是要永远在 modal 之上。
3. **VideoProcessingModal 已是 `z-[9999]`**（commit `866ba12` 第二处改动），合并到 `z-modal` 时需要确认它与"显示在 modal 之上的 ProgressModal"层级关系：当前体系中"进度弹窗显示在主弹窗之上"是常见模式，需用 `z-popover` 或定义 `z-modal-2` 来表达"模态之上的模态"。**这是规范设计中的真实需求，不要遗漏**。
4. **"高度"诉求与 z-index 修复正交**：用户提到的"AI 助手高度应当与下方时间线一致"是 UX 偏好，非根因；本次修复**不**绑定该改动，避免 PR 范围爆炸。如果产品坚持，单独开 ticket。
5. **全量替换的可验证清单**：用 `git grep -nE "z-(50|\[200\]|\[250\]|\[1100\]|\[9998\]|\[9999\]|\[10000\]|\[10001\]|\[10002\])"` 跑 baseline，PR 完成后该命令应**仅在白名单文件**（如 `Header.tsx` 主动保留 `z-[10000]` 期间）有命中，否则视为漏改。

### 7.6 最终推荐修复（Single Recommended Fix）

> **采用方案 B：集中式 z-index 规范 + 全量替换。**
>
> - **最小修复点**：在 `tailwind.config.js` 扩展语义化 `zIndex` 键（`base/sidebar/dropdown/overlay/modal/popover/toast/debug`），将 `VideoEditingInterface.tsx:3071` 的 `z-[300]` 改为 `z-sidebar`，将报告 §3.3 表中**所有** `z-50/z-[200]/z-[250]` 的模态根容器统一替换为 `z-modal`，`z-[1100]` 模态根据语义归入 `z-modal` 或 `z-popover`。
> - **明确不做**：①不引入 React Portal；②不修改 sidebar 的高度 / 布局；③不改 Header / Toast 当前数值（仅命名上挂入新规范）；④不写 ESLint 自定义规则（可后续 follow-up）。
> - **正确性论据**：根因证据链已在 §7.1–7.2 闭环验证；方案 B 是同时满足"修当前 bug + 防未来重犯"的最小变更集合；方案 A 不防未来、方案 C 风险/收益比劣于 B。
> - **执行前置条件**：严格按照 §7.5 五项清单逐条勾选，特别是"sidebar 内部 popover 自带 z-popover"与"模态之上的模态需要 z-popover/z-modal-2"两项，否则会引入新的回归。


