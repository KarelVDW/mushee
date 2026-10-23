import type { Metadata } from 'next'

import { NotFoundActions } from './NotFoundActions'

export const metadata: Metadata = { title: 'Page not found' }

// Signed-out visitors land here only under public paths (the auth proxy bounces unknown
// private paths to /login first); the screen picks the way out for each visitor. The page's
// main landmark is here, since ErrorScreen draws only the screen.
export default function NotFound() {
    return (
        <main id="content">
            <NotFoundActions />
        </main>
    )
}
