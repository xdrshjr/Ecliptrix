import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { ToolRegistry, ON_DEMAND_CATEGORY_IDS } from '../registry';
import { formatExploreToolsResult } from '../systemPrompt';
import { getCategoryUsageHints } from '../promptParts';

const parameters = Type.Object({
  category: Type.Union(
    ON_DEMAND_CATEGORY_IDS.map(id => Type.Literal(id)),
    {
      description:
        'The tool category to explore. Valid values: ' +
        ON_DEMAND_CATEGORY_IDS.join(', '),
    }
  ),
});

type Params = Static<typeof parameters>;

/**
 * Create the explore_tools meta tool.
 *
 * Implementation: Method C — all tools are already registered in the Agent's
 * function-calling schema at init. This tool returns detailed descriptions
 * and usage hints so the LLM knows which tools to call and how.
 *
 * The tool does NOT dynamically inject tools (pi-agent-core's setTools()
 * replaces the entire tool array, which is unsafe mid-loop). Instead, it
 * serves as a documentation/guidance tool that the LLM calls before using
 * advanced tools it hasn't seen detailed descriptions for.
 */
export function createExploreToolsTool(
  registry: ToolRegistry
): AgentTool<typeof parameters> {
  return {
    name: 'explore_tools',
    label: 'Explore Tools',
    description:
      'View detailed tool descriptions for an advanced tool category. ' +
      'Call this before using tools from: search_tools, ai_gen_tools, tts_tools, script_tools, storyboard_tools, material_tools. ' +
      'Returns each tool\'s name, description, and parameter schema.',
    parameters,

    execute: async (_toolCallId: string, params: Params) => {
      const categoryId = params.category;
      const info = registry.getCategoryToolInfo(categoryId);

      if (!info) {
        const errorMsg = `Unknown category "${categoryId}". Valid categories: ${ON_DEMAND_CATEGORY_IDS.join(', ')}`;
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: errorMsg }) }],
          details: { success: false, error: errorMsg },
        };
      }

      if (info.tools.length === 0) {
        const emptyMsg =
          `Category "${info.category.name}" (${categoryId}) is registered but has no tools yet. ` +
          `This category may not be available in the current version.`;
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, message: emptyMsg, tools: [] }) }],
          details: { success: true, message: emptyMsg, tools: [] },
        };
      }

      // Build detailed tool descriptions for the LLM
      const toolDescriptions = info.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parametersSchema,
      }));

      const usageHints = getCategoryUsageHints(categoryId);

      // Format as human-readable text for the LLM using formatExploreToolsResult
      const formattedText = formatExploreToolsResult(
        info.category.name,
        info.category.id,
        info.tools,
        usageHints
      );

      const result = {
        success: true,
        category: info.category.name,
        categoryId: info.category.id,
        description: info.category.description,
        tools: toolDescriptions,
        usage_hints: usageHints,
      };

      return {
        content: [{ type: 'text', text: formattedText }],
        details: result,
      };
    },
  };
}

