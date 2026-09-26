"""Timbre registry: every instrument the app offers → how to perform and render it.

App instrument ids (packages/notation/src/model/Instrument.ts) collapse onto
timbres (horn / french-horn / horn-in-c / horn-in-d all sound like a horn).
Each timbre knows its idiomatic sounding range, the player's habits
(`PlayerProfile`), the sampler's behaviour (`SamplerStyle`), which melodic
material suits it, and every real-recording sample source available for it.
Sources are resolved lazily: a missing asset directory just drops that source.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .performance import PlayerProfile
from .sampler import SamplerStyle
from .samples import ExsLoader, RootCalibrator, SampleSet, ZonesJsonLoader

ROOT = Path(__file__).resolve().parent.parent
APPLE = ROOT / 'assets' / 'apple' / 'x'
SAMPLES = ROOT / 'assets' / 'samples'


@dataclass
class Source:
    """A sample set for a timbre. kind 'zones' → assets/samples/<path>; 'exs' → Apple pack."""

    kind: str
    path: str
    art_map: list[tuple[str, str]] = field(default_factory=list)
    skip: str | None = None
    arts: set[str] | None = None  # zones: restrict to these articulations
    label: str = ''
    licence: str = ''

    @property
    def id(self) -> str:
        return self.label or (self.path.split('/')[0] + '-' + self.path.split('/')[-1] if self.kind == 'zones' else 'apple-' + Path(self.path).stem.lower().replace(' ', '-').replace('+', ''))

    def available(self) -> bool:
        if self.kind == 'zones':
            return (SAMPLES / self.path / 'zones.json').exists()
        return any(APPLE.rglob(self.path))

    def load(self) -> SampleSet:
        if self.kind == 'zones':
            return RootCalibrator.calibrate(ZonesJsonLoader(SAMPLES / self.path, self.arts).load(self.id))
        exs = next(APPLE.rglob(self.path))
        pack = next(p for p in APPLE.iterdir() if str(exs).startswith(str(p)))
        return RootCalibrator.calibrate(ExsLoader(exs, pack, self.art_map, self.skip).load(self.id))


# ---------------------------------------------------------------- families

WIND = dict(legato_default=0.5, detache_gap=(0.03, 0.07), intonation_sd=5, breath_capacity=(5.0, 9.0))
REED = dict(legato_default=0.5, detache_gap=(0.03, 0.07), intonation_sd=6, breath_capacity=(5.0, 9.0))
BRASS = dict(legato_default=0.45, detache_gap=(0.03, 0.08), intonation_sd=6, breath_capacity=(4.0, 8.0))
BOWED = dict(legato_default=0.55, detache_gap=(0.02, 0.06), intonation_sd=8, vibrato_rate=(5.2, 6.6), vibrato_depth=(10, 25))
PLUCK = dict(legato_default=0.2, detache_gap=(0.01, 0.04), fixed_pitch=True)

S_WIND = SamplerStyle(release=(0.05, 0.12), legato_xfade=(0.025, 0.05), legato_entry=(0.06, 0.12))
S_BRASS = SamplerStyle(release=(0.06, 0.14), legato_xfade=(0.03, 0.06), legato_entry=(0.06, 0.12))
S_BOWED = SamplerStyle(release=(0.10, 0.25), legato_xfade=(0.04, 0.08), legato_entry=(0.08, 0.15))
S_PLUCK = SamplerStyle(percussive=True, damp_tau=(0.06, 0.18), dyn_tilt=0.3)
S_PIANO = SamplerStyle(percussive=True, damp_tau=(0.12, 0.35), dyn_tilt=0.0)


@dataclass
class Timbre:
    id: str
    app_ids: list[str]
    category: str  # 'instrument' | 'voice'
    range: tuple[int, int]  # comfortable sounding MIDI range for melodies
    styles: list[str]
    player: PlayerProfile
    sampler: SamplerStyle
    sources: list[Source]
    qpm: tuple[float, float] = (60, 100)
    min_note: float = 0.11  # seconds: shortest written note in a clip (verifiable, and typical of real takes)
    parts: tuple[str, ...] = ()  # preferred score part names (substring match)
    dynamics: tuple[str, ...] = ('p', 'mp', 'mf', 'mf', 'f')
    pitch_set: tuple[int, ...] | None = None  # restricted scale (e.g. highland chanter)

    def available_sources(self) -> list[Source]:
        return [s for s in self.sources if s.available()]


def Z(path: str, arts: set[str] | None = None) -> Source:
    return Source('zones', path, arts=arts)


def X(name: str, art_map: list[tuple[str, str]], skip: str | None = None) -> Source:
    return Source('exs', name, art_map, skip)


WW_MAP = [('^Vibrato$', 'vib'), ('^Legato$', 'sus'), ('Staccato:M', 'stac')]
FLUTES_MAP = [('^Vibrato$', 'vib'), ('^Standard', 'sus'), ('^Slur$', 'leg'), ('^Slur And Vibrato$|^Vibrato Slur$', 'vib')]

TIMBRES: list[Timbre] = [
    # ---------------- keyboard / plucked
    Timbre('piano', ['piano'], 'instrument', (48, 84), ['air', 'fiddle-tune', 'chorale', 'quartet', 'baroque'],
           PlayerProfile('keys', legato_default=0.7, detache_gap=(0.01, 0.05), fixed_pitch=True, sustain_limit=4.0), S_PIANO,
           [Z('salamander/piano'), X('Steinway Grand Piano 2.exs', [('Steinway', 'sus')], skip='No Dampers')], qpm=(60, 110), min_note=0.07),
    Timbre('guitar', ['guitar'], 'instrument', (52, 76), ['air', 'fiddle-tune', 'baroque', 'chorale'],
           PlayerProfile('pluck', **PLUCK, sustain_limit=2.5), S_PLUCK,
           [Z('iowa/guitar'), Z('freepats/classical-guitar')], qpm=(56, 100), min_note=0.1),
    Timbre('bass-guitar', ['bass-guitar'], 'instrument', (28, 55), ['chorale', 'quartet', 'air'],
           PlayerProfile('pluck', **PLUCK, sustain_limit=2.5), S_PLUCK,
           [Z('karoryfer/bass-guitar'), X('Fingerstyle Electric Bass.exs', [('^Group', 'sus')])], qpm=(70, 110), min_note=0.12, parts=('Bass', 'Cello', 'Violoncello')),
    # ---------------- strings
    Timbre('violin', ['violin', 'violin-lead'], 'instrument', (55, 88), ['fiddle-tune', 'air', 'quartet', 'baroque'],
           PlayerProfile('bowed', vibrato=True, glide_prob=0.1, **BOWED), S_BOWED,
           [Z('iowa/violin'), Z('vsco/violin'), Z('philharmonia/violin')], qpm=(56, 110), parts=('Violin', 'Soprano')),
    Timbre('viola', ['viola'], 'instrument', (48, 79), ['quartet', 'air', 'chorale'],
           PlayerProfile('bowed', vibrato=True, glide_prob=0.1, **BOWED), S_BOWED,
           [Z('iowa/viola'), Z('philharmonia/viola')], qpm=(56, 100), parts=('Viola', 'Alto', 'Tenor')),
    Timbre('cello', ['cello', 'violoncello'], 'instrument', (36, 69), ['quartet', 'air', 'chorale', 'baroque'],
           PlayerProfile('bowed', vibrato=True, glide_prob=0.12, **BOWED), S_BOWED,
           [Z('karoryfer/cello'), Z('iowa/cello'), Z('vsco/cello'), Z('philharmonia/cello')], qpm=(52, 96), parts=('Violoncello', 'Cello', 'Bass', 'Tenor')),
    Timbre('contrabass', ['contrabass'], 'instrument', (28, 55), ['chorale', 'quartet', 'air'],
           PlayerProfile('bowed', vibrato=True, **{**BOWED, 'vibrato_depth': (8, 18)}), S_BOWED,
           [Z('vsco/contrabass'), Z('sfzinstruments/contrabass'), Z('philharmonia/double-bass'), Z('iowa/contrabass', arts={'sus', 'vib', 'nonvib'}),
            X('Upright Jazz Bass.exs', [('^Group', 'sus')])], qpm=(52, 92), min_note=0.14, parts=('Bass', 'Violoncello', 'Cello')),
    Timbre('erhu', ['erhu'], 'instrument', (62, 93), ['air', 'chorale', 'fiddle-tune'],
           PlayerProfile('bowed', vibrato=True, glide_prob=0.45, glide_time=(0.06, 0.16), **{**BOWED, 'intonation_sd': 12, 'vibrato_depth': (15, 40)}), S_BOWED,
           [X('Erhu.exs', [('^Sus [DAG]+ (Up|Down) rr\\d ', 'sus'), ('^Staccato', 'stac')]), Z('sfzinstruments/erhu')], qpm=(50, 88), min_note=0.12),
    # ---------------- woodwinds
    Timbre('flute', ['flute', 'orchestral-flute', 'traditional-flute'], 'instrument', (60, 93), ['fiddle-tune', 'air', 'baroque', 'quartet'],
           PlayerProfile('wind', vibrato=True, vibrato_depth=(8, 20), **WIND), S_WIND,
           [Z('iowa/flute'), Z('vsco/flute'), X('Flute Solo+.exs', WW_MAP), Z('philharmonia/flute')], qpm=(60, 110)),
    Timbre('alto-flute', ['alto-flute'], 'instrument', (55, 81), ['air', 'chorale', 'quartet'],
           PlayerProfile('wind', vibrato=True, vibrato_depth=(8, 18), **WIND), S_WIND,
           [Z('iowa/alto-flute'), Z('sso/alto-flute')], qpm=(56, 96)),
    Timbre('piccolo', ['piccolo'], 'instrument', (74, 98), ['fiddle-tune', 'air', 'quartet'],
           PlayerProfile('wind', **WIND), S_WIND,
           [X('Piccolo+.exs', [('^Legato$', 'sus'), ('Staccato:M', 'stac')]), Z('sso/piccolo')], qpm=(64, 110)),
    Timbre('oboe', ['oboe'], 'instrument', (58, 88), ['air', 'quartet', 'baroque', 'chorale'],
           PlayerProfile('reed', vibrato=True, vibrato_depth=(6, 15), **REED), S_WIND,
           [Z('vsco/oboe'), Z('iowa/oboe'), X('Oboe Solo+.exs', WW_MAP), Z('philharmonia/oboe')], qpm=(56, 100)),
    Timbre('english-horn', ['english-horn'], 'instrument', (52, 79), ['air', 'chorale', 'quartet'],
           PlayerProfile('reed', vibrato=True, vibrato_depth=(6, 15), **REED), S_WIND,
           [X('English Horn Solo+.exs', WW_MAP), Z('philharmonia/english-horn'), Z('sso/english-horn')], qpm=(52, 92)),
    Timbre('clarinet-section', ['clarinet-ensemble'], 'instrument', (50, 84), ['chorale', 'air', 'polyphony'],
           PlayerProfile('reed', **REED), S_WIND, [Z('sso/clarinet-section')], qpm=(56, 96), min_note=0.12),
    Timbre('clarinet', ['clarinet', 'concert-clarinet', 'alto-clarinet'], 'instrument', (50, 86), ['air', 'fiddle-tune', 'quartet', 'chorale'],
           PlayerProfile('reed', **REED), S_WIND,
           [Z('vsco/clarinet'), Z('iowa/clarinet'), X('Clarinet Solo+.exs', WW_MAP), Z('philharmonia/clarinet')], qpm=(56, 108)),
    Timbre('bass-clarinet', ['bass-clarinet', 'contrabass-clarinet'], 'instrument', (36, 67), ['chorale', 'air', 'quartet'],
           PlayerProfile('reed', **REED), S_WIND,
           [Z('iowa/bass-clarinet'), Z('philharmonia/bass-clarinet'), Z('sso/bass-clarinet'), Z('philharmonia/contrabass-clarinet')], qpm=(52, 96), min_note=0.12,
           parts=('Bass', 'Tenor', 'Violoncello')),
    Timbre('bassoon', ['bassoon'], 'instrument', (34, 72), ['chorale', 'quartet', 'air', 'baroque'],
           PlayerProfile('reed', vibrato=True, vibrato_depth=(5, 12), **REED), S_WIND,
           [Z('vsco/bassoon'), Z('iowa/bassoon'), X('Bassoon Solo+.exs', WW_MAP), Z('philharmonia/bassoon')], qpm=(52, 100), min_note=0.11,
           parts=('Bass', 'Tenor', 'Violoncello')),
    Timbre('contrabassoon', ['contrabassoon'], 'instrument', (22, 53), ['chorale', 'air'],
           PlayerProfile('reed', **REED), S_WIND,
           [Z('philharmonia/contrabassoon'), Z('sso/contrabassoon')], qpm=(50, 84), min_note=0.18, parts=('Bass',)),
    Timbre('soprano-sax', ['soprano-saxophone'], 'instrument', (56, 87), ['air', 'fiddle-tune', 'chorale'],
           PlayerProfile('reed', vibrato=True, vibrato_depth=(10, 25), **REED), S_WIND,
           [Z('iowa/soprano-sax'), Z('vcsl/soprano-sax'), Z('sfzinstruments/soprano-sax')], qpm=(60, 108)),
    Timbre('alto-sax', ['alto-saxophone'], 'instrument', (49, 80), ['air', 'fiddle-tune', 'chorale', 'quartet'],
           PlayerProfile('reed', vibrato=True, vibrato_depth=(10, 25), **REED), S_WIND,
           [Z('iowa/alto-sax'), Z('karoryfer/alto-sax'), Z('sfzinstruments/alto-sax'), X('Alto Sax.exs', [('ALTO', 'sus')])], qpm=(60, 108)),
    Timbre('tenor-sax', ['tenor-saxophone'], 'instrument', (44, 75), ['air', 'fiddle-tune', 'chorale'],
           PlayerProfile('reed', vibrato=True, vibrato_depth=(10, 25), **REED), S_WIND,
           [Z('vcsl/tenor-sax'), Z('sfzinstruments/tenor-sax')], qpm=(60, 108)),
    Timbre('baritone-sax', ['baritone-saxophone'], 'instrument', (36, 68), ['chorale', 'air', 'quartet'],
           PlayerProfile('reed', vibrato=True, vibrato_depth=(8, 20), **REED), S_WIND,
           [Z('karoryfer/baritone-sax'), Z('sfzinstruments/baritone-sax')], qpm=(56, 100), min_note=0.12, parts=('Bass', 'Tenor', 'Violoncello')),
    # ---------------- brass
    Timbre('trumpet', ['trumpet'], 'instrument', (54, 82), ['air', 'chorale', 'fiddle-tune', 'polyphony'],
           PlayerProfile('brass', **BRASS), S_BRASS,
           [Z('iowa/trumpet'), Z('vsco/trumpet'), Z('philharmonia/trumpet')], qpm=(60, 108)),
    Timbre('french-horn', ['french-horn', 'horn', 'horn-in-c', 'horn-in-d'], 'instrument', (41, 77), ['chorale', 'air', 'polyphony', 'quartet'],
           PlayerProfile('brass', **BRASS), S_BRASS,
           [Z('vsco/french-horn'), Z('iowa/french-horn'), X('French Horn Solo+.exs', [('^Legato:', 'sus'), ('^Staccato:', 'stac')]), Z('philharmonia/french-horn')], qpm=(52, 96),
           min_note=0.11),
    Timbre('trombone', ['trombone'], 'instrument', (40, 72), ['chorale', 'air', 'polyphony'],
           PlayerProfile('brass', glide_prob=0.04, **BRASS), S_BRASS,
           [Z('vsco/trombone'), Z('iowa/trombone'), Z('philharmonia/trombone')], qpm=(52, 100), min_note=0.12, parts=('Tenor', 'Bass', 'Alto')),
    Timbre('euphonium', ['euphonium', 'baritone-horn', 'baritone-horn-treble'], 'instrument', (40, 70), ['chorale', 'air', 'polyphony'],
           PlayerProfile('brass', vibrato=True, vibrato_depth=(6, 14), **BRASS), S_BRASS,
           [Z('euphonium/euphonium'), Z('vsco/tuba'), Z('iowa/tuba'), Z('philharmonia/tuba')], qpm=(52, 96), min_note=0.12,
           parts=('Tenor', 'Bass')),
    Timbre('tuba', ['tuba'], 'instrument', (28, 58), ['chorale', 'air'],
           PlayerProfile('brass', **{**BRASS, 'breath_capacity': (3.5, 6.5)}), S_BRASS,
           [Z('vsco/tuba'), Z('iowa/tuba'), Z('karoryfer/tuba'), Z('philharmonia/tuba')], qpm=(50, 90), min_note=0.18,
           parts=('Bass',)),
    Timbre('brass-section', ['brass'], 'instrument', (48, 79), ['chorale', 'polyphony', 'air'],
           PlayerProfile('brass', **BRASS), S_BRASS,
           [Z('sso/brass-section-all'), X('Trumpets+.exs', [('^Legato:', 'sus'), ('^Staccato:', 'stac')]), X('French Horns+.exs', [('^Legato:', 'sus'), ('^Staccato:', 'stac')]),
            Z('sso/horn-section'), Z('sso/trombone-section')], qpm=(56, 100), min_note=0.12),
    # ---------------- folk & world
    Timbre('recorder', ['recorder', 'alto-recorder-in-f'], 'instrument', (65, 96), ['fiddle-tune', 'air', 'baroque'],
           PlayerProfile('wind', **{**WIND, 'intonation_sd': 9}), S_WIND,
           [Z('vcsl/soprano-recorder'), Z('vcsl/alto-recorder'), Z('vcsl/tenor-recorder'), X('Medieval Recorder+.exs', FLUTES_MAP + [('^Slur$', 'sus')]), Z('freepats/recorder')], qpm=(60, 110)),
    Timbre('tin-whistle', ['tin-whistle'], 'instrument', (74, 98), ['fiddle-tune', 'air'],
           PlayerProfile('wind', **{**WIND, 'intonation_sd': 9, 'legato_default': 0.65}), S_WIND,
           [X('Celtic Tin Whistle+.exs', FLUTES_MAP)], qpm=(70, 116)),
    Timbre('harmonica', ['harmonica'], 'instrument', (60, 86), ['air', 'fiddle-tune', 'chorale'],
           PlayerProfile('freereed', legato_default=0.55, detache_gap=(0.02, 0.06), intonation_sd=6, breath_capacity=(6, 10)), S_WIND,
           [Z('vcsl/harmonica'), Z('vcsl/harmonica-chromatic')], qpm=(60, 104)),
    Timbre('ocarina', ['ocarina'], 'instrument', (69, 89), ['air', 'fiddle-tune'],
           PlayerProfile('wind', **{**WIND, 'intonation_sd': 10}), S_WIND,
           [Z('vcsl/ocarina'), Z('freepats/ocarina')], qpm=(56, 100)),
    Timbre('pan-flute', ['pan-flute'], 'instrument', (62, 91), ['air', 'fiddle-tune'],
           PlayerProfile('wind', **{**WIND, 'legato_default': 0.3}), S_WIND,
           [X('Peruvian Panpipes+.exs', [('^Soft Attack$', 'sus'), ('^Hard Attack$', 'stac')])], qpm=(52, 92)),
    Timbre('shakuhachi', ['shakuhachi-flute'], 'instrument', (62, 86), ['air', 'chorale'],
           PlayerProfile('wind', glide_prob=0.25, glide_time=(0.06, 0.15), **{**WIND, 'intonation_sd': 12}), S_WIND,
           [X('Japanese Shakuhachi Flute+.exs', [('^Vibrato$', 'vib'), ('^Standard$', 'sus')])], qpm=(44, 76), min_note=0.15),
    Timbre('dizi', ['dizi-flute'], 'instrument', (69, 93), ['air', 'fiddle-tune'],
           PlayerProfile('wind', **{**WIND, 'intonation_sd': 9}), S_WIND,
           [X('Chinese Di Zi Flute+.exs', [('^Vibrato$', 'vib'), ('^Standard$', 'sus')]), X('Indian Bansuri Flute+.exs', [('^Vibrato$', 'vib'), ('^Standard$', 'sus')]),
            Z('freesound/dizi')], qpm=(56, 100)),
    Timbre('bagpipe', ['bagpipe'], 'instrument', (67, 81), ['fiddle-tune', 'air'],
           PlayerProfile('pipes', legato_default=1.0, detache_gap=(0.0, 0.0), fixed_pitch=True), S_WIND,
           [Z('freepats/bagpipe'), Z('karoryfer/bagpipe')], qpm=(60, 96), min_note=0.1),
]

BY_ID = {t.id: t for t in TIMBRES}
APP_TO_TIMBRE = {a: t.id for t in TIMBRES for a in t.app_ids}
