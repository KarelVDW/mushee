"""resynth CLI — see synthetic-corpus/RESYNTH.md.

  PYTHONPATH=. .venv/bin/python -m synthcorpus.resynth status
  PYTHONPATH=. .venv/bin/python -m synthcorpus.resynth init whistle-real --all
  PYTHONPATH=. .venv/bin/python -m synthcorpus.resynth iterate whistle-real/commons-donna
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from .datasets import DATASETS, get, parse_ref
from .store import STATUSES, ClipStore


def _clip_rows(ds_filter: str | None, status: str | None) -> list[dict]:
    rows = []
    for cfg in DATASETS.values():
        if ds_filter and cfg.id != ds_filter:
            continue
        for clip in cfg.clips():
            st = ClipStore(cfg, clip)
            if not st.exists():
                s = {'status': 'pending'}
                rep = None
            else:
                s = st.state()
                rep = st.report()
            if status and s['status'] != status:
                continue
            m = (rep or {}).get('metrics', {})
            rows.append({'ref': st.ref, 'status': s['status'], 'round': s.get('round'), 'specVersion': s.get('specVersion'), 'notes': m.get('notes'),
                         'pitch': m.get('pitch'), 'onsetF1': m.get('onsetF1'), 'diffs': len(rep['diffs']) if rep else None})
    return rows


def cmd_status(args) -> None:
    cols = ('pending',) + STATUSES
    print(f'{"dataset":<24}{"role":<12}{"clips":>6}' + ''.join(f'{c:>15}' for c in cols))
    tot = {c: 0 for c in cols}
    for cfg in DATASETS.values():
        clips = cfg.clips()
        cnt = {c: 0 for c in cols}
        for clip in clips:
            st = ClipStore(cfg, clip)
            cnt[st.state()['status'] if st.exists() else 'pending'] += 1
        for c in cols:
            tot[c] += cnt[c]
        print(f'{cfg.id:<24}{cfg.role:<12}{len(clips):>6}' + ''.join(f'{cnt[c]:>15}' for c in cols))
    print(f'{"total":<36}{sum(tot.values()):>6}' + ''.join(f'{tot[c]:>15}' for c in cols))


def cmd_list(args) -> None:
    rows = _clip_rows(args.dataset, args.status)
    if args.json:
        print(json.dumps(rows))
        return
    for r in rows:
        extra = '' if r['notes'] is None else f'  {r["notes"]} notes  pitch {r["pitch"]:.0%}  F1 {r["onsetF1"]:.2f}  {r["diffs"]} diffs'
        print(f'{r["ref"]:<64}{r["status"]:<15}' + (f'r{r["round"]} v{r["specVersion"]}' if r['round'] else '') + extra)


def cmd_init(args) -> None:
    from .session import ClipSession

    if '/' in args.target:
        cfg, clip = parse_ref(args.target)
        clips = [clip]
    else:
        cfg = get(args.target)
        if args.clips:
            clips = args.clips.split(',')
        elif args.all:
            clips = cfg.clips()
        else:
            raise SystemExit('init <dataset>: pass --clips a,b or --all (or init <dataset>/<clip>)')
    many = len(clips) > 1
    for clip in clips:
        t = time.time()
        s = ClipSession(cfg, clip)
        try:
            out = s.init(force=args.force, blind=args.blind)
        except SystemExit as e:
            if not many:
                raise
            print(f'{s.ref}: FAILED {e}')
            continue
        if not many:
            print(out)
            continue
        rep = s.store.report()
        if rep and 'already initialised' not in out:
            m = rep['metrics']
            print(f'{s.ref}: {m["notes"]} notes  pitch {m["pitch"]:.0%}  F1 {m["onsetF1"]:.2f}  explained {m["explained"]:.0%}  {len(rep["diffs"])} diffs  {time.time() - t:.1f}s')
        else:
            print(out.splitlines()[0])


def _session(ref: str):
    from .session import ClipSession

    cfg, clip = parse_ref(ref)
    return ClipSession(cfg, clip)


def cmd_show(args) -> None:
    print(_session(args.ref).show(args.t0, args.t1))


def _probe(ref: str):
    from .probe import ClipProbe

    return ClipProbe(_session(ref))


def cmd_inspect(args) -> None:
    print(_probe(args.ref).inspect(args.t0, args.t1, args.hop))


def cmd_zoom(args) -> None:
    print(_probe(args.ref).zoom(args.t0, args.t1))


def cmd_note(args) -> None:
    print(_probe(args.ref).note([x.strip() for x in args.ids.split(',') if x.strip()]))


def cmd_edit(args) -> None:
    ops = None
    if args.ops_file:
        ops = json.loads(Path(args.ops_file).read_text())
    elif args.ops:
        ops = json.loads(args.ops)
    if isinstance(ops, dict):
        ops = [ops]
    apply = args.apply.split(',') if args.apply else None
    print(_session(args.ref).edit(ops, apply, reopen=args.reopen))


def cmd_autofix(args) -> None:
    from .spec import AutoFixer

    kinds = tuple(k for k in AutoFixer.KINDS if getattr(args, k)) or AutoFixer.KINDS
    print(_session(args.ref).autofix(kinds, reopen=args.reopen))


def cmd_render(args) -> None:
    s = _session(args.ref)
    t = time.time()
    _, fresh = s.render(force=args.force)
    print(f'{s.ref}: {"rendered" if fresh else "up to date"} spec v{s.store.spec().version} → {s.store.path("synth.flac")} ({time.time() - t:.1f}s)')


def cmd_compare(args) -> None:
    s = _session(args.ref)
    print(s.report_text(s.compare(panels=not args.no_panels)))


def cmd_iterate(args) -> None:
    print(_session(args.ref).iterate(force=args.force))


def cmd_submit(args) -> None:
    print(_session(args.ref).submit())


def cmd_judge_view(args) -> None:
    print(_session(args.ref).judge_view())


def cmd_verdict(args) -> None:
    print(_session(args.ref).verdict(json.loads(Path(args.file).read_text())))


def cmd_export(args) -> None:
    from .export import Exporter

    if args.target and '/' in args.target:
        cfg, clip = parse_ref(args.target)
        clips = [clip]
    else:
        ds = args.dataset or args.target
        if not ds:
            raise SystemExit('export: pass --dataset <id> or <dataset>/<clip>')
        cfg, clips = get(ds), None
    for line in Exporter(cfg, dry_run=args.dry_run).export(clips):
        print(line)


def cmd_selftest(args) -> None:
    from .selftest import FAMILIES, SelfTest

    t = SelfTest(per_family=args.per_family, seed=args.seed)
    if args.refs:
        t.refs = args.refs
    if args.families:
        t.families = args.families.split(',')
        unknown = set(t.families) - {f.name for f in FAMILIES}
        if unknown:
            raise SystemExit(f'unknown families {sorted(unknown)}; known: {", ".join(f.name for f in FAMILIES)}')
    res = t.run()
    print(SelfTest.table(res))
    if not args.no_save:
        print(f'→ {t.save(res)}')


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog='python -m synthcorpus.resynth', description='note truth for real recordings by iterative resynthesis (RESYNTH.md)')
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('status', help='clips per dataset by status').set_defaults(fn=cmd_status)
    p = sub.add_parser('list', help='clips with status and latest metrics')
    p.add_argument('--dataset')
    p.add_argument('--status', choices=('pending',) + STATUSES)
    p.add_argument('--json', action='store_true')
    p.set_defaults(fn=cmd_list)
    p = sub.add_parser('init', help='analyse + draft + autofix + first render and compare')
    p.add_argument('target', help='<dataset> (with --clips/--all) or <dataset>/<clip>')
    p.add_argument('--clips')
    p.add_argument('--all', action='store_true')
    p.add_argument('--force', action='store_true', help='discard existing work and start over')
    p.add_argument('--blind', action='store_true', help='ignore the prior notes; draft by f0 segmentation')
    p.set_defaults(fn=cmd_init)
    p = sub.add_parser('show', help='spec notes, last judge feedback, latest report')
    p.add_argument('ref')
    p.add_argument('--from', dest='t0', type=float, default=0.0)
    p.add_argument('--to', dest='t1', type=float, default=float('inf'))
    p.set_defaults(fn=cmd_show)
    p = sub.add_parser('inspect', help='frame table over a window: trackers, level, onset envelope + events, copy, covering note (read-only)')
    p.add_argument('ref')
    p.add_argument('--t0', type=float, required=True)
    p.add_argument('--t1', type=float, required=True)
    p.add_argument('--hop', type=float, default=0.02, help='row step in seconds (coarsened to keep ≤ 120 rows)')
    p.set_defaults(fn=cmd_inspect)
    p = sub.add_parser('zoom', help='close-up panel PNG of a short window (≤ 4 s) → panels/zoom-<t0>-<t1>.png')
    p.add_argument('ref')
    p.add_argument('--t0', type=float, required=True)
    p.add_argument('--t1', type=float, required=True)
    p.set_defaults(fn=cmd_zoom)
    p = sub.add_parser('note', help="one or more notes' evidence: pitch, voicing, onset evidence, events inside, neighbours (read-only)")
    p.add_argument('ref')
    p.add_argument('ids', help='note ids, comma-separated (n12,n13)')
    p.set_defaults(fn=cmd_note)
    p = sub.add_parser('edit', help='apply edit ops atomically (see spec.py for the op list)')
    p.add_argument('ref')
    p.add_argument('--ops', help='JSON list of ops')
    p.add_argument('--ops-file')
    p.add_argument('--apply', help='apply the suggested ops of report diffs, e.g. D2,D5')
    p.add_argument('--reopen', action='store_true')
    p.set_defaults(fn=cmd_edit)
    p = sub.add_parser('autofix', help='conservative evidence-led fixes (all kinds unless some are named)')
    p.add_argument('ref')
    for k in ('phantoms', 'pitch', 'gaps', 'offsets', 'onsets'):
        p.add_argument(f'--{k}', action='store_true')
    p.add_argument('--reopen', action='store_true')
    p.set_defaults(fn=cmd_autofix)
    for name, fn, hlp in (('render', cmd_render, 'render the copy of the current spec'), ('compare', cmd_compare, 'compare + report'),
                          ('iterate', cmd_iterate, 'render (if stale) + compare + panels + report'), ('submit', cmd_submit, 'hand the current spec to the judge'),
                          ('judge-view', cmd_judge_view, 'the judge\'s view: report + panels (sets awaiting-judge)')):
        p = sub.add_parser(name, help=hlp)
        p.add_argument('ref')
        if name in ('render', 'iterate'):
            p.add_argument('--force', action='store_true')
        if name == 'compare':
            p.add_argument('--no-panels', action='store_true')
        p.set_defaults(fn=fn)
    p = sub.add_parser('verdict', help='record the judge verdict: {"verdict":"pass|fail","summary":…,"feedback":[…]}')
    p.add_argument('ref')
    p.add_argument('--file', required=True)
    p.set_defaults(fn=cmd_verdict)
    p = sub.add_parser('export', help='export passed/unresolved clips (truth, artifacts, copies, contours)')
    p.add_argument('target', nargs='?', help='<dataset>/<clip> (or a dataset id)')
    p.add_argument('--dataset')
    p.add_argument('--dry-run', action='store_true')
    p.set_defaults(fn=cmd_export)
    p = sub.add_parser('selftest', help='perturbation self-test: inject wrong notes into human truth, check the report flags them')
    p.add_argument('refs', nargs='*', help='<dataset>/<clip> with human truth (default: vocadito_1, vocadito_7, urmp-flute 03_Dance_fl1)')
    p.add_argument('--families', help='comma list (default: all; see selftest.py)')
    p.add_argument('--per-family', type=int, default=6, help='injected errors per family per clip (one render each)')
    p.add_argument('--seed', type=int, default=1)
    p.add_argument('--no-save', action='store_true', help='print only; do not write work/resynth/_selftest/')
    p.set_defaults(fn=cmd_selftest)
    args = ap.parse_args(argv)
    args.fn(args)


if __name__ == '__main__':
    sys.exit(main())
