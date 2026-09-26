"""Fetch the Apple GarageBand/Logic content packs the corpus uses.

GarageBand is licensed on this machine; its content licence permits royalty-free
use of the sampled instruments in audio you create (never redistribution of the
samples). The packs are the ones GarageBand's own Sound Library downloads
(catalogue: /Applications/GarageBand.app/Contents/Resources/garageband*.plist),
fetched from Apple's content CDN and expanded with `pkgutil` into
assets/apple/x/<pack>/ — nothing is installed system-wide.

  PYTHONPATH=. uv run python -m synthcorpus.fetch.fetch_apple
"""

import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'assets' / 'apple' / 'x'
CDN = 'https://audiocontentdownload.apple.com/lp10_ms3_content_2016/'
PACKS = [
    'MAContent10_AssetPack_0603_EXS_WorldErhu',
    'MAContent10_AssetPack_0446_EXS_WorldAsianChineseFlute',
    'MAContent10_AssetPack_0450_EXS_WorldAsianChineseFlute',
    'MAContent10_AssetPack_0452_EXS_WorldAsianJapaneseFlute',
    'MAContent10_AssetPack_0458_EXS_WorldEuroTinwhistle',
    'MAContent10_AssetPack_0462_EXS_WorldEuroRecorder',
    'MAContent10_AssetPack_0475_EXS_WorldSouthAmericaPanpipes',
    'MAContent10_AssetPack_0478_EXS_WorldSouthAsiaFlute',
    'MAContent10_AssetPack_0471_EXS_WorldNorthAmericaFlute',
    'MAContent10_AssetPack_0466_EXS_WorldEuroAccordion',
    'MAContent10_AssetPack_0482_EXS_OrchWoodwindAltoSax',
    'MAContent10_AssetPack_0483_EXS_OrchWoodwindBasson',
    'MAContent10_AssetPack_0484_EXS_OrchWoodwindClarinetSolo',
    'MAContent10_AssetPack_0486_EXS_OrchWoodwindEHornSolo',
    'MAContent10_AssetPack_0487_EXS_OrchWoodwindFluteSolo',
    'MAContent10_AssetPack_0489_EXS_OrchWoodwindOboeSolo',
    'MAContent10_AssetPack_0490_EXS_OrchWoodwindPiccolo',
    'MAContent10_AssetPack_0491_EXS_OrchBrass',
    'MAContent10_AssetPack_0510_EXS_Strings',
    'MAContent10_AssetPack_0547_EXS_StringsGB',
    'MAContent10_AssetPack_0354_EXS_PianoSteinway',
    'MAContent10_AssetPack_0373_EXS_GuitarsAcousticClassical',
    'MAContent10_AssetPack_0358_EXS_BassElectricFingerStyle',
    'MAContent10_AssetPack_0357_EXS_BassAcousticUprightJazz',
    'MAContent10_AssetPack_0331_IRsSmallSpaces',
    'MAContent10_AssetPack_0332_IRsMediumSpaces',
]

if __name__ == '__main__':
    DEST.mkdir(parents=True, exist_ok=True)
    for p in PACKS:
        if (DEST / p).exists():
            continue
        pkg = DEST.parent / f'{p}.pkg'
        urllib.request.urlretrieve(CDN + p + '.pkg', pkg)
        subprocess.run(['pkgutil', '--expand-full', str(pkg), str(DEST / p)], check=True, capture_output=True)
        pkg.unlink()
        print('ok', p)
