/** The custom property the score scroller reads for the room a toast over its foot takes (px). */
export const TOAST_CLEARANCE_VAR = '--toast-clearance'

/**
 * Keeps the score clear of a toast over its foot — the after-recording summary, two rows tall on
 * a phone, sits right over the bar it asks the user to fix. While held, the score scroller carries
 * {@link TOAST_CLEARANCE_VAR}: the height from the toast stack's top edge down to the scroller's
 * bottom. The page turns it into the scroller's `scroll-padding-bottom` — so the selection and
 * playback follow (useScrollFollow) keep their row above the toast — and into extra room under
 * the score, so even its last row can scroll up that far. It re-measures as the stack or the
 * scroller changes size, and lets go by itself once the toast has left (its timer, its ×, an
 * action) — or on {@link release}.
 */
export class ToastClearance {
    private watchers: Array<{ disconnect(): void }> = []

    constructor(private readonly scroller: HTMLElement) {}

    /**
     * Clear the toast holding `marker` (any element inside it, e.g. one of its buttons): the
     * live region it sits in is the stack's top, wherever the stack is raised to.
     */
    hold(marker: Element): void {
        this.release()
        const region = marker.closest('[role="status"], [role="alert"]')
        if (!region) return
        const measure = () => {
            if (!region.contains(marker)) return this.release()
            const covered = this.scroller.getBoundingClientRect().bottom - region.getBoundingClientRect().top
            if (covered > 0) this.scroller.style.setProperty(TOAST_CLEARANCE_VAR, `${Math.ceil(covered)}px`)
            else this.scroller.style.removeProperty(TOAST_CLEARANCE_VAR)
        }
        const resized = new ResizeObserver(measure)
        resized.observe(region)
        resized.observe(this.scroller)
        const changed = new MutationObserver(measure)
        changed.observe(region, { childList: true, subtree: true })
        this.watchers = [resized, changed]
        measure()
    }

    /** Let the score use its whole height again. Idempotent. */
    release(): void {
        for (const watcher of this.watchers) watcher.disconnect()
        this.watchers = []
        this.scroller.style.removeProperty(TOAST_CLEARANCE_VAR)
    }
}
