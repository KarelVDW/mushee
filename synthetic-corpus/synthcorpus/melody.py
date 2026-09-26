"""Monophonic melodic material extracted from real (public-domain) scores.

A `Phrase` is a contiguous excerpt of one part of one score: notes and rests in
quarter-length beats, plus the notational hints a performer would use (slurs,
staccato, accents, fermatas, breath marks, the source's meter and tempo).
Everything downstream — range fitting, the performer model, rendering — works
from these, so the corpus inherits real melodic shapes, rhythms and phrase
lengths instead of toy melodies.
"""

from __future__ import annotations

import hashlib
import json
import random
from dataclasses import asdict, dataclass, field
from pathlib import Path

from music21 import articulations, chord, corpus, expressions, meter, note, spanner, stream, tempo

CACHE = Path(__file__).resolve().parent.parent / 'work' / 'melody-cache'


@dataclass
class ScoreNote:
    onset: float  # quarter lengths from phrase start
    dur: float
    midi: int
    slur_start: bool = False
    slur_end: bool = False
    in_slur: bool = False
    staccato: bool = False
    accent: bool = False
    tenuto: bool = False
    fermata: bool = False
    breath_after: bool = False


@dataclass
class Phrase:
    source: str  # corpus path + part
    style: str  # 'fiddle-tune', 'chorale', 'polyphony', 'quartet', 'air', ...
    part: str
    meter: str
    tempo_qpm: float | None
    notes: list[ScoreNote] = field(default_factory=list)

    @property
    def span(self) -> tuple[int, int]:
        ms = [n.midi for n in self.notes]
        return min(ms), max(ms)

    @property
    def length_q(self) -> float:
        last = self.notes[-1]
        return last.onset + last.dur

    def transposed(self, semis: int) -> Phrase:
        p = Phrase(self.source, self.style, self.part, self.meter, self.tempo_qpm)
        p.notes = [ScoreNote(**{**asdict(n), 'midi': n.midi + semis}) for n in self.notes]
        return p

    @property
    def id(self) -> str:
        h = hashlib.sha1(json.dumps([self.source, self.part, self.notes[0].onset, len(self.notes)], default=str).encode()).hexdigest()
        return h[:10]


class PartLine:
    """One part of a score flattened to a monophonic event list (rests kept)."""

    def __init__(self, source: str, style: str, part: stream.Part, part_name: str):
        self.source = source
        self.style = style
        self.part_name = part_name
        self.events: list[tuple[float, float, int | None, dict]] = []  # onset, dur, midi|None(rest), marks
        self.meter = '4/4'
        self.tempo_qpm: float | None = None
        self._read(part)

    def _read(self, part: stream.Part) -> None:
        try:
            part = part.stripTies()
        except Exception:
            pass
        flat = part.flatten()
        ts = flat.getElementsByClass(meter.TimeSignature)
        real = [t for t in ts if t.numerator >= 2 and t.denominator in (2, 4, 8)]
        if real:
            self.meter = real[0].ratioString
        mm = flat.getElementsByClass(tempo.MetronomeMark)
        if mm and mm[0].number:
            self.tempo_qpm = float(mm[0].getQuarterBPM() or mm[0].number)
        slurred: dict[int, str] = {}
        for sp in flat.getElementsByClass(spanner.Slur):
            els = sp.getSpannedElements()
            for i, el in enumerate(els):
                slurred[id(el)] = 'start' if i == 0 else ('end' if i == len(els) - 1 else 'mid')
        for el in flat.notesAndRests:
            if el.duration.isGrace or el.quarterLength <= 0:
                continue
            onset = float(el.offset)
            dur = float(el.quarterLength)
            if isinstance(el, note.Rest):
                self.events.append((onset, dur, None, {}))
                continue
            if isinstance(el, chord.Chord):
                midi = max(p.midi for p in el.pitches)
            else:
                midi = el.pitch.midi
            arts = el.articulations
            marks = {
                'staccato': any(isinstance(a, (articulations.Staccato, articulations.Staccatissimo)) for a in arts),
                'accent': any(isinstance(a, (articulations.Accent, articulations.StrongAccent)) for a in arts),
                'tenuto': any(isinstance(a, articulations.Tenuto) for a in arts),
                'fermata': any(isinstance(x, expressions.Fermata) for x in el.expressions),
                'breath': any(isinstance(a, articulations.BreathMark) for a in arts),
                'slur': slurred.get(id(el)),
            }
            self.events.append((onset, dur, midi, marks))
        # Overlaps (multiple voices in one part): keep the upper line by onset.
        self.events.sort(key=lambda e: (e[0], -(e[2] or -1)))
        cleaned: list[tuple[float, float, int | None, dict]] = []
        for e in self.events:
            if cleaned and e[0] < cleaned[-1][0] + cleaned[-1][1] - 1e-6:
                prev = cleaned[-1]
                if abs(e[0] - prev[0]) < 1e-6:
                    continue  # same onset, lower voice
                cleaned[-1] = (prev[0], e[0] - prev[0], prev[2], prev[3])  # truncate
            cleaned.append(e)
        self.events = cleaned

    def phrases(self, min_q: float, max_q: float, rng: random.Random) -> list[Phrase]:
        """Cut the line into excerpts of min_q..max_q quarters, preferring to
        start after a rest/long note and end on a rest or long note."""
        ev = [e for e in self.events]
        out: list[Phrase] = []
        i = 0
        n = len(ev)
        while i < n:
            while i < n and ev[i][2] is None:
                i += 1
            if i >= n:
                break
            start_q = ev[i][0]
            j = i
            best_end = None
            while j < n and ev[j][0] - start_q < max_q:
                end_q = ev[j][0] + ev[j][1] - start_q
                is_rest_next = j + 1 < n and ev[j + 1][2] is None
                long_note = ev[j][2] is not None and ev[j][1] >= 1.5
                if end_q >= min_q and (is_rest_next or long_note or j + 1 == n):
                    best_end = j
                    if rng.random() < 0.5:
                        break
                j += 1
            if best_end is None:
                best_end = min(j, n - 1)
            notes = [e for e in ev[i : best_end + 1] if e[2] is not None]
            if len(notes) >= 6:
                ph = Phrase(self.source, self.style, self.part_name, self.meter, self.tempo_qpm)
                slur_open = False
                for k, (on, du, mi, mk) in enumerate(notes):
                    s = mk.get('slur')
                    if s == 'start':
                        slur_open = True
                    sn = ScoreNote(
                        onset=on - start_q,
                        dur=du,
                        midi=mi,
                        slur_start=s == 'start',
                        slur_end=s == 'end',
                        in_slur=slur_open or s in ('mid', 'end'),
                        staccato=mk.get('staccato', False),
                        accent=mk.get('accent', False),
                        tenuto=mk.get('tenuto', False),
                        fermata=mk.get('fermata', False),
                        breath_after=mk.get('breath', False),
                    )
                    if s == 'end':
                        slur_open = False
                    ph.notes.append(sn)
                out.append(ph)
            i = best_end + 1
        return out


@dataclass
class SourceSpec:
    pattern: str  # corpus-relative glob
    style: str
    parts: str = 'all'  # 'all' | 'first' | comma list of part-name substrings


SOURCES: list[SourceSpec] = [
    SourceSpec('ryansMammoth/*.abc', 'fiddle-tune'),
    SourceSpec('oneills1850/*.abc', 'fiddle-tune'),
    SourceSpec('airdsAirs/*.abc', 'air'),
    SourceSpec('bach/bwv*.mxl', 'chorale'),
    SourceSpec('bach/bwv*.xml', 'chorale'),
    SourceSpec('palestrina/*.krn', 'polyphony'),
    SourceSpec('monteverdi/*.mxl', 'madrigal'),
    SourceSpec('haydn/*/*.mxl', 'quartet'),
    SourceSpec('mozart/*/*.mxl', 'quartet'),
    SourceSpec('beethoven/*.mxl', 'quartet'),
    SourceSpec('beethoven/*/*.mxl', 'quartet'),
    SourceSpec('corelli/*.mxl', 'baroque'),
    SourceSpec('handel/*.mxl', 'baroque'),
    SourceSpec('cpebach/*.mxl', 'baroque'),
]


class MelodyLibrary:
    """Parses the corpus once and caches every phrase as JSON."""

    def __init__(self, min_q: float = 12, max_q: float = 40, seed: int = 7):
        self.min_q = min_q
        self.max_q = max_q
        self.seed = seed
        self.phrases: list[Phrase] = []

    @staticmethod
    def _corpus_root() -> Path:
        return Path(corpus.__file__).parent

    def build(self, max_files_per_source: int | None = None, log=print) -> None:
        CACHE.mkdir(parents=True, exist_ok=True)
        rng = random.Random(self.seed)
        root = self._corpus_root()
        for spec in SOURCES:
            files = sorted(root.glob(spec.pattern))
            if max_files_per_source:
                files = files[:max_files_per_source]
            for f in files:
                key = hashlib.sha1(f'{f}:{self.min_q}:{self.max_q}:{self.seed}'.encode()).hexdigest()[:16]
                cf = CACHE / f'{key}.json'
                if cf.exists():
                    self.phrases.extend(self._load(cf))
                    continue
                got: list[Phrase] = []
                try:
                    parsed = corpus.parse(str(f)) if f.suffix != '.abc' else corpus.parse(str(f))
                    scores = list(parsed.scores) if isinstance(parsed, stream.Opus) else [parsed]
                    for si, sc in enumerate(scores):
                        parts = list(sc.parts) if sc.parts else [sc]
                        for pi, part in enumerate(parts):
                            name = part.partName or f'part{pi}'
                            src = f'{f.relative_to(root)}#{si}:{name}'
                            line = PartLine(src, spec.style, part, name)
                            got.extend(line.phrases(self.min_q, self.max_q, rng))
                except Exception as e:  # malformed corpus files are skipped, not fatal
                    log(f'skip {f.name}: {type(e).__name__}: {e}')
                cf.write_text(json.dumps([asdict(p) for p in got]))
                self.phrases.extend(got)
            log(f'{spec.pattern}: {len(self.phrases)} phrases so far')

    @staticmethod
    def _load(cf: Path) -> list[Phrase]:
        out = []
        for d in json.loads(cf.read_text()):
            notes = [ScoreNote(**n) for n in d.pop('notes')]
            p = Phrase(**d)
            p.notes = notes
            out.append(p)
        return out
