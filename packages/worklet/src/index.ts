/**
 * Seedbeat AudioWorkletProcessor entry. Registered under the name below.
 * M2 fills in the sequencer and synthesis; for now it emits silence and announces itself.
 */
import { BLOCK_SIZE } from '@seedbeat/dsp';
import { PROTOCOL_VERSION, type MainToWorklet, type WorkletToMain } from './protocol';

export const PROCESSOR_NAME = 'seedbeat';

class SeedbeatProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<MainToWorklet>) => this.onMessage(e.data);
    this.post({ type: 'ready', protocolVersion: PROTOCOL_VERSION });
  }

  private post(msg: WorkletToMain): void {
    this.port.postMessage(msg);
  }

  private onMessage(_msg: MainToWorklet): void {
    // M2: start/stop the sequencer.
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (out) {
      for (const channel of out) {
        if (channel.length !== BLOCK_SIZE) continue;
        channel.fill(0);
      }
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, SeedbeatProcessor);
