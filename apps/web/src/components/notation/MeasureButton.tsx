export function MeasureButton({
    x,
    y,
    size,
    label,
    onClick,
    disabled,
}: {
    x: number
    y: number
    size: number
    label: string
    onClick: () => void
    disabled?: boolean
}) {
    return (
        <g
            onClick={(e) => {
                e.stopPropagation()
                if (!disabled) onClick()
            }}
            style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
            opacity={disabled ? 0.3 : 1}>
            <rect x={x} y={y} width={size} height={size} rx={2} fill="white" stroke="#d1d5db" strokeWidth={0.75} />
            <text
                x={x + size / 2}
                y={y + size / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={size * 0.7}
                fontFamily="system-ui, sans-serif"
                fontWeight={500}
                fill="#374151"
                style={{ userSelect: 'none' }}>
                {label}
            </text>
        </g>
    )
}
