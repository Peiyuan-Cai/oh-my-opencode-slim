import { resolveBaseAgentName } from './superpowers-policy';

/**
 * Tier 3 agents are the read-only review/recon/utility class. They have a
 * default non-SP skill policy of `deny` — meaning they cannot load
 * arbitrary non-Superpowers skills unless the agent's jsonc explicitly
 * lists the skill OR the patch's RECOMMENDED_SKILLS / CUSTOM_SKILLS
 * registries grant it.
 *
 * Tier 1 (orchestrator) and Tier 2 (implementer: fixer/designer/laborer)
 * agents default to `allow` for non-SP skills.
 */
const TIER_3_BASE_NAMES = new Set([
  'oracle',
  'explorer',
  'librarian',
  'observer',
  'council',
  'councillor',
  'scout',
  'validator',
  'gist',
  'wildcard',
]);

/**
 * Return the default non-Superpowers wildcard skill policy for the given
 * agent. Used by `getSkillPermissionsForAgent` when no explicit `skills`
 * override is provided in the agent's jsonc config.
 *
 * Variant agents (e.g. `oracle-alpha`) resolve to their base name via
 * `resolveBaseAgentName` and inherit the base's tier policy.
 *
 * Unknown agent names default to `allow` to avoid accidentally locking
 * down a user's custom agent that this patch is unaware of.
 */
export function getDefaultNonSpPolicy(agentName: string): 'allow' | 'deny' {
  const base = resolveBaseAgentName(agentName);
  return TIER_3_BASE_NAMES.has(base) ? 'deny' : 'allow';
}
