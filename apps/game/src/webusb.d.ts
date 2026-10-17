/**
 * The slice of WebUSB the guitar adapter uses (engine/input-webusb.ts). TypeScript's DOM lib
 * does not ship these; declaring the few members we call keeps the dependency list unchanged.
 */
interface USBDeviceFilter {
  vendorId?: number;
  productId?: number;
}

interface USBInTransferResult {
  data?: DataView;
  status: 'ok' | 'stall' | 'babble';
}

interface USBOutTransferResult {
  bytesWritten: number;
  status: 'ok' | 'stall';
}

interface USBDevice {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName?: string;
  readonly opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(index: number): Promise<void>;
  releaseInterface(index: number): Promise<void>;
  transferIn(endpoint: number, length: number): Promise<USBInTransferResult>;
  transferOut(endpoint: number, data: BufferSource): Promise<USBOutTransferResult>;
}

interface USBConnectionEvent extends Event {
  readonly device: USBDevice;
}

interface USB extends EventTarget {
  getDevices(): Promise<USBDevice[]>;
  requestDevice(options: { filters: USBDeviceFilter[] }): Promise<USBDevice>;
  addEventListener(
    type: 'connect' | 'disconnect',
    listener: (ev: USBConnectionEvent) => void,
  ): void;
  removeEventListener(
    type: 'connect' | 'disconnect',
    listener: (ev: USBConnectionEvent) => void,
  ): void;
}

interface Navigator {
  readonly usb?: USB;
}
