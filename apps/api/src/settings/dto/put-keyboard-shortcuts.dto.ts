import { Allow } from 'class-validator';

export class PutKeyboardShortcutsDto {
  /**
   * The web app's stored-shortcuts blob, or null to reset to the defaults.
   * Shape and size are enforced by sanitizeStoredShortcuts in the service —
   * class-validator can't express the per-command record, so the field is
   * only whitelisted here.
   */
  @Allow()
  keyboardShortcuts: unknown;
}
