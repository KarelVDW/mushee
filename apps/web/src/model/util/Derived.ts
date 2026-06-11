/**
 * The single caching primitive for derived model state (see ARCHITECTURE.md).
 *
 * A `Derived` pairs a compute function with a version probe. The value is
 * recomputed lazily on read whenever the probed version has moved since the
 * last computation — so mutators never rebuild anything; they only bump a
 * version, and reads pay for exactly the recomputation they need.
 */
export class Derived<T> {
    private state: { version: number; value: T } | null = null

    constructor(
        private readonly version: () => number,
        private readonly compute: () => T,
    ) {}

    get value(): T {
        const version = this.version()
        if (this.state?.version !== version) {
            this.state = { version, value: this.compute() }
        }
        return this.state.value
    }
}
