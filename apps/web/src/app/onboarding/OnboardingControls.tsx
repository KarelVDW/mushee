'use client'

import { type ReactNode } from 'react'

import { Eyebrow, ModalTitle, SubHeadline } from '@/components/ui'

export function StepShell({ title, subtitle, children }: { title: ReactNode; subtitle: ReactNode; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-5">
            <ModalTitle>{title}</ModalTitle>
            <SubHeadline>{subtitle}</SubHeadline>
            {children}
        </div>
    )
}

export function StepProgress({ step, total }: { step: number; total: number }) {
    return (
        <div className="flex gap-1.5 items-center">
            {Array.from({ length: total }).map((_, i) => (
                <div
                    key={i}
                    className={[
                        'h-1 rounded-sm flex-1 max-w-12 transition-colors duration-200 ease-solkey',
                        i <= step ? 'bg-primary-container' : 'bg-surface-container',
                    ].join(' ')}
                />
            ))}
            <Eyebrow className="ml-2">
                {Math.min(step + 1, total)} of {total}
            </Eyebrow>
        </div>
    )
}

export function OptionCard({ active, onClick, title, body }: { active?: boolean; onClick?: () => void; title: ReactNode; body?: ReactNode }) {
    return (
        <button
            onClick={onClick}
            type="button"
            className={[
                'text-left border-0 rounded-md px-5 py-4.5 cursor-pointer flex gap-3.5 items-start transition-colors duration-150 ease-solkey',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                active ? 'bg-primary-soft text-on-primary-soft' : 'bg-surface-container-lowest text-on-surface tonal-layer-glow hover:bg-surface-container',
            ].join(' ')}>
            <div className="flex flex-col gap-1">
                <span className="font-body font-semibold text-[15px] leading-[1.2]">{title}</span>
                {body && (
                    <span
                        className={[
                            'font-body font-normal text-[13px] leading-[1.4] opacity-85',
                            active ? 'text-on-primary-soft' : 'text-on-surface-variant',
                        ].join(' ')}>
                        {body}
                    </span>
                )}
            </div>
        </button>
    )
}
