import { Icon } from '@/components/ui'

interface FaqListProps {
    items: readonly { question: string; answer: string }[]
    /** The rows' fill: `lowest` (white) on a page-tone section, `low` on a white one. */
    tone?: 'lowest' | 'low'
}

/**
 * The marketing pages' questions and answers: a list of native disclosures, so every
 * question stays visible and an answer opens on a tap, with no script. The first answer
 * starts open. Questions are 17px and at least 44px tall; answers read at 16px. The chevron
 * turns over 150ms as a row opens, and snaps under reduced motion.
 */
export function FaqList({ items, tone = 'lowest' }: FaqListProps) {
    const fill = tone === 'low' ? 'bg-surface-container-low' : 'bg-surface-container-lowest'
    return (
        <div className="flex flex-col gap-3">
            {items.map((item, index) => (
                <details key={item.question} open={index === 0} className={`group rounded-md ${fill}`}>
                    <summary className="flex items-center justify-between gap-4 min-h-11 px-5 py-3 rounded-md cursor-pointer list-none [&::-webkit-details-marker]:hidden focus-ring font-headline font-semibold text-[17px] leading-[1.3] tracking-[-0.005em] text-on-surface">
                        <span>{item.question}</span>
                        <span
                            aria-hidden
                            className="shrink-0 inline-flex text-on-surface-variant transition-transform duration-150 ease-solkey group-open:rotate-180 motion-reduce:transition-none">
                            <Icon name="chevron-down" size={18} />
                        </span>
                    </summary>
                    <p className="m-0 px-5 pb-5 font-body font-normal text-[16px] leading-[1.6] text-on-surface-variant">{item.answer}</p>
                </details>
            ))}
        </div>
    )
}
