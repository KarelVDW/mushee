import { MEASURE_BUTTON_FILL, MEASURE_BUTTON_LABEL, MEASURE_BUTTON_STROKE } from './constants'

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
            data-export-exclude
            onClick={(e) => {
                e.stopPropagation()
                if (!disabled) onClick()
            }}
            className={disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
            opacity={disabled ? 0.3 : 1}>
            <rect
                x={x}
                y={y}
                width={size}
                height={size}
                rx={2}
                fill={MEASURE_BUTTON_FILL}
                stroke={MEASURE_BUTTON_STROKE}
                strokeWidth={0.75}
            />
            <text
                x={x + size / 2}
                y={y + size / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={size * 0.7}
                fontFamily="system-ui, sans-serif"
                fontWeight={500}
                fill={MEASURE_BUTTON_LABEL}
                className="select-none">
                {label}
            </text>
        </g>
    )
}
