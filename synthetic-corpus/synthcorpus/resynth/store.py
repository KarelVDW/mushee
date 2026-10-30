"""Per-clip work directory and state machine (`work/resynth/<dataset>/<clip>/`).

Every step persists before it returns, so an interrupted clip resumes from `state.json`.

    drafted ──edit/iterate──▶ (submit / judge-view) ──▶ awaiting-judge ──verdict──▶ passed ──export──▶ exported
        ▲                                                     │ FAIL, round < 5
        └──────────────────── needs-work ◀────────────────────┘ FAIL at round 5 ──▶ unresolved

An edit while awaiting-judge returns the clip to drafted / needs-work. A passed, unresolved
or exported clip is closed: edits need `--reopen` (which returns it to needs-work).
"""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

from .datasets import WORK, DatasetConfig
from .spec import Spec

STATUSES = ('drafted', 'needs-work', 'awaiting-judge', 'passed', 'unresolved', 'exported')
OPEN = ('drafted', 'needs-work', 'awaiting-judge')
CLOSED = ('passed', 'unresolved', 'exported')
MAX_ROUNDS = 5


def now() -> str:
    return time.strftime('%Y-%m-%dT%H:%M:%S%z')


def write_json(path: Path, data, indent: int | None = 1) -> None:
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_text(json.dumps(data, indent=indent, ensure_ascii=False) + '\n')
    tmp.replace(path)


class ClipStore:
    def __init__(self, cfg: DatasetConfig, clip: str):
        self.cfg = cfg
        self.clip = clip
        self.dir = WORK / cfg.id / clip

    @property
    def ref(self) -> str:
        return f'{self.cfg.id}/{self.clip}'

    # ------------------------------------------------------------ paths
    def path(self, name: str) -> Path:
        return self.dir / name

    @property
    def history(self) -> Path:
        return self.dir / 'history'

    @property
    def panels(self) -> Path:
        return self.dir / 'panels'

    def exists(self) -> bool:
        return self.path('state.json').exists()

    def wipe(self) -> None:
        if self.dir.exists():
            shutil.rmtree(self.dir)

    # ------------------------------------------------------------ state
    def state(self) -> dict:
        if not self.exists():
            raise SystemExit(f'{self.ref}: not initialised (run init)')
        st = json.loads(self.path('state.json').read_text())
        # the spec is saved before the state: after a crash between the two, the spec file wins
        sp = self.path('spec.json')
        if sp.exists():
            st['specVersion'] = json.loads(sp.read_text()).get('version', st.get('specVersion'))
        return st

    def save_state(self, st: dict) -> None:
        write_json(self.path('state.json'), st)

    def transition(self, st: dict, status: str, event: str, **extra) -> dict:
        assert status in STATUSES, status
        st['status'] = status
        st.setdefault('history', []).append({'at': now(), 'event': event, 'status': status, 'round': st.get('round', 1), 'specVersion': st.get('specVersion'), **extra})
        self.save_state(st)
        return st

    def open_status(self, st: dict) -> str:
        return 'needs-work' if st.get('round', 1) > 1 else 'drafted'

    # ------------------------------------------------------------ documents
    def spec(self) -> Spec:
        return Spec.load(self.path('spec.json'))

    def save_spec(self, sp: Spec) -> None:
        self.history.mkdir(parents=True, exist_ok=True)
        sp.save(self.path('spec.json'))
        write_json(self.history / f'spec.v{sp.version}.json', sp.to_json())

    def report(self) -> dict | None:
        p = self.path('report.json')
        return json.loads(p.read_text()) if p.exists() else None

    def save_report(self, rep: dict) -> None:
        self.history.mkdir(parents=True, exist_ok=True)
        write_json(self.path('report.json'), rep)
        write_json(self.history / f'report.v{rep["specVersion"]}.json', rep)

    def verdict(self) -> dict | None:
        p = self.path('judge.json')
        return json.loads(p.read_text()) if p.exists() else None

    def save_verdict(self, v: dict, rnd: int) -> None:
        self.history.mkdir(parents=True, exist_ok=True)
        write_json(self.path('judge.json'), v)
        write_json(self.history / f'judge.r{rnd}.json', v)

    def verdicts(self) -> list[dict]:
        if not self.history.exists():
            return []
        out = [json.loads(p.read_text()) for p in self.history.glob('judge.r*.json')]
        return sorted(out, key=lambda v: v.get('round', 0))

    def log(self, event: str, **data) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        with self.path('log.jsonl').open('a') as f:
            f.write(json.dumps({'at': now(), 'event': event, **data}, ensure_ascii=False) + '\n')
