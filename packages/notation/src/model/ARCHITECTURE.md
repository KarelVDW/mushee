# Model & Layout Architecture

This document is the rulebook for everything under `src/model/`. When a change doesn't fit these
rules, change the code shape — not the rules — or update this document deliberately in the same PR.

## The two layers

```
model/           the MUSIC   — semantic state + editing operations
model/layout/    the INK     — everything geometric or presentational, derived from the model
```

**The serializer test:** a piece of state belongs in the model if and only if it survives into
MusicXML (notes, pitches, durations, ties-as-intent, clefs, key signatures, time signatures,
tempos, barline types, instrument) or is an editing-session concern (dirty tracking). Everything
else — widths, row packing, shows-clef/key/time decisions, x-positions, beam grouping, stem
geometry, displayed accidentals, cancellation naturals — is ink and lives in the layout layer.

**Dependency direction is one-way.** Layout reads the model. The model never reads, stores, or
writes layout state. There are no "invalidate my layout" calls in the model and no model fields
that exist only for drawing.

## Directory map

```
src/model/          entities and value objects (Score, Measure, Note, Pitch, …), the model's
                    vocabulary (types.ts), clef tables (clefs.ts), note-line constants (staffLines.ts)
src/model/io/       the codecs — ScoreSerializer/ScoreDeserializer (the saved document), the MusicXML
                    and MIDI importers and exporters — and MusicXml.ts, the wire format they share
src/model/util/     model infrastructure (Derived, BeatPositionedList, LeadingTrack) and the
                    algorithms over the model: TupletFinder (a measure's tuplet groups),
                    AccidentalMinimizer and MeasureRebar (Score's respelling and rebarring),
                    CarriedAccidentals (the bar's accidental-carry rule, shared by the minimizer
                    and the engraver), DurationSpeller (metrical spelling for the importers)
src/model/layout/   the ink: layout snapshots, the intrinsic widths they pack with, the Staff
                    coordinate system, and the helpers that build them (BeamFinder, Resizer,
                    MeasureMetrics)
src/engraving/      glyph metrics, Bravura font data and engraving constants
src/components/     the React renderer, which draws layout snapshots, and its palette
src/lib/            React hooks and stores shared by the renderer and the apps
src/testing/        score builders for tests
```

The model (layout included) reads `engraving/` for its metrics and never reads `components/` or
`lib/`; `engraving/` reads nothing else in the package. The renderer reads all three.

## Caching: three tiers, one rule each

1. **Immutable value objects** — `Pitch`, `Duration`, `Interval`, `TimeSignature`, `Instrument`.
   No identity, no parent, no mutation. Anything derived from them may be cached forever
   (e.g. a `TimeSignature`'s layout). Sharing instances is always safe.

2. **Model entities** — `Score`, `Measure`, `Note`: mutable, with identity. Their owned
   children `Clef`, `KeySignature` and `Tempo` have identity too but are immutable after
   construction — an edit replaces the child, and the owning measure's `touch()` records it.
   `Tuplet` is not stored state at all: it is a per-version snapshot `TupletFinder` derives
   from its measure's notes. Derived state is held **only** in `Derived<T>` values
   (`model/util/Derived.ts`): a lazy compute paired with a version check. Every public mutator
   ends in exactly one `touch()` — the single choke point that bumps the version. Nothing is
   eagerly rebuilt inside a mutator; private helpers never touch. If you find yourself writing
   `invalidateX()` or calling a rebuild from a mutator, you are reintroducing the old bug
   class — use a version.

    The two choke points differ, and the difference matters to callers:
    - `Score.touch()` bumps the score version and fires `onChange`. Every public `Score`
      mutator — the composite ones (`replace`, `transpose`, `minimizeAccidentals`,
      `setInstrument`, `removeMeasures`, …) included — ends in exactly one, so a view hears
      exactly one `onChange` per edit. Score-level dirty state (structure, instrument) is
      marked by the mutator, not by `touch()`.
    - `Measure.touch()` bumps the measure version and calls `Score.measureChanged`, which bumps
      the score version and marks the measure persistence-dirty but fires **no** `onChange`.
      Calling a `Measure` mutator directly therefore changes the model (and the next
      `score.layout`) without notifying views — edit through `Score`, whose mutators end in
      their own touch.

3. **Layout snapshots** — every `*Layout` class in `model/layout/`, and the widths they are
   built from. Immutable: every output is a `readonly` field computed in the constructor. No
   lazy internal state, no getters that read live model state (a getter is only allowed as a
   trivial projection of the object's own readonly fields). The snapshot's identity is the
   React memo key — renderers take the snapshot itself as a prop, not an id — so a layout must
   never change after construction: it is _replaced_, never mutated or partially invalidated.
   Staleness is decided in one place: `ScoreLayout` compares model versions (plus the explicit
   context signatures in its reuse check) and **reuses** previous sub-layouts whose inputs are
   unchanged, so memoized React subtrees stay stable. The folder's other modules (`Staff`,
   `BeamFinder`, `Resizer`, `MeasureMetrics`) are pure inputs to a rebuild; nothing keeps them.

`Score.layout` is the only gateway into the layout layer. The gateway carries one presentation
input: `Score.layoutWidth` (set via `setLayoutWidth`), the row-packing budget used for responsive
reflow on narrow viewports. It is not semantic state — it is never serialized and changing it
moves neither the version nor dirty tracking (it only notifies `onChange` so views re-read
`layout`); the cached snapshot is keyed on (version, width). The requested width is a _floor_,
not a guarantee: a single measure denser than the packing budget widens the effective
`ScoreLayout.scoreWidth` until it fits (views render scaled-to-fit against `layout.scoreWidth`,
so the score shrinks on screen). Layout must always resolve — it never throws on any
model + width combination.

The `layout` getters on `Measure` and `Note` are conveniences that delegate into the current
`ScoreLayout`; they own no cache of their own. A key signature, tuplet or tempo marking is laid
out by its measure's layout (`keyLayoutFor`, `tupletLayoutFor`, `tempoLayoutFor` — the
renderer reads those), so they carry no getter. A note outside the score has no layout — the
editor's ghost note is drawn from `NoteLayout.preview(note, clef)`.
Only `Clef` and `TimeSignature` layouts are context-free — they depend only on the clef type and
the digits — so they are shared: `ClefLayout.of(type)` keeps one per clef type, and a
`TimeSignature` caches its own forever, per tier 1 semantics. Widths are ink, so each layout
owns its width (`clef.layout.width`, `timeSignature.layout.width`); the model stores none.

Layout constructors take **explicit context parameters** (widths, accidental maps, sibling
layouts). They never reach back through `model.layout` getters — that hides dependencies and
recurses into the `ScoreLayout` under construction.

## Parent references (what used to be called "DI")

- An **owned child** takes its parent as a `readonly` constructor parameter:
  `Clef`, `KeySignature`, `Tempo` (→ measure), `Measure` (→ score), `Tuplet` (→ measure).
- An object that **migrates between parents** uses attach/detach: only `Note`
  (`setMeasure(measure | undefined)`), because `replace` moves notes across measures.
- **Value objects get no parent.** `TimeSignature` has no `measure` — instances are shared
  freely across measures (the deserializer reuses one instance for every inherited measure).
- Nothing else is ever injected. There is no service container and no other indirection.

## Mutation & derived-state flow

```
Score mutator   → private helpers + Measure mutators → this.touch()   (exactly once, at the end)
Score.touch()   → score version++ → fire onChange
Measure mutator → mutate plain fields → this.touch()                 (exactly once, at the end)
Measure.touch() → measure version++ → score.measureChanged(): score version++, mark dirty (no onChange)
read of derived value → Derived checks version → recompute if stale
read of score.layout  → rebuild ScoreLayout if score.version or layoutWidth moved, reusing unchanged parts
```

Carry-forward of inherited leading clefs/keys is **semantic** (the serializer depends on it),
so it is propagated eagerly by `Score.propagateContext()` from every score-level mutator that can
change measure context (`addMeasure`, `appendMeasure`, `addMeasureAdoptingTempo`,
`removeMeasures`, `setTimeSignature`, `setClef`, `setKeySignature`, `transpose`,
`minimizeAccidentals`, and `setInstrument` when the transposition changes). The applicators it
drives (`Measure.applyInheritedClef/applyInheritedKey`) move only the measure's version: an
inherited value doesn't change the serialized form, so nothing is marked dirty, and the calling
Score mutator owns the touch. Calling `measure.setClef(...)` directly changes only that
measure — propagation is a Score responsibility, never a side effect of layout.

Dirty tracking leaves the model through one typed payload, `ScorePatch` (`io/MusicXml.ts`):
`Score.flushDirty()` returns the dirty measures keyed by index — or every measure after a
structural change — plus the part list after an instrument change, then clears the dirty state
(`null` when nothing changed). Only two calls mark dirt from outside a mutator:
`redirty(patch)` puts a failed save's patch back, and `markInstrumentDirty()` flags the part list
of a score rebuilt from a snapshot whose instrument differs from the saved one. Clearing is
private to the flush.

## Navigation

One traversal implementation lives on `Score` (`nextNote`, `previousNote`,
`getNextMeasure`, `getPreviousMeasure`), built on `Measure.getNextNote/getPreviousNote` for the
steps inside one measure. `Note.getNext()/getPrevious()` and `Measure.getNext()/getPrevious()`
are thin delegates kept for ergonomics — do not add a second traversal path.

Time has one implementation on `Score` too: `bpmAtBeat` (the marking at or before a position;
`bpmAt(note)` delegates), `secondsAt` (the one clock — seconds from the top of the score, every
marking applied at its exact beat) and `positionAfter` (a beat count from a measure back to a
measure and beat). Playback, the metronome and recording read these rather than walking tempo
markings or measure lengths themselves.

## Row packing (layout layer)

`ScoreLayout` packs measures into rows with a bounded fixed-point iteration:
diff-based shows-flags → element widths → greedy row fill (bounded by `MAX_MEASURES_PER_ROW`
and the measure-button reserve) → row starts force clef+key → repeat until the flags
stabilize. It is a pure function of the semantic model — it never writes anything back
into measures, and there is no re-entrancy to guard against.

## Conventions

- Model classes: plain fields for owned state, getters for everything derived. Never
  constructor-computed derived state.
- Layout classes: readonly fields for everything. Never lazily-computed internals.
- Beat-positioned collections (clefs, keys, tempos) share `BeatPositionedList` for their
  at/at-or-before/before/last/mid-measure queries — don't re-implement those loops. Clefs and
  keys also share their writes through `LeadingTrack` (redundant mid-measure changes,
  explicit vs inherited leading item); its writes replace the array, never mutate it.
- Keep dead members out: if a method has no production caller, delete it (tests alone don't
  justify keeping API surface).
- Importing the model from an app: top-level classes, constants and types come from the
  `@mushee/notation/model` barrel; deep paths are only for `io/`, `util/` and `layout/` modules.
  Two deliberate exceptions: `packages/playback` deep-imports the classes it needs so it never
  loads the layout and font graph, and apps/api's `recording-editor-contract.test.ts` imports
  the source by relative path (the API does not depend on `@mushee/notation`).
