# whistle-real verification worklist (stratified subset)

> **SUPERSEDED 2026-10-30 — kept as history.** No clip on this list was ever verified
> (0 of 40 boxes ticked, every `.meta.json` still `verifiedBy: null`). whistle-real's truth
> now comes from the resynth pass instead (a synthetic copy of each clip, iterated until it
> matches the original, with the notes read from the copy; truthSource `resynth`, see
> `meta/test-data-2026-10.md` and `synthetic-corpus/RESYNTH.md`). The draft TSVs here remain
> the prior that pass starts from. Section 4 was last refreshed from the 2026-09-27
> `onset-policy` run.

Protocol: research/research-whistle-corpus.md §6 — Audacity spectrogram view, correct the TSV in
`scripts/eval/annotations/whistle-real/<clip>.labels.tsv`, tick the clip's box below, then
`pnpm --filter @mushee/api exec tsx scripts/eval/fetch/import-note-labels.ts --dataset=whistle-real --verified-by=karel --verified-list=scripts/eval/annotations/whistle-real/VERIFY-WORKLIST.md`
(stamps exactly the ticked clips; every other clip stays unverified).
Budget ~2–4 min per 10 s clip; this subset ≈ 40–60 min.

## 1. Mid/low routings (4) — is the whistle even the loudest thing here?

- [ ] `freesound-449469` (low, 15 draft notes) — routed low+noise+reverb. "Whistling_mixdown.mp3" — https://freesound.org/people/12064988/sounds/449469/
- [ ] `freesound-540538` (low, 11 draft notes) — routed low+noise. "Silbar/Whistle_Int2_v2.0_(G2).wav" — https://freesound.org/people/eldiariosonoro_/sounds/540538/
- [ ] `freesound-74388` (low, 12 draft notes) — routed low+reverb. "Trill Whistle.wav" — https://freesound.org/people/dland/sounds/74388/
- [ ] `freesound-853247` (mid, 23 draft notes) — routed mid. "Me whistling 01" — https://freesound.org/people/caiogracco/sounds/853247/

## 2. Possibly-processed titles (6)

- [ ] `commons-donna` (high, 33 draft notes) — title keyword. "whistled "La donna è mobile" (Verdi, PD composition), ~8.9 s, median f0 ~1.08 kHz" — https://commons.wikimedia.org/wiki/File:Whistling_la_donna_a_mobile.ogg
- [ ] `commons-glide` (very-high, 24 draft notes) — title keyword. "~11.8 s, reaches ~4.4 kHz — the highest real pitched audio the harness has" — https://commons.wikimedia.org/wiki/File:Whistle.ogg
- [ ] `freesound-368468` (high, 22 draft notes) — title keyword. "WhistleEdited_mixdown.mp3" — https://freesound.org/people/TrentTheBeardGuy/sounds/368468/
- [ ] `freesound-497892` (high, 46 draft notes) — title keyword. "whistle sequence 2" — https://freesound.org/people/PhonosUPF/sounds/497892/
- [ ] `freesound-557347` (very-high, 40 draft notes) — title keyword. "Hyacinthe_double whistle_edited.wav" — https://freesound.org/people/launchsite/sounds/557347/
- [ ] `freesound-786012` (very-high, 12 draft notes) — title keyword. "Whistling Sound Effect" — https://freesound.org/people/EBasinger/sounds/786012/

## 3. Random sample (20 of 107)

- [ ] `freesound-197975` (very-high, 7 draft notes) — random. "Whistle Project 1.wav" — https://freesound.org/people/MacSounds1/sounds/197975/
- [ ] `freesound-411578` (very-high, 18 draft notes) — random. "Whistle.mp3" — https://freesound.org/people/elijahgoodson/sounds/411578/
- [ ] `freesound-540539` (very-high, 29 draft notes) — random. "Silbar/Whistle_Int1_v2.0_(G2).wav" — https://freesound.org/people/eldiariosonoro_/sounds/540539/
- [ ] `freesound-557360` (very-high, 18 draft notes) — random. "Hyacinthe_single long whistle_double long whistle.wav" — https://freesound.org/people/launchsite/sounds/557360/
- [ ] `freesound-732279` (high, 9 draft notes) — random. "Luc_sound_whistle" — https://freesound.org/people/ssud_motion/sounds/732279/
- [ ] `freesound-197973` (very-high, 6 draft notes) — random. "Whistle Project 3.wav" — https://freesound.org/people/MacSounds1/sounds/197973/
- [ ] `freesound-330398` (very-high, 28 draft notes) — random. "Series of whistles 2" — https://freesound.org/people/angelopirellas/sounds/330398/
- [ ] `freesound-705043` (high, 17 draft notes) — random. "bad whistle attempt" — https://freesound.org/people/musselmox/sounds/705043/
- [ ] `freesound-726909` (very-high, 16 draft notes) — random. "Whistling01" — https://freesound.org/people/LudPos/sounds/726909/
- [ ] `freesound-585650` (very-high, 27 draft notes) — random. "BP Whistle Song" — https://freesound.org/people/lidalee34/sounds/585650/
- [ ] `freesound-494518` (very-high, 8 draft notes) — random. "whistle melody" — https://freesound.org/people/PhonosUPF/sounds/494518/
- [ ] `freesound-822457` (high, 27 draft notes) — random. "spooky eerie whistling 01" — https://freesound.org/people/HenryHardhat/sounds/822457/
- [ ] `freesound-610903` (very-high, 20 draft notes) — random. "visslar, whistling robin hood-AIFF.aiff" — https://freesound.org/people/MadameAnita/sounds/610903/
- [ ] `freesound-585649` (very-high, 27 draft notes) — random. "Whistle.mp3" — https://freesound.org/people/lidalee34/sounds/585649/
- [ ] `freesound-795020` (high, 6 draft notes) — random. "just a whistle sound, nothing to see here" — https://freesound.org/people/TheCurtainedAccompanist/sounds/795020/
- [ ] `freesound-8142` (high, 26 draft notes) — random. "jinglebells_2.aif" — https://freesound.org/people/petrasound/sounds/8142/
- [ ] `freesound-809415` (very-high, 11 draft notes) — random. "Whistle upwards" — https://freesound.org/people/lbrito/sounds/809415/
- [ ] `freesound-533057` (high, 19 draft notes) — random. "Whistling.wav" — https://freesound.org/people/santiagogra/sounds/533057/
- [ ] `freesound-799580` (default-wide, 7 draft notes) — random. "Whistle 2" — https://freesound.org/people/randbsoundbites/sounds/799580/
- [ ] `freesound-624876` (very-high, 9 draft notes) — random. "Whistle.wav" — https://freesound.org/people/freeloader117/sounds/624876/

<!-- triage:begin -->
## 4. Lowest pipeline agreement (10) — where a verified label changes the most

Ranked by per-clip COnP in benchmark run `2026-09-27T06-23-29_d77db1d_onset-policy` (regenerate with `fetch/triage-verify-worklist.ts`). A low score here is EITHER a wrong draft or a real pipeline failure; verifying these clips settles which, and either outcome moves a number.

- [ ] `commons-human` — COnP 0.00 (P 0.00 / R 0.00), 3 draft notes
- [ ] `freesound-497892` — COnP 0.21 (P 0.19 / R 0.24), 46 draft notes
- [ ] `freesound-494517` — COnP 0.22 (P 1.00 / R 0.13), 8 draft notes
- [ ] `freesound-523207` — COnP 0.25 (P 0.33 / R 0.20), 5 draft notes
- [ ] `freesound-233569` — COnP 0.26 (P 0.16 / R 0.75), 4 draft notes
- [ ] `freesound-558265` — COnP 0.26 (P 0.16 / R 0.75), 4 draft notes
- [ ] `freesound-499702` — COnP 0.35 (P 0.30 / R 0.41), 29 draft notes
- [ ] `freesound-754956` — COnP 0.35 (P 0.29 / R 0.44), 9 draft notes
- [ ] `freesound-795020` — COnP 0.36 (P 0.40 / R 0.33), 6 draft notes
- [ ] `freesound-250718` — COnP 0.36 (P 0.59 / R 0.26), 72 draft notes
<!-- triage:end -->
