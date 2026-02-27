interface CursorIndicatorProps {
    x: number
    y: number
}

/**
 * A blue teardrop/raindrop shape pointing upward, used to indicate the cursor position
 * below the staff. The point of the teardrop is at the top (pointing toward the note).
 */
export function CursorIndicator({ x, y }: CursorIndicatorProps) {
    return (
        <path
            d="M 0,-7 C -3.5,-3 -4.5,0 -4.5,2.5 A 4.5,4.5 0 1,0 4.5,2.5 C 4.5,0 3.5,-3 0,-7 Z"
            transform={`translate(${x},${y})`}
            fill="#1e90ff"
        />
    )
}
