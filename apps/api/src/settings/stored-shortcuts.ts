/**
 * The keyboard-shortcut override blob the web app persists — the same shape
 * it keeps in localStorage (see apps/web src/lib/Keybindings.ts). The server
 * stores it opaquely per user but validates the shape and caps sizes, since
 * it lands in a jsonb column straight from the client.
 */
export interface StoredShortcutOverride {
  /** Canonical shortcut id, e.g. `Ctrl+Shift+ArrowLeft`. */
  keys: string;
  /** Character the key produced when recorded (layout-correct display label). */
  label?: string;
}

export interface StoredShortcuts {
  version: 1;
  /** Per-command deviation from the defaults; null means explicitly unbound. */
  overrides: Record<string, StoredShortcutOverride | null>;
}

export class InvalidShortcutsError extends Error {}

const MAX_OVERRIDES = 200;
const MAX_COMMAND_ID_LENGTH = 100;
const MAX_LABEL_LENGTH = 16;

/** Modifiers in canonical order followed by a KeyboardEvent.code (alphanumeric). */
const KEYS_PATTERN = /^((Ctrl|Alt|Shift|Meta)\+)*[A-Za-z0-9]{1,32}$/;

/**
 * Validate a client-sent shortcut blob and rebuild it field by field, so
 * nothing beyond the known shape reaches the database. Returns null for
 * null/no-overrides input (meaning "back on the defaults"); throws
 * {@link InvalidShortcutsError} on anything malformed.
 */
export function sanitizeStoredShortcuts(
  input: unknown,
): StoredShortcuts | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new InvalidShortcutsError('keyboardShortcuts must be an object');
  }
  const { version, overrides } = input as Record<string, unknown>;
  if (version !== 1) {
    throw new InvalidShortcutsError('Unsupported keyboardShortcuts version');
  }
  if (
    typeof overrides !== 'object' ||
    overrides === null ||
    Array.isArray(overrides)
  ) {
    throw new InvalidShortcutsError('overrides must be an object');
  }

  const entries = Object.entries(overrides);
  if (entries.length > MAX_OVERRIDES) {
    throw new InvalidShortcutsError('Too many shortcut overrides');
  }

  const sanitized: Record<string, StoredShortcutOverride | null> = {};
  for (const [commandId, entry] of entries) {
    if (!commandId || commandId.length > MAX_COMMAND_ID_LENGTH) {
      throw new InvalidShortcutsError('Invalid command id');
    }
    if (entry === null) {
      sanitized[commandId] = null;
      continue;
    }
    if (typeof entry !== 'object' || Array.isArray(entry)) {
      throw new InvalidShortcutsError(`Invalid override for '${commandId}'`);
    }
    const { keys, label } = entry as Record<string, unknown>;
    if (typeof keys !== 'string' || !KEYS_PATTERN.test(keys)) {
      throw new InvalidShortcutsError(`Invalid shortcut for '${commandId}'`);
    }
    if (
      label !== undefined &&
      (typeof label !== 'string' || label.length > MAX_LABEL_LENGTH)
    ) {
      throw new InvalidShortcutsError(`Invalid label for '${commandId}'`);
    }
    sanitized[commandId] = label === undefined ? { keys } : { keys, label };
  }

  if (Object.keys(sanitized).length === 0) return null;
  return { version: 1, overrides: sanitized };
}
