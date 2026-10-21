import type { ReactNode } from 'react'

/** One card of the settings page: a heading, an optional subtitle, then its controls. */
export function SettingsSection({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
    return (
        <section className="bg-surface-container-lowest rounded-lg tonal-layer-glow p-7 flex flex-col gap-5">
            <div className="flex flex-col gap-1">
                <h3 className="font-headline font-semibold text-[18px] leading-[1.2] text-on-surface m-0">{title}</h3>
                {subtitle && <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant">{subtitle}</span>}
            </div>
            {children}
        </section>
    )
}
