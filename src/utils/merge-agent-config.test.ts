import { describe, expect, test } from 'bun:test';
import { mergeAgentConfig } from './merge-agent-config';

describe('mergeAgentConfig', () => {
  test('top-level user keys win', () => {
    const plugin = { model: 'plugin-model', prompt: 'plugin-prompt' };
    const existing = { model: 'user-model' };
    const merged = mergeAgentConfig(plugin, existing);

    expect(merged.model).toBe('user-model');
    expect(merged.prompt).toBe('plugin-prompt');
  });

  test('plugin permission.skill survives when user has no skill key', () => {
    const plugin = {
      permission: {
        question: 'allow',
        skill: {
          'update-memory': 'deny',
          'best-of-n-with-judge': 'deny',
          '*': 'deny',
        },
      },
    };
    const existing = {
      permission: {
        edit: 'deny',
        write: 'deny',
        bash: 'deny',
        task: 'deny',
        todowrite: 'deny',
      },
    };
    const merged = mergeAgentConfig(plugin, existing);

    expect((merged.permission as any).edit).toBe('deny');
    expect((merged.permission as any).write).toBe('deny');
    expect((merged.permission as any).question).toBe('allow');
    expect((merged.permission as any).skill['update-memory']).toBe('deny');
    expect((merged.permission as any).skill['best-of-n-with-judge']).toBe(
      'deny',
    );
    expect((merged.permission as any).skill['*']).toBe('deny');
  });

  test('user permission keys override plugin keys', () => {
    const plugin = {
      permission: {
        bash: 'allow',
        skill: { 'foo-skill': 'allow' },
      },
    };
    const existing = {
      permission: {
        bash: 'deny',
      },
    };
    const merged = mergeAgentConfig(plugin, existing);

    expect((merged.permission as any).bash).toBe('deny');
    expect((merged.permission as any).skill['foo-skill']).toBe('allow');
  });

  test('user can override individual skill keys via permission.skill', () => {
    const plugin = {
      permission: {
        skill: {
          'foo-skill': 'allow',
          'bar-skill': 'allow',
        },
      },
    };
    const existing = {
      permission: {
        skill: {
          'foo-skill': 'deny',
        },
      },
    };
    const merged = mergeAgentConfig(plugin, existing);

    expect((merged.permission as any).skill['foo-skill']).toBe('deny');
    expect((merged.permission as any).skill['bar-skill']).toBe('allow');
  });

  test('returns plugin alone when existing is undefined', () => {
    const plugin = {
      model: 'plugin-model',
      permission: { skill: { x: 'deny' } },
    };
    const merged = mergeAgentConfig(plugin, undefined);

    expect(merged.model).toBe('plugin-model');
    expect((merged.permission as any).skill.x).toBe('deny');
  });

  test('does not deep-merge unrelated nested objects', () => {
    const plugin = { options: { textVerbosity: 'low', extra: 'plugin' } };
    const existing = { options: { textVerbosity: 'high' } };
    const merged = mergeAgentConfig(plugin, existing);

    expect((merged.options as any).textVerbosity).toBe('high');
    expect((merged.options as any).extra).toBeUndefined();
  });

  test('non-skill nested objects inside permission are not deep-merged', () => {
    const plugin = {
      permission: {
        foo: { a: 1, b: 2 } as Record<string, unknown>,
      },
    };
    const existing = {
      permission: {
        foo: { a: 99 } as Record<string, unknown>,
      },
    };
    const merged = mergeAgentConfig(plugin, existing);
    const fooOut = (merged.permission as Record<string, unknown>).foo as Record<
      string,
      unknown
    >;

    expect(fooOut.a).toBe(99);
    expect(fooOut.b).toBeUndefined();
  });
});
