# CREPE SavedModel provenance

- Model: CREPE **tiny** (https://github.com/marl/crepe), plain-TensorFlow
  SavedModel format
- Derived from: the exact TF.js layers weights the API ships in
  `apps/api/model-crepe-tiny/` (bit-identical forward pass — gated by
  `apps/api/scripts/eval/check-inference-parity.ts`)
- Conversion: one-off on the host — load the TF.js layers model with the
  `tensorflowjs` Python package (`tfjs.converters.load_keras_model`) and
  `model.save()` it as a SavedModel (the tfjs→SavedModel direction has no
  maintained CLI; see git history around the introduction of this service)
- Consumed by: `server.py` (dir baked into the image as `/models/crepe-tiny`,
  override with `CREPE_MODEL_DIR`)

Do not edit these files by hand. If `apps/api/model-crepe-tiny/` changes,
reconvert, re-run the parity gate, and commit both model directories together.
