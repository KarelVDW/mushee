/**
 * Shared types for the recording-pipeline evaluation harness.
 *
 * A "melody" is register-agnostic: a list of notes expressed as semitone
 * offsets from a root, with a length in beats. Concrete audio is produced by
 * transposing the melody to a target root MIDI note (`Scenario.rootMidi`) and
 * either rendering it through a soundfont (instruments) or synthesizing it
 * directly (voice / whistle).
 */

/** One note of a melody, relative to the melody's root. */
export interface MelodyNote {
  /** Semitone offset from the scenario root. */
  degree: number;
  /** Length in beats. */
  beats: number;
}

export interface Melody {
  name: string;
  bpm: number;
  notes: MelodyNote[];
}

/** A concrete, absolute-pitch note with timing in seconds. */
export interface TruthNote {
  onsetSec: number;
  durSec: number;
  /** Absolute MIDI pitch (concert / sounding). */
  midi: number;
}

/** Ground truth for one rendered clip. */
export interface GroundTruth {
  bpm: number;
  notes: TruthNote[];
}

/** How a scenario's audio is produced. */
export type SourceKind = 'instrument' | 'voice' | 'whistle';

export interface Scenario {
  /** Stable id, used as the output directory name. */
  id: string;
  /** Human label for reports. */
  label: string;
  kind: SourceKind;
  /** MIDI note the melody's degree 0 maps to (sets the register). */
  rootMidi: number;
  /** General MIDI program (0-indexed) — instruments only. */
  gmProgram?: number;
  /** Optional instrument id hint, mirrors the web app's Instrument.id. */
  instrumentId?: string;
}

/** A degradation condition applied to a clean clip via ffmpeg. */
export interface Condition {
  id: string;
  label: string;
  /** Added background noise. Omit for a clean condition. */
  noise?: { color: 'pink' | 'white'; amplitude: number };
  /**
   * ffmpeg `-af` chain applied AFTER loudnorm (and after noise mixing, if any):
   * mic EQ coloration, band-limiting, light reverb. Empty = none.
   */
  postFilter?: string;
}
