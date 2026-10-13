/**
 * JIT warm-up for the audio thread. The first seconds of a song otherwise pay for compiling the
 * voice, envelope and effect paths while notes are already sounding (3–8 ms blocks on a phone,
 * against a 5 ms callback). Renders a short inaudible mix into scratch buffers before the
 * processor reports ready, so Sparkplug/Maglev code exists for every voice kind, the filter
 * envelope, the delay, reverb, compressor and limiter.
 */
import {
  BLOCK_SIZE,
  type Engine,
  type Trigger,
  eventTriggers,
  hitSoundTriggers,
} from '@seedbeat/dsp';

export const WARMUP_BLOCKS = 240;

export function warmUp(engine: Engine): void {
  const l = new Float32Array(BLOCK_SIZE);
  const r = new Float32Array(BLOCK_SIZE);
  const triggers: Trigger[] = [];
  const sd = 0.125;
  let frame = 0;
  for (const mood of ['lofi', 'synthwave', 'chiptune', 'techno'] as const) {
    engine.configure(mood, sd);
    // One of each event family: kick/snare/hat (noise, kick), bass/lead/keys (tones, filter env).
    const events = [
      { type: 'kick' },
      { type: 'snare' },
      { type: 'hat' },
      { type: 'bass', midi: 36, len: 2 },
      { type: 'lead', midi: 72, len: 2 },
      { type: 'keys', midis: [60, 64, 67], len: 4 },
    ];
    for (let i = 0; i < events.length; i++) {
      triggers.length = 0;
      eventTriggers(mood, events[i]!, sd, triggers);
      for (let k = 0; k < triggers.length; k++) {
        const p = triggers[k]!.params;
        // Inaudible even if anything leaked: the output stays in the scratch buffers anyway.
        p.vol *= 1e-4;
      }
      engine.triggerAll(triggers, frame + i * 64);
    }
    triggers.length = 0;
    hitSoundTriggers('perfect', triggers);
    engine.triggerAll(triggers, frame, true);
    for (let b = 0; b < WARMUP_BLOCKS / 4; b++) {
      engine.render(l, r, BLOCK_SIZE, frame);
      frame += BLOCK_SIZE;
    }
  }
  engine.allNotesOff();
  // Leave it on a mood without crackle; start() configures the real one.
  engine.configure('synthwave', sd);
}
