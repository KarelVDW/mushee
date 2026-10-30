import { TextLink } from '@mushee/ui'
import Link from 'next/link'

import { EmptyNote, PageHeading } from '@/components/Layout'

export default function NotFound() {
    return (
        <>
            <PageHeading eyebrow="Not found" title="Nothing here" />
            <EmptyNote title="This page doesn't exist on this machine">
                <p className="m-0">
                    The run, dataset or clip may live only in another checkout — results are git-tracked, the corpus is not. Start from the{' '}
                    <TextLink as={Link} href="/">
                        overview
                    </TextLink>
                    .
                </p>
            </EmptyNote>
        </>
    )
}
