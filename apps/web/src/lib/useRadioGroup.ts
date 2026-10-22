import { type KeyboardEvent, useRef } from 'react'

/**
 * Where an arrow, Home or End key moves from `index` in a row of `count` items, wrapping at
 * either end; null for any other key, or one held with a modifier (Alt+Left is the browser's
 * Back). Shared by the radio groups and the settings tabs, which move the same way.
 */
export function rovingIndexForKey(
    event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>,
    index: number,
    count: number,
): number | null {
    if (event.altKey || event.ctrlKey || event.metaKey) return null
    const last = count - 1
    switch (event.key) {
        case 'ArrowDown':
        case 'ArrowRight':
            return index === last ? 0 : index + 1
        case 'ArrowUp':
        case 'ArrowLeft':
            return index === 0 ? last : index - 1
        case 'Home':
            return 0
        case 'End':
            return last
        default:
            return null
    }
}

/** What each radio of a group spreads on itself. */
export interface RadioProps {
    ref: (el: HTMLButtonElement | null) => void
    tabIndex: 0 | -1
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

/**
 * The keyboard half of a role="radiogroup" built from buttons, per the ARIA radio group
 * pattern: one Tab stop — the checked radio, or the first while none is checked — and arrow
 * keys that move to the next or previous radio and check it as they go. Space and Enter stay
 * the buttons' own click. Spread `radioProps(index)` on the radio at `index` of `values`.
 */
export function useRadioGroup<T>(values: readonly T[], checked: T | null, onCheck: (value: T) => void) {
    const refs = useRef<(HTMLButtonElement | null)[]>([])
    const tabStop = checked === null ? 0 : Math.max(0, values.indexOf(checked))

    const focus = (index: number) => refs.current[index]?.focus()

    const radioProps = (index: number): RadioProps => ({
        ref: (el) => {
            refs.current[index] = el
        },
        tabIndex: index === tabStop ? 0 : -1,
        onKeyDown: (event) => {
            const target = rovingIndexForKey(event, index, values.length)
            if (target === null) return
            event.preventDefault()
            onCheck(values[target])
            focus(target)
        },
    })

    return { radioProps, focus }
}
