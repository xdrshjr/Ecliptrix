# Ecliptrix / 灵蚀创影

**光影交汇之处**

一个强大的内容创作平台，支持社交媒体内容生成、视频编辑、语音合成和创意头脑风暴，由人工智能驱动。

## 🌟 功能特性

- **内容创作**: 借助AI生成引人入胜的社交媒体内容
- **视频编辑**: 自动视频混剪和编辑功能
- **语音合成**: AI驱动的语音生成和音频处理
- **头脑风暴**: 创意构思和灵感工具
- **多标签界面**: 同时处理多个项目
- **苹果风格设计**: 简洁、优雅、直观的用户界面

## 🚀 快速开始

### 环境要求

- Node.js 18+ 
- npm 或 yarn 或 pnpm

### 安装步骤

1. 克隆仓库:
```bash
git clone <repository-url>
cd Ecliptrix
```

2. 安装依赖:
```bash
npm install
# 或
yarn install
# 或
pnpm install
```

3. 设置环境变量:
```bash
cp env.template .env.local
```
编辑 `.env.local` 文件，添加各种LLM提供商的API密钥。

4. 运行开发服务器:
```bash
npm run dev
# 或
yarn dev
# 或
pnpm dev
```

5. 在浏览器中打开 [http://localhost:3000](http://localhost:3000)。

## 🛠️ 技术栈

- **框架**: Next.js 15 with App Router
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **UI组件**: 苹果风格设计的自定义组件
- **状态管理**: React hooks 与自定义任务管理
- **代码检查**: ESLint with Next.js 配置

## 📁 项目结构

```
Ecliptrix/
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── layout.tsx       # 根布局
│   │   └── page.tsx         # 首页
│   ├── components/          # React 组件
│   │   ├── Header.tsx       # 头部组件
│   │   ├── Taskbar.tsx      # 任务管理栏
│   │   ├── Container.tsx    # 主内容区域
│   │   └── Footer.tsx       # 底部组件
│   ├── hooks/               # 自定义 React hooks
│   │   └── useTasks.ts      # 任务管理 hook
│   ├── lib/                 # 工具函数
│   ├── styles/              # CSS 样式
│   │   └── globals.css      # 全局样式
│   └── types/               # TypeScript 类型定义
│       └── index.ts         # 主要类型定义
├── public/                  # 静态资源
├── env.template            # 环境变量模板
├── next.config.js          # Next.js 配置
├── tailwind.config.js      # Tailwind CSS 配置
├── tsconfig.json           # TypeScript 配置
└── package.json            # 项目依赖
```

## 🎨 设计理念

Ecliptrix 遵循苹果的设计原则:

- **简洁性**: 简洁、整齐的界面
- **一致性**: 统一的设计模式
- **可访问性**: 键盘导航和屏幕阅读器支持
- **性能**: 流畅的动画和响应式交互
- **字体**: 系统字体以获得最佳可读性

## 🔧 配置

### 环境变量

应用程序支持多个LLM提供商。在 `.env.local` 文件中配置它们:

- **OpenAI**: 用于GPT模型
- **Anthropic**: 用于Claude模型  
- **Google**: 用于Gemini模型
- **Azure OpenAI**: 用于企业级OpenAI部署
- **自定义LLM**: 用于自托管或其他LLM提供商

### 自定义

- **主题**: 修改 `src/styles/globals.css` 自定义配色方案
- **组件**: 在 `src/components/` 中扩展或修改组件
- **类型**: 在 `src/types/` 中添加自定义类型

## 🌐 国际化

项目已为国际化做好准备。目前支持:
- 英语 (默认)
- 中文 (计划中)

## 📱 平台支持

- **桌面**: 完整功能支持
- **移动端**: 有限支持 (推荐桌面体验)

## 🤝 贡献

1. Fork 仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启 Pull Request

## 📝 许可证

此项目根据 ISC 许可证授权 - 有关详细信息，请参阅 LICENSE 文件。

## 🙏 致谢

- Next.js 团队提供的优秀框架
- Tailwind CSS 提供的实用优先CSS框架
- Apple 提供的设计灵感
- 开源社区提供的各种工具和库

## 📞 支持

如需支持，请在 GitHub 上开启 issue 或联系开发团队。

---

**Ecliptrix / 灵蚀创影** - 通过光影交汇将想法转化为现实。 