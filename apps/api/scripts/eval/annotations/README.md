# Label files

Audacity three-column label TSVs (`<clip>.labels.tsv`) with a `<clip>.meta.json`
sidecar per clip, one directory per dataset. They are the human-correctable form
of a dataset's note truth: `fetch/draft-note-labels.ts` or
`fetch/align-prescribed-truth.ts` writes the draft, a human corrects it in
Audacity's spectrogram view, and `fetch/import-note-labels.ts --verified-by=<name>`
turns the corrected set back into a scoreable dataset (and promotes it from the
context tier to the benchmark tier once every clip is verified).

Committed: the whistle drafts (`whistle-real`, `whistle-vintage`,
`whistled-high-register-aligned`) — small, and the staging point for the human
verification pass (`whistle-real/VERIFY-WORKLIST.md`).

Not committed (gitignored): `humtrans-aligned/` — 769 clips regenerated
deterministically by `fetch/fetch-humtrans.ts` followed by
`ALIGN_TRACKER=yin ALIGN_MIN_HZ=70 ALIGN_MAX_HZ=1000 ALIGN_MIN_TONALITY=0.5
fetch/align-prescribed-truth.ts --dataset=context/humtrans --out=humtrans-aligned`.
Commit individual TSVs from it only once a human has corrected them.
