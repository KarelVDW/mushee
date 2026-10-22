import { INTERACTION_BLUE } from './constants'

interface InputCursorProps {
    x: number
    y: number
}

/**
 * The input cursor: a blue teardrop below the staff marking the active note (the editing
 * position — not the playback cursor, and not the selection tint). The point of the teardrop
 * is at the top, pointing up at the note.
 */
export function InputCursor({ x, y }: InputCursorProps) {
    return (
        <path
            d="M 0,-7 C -3.5,-3 -4.5,0 -4.5,2.5 A 4.5,4.5 0 1,0 4.5,2.5 C 4.5,0 3.5,-3 0,-7 Z"
            transform={`translate(${x},${y})`}
            fill={INTERACTION_BLUE}
        />
    )
}
