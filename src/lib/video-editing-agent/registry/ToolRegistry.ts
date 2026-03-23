import type { AgentTool } from '@mariozechner/pi-agent-core';

/**
 * Metadata for a tool category in the registry.
 */
export interface ToolCategory {
  /** Unique identifier, e.g. "search_tools" */
  id: string;
  /** Human-readable name, e.g. "搜索获取工具" */
  name: string;
  /** One-line description for L0 system prompt */
  description: string;
  /** Whether tools in this category are always available (shown in L0 prompt) */
  alwaysAvailable: boolean;
  /** Tools belonging to this category. Populated at registration time or later via registerToolsForCategory. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: AgentTool<any>[];
}

/**
 * Summary of a category, used for L0 system prompt generation.
 */
export interface CategorySummary {
  id: string;
  name: string;
  description: string;
  alwaysAvailable: boolean;
  toolCount: number;
}

/**
 * Detailed tool info returned by explore_tools for a specific category.
 */
export interface ToolInfo {
  name: string;
  description: string;
  parametersSchema: unknown;
}

/**
 * Central registry that organizes all agent tools into categories.
 *
 * Design: Method C — all tools are registered in the Agent's function-calling
 * schema at init time. The system prompt only shows category summaries (L0).
 * The explore_tools meta tool returns detailed descriptions to help the LLM
 * understand what's available before calling a tool.
 */
export class ToolRegistry {
  private categories: Map<string, ToolCategory> = new Map();

  /**
   * Register a tool category. If a category with the same ID already exists,
   * it is replaced.
   */
  registerCategory(category: ToolCategory): void {
    this.categories.set(category.id, { ...category, tools: [...category.tools] });
  }

  /**
   * Add tools to an existing category. Used by other agents/modules in Phase 2+
   * to populate their tools into categories defined in Phase 1.
   *
   * @throws Error if the category does not exist.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerToolsForCategory(categoryId: string, tools: AgentTool<any>[]): void {
    const category = this.categories.get(categoryId);
    if (!category) {
      throw new Error(
        `ToolRegistry: cannot register tools for unknown category "${categoryId}". ` +
        `Available categories: ${Array.from(this.categories.keys()).join(', ')}`
      );
    }
    category.tools.push(...tools);
  }

  /**
   * Return summaries for all registered categories.
   * Used to build the L0 system prompt tool directory.
   */
  getCategorySummaries(): CategorySummary[] {
    const summaries: CategorySummary[] = [];
    for (const cat of Array.from(this.categories.values())) {
      summaries.push({
        id: cat.id,
        name: cat.name,
        description: cat.description,
        alwaysAvailable: cat.alwaysAvailable,
        toolCount: cat.tools.length,
      });
    }
    return summaries;
  }

  /**
   * Return all tools in a specific category.
   * Returns an empty array if the category does not exist.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCategoryTools(categoryId: string): AgentTool<any>[] {
    const category = this.categories.get(categoryId);
    return category ? [...category.tools] : [];
  }

  /**
   * Return the full category metadata, or undefined if not found.
   */
  getCategory(categoryId: string): ToolCategory | undefined {
    return this.categories.get(categoryId);
  }

  /**
   * Return all tool category IDs.
   */
  getCategoryIds(): string[] {
    return Array.from(this.categories.keys());
  }

  /**
   * Return tools from categories marked as alwaysAvailable.
   * These are the baseline tools that should be visible in L0 system prompt
   * and are always included in the Agent's tool set.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAlwaysAvailableTools(): AgentTool<any>[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: AgentTool<any>[] = [];
    for (const cat of Array.from(this.categories.values())) {
      if (cat.alwaysAvailable) {
        tools.push(...cat.tools);
      }
    }
    return tools;
  }

  /**
   * Return all tools across all categories.
   * Used for Method C: register everything in the Agent's function-calling schema at init.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAllTools(): AgentTool<any>[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: AgentTool<any>[] = [];
    for (const cat of Array.from(this.categories.values())) {
      tools.push(...cat.tools);
    }
    return tools;
  }

  /**
   * Return detailed tool info for a category, formatted for explore_tools output.
   * Returns null if the category does not exist.
   */
  getCategoryToolInfo(categoryId: string): { category: CategorySummary; tools: ToolInfo[] } | null {
    const category = this.categories.get(categoryId);
    if (!category) return null;

    return {
      category: {
        id: category.id,
        name: category.name,
        description: category.description,
        alwaysAvailable: category.alwaysAvailable,
        toolCount: category.tools.length,
      },
      tools: category.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parametersSchema: tool.parameters,
      })),
    };
  }
}
