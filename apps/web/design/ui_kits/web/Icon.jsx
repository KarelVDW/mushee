// Icon component — renders Material Symbols Outlined.
// Accepts both Material Symbols names ("play_arrow") and the Lucide aliases
// the rest of the kit uses ("play"), via a small mapping table.
const ICON_ALIASES = {
    // Lucide → Material Symbols
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

function Icon({ name, size = 18, color = 'currentColor', style }) {
    const symbol = ICON_ALIASES[name] || name
    return (
        <span
            className="material-symbols-outlined"
            style={{
                fontSize: size,
                color,
                lineHeight: 1,
                display: 'inline-flex',
                width: size,
                height: size,
                alignItems: 'center',
                justifyContent: 'center',
                ...style,
            }}>
            {symbol}
        </span>
    )
}

Object.assign(window, { Icon })
