///
/// Copyright © 2016-2025 The Thingsboard Authors
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

import { ModbusOrderType } from '../../../models/public-api';

/** The byte and word order a dialog hands back to the slave form. */
export interface ModbusOrderChoice {
  byteOrder: ModbusOrderType;
  wordOrder: ModbusOrderType;
}

export interface ModbusOrderDetectData {
  gatewayDeviceId: string;
  connectorName: string;
  /** The slave's connection keys, as the slave dialog would save them. */
  slave: Record<string, unknown>;
  current: ModbusOrderChoice;
}

export interface ModbusOrderHelpData {
  /** Offer "Use" buttons that hand the order back to the slave form. */
  selectable: boolean;
  current?: ModbusOrderChoice;
}

/** One way of reading the registers, as `modbus_detectOrder` answers it. */
export interface ModbusOrderCandidate extends ModbusOrderChoice {
  name: string;
  value: number | null;
  plausible: boolean;
  suggested: boolean;
}

export interface ModbusOrderDetectResult {
  success: boolean;
  error?: string;
  registersHex?: string[];
  candidates?: ModbusOrderCandidate[];
  suggested?: ModbusOrderChoice | null;
  confidence?: 'high' | 'low' | 'none';
  reason?: string;
}

/** The value types that span more than one register. */
export const ModbusOrderValueTypes = ['32float', '32int', '32uint', '64float', '64int', '64uint'];

/** The four orders of a 32-bit value ABCD, as the industry names them. */
export const ModbusOrderNames: ReadonlyArray<ModbusOrderChoice & { name: string; description: string }> = [
  { byteOrder: ModbusOrderType.BIG, wordOrder: ModbusOrderType.BIG, name: 'ABCD',
    description: 'Big-endian, high word first' },
  { byteOrder: ModbusOrderType.BIG, wordOrder: ModbusOrderType.LITTLE, name: 'CDAB',
    description: 'Word-swapped, low word first' },
  { byteOrder: ModbusOrderType.LITTLE, wordOrder: ModbusOrderType.BIG, name: 'BADC',
    description: 'Byte-swapped' },
  { byteOrder: ModbusOrderType.LITTLE, wordOrder: ModbusOrderType.LITTLE, name: 'DCBA',
    description: 'Little-endian' },
];

/**
 * What devices usually use. A rule of thumb, not a guarantee: the device's
 * Modbus manual always wins, and models of one brand can differ.
 */
export const ModbusOrderConventions: ReadonlyArray<ModbusOrderChoice & { devices: string; note?: string }> = [
  { devices: 'Energy meters and power analysers: Schneider PowerLogic (PM5xxx, iEM), Siemens SENTRON PAC, ' +
      'Janitza, Socomec, Eastron SDM, ABB M4M', byteOrder: ModbusOrderType.BIG, wordOrder: ModbusOrderType.BIG },
  { devices: 'Siemens S7-1200 / S7-1500 as Modbus server (MB_SERVER)',
    byteOrder: ModbusOrderType.BIG, wordOrder: ModbusOrderType.BIG, note: 'S7 is big-endian: a REAL is already ABCD' },
  { devices: 'CODESYS-based PLCs: ABB AC500, WAGO, Schneider M241 / M251 / M262, Beckhoff via Modbus',
    byteOrder: ModbusOrderType.BIG, wordOrder: ModbusOrderType.LITTLE },
  { devices: 'Schneider Modicon M340 / M580 / Premium',
    byteOrder: ModbusOrderType.BIG, wordOrder: ModbusOrderType.LITTLE },
  { devices: 'Mitsubishi MELSEC Q / iQ-R / iQ-F (D registers)',
    byteOrder: ModbusOrderType.BIG, wordOrder: ModbusOrderType.LITTLE },
  { devices: 'Rockwell Micro800, and most Modbus gateway modules for Allen-Bradley',
    byteOrder: ModbusOrderType.BIG, wordOrder: ModbusOrderType.LITTLE, note: 'Varies with the gateway module' },
  { devices: 'Carlo Gavazzi meters (EM24, EM210…)',
    byteOrder: ModbusOrderType.BIG, wordOrder: ModbusOrderType.LITTLE, note: 'For 32-bit integers; check the manual' },
];

export function orderName(byteOrder: string, wordOrder: string): string {
  return ModbusOrderNames.find(o => o.byteOrder === byteOrder && o.wordOrder === wordOrder)?.name ?? '';
}
