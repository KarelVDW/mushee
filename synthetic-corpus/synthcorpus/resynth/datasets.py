"""Per-dataset configuration: where the clips live, what they are, how to draft and export them.

A dataset is either a TARGET (it lacks trustworthy note truth; its resynth truth is
exported into eval-real) or a CALIBRATION set (it has human truth; it is only ever
drafted blind, and its resynth truth goes to annotations/resynth-calibration/ for the
agreement measurement, never into eval-real).

Adding a dataset is one `DatasetConfig(...)` line. A new source with no prior notes
(the in-app takes, say) needs only an id, a tier, a material and `prior='segment'`:
the f0 range, analysis family and copy timbre all follow from the material.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # synthetic-corpus/
REPO = ROOT.parent
EVAL_REAL = Path(os.environ.get('RESYNTH_EVAL_REAL', REPO / 'apps' / 'api' / 'scripts' / 'fixtures' / 'eval-real'))
ANNOTATIONS = Path(os.environ.get('RESYNTH_ANNOTATIONS', REPO / 'apps' / 'api' / 'scripts' / 'eval' / 'annotations'))
WORK = Path(os.environ.get('RESYNTH_WORK', ROOT / 'work' / 'resynth'))

# material → (analysis family, default f0 range Hz, default copy timbre)
MATERIALS = {
    'whistling': ('whistle', (400.0, 5000.0), {'kind': 'whistle'}),
    'humming': ('voice', (70.0, 900.0), {'kind': 'voice', 'vowel': 'u', 'lowpassHz': 2500}),
    'singing': ('voice', (65.0, 1100.0), {'kind': 'voice', 'vowel': 'a'}),
}

# choir part → (f0 range Hz, singer sex) for dagstuhl-style clip names (`..._A1_HSM_ex00`)
VOICE_PARTS = {
    'S': ((200.0, 1100.0), 'female'),
    'A': ((140.0, 800.0), 'female'),
    'T': ((95.0, 600.0), 'male'),
    'B': ((65.0, 420.0), 'male'),
}


@dataclass
class PriorNotes:
    """The draft's starting point: notes from an existing truth file, or anchors for a blind draft."""

    source: str  # 'truth' | 'aligned' | 'segment' | 'none'
    path: str | None = None
    notes: list[dict] = field(default_factory=list)  # [{onsetSec, durSec, midi}]
    anchors: list[float] = field(default_factory=list)  # onset times the blind draft must honour (jacrc syllables)

    def describe(self) -> dict:
        d = {'source': self.source, 'notes': len(self.notes)}
        if self.path:
            d['path'] = self.path
        if self.anchors:
            d['anchors'] = len(self.anchors)
        return d


@dataclass
class DatasetConfig:
    id: str
    tier: str  # eval-real tier dir: 'benchmark' | 'context'
    material: str  # 'whistling' | 'humming' | 'singing' | 'instrument'
    role: str = 'target'  # 'target' | 'calibration'
    # 'truth'     — the dataset's own (derived) truth.json
    # 'aligned'   — the '<id>-aligned' sibling's truth.json (identical audio)
    # 'segment'   — blind f0 segmentation
    # 'syllables' — blind f0 segmentation with the dataset's truth onsets as anchors (jacrc)
    prior: str = 'truth'
    f0_range: tuple[float, float] | None = None
    timbre: dict | None = None  # copy timbre; default from the material
    export_id: str | None = None  # export into a NEW dataset dir next to this one (jacrc-notes)
    export_meta: dict = field(default_factory=dict)  # extra dataset.json fields set on export
    voice_parts: bool = False  # choose register / singer sex from the clip name (_S1_, _A2_, …)

    # ------------------------------------------------------------ locations
    @property
    def dir(self) -> Path:
        return EVAL_REAL / self.tier / self.id

    @property
    def export_dir(self) -> Path:
        return EVAL_REAL / self.tier / (self.export_id or self.id)

    @property
    def annotation_dir(self) -> Path:
        if self.role == 'calibration':
            return ANNOTATIONS / 'resynth-calibration' / self.id
        return ANNOTATIONS / 'resynth' / (self.export_id or self.id)

    def audio_path(self, clip: str) -> Path:
        for ext in ('wav', 'flac', 'webm', 'ogg', 'mp3'):
            p = self.dir / f'{clip}__real.{ext}'
            if p.exists():
                return p
        return self.dir / f'{clip}__real.wav'

    def clips(self) -> list[str]:
        if not self.dir.exists():
            return []
        out = {re.sub(r'__real\.[a-z0-9]+$', '', p.name) for p in self.dir.iterdir() if re.search(r'__real\.[a-z0-9]+$', p.name)}
        return sorted(out, key=_natural)

    # ------------------------------------------------------------ material
    @property
    def family(self) -> str:
        if self.material == 'instrument':
            return 'instrument'
        return MATERIALS[self.material][0]

    def voice_part(self, clip: str) -> str | None:
        if not self.voice_parts:
            return None
        m = re.search(r'_([SATB])\d_', clip)
        return m.group(1) if m else None

    def f0_range_for(self, clip: str) -> tuple[float, float]:
        part = self.voice_part(clip)
        if part:
            return VOICE_PARTS[part][0]
        if self.f0_range:
            return self.f0_range
        if self.material not in MATERIALS:
            raise SystemExit(f'{self.id}: an {self.material} dataset needs an explicit f0_range')
        return MATERIALS[self.material][1]

    def timbre_for(self, clip: str) -> dict:
        if self.timbre is None and self.material not in MATERIALS:
            raise SystemExit(f'{self.id}: an {self.material} dataset needs an explicit timbre')
        t = dict(self.timbre or MATERIALS[self.material][2])
        part = self.voice_part(clip)
        if part and t.get('kind') == 'voice':
            t['sex'] = VOICE_PARTS[part][1]
        return t

    # ------------------------------------------------------------ prior
    def truth_path(self, clip: str, ds_dir: Path | None = None) -> Path | None:
        """The clip's pre-resynth truth: `.truth-derived.json` once an export has moved it aside."""
        d = ds_dir or self.dir
        for name in (f'{clip}.truth-derived.json', f'{clip}.truth.json'):
            p = d / name
            if p.exists():
                return p
        return None

    def prior_notes(self, clip: str, blind: bool = False) -> PriorNotes:
        if self.role == 'calibration' or self.prior == 'segment':
            return PriorNotes('none' if self.role == 'calibration' else 'segment')
        if blind:
            return PriorNotes('segment')
        if self.prior == 'syllables':
            p = self.truth_path(clip)
            anchors = [float(n['onsetSec']) for n in json.loads(p.read_text())['notes']] if p else []
            return PriorNotes('segment', _rel(p) if p else None, anchors=anchors)
        if self.prior == 'aligned':
            sib = EVAL_REAL / self.tier / f'{self.id}-aligned'
            p = sib / f'{clip}.truth.json'
            if p.exists():
                return PriorNotes('aligned', _rel(p), json.loads(p.read_text())['notes'])
        p = self.truth_path(clip)
        if p is None:
            return PriorNotes('segment')
        return PriorNotes('truth', _rel(p), json.loads(p.read_text())['notes'])

    def tempo(self, clip: str) -> dict:
        """bpm (and beatGrid, where the dataset has one) to carry into the exported truth."""
        p = self.truth_path(clip)
        if p is None:
            return {'bpm': 120}
        d = json.loads(p.read_text())
        out = {'bpm': d.get('bpm', 120)}
        if d.get('beatGrid'):
            out['beatGrid'] = d['beatGrid']
        return out

    def dataset_json(self) -> dict:
        p = self.dir / 'dataset.json'
        return json.loads(p.read_text()) if p.exists() else {}


def _natural(s: str):
    return [int(x) if x.isdigit() else x for x in re.split(r'(\d+)', s)]


def _rel(p: Path) -> str:
    try:
        return str(p.relative_to(REPO))
    except ValueError:
        return str(p)


DATASETS: dict[str, DatasetConfig] = {
    d.id: d
    for d in [
        # ---------------------------------------------------------- targets
        DatasetConfig('whistled-high-register', 'context', 'whistling', prior='aligned', f0_range=(500.0, 5000.0)),
        DatasetConfig('whistle-real', 'context', 'whistling'),
        DatasetConfig('whistle-vintage', 'context', 'whistling', export_meta={'pooled': False}),
        DatasetConfig('mir-qbsh', 'context', 'humming', f0_range=(70.0, 800.0)),
        DatasetConfig('humtrans', 'context', 'humming', prior='aligned'),
        DatasetConfig('dagstuhl-choir', 'benchmark', 'singing', voice_parts=True),
        DatasetConfig('jacrc-students', 'benchmark', 'singing', prior='syllables', f0_range=(90.0, 1100.0), export_id='jacrc-notes'),
        # ---------------------------------------------------------- calibration (blind only)
        DatasetConfig('vocadito', 'benchmark', 'singing', role='calibration'),
        DatasetConfig('n20emv2', 'benchmark', 'singing', role='calibration'),
        DatasetConfig('hust-solfege', 'benchmark', 'singing', role='calibration'),
        DatasetConfig('urmp-flute', 'benchmark', 'instrument', role='calibration', f0_range=(240.0, 2300.0),
                      timbre={'kind': 'instrument', 'timbre': 'flute', 'source': 'iowa-flute'}),
        DatasetConfig('urmp-violin', 'benchmark', 'instrument', role='calibration', f0_range=(180.0, 2100.0),
                      timbre={'kind': 'instrument', 'timbre': 'violin', 'source': 'philharmonia-violin'}),
        DatasetConfig('urmp-trumpet', 'benchmark', 'instrument', role='calibration', f0_range=(150.0, 1100.0),
                      timbre={'kind': 'instrument', 'timbre': 'trumpet', 'source': 'iowa-trumpet'}),
    ]
}


def get(ds: str) -> DatasetConfig:
    if ds not in DATASETS:
        raise SystemExit(f'unknown dataset {ds!r}; known: {", ".join(DATASETS)}')
    return DATASETS[ds]


def parse_ref(ref: str) -> tuple[DatasetConfig, str]:
    if '/' not in ref:
        raise SystemExit(f'expected <dataset>/<clip>, got {ref!r}')
    ds, clip = ref.split('/', 1)
    return get(ds), clip
