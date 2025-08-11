import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface PolishGoal {
  id: string;
  name: string;
  description: string;
  category: string;
  color: string;
  hoverColor: string;
  selectedColor: string;
  prompt_template: string;
}

export interface PolishConfig {
  polish_goals: PolishGoal[];
  config_info: {
    version: string;
    last_updated: string;
    description: string;
  };
}

/**
 * 加载润色配置文件
 * @returns 润色配置对象
 */
export function loadPolishConfig(): PolishConfig {
  try {
    const configPath = path.join(process.cwd(), 'config', 'polish-config', 'polish-goals.yaml');
    
    console.log(`[PolishConfigLoader] 尝试加载配置文件: ${configPath}`);
    
    if (!fs.existsSync(configPath)) {
      console.error(`[PolishConfigLoader] 配置文件不存在: ${configPath}`);
      throw new Error(`Polish config file not found: ${configPath}`);
    }

    const fileContents = fs.readFileSync(configPath, 'utf8');
    console.log(`[PolishConfigLoader] 成功读取配置文件，大小: ${fileContents.length} 字符`);
    
    const config = yaml.load(fileContents) as PolishConfig;
    
    if (!config || !config.polish_goals || !Array.isArray(config.polish_goals)) {
      console.error('[PolishConfigLoader] 配置文件格式错误：缺少 polish_goals 数组');
      throw new Error('Invalid config format: missing polish_goals array');
    }

    console.log(`[PolishConfigLoader] 成功加载配置，包含 ${config.polish_goals.length} 个润色目标`);
    console.log(`[PolishConfigLoader] 配置版本: ${config.config_info?.version || 'unknown'}`);
    
    // 验证配置项的必要字段
    for (let i = 0; i < config.polish_goals.length; i++) {
      const goal = config.polish_goals[i];
      if (!goal.id || !goal.name || !goal.description || !goal.prompt_template) {
        console.error(`[PolishConfigLoader] 配置项 ${i} 缺少必要字段:`, goal);
        throw new Error(`Invalid goal config at index ${i}: missing required fields`);
      }
    }

    return config;
  } catch (error) {
    console.error('[PolishConfigLoader] 加载配置文件失败:', error);
    throw error;
  }
}

/**
 * 根据ID获取特定的润色目标
 * @param goalId 润色目标ID
 * @returns 润色目标对象，如果未找到则返回null
 */
export function getPolishGoalById(goalId: string): PolishGoal | null {
  try {
    const config = loadPolishConfig();
    const goal = config.polish_goals.find(g => g.id === goalId);
    
    if (goal) {
      console.log(`[PolishConfigLoader] 找到润色目标: ${goalId} - ${goal.name}`);
    } else {
      console.warn(`[PolishConfigLoader] 未找到润色目标: ${goalId}`);
    }
    
    return goal || null;
  } catch (error) {
    console.error(`[PolishConfigLoader] 获取润色目标失败 (${goalId}):`, error);
    return null;
  }
}

/**
 * 获取所有润色目标，按分类分组
 * @returns 按分类分组的润色目标
 */
export function getPolishGoalsByCategory(): Record<string, PolishGoal[]> {
  try {
    const config = loadPolishConfig();
    const grouped: Record<string, PolishGoal[]> = {};
    
    config.polish_goals.forEach(goal => {
      const category = goal.category || 'other';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(goal);
    });
    
    console.log(`[PolishConfigLoader] 按分类分组完成，包含 ${Object.keys(grouped).length} 个分类`);
    
    return grouped;
  } catch (error) {
    console.error('[PolishConfigLoader] 按分类获取润色目标失败:', error);
    return {};
  }
}

/**
 * 客户端安全版本：返回不包含敏感信息的配置
 * @returns 客户端安全的配置对象
 */
export function getClientSafePolishConfig() {
  try {
    const config = loadPolishConfig();
    
    // 移除 prompt_template，只保留客户端需要的字段
    const clientSafeGoals = config.polish_goals.map(goal => ({
      id: goal.id,
      name: goal.name,
      description: goal.description,
      category: goal.category,
      color: goal.color,
      hoverColor: goal.hoverColor,
      selectedColor: goal.selectedColor
    }));
    
    console.log(`[PolishConfigLoader] 生成客户端安全配置，包含 ${clientSafeGoals.length} 个目标`);
    
    return {
      polish_goals: clientSafeGoals,
      config_info: config.config_info
    };
  } catch (error) {
    console.error('[PolishConfigLoader] 生成客户端安全配置失败:', error);
    throw error;
  }
} 