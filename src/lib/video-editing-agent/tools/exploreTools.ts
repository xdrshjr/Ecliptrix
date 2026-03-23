import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { ToolRegistry, ON_DEMAND_CATEGORY_IDS, CATEGORY_IDS } from '../registry';
import { formatExploreToolsResult } from '../systemPrompt';

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

      const usageHints = buildUsageHints(categoryId);

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

/**
 * Build category-specific usage hints to guide the LLM.
 */
function buildUsageHints(categoryId: string): string {
  switch (categoryId) {
    case CATEGORY_IDS.SEARCH_TOOLS:
      return (
        'Search tools query external APIs (Pexels, Unsplash, Freesound). ' +
        'Results are automatically added to the material library. ' +
        'Use add_to_track to place them directly on the timeline.\n' +
        'Tip: English keywords yield better results; Chinese queries are auto-translated.'
      );
    case CATEGORY_IDS.AI_GEN_TOOLS:
      return (
        'AI generation tools start async tasks. The tool returns a taskId and the generation runs in the background. ' +
        'Results are automatically added to the material library when complete. ' +
        'You can inform the user that generation has started and continue with other tasks.'
      );
    case CATEGORY_IDS.TTS_TOOLS:
      return (
        'TTS tools convert text to speech audio. Use generate_tts for a single piece of text (sync, ~2-5s), ' +
        'or batch_generate_tts for multiple sentences/paragraphs. Generated audio is auto-added to the material library.\n\n' +
        'Popular voice types:\n' +
        '  - zh_female_shuangkuaisisi_moon_bigtts  — 双快丝丝 (female, Chinese)\n' +
        '  - zh_male_chunhou_moon_bigtts            — 醇厚 (male, Chinese)\n' +
        '  - zh_female_tianmei_moon_bigtts           — 甜美 (female, Chinese)\n' +
        '  - zh_male_yangguang_moon_bigtts           — 阳光 (male, Chinese)\n' +
        '  - zh_female_wenrou_moon_bigtts            — 温柔 (female, Chinese)\n' +
        '  - en_female_arabellaexpressive             — Arabella (female, English)\n' +
        '  - en_male_caleb                            — Caleb (male, English)\n' +
        '  - en_female_sarahexpressive                — Sarah (female, English)\n' +
        'If voice_type is omitted, defaults to zh_female_shuangkuaisisi_moon_bigtts.'
      );
    case CATEGORY_IDS.SCRIPT_TOOLS:
      return (
        'Script tools help create and refine video scripts. Use generate_video_script to create a new script from a topic, ' +
        'expand_video_script to elaborate on an existing script, or understand_video_script to generate a script from video analysis.'
      );
    case CATEGORY_IDS.STORYBOARD_TOOLS:
      return (
        'Storyboard tools work with visual storyboards. generate_storyboard creates shot breakdowns from a script, ' +
        'describe_storyboard adds visual descriptions, batch_storyboard_video generates video for each shot, ' +
        'and compose_storyboard assembles shots into a timeline.'
      );
    case CATEGORY_IDS.MATERIAL_TOOLS:
      return (
        'Material management tools let you manually add external URLs or remove unwanted materials from the library. ' +
        'Note: search and AI generation results are auto-added, so this is mainly for manual management.'
      );
    default:
      return 'Call the tools in this category as needed for your task.';
  }
}
