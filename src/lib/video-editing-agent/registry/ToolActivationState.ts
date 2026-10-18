import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolRegistry } from './ToolRegistry';

const SCHEMA_LIMIT = 48 * 1024;
/**
 * Room an on-demand load always keeps. Core schemas are sent on every request,
 * so they are not a budget decision; without a floor a small context window
 * would reject every `explore_tools` call (spec §12.3 D-07 / AC-38).
 */
const ON_DEMAND_MIN_BYTES = 8 * 1024;

/** Execution authorization belongs to a model response, not to chat history. */
export class ToolActivationState {
  readonly coreNames: Set<string>;
  private activeNames = new Map<string, number>();
  private offeredNames = new Set<string>();
  private sequence = 0;
  private onDemandBudget = SCHEMA_LIMIT;

  /** Tokens→bytes allowance for on-demand schemas, derived by the caller. */
  setSchemaBudget(bytes: number): void {
    this.onDemandBudget = Math.max(0, Math.min(SCHEMA_LIMIT, bytes));
  }

  constructor(private registry: ToolRegistry, coreNames: readonly string[]) {
    this.coreNames = new Set(coreNames);
  }

  private selected(active = this.activeNames) {
    return this.registry.getAllTools().filter(tool =>
      this.coreNames.has(tool.name) || active.has(tool.name));
  }

  /** Bytes of the schemas a selection would put in the request. */
  private selectionBytes(names: { has(name: string): boolean }): number {
    // TextEncoder, not Buffer: this module is re-exported by registry/index.ts,
    // which client components also import (spec §3.3 counts UTF-8 bytes).
    return new TextEncoder().encode(JSON.stringify(
      this.registry.getAllTools()
        .filter(tool => this.coreNames.has(tool.name) || names.has(tool.name))
        .map(({ name, description, parameters }) => ({ name, description, parameters })))).length;
  }

  /** Core schema bytes; the load budget can never fall below this plus a load. */
  private budgetBytes(): number {
    const core = this.selectionBytes(this.coreNames);
    return Math.min(SCHEMA_LIMIT, core + Math.max(this.onDemandBudget, ON_DEMAND_MIN_BYTES));
  }

  load(category: string, names?: string[]) {
    const available = this.registry.getCategoryTools(category);
    const requested = names ?? available.slice(0, 4).map(tool => tool.name);
    if (!available.length || !requested.length || requested.length > 4 ||
      requested.some(name => !available.some(tool => tool.name === name))) {
      throw new Error('invalid_tool_selection');
    }
    const next = new Map(this.activeNames);
    for (const name of requested) {
      if (!this.coreNames.has(name)) next.set(name, this.sequence + 1);
    }
    const evicted: string[] = [];
    const schemaBytes = () => this.selectionBytes(next);
    const budget = this.budgetBytes();
    while (next.size > 12 || schemaBytes() > budget) {
      const oldest = Array.from(next).filter(([name]) => !requested.includes(name))
        .sort(([a, x], [b, y]) => x - y || a.localeCompare(b))[0];
      if (!oldest) throw new Error('tool_schema_budget');
      next.delete(oldest[0]);
      evicted.push(oldest[0]);
    }
    this.sequence++;
    this.activeNames = next;
    return { loaded: requested, available: available.map(tool => tool.name),
      evicted, further_load: 'Call explore_tools with tool_names; use loaded tools on the next response.' };
  }

  /** Undo a load whose response could not be delivered (D-20). */
  unload(names: readonly string[]): void {
    for (const name of names) {
      if (!this.coreNames.has(name)) this.activeNames.delete(name);
    }
  }

  offer(): AgentTool[] {
    const tools = this.selected();
    this.offeredNames = new Set([...Array.from(this.coreNames), ...tools.map(tool => tool.name)]);
    return tools;
  }

  canExecute(name: string): boolean {
    if (!this.offeredNames.has(name)) return false;
    if (this.activeNames.has(name)) this.activeNames.set(name, ++this.sequence);
    return true;
  }
}
