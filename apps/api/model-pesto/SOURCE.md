# PESTO model provenance

- Checkpoint: **mir-1k_g7**
- Source: https://github.com/SonyCSLParis/pesto
- Export: streaming ONNX via `realtime/export_onnx.py`
- Sampling rate: 16000 Hz
- Chunk size: 160 samples (≈ 10 ms hop)
- Regenerate: `apps/api/scripts/fetch-pesto-model.sh mir-1k_g7`

`metadata.json` records the cache layout and pitch-bin parameters that
PestoProvider needs at runtime. Do not edit by hand — re-run the script
above to refresh the model and metadata together.
