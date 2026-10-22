'use client'

import { useEffect, useState } from 'react'

import { type SelectionGestureOptions, SelectionGestureRecognizer, type SelectionGestures } from './SelectionGestureRecognizer'

/**
 * One {@link SelectionGestureRecognizer} for the component's lifetime, listening for releases on
 * the window while mounted. The recognizer reads the latest options on every event, so its
 * handler identities stay stable and the window listeners never need re-binding.
 */
export function useSelectionGestures<T>(options: SelectionGestureOptions<T>): SelectionGestures<T> {
    const [recognizer] = useState(() => new SelectionGestureRecognizer(options))
    recognizer.options = options
    useEffect(() => {
        recognizer.attach(window)
        return () => recognizer.dispose()
    }, [recognizer])
    return recognizer
}
