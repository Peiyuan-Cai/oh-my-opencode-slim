type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Merge a plugin-emitted agent config with a user-provided OpenCode agent
 * config (typically loaded from `~/.config/opencode/agents/<name>.md`).
 *
 * Rules:
 * - top-level user keys win (shallow merge, existing wins)
 * - if both define `permission`, deep-merge them (existing wins per key)
 * - within `permission`, the `skill` sub-map is also deep-merged so plugin-
 *   emitted skill denies (tier-3 default deny, reserved orchestrator-only
 *   skills, custom skill grants) survive when the user's markdown does not
 *   explicitly redefine them.
 * - all other fields keep shallow-merge semantics.
 *
 * Background: the original shallow merge `{...plugin, ...existing}` dropped
 * the plugin's `permission.skill` map whenever a user markdown agent set
 * its own `permission` block, even if the user's block did not include
 * `skill:`. That neutralized reserved-skill enforcement on every agent
 * with a user markdown file.
 */
export function mergeAgentConfig(
  pluginAgent: Plain,
  existing: Plain | undefined,
): Plain {
  if (!existing) {
    return { ...pluginAgent };
  }

  const merged: Plain = { ...pluginAgent, ...existing };

  const pluginPerm = pluginAgent.permission;
  const existingPerm = existing.permission;
  if (isPlainObject(pluginPerm) || isPlainObject(existingPerm)) {
    const mergedPerm: Plain = {
      ...(isPlainObject(pluginPerm) ? pluginPerm : {}),
      ...(isPlainObject(existingPerm) ? existingPerm : {}),
    };

    const pluginSkill = isPlainObject(pluginPerm)
      ? pluginPerm.skill
      : undefined;
    const existingSkill = isPlainObject(existingPerm)
      ? existingPerm.skill
      : undefined;
    if (isPlainObject(pluginSkill) || isPlainObject(existingSkill)) {
      mergedPerm.skill = {
        ...(isPlainObject(pluginSkill) ? pluginSkill : {}),
        ...(isPlainObject(existingSkill) ? existingSkill : {}),
      };
    }

    merged.permission = mergedPerm;
  }

  return merged;
}
