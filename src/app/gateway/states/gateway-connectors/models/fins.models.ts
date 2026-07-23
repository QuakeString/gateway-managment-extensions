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

export enum FinsValueType {
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

export interface FinsDataKey {
  tag: string;
  address: string;
  valueType?: FinsValueType | string;
  /** Calibration — same flat persisted shape as S7 / ADS / Modbus
   *  (exactly one of multiplier / divider / adder / subtractor, or
   *  2-point linear scaling). */
  multiplier?: number;
  divider?: number;
  adder?: number;
  subtractor?: number;
  scaling?: FinsScaling;
  reportStrategy?: ReportStrategyConfig;
}

export interface FinsScaling {
  rawMin: number;
  rawMax: number;
  engMin: number;
  engMax: number;
}

export interface FinsRpcConfig {
  method: string;
  address: string;
  valueType?: FinsValueType | string;
  operation: 'read' | 'write';
}

export interface FinsDeviceConfig {
  deviceName: string;
  deviceType: string;
  host: string;
  port: number;
  /** FINS network number (DNA); 0 = local network. */
  network?: number;
  /** DA1 — destination node; defaults to the last octet of the host IP. */
  destinationNode?: number;
  /** DA2 — destination unit; 0 = CPU unit. */
  destinationUnit?: number;
  /** SA1 — source node; defaults to the last octet of the local IP. */
  sourceNode?: number;
  timeoutMs: number;
  /** Multi-word storage convention: true (default) = low word first (CX-Programmer). */
  lowWordFirst: boolean;
  pollPeriod: number;
  connectAttemptCount: number;
  waitAfterFailedAttemptsMs: number;
  reportStrategy?: ReportStrategyConfig;
  timeseries: FinsDataKey[];
  attributes: FinsDataKey[];
  attributeUpdates: FinsDataKey[];
  rpc: FinsRpcConfig[];
}

export interface FinsBasicConfig {
  devices: FinsDeviceConfig[];
}

export enum FinsValueKey {
  TIMESERIES = 'timeseries',
  ATTRIBUTES = 'attributes',
  ATTRIBUTES_UPDATES = 'attributeUpdates',
  RPC = 'rpc',
}

/**
 * CX-Programmer-style FINS address:
 *   D100 / DM100, CIO20 (or bare 20), W10/WR10, H5/HR5, A448/AR448,
 *   E0_100 (EM bank), T15/TIM15, C4/CNT4 — with an optional .bit (0-15)
 *   suffix on word areas, e.g. D100.5, CIO20.07.
 */
export const FINS_ADDRESS_REGEX =
  /^\s*(?:E\d{1,2}_|(?:CIO|IO|DM|D|WR|W|HR|H|AR|A|TIM|T|CNT|C)\s*)?\d{1,5}(?:\.(?:0?\d|1[0-5]))?\s*$/i;

export function isValidFinsAddress(value: string): boolean {
  return FINS_ADDRESS_REGEX.test((value ?? '').toString());
}

export function isFinsBitAddress(value: string): boolean {
  return /\.\d{1,2}\s*$/.test((value ?? '').toString());
}
