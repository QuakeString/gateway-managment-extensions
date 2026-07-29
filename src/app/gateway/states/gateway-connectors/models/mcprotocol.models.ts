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

import { ReportStrategyConfig } from '../../../shared/models/public-api';

export enum McValueType {
  BOOL = 'bool',
  UINT16 = 'uint16',
  INT16 = 'int16',
  UINT32 = 'uint32',
  INT32 = 'int32',
  UINT64 = 'uint64',
  INT64 = 'int64',
  FLOAT32 = 'float32',
  FLOAT64 = 'float64',
  STRING = 'string',
}

export enum McPlcSeries {
  Q = 'Q',
  L = 'L',
  QNA = 'QnA',
  IQ_L = 'iQ-L',
  IQ_R = 'iQ-R',
}

export interface McDataKey {
  tag: string;
  address: string;
  valueType?: McValueType | string;
  /** Calibration — same flat persisted shape as S7 / ADS / Modbus
   *  (exactly one of multiplier / divider / adder / subtractor, or
   *  2-point linear scaling). */
  multiplier?: number;
  divider?: number;
  adder?: number;
  subtractor?: number;
  scaling?: McScaling;
  reportStrategy?: ReportStrategyConfig;
}

export interface McScaling {
  rawMin: number;
  rawMax: number;
  engMin: number;
  engMax: number;
}

export interface McRpcConfig {
  method: string;
  address: string;
  valueType?: McValueType | string;
  operation: 'read' | 'write';
}

export interface McDeviceConfig {
  deviceName: string;
  deviceType: string;
  host: string;
  port: number;
  /** PLC series: Q (default), L, QnA, iQ-L, iQ-R. */
  plcSeries: McPlcSeries | string;
  /** MC frame type: 3E (default) or 4E. */
  frame: '3E' | '4E' | string;
  /** Payload encoding: binary (default) or ascii — must match the PLC's
   *  Ethernet open setting in GX Works. */
  commType: 'binary' | 'ascii' | string;
  /** Network No. of the access target; 0 = own network. */
  network?: number;
  /** Network-module station No.; 255 (0xFF) = own station. */
  pcStation?: number;
  /** Multidrop module I/O; 1023 (0x3FF) = the CPU module. */
  destModuleIo?: number;
  /** Multidrop module station No. */
  destModuleStation?: number;
  timeoutMs: number;
  pollPeriod: number;
  connectAttemptCount: number;
  waitAfterFailedAttemptsMs: number;
  reportStrategy?: ReportStrategyConfig;
  timeseries: McDataKey[];
  attributes: McDataKey[];
  attributeUpdates: McDataKey[];
  rpc: McRpcConfig[];
}

export interface McBasicConfig {
  devices: McDeviceConfig[];
}

export enum McValueKey {
  TIMESERIES = 'timeseries',
  ATTRIBUTES = 'attributes',
  ATTRIBUTES_UPDATES = 'attributeUpdates',
  RPC = 'rpc',
}

/**
 * GX Works-style MELSEC device address:
 *   Bit devices (bool only): X1A, Y0, M200, L0, F0, V0, B1F, SM400, SB0,
 *     DX0, DY0, TS5, TC5, STS2, STC2, CS3, CC3 (+ iQ-R LTS/LTC/LSTS/LCS/LCC)
 *   Word devices: D100, SD210, W0FF, SW0, TN5, STN2, CN3, R100, ZR1000
 *     (+ iQ-R LTN/LSTN/LCN/LZ/RD) — with an optional .bit (0-15) suffix,
 *     e.g. D100.5.
 *   X, Y, B, W, SB, SW, DX, DY, ZR number their points in hexadecimal.
 */
const MC_HEX_BIT = '(?:SB|DX|DY|X|Y|B)[0-9A-F]{1,8}';
const MC_DEC_BIT = '(?:SM|STS|STC|TS|TC|CS|CC|LTS|LTC|LSTS|LCS|LCC|M|L|F|V)\\d{1,8}';
const MC_HEX_WORD = '(?:SW|ZR|W)[0-9A-F]{1,8}';
const MC_DEC_WORD = '(?:SD|STN|TN|CN|LTN|LSTN|LCN|LZ|RD|D|R)\\d{1,8}';
const MC_BIT_SUFFIX = '(?:\\.(?:0?\\d|1[0-5]))?';

export const MC_ADDRESS_REGEX = new RegExp(
  `^\\s*(?:${MC_HEX_BIT}|${MC_DEC_BIT}|(?:${MC_HEX_WORD}|${MC_DEC_WORD})${MC_BIT_SUFFIX})\\s*$`, 'i');

const MC_BIT_DEVICE_REGEX = new RegExp(
  `^\\s*(?:${MC_HEX_BIT}|${MC_DEC_BIT})\\s*$`, 'i');

export function isValidMcAddress(value: string): boolean {
  return MC_ADDRESS_REGEX.test((value ?? '').toString());
}

/** True when the address can only hold a bool: a bit device (M200, X1A, TS5)
 *  or a word device with a .bit suffix (D100.5). */
export function isMcBitAddress(value: string): boolean {
  const v = (value ?? '').toString();
  return MC_BIT_DEVICE_REGEX.test(v) || /\.\d{1,2}\s*$/.test(v);
}
