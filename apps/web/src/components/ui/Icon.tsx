const ICON_ALIASES: Record<string, string> = {
    music: 'music_note',
    play: 'play_arrow',
    pause: 'pause',
    square: 'stop',
    circle: 'fiber_manual_record',
    'audio-lines': 'graphic_eq',
    search: 'search',
    plus: 'add',
    pencil: 'edit',
    'trash-2': 'delete',
    check: 'check',
    x: 'close',
    'arrow-left': 'arrow_back',
    'arrow-right': 'arrow_forward',
    eye: 'visibility',
    'eye-off': 'visibility_off',
    user: 'person',
    users: 'group',
    'sliders-horizontal': 'tune',
    bell: 'notifications',
    shield: 'shield',
    feather: 'edit_note',
    cloud: 'cloud',
    mic: 'mic',
    'mic-off': 'mic_off',
    'refresh-cw': 'refresh',
    mail: 'mail',
    download: 'download',
    link: 'link',
    star: 'star',
    sparkles: 'auto_awesome',
    gem: 'diamond',
    lock: 'lock',
    'external-link': 'open_in_new',
    infinity: 'all_inclusive',
}

interface IconProps {
    name: string
    /** Pixel size — used for both the font-size and the box. */
    size?: number
    className?: string
}

/**
 * Material Symbols Outlined glyph. Color flows from `currentColor`, so the
 * parent controls hue via `text-*` utilities. Size has to stay as a `style`
 * because it controls both font-size and the bounding box dimensions.
 */
export function Icon({ name, size = 18, className }: IconProps) {
    const symbol = ICON_ALIASES[name] ?? name
    return (
        <span
            className={`material-symbols-outlined inline-flex items-center justify-center leading-none ${className ?? ''}`}
            style={{ fontSize: size, width: size, height: size }}>
            {symbol}
        </span>
    )
}
