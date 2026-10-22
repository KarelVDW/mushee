import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS_TAB, SETTINGS_TABS, settingsTabFrom, settingsTabPath } from '@/app/settings/settingsTabs'

describe('settings tabs in the URL', () => {
    it('reads the tab a ?tab= names', () => {
        expect(settingsTabFrom('?tab=plan')).toBe('plan')
        expect(settingsTabFrom('?tab=recordings&plan=pro')).toBe('recordings')
        expect(settingsTabFrom('?tab=account')).toBe('account')
        expect(settingsTabFrom('?tab=profile')).toBe('profile')
    })

    it('names no tab for a missing or unknown ?tab=', () => {
        expect(settingsTabFrom('')).toBeNull()
        expect(settingsTabFrom('?plan=pro')).toBeNull()
        expect(settingsTabFrom('?tab=billing')).toBeNull()
        expect(settingsTabFrom('?tab=')).toBeNull()
    })

    it('keeps the default tab at the bare /settings and addresses the others by ?tab=', () => {
        expect(DEFAULT_SETTINGS_TAB).toBe('profile')
        expect(settingsTabPath('profile')).toBe('/settings')
        expect(settingsTabPath('plan')).toBe('/settings?tab=plan')
        expect(settingsTabPath('recordings')).toBe('/settings?tab=recordings')
        expect(settingsTabPath('account')).toBe('/settings?tab=account')
    })

    it('round-trips every tab through its path', () => {
        for (const tab of SETTINGS_TABS) {
            const search = settingsTabPath(tab).replace('/settings', '')
            expect(settingsTabFrom(search) ?? DEFAULT_SETTINGS_TAB).toBe(tab)
        }
    })
})
