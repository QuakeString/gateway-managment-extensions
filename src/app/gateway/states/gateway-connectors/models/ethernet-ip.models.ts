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

export const SLC_FILE_TYPES: {[letter: string]: string} = {
  N: 'integer', F: 'float', B: 'binary/bit', L: 'long', T: 'timer',
  C: 'counter', S: 'status', ST: 'string', A: 'ASCII', I: 'input', O: 'output',
};

const SLC_ADDRESS_EXAMPLES = 'N7:0, F8:1, B3:0/1, B3/17, T4:0.ACC, C5:0.PRE, S:1/15, ST10:0, L9:0';

/** A wrong file letter is nearly always the neighbouring key. */
const SLC_NEIGHBOURING_KEY: {[letter: string]: string} = {M: 'N', V: 'B', G: 'F', D: 'S'};

/**
 * Why an address will not be readable — a translation key plus its
 * parameters, or null when there is nothing wrong.
 *
 * Rejecting a row with "invalid" tells an operator holding a 200-line
 * RSLogix export nothing they can act on. This names the mistake and, where
 * it can, the address they meant. It mirrors describe_slc_address_problem()
 * in the gateway's ethernet_ip connector, which explains the same two
 * mistakes when a config predates this check.
 */
export function describeEthernetIpTagProblem(
  plcTag: string, isSLC: boolean): {key: string; params?: {[key: string]: string}} | null {
  const value = (plcTag ?? '').toString().trim();
  if (!value) {
    return {key: 'gateway.eip-address-empty'};
  }
  if (isValidEthernetIpTag(value, isSLC)) {
    return null;
  }
  if (!isSLC) {
    return {key: 'gateway.eip-invalid-logix-tag'};
  }

  // A dot where the element separator belongs: B3.17/6 -> B3:17/6.
  // (A dot only ever introduces a member, as in T4:0.ACC.)
  const dotted = /^([A-Za-z]{1,2})(\d{1,3})\.(\d.*)$/.exec(value);
  if (dotted && SLC_FILE_TYPES[dotted[1].toUpperCase()]) {
    const suggestion = `${dotted[1]}${dotted[2]}:${dotted[3]}`;
    if (SLC_ADDRESS_REGEX.test(suggestion)) {
      return {key: 'gateway.eip-address-dot-separator', params: {address: value, suggestion}};
    }
  }

  const letters = /^([A-Za-z]{1,2})/.exec(value);
  const fileType = letters ? letters[1].toUpperCase() : '';
  if (fileType && !SLC_FILE_TYPES[fileType]) {
    const near = SLC_NEIGHBOURING_KEY[fileType.charAt(0)];
    const suggestion = near ? near + value.substring(fileType.length) : '';
    return {
      key: suggestion && SLC_ADDRESS_REGEX.test(suggestion)
        ? 'gateway.eip-address-unknown-file-suggest'
        : 'gateway.eip-address-unknown-file',
      params: {
        fileType,
        suggestion,
        types: Object.keys(SLC_FILE_TYPES).map(k => `${k} (${SLC_FILE_TYPES[k]})`).join(', '),
      },
    };
  }

  return {key: 'gateway.eip-address-invalid', params: {address: value, examples: SLC_ADDRESS_EXAMPLES}};
}
