///
/// Copyright © 2016-2025 The SENTIENT Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///

/** What the port is, as far as the gateway can tell. */
export type SerialPortKind = 'usb' | 'cdc' | 'builtin' | 'bluetooth' | 'generic';

/** One port as the gateway's `gateway_serial_ports` RPC lists it. */
export interface SerialPortInfo {
  path: string;
  kind: SerialPortKind;
  chip?: string;
  manufacturer?: string;
  product?: string;
  byId?: string;
  usbId?: string;
  /** `RS-485` or `RS-232`, only when the adapter or the port says so. */
  bus?: string;
  /** Connectors whose configuration names this port. */
  inUse: string[];
  /** Whether the gateway's user may open it. */
  access: boolean;
  /** The port's group id, for the Docker `group_add:` line. */
  group?: number;
}

export interface SerialPortsAnswer {
  os: string;
  /** The gateway runs in a container (Docker, Podman, Kubernetes). */
  container: boolean;
  ports: SerialPortInfo[];
}

/** Why the list could not be had. */
export type SerialPortsProblem = 'unsupported' | 'unreachable';

export type SerialScanScope = 'quick' | 'thorough';

/** A device that answered, as the gateway reports it. */
export interface SerialScanDevice {
  unit: number;
  baudrate: number;
  bytesize: number;
  parity: string;
  stopbits: number;
  /** `data`: it read the register; `exception`: it refused, but it is there. */
  reply: 'data' | 'exception';
  vendor?: string;
  product?: string;
  revision?: string;
  byteOrder?: string;
  wordOrder?: string;
}

/** The gateway's `serialScan` client attribute. */
export interface SerialScanState {
  id: number;
  port: string;
  scope: SerialScanScope;
  state: 'running' | 'done' | 'stopped' | 'failed';
  done: number;
  total: number;
  probe: string;
  etaSeconds: number | null;
  paused: string[];
  found: SerialScanDevice[];
  error?: string;
}

/** The settings "Use these settings" puts into the dialog. */
export interface SerialScanChoice {
  unitId: number;
  baudrate: number;
  bytesize: number;
  parity: string;
  stopbits: number;
  byteOrder?: string;
  wordOrder?: string;
}

export const SERIAL_SCAN_ATTRIBUTE = 'serialScan';

/** A gateway answer may come flat or wrapped in `result`. */
export function rpcBody(response: any): any {
  const body = response?.result ?? response ?? {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

/** The same port, ignoring case on Windows (`com3` is `COM3`). */
export function samePort(a: string, b: string): boolean {
  const x = (a ?? '').trim();
  const y = (b ?? '').trim();
  return x === y || (/^com\d+$/i.test(x) && x.toUpperCase() === y.toUpperCase());
}
