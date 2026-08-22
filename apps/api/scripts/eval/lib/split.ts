/**
 * Deterministic dev/test split of the real corpus.
 *
 * Every threshold in this pipeline was chosen by looking at corpus scores, which
 * means the corpus has been used as a training set — and a number tuned on the
 * same clips it is reported on is not evidence of anything. From here on: tune on
 * `dev`, and look at `test` only to confirm a decision already made.
 *
 * The split is by clip name hash rather than by index so that it is stable when
 * clips are added or a dataset is re-fetched, and identical across machines.
 */

/** FNV-1a — small, fast, and stable across runs and platforms. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Split = 'dev' | 'test' | 'all';

/**
 * The unit the split is drawn over — the **performer or piece**, not the clip.
 *
 * Splitting by clip leaks: Annotated-VocalSet gives one singer dozens of clips, so
 * a per-clip split puts the same voice (same timbre, same vibrato, same room, same
 * intonation habits) in both halves, and "confirmed on test" then means much less
 * than it appears to. Grouping by performer makes the test half genuinely unseen.
 *
 * Conventions, all encoded in the clip names by their fetchers:
 *   annotated-vocalset  `f1_arpeggios_breathy_a`   → singer  `f1`
 *   guitarset-solo      `00_BN1-129-Eb_solo`       → player  `00`
 *   urmp-*              `01_Jupiter_vn1`           → piece   `01`
 *   n20emv2*            `sub03_1-27-a-17`          → subject `sub03`
 *   vocadito            `vocadito_1`               → one clip each; no grouping
 *   mir-qbsh            `year2003_person00010_...` → person  `person00010`
 *   csd                 `alto1_ER_w0`              → singer  `alto1`
 *   esmuc-choir         `A1_DG_take1`              → singer  `A1`
 *   hust-solfege        `hust_1011`                → one recording per subject; no grouping
 *   avp                 `avp_P10_HHclosed_Fixed`   → participant `P10`
 *   dagstuhl-choir      `DCS_LI_QuartetA_Take01_A1_HSM_ex01` → singer `QuartetA_A1`
 *   jacrc-students      `daxp-…-dx-S8_ex00`        → student `dx-S8`
 *
 * The last three all produce MANY clips per performer — AVP gives one participant
 * a clip per drum class and modality, and the two excerpted corpora give one
 * singer several 30 s windows of the same take — so leaving them on the default
 * per-clip fallback would put the same voice in both halves, which is precisely
 * the leak this function exists to prevent.
 *
 * For n20emv2 we group by **subject**, not by song, even though that corpus's own
 * published split is by song. The two answer different questions: theirs keeps a
 * *song* out of training, ours keeps a *voice* out of the test half. Subjects recur
 * across their song split, so grouping by song here would leave the same singer on
 * both sides — the exact leak this function exists to prevent. Their split is
 * honoured separately, by keeping their test songs in their own `n20emv2-test` dir.
 */
function groupKeyFor(dataset: string, clip: string): string {
  if (dataset === 'mir-qbsh') {
    return clip.match(/person\d+/)?.[0] ?? clip;
  }
  if (dataset === 'avp') {
    // `avp_P10_HHclosed_Fixed` → `P10`
    return clip.split('_')[1] ?? clip;
  }
  if (dataset === 'dagstuhl-choir') {
    // `DCS_LI_QuartetA_Take01_A1_HSM_ex01` → `QuartetA_A1`: the same four people
    // sing every take of both pieces, so the quartet+voice pair is the person.
    const p = clip.split('_');
    return p.length >= 5 ? `${p[2]}_${p[4]}` : clip;
  }
  if (dataset === 'jacrc-students') {
    // `daxp-Meng_ting_de-…-dx-S8_ex00` → `dx-S8`. Student ids repeat across
    // schools (every school has an S1), so the school prefix is part of the key;
    // `S2(1)`/`S2(2)` are two takes by one student and must group together,
    // which stopping the match at the digits achieves.
    const m = /-([a-z]+)-(S\d+)/.exec(clip);
    return m ? `${m[1]}-${m[2]}` : clip;
  }
  if (
    dataset === 'annotated-vocalset' ||
    dataset === 'guitarset-solo' ||
    dataset === 'csd' ||
    dataset === 'esmuc-choir' ||
    dataset.startsWith('urmp-') ||
    dataset.startsWith('n20emv2')
  ) {
    const head = clip.split('_')[0];
    return head || clip;
  }
  return clip;
}

/**
 * Which half a clip belongs to. Keyed on dataset too, so a name that happens to
 * appear in two datasets doesn't correlate their assignments, and on the *group*
 * rather than the clip so a performer never straddles the split.
 */
export function splitOf(dataset: string, clip: string): 'dev' | 'test' {
  return hash(`${dataset}/${groupKeyFor(dataset, clip)}`) % 2 === 0 ? 'dev' : 'test';
}

export function inSplit(dataset: string, clip: string, want: Split): boolean {
  return want === 'all' || splitOf(dataset, clip) === want;
}

/** Reads EVAL_SPLIT (dev | test | all), defaulting to dev — the safe default. */
export function splitFromEnv(): Split {
  const v = (process.env.EVAL_SPLIT ?? 'dev').toLowerCase();
  return v === 'test' || v === 'all' ? v : 'dev';
}
