import { fill, makeScore, pitched } from '@mushee/notation/testing'
import { Fragment, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'

import { NoteGroup } from '../../src/components/NoteGroup'

/** NoteGroup is memo()ed and hook-free: render its inner function directly. */
const renderNoteGroup = (NoteGroup as unknown as { type: (props: Parameters<typeof NoteGroup>[0]) => ReactElement }).type

/** A pitched note's group, landing or not. */
function render(landing?: boolean): ReactElement<{ className?: string }> {
    const score = makeScore(1)
    const [note] = fill(score, 0, [pitched('D', 4, 'w')]).notes
    const layout = score.layout.measureLayoutFor(score.measures[0])
    return renderNoteGroup({ layout: layout.noteLayoutFor(note), stem: layout.stemFor(note), beamed: false, landing }) as ReactElement<{
        className?: string
    }>
}

describe('NoteGroup landing', () => {
    it('wraps a landing note’s parts in one group that fades in with the note-land keyframe', () => {
        const group = render(true)
        expect(group.type).toBe('g')
        expect(group.props.className).toBe('animate-[note-land_200ms_var(--ease-solkey)]')
    })

    it('keeps any other note’s parts flat, unwrapped', () => {
        expect(render(false).type).toBe(Fragment)
        expect(render().type).toBe(Fragment)
    })
})
