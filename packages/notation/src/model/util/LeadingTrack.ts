import { type BeatPositioned, BeatPositionedList } from './BeatPositionedList'

/**
 * The write side of a measure's clefs or key signatures: a leading item at beat 0, optional
 * mid-measure changes, and whether the leading item is explicit (a carry-forward boundary) or
 * inherited. Clefs and keys are deliberately parallel, so the rules live here once; reads go
 * through `list`, the {@link BeatPositionedList} queries tempos share.
 *
 * Every write replaces the items array rather than mutating it, so a caller iterating `items`
 * while writing keeps walking the snapshot it started with. Version bumps stay with the
 * owning Measure.
 */
export class LeadingTrack<T extends BeatPositioned> {
    private _items: T[]
    private _leadingExplicit: boolean

    /** Queries over the current items. */
    readonly list = new BeatPositionedList<T>(() => this._items)

    constructor(leading: T, leadingExplicit: boolean) {
        this._items = [leading]
        this._leadingExplicit = leadingExplicit
    }

    get items(): T[] {
        return this._items
    }

    /** Whether the leading item is an intentional change (a carry-forward boundary). */
    get leadingExplicit(): boolean {
        return this._leadingExplicit
    }

    /** Store an item as given — no redundancy rule, no explicit marking (deserialization). */
    add(item: T) {
        this._items = [...this._items, item]
    }

    remove(beatPosition: number) {
        this._items = this._items.filter((item) => item.beatPosition !== beatPosition)
    }

    /** Rewrite every item in place of its old self; the leading state is kept. */
    map(rewrite: (item: T) => T) {
        this._items = this._items.map(rewrite)
    }

    /**
     * Add or replace the item at its beat; beat 0 marks the leading item explicit. A mid-measure
     * item that `isRedundant` — asked once the old item at that beat is gone — judges equal to
     * the one already in effect there is dropped instead, leaving the beat to its predecessor.
     */
    set(item: T, isRedundant: () => boolean) {
        this.remove(item.beatPosition)
        if (item.beatPosition > 0 && isRedundant()) return
        this._items = [...this._items, item]
        if (item.beatPosition === 0) this._leadingExplicit = true
    }

    /** Demote the leading item to inherited (no longer a carry-forward boundary). */
    demoteLeading() {
        this._leadingExplicit = false
    }

    /**
     * Carry-forward: put `make()` in as the inherited leading item, unless the leading item is
     * explicit or `isCurrent` says it already matches. Returns whether anything changed.
     */
    replaceLeadingInherited(make: () => T, isCurrent: () => boolean): boolean {
        if (this._leadingExplicit || isCurrent()) return false
        this._items = [make(), ...this._items.filter((item) => item.beatPosition !== 0)]
        return true
    }
}
