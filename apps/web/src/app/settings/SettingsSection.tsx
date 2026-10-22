import type { ReactNode } from 'react'

/**
 * One card of the settings page: a heading (an h2 under the page title), an optional
 * subtitle, then its controls. `action` sits beside the heading on wider screens and under
 * it on phones, for a card whose only control is one button.
 */
export function SettingsSection({
    title,
    subtitle,
    action,
    children,
}: {
    title: ReactNode
    subtitle?: ReactNode
    action?: ReactNode
    children?: ReactNode
}) {
    return (
        <section className="bg-surface-container-lowest rounded-lg tonal-layer-glow p-7 flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex flex-col gap-1">
                    <h2 className="font-headline font-semibold text-[18px] leading-[1.2] text-on-surface m-0">{title}</h2>
                    {subtitle && (
                        <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant">{subtitle}</span>
                    )}
                </div>
                {action && <div className="shrink-0">{action}</div>}
            </div>
            {children}
        </section>
    )
}
