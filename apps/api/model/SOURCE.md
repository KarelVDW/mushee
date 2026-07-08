# basic-pitch model provenance

- Model: Spotify **basic-pitch** (ICASSP 2022), TF.js graph-model format
- Source: the `model/` directory shipped inside the `@spotify/basic-pitch@1.0.1`
  npm package (weights bit-identical to the package's
  `group1-shard1of1.bin`; `model.json` is the same graph, pretty-printed)
- Loaded by: `src/recordings/` basic-pitch provider (default dir; override with
  `BASIC_PITCH_MODEL_DIR`)
- Regenerate: copy `node_modules/@spotify/basic-pitch/model/*` here

Do not edit these files by hand. When bumping the `@spotify/basic-pitch`
dependency, re-copy the model and re-run the eval gate
(`scripts/eval/run-eval.ts`) plus the inference parity check before committing.
