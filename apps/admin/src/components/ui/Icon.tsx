import type { ReactElement } from 'react'

/**
 * Custom Solkey glyph set — "Precision Maverick". Drawn on a 24px grid with
 * 2px strokes, squared terminals, and mitered joins so the icons read like
 * technical schematics next to Space Grotesk. Filled details (noteheads,
 * indicator dots) opt out of the stroke locally.
 *
 * The registry deliberately includes reserved glyphs that no call site uses
 * yet (transport, sharing, billing, status, …) so future features pull from
 * the same visual language instead of reaching for a foreign icon pack.
 */
const GLYPHS: Record<string, ReactElement> = {
    'alert-triangle': (
        <>
            <path d="M12 3 21.5 19.5H2.5L12 3Z" />
            <path d="M12 9.5V14" />
            <circle cx="12" cy="17" r="1.3" fill="currentColor" stroke="none" />
        </>
    ),
    'arrow-left': (
        <>
            <path d="M20 12H5" />
            <path d="m11 5-7 7 7 7" />
        </>
    ),
    'arrow-right': (
        <>
            <path d="M4 12h15" />
            <path d="m13 5 7 7-7 7" />
        </>
    ),
    'audio-lines': (
        <>
            <path d="M4 10v4" />
            <path d="M8 6v12" />
            <path d="M12 3v18" />
            <path d="M16 8v8" />
            <path d="M20 11v2" />
        </>
    ),
    bell: (
        <>
            <path d="M12 4a6 6 0 0 0-6 6v4.5L4 18h16l-2-3.5V10a6 6 0 0 0-6-6Z" />
            <path d="M10.5 21h3" />
        </>
    ),
    'bell-off': (
        <>
            <path d="M12 4a6 6 0 0 0-6 6v4.5L4 18h16l-2-3.5V10a6 6 0 0 0-6-6Z" />
            <path d="M10.5 21h3" />
            <path d="m4 4 16 16" />
        </>
    ),
    bookmark: <path d="M6.5 21V3.5h11V21L12 16.5 6.5 21Z" />,
    calendar: (
        <>
            <path d="M3.5 5.5h15a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-13Z" />
            <path d="M8 3v4" />
            <path d="M16 3v4" />
            <path d="M3.5 10.5h17" />
            <path d="M15.5 15h.01" />
        </>
    ),
    check: <path d="m5 12.5 4.5 4.5L19 7" />,
    'check-circle': (
        <>
            <circle cx="12" cy="12" r="8.5" />
            <path d="m8 12.5 2.8 2.8 5.2-6.3" />
        </>
    ),
    'chevron-down': <path d="m6 9 6 6 6-6" />,
    'chevron-left': <path d="m15 6-6 6 6 6" />,
    'chevron-right': <path d="m9 6 6 6-6 6" />,
    'chevron-up': <path d="m6 15 6-6 6 6" />,
    circle: (
        <>
            <circle cx="12" cy="12" r="8" />
            <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
        </>
    ),
    clipboard: (
        <>
            <rect x="9" y="2.5" width="6" height="3.5" />
            <path d="M15.5 4.5H17a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h1.5" />
        </>
    ),
    clock: (
        <>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7v5l3.5 2" />
        </>
    ),
    cloud: <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />,
    copy: (
        <>
            <path d="M8.5 8.5h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-10Z" />
            <path d="M15.5 4.5h-9a2 2 0 0 0-2 2v9" />
        </>
    ),
    'credit-card': (
        <>
            <path d="M2.5 5.5h17a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-11Z" />
            <path d="M2.5 10h19" />
            <path d="M6 14.5h4" />
        </>
    ),
    crown: (
        <>
            <path d="M4.5 18 3 8l5.5 4.5L12 5l3.5 7.5L21 8l-1.5 10H4.5Z" />
            <path d="M5 21h14" />
        </>
    ),
    delete: (
        <>
            <path d="M9.5 5.5H21v13H9.5L3 12l6.5-6.5Z" />
            <path d="m11.5 9.5 5 5" />
            <path d="m16.5 9.5-5 5" />
        </>
    ),
    download: (
        <>
            <path d="M12 3.5V15" />
            <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
            <path d="M4 17v3.5h16V17" />
        </>
    ),
    error: (
        <>
            <path d="M8.6 3h6.8L21 8.6v6.8L15.4 21H8.6L3 15.4V8.6L8.6 3Z" />
            <path d="M12 8v5" />
            <circle cx="12" cy="16.5" r="1.3" fill="currentColor" stroke="none" />
        </>
    ),
    'external-link': (
        <>
            <path d="M10.5 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4.5" />
            <path d="M14.5 4H20v5.5" />
            <path d="m20 4-7.5 7.5" />
        </>
    ),
    eye: (
        <>
            <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
            <circle cx="12" cy="12" r="3" />
        </>
    ),
    'eye-off': (
        <>
            <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
            <circle cx="12" cy="12" r="3" />
            <path d="m4 4 16 16" />
        </>
    ),
    feather: (
        <>
            <path d="M12.67 19a2 2 0 0 0 1.42-.59l6.15-6.17a6 6 0 0 0-8.49-8.49L5.59 9.91A2 2 0 0 0 5 11.33V19Z" />
            <path d="M16 8 2 22" />
            <path d="M17.5 15H9" />
        </>
    ),
    file: (
        <>
            <path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5Z" />
            <path d="M13.5 3.5V9H19" />
        </>
    ),
    'file-music': (
        <>
            <path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5Z" />
            <path d="M13.5 3.5V9H19" />
            <path d="M12 16.1v-5l3.4 1" />
            <circle cx="10.4" cy="16.1" r="1.6" fill="currentColor" stroke="none" />
        </>
    ),
    filter: <path d="M21 4.5H3l7 8.5v5.5l4 2.5v-8l7-8.5Z" />,
    flag: (
        <>
            <path d="M5 21.5V3.5" />
            <path d="M5 4.5h14.5l-3.5 4.5 3.5 4.5H5" />
        </>
    ),
    folder: <path d="M3.5 18.5v-13H9l2 2.5h9.5v10.5H3.5Z" />,
    gem: (
        <>
            <path d="M6 4h12l4 5.5L12 21 2 9.5Z" />
            <path d="M2 9.5h20" />
            <path d="m8.5 9.5 3.5 11.5 3.5-11.5" />
        </>
    ),
    gift: (
        <>
            <rect x="3" y="7.5" width="18" height="4.5" />
            <path d="M5 12v8.5h14V12" />
            <path d="M12 7.5v13" />
            <path d="M7.75 7.5a2.4 2.4 0 0 1 0-4.8C11 2.7 12 7.5 12 7.5s1-4.8 4.25-4.8a2.4 2.4 0 0 1 0 4.8" />
        </>
    ),
    globe: (
        <>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M3.5 12h17" />
            <path d="M12 3.5c3.4 4.7 3.4 12.3 0 17-3.4-4.7-3.4-12.3 0-17Z" />
        </>
    ),
    grid: (
        <>
            <rect x="3.5" y="3.5" width="7" height="7" />
            <rect x="13.5" y="3.5" width="7" height="7" />
            <rect x="3.5" y="13.5" width="7" height="7" />
            <rect x="13.5" y="13.5" width="7" height="7" />
        </>
    ),
    'grip-vertical': (
        <>
            <path d="M9 5.5h.01" />
            <path d="M15 5.5h.01" />
            <path d="M9 12h.01" />
            <path d="M15 12h.01" />
            <path d="M9 18.5h.01" />
            <path d="M15 18.5h.01" />
        </>
    ),
    headphones: (
        <>
            <path d="M3.5 16v-2.5a8.5 8.5 0 0 1 17 0V16" />
            <rect x="3.5" y="14.5" width="4.5" height="6" rx="1.5" />
            <rect x="16" y="14.5" width="4.5" height="6" rx="1.5" />
        </>
    ),
    heart: (
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.51 4.04 3 5.5l7 7Z" />
    ),
    'help-circle': (
        <>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M9.2 9a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.3-2.8 3.7" />
            <circle cx="12" cy="17" r="1.3" fill="currentColor" stroke="none" />
        </>
    ),
    home: (
        <>
            <path d="m3.5 11.5 8.5-8 8.5 8" />
            <path d="M5.5 10v10h13V10" />
            <path d="M10 20v-5.5h4V20" />
        </>
    ),
    infinity: (
        <path d="M12 12c-2-2.5-3.5-4-5.5-4a4 4 0 0 0 0 8c2 0 3.5-1.5 5.5-4s3.5-4 5.5-4a4 4 0 0 1 0 8c-2 0-3.5-1.5-5.5-4" />
    ),
    info: (
        <>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 11.5V17" />
            <circle cx="12" cy="8" r="1.3" fill="currentColor" stroke="none" />
        </>
    ),
    keyboard: (
        <>
            <path d="M2.5 6.5h17a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-9Z" />
            <path d="M6.5 10.5h.01" />
            <path d="M10 10.5h.01" />
            <path d="M13.5 10.5h.01" />
            <path d="M17 10.5h.01" />
            <path d="M8.5 14h7" />
        </>
    ),
    link: (
        <>
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </>
    ),
    list: (
        <>
            <path d="M4 6h.01" />
            <path d="M4 12h.01" />
            <path d="M4 18h.01" />
            <path d="M8.5 6h12" />
            <path d="M8.5 12h12" />
            <path d="M8.5 18h12" />
        </>
    ),
    loader: (
        <>
            <path d="M12 2.5v4" />
            <path d="M12 17.5v4" />
            <path d="M2.5 12h4" />
            <path d="M17.5 12h4" />
            <path d="m5.3 5.3 2.8 2.8" />
            <path d="m15.9 15.9 2.8 2.8" />
            <path d="m18.7 5.3-2.8 2.8" />
            <path d="m8.1 15.9-2.8 2.8" />
        </>
    ),
    lock: (
        <>
            <path d="M5 10.5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8Z" />
            <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
            <path d="M12 15.5h.01" />
        </>
    ),
    mail: (
        <>
            <path d="M3 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Z" />
            <path d="m3.5 6.5 8.5 6 8.5-6" />
        </>
    ),
    menu: (
        <>
            <path d="M3.5 6h17" />
            <path d="M3.5 12h17" />
            <path d="M3.5 18h17" />
        </>
    ),
    'message-circle': <path d="M8 19.9A9 9 0 1 0 4.1 16L2.5 21.5 8 19.9Z" />,
    metronome: (
        <>
            <path d="M9.5 3.5h5L18 20.5H6L9.5 3.5Z" />
            <path d="M7 16.5h10" />
            <path d="m12 16.5 4-8.5" />
        </>
    ),
    mic: (
        <>
            <rect x="9" y="2.5" width="6" height="11.5" rx="3" />
            <path d="M5 11.5v.5a7 7 0 0 0 14 0v-.5" />
            <path d="M12 19v2.5" />
        </>
    ),
    'mic-off': (
        <>
            <rect x="9" y="2.5" width="6" height="11.5" rx="3" />
            <path d="M5 11.5v.5a7 7 0 0 0 14 0v-.5" />
            <path d="M12 19v2.5" />
            <path d="m4 4 16 16" />
        </>
    ),
    minus: <path d="M4.5 12h15" />,
    moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
    'more-horizontal': (
        <>
            <path d="M5 12h.01" />
            <path d="M12 12h.01" />
            <path d="M19 12h.01" />
        </>
    ),
    'more-vertical': (
        <>
            <path d="M12 5h.01" />
            <path d="M12 12h.01" />
            <path d="M12 19h.01" />
        </>
    ),
    music: (
        <>
            <path d="M9.6 17.4V6.4l9.8-1.8V16" />
            <circle cx="7.2" cy="17.4" r="2.4" fill="currentColor" stroke="none" />
            <circle cx="17" cy="16" r="2.4" fill="currentColor" stroke="none" />
        </>
    ),
    pause: (
        <>
            <path d="M8.5 5v14" />
            <path d="M15.5 5v14" />
        </>
    ),
    pencil: (
        <>
            <path d="M17 3.5 20.5 7 8 19.5l-4.5 1 1-4.5L17 3.5Z" />
            <path d="M14.5 6 18 9.5" />
        </>
    ),
    piano: (
        <>
            <rect x="2.5" y="6.5" width="19" height="11" />
            <path d="M7.25 6.5v5.5" />
            <path d="M12 6.5v5.5" />
            <path d="M16.75 6.5v5.5" />
        </>
    ),
    play: <path d="M7.5 4.5 19.5 12 7.5 19.5Z" />,
    plus: (
        <>
            <path d="M12 4.5v15" />
            <path d="M4.5 12h15" />
        </>
    ),
    printer: (
        <>
            <path d="M6.5 8.5V3.5h11v5" />
            <path d="M6.5 17H5.5a2 2 0 0 1-2-2v-4.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2h-1" />
            <rect x="6.5" y="13.5" width="11" height="7" />
        </>
    ),
    redo: (
        <>
            <path d="m15 14 4.5-4.5L15 5" />
            <path d="M19.5 9.5h-11A4.5 4.5 0 0 0 4 14v6" />
        </>
    ),
    'refresh-cw': (
        <>
            <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6l2.7 2.4" />
            <path d="M20.7 3.4v5h-5" />
        </>
    ),
    repeat: (
        <>
            <path d="m17.5 2.5 3.5 3.5-3.5 3.5" />
            <path d="M3.5 11.5V10a4 4 0 0 1 4-4H21" />
            <path d="m6.5 21.5-3.5-3.5 3.5-3.5" />
            <path d="M20.5 12.5V14a4 4 0 0 1-4 4H3" />
        </>
    ),
    'rotate-ccw': (
        <>
            <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.3 8.4" />
            <path d="M3.3 3.4v5h5" />
        </>
    ),
    scissors: (
        <>
            <circle cx="6" cy="6" r="2.75" />
            <circle cx="6" cy="18" r="2.75" />
            <path d="M20.5 4 8.1 15.9" />
            <path d="M14.7 14.7 20.5 20" />
            <path d="M8.1 8.1 12 12" />
        </>
    ),
    search: (
        <>
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m15.5 15.5 5.5 5.5" />
        </>
    ),
    send: (
        <>
            <path d="M21.5 2.5 14.3 21.5l-3.7-8.1-8.1-3.7Z" />
            <path d="M21.5 2.5 10.6 13.4" />
        </>
    ),
    settings: (
        <>
            <circle cx="12" cy="12" r="6.5" />
            <path d="m12 12 3.2-3.2" />
            <path d="M12 2.5v2" />
            <path d="M12 19.5v2" />
            <path d="M2.5 12h2" />
            <path d="M19.5 12h2" />
        </>
    ),
    'share-2': (
        <>
            <circle cx="6" cy="12" r="2.75" />
            <circle cx="17.5" cy="5.5" r="2.75" />
            <circle cx="17.5" cy="18.5" r="2.75" />
            <path d="m8.4 10.7 6.7-3.9" />
            <path d="m8.4 13.3 6.7 3.9" />
        </>
    ),
    shield: <path d="M12 3l8 3.5v6L12 21l-8-8.5v-6Z" />,
    'skip-back': (
        <>
            <path d="M5.5 5v14" />
            <path d="M19 5.5 9.5 12l9.5 6.5Z" />
        </>
    ),
    'skip-forward': (
        <>
            <path d="M18.5 5v14" />
            <path d="M5 5.5 14.5 12 5 18.5Z" />
        </>
    ),
    'sliders-horizontal': (
        <>
            <path d="M3 6h18" />
            <path d="M3 12h18" />
            <path d="M3 18h18" />
            <path d="M15 3v6" />
            <path d="M8 9v6" />
            <path d="M17.5 15v6" />
        </>
    ),
    sparkles: (
        <>
            <path d="M11 5l2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" />
            <path d="M19 3v4" />
            <path d="M17 5h4" />
        </>
    ),
    square: <rect x="6" y="6" width="12" height="12" />,
    star: (
        <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
    ),
    sun: (
        <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5v3" />
            <path d="M12 18.5v3" />
            <path d="M2.5 12h3" />
            <path d="M18.5 12h3" />
            <path d="m15.9 8.1 2.8-2.8" />
            <path d="M8.1 8.1 5.3 5.3" />
            <path d="m15.9 15.9 2.8 2.8" />
            <path d="m8.1 15.9-2.8 2.8" />
        </>
    ),
    tag: (
        <>
            <path d="M3.5 3.5H12l8.5 8.5-8.5 8.5-8.5-8.5V3.5Z" />
            <path d="M8 8h.01" />
        </>
    ),
    'trash-2': (
        <>
            <path d="M4 7h16" />
            <path d="M9.5 7V4.5h5V7" />
            <path d="M5.5 7l1.2 13.5h10.6L18.5 7" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
        </>
    ),
    undo: (
        <>
            <path d="m9 14-4.5-4.5L9 5" />
            <path d="M4.5 9.5h11a4.5 4.5 0 0 1 4.5 4.5v6" />
        </>
    ),
    upload: (
        <>
            <path d="M12 15V4" />
            <path d="m6.5 9.5 5.5-5.5 5.5 5.5" />
            <path d="M4 17v3.5h16V17" />
        </>
    ),
    user: (
        <>
            <circle cx="12" cy="7.5" r="4" />
            <path d="M5 20.5a7 7 0 0 1 14 0" />
        </>
    ),
    'user-plus': (
        <>
            <circle cx="9.5" cy="7.5" r="3.75" />
            <path d="M3 20.5a6.5 6.5 0 0 1 13 0" />
            <path d="M19 8.5v6" />
            <path d="M16 11.5h6" />
        </>
    ),
    users: (
        <>
            <circle cx="9" cy="8" r="3.5" />
            <path d="M2.5 20.5a6.5 6.5 0 0 1 13 0" />
            <path d="M16.5 4.7a3.5 3.5 0 0 1 0 6.6" />
            <path d="M18 14.7a6.5 6.5 0 0 1 3.5 5.8" />
        </>
    ),
    volume: (
        <>
            <path d="M11.5 4.5v15L6.5 15.5H3.5v-7h3l5-4Z" />
            <path d="M15.5 9a4.2 4.2 0 0 1 0 6" />
            <path d="M18.3 6.5a8 8 0 0 1 0 11" />
        </>
    ),
    'volume-x': (
        <>
            <path d="M11.5 4.5v15L6.5 15.5H3.5v-7h3l5-4Z" />
            <path d="m16 9.5 5 5" />
            <path d="m21 9.5-5 5" />
        </>
    ),
    x: (
        <>
            <path d="m5.5 5.5 13 13" />
            <path d="m18.5 5.5-13 13" />
        </>
    ),
    'x-circle': (
        <>
            <circle cx="12" cy="12" r="8.5" />
            <path d="m9 9 6 6" />
            <path d="m15 9-6 6" />
        </>
    ),
    zap: <path d="M13.5 2.5l-9 11h6l-1 8 9-11h-6l1-8Z" />,
    'zoom-in': (
        <>
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m15.5 15.5 5.5 5.5" />
            <path d="M10.5 8v5" />
            <path d="M8 10.5h5" />
        </>
    ),
    'zoom-out': (
        <>
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m15.5 15.5 5.5 5.5" />
            <path d="M8 10.5h5" />
        </>
    ),
}

/** Crossed box — renders when an icon name has no glyph, so gaps are visible. */
const FALLBACK = (
    <>
        <rect x="6.5" y="6.5" width="11" height="11" />
        <path d="m6.5 6.5 11 11" />
    </>
)

/** Every registered icon name — exposed for tests. */
export const iconNames = Object.keys(GLYPHS)

interface IconProps {
    name: string
    /** Pixel size — used for both the glyph and the box. */
    size?: number
    className?: string
}

/**
 * Custom glyph from the Solkey icon set. Color flows from `currentColor`, so
 * the parent controls hue via `text-*` utilities. Size has to stay as a
 * `style` because it is genuinely dynamic per call site.
 */
export function Icon({ name, size = 18, className }: IconProps) {
    return (
        <span
            className={`inline-flex items-center justify-center align-middle leading-none ${className ?? ''}`}
            style={{ width: size, height: size }}>
            <svg
                viewBox="0 0 24 24"
                width={size}
                height={size}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="square"
                strokeLinejoin="miter"
                aria-hidden="true">
                {GLYPHS[name] ?? FALLBACK}
            </svg>
        </span>
    )
}
