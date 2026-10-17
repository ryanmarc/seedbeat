/**
 * GIP (Xbox One "Game Input Protocol") for the PDP Riffmaster, as spoken over its USB dongle.
 * Pure parsing and constants; the WebUSB plumbing lives in input-webusb.ts. Layout from the
 * PlasticBand documentation and verified against the real dongle on 2026-10-16: the dongle is a
 * plain vendor-class USB device (class ff/47/d0) with one interrupt IN and one interrupt OUT
 * endpoint, and no OS driver claims it on macOS or Linux, so a page may.
 */

/** PDP Riffmaster, Xbox model. Reported by the dongle whether or not the guitar is on. */
export const RIFFMASTER_XBOX = { vendorId: 0x0e6f, productId: 0x0248 } as const;

/** Interface 0 of configuration 1 carries the GIP endpoints (1 IN, 2 OUT). */
export const GIP_CONFIGURATION = 1;
export const GIP_INTERFACE = 0;
export const GIP_ENDPOINT_IN = 1;
export const GIP_ENDPOINT_OUT = 2;
export const GIP_PACKET_SIZE = 64;

/**
 * Init sequence from Linux xpad for PDP controllers: power on, LED on, "authentication done".
 * Byte 2 of each packet is the sequence number (never zero). After these the guitar streams
 * 0x20 input reports, on change, roughly every 4 ms while something moves.
 */
export const GIP_INIT_PACKETS: readonly Uint8Array<ArrayBuffer>[] = [
  Uint8Array.from([0x05, 0x20, 1, 0x01, 0x00]),
  Uint8Array.from([0x0a, 0x20, 2, 0x03, 0x00, 0x01, 0x14]),
  Uint8Array.from([0x06, 0x20, 3, 0x02, 0x01, 0x00]),
];

const CMD_INPUT = 0x20;
const HEADER = 4;
/** Payload bytes we read: buttons (2), tilt, whammy, pickup, upper frets, lower frets. */
const MIN_PAYLOAD = 7;
const STRUM_UP = 0x0100;
const STRUM_DOWN = 0x0200;

/** One guitar input report. Fret masks are GRYBO in bits 0–4. */
export interface GuitarReport {
  upper: number;
  solo: number;
  strumUp: boolean;
  strumDown: boolean;
  /** 0 at rest … 255 fully pressed. */
  whammy: number;
  /** 0 flat … 255 straight up. */
  tilt: number;
}

/** Parse one interrupt transfer. Returns null for anything but a complete input report. */
export function parseGipInput(data: Uint8Array): GuitarReport | null {
  if (data.length < HEADER + MIN_PAYLOAD || data[0] !== CMD_INPUT) return null;
  const len = data[3]!;
  if (len < MIN_PAYLOAD || data.length < HEADER + len) return null;
  const p = data.subarray(HEADER, HEADER + len);
  const buttons = p[0]! | (p[1]! << 8);
  return {
    upper: p[5]! & 0x1f,
    solo: p[6]! & 0x1f,
    strumUp: (buttons & STRUM_UP) !== 0,
    strumDown: (buttons & STRUM_DOWN) !== 0,
    whammy: p[3]!,
    tilt: p[2]!,
  };
}
