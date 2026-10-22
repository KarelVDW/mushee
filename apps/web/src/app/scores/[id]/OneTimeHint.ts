/** Where a viewer's "seen it" for the dock's move-a-note hint is remembered. */
export const MOVE_NOTE_HINT_KEY = 'solkey:hint:move-note'
/** Where a viewer's "seen it" for the phone's tap-again-for-actions tip is remembered. */
export const SELECTION_TIP_KEY = 'solkey:hint:selection-actions'

/**
 * A hint shown to a viewer until it has done its job, then never again on this device — the
 * dock's first-selection hint ("To move a note, …", retired by the first pitch edit) and the
 * phone's "Tap the note again to copy or delete it." tip. The "seen" mark lives in
 * localStorage; where storage is unavailable (private mode, blocked site data) the hint
 * simply shows again on the next visit — a hint, never a nag.
 *
 * Storage is read lazily, on the first question, so constructing one (during a server render,
 * say) touches nothing.
 */
export class OneTimeHint {
    private seen: boolean | null = null

    constructor(private readonly storageKey: string) {}

    /** Whether the hint still has something to teach this viewer. */
    get pending(): boolean {
        this.seen ??= this.read()
        return !this.seen
    }

    /** The hint did its job (or another surface taught the same thing): stop showing it, here and on later visits. */
    markSeen(): void {
        if (this.seen === true) return
        this.seen = true
        try {
            localStorage.setItem(this.storageKey, '1')
        } catch {
            /* storage unavailable: forgotten after this visit */
        }
    }

    private read(): boolean {
        try {
            return typeof localStorage !== 'undefined' && localStorage.getItem(this.storageKey) === '1'
        } catch {
            return false
        }
    }
}
