"""Fetch the VocalSet (CC-BY-4.0, zenodo 1193957) files the voice engine uses."""
import re
import sys
from pathlib import Path

from synthcorpus.remotezip import open_remote_zip

URL = 'https://zenodo.org/api/records/1193957/files/VocalSet.zip/content'
OUT = Path(__file__).resolve().parent.parent / 'assets' / 'vocalset'
KEEP = re.compile(r'FULL/(fe)?male\d+/(scales|arpeggios)/(straight|vibrato|vibrado|slow_piano|slow_forte|fast_piano|fast_forte|breathy|belt)/|FULL/(fe)?male\d+/long_tones/(straight|forte|pp|messa)/|FULL/(fe)?male\d+/excerpts/')

z = open_remote_zip(URL)
names = [n for n in z.namelist() if n.endswith('.wav') and KEEP.search(n)]
print(len(names), 'files', sum(z.getinfo(n).file_size for n in names) / 1e6, 'MB', flush=True)
for i, n in enumerate(names):
    dst = OUT / n.replace('FULL/', '')
    if dst.exists() and dst.stat().st_size == z.getinfo(n).file_size:
        continue
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(z.read(n))
    if i % 50 == 0:
        print(i, n, flush=True)
print('DONE')
