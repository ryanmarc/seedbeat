/**
 * WebUSB transport for the Xbox Riffmaster (TIMING.md §3). Chrome and Edge on macOS and Linux:
 * the dongle has no OS driver there, so the page claims it, sends the GIP init packets and reads
 * input reports as they arrive (one interrupt transfer each, about every 4 ms while anything
 * moves). Each report is stamped with performance.now() as its transfer resolves and handed to
 * `GuitarLanes` to turn into lane events. Windows cannot take this path: its own GIP driver owns
 * the device.
 */
import {
  GIP_CONFIGURATION,
  GIP_ENDPOINT_IN,
  GIP_ENDPOINT_OUT,
  GIP_INIT_PACKETS,
  GIP_INTERFACE,
  GIP_PACKET_SIZE,
  RIFFMASTER_XBOX,
  parseGipInput,
  type GuitarReport,
} from './gip';

export type GuitarReportSink = (report: GuitarReport, perfMs: number) => void;

export function webUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.usb;
}

/** Permission prompt (needs a user gesture). Resolves null when the chooser is dismissed. */
export async function requestGuitar(): Promise<USBDevice | null> {
  const usb = navigator.usb;
  if (!usb) return null;
  try {
    return await usb.requestDevice({ filters: [RIFFMASTER_XBOX] });
  } catch {
    return null;
  }
}

/** A dongle this origin was already granted, if one is plugged in. */
export async function knownGuitar(): Promise<USBDevice | null> {
  const usb = navigator.usb;
  if (!usb) return null;
  try {
    const devices = await usb.getDevices();
    return (
      devices.find(
        (d) => d.vendorId === RIFFMASTER_XBOX.vendorId && d.productId === RIFFMASTER_XBOX.productId,
      ) ?? null
    );
  } catch {
    return null;
  }
}

export class GuitarUsb {
  private running = false;
  private readonly onDisconnect = (e: USBConnectionEvent): void => {
    if (e.device === this.device) this.stop();
  };

  constructor(
    readonly device: USBDevice,
    private readonly onReport: GuitarReportSink,
    private readonly onClosed: () => void,
  ) {}

  /** Open, claim, init, then read until `stop` or the dongle goes away. Throws if the claim fails. */
  async start(): Promise<void> {
    const d = this.device;
    if (!d.opened) await d.open();
    await d.selectConfiguration(GIP_CONFIGURATION);
    await d.claimInterface(GIP_INTERFACE);
    for (const pkt of GIP_INIT_PACKETS) await d.transferOut(GIP_ENDPOINT_OUT, pkt);
    this.running = true;
    navigator.usb?.addEventListener('disconnect', this.onDisconnect);
    void this.readLoop();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    navigator.usb?.removeEventListener('disconnect', this.onDisconnect);
    const d = this.device;
    void d
      .releaseInterface(GIP_INTERFACE)
      .catch(() => undefined)
      .then(() => d.close())
      .catch(() => undefined);
    this.onClosed();
  }

  private async readLoop(): Promise<void> {
    while (this.running) {
      let result: USBInTransferResult;
      try {
        result = await this.device.transferIn(GIP_ENDPOINT_IN, GIP_PACKET_SIZE);
      } catch {
        // Device gone or transfer failed: the disconnect event (or this) ends the session.
        this.stop();
        return;
      }
      if (!this.running) return;
      if (result.status !== 'ok' || !result.data) continue;
      const perfMs = performance.now();
      const dv = result.data;
      const report = parseGipInput(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
      if (report) this.onReport(report, perfMs);
    }
  }
}
