import { resolveBaseAgentName } from '../cli/superpowers-policy';

/**
 * Closed-set blacklist of restricted third-party MCPs.
 *
 * Each entry maps an MCP name to the set of base agent names allowed to use
 * it. Agents whose base name is NOT in the operator list get an explicit
 * deny rule emitted by the patch.
 *
 * Future-safe: adding a newly-restricted MCP requires only one new entry
 * here; no per-agent jsonc/markdown changes needed. New MCPs not listed
 * here remain implicit-allow for all agents.
 */
const MCP_OPERATOR_BASES: Record<string, ReadonlyArray<string>> = {
  'windows-mcp': ['fixer', 'orchestrator', 'laborer', 'designer'],
  'chrome-devtools': [
    'fixer',
    'orchestrator',
    'laborer',
    'designer',
    'librarian',
  ],
  playwright: ['fixer', 'orchestrator', 'laborer', 'designer', 'librarian'],
};

/**
 * Return the list of restricted MCP names that should be denied for the
 * given agent.
 *
 * Variant agents (e.g. `fixer-alpha`, `librarian-beta`) resolve to their
 * base name via `resolveBaseAgentName` and inherit the base's operator
 * status.
 */
export function getRestrictedMcpDenies(agentName: string): string[] {
  const base = resolveBaseAgentName(agentName);
  const denies: string[] = [];
  for (const [mcp, allowedBases] of Object.entries(MCP_OPERATOR_BASES)) {
    if (!allowedBases.includes(base)) {
      denies.push(mcp);
    }
  }
  return denies;
}
