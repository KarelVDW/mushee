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

## Caching: three tiers, one rule each

1. **Immutable value objects** — `Pitch`, `Duration`, `TimeSignature`, `Instrument`.
   No identity, no parent, no mutation. Anything derived from them may be cached forever
   (e.g. a `TimeSignature`'s layout). Sharing instances is always safe.

2. **Model entities** — `Score`, `Measure`, `Note`, `Clef`, `KeySignature`, `Tempo`, `Tuplet`.
   Mutable, with identity. Derived state is held **only** in `Derived<T>` values
   (`model/util/Derived.ts`): a lazy compute paired with a version check. Every public mutator
   ends in exactly one `touch()` — the single choke point that bumps the version (and, on
   `Score`, marks persistence-dirty and fires `onChange`). Nothing is eagerly rebuilt inside a
   mutator; private helpers never touch. If you find yourself writing `invalidateX()` or
   calling a rebuild from a mutator, you are reintroducing the old bug class — use a version.

3. **Layout snapshots** — every class in `model/layout/`.
   Immutable: every output is a `readonly` field computed in the constructor. No lazy internal
   state, no getters that read live model state (a getter is only allowed as a trivial
   projection of the object's own readonly fields). `id` is the React memo key, so a layout must
   never change after construction — it is *replaced*, never mutated or partially invalidated.
   Staleness is decided in one place: `ScoreLayout` compares model versions (plus the explicit
   context signatures listed in its reuse check) and **reuses** previous sub-layouts whose
   inputs are unchanged, so memoized React subtrees stay stable.

`Score.layout` is the only gateway into the layout layer. The `layout` getters on `Measure`,
`Note`, `KeySignature`, and `Tuplet` are conveniences that delegate into the current
`ScoreLayout`; they own no cache of their own. (`Clef`, `TimeSignature`, and `Tempo` layouts are
context-free — they depend only on the owning object's immutable fields — so they may be cached
on the instance forever, per tier 1 semantics.)

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
public mutator → mutate plain fields → this.touch()           (exactly once, at the end)
touch()        → version++ → score: mark dirty, fire onChange
read of derived value → Derived checks version → recompute if stale
read of score.layout  → rebuild ScoreLayout if score.version moved, reusing unchanged parts
```

Carry-forward of inherited leading clefs/keys is **semantic** (the serializer depends on it),
so it is propagated eagerly by `Score.propagateContext()` from the score-level mutators that can
change measure context (`addMeasure`, `setClef`, `setKeySignature`, `setInstrument`). Calling
`measure.setClef(...)` directly changes only that measure — propagation is a Score
responsibility, never a side effect of layout.

## Navigation

One traversal implementation lives on `Score` (`nextNote`, `previousNote`,
`getNextMeasure`, `getPreviousMeasure`). `Note.getNext()/getPrevious()` and
`Measure.getNext()/getPrevious()` are thin delegates kept for ergonomics — do not add a second
traversal path.

## Row packing (layout layer)

`ScoreLayout` packs measures into rows with a bounded fixed-point iteration:
diff-based shows-flags → element widths → greedy row fill (same budget as before:
`MAX_MEASURES_PER_ROW`, button-space reserve) → row starts force clef+key → repeat until the
flags stabilize. It is a pure function of the semantic model — it never writes anything back
into measures, and there is no re-entrancy to guard against.

## Conventions

- Model classes: plain fields for owned state, getters for everything derived. Never
  constructor-computed derived state.
- Layout classes: readonly fields for everything. Never lazily-computed internals.
- Beat-positioned collections (clefs, keys, tempos) share `BeatPositionedList` for their
  at/at-or-before/before/last/mid-measure queries — don't re-implement those loops.
- Keep dead members out: if a method has no production caller, delete it (tests alone don't
  justify keeping API surface).
