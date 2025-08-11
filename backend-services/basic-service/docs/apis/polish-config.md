# Polish Config API 文档

## 概述

Polish Config API 提供润色配置信息的查询服务，返回当前系统支持的所有润色目标和相关配置信息。该接口为前端组件提供动态配置数据，支持润色目标的灵活管理。

## 接口信息

- **接口路径**: `/api/polish-config`
- **请求方法**: `GET`
- **内容类型**: `application/json`
- **响应类型**: `application/json`

## 功能特性

- 返回所有可用的润色目标配置
- 支持按分类组织的润色目标
- 客户端安全版本，不包含敏感的提示词模板
- 支持HTTP缓存，提升性能
- 详细的配置元信息

## 请求参数

该接口不需要任何请求参数。

## 请求示例

### 基础请求

```bash
curl -X GET "http://localhost:3000/api/polish-config" \
  -H "Accept: application/json"
```

### JavaScript 请求

```javascript
const response = await fetch('/api/polish-config');
const config = await response.json();
console.log('润色配置:', config);
```

## 响应格式

### 成功响应

**HTTP状态码**: `200 OK`

**响应头**:
```
Content-Type: application/json
Cache-Control: public, max-age=300, s-maxage=300
```

**响应体结构**:
```json
{
  "polish_goals": [
    {
      "id": "short_video",
      "name": "短视频文案",
      "description": "适合抖音、快手等短视频平台的文案风格",
      "category": "platform",
      "color": "bg-red-50 border-red-200 text-red-800",
      "hoverColor": "hover:bg-red-100",
      "selectedColor": "bg-red-100 border-red-300"
    },
    {
      "id": "three_second_hook",
      "name": "三秒钩子",
      "description": "开头3秒内抓住观众注意力",
      "category": "engagement",
      "color": "bg-orange-50 border-orange-200 text-orange-800",
      "hoverColor": "hover:bg-orange-100",
      "selectedColor": "bg-orange-100 border-orange-300"
    }
  ],
  "config_info": {
    "version": "1.0.0",
    "last_updated": "2024-01-01",
    "description": "智能润色目标配置文件，定义了26种不同的内容优化目标和风格"
  }
}
```

### 润色目标字段说明

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | 润色目标的唯一标识符 |
| name | string | 润色目标的显示名称 |
| description | string | 润色目标的详细描述 |
| category | string | 润色目标的分类标识 |
| color | string | 前端显示的颜色样式类 |
| hoverColor | string | 鼠标悬停时的颜色样式类 |
| selectedColor | string | 选中状态的颜色样式类 |

### 分类说明

| 分类ID | 分类名称 | 说明 |
|--------|----------|------|
| platform | 平台适配 | 适配特定平台的内容风格 |
| engagement | 互动引导 | 促进用户互动和参与 |
| emotional | 情感共鸣 | 激发情感反应和共鸣 |
| conversion | 转化驱动 | 引导用户行动和转化 |
| narrative | 叙事表达 | 优化叙述方式和结构 |
| targeting | 精准定位 | 针对特定用户群体 |
| viral | 传播优化 | 提升内容传播性 |
| controversial | 争议话题 | 制造讨论和争议 |
| uniqueness | 差异化 | 突出独特性和差异 |
| structure | 结构优化 | 改善内容结构和逻辑 |
| emphasis | 重点突出 | 强化重点信息 |
| memorable | 记忆深刻 | 增强记忆点和印象 |
| credibility | 可信度 | 提升内容可信度 |
| immersive | 沉浸体验 | 增强沉浸感和体验 |
| innovative | 创新思维 | 采用创新表达方式 |
| psychological | 心理驱动 | 利用心理学原理 |
| motivation | 动机激发 | 激发用户动机 |
| practical | 实用价值 | 提供实用信息和价值 |

## 错误响应

### 500 Internal Server Error

```json
{
  "error": "Failed to load polish configuration",
  "message": "Polish config file not found: /path/to/config/polish-goals.yaml"
}
```

## 使用示例

### React 组件中使用

```typescript
import React, { useEffect, useState } from 'react';

interface PolishGoal {
  id: string;
  name: string;
  description: string;
  category: string;
  color: string;
  hoverColor: string;
  selectedColor: string;
}

interface PolishConfig {
  polish_goals: PolishGoal[];
  config_info: {
    version: string;
    last_updated: string;
    description: string;
  };
}

const PolishSelector: React.FC = () => {
  const [config, setConfig] = useState<PolishConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch('/api/polish-config');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const configData = await response.json();
        setConfig(configData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  if (loading) return <div>加载配置中...</div>;
  if (error) return <div>配置加载失败: {error}</div>;
  if (!config) return <div>无配置数据</div>;

  return (
    <div>
      <h3>润色目标选择 (版本: {config.config_info.version})</h3>
      {config.polish_goals.map(goal => (
        <div key={goal.id} className={goal.color}>
          <h4>{goal.name}</h4>
          <p>{goal.description}</p>
        </div>
      ))}
    </div>
  );
};
```

### 按分类分组显示

```typescript
const groupedGoals = config.polish_goals.reduce((acc, goal) => {
  const category = goal.category || 'other';
  if (!acc[category]) {
    acc[category] = [];
  }
  acc[category].push(goal);
  return acc;
}, {} as Record<string, PolishGoal[]>);

// 分类名称映射
const categoryNames: Record<string, string> = {
  platform: '平台适配',
  engagement: '互动引导',
  emotional: '情感共鸣',
  // ... 更多分类
};

return (
  <div>
    {Object.entries(groupedGoals).map(([category, goals]) => (
      <div key={category}>
        <h4>{categoryNames[category] || category}</h4>
        {goals.map(goal => (
          <div key={goal.id}>{goal.name}</div>
        ))}
      </div>
    ))}
  </div>
);
```

## 缓存策略

### HTTP缓存
- 缓存时间: 5分钟 (300秒)
- 缓存控制: `public, max-age=300, s-maxage=300`
- 适用场景: 配置信息变更频率低，可以安全缓存

### 客户端缓存建议
```typescript
// 简单内存缓存
class ConfigCache {
  private cache: PolishConfig | null = null;
  private cacheTime: number = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5分钟

  async getConfig(): Promise<PolishConfig> {
    const now = Date.now();
    
    if (this.cache && (now - this.cacheTime) < this.CACHE_DURATION) {
      return this.cache;
    }

    const response = await fetch('/api/polish-config');
    const config = await response.json();
    
    this.cache = config;
    this.cacheTime = now;
    
    return config;
  }
}
```

## 性能指标

### 响应时间
- 平均响应时间: <100ms
- 缓存命中时: <10ms

### 数据大小
- 典型响应大小: ~15KB (26个润色目标)
- 压缩后大小: ~3KB

## 监控和日志

### 请求日志
```
[Polish Config API] 接收到配置请求 {timestamp: '2024-01-01T10:00:00.000Z', userAgent: 'Mozilla/5.0...'}
```

### 成功日志
```
[Polish Config API] 成功返回配置 {totalGoals: 26, configVersion: '1.0.0', timestamp: '2024-01-01T10:00:00.100Z'}
```

### 错误日志
```
[Polish Config API] 获取配置失败: Polish config file not found: /path/to/config
```

## 安全考虑

### 数据安全
- 客户端版本不包含敏感的`prompt_template`字段
- 仅返回前端需要的配置信息
- 不暴露内部服务器路径和配置细节

### 访问控制
- 当前为公开接口，无需认证
- 如需访问控制，可添加认证中间件

## 故障排查

### 常见问题

1. **配置文件不存在**
   - 检查 `config/polish-config/polish-goals.yaml` 文件是否存在
   - 验证文件路径和权限

2. **配置格式错误**
   - 验证YAML文件语法
   - 检查必要字段是否完整

3. **缓存问题**
   - 清除浏览器缓存
   - 添加时间戳参数绕过缓存

### 调试技巧
```bash
# 直接访问配置文件
cat config/polish-config/polish-goals.yaml

# 检查API响应
curl -v http://localhost:3000/api/polish-config

# 检查服务器日志
tail -f logs/application.log | grep "Polish Config"
```

## 版本历史

### v1.0.0 (2024-01-01)
- 初始版本发布
- 支持26种润色目标配置
- 实现HTTP缓存策略
- 添加详细日志记录

## 相关接口

- [`POST /api/content-polish`](./content-polish.md) - 内容润色服务

## 配置文件

配置文件位置: `config/polish-config/polish-goals.yaml`

更新配置后，系统会在下次请求时自动加载新配置（受缓存策略影响）。 