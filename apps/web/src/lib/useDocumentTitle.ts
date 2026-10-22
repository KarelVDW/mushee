'use client'

import { useEffect } from 'react'

/**
 * Names the browser tab `title` (whole, e.g. 'My song — Solkey') while the page is mounted;
 * null leaves the route's own metadata title alone. One source for a title only the client
 * knows (the editor's score name, a share link's score resolved in the browser): the route's
 * metadata `<title>` can land after this runs — Next streams it in and React hoists it into
 * `<head>` — so the hook watches the head and puts its title back on top whenever something
 * else lands there, on every engine, however late. On the way out the tab goes back to what it
 * read before, but only while it still reads this title: a route that brought its own has
 * already replaced it.
 */
export function useDocumentTitle(title: string | null): void {
    useEffect(() => {
        if (title === null) return
        const before = document.title
        const apply = () => {
            if (document.title !== title) document.title = title
        }
        apply()
        const observer = new MutationObserver(apply)
        observer.observe(document.head, { childList: true, subtree: true, characterData: true })
        return () => {
            observer.disconnect()
            if (document.title === title) document.title = before
        }
    }, [title])
}
