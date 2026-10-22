'use client'

import { useEffect, useRef } from 'react'

import type { BindableCommand, Keybindings } from '@/lib/Keybindings'
import { useSaveKeyboardShortcuts, useSettings } from '@/lib/queries'

/**
 * Keyboard shortcuts follow the account: adopt the server's override set once it loads (or
 * push this device's up when the account has none yet), then mirror every change.
 */
export function useAccountKeybindings<C extends BindableCommand>(keybindings: Keybindings<C>): void {
    const { data: settings } = useSettings()
    const { mutate: saveShortcuts } = useSaveKeyboardShortcuts()
    const shortcutsSyncedRef = useRef(false)
    useEffect(() => {
        if (settings && !shortcutsSyncedRef.current) {
            shortcutsSyncedRef.current = true
            if (settings.keyboardShortcuts) keybindings.hydrate(settings.keyboardShortcuts)
            else if (keybindings.hasCustomizations) saveShortcuts(keybindings.toStored())
        }
        keybindings.onDidChange = (stored) => saveShortcuts(stored)
        return () => {
            keybindings.onDidChange = undefined
        }
    }, [settings, keybindings, saveShortcuts])
}
