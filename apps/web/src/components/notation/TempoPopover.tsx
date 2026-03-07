'use client'

import { useEffect, useRef } from 'react'

interface TempoPopoverProps {
    x: number
    y: number
    initialBpm: number
    onSubmit: (bpm: number) => void
    onDismiss: () => void
}

export function TempoPopover({ x, y, initialBpm, onSubmit, onDismiss }: TempoPopoverProps) {
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
    }, [])

    const commit = () => {
        const val = parseInt(inputRef.current?.value ?? '', 10)
        if (!isNaN(val) && val > 0 && val <= 999) {
            onSubmit(val)
        } else {
            onDismiss()
        }
    }

    return (
        <div
            style={{ position: 'absolute', left: x, top: y, zIndex: 50 }}
            className="bg-white border border-gray-300 rounded shadow-md p-2 flex items-center gap-2"
            onMouseDown={(e) => e.stopPropagation()}
        >
            <span className="text-sm text-gray-600 select-none" onMouseDown={(e) => e.preventDefault()}>
                &#9833; =
            </span>
            <input
                ref={inputRef}
                type="number"
                min={1}
                max={999}
                defaultValue={initialBpm}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commit() }
                    if (e.key === 'Escape') { e.preventDefault(); onDismiss() }
                    e.stopPropagation()
                }}
                onBlur={commit}
                className="w-16 border border-gray-300 rounded px-1 py-0.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
        </div>
    )
}
