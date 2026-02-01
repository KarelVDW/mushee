import { BasicPitch } from "@spotify/basic-pitch";
import {
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly,
} from "@spotify/basic-pitch";
import { readFile } from "fs/promises";
import { AudioContext, AudioBuffer } from "web-audio-api";
import { writeMidi, MidiData } from "midi-file";
import { writeFile } from "fs/promises";

async function convert() {
  const buffer = await readFile("./data/test.mp3");
  const modelBuffer = await readFile("./data/model.json");
  const modelJson = JSON.parse(modelBuffer.toString());
  const basicPitch = new BasicPitch(
    "https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/model.json",
  );
  const audioCtx = new AudioContext({ numberOfChannels: 1 });
  let audioBuffer: AudioBuffer | undefined = undefined;

  // Decode audio data
  await new Promise<void>((resolve, reject) => {
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    audioCtx.decodeAudioData(
      arrayBuffer,
      (_audioBuffer: AudioBuffer) => {
        audioBuffer = _audioBuffer;
        resolve();
      },
      (error: any) => {
        reject(new Error(`Failed to decode audio: ${error}`));
      },
    );
  });

  if (!audioBuffer) throw new Error("Failed to decode audio buffer");

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  let progress = 0;

  await basicPitch.evaluateModel(
    audioBuffer,
    (f: number[][], o: number[][], c: number[][]) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p: number) => {
      progress = p;
      console.log(`Processing: ${Math.round(p * 100)}%`);
    },
  );

  // Convert to notes
  const rawNotes = outputToNotesPoly(frames, onsets, 0.25, 0.25, 5);
  const notesWithPitchBends = addPitchBendsToNoteEvents(contours, rawNotes);
  const notes = noteFramesToTime(notesWithPitchBends);

  // Convert notes to MIDI events
  const ticksPerBeat = 480;
  const bpm = 125; // BPM as input variable
  const tempo = 60000000 / bpm; // microseconds per beat
  const secondsPerTick = tempo / 1000000 / ticksPerBeat;

  // Sort notes by start time
  const sortedNotes = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

  // Create MIDI events from notes
  const trackEvents: Array<{
    time: number;
    type: "noteOn" | "noteOff";
    noteNumber: number;
    velocity: number;
  }> = [];

  for (const note of sortedNotes) {
    const startTick = Math.round(note.startTimeSeconds / secondsPerTick);
    const endTick = Math.round((note.startTimeSeconds + note.durationSeconds) / secondsPerTick);
    const velocity = Math.round((note.amplitude ?? 0.8) * 127);

    trackEvents.push({
      time: startTick,
      type: "noteOn",
      noteNumber: note.pitchMidi,
      velocity,
    });
    trackEvents.push({
      time: endTick,
      type: "noteOff",
      noteNumber: note.pitchMidi,
      velocity: 0,
    });
  }

  // Sort events by time
  trackEvents.sort((a, b) => a.time - b.time);

  // Convert to delta times
  let lastTime = 0;
  const midiTrackEvents: any[] = [
    { deltaTime: 0, meta: true, type: "setTempo", microsecondsPerBeat: tempo },
  ];

  for (const event of trackEvents) {
    const deltaTime = event.time - lastTime;
    lastTime = event.time;

    midiTrackEvents.push({
      deltaTime,
      channel: 0,
      type: event.type,
      noteNumber: event.noteNumber,
      velocity: event.velocity,
    });
  }

  midiTrackEvents.push({ deltaTime: 0, meta: true, type: "endOfTrack" });

  const midiData: MidiData = {
    header: {
      format: 0,
      numTracks: 1,
      ticksPerBeat,
    },
    tracks: [midiTrackEvents],
  };

  console.log("Conversion result:", {
    noteCount: notes.length,
    duration: (audioBuffer as any).duration,
  });

  const midiBytes = writeMidi(midiData);
  await writeFile("./data/output.mid", Buffer.from(midiBytes));
}

convert()
  .then((result) => {
    console.log("Conversion complete", result);
  })
  .catch((error) => {
    console.error("Error during conversion:", error);
  });
