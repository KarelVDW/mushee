/**
 * The settings page's tabs and how a URL addresses them (`/settings?tab=plan`), so an
 * upgrade button, a reload or a shared link lands on the exact tab to act in. The default
 * tab, Profile, lives at the bare `/settings`.
 */
export const SETTINGS_TABS = ['profile', 'plan', 'recordings', 'account'] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]

/** The tab a page opens on when the URL names none. */
export const DEFAULT_SETTINGS_TAB: SettingsTab = 'profile'

function isSettingsTab(value: string): value is SettingsTab {
    return (SETTINGS_TABS as readonly string[]).includes(value)
}

/** The tab a settings URL's query names with `?tab=`, or null when it names none or an unknown one. */
export function settingsTabFrom(search: string): SettingsTab | null {
    const tab = new URLSearchParams(search).get('tab')
    return tab && isSettingsTab(tab) ? tab : null
}

/** The URL of a tab: the bare `/settings` for the default tab, `/settings?tab=<id>` for the others. */
export function settingsTabPath(tab: SettingsTab): string {
    return tab === DEFAULT_SETTINGS_TAB ? '/settings' : `/settings?tab=${tab}`
}
