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

export enum EthernetIPPlcType {
  CONTROLLOGIX = 'ControlLogix',
  COMPACTLOGIX = 'CompactLogix',
  MICRO800 = 'Micro800',
  SLC500 = 'SLC500',
  MICROLOGIX = 'MicroLogix',
}

export enum EthernetIPDataType {
  BOOL = 'BOOL',
  SINT = 'SINT',
  INT = 'INT',
  DINT = 'DINT',
  LINT = 'LINT',
  USINT = 'USINT',
  UINT = 'UINT',
  UDINT = 'UDINT',
  ULINT = 'ULINT',
  REAL = 'REAL',
  LREAL = 'LREAL',
  STRING = 'STRING',
}

export interface EthernetIPScaling {
  rawMin: number;
  rawMax: number;
  engMin: number;
  engMax: number;
}

export interface EthernetIPDataKey {
  tag: string;
  plcTag: string;
  /** Calibration — modifier (exactly one of multiplier / divider /
   *  adder / subtractor) and scaling (2-point linear) are mutually
   *  exclusive in the UI. EIP has no per-key `valueType`, so the
   *  backend converter decides whether to apply at read time based
   *  on whether the PLC returned a numeric value. */
  multiplier?: number;
  divider?: number;
  adder?: number;
  subtractor?: number;
  scaling?: EthernetIPScaling;
  reportStrategy?: ReportStrategyConfig;
}

export interface EthernetIPRpcConfig {
  method: string;
  plcTag: string;
  valueType?: EthernetIPDataType;
  operation: 'read' | 'write';
}

export interface EthernetIPTimeSyncConfig {
  enabled: boolean;
  intervalSec?: number;
}

export interface EthernetIPDeviceConfig {
  deviceName: string;
  deviceType: string;
  host: string;
  slot: number;
  plcType: EthernetIPPlcType;
  initTags: boolean;
  pollPeriod: number;
  connectAttemptCount: number;
  waitAfterFailedAttemptsMs: number;
  reportStrategy?: ReportStrategyConfig;
  timeSync?: EthernetIPTimeSyncConfig;
  timeseries: EthernetIPDataKey[];
  attributes: EthernetIPDataKey[];
  attributeUpdates: EthernetIPDataKey[];
  rpc: EthernetIPRpcConfig[];
}

export interface EthernetIPBasicConfig {
  devices: EthernetIPDeviceConfig[];
}

export enum EthernetIPValueKey {
  TIMESERIES = 'timeseries',
  ATTRIBUTES = 'attributes',
  ATTRIBUTES_UPDATES = 'attributeUpdates',
  RPC = 'rpc',
}

export const ETHERNET_IP_LOGIX_TYPES = new Set([
  EthernetIPPlcType.CONTROLLOGIX,
  EthernetIPPlcType.COMPACTLOGIX,
]);

export const ETHERNET_IP_LOGIX_DRIVER_TYPES = new Set([
  EthernetIPPlcType.CONTROLLOGIX,
  EthernetIPPlcType.COMPACTLOGIX,
  EthernetIPPlcType.MICRO800,
]);

export const ETHERNET_IP_SLC_DRIVER_TYPES = new Set([
  EthernetIPPlcType.SLC500,
  EthernetIPPlcType.MICROLOGIX,
]);

/**
 * SLC / MicroLogix data-file address (PCCC), as written in RSLogix:
 *   N7:0        integer            F8:1        float
 *   B3:0/1      bit of an element  B3/17       bit number across the file
 *   T4:0.ACC    timer member       C5:0.PRE    counter member
 *   S:1/15      status bit         ST10:0      string
 *   L9:0        long (MicroLogix)  A10:0       ASCII
 *   N7:0{4}     element count
 * Members: ACC PRE EN DN TT CU CD OV UN UA
 */
export const SLC_ADDRESS_REGEX =
  /^\s*(?:(?:[LFBN]\d{1,3}:\d{1,3}(?:\/\d{1,2})?|[CT]\d{1,3}:\d{1,3}\.(?:ACC|PRE|EN|DN|TT|CU|CD|OV|UN|UA)|S:\d{1,3}(?:\/\d{1,2})?|B\d{1,3}\/\d{1,4}|ST\d{1,3}:\d{1,4}|A\d{1,3}:\d{1,4}|[IO]\d{0,3}:\d{1,3}(?:\.\d{1,3})?(?:\/\d{1,2})?)(?:\{\d+\})?)\s*$/i;

/**
 * Logix symbolic tag: MotorSpeed, Program:Main.Temp, Array[3], UDT.Member.
 */
export const LOGIX_TAG_REGEX =
  /^\s*[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)?(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[\d+\]))*\s*$/;

export function isValidEthernetIpTag(plcTag: string, isSLC: boolean): boolean {
  const value = (plcTag ?? '').toString();
  if (!value.trim()) {
    return false;
  }
  return isSLC ? SLC_ADDRESS_REGEX.test(value) : LOGIX_TAG_REGEX.test(value);
}
