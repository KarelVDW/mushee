"""Export the accepted corpus into the app's eval harness layout.

  PYTHONPATH=. uv run python -m synthcorpus.export

Writes apps/api/scripts/fixtures/eval-synth/<dataset>/ (gitignored, like every
fixture dir): one dataset per timbre / voice type with a `dataset.json` the
harness's discovery reads (lib/realCorpus.ts), `<clip>.truth.json`, and one
`<clip>__<condition>.wav` per recording condition. WAVs are HARD LINKS to
out/ (same volume), so the export costs no disk. Only clips that passed the
quality gate are exported.
"""

from __future__ import annotations

import json
import os
import shutil
from collections import defaultdict
from pathlib import Path

from .instruments import BY_ID

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'out'
DEST = ROOT.parent / 'apps' / 'api' / 'scripts' / 'fixtures' / 'eval-synth'
CONDITIONS = ('dry', 'studio', 'room', 'home-phone', 'noisy-phone')

SOURCE_LICENCES = {
    'apple': 'Apple GarageBand content (licensed on this machine; royalty-free for created audio, samples never redistributed)',
    'iowa': 'University of Iowa MIS (free for any use)',
    'vsco': 'VSCO-2 CE (CC0)',
    'vcsl': 'VCSL (CC0)',
    'karoryfer': 'Karoryfer (CC0)',
    'sfzinstruments': 'sfzinstruments / MTG SoloSax (CC0 / CC-BY-4.0)',
    'philharmonia': 'Philharmonia Orchestra samples (free, not for resale as samples)',
    'sso': 'Sonatina Symphonic Orchestra (CC Sampling+ 1.0)',
    'freepats': 'FreePats (CC0)',
    'salamander': 'Salamander Grand Piano (CC-BY-3.0)',
    'vocalset': 'VocalSet (CC-BY-4.0)',
}


def export(log=print) -> None:
    if DEST.exists():
        shutil.rmtree(DEST)
    DEST.mkdir(parents=True)
    groups: dict[str, list[dict]] = defaultdict(list)
    for mp in sorted(OUT.glob('*/*/*.meta.json')):
        if mp.parent.name.startswith('_'):
            continue
        m = json.loads(mp.read_text())
        if not m.get('passed'):
            continue
        clip = mp.name[: -len('.meta.json')]
        group = mp.parent.parent.name
        ds = f'synth-voice-{mp.parent.name}' if group == 'voices' else f'synth-{mp.parent.name}'
        groups[ds].append({**m, '_dir': mp.parent, '_clip': clip})
    total = 0
    for ds, clips in sorted(groups.items()):
        d = DEST / ds
        d.mkdir()
        voice = ds.startswith('synth-voice-')
        name = ds.removeprefix('synth-voice-') if voice else ds.removeprefix('synth-')
        t = None if voice else BY_ID.get(name)
        srcs = sorted({c['source'] for c in clips})
        lic = sorted({SOURCE_LICENCES.get(s.split('-')[0], s) for s in srcs})
        manifest = {
            'id': ds,
            'label': f"{'Voice — ' + name if voice else name} (realistic synthetic)",
            'kind': 'voice' if voice else 'instrument',
            'material': 'singing' if voice else 'instrument',
            'instrumentId': 'voice-lead' if voice else (t.app_ids[0] if t else name),
            'appInstrumentIds': ['voice-lead'] if voice else (t.app_ids if t else [name]),
            'tier': 'synthetic',
            'license': '; '.join(lic),
            'licenceRestricted': False,
            'clips': len(clips),
            'totalNotes': sum(c['notes'] for c in clips),
            'sources': srcs,
            'notes': 'Realistic synthetic performances (synthetic-corpus/): real public-domain melodies performed by a performer model and '
            'rendered from REAL recordings of the instrument/singer, recorded through measured rooms, phone microphones and the browser '
            'codec. Truth is exact by construction and verified per clip by independent pitch trackers (SwiftF0 + pYIN).',
        }
        (d / 'dataset.json').write_text(json.dumps(manifest, indent=1))
        for c in clips:
            src_dir: Path = c['_dir']
            clip = c['_clip']
            shutil.copy2(src_dir / f'{clip}.truth.json', d / f'{clip}.truth.json')
            for cond in CONDITIONS:
                f = src_dir / f'{clip}__{cond}.wav'
                if f.exists():
                    os.link(f, d / f.name)
                    total += 1
        log(f'{ds:28s} {len(clips):3d} clips  sources={",".join(srcs)}')
    log(f'exported {sum(len(v) for v in groups.values())} clips / {total} wavs into {DEST}')


if __name__ == '__main__':
    export()
