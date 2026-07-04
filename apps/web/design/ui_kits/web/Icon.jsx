// Icon component — renders the custom Sheemu glyph set ("Precision Maverick"):
// 24px grid, 2px strokes, squared terminals, mitered joins. Mirrors
// src/components/ui/Icon.tsx; keep the glyph data in sync with it.
const GLYPHS = {
    'arrow-left': '<path d="M20 12H5"/><path d="m11 5-7 7 7 7"/>',
    'arrow-right': '<path d="M4 12h15"/><path d="m13 5 7 7-7 7"/>',
    'audio-lines': '<path d="M4 10v4"/><path d="M8 6v12"/><path d="M12 3v18"/><path d="M16 8v8"/><path d="M20 11v2"/>',
    bell: '<path d="M12 4a6 6 0 0 0-6 6v4.5L4 18h16l-2-3.5V10a6 6 0 0 0-6-6Z"/><path d="M10.5 21h3"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    circle: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    download: '<path d="M12 3.5V15"/><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/><path d="M4 17v3.5h16V17"/>',
    error: '<path d="M8.6 3h6.8L21 8.6v6.8L15.4 21H8.6L3 15.4V8.6L8.6 3Z"/><path d="M12 8v5"/><circle cx="12" cy="16.5" r="1.3" fill="currentColor" stroke="none"/>',
    'external-link':
        '<path d="M10.5 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4.5"/><path d="M14.5 4H20v5.5"/><path d="m20 4-7.5 7.5"/>',
    eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off':
        '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/><path d="m4 4 16 16"/>',
    feather: '<path d="M12.67 19a2 2 0 0 0 1.42-.59l6.15-6.17a6 6 0 0 0-8.49-8.49L5.59 9.91A2 2 0 0 0 5 11.33V19Z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/>',
    gem: '<path d="M6 4h12l4 5.5L12 21 2 9.5Z"/><path d="M2 9.5h20"/><path d="m8.5 9.5 3.5 11.5 3.5-11.5"/>',
    infinity: '<path d="M12 12c-2-2.5-3.5-4-5.5-4a4 4 0 0 0 0 8c2 0 3.5-1.5 5.5-4s3.5-4 5.5-4a4 4 0 0 1 0 8c-2 0-3.5-1.5-5.5-4"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11.5V17"/><circle cx="12" cy="8" r="1.3" fill="currentColor" stroke="none"/>',
    keyboard:
        '<path d="M2.5 6.5h17a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-9Z"/><path d="M6.5 10.5h.01"/><path d="M10 10.5h.01"/><path d="M13.5 10.5h.01"/><path d="M17 10.5h.01"/><path d="M8.5 14h7"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    lock: '<path d="M5 10.5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8Z"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><path d="M12 15.5h.01"/>',
    mail: '<path d="M3 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Z"/><path d="m3.5 6.5 8.5 6 8.5-6"/>',
    mic: '<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5 11.5v.5a7 7 0 0 0 14 0v-.5"/><path d="M12 19v2.5"/>',
    'mic-off':
        '<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5 11.5v.5a7 7 0 0 0 14 0v-.5"/><path d="M12 19v2.5"/><path d="m4 4 16 16"/>',
    music: '<path d="M9.6 17.4V6.4l9.8-1.8V16"/><circle cx="7.2" cy="17.4" r="2.4" fill="currentColor" stroke="none"/><circle cx="17" cy="16" r="2.4" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8.5 5v14"/><path d="M15.5 5v14"/>',
    pencil: '<path d="M17 3.5 20.5 7 8 19.5l-4.5 1 1-4.5L17 3.5Z"/><path d="M14.5 6 18 9.5"/>',
    play: '<path d="M7.5 4.5 19.5 12 7.5 19.5Z"/>',
    plus: '<path d="M12 4.5v15"/><path d="M4.5 12h15"/>',
    'refresh-cw': '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6l2.7 2.4"/><path d="M20.7 3.4v5h-5"/>',
    'rotate-ccw': '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.3 8.4"/><path d="M3.3 3.4v5h5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5.5 5.5"/>',
    shield: '<path d="M12 3l8 3.5v6L12 21l-8-8.5v-6Z"/>',
    'sliders-horizontal':
        '<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/><path d="M15 3v6"/><path d="M8 9v6"/><path d="M17.5 15v6"/>',
    sparkles: '<path d="M11 5l2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"/><path d="M19 3v4"/><path d="M17 5h4"/>',
    square: '<rect x="6" y="6" width="12" height="12"/>',
    'trash-2': '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M5.5 7l1.2 13.5h10.6L18.5 7"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    user: '<circle cx="12" cy="7.5" r="4"/><path d="M5 20.5a7 7 0 0 1 14 0"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20.5a6.5 6.5 0 0 1 13 0"/><path d="M16.5 4.7a3.5 3.5 0 0 1 0 6.6"/><path d="M18 14.7a6.5 6.5 0 0 1 3.5 5.8"/>',
    x: '<path d="m5.5 5.5 13 13"/><path d="m18.5 5.5-13 13"/>',
}

// Crossed box — renders when an icon name has no glyph, so gaps are visible.
const FALLBACK_GLYPH = '<rect x="6.5" y="6.5" width="11" height="11"/><path d="m6.5 6.5 11 11"/>'

function Icon({ name, size = 18, color = 'currentColor', style }) {
    return (
        <span
            style={{
                color,
                lineHeight: 1,
                display: 'inline-flex',
                width: size,
                height: size,
                alignItems: 'center',
                justifyContent: 'center',
                verticalAlign: 'middle',
                ...style,
            }}>
            <svg
                viewBox="0 0 24 24"
                width={size}
                height={size}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="square"
                strokeLinejoin="miter"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: GLYPHS[name] || FALLBACK_GLYPH }}
            />
        </span>
    )
}

Object.assign(window, { Icon })
