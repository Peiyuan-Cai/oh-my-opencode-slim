import { describe, expect, test } from 'bun:test';
import {
  isReservedSkillAllowed,
  RESERVED_ORCHESTRATOR_ONLY_SKILLS,
} from './orchestrator-only-skills';

describe('RESERVED_ORCHESTRATOR_ONLY_SKILLS', () => {
  test('contains exactly the reserved skill names in order', () => {
    expect(RESERVED_ORCHESTRATOR_ONLY_SKILLS).toEqual(['update-memory']);
  });
});

describe('isReservedSkillAllowed', () => {
  test('orchestrator is allowed', () => {
    expect(isReservedSkillAllowed('orchestrator')).toBe(true);
  });

  test('orchestrator-beta is allowed', () => {
    expect(isReservedSkillAllowed('orchestrator-beta')).toBe(true);
  });

  test('orchestrator-delta is allowed', () => {
    expect(isReservedSkillAllowed('orchestrator-delta')).toBe(true);
  });

  test('fixer is denied', () => {
    expect(isReservedSkillAllowed('fixer')).toBe(false);
  });

  test('fixer-extra is denied (suffixed custom agents do not inherit reserved access)', () => {
    expect(isReservedSkillAllowed('fixer-extra')).toBe(false);
  });

  test('oracle is denied', () => {
    expect(isReservedSkillAllowed('oracle')).toBe(false);
  });

  test('gist is denied', () => {
    expect(isReservedSkillAllowed('gist')).toBe(false);
  });

  test('unknown agent name is denied', () => {
    expect(isReservedSkillAllowed('foo-unknown')).toBe(false);
  });
});
