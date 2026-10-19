import { describe, expect, test } from 'bun:test';
import { getDefaultNonSpPolicy } from './agent-tier-policy';

describe('getDefaultNonSpPolicy', () => {
  test('orchestrator: allow', () => {
    expect(getDefaultNonSpPolicy('orchestrator')).toBe('allow');
  });

  test('orchestrator-beta: allow', () => {
    expect(getDefaultNonSpPolicy('orchestrator-beta')).toBe('allow');
  });

  test('orchestrator-delta: allow', () => {
    expect(getDefaultNonSpPolicy('orchestrator-delta')).toBe('allow');
  });

  test('fixer: allow (tier 2 implementer)', () => {
    expect(getDefaultNonSpPolicy('fixer')).toBe('allow');
  });

  test('fixer-alpha: allow (variant inherits)', () => {
    expect(getDefaultNonSpPolicy('fixer-alpha')).toBe('allow');
  });

  test('designer: allow', () => {
    expect(getDefaultNonSpPolicy('designer')).toBe('allow');
  });

  test('laborer: allow', () => {
    expect(getDefaultNonSpPolicy('laborer')).toBe('allow');
  });

  test('oracle: deny (tier 3 review-class)', () => {
    expect(getDefaultNonSpPolicy('oracle')).toBe('deny');
  });

  test('oracle-beta: deny (variant inherits)', () => {
    expect(getDefaultNonSpPolicy('oracle-beta')).toBe('deny');
  });

  test('explorer: deny', () => {
    expect(getDefaultNonSpPolicy('explorer')).toBe('deny');
  });

  test('librarian: deny', () => {
    expect(getDefaultNonSpPolicy('librarian')).toBe('deny');
  });

  test('observer: deny', () => {
    expect(getDefaultNonSpPolicy('observer')).toBe('deny');
  });

  test('council: deny', () => {
    expect(getDefaultNonSpPolicy('council')).toBe('deny');
  });

  test('councillor: deny', () => {
    expect(getDefaultNonSpPolicy('councillor')).toBe('deny');
  });

  test('scout: deny', () => {
    expect(getDefaultNonSpPolicy('scout')).toBe('deny');
  });

  test('validator: deny', () => {
    expect(getDefaultNonSpPolicy('validator')).toBe('deny');
  });

  test('gist: deny', () => {
    expect(getDefaultNonSpPolicy('gist')).toBe('deny');
  });

  test('wildcard: deny', () => {
    expect(getDefaultNonSpPolicy('wildcard')).toBe('deny');
  });

  test('unknown agent name: allow (safe default for unknown custom agents)', () => {
    expect(getDefaultNonSpPolicy('foo-unknown')).toBe('allow');
  });
});
