# YAMNet model provenance

- Model: **YAMNet** (AudioSet event classifier, MobileNetV1, 3.7 M params)
- License: **Apache-2.0** (Google Research; part of tensorflow/models research/audioset)
- Source: the official TF.js GraphModel conversion, downloaded from Kaggle Models
  (formerly TF-Hub):
  `curl -sL -o yamnet-tfjs.tar.gz https://www.kaggle.com/api/v1/models/google/yamnet/tfJs/tfjs/1/download`
- Class map: `yamnet_class_map.csv` from
  https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv
- Loaded by: `src/recordings/pipeline/profiles/source-classifier.ts` (default dir;
  override with `YAMNET_MODEL_DIR`)
- Input: mono float32 waveform at **16 kHz** (matches the pipeline's detect rate)
- Outputs: log-mel spectrogram `[t, 64]`, embeddings `[frames, 1024]`, and class
  **logits** `[frames, 521]` — note this conversion emits logits, not sigmoid scores.

Policy note: the classifier is used with its **stock published class scores only**
(a fixed comparison of two class groups). No head is fitted on top — the project
never trains model weights (see research/research-voice-transcription.md, policy note + D5).

Do not edit these files by hand. Re-download from the Kaggle URL above and commit
`model.json`, the four weight shards, the class map and this file together.
