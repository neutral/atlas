import type { DeepReadonly, JsonValue } from 'atlas-reference-validator';
import type { EvaluatorRegistration } from 'atlas-reference-validator';

export type AtlasAgentToolName = 'atlas_state' | 'atlas_guide' | 'atlas_read' | 'atlas_find' | 'atlas_point' | 'atlas_resource' | 'atlas_source'
  | 'atlas_freshness' | 'atlas_refresh' | 'atlas_compare' | 'atlas_prepare' | 'atlas_apply' | 'atlas_checks' | 'atlas_evaluate' | 'atlas_run' | 'atlas_retain' | 'atlas_reports' | 'atlas_report';
export type AgentToolDefinition = {
  name: AtlasAgentToolName; description: string; inputSchema: { [key: string]: JsonValue }; outputSchema: { [key: string]: JsonValue };
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
};
export const ATLAS_AGENT_TOOLS: readonly DeepReadonly<AgentToolDefinition>[];
export type AgentResult = { contract: 'atlas.agent-result/1'; tool: AtlasAgentToolName; data: { [key: string]: JsonValue } };
export type AgentSessionOptions = {
  repositoryRoot: string; atlasPath: string; stateDirectory: string; registrations?: readonly EvaluatorRegistration[];
};
/** Host-selected roots and registrations remain fixed for the entire session. */
export type AgentSession = {
  readonly tools: typeof ATLAS_AGENT_TOOLS;
  readonly call: (name: AtlasAgentToolName, args?: { [key: string]: JsonValue }, options?: { signal?: AbortSignal }) => Promise<DeepReadonly<AgentResult>>;
  readonly close: () => void;
};
export function openAgentSession(options: AgentSessionOptions): AgentSession;
