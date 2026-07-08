# CREPE model provenance

- Capacity: **tiny**
- Source: https://github.com/marl/crepe — `crepe.core.build_and_load_model("tiny")`,
  converted to TF.js layers format
- Loaded by: `src/recordings/` CREPE provider (default dir; override with
  `CREPE_TINY_MODEL_DIR`)
- Regenerate: `apps/api/scripts/fetch-crepe-model.sh tiny`

Do not edit these files by hand. Re-run the script above to refresh them, then
commit the new `model.json`, weight shards, and this file together. The
`apps/inference-crepe/crepe_saved_model` SavedModel is derived from these exact
weights — reconvert it in the same pass (see its SOURCE.md).
