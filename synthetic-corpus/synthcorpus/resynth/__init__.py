"""resynth — note truth for real recordings by iterative resynthesis (synthetic-corpus/RESYNTH.md).

A note list is drafted for the original, a synthetic copy is rendered from exactly those
notes, and the copy is compared with the original; agents revise the notes until a judge
passes the copy. The truth is then read deterministically from the copy's note spec.

  datasets.py  per-dataset config (paths, material, prior, export policy)
  analysis.py  identical analysis of original and copy (f0 consensus, level, onsets)
  segment.py   blind f0 segmentation (drafts, gap filling, pitch-change events)
  evidence.py  what the original says about a note list (shared by compare and autofix)
  spec.py      the note spec: stable ids, edit ops, autofix, truth export
  render.py    the copy: whistle / voice (PSOLA) / instrument (sampler), contour + level
  compare.py   metrics, ranked diffs, report text, panels
  store.py     work dir + state machine;  session.py  one clip's commands
  export.py    artifacts, harness truth, copies, contours, dataset.json
"""
