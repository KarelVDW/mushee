#!/usr/bin/env bash
# Downloads the FluidR3_GM soundfont (the GM kit the web app's MidiPlayer uses)
# into scripts/eval/assets/. Used by the eval harness to render instrument
# melodies to audio via fluidsynth. ~140 MB; gitignored.
set -euo pipefail

DEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/assets"
DEST="$DEST_DIR/FluidR3_GM.sf2"
mkdir -p "$DEST_DIR"

if [ -s "$DEST" ]; then
  echo "Soundfont already present: $DEST"
  exit 0
fi

# Mirrors, tried in order.
URLS=(
  "https://musical-artifacts.com/artifacts/738/FluidR3_GM.sf2"
  "https://archive.org/download/free-soundfonts-sf2-2019-04/FluidR3_GM.sf2"
  "https://github.com/musescore/MuseScore/raw/master/share/sound/FluidR3Mono_GM.sf3"
)

for url in "${URLS[@]}"; do
  echo "Trying $url"
  if curl -fL --retry 3 -o "$DEST.part" "$url"; then
    mv "$DEST.part" "$DEST"
    echo "Downloaded soundfont to $DEST ($(du -h "$DEST" | cut -f1))"
    exit 0
  fi
  rm -f "$DEST.part"
done

echo "Failed to download soundfont from all mirrors." >&2
exit 1
