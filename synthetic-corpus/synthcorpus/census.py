"""Aggregate an analyze-synth.ts census (JSONL) with the corpus's per-note performance attributes."""
import collections
import glob
import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'out'


def load(paths):
    rows = [json.loads(l) for p in paths for l in open(p) if l.startswith('{"d"')]
    attrs = {}
    for f in OUT.glob('*/*/*.meta.json'):
        m = json.loads(f.read_text())
        attrs[f.name[: -len('.meta.json')]] = m
    for r in rows:
        m = attrs.get(r['clip'], {})
        na = m.get('note_attrs') or []
        a = na[r['i']] if r['i'] < len(na) else [0, 0, 0, 0]
        r['legato'], r['stac'], r['glide'] = a[0], a[1], a[2] > 0
        r['family'] = 'voice' if r['d'].startswith('synth-voice') else 'instrument'
        prev_same = False
        r['vib'] = m.get('vibrato_style')
    return rows


def table(rows, key, title):
    by = collections.defaultdict(collections.Counter)
    for r in rows:
        by[key(r)][r['cat']] += 1
    cats = ['ok', 'ok+split', 'late', 'early', 'split', 'merged', 'pitch', 'octave', 'missed']
    print(f'\n== {title}')
    print(f"{'':22s}{'n':>6s}" + ''.join(f'{c:>9s}' for c in cats))
    for k in sorted(by, key=lambda k: -sum(by[k].values())):
        c = by[k]
        n = sum(c.values())
        print(f'{str(k)[:22]:22s}{n:6d}' + ''.join(f'{100 * c[x] / n:8.1f}%' for x in cats))


if __name__ == '__main__':
    rows = load(sys.argv[1:])
    table(rows, lambda r: r['family'], 'by family')
    table(rows, lambda r: ('legato' if r['legato'] else 'stacc' if r['stac'] else 'detached') + '/' + r['family'], 'by articulation')
    table(rows, lambda r: 'dur<0.2' if r['dur'] < 0.2 else 'dur<0.4' if r['dur'] < 0.4 else 'dur<0.8' if r['dur'] < 0.8 else 'dur>=0.8', 'by duration')
    table(rows, lambda r: f"midi {r['midi'] // 6 * 6}-{r['midi'] // 6 * 6 + 5}", 'by pitch band')
    table(rows, lambda r: r['vib'] or '-', 'voices by vibrato style')
    table(rows, lambda r: r['d'], 'by dataset')
