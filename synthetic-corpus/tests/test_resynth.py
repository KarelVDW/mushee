"""resynth unit tests: spec ops, truth export, render determinism, synthetic round trips, export.

  cd synthetic-corpus && PYTHONPATH=. .venv/bin/python -m pytest tests -q

The round trips use the whistle timbre (a pure oscillator, no sample assets), so they run
anywhere in a few seconds. A note list is rendered to audio, that audio plays the ORIGINAL,
and the same (or a perturbed) note list is rendered and compared against it.
"""

from __future__ import annotations

import json

import numpy as np
import pytest
import soundfile as sf

from synthcorpus.resynth import datasets, store
from synthcorpus.resynth.analysis import Analyzer
from synthcorpus.resynth.compare import Comparison
from synthcorpus.resynth.datasets import DatasetConfig
from synthcorpus.resynth.evidence import Evidence
from synthcorpus.resynth.render import SR, render
from synthcorpus.resynth.segment import F0Segmenter
from synthcorpus.resynth.spec import Spec, SpecError, spec_from_notes

WHISTLE = {'kind': 'whistle'}
MELODY = [  # (on, off, midi, legato): detached notes, legato steps, a re-articulated repeat
    (0.30, 0.60, 84, False),
    (0.60, 0.90, 86, True),
    (1.00, 1.40, 88, False),
    (1.40, 1.70, 88, False),
    (1.90, 2.40, 83, False),
    (2.60, 2.90, 81, False),
    (2.90, 3.30, 84, True),
    (3.50, 4.20, 86, False),
]


def melody_spec(notes=MELODY, seed: int = 7) -> Spec:
    return spec_from_notes('test', 'clip', dict(WHISTLE), seed, [{'on': a, 'off': b, 'midi': m, 'legato': lg} for a, b, m, lg in notes], {'source': 'test'})


@pytest.fixture(scope='module')
def original():
    """The melody rendered as a 'real recording', and its analysis."""
    y = render(melody_spec(), None)
    return y, Analyzer('whistle', (400.0, 5000.0)).analyse(y, SR)


def copy_report(sp: Spec, orig_an) -> dict:
    sp.refresh(orig_an)
    y = render(sp, orig_an)
    c = Analyzer('whistle', (400.0, 5000.0)).analyse(y, SR)
    return Comparison(sp, orig_an, c, Evidence(orig_an)).report()


# ------------------------------------------------------------------ spec


def test_spec_ops_and_json_roundtrip():
    sp = melody_spec()
    assert [n.id for n in sp.notes] == [f'n{i}' for i in range(1, 9)]
    log = sp.apply([{'op': 'set', 'id': 'n3', 'midi': 89}, {'op': 'split', 'id': 'n8', 'at': 3.8}, {'op': 'delete', 'id': 'n9'},
                    {'op': 'add', 'on': 4.4, 'off': 4.6, 'midi': 90}, {'op': 'flag', 'id': 'n5', 'add': ['uncertain-pitch']}], None)
    assert len(log) == 5 and sp.version == 2
    ids = [n.id for n in sp.notes]
    assert 'n9' not in ids and 'n10' in ids, 'a deleted id is never reused'
    assert sp.by_id('n3').midi == 89 and sp.by_id('n8').off == pytest.approx(3.8) and sp.by_id('n5').flags == ['uncertain-pitch']
    sp.apply([{'op': 'merge', 'ids': ['n3', 'n4']}, {'op': 'shift', 'ids': ['n6'], 'dt': 0.02}, {'op': 'transpose', 'ids': 'all', 'semitones': 12}], None)
    assert sp.by_id('n3').off == pytest.approx(1.7) and sp.by_id('n3').midi == 101
    back = Spec.from_json(json.loads(json.dumps(sp.to_json())))
    assert back.to_json() == sp.to_json()
    assert back.add_note(5.0, 5.2, 70).id == 'n11'


def test_edit_is_atomic_and_normalises_legato():
    sp = melody_spec()
    before = sp.to_json()
    with pytest.raises(SpecError):
        sp.apply([{'op': 'set', 'id': 'n1', 'midi': 85}, {'op': 'set', 'id': 'n99', 'midi': 1}], None)
    assert sp.to_json() == before, 'a failing op leaves the spec untouched'
    sp.apply([{'op': 'set', 'id': 'n2', 'on': 0.55}], None)  # legato: n1 now ends where n2 starts
    assert sp.by_id('n1').off == pytest.approx(0.55)
    sp.apply([{'op': 'set', 'id': 'n5', 'on': 1.6, 'legato': False}], None)  # overlap with n4 is trimmed
    assert sp.by_id('n4').off == pytest.approx(1.6)
    with pytest.raises(SpecError):
        sp.apply([{'op': 'split', 'id': 'n1', 'at': 5.0}], None)


def test_truth_export_is_deterministic_and_monophonic():
    sp = melody_spec()
    sp.apply([{'op': 'set', 'id': 'n1', 'on': 0.30049}], None)
    t1, t2 = sp.truth_notes(), Spec.from_json(sp.to_json()).truth_notes()
    assert t1 == t2
    assert t1[0] == {'onsetSec': 0.3, 'durSec': 0.3, 'midi': 84}
    assert all(a['onsetSec'] + a['durSec'] <= b['onsetSec'] + 1e-9 for a, b in zip(t1, t1[1:]))
    assert all(round(n['onsetSec'] * 1000) == n['onsetSec'] * 1000 for n in t1)
    bad = melody_spec()
    bad.notes[2].off = bad.notes[3].on + 0.05  # bypass normalise: an overlap
    with pytest.raises(SpecError):
        bad.truth_notes()


# ------------------------------------------------------------------ render / compare


def test_render_is_deterministic(original):
    y0, an = original
    a, b = render(melody_spec(), an), render(melody_spec(), an)
    assert np.array_equal(a, b)
    assert not np.array_equal(a, render(melody_spec(seed=8), an)), 'the seed matters (breath noise)'


def test_blind_segmentation_recovers_the_melody(original):
    _, an = original
    notes = F0Segmenter(an).notes()
    assert [n['midi'] for n in notes] == [m for _, _, m, _ in MELODY]
    for d, (on, off, _, _) in zip(notes, MELODY):
        assert abs(d['on'] - on) <= 0.04 and abs(d['off'] - off) <= 0.06


def test_copy_of_itself_has_no_note_diffs(original):
    _, an = original
    rep = copy_report(melody_spec(), an)
    m = rep['metrics']
    assert m['pitch'] >= 0.97 and m['voicingRecall'] >= 0.95 and m['voicingPrecision'] >= 0.95 and m['onsetF1'] >= 0.9 and m['explained'] >= 0.97
    note_errors = [d for d in rep['diffs'] if d['type'] in ('pitch', 'missing-sound', 'extra-sound', 'unsupported', 'extra-onset', 'timing', 'offset')]
    assert not note_errors, note_errors


@pytest.mark.parametrize('ops, expect', [
    ([{'op': 'set', 'id': 'n5', 'midi': 85}], ('pitch', 'n5')),
    ([{'op': 'delete', 'id': 'n8'}], ('missing-sound', None)),
    ([{'op': 'set', 'id': 'n3', 'on': 1.09}], ('timing', 'n3')),
    ([{'op': 'merge', 'ids': ['n6', 'n7']}], ('extra-onset', 'n6')),
    ([{'op': 'merge', 'ids': ['n3', 'n4']}], ('extra-onset', 'n3')),
    ([{'op': 'split', 'id': 'n8', 'at': 3.85}], ('unsupported', 'n9')),
    ([{'op': 'add', 'on': 4.5, 'off': 4.8, 'midi': 86}], ('extra-sound', 'n9')),
    ([{'op': 'set', 'id': 'n5', 'off': 2.2}], ('offset', 'n5')),
    ([{'op': 'split', 'id': 'n3', 'at': 1.12}], ('unsupported', 'n9')),  # near the onset: n3's attack is not n9's
    ([{'op': 'delete', 'id': 'n2'}], ('missing-sound', None)),  # not n1's late offset: the sound there is another pitch
])
def test_perturbation_is_flagged(original, ops, expect):
    _, an = original
    sp = melody_spec()
    sp.apply(ops, an)
    rep = copy_report(sp, an)
    kind, note = expect
    hits = [d for d in rep['diffs'] if d['type'] == kind and (note is None or d.get('note') == note)]
    assert hits, f'{ops} not flagged as {expect}: {[(d["type"], d.get("note"), d["text"]) for d in rep["diffs"]]}'


def test_delete_never_moves_the_neighbours():
    sp = melody_spec()
    n1_off = sp.by_id('n1').off
    sp.apply([{'op': 'delete', 'id': 'n1'}, {'op': 'delete', 'id': 'n6'}], None)
    assert not sp.by_id('n2').legato and not sp.by_id('n7').legato, 'a legato note whose predecessor is deleted starts afresh'
    sp2 = melody_spec()
    sp2.apply([{'op': 'delete', 'id': 'n2'}], None)  # n2 is legato after n1; n3 is not legato
    assert sp2.by_id('n1').off == pytest.approx(n1_off)
    sp3 = melody_spec()
    sp3.apply([{'op': 'delete', 'id': 'n6'}], None)  # n7 was legato after n6: n5 must NOT stretch over n6
    assert sp3.by_id('n5').off == pytest.approx(2.40) and sp3.by_id('n7').on == pytest.approx(2.90)


def test_suggested_ops_for_a_missing_note_add_it_at_its_pitch(original):
    _, an = original
    sp = melody_spec()
    sp.apply([{'op': 'delete', 'id': 'n2'}], an)
    rep = copy_report(sp, an)
    d = [d for d in rep['diffs'] if d['type'] == 'missing-sound']
    assert d and d[0]['op']['op'] == 'add' and d[0]['op']['midi'] == 86, rep['diffs']
    assert not [d for d in rep['diffs'] if d['type'] == 'offset' and d.get('note') == 'n1'], 'n1 does not "end late": D6 follows it'


def test_suggested_split_restores_a_merged_legato_pair(original):
    _, an = original
    sp = melody_spec()
    sp.apply([{'op': 'merge', 'ids': ['n6', 'n7']}], an)
    rep = copy_report(sp, an)
    d = next(d for d in rep['diffs'] if d['type'] == 'extra-onset' and d.get('note') == 'n6')
    sp.apply(d['op'] if isinstance(d['op'], list) else [d['op']], an)
    a, b = sorted([n for n in sp.notes if 2.5 < n.on < 3.4], key=lambda n: n.on)
    assert (a.midi, b.midi) == (81, 84) and b.legato and abs(b.on - 2.90) <= 0.04


def test_a_note_spanning_a_silence_is_two_notes(original):
    _, an = original
    sp = melody_spec()
    sp.apply([{'op': 'merge', 'ids': ['n4', 'n5']}], an)  # D6 1.40–1.70, silence, B5 1.90–2.40 → one note
    rep = copy_report(sp, an)
    d = [d for d in rep['diffs'] if d['type'] == 'extra-onset' and d.get('note') == 'n4' and 'silent' in d['text']]
    assert d and abs(d[0]['t1'] - 1.90) <= 0.04, rep['diffs']
    sp.apply(d[0]['op'], an)
    a, b = sorted([n for n in sp.notes if 1.3 < n.on < 2.0], key=lambda n: n.on)
    assert (a.midi, b.midi) == (88, 83) and abs(a.off - 1.70) <= 0.05 and not b.legato  # 30 ms release tail


def test_wrong_midi_is_not_masked_by_the_copy(original):
    """The copy must PLAY the wrong note: cents is not pulled towards the original (it was clamped
    to ±50 c, which put a +1 st error only ~half a semitone off in the copy)."""
    _, an = original
    sp = melody_spec()
    sp.apply([{'op': 'set', 'id': 'n5', 'midi': 84}], an)  # n5 is B5 (83)
    n5 = sp.by_id('n5')
    assert n5.cents == 0.0
    sp.refresh(an)
    c = Analyzer('whistle', (400.0, 5000.0)).analyse(render(sp, an), SR)
    sl = an.span(n5.on + 0.1, n5.off - 0.1)
    dev = np.nanmedian(c.f0[sl] - an.f0[sl])
    assert dev >= 0.85, f'copy only {dev * 100:.0f} c above the original'


def test_octave_disagreement_is_settled_by_the_spectrum():
    t = np.arange(16000) / 16000
    n = 101
    hz2midi = lambda hz: 69 + 12 * np.log2(hz / 440)  # noqa: E731
    cases = [  # (signal, the true f0)
        (np.sin(2 * np.pi * 600 * t) + 0.3 * np.sin(2 * np.pi * 1200 * t), 600.0),  # odd harmonics of 300 Hz absent
        (sum(np.sin(2 * np.pi * 150 * k * t) / k for k in range(1, 9)), 150.0),  # a sawtooth: all harmonics of 150 Hz
    ]
    for y, f in cases:
        lo, hi = hz2midi(f / 2 if f == 600.0 else f), hz2midi(f * 2 if f == 150.0 else f)
        fa, fb = np.full(n, lo), np.full(n, hi)  # one tracker an octave below the other
        f0, conf = fa.copy(), np.ones(n, np.int8)
        Analyzer('voice', (65.0, 1100.0))._octaves(y.astype(np.float32), fa, fb, f0, conf)
        assert np.allclose(f0[5:-5], hz2midi(f)) and (conf[5:-5] == 2).all()


def test_selftest_detects_injected_errors(sandbox):
    from synthcorpus.resynth.selftest import BY_NAME, ClipSelfTest

    cfg, *_ = sandbox
    t = ClipSelfTest(cfg, 'c1', seed=1, per_family=2, log=lambda *a: None)
    res = t.run([BY_NAME[f] for f in ('pitch+1', 'delete', 'merge-diff', 'split', 'onset+100', 'offset+150')])
    assert res['baseline']['noteLevel'] == 0, res['baseline']['diffs']
    for f, r in res['families'].items():
        assert r['injected'] >= 1 and r['detected'] == r['injected'], (f, r['targets'])
    pitched = res['families']['pitch+1']['targets']
    assert all(x['copy_dev_cents'] >= 80 for x in pitched), 'the copy plays the wrong note a full semitone off'


# ------------------------------------------------------------------ export


@pytest.fixture()
def sandbox(tmp_path, monkeypatch, original):
    """A throwaway eval-real / annotations / work tree with one whistle dataset of one clip."""
    y, _ = original
    real, ann, work = tmp_path / 'eval-real', tmp_path / 'annotations', tmp_path / 'work'
    d = real / 'context' / 'tws'
    d.mkdir(parents=True)
    sf.write(str(d / 'c1__real.wav'), y, SR, subtype='PCM_16')
    prior = {'bpm': 96, 'notes': [{'onsetSec': a, 'durSec': round(b - a, 3), 'midi': m} for a, b, m, _ in MELODY]}
    (d / 'c1.truth.json').write_text(json.dumps(prior))
    (d / 'dataset.json').write_text(json.dumps({'id': 'tws', 'kind': 'whistle', 'noteTruthDerived': True}))
    monkeypatch.setattr(datasets, 'EVAL_REAL', real)
    monkeypatch.setattr(datasets, 'ANNOTATIONS', ann)
    monkeypatch.setattr(store, 'WORK', work)
    cfg = DatasetConfig('tws', 'context', 'whistling')
    monkeypatch.setitem(datasets.DATASETS, 'tws', cfg)
    return cfg, d, ann, prior


def test_export_writes_truth_once_and_is_idempotent(sandbox):
    from synthcorpus.resynth.export import Exporter
    from synthcorpus.resynth.session import ClipSession

    cfg, d, ann, prior = sandbox
    s = ClipSession(cfg, 'c1')
    s.init()
    s.judge_view()
    s.verdict({'verdict': 'pass', 'summary': 'matches'})
    dry = Exporter(cfg, dry_run=True).export()
    assert dry and all(x.startswith(('would', 'skip')) for x in dry)
    assert not (d / 'c1.truth-derived.json').exists(), 'dry run writes nothing'
    Exporter(cfg).export()
    truth = json.loads((d / 'c1.truth.json').read_text())
    assert truth['bpm'] == 96 and truth['notes'] == s.store.spec().truth_notes()
    assert json.loads((d / 'c1.truth-derived.json').read_text()) == prior
    assert (d / 'c1__resynth.flac').exists() and json.loads((d / 'c1.f0.json').read_text())['hop'] == 0.02
    art = json.loads((ann / 'resynth' / 'tws' / 'c1.resynth.json').read_text())
    assert art['truth']['notes'] == truth['notes'] and art['verdict']['status'] == 'passed'
    ds = json.loads((d / 'dataset.json').read_text())
    assert ds['truthSource'] == 'resynth' and ds['noteTruthDerived'] is False and ds['resynth']['passed'] == 1
    assert s.store.state()['status'] == 'exported'
    snapshot = {p.name: p.read_bytes() for p in list(d.iterdir()) + list((ann / 'resynth' / 'tws').iterdir())}
    again = Exporter(cfg).export()
    assert not [x for x in again if x.startswith(('write', 'move', 'link', 'remove'))], again
    assert {p.name: p.read_bytes() for p in list(d.iterdir()) + list((ann / 'resynth' / 'tws').iterdir())} == snapshot
    assert json.loads((d / 'c1.truth-derived.json').read_text()) == prior, 'the derived truth is never overwritten'


# ------------------------------------------------------------------ voice (VocalSet PSOLA; skipped without the voice bank)


@pytest.mark.skipif(not (datasets.ROOT / 'work' / 'voicebank' / 'units.json').exists(), reason='voice bank cache not built')
def test_voice_copy_round_trip_and_wrong_pitch():
    from synthcorpus.resynth.render import VoiceRenderer

    notes = [(0.3, 0.8, 57, False), (0.8, 1.3, 59, True), (1.5, 2.1, 60, False), (2.1, 2.6, 60, False), (2.9, 3.6, 55, False)]
    timbre = {'kind': 'voice', 'vowel': 'a', 'singer': VoiceRenderer.choose_singer('a', [m for *_, m, _ in notes])}
    mk = lambda: spec_from_notes('test', 'v', dict(timbre), 3, [{'on': a, 'off': b, 'midi': m, 'legato': lg} for a, b, m, lg in notes], {})  # noqa: E731
    an = Analyzer('voice', (65.0, 1100.0)).analyse(render(mk(), None), SR)

    def report(sp):
        sp.refresh(an)
        c = Analyzer('voice', (65.0, 1100.0)).analyse(render(sp, an), SR)
        return Comparison(sp, an, c, Evidence(an)).report()

    rep = report(mk())
    assert rep['metrics']['pitch'] >= 0.95 and rep['metrics']['explained'] >= 0.95
    assert not [d for d in rep['diffs'] if d['type'] in ('pitch', 'missing-sound', 'extra-sound')], rep['diffs']
    sp = mk()
    sp.apply([{'op': 'set', 'id': 'n3', 'midi': 62}], an)
    assert [d for d in report(sp)['diffs'] if d['type'] == 'pitch' and d.get('note') == 'n3']


def test_export_into_a_new_dataset_links_audio_and_leaves_the_source_alone(sandbox, monkeypatch):
    from synthcorpus.resynth.export import Exporter
    from synthcorpus.resynth.session import ClipSession

    cfg, d, ann, prior = sandbox
    cfg = DatasetConfig('tws', 'context', 'whistling', prior='syllables', export_id='tws-notes')
    monkeypatch.setitem(datasets.DATASETS, 'tws', cfg)
    before = {p.name: p.read_bytes() for p in d.iterdir()}
    s = ClipSession(cfg, 'c1')
    s.init()
    assert len(s.evidence().anchors) == len(MELODY), 'the source truth onsets are the anchors'
    s.judge_view()
    s.verdict({'verdict': 'fail', 'summary': 'x', 'feedback': ['n1 late']})
    assert s.store.state()['status'] == 'needs-work' and s.store.state()['round'] == 2
    s.judge_view()
    s.verdict({'verdict': 'pass'})
    Exporter(cfg).export()
    out = d.parent / 'tws-notes'
    assert (out / 'c1__real.wav').samefile(d / 'c1__real.wav')
    assert json.loads((out / 'c1.truth.json').read_text())['notes'] == s.store.spec().truth_notes()
    ds = json.loads((out / 'dataset.json').read_text())
    assert ds['id'] == 'tws-notes' and ds['audioFrom'] == 'context/tws' and ds['noteTruthDerived'] is False and ds['clips'] == 1
    assert {p.name: p.read_bytes() for p in d.iterdir()} == before, 'the source dataset is untouched'
    assert (ann / 'resynth' / 'tws-notes' / 'c1.resynth.json').exists()


def test_export_skips_a_spec_the_judge_never_saw(sandbox):
    from synthcorpus.resynth.export import Exporter
    from synthcorpus.resynth.session import ClipSession

    cfg, d, ann, prior = sandbox
    s = ClipSession(cfg, 'c1')
    s.init()
    s.judge_view()
    s.verdict({'verdict': 'pass'})
    sp = s.store.spec()
    sp.apply([{'op': 'set', 'id': 'n1', 'midi': 85}], None)
    s.store.save_spec(sp)  # a crash after the spec was saved and before the state: state.json still says v1
    st = s.store.state()
    assert st['specVersion'] == 2 and st['judgedVersion'] == 1, 'the spec file wins over a stale state'
    out = Exporter(cfg).export()
    assert any('never judged' in x for x in out), out
    assert json.loads((d / 'c1.truth.json').read_text()) == prior, 'nothing was exported'
    assert not (ann / 'resynth' / 'tws' / 'c1.resynth.json').exists()
