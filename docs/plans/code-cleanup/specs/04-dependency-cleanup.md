# Spec 04: 未使用依赖包检查与清理

## 概述

检查前端 `package.json` 和后端 `requirements.txt` 中声明但未在代码中实际使用的依赖包。

## 前端 npm 依赖

### 检查方法

1. 读取 `package.json` 中的 `dependencies` 和 `devDependencies`
2. 对每个依赖包名，grep 查找 `src/` 中的 import 引用
3. 同时检查以下间接使用方式：
   - `next.config.js` / `tailwind.config.ts` / `postcss.config.js` 中的引用
   - `components.json`（shadcn 配置）中的引用
   - `tsconfig.json` 中的引用
   - npm scripts 中的命令行工具引用

### 特殊排除

- `@types/*` 类型包 → 检查对应的主包是否存在
- `eslint-*` / `prettier-*` → 检查 `.eslintrc` 等配置文件
- `tailwindcss` 生态包 → 可能通过 CSS 而非 import 使用
- `postcss` 插件 → 通过配置文件使用
- peer dependencies → 不删除

## 后端 Python 依赖

### 检查方法

1. 读取 `requirements.txt`
2. 对每个包名，grep 查找 `app/` 中的 `import` 语句
3. 注意包名和 import 名可能不同（如 `python-dotenv` → `import dotenv`）

### 特殊排除

- 运行时依赖（如 `uvicorn`、`gunicorn`）通过命令行使用
- `asyncpg` 由 SQLAlchemy 通过 URL scheme 间接使用
- `aiosqlite` 在测试中间接使用
- `alembic` 通过命令行使用

## 产出

- 从 `package.json` 移除未使用的依赖
- 从 `requirements.txt` 移除未使用的依赖
- 不执行 `npm install` 或 `pip install`（避免影响 lock 文件）
