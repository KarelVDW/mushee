/** A log-friendly one-liner for any thrown value. */
export function describeError(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}
