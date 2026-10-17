import { describe, expect, it } from 'vitest';
import { GIP_INIT_PACKETS, RIFFMASTER_XBOX, parseGipInput } from './gip';

/** Builds a 36-byte GIP input transfer (4-byte header + 32-byte Riffmaster payload). */
function report(fields: {
  buttons?: number;
  tilt?: number;
  whammy?: number;
  pickup?: number;
  upper?: number;
  lower?: number;
  joyX?: number;
  joyY?: number;
}): Uint8Array {
  const b = new Uint8Array(36);
  b[0] = 0x20;
  b[1] = 0x00;
  b[2] = 7;
  b[3] = 32;
  const p = b.subarray(4);
  const buttons = fields.buttons ?? 0;
  p[0] = buttons & 0xff;
  p[1] = buttons >> 8;
  p[2] = fields.tilt ?? 0;
  p[3] = fields.whammy ?? 0;
  p[4] = (fields.pickup ?? 0) << 4;
  p[5] = fields.upper ?? 0;
  p[6] = fields.lower ?? 0;
  const jx = fields.joyX ?? 0;
  const jy = fields.joyY ?? 0;
  p[10] = jx & 0xff;
  p[11] = (jx >> 8) & 0xff;
  p[12] = jy & 0xff;
  p[13] = (jy >> 8) & 0xff;
  return b;
}

describe('GIP (Xbox Riffmaster)', () => {
  it('knows the dongle and the xpad init sequence with sequence numbers filled in', () => {
    expect(RIFFMASTER_XBOX).toEqual({ vendorId: 0x0e6f, productId: 0x0248 });
    const pk = GIP_INIT_PACKETS.map((p) => Array.from(p));
    expect(pk).toEqual([
      [0x05, 0x20, 1, 0x01, 0x00], // power on
      [0x0a, 0x20, 2, 0x03, 0x00, 0x01, 0x14], // LED on
      [0x06, 0x20, 3, 0x02, 0x01, 0x00], // auth done
    ]);
  });
  it('parses frets, solo frets, strum, whammy and tilt from a captured-style report', () => {
    // Captured 2026-10-16: green + red upper frets, strum down, whammy 101, tilt 148.
    const r = parseGipInput(report({ buttons: 0x0230, upper: 0b00011, whammy: 101, tilt: 148 }));
    expect(r).toEqual({
      upper: 0b00011,
      solo: 0,
      strumUp: false,
      strumDown: true,
      whammy: 101,
      tilt: 148,
    });
  });
  it('reads solo frets from their own mask and strum up from bit 8', () => {
    const r = parseGipInput(report({ buttons: 0x0100 | 0x4000, lower: 0b10000 }));
    expect(r?.solo).toBe(0b10000);
    expect(r?.upper).toBe(0);
    expect(r?.strumUp).toBe(true);
    expect(r?.strumDown).toBe(false);
  });
  it('ignores non-input commands and truncated reports', () => {
    const status = new Uint8Array([0x03, 0x20, 1, 4, 0x89, 0x01, 0, 0]);
    expect(parseGipInput(status)).toBeNull();
    const short = report({}).subarray(0, 9); // header + 5 payload bytes, no fret masks
    expect(parseGipInput(short)).toBeNull();
    expect(parseGipInput(new Uint8Array(0))).toBeNull();
  });
  it('accepts the 10-byte Jaguar-length payload (no joystick)', () => {
    const b = report({ upper: 0b00100 }).subarray(0, 14);
    b[3] = 10;
    expect(parseGipInput(b)?.upper).toBe(0b00100);
  });
});
