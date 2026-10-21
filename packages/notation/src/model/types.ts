// The model's own vocabulary: plain string unions shared by the model classes, the
// layout engine, the codecs and the apps. Import-free, so any module can use them.

export type ClefType =
    // G (treble) family
    | 'treble'
    | 'treble8va'
    | 'treble8vb'
    | 'treble15ma'
    | 'treble15mb'
    // C family
    | 'soprano'
    | 'mezzoSoprano'
    | 'alto'
    | 'tenor'
    | 'baritoneC'
    // F (bass) family
    | 'baritoneF'
    | 'bass'
    | 'bass8va'
    | 'bass8vb'
    | 'bass15ma'
    | 'bass15mb'
    | 'subBass'
export type DurationType = 'w' | 'h' | 'q' | '8' | '16'
export type StemDirection = 'up' | 'down'
export type BarlineType = 'single' | 'double' | 'end' | 'none'
export type TieType = 'start' | 'stop' | 'start-stop'
