import { describe, expect, it } from 'vitest';

import {
  InvalidShortcutsError,
  sanitizeStoredShortcuts,
} from '../../src/settings/stored-shortcuts';

describe('sanitizeStoredShortcuts', () => {
  it('passes a well-formed blob through, rebuilt field by field', () => {
    expect(
      sanitizeStoredShortcuts({
        version: 1,
        overrides: {
          'toggle-rest': { keys: 'KeyJ', label: 'j' },
          'move-left': { keys: 'Ctrl+Shift+ArrowLeft' },
          copy: null,
        },
      }),
    ).toEqual({
      version: 1,
      overrides: {
        'toggle-rest': { keys: 'KeyJ', label: 'j' },
        'move-left': { keys: 'Ctrl+Shift+ArrowLeft' },
        copy: null,
      },
    });
  });

  it('normalizes "no customizations" to null', () => {
    expect(sanitizeStoredShortcuts(null)).toBeNull();
    expect(sanitizeStoredShortcuts(undefined)).toBeNull();
    expect(sanitizeStoredShortcuts({ version: 1, overrides: {} })).toBeNull();
  });

  it('drops fields beyond the known shape', () => {
    const sanitized = sanitizeStoredShortcuts({
      version: 1,
      overrides: { copy: { keys: 'KeyC', label: 'c', extra: 'smuggled' } },
      extra: 'smuggled',
    });
    expect(sanitized).toEqual({
      version: 1,
      overrides: { copy: { keys: 'KeyC', label: 'c' } },
    });
  });

  it('rejects wrong top-level shapes and versions', () => {
    for (const input of ['x', 42, [], { version: 2, overrides: {} }, { version: 1 }, { version: 1, overrides: [] }]) {
      expect(() => sanitizeStoredShortcuts(input)).toThrow(InvalidShortcutsError);
    }
  });

  it('rejects malformed shortcut ids', () => {
    for (const keys of ['', 'Bogus+KeyJ', 'KeyJ+Ctrl', 'Ctrl+', 'Ctrl+Key J', 'Ctrl+KeyJ;DROP']) {
      expect(() =>
        sanitizeStoredShortcuts({ version: 1, overrides: { copy: { keys } } }),
      ).toThrow(InvalidShortcutsError);
    }
  });

  it('rejects malformed overrides and labels', () => {
    expect(() =>
      sanitizeStoredShortcuts({ version: 1, overrides: { copy: 'KeyC' } }),
    ).toThrow(InvalidShortcutsError);
    expect(() =>
      sanitizeStoredShortcuts({ version: 1, overrides: { copy: { keys: 'KeyC', label: 'far-too-long-for-a-keycap' } } }),
    ).toThrow(InvalidShortcutsError);
  });

  it('caps the number of overrides and the command id length', () => {
    const overrides: Record<string, { keys: string }> = {};
    for (let i = 0; i < 201; i++) overrides[`command-${i}`] = { keys: 'KeyA' };
    expect(() => sanitizeStoredShortcuts({ version: 1, overrides })).toThrow(InvalidShortcutsError);

    expect(() =>
      sanitizeStoredShortcuts({ version: 1, overrides: { ['x'.repeat(101)]: { keys: 'KeyA' } } }),
    ).toThrow(InvalidShortcutsError);
  });
});
