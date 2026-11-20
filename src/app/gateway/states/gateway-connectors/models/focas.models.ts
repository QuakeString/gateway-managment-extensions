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

import { ReportStrategyConfig } from '../../../shared/models/public-api';

/** Only PMC keys take a value type; every other address knows its own. */
export enum FocasValueType {
  BOOL = 'bool',
  UINT8 = 'uint8',
  INT8 = 'int8',
  UINT16 = 'uint16',
  INT16 = 'int16',
  UINT32 = 'uint32',
  INT32 = 'int32',
  FLOAT32 = 'float32',
}

export interface FocasScaling {
  rawMin: number;
  rawMax: number;
  engMin: number;
  engMax: number;
}

export interface FocasDataKey {
  tag: string;
  address: string;
  valueType?: FocasValueType | string;
  multiplier?: number;
  divider?: number;
  adder?: number;
  subtractor?: number;
  scaling?: FocasScaling;
  reportStrategy?: ReportStrategyConfig;
}

export interface FocasRpcConfig {
  method: string;
  address: string;
  valueType?: FocasValueType | string;
  /** The connector is read-only for now. */
  operation: 'read';
}

export interface FocasDeviceConfig {
  deviceName: string;
  deviceType: string;
  host: string;
  /** FOCAS TCP port set on the CNC (embedded Ethernet), 8193 by default. */
  port: number;
  timeoutMs: number;
  pollPeriod: number;
  /** FOCAS requests packed into one frame. */
  maxRequestsPerFrame: number;
  connectAttemptCount: number;
  waitAfterFailedAttemptsMs: number;
  reportStrategy?: ReportStrategyConfig;
  timeseries: FocasDataKey[];
  attributes: FocasDataKey[];
  /** Kept for the shared device shape; the connector ignores it. */
  attributeUpdates?: FocasDataKey[];
  rpc: FocasRpcConfig[];
}

export interface FocasBasicConfig {
  devices: FocasDeviceConfig[];
}

export enum FocasValueKey {
  TIMESERIES = 'timeseries',
  ATTRIBUTES = 'attributes',
  RPC = 'rpc',
}

const STATUS_FIELDS = 'run|aut|mode|motion|mstb|emergency|alarm|edit|tmmode|hdck';

/**
 * The gateway's FOCAS address grammar (`docs/FOCAS.md` in the gateway):
 * named CNC values, and the numbered tables param / diag / macro / pmc.
 */
export const FOCAS_ADDRESS_REGEX = new RegExp(
  '^\\s*(?:' + [
    'sysinfo\\.(?:addinfo|maxaxis|cnctype|mttype|series|version|axes)',
    'status\\.state',
    `status\\.(?:${STATUS_FIELDS})(?:text)?`,
    'alarm\\.(?:active|bits|messages|count|first)',
    'program\\.(?:run|main|name|sequence|block)',
    'feed\\.actual',
    'spindle\\.actual',
    'axis\\.names',
    'position\\.(?:abs|absolute|machine|mach|rel|relative|dist|distance)\\.(?:[1-9]|[12]\\d|3[0-2]|[a-z][a-z0-9]?)',
    'servoload\\.(?:[1-9]|[12]\\d|3[0-2]|[a-z][a-z0-9]?)',
    '(?:param|diag):\\d{1,6}(?::(?:[1-9]|[12]\\d|3[0-2]))?(?:\\.[0-7])?',
    'macro:#?\\d{1,6}',
    'pmc:[gfyxartkcd]\\d{1,5}(?:\\.[0-7])?',
  ].join('|') + ')\\s*$',
  'i',
);

export function isValidFocasAddress(value: string): boolean {
  return FOCAS_ADDRESS_REGEX.test((value ?? '').toString());
}

export function isFocasPmcAddress(value: string): boolean {
  return /^\s*pmc:/i.test((value ?? '').toString());
}

export function isFocasBitAddress(value: string): boolean {
  return /^\s*(?:pmc|param|diag):.*\.[0-7]\s*$/i.test((value ?? '').toString());
}

/** Addresses that give numbers, so calibration makes sense on them. */
export function isFocasNumericAddress(value: string): boolean {
  const v = (value ?? '').toString().trim().toLowerCase();
  if (!isValidFocasAddress(v) || isFocasBitAddress(v)) {
    return false;
  }
  return /^(?:feed|spindle|position|servoload)\./.test(v)
    || /^(?:param|diag|macro|pmc):/.test(v)
    || /^program\.(?:run|main|sequence)$/.test(v)
    || /^alarm\.(?:bits|count)$/.test(v)
    || (/^status\./.test(v) && !/text$|state$/.test(v));
}

/** The address suggestions the keys sheet offers. */
export const FOCAS_ADDRESS_EXAMPLES: string[] = [
  'status.state', 'status.autText', 'status.runText', 'status.run',
  'alarm.active', 'alarm.count', 'alarm.first', 'alarm.messages',
  'program.main', 'program.name', 'program.sequence', 'program.block',
  'feed.actual', 'spindle.actual',
  'position.abs.X', 'position.machine.X', 'position.dist.X', 'servoLoad.X',
  'param:6711', 'param:6712', 'param:6713', 'diag:411', 'macro:500', 'pmc:D100', 'pmc:R100.3',
  'sysinfo.series', 'sysinfo.version', 'axis.names',
];

/** What a new CNC starts with: the keys an OEE / machine monitoring view needs. */
export function focasOeeTimeseries(): FocasDataKey[] {
  return [
    { tag: 'machineState', address: 'status.state' },
    { tag: 'mode', address: 'status.autText' },
    { tag: 'runStatus', address: 'status.runText' },
    { tag: 'emergency', address: 'status.emergencyText' },
    { tag: 'alarmActive', address: 'alarm.active' },
    { tag: 'alarmCount', address: 'alarm.count' },
    { tag: 'alarm', address: 'alarm.first' },
    { tag: 'programNumber', address: 'program.main' },
    { tag: 'programName', address: 'program.name' },
    { tag: 'sequenceNumber', address: 'program.sequence' },
    { tag: 'partsCount', address: 'param:6711' },
    { tag: 'partsTotal', address: 'param:6712' },
    { tag: 'spindleSpeed', address: 'spindle.actual' },
    { tag: 'feedRate', address: 'feed.actual' },
  ];
}

export function focasOeeAttributes(): FocasDataKey[] {
  return [
    { tag: 'cncSeries', address: 'sysinfo.series' },
    { tag: 'cncVersion', address: 'sysinfo.version' },
    { tag: 'axisNames', address: 'axis.names' },
  ];
}
