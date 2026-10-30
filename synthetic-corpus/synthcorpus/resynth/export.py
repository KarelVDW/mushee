"""Export judged clips: committed truth artifacts, harness truth, copies and contours.

Per clip (status passed / exported / unresolved):
- `annotations/resynth/<dataset>/<clip>.resynth.json` — the durable, git-tracked record
  (calibration sets: `annotations/resynth-calibration/<dataset>/`, and nothing else);
- passed → `<clip>.truth.json` in the dataset's eval-real dir (bpm / beatGrid kept from the
  previous truth, which moves ONCE to `<clip>.truth-derived.json`, never overwritten);
  unresolved → `<clip>.truth-unresolved.json` and no `.truth.json`, so the harness skips it;
- `<clip>__resynth.flac` (hard link to the work copy) and `<clip>.f0.json` (20 ms contours).

Per dataset, `dataset.json` gains a `resynth` summary. Only when EVERY clip has been exported
does it switch to `truthSource: "resynth"` and `noteTruthDerived: false` (licence-restricted
sets keep `noteTruthDerived` as it was, and their `licenceRestricted` flag); until then the
unprocessed clips still carry the old derived truth. `export_id` datasets (jacrc → jacrc-notes)
write into a NEW dir whose `__real` audio is hard-linked and whose dataset.json documents it.

Idempotent: a rerun rewrites nothing whose content is unchanged (timestamps included).
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import numpy as np

from .analysis import Analysis
from .datasets import DatasetConfig, _rel
from .session import ClipSession
from .store import ClipStore, now, write_json

TOOL = {'name': 'synthcorpus.resynth', 'version': '1'}
EXPORTABLE = ('passed', 'exported', 'unresolved')


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def _same(p: Path, data: dict, ignore: tuple[str, ...] = ()) -> bool:
    if not p.exists():
        return False
    try:
        old = json.loads(p.read_text())
    except json.JSONDecodeError:
        return False
    strip = lambda d: {k: v for k, v in d.items() if k not in ignore}  # noqa: E731
    return strip(old) == strip(json.loads(json.dumps(data)))


class Exporter:
    def __init__(self, cfg: DatasetConfig, dry_run: bool = False):
        self.cfg = cfg
        self.dry = dry_run
        self.actions: list[str] = []

    # ------------------------------------------------------------ fs (dry-run aware)
    def _do(self, msg: str, fn=None) -> None:
        self.actions.append(('would ' if self.dry else '') + msg)
        if not self.dry and fn is not None:
            fn()

    def _write(self, p: Path, data: dict, ignore: tuple[str, ...] = ()) -> bool:
        if _same(p, data, ignore):
            return False
        self._do(f'write {_rel(p)}', lambda: (p.parent.mkdir(parents=True, exist_ok=True), write_json(p, data)))
        return True

    def _link(self, src: Path, dst: Path) -> None:
        if dst.exists() and os.path.samefile(src, dst):
            return

        def go():
            dst.parent.mkdir(parents=True, exist_ok=True)
            if dst.exists():
                dst.unlink()
            os.link(src, dst)

        self._do(f'link {_rel(dst)} → {_rel(src)}', go)

    # ------------------------------------------------------------ clips
    def export(self, clips: list[str] | None = None) -> list[str]:
        cfg = self.cfg
        todo = clips if clips is not None else [c for c in cfg.clips() if ClipStore(cfg, c).exists()]
        for clip in todo:
            st = ClipStore(cfg, clip)
            if not st.exists():
                self.actions.append(f'skip {st.ref}: not initialised')
                continue
            state = st.state()
            status = state['status']
            if status not in EXPORTABLE:
                self.actions.append(f'skip {st.ref}: {status}')
                continue
            if state.get('judgedVersion') != state['specVersion']:
                # the truth must be the notes the judge saw (an edit after the verdict needs a new one)
                self.actions.append(f'skip {st.ref}: spec v{state["specVersion"]} was never judged (judged v{state.get("judgedVersion")}); --reopen and resubmit')
                continue
            self.export_clip(ClipSession(cfg, clip))
        if cfg.role == 'target':
            self.dataset_json()
        return self.actions

    def export_clip(self, s: ClipSession) -> None:
        cfg, st = self.cfg, s.store
        state = st.state()
        sp = st.spec()
        if state.get('renderedVersion') != sp.version or s.copy_analysis(sp.version) is None:
            if self.dry:
                self.actions.append(f'would render {st.ref} spec v{sp.version}')
            else:
                s.render()
        truth = sp.truth_notes()  # asserts monophonic, positive durations
        passed = state['status'] in ('passed', 'exported')
        audio = cfg.audio_path(s.clip)
        tempo = cfg.tempo(s.clip)
        verdicts = st.verdicts()
        rep = st.report() or {}
        art = {
            'schema': 'resynth/1',
            'dataset': cfg.export_id or cfg.id,
            **({'workDataset': cfg.id} if cfg.export_id else {}),
            'clip': s.clip,
            'role': cfg.role,
            'audio': {'file': _rel(audio), 'sha256': _sha256(audio), 'sampleRate': s.orig().sr, 'durationSec': round(s.orig().dur, 4)},
            'truth': {**tempo, 'notes': truth},
            'spec': sp.to_json(),
            'verdict': {'status': 'passed' if passed else 'unresolved', 'rounds': state.get('round', 1),
                        'summary': verdicts[-1].get('summary', '') if verdicts else '', 'metrics': rep.get('metrics', {}),
                        'judged': [{'round': v.get('round'), 'verdict': v.get('verdict'), 'specVersion': v.get('specVersion')} for v in verdicts]},
            'prior': sp.prior,
            'tool': {**TOOL, 'analyzer': s.analyzer.config(), 'timbre': sp.timbre, 'seed': sp.render.get('seed')},
            'createdAt': now(),
        }
        self._write(cfg.annotation_dir / f'{s.clip}.resynth.json', art, ignore=('createdAt',))
        if cfg.role == 'target':
            self._harness(s, truth, tempo, passed)
        if passed and state['status'] != 'exported':
            self._do(f'mark {st.ref} exported', lambda: (st.transition(st.state(), 'exported', 'export'), st.log('export', notes=len(truth))))
        elif not passed and not state.get('exportedAt'):
            self._do(f'record export of unresolved {st.ref}', lambda: (st.save_state({**st.state(), 'exportedAt': now()}), st.log('export', unresolved=True)))

    def _harness(self, s: ClipSession, truth: list[dict], tempo: dict, passed: bool) -> None:
        cfg, clip = self.cfg, s.clip
        d = cfg.export_dir
        own = cfg.export_id is None  # writing into the dataset's own dir (truth moves aside once)
        tp, dp, up = d / f'{clip}.truth.json', d / f'{clip}.truth-derived.json', d / f'{clip}.truth-unresolved.json'
        if not own:
            src = cfg.audio_path(clip)
            self._link(src, d / src.name)
        if own and tp.exists() and not dp.exists():
            self._do(f'move {_rel(tp)} → {dp.name}', lambda: tp.rename(dp))
            moved = True
        else:
            moved = False
        doc = {**tempo, 'notes': truth}
        if passed:
            if moved or not _same(tp, doc):
                self._do(f'write {_rel(tp)} ({len(truth)} notes)', lambda: write_json(tp, doc, indent=2))
            if up.exists():
                self._do(f'remove {_rel(up)}', up.unlink)
        else:
            self._write(up, doc)
            if tp.exists() and not moved:
                self._do(f'remove {_rel(tp)} (unresolved)', tp.unlink)
        synth = s.store.path('synth.flac')
        if synth.exists():
            self._link(synth, d / f'{clip}__resynth.flac')
        else:
            self.actions.append(f'would link {_rel(d / f"{clip}__resynth.flac")} (after the render)')
        c = s.copy_analysis(s.store.spec().version)
        f0 = {'hop': 0.02, 'orig': _contour(s.orig()), 'synth': _contour(c) if c is not None else []}
        self._write(d / f'{clip}.f0.json', f0)

    # ------------------------------------------------------------ dataset.json
    def dataset_json(self) -> None:
        cfg = self.cfg
        clips = cfg.clips()
        states = {c: (ClipStore(cfg, c).state() if ClipStore(cfg, c).exists() else None) for c in clips}
        passed = sorted(c for c, s in states.items() if s and s['status'] == 'exported')
        unresolved = sorted(c for c, s in states.items() if s and s['status'] == 'unresolved' and s.get('exportedAt'))
        if not passed and not unresolved:
            return  # nothing exported yet: leave dataset.json alone
        pending = len(clips) - len(passed) - len(unresolved)
        d = cfg.export_dir
        p = d / 'dataset.json'
        if cfg.export_id:
            base = json.loads(p.read_text()) if p.exists() else self._new_dataset_json()
        else:
            base = json.loads(p.read_text()) if p.exists() else {'id': cfg.id}
        doc = dict(base)
        summary = {**TOOL, 'passed': len(passed), 'unresolved': len(unresolved), 'pending': pending}
        complete = pending == 0 or bool(cfg.export_id)
        if complete:
            doc['truthSource'] = 'resynth'
            if not doc.get('licenceRestricted'):
                doc['noteTruthDerived'] = False
            doc.update(cfg.export_meta)
        notes = 0
        for c in clips:
            tp = d / f'{c}.truth.json'
            if tp.exists():
                notes += len(json.loads(tp.read_text())['notes'])
        if cfg.export_id:
            doc['clips'] = len(passed)
            doc['totalNotes'] = notes
        elif complete:
            doc['totalNotes'] = notes
        old = base.get('resynth', {})
        same = {k: v for k, v in old.items() if k != 'exportedAt'} == summary
        doc['resynth'] = {**summary, 'exportedAt': old.get('exportedAt') if same and old.get('exportedAt') else now()}
        self._write(p, doc)

    def _new_dataset_json(self) -> dict:
        cfg = self.cfg
        src = cfg.dataset_json()
        return {
            'id': cfg.export_id,
            'label': f'{src.get("label", cfg.id)} — resynth note truth',
            'kind': src.get('kind', 'voice'),
            'material': cfg.material,
            'instrumentId': src.get('instrumentId', 'voice-lead'),
            'source': src.get('source'),
            'license': src.get('license'),
            'audioFrom': f'{cfg.tier}/{cfg.id}',
            'truthSource': 'resynth',
            'noteTruthDerived': False,
            'notes': (f'Same audio as {cfg.tier}/{cfg.id} (each <clip>__real.wav is a HARD LINK to it, no extra disk). '
                      f'{cfg.id} keeps its human syllable onsets as its own truth; this dataset holds NOTE truth from '
                      'synthetic-corpus resynth (synthetic-corpus/RESYNTH.md): a copy rendered from the note list was judged to match '
                      'the original, so the notes are read from the copy. Clips the judge never passed have only '
                      '<clip>.truth-unresolved.json and are skipped by the harness.'),
        }


def _contour(a: Analysis | None) -> list:
    if a is None:
        return []
    f = np.where(a.conf >= 1, a.f0, np.nan)[::2]
    return [None if not np.isfinite(v) else round(float(v), 2) for v in f]

