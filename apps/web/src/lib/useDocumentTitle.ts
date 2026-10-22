'use client'

import { useEffect } from 'react'

/**
 * Names the browser tab `title` (whole, e.g. 'My song — Solkey') while the page is mounted;
 * null leaves the route's own metadata title alone. One source for a title only the client
 * knows (the editor's score name, a share link's score resolved in the browser): the route's
 * metadata `<title>` can land or be rewritten after this runs — Next streams it in late, into
 * the body as often as the head, and hydrating it puts the server's text back — so the hook
 * watches for new `<title>`s anywhere and for edits to the ones there are, and puts its title
 * back on top every time, on every engine, however late. On the way out the tab goes back to
 * what it read before, but only while it still reads this title: a route that brought its own
 * has already replaced it.
 */
export function useDocumentTitle(title: string | null): void {
    useEffect(() => {
        if (title === null) return
        const before = document.title
        const observer = new MutationObserver(() => apply())
        const apply = () => {
            if (document.title !== title) document.title = title
            // Re-observing a target only updates its options, so this never stacks registrations.
            observer.observe(document.documentElement, { childList: true, subtree: true })
            for (const element of document.getElementsByTagName('title')) {
                observer.observe(element, { childList: true, subtree: true, characterData: true })
            }
        }
        apply()
        return () => {
            observer.disconnect()
            if (document.title === title) document.title = before
        }
    }, [title])
}
