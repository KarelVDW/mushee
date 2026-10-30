"""One clip's resynth loop: init (analyse, draft, autofix, render, compare), edits, renders,
reports, hand-off to the judge and the verdict. Every command persists through `ClipStore`."""

from __future__ import annotations

import json
import time

import numpy as np
import soundfile as sf

from .analysis import SR_A, Analysis, Analyzer, load_audio, resample
from .compare import Comparison, Panels, report_text
from .datasets import DatasetConfig
from .evidence import Evidence
from .segment import F0Segmenter
from .spec import AutoFixer, Spec, SpecError, spec_from_notes
from .store import CLOSED, MAX_ROUNDS, ClipStore


class ClipSession:
    def __init__(self, cfg: DatasetConfig, clip: str):
        self.cfg = cfg
        self.clip = clip
        self.store = ClipStore(cfg, clip)
        self.analyzer = Analyzer.for_clip(cfg, clip)
        self._orig: Analysis | None = None
        self._ev: Evidence | None = None

    @property
    def ref(self) -> str:
        return self.store.ref

    # ------------------------------------------------------------ analysis (cached)
    def orig_audio(self) -> tuple[np.ndarray, int]:
        p = self.cfg.audio_path(self.clip)
        if not p.exists():
            raise SystemExit(f'{self.ref}: no audio at {p}')
        return load_audio(p)

    def audio_sig(self) -> dict:
        """Size + mtime of the original: a re-fetched file (dagstuhl) invalidates the cached analysis."""
        st = self.cfg.audio_path(self.clip).stat()
        return {'size': st.st_size, 'mtime': st.st_mtime_ns}

    def orig(self) -> Analysis:
        if self._orig is None:
            p = self.store.path('orig.npz')
            if p.exists():
                a = Analysis.load(p)
                if a.meta.get('analyzer') == self.analyzer.config() and a.meta.get('audio') == self.audio_sig():
                    self._orig = a
            if self._orig is None:
                y, sr = self.orig_audio()
                self._orig = self.analyzer.analyse(y, sr)
                self._orig.meta['audio'] = self.audio_sig()
                self.store.dir.mkdir(parents=True, exist_ok=True)
                self._orig.save(p)
        return self._orig

    def evidence(self) -> Evidence:
        if self._ev is None:
            anchors = self.cfg.prior_notes(self.clip).anchors
            self._ev = Evidence(self.orig(), F0Segmenter(self.orig(), anchors=anchors))
        return self._ev

    def copy_analysis(self, version: int) -> Analysis | None:
        p = self.store.path('synth.npz')
        if not p.exists():
            return None
        a = Analysis.load(p)
        return a if a.meta.get('specVersion') == version and a.meta.get('analyzer') == self.analyzer.config() else None

    # ------------------------------------------------------------ init
    def init(self, force: bool = False, blind: bool = False) -> str:
        st = self.store
        if st.exists() and not force:
            return f'{self.ref}: already initialised ({st.state()["status"]}); --force to start over'
        from .render import VoiceRenderer, seed_for  # lazy (with render.py's imports): the read-only views never render

        t_start = time.time()
        st.wipe()
        st.dir.mkdir(parents=True)
        a = self.orig()
        prior = self.cfg.prior_notes(self.clip, blind=blind)
        seg = F0Segmenter(a, anchors=prior.anchors)
        notes = prior.notes if prior.notes else seg.notes()
        timbre = self.cfg.timbre_for(self.clip)
        if timbre['kind'] == 'voice' and 'singer' not in timbre:
            mids = [n['midi'] for n in notes] or list(a.f0[a.conf == 2])
            timbre['singer'] = VoiceRenderer.choose_singer(timbre.get('vowel', 'a'), mids, timbre.pop('sex', None))
        timbre.pop('sex', None)
        sp = spec_from_notes(self.cfg.id, self.clip, timbre, seed_for(self.cfg.id, self.clip), notes, prior.describe())
        sp.refresh(a)
        self._ev = Evidence(a, seg)
        fixes = AutoFixer(sp, self._ev).run(a=a)
        sp.version = 1  # the draft, autofixed, is version 1
        st.save_spec(sp)
        state = {'status': 'drafted', 'round': 1, 'specVersion': sp.version, 'judgedVersion': None, 'renderedVersion': None, 'history': []}
        st.transition(state, 'drafted', 'init', prior=prior.describe())
        st.log('init', prior=prior.describe(), notes=len(sp.notes), autofix=fixes, timbre=sp.timbre, analyzer=self.analyzer.config())
        out = [f'{self.ref}: drafted {len(sp.notes)} notes from {prior.source}' + (f' ({prior.path})' if prior.path else '')
               + f'; timbre {_timbre(sp.timbre)}']
        if fixes:
            out.append(f'autofix ({len(fixes)}):')
            out += [f'  {x}' for x in fixes[:30]] + ([f'  +{len(fixes) - 30} more (log.jsonl)'] if len(fixes) > 30 else [])
        out.append(self.iterate())
        st.log('timing', step='init', seconds=round(time.time() - t_start, 2))
        return '\n'.join(out)

    # ------------------------------------------------------------ edits
    def _editable(self, reopen: bool) -> dict:
        state = self.store.state()
        if state['status'] in CLOSED:
            if not reopen:
                raise SystemExit(f'{self.ref}: status {state["status"]} is closed; pass --reopen to edit')
            state['round'] = min(state.get('round', 1), MAX_ROUNDS)
        return state

    def _commit(self, sp: Spec, state: dict, event: str, lines: list[str], **log) -> str:
        self.store.save_spec(sp)
        state['specVersion'] = sp.version
        status = state['status']
        if status in CLOSED or status == 'awaiting-judge':
            status = self.store.open_status(state)
        self.store.transition(state, status, event)
        self.store.log(event, specVersion=sp.version, changes=lines, **log)
        return '\n'.join([f'{self.ref}: spec v{sp.version} ({len(sp.notes)} notes)'] + [f'  {x}' for x in lines])

    def edit(self, ops: list[dict] | None = None, apply: list[str] | None = None, reopen: bool = False) -> str:
        state = self._editable(reopen)
        sp = self.store.spec()
        ops = list(ops or [])
        if apply:
            rep = self.store.report()
            if not rep or rep['specVersion'] != sp.version:
                raise SystemExit(f'{self.ref}: --apply needs a report for spec v{sp.version} (run iterate)')
            byid = {d['id']: d for d in rep['diffs']}
            for did in apply:
                d = byid.get(did)
                if d is None or not d.get('op'):
                    raise SystemExit(f'{self.ref}: {did} has no suggested op')
                ops.extend(d['op'] if isinstance(d['op'], list) else [d['op']])
        if not ops:
            raise SystemExit('nothing to apply')
        try:
            lines = sp.apply(ops, self.orig())
        except SpecError as e:
            raise SystemExit(f'{self.ref}: edit rejected, spec unchanged: {e}') from None
        return self._commit(sp, state, 'edit', lines, ops=ops)

    def autofix(self, kinds: tuple[str, ...], reopen: bool = False) -> str:
        state = self._editable(reopen)
        sp = self.store.spec()
        v0 = sp.version
        lines = AutoFixer(sp, self.evidence()).run(kinds, self.orig())
        if sp.version == v0:
            return f'{self.ref}: autofix ({",".join(kinds)}): no changes'
        return self._commit(sp, state, 'autofix', lines, kinds=list(kinds))

    # ------------------------------------------------------------ render / compare
    def render(self, force: bool = False) -> tuple[Analysis, bool]:
        """Render the current spec (unless already rendered) and analyse the copy.

        When only the analysis is stale (an analyzer change) the existing copy of this spec
        version is re-analysed, not re-rendered: the copy and its hard links stay the same file."""
        sp = self.store.spec()
        cached = None if force else self.copy_analysis(sp.version)
        flac = self.store.path('synth.flac')
        if cached is not None and flac.exists():
            return cached, False
        if not force and flac.exists() and self.store.state().get('renderedVersion') == sp.version:
            y, sr = sf.read(str(flac), dtype='float32')
            c = self.analyzer.analyse(y, sr)
            c.meta['specVersion'] = sp.version
            c.save(self.store.path('synth.npz'))
            self.store.log('reanalyse', specVersion=sp.version, analyzer=self.analyzer.config())
            return c, False
        from .render import SR, render

        t = time.time()
        y = render(sp, self.orig())
        tmp = self.store.path('synth.tmp.flac')
        sf.write(str(tmp), y, SR, subtype='PCM_16')
        tmp.replace(self.store.path('synth.flac'))
        c = self.analyzer.analyse(y, SR)
        c.meta['specVersion'] = sp.version
        c.save(self.store.path('synth.npz'))
        state = self.store.state()
        state['renderedVersion'] = sp.version
        self.store.save_state(state)
        self.store.log('render', specVersion=sp.version, seconds=round(time.time() - t, 2), samples=len(y))
        return c, True

    def compare(self, panels: bool = True) -> dict:
        from .render import SR

        sp = self.store.spec()
        c, _ = self.render()
        cmp = Comparison(sp, self.orig(), c, self.evidence())
        rep = cmp.report()
        if panels:
            yo, sr = self.orig_audio()
            yc, _ = sf.read(str(self.store.path('synth.flac')), dtype='float32')
            rep['panels'] = Panels(sp, self.orig(), c, resample(yo, sr, SR_A), resample(yc, SR, SR_A), rep['diffs'],
                                   self.cfg.f0_range_for(self.clip), self.evidence().seg.anchors).save(self.store.panels)
        self.store.save_report(rep)
        self.store.log('compare', specVersion=sp.version, metrics=rep['metrics'], diffs=len(rep['diffs']))
        return rep

    def iterate(self, force: bool = False) -> str:
        t = time.time()
        if force:
            self.render(force=True)
        rep = self.compare()
        self.store.log('timing', step='iterate', seconds=round(time.time() - t, 2))
        return self.report_text(rep)

    def report_text(self, rep: dict | None = None) -> str:
        rep = rep or self.store.report()
        if rep is None:
            return f'{self.ref}: no report yet (run iterate)'
        st = self.store.state()
        return report_text(rep, {'ref': self.ref, 'round': st.get('round', 1), 'status': st['status'], 'specVersion': st['specVersion']}, str(self.store.panels))

    def hint(self) -> str:
        """The one line that points agents at the deeper views (instead of ad-hoc analysis)."""
        return (f'deeper looks: rs inspect {self.ref} --t0 A --t1 B (numbers per 20 ms: trackers, dB, events, copy, note) · '
                f'rs zoom {self.ref} --t0 A --t1 B (close-up PNG ≤ 4 s) · rs note {self.ref} n1[,n2] (one note\'s evidence)')

    # ------------------------------------------------------------ views
    def show(self, t0: float = 0.0, t1: float = float('inf')) -> str:
        st = self.store.state()
        sp = self.store.spec()
        pr = sp.prior or {}
        lines = [f'{self.ref}  [{st["status"]}]  round {st.get("round", 1)}  spec v{sp.version}  rendered v{st.get("renderedVersion")}  '
                 f'judged v{st.get("judgedVersion")}  timbre {_timbre(sp.timbre)}  prior {pr.get("source")} ({pr.get("notes", 0)} notes)',
                 f'notes ({len(sp.notes)}; id on-off pitch±cents, L = legato, ? = flagged):']
        lines += ['  ' + x for x in sp.lines(t0=t0, t1=t1)]
        v = self.store.verdict()
        if v and st['status'] == 'needs-work':
            lines.append(f'JUDGE r{v.get("round")} FAIL: {v.get("summary", "")}')
            lines += [f'  {i}. {_fb(f)}' for i, f in enumerate(v.get('feedback', []), 1)]
        lines.append(self.report_text())
        lines.append(self.hint())
        return '\n'.join(lines)

    # ------------------------------------------------------------ judge
    def submit(self) -> str:
        state = self.store.state()
        if state['status'] not in ('drafted', 'needs-work'):
            return f'{self.ref}: status {state["status"]}, nothing to submit'
        rep = self.store.report()
        if not rep or rep['specVersion'] != state['specVersion']:
            self.compare()
            state = self.store.state()  # the render recorded its version
        self.store.transition(state, 'awaiting-judge', 'submit')
        self.store.log('submit', specVersion=state['specVersion'])
        return f'{self.ref}: spec v{state["specVersion"]} awaiting judge (round {state.get("round", 1)})'

    def judge_view(self) -> str:
        state = self.store.state()
        rep = self.store.report()
        if state['status'] in ('drafted', 'needs-work'):
            self.submit()
            state = self.store.state()
            rep = self.store.report()
        elif not rep or rep['specVersion'] != state['specVersion']:
            rep = self.compare()
        lines = [self.report_text(rep)]
        prev = self.store.verdicts()
        if prev:
            lines.append('previous verdicts: ' + ' · '.join(f'r{v.get("round")} {v.get("verdict", "").upper()} v{v.get("specVersion")}: {v.get("summary", "")[:80]}'
                                                            for v in prev[-3:]))
        lines.append(self.hint())
        return '\n'.join(lines)

    def verdict(self, v: dict) -> str:
        state = self.store.state()
        if state['status'] != 'awaiting-judge':
            raise SystemExit(f'{self.ref}: status {state["status"]}; a verdict needs awaiting-judge (judge-view sets it)')
        kind = str(v.get('verdict', '')).lower()
        if kind not in ('pass', 'fail'):
            raise SystemExit('verdict file: "verdict" must be "pass" or "fail"')
        if kind == 'fail' and not v.get('feedback'):
            raise SystemExit('verdict file: a fail needs "feedback" (numbered, time-anchored items)')
        rnd = state.get('round', 1)
        rep = self.store.report() or {}
        rec = {'verdict': kind, 'round': rnd, 'specVersion': state['specVersion'], 'summary': v.get('summary', ''), 'feedback': v.get('feedback', []),
               'metrics': rep.get('metrics', {}), 'diffs': len(rep.get('diffs', []))}
        self.store.save_verdict(rec, rnd)
        state['judgedVersion'] = state['specVersion']
        if kind == 'pass':
            status = 'passed'
        elif rnd >= MAX_ROUNDS:
            status = 'unresolved'
        else:
            status = 'needs-work'
            state['round'] = rnd + 1
        self.store.transition(state, status, 'verdict', verdict=kind)
        self.store.log('verdict', **rec)
        return f'{self.ref}: {kind.upper()} at round {rnd} → {status}'


def _timbre(t: dict) -> str:
    if t['kind'] == 'voice':
        return f'voice {t.get("singer")}/{t.get("vowel")}' + (f' lp{t["lowpassHz"]}' if t.get('lowpassHz') else '')
    if t['kind'] == 'instrument':
        return f'{t["timbre"]} ({t["source"]})'
    return t['kind']


def _fb(f) -> str:
    if isinstance(f, str):
        return f
    where = ' '.join(str(f[k]) for k in ('t', 'at', 'note') if f.get(k) is not None)
    return f'{where}: {f.get("text", json.dumps(f))}' if where else f.get('text', json.dumps(f))

