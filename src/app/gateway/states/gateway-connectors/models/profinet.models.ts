///
/// Copyright © 2016-2025 The Sentient Authors
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

/**
 * The PROFINET connector's configuration, as the Rust gateway (4.8.0+)
 * reads it (`crates/connectors/profinet/src/config.rs`,
 * `docs/PROFINET_PLAN.md` §8). The gateway is the IO controller: each
 * device is named by its name of station, and the modules in its slots are
 * the expected configuration its Connect sends — written here from an
 * imported GSDML, so the gateway never reads a GSDML itself.
 */

export enum ProfinetValueType {
  BOOL = 'bool',
  UINT8 = 'uint8',
  INT8 = 'int8',
  UINT16 = 'uint16',
  INT16 = 'int16',
  UINT32 = 'uint32',
  INT32 = 'int32',
  UINT64 = 'uint64',
  INT64 = 'int64',
  FLOAT32 = 'float32',
  FLOAT64 = 'float64',
  STRING = 'string',
  BYTES = 'bytes',
}

/** Octets of each fixed-width type; string and bytes take a length. */
export const PROFINET_TYPE_WIDTH: Record<string, number> = {
  [ProfinetValueType.BOOL]: 1,
  [ProfinetValueType.UINT8]: 1,
  [ProfinetValueType.INT8]: 1,
  [ProfinetValueType.UINT16]: 2,
  [ProfinetValueType.INT16]: 2,
  [ProfinetValueType.UINT32]: 4,
  [ProfinetValueType.INT32]: 4,
  [ProfinetValueType.UINT64]: 8,
  [ProfinetValueType.INT64]: 8,
  [ProfinetValueType.FLOAT32]: 4,
  [ProfinetValueType.FLOAT64]: 8,
};

/** Types whose values are numbers and can be calibrated. */
export const PROFINET_NUMERIC_TYPES = new Set<string>([
  ProfinetValueType.UINT8,
  ProfinetValueType.INT8,
  ProfinetValueType.UINT16,
  ProfinetValueType.INT16,
  ProfinetValueType.UINT32,
  ProfinetValueType.INT32,
  ProfinetValueType.UINT64,
  ProfinetValueType.INT64,
  ProfinetValueType.FLOAT32,
  ProfinetValueType.FLOAT64,
]);

export enum ProfinetArea {
  INPUT = 'input',
  OUTPUT = 'output',
}

export enum ProfinetQualityMode {
  NONE = 'none',
  ATTRIBUTE = 'attribute',
  TELEMETRY = 'telemetry',
}

/** A value's place in a submodule's IO data. */
export interface ProfinetPlace {
  slot: number;
  subslot?: number;
  offset?: number;
  type: ProfinetValueType | string;
  /** A single bit of the octet at `offset`, for bool. */
  bit?: number;
  /** Octets, for string and bytes. */
  length?: number;
  area?: ProfinetArea | string;
}

/** A key published from the IO data. */
export interface ProfinetKey extends ProfinetPlace {
  key: string;
  quality?: ProfinetQualityMode | string;
  goodOnly?: boolean;
  multiplier?: number;
  divider?: number;
  adder?: number;
  subtractor?: number;
  scaling?: { rawMin: number; rawMax: number; engMin: number; engMax: number };
  reportStrategy?: ReportStrategyConfig;
}

/** A shared attribute written to an output. */
export interface ProfinetAttributeUpdate extends ProfinetPlace {
  key: string;
}

/** A named RPC: `write` (the default) sets an output from `params.value`, `read` answers with a value. */
export interface ProfinetRpcConfig extends ProfinetPlace {
  method: string;
  operation?: 'read' | 'write' | string;
}

export interface ProfinetRecordConfig {
  /** Decimal or 0x hex. */
  index: number | string;
  /** Hex. */
  data: string;
}

export interface ProfinetSubmoduleConfig {
  /** Decimal or 0x hex (0x8000 and up for the interface and ports). */
  subslot: number | string;
  submoduleIdent: number | string;
  inputLength?: number;
  outputLength?: number;
  records?: ProfinetRecordConfig[];
  /** Hex, the output's length: what is sent until something is written. */
  initialOutput?: string;
  /** The GSDML's name for it, for the form only. */
  name?: string;
}

export interface ProfinetModuleConfig {
  slot: number;
  moduleIdent: number | string;
  api?: number;
  submodules: ProfinetSubmoduleConfig[];
  /** The GSDML's name and ID for it, for the form only. */
  name?: string;
  gsdmlId?: string;
}

export interface ProfinetDeviceConfig {
  deviceName: string;
  deviceType: string;
  nameOfStation: string;
  ip?: string;
  netmask?: string;
  gateway?: string;
  assignIp?: boolean;
  vendorId: number | string;
  deviceId: number | string;
  instance?: number;
  reductionRatio?: number;
  watchdogFactor?: number;
  dataHoldFactor?: number;
  pollPeriod?: number;
  reportStrategy?: ReportStrategyConfig;
  modules: ProfinetModuleConfig[];
  timeseries: ProfinetKey[];
  attributes: ProfinetKey[];
  attributeUpdates: ProfinetAttributeUpdate[];
  rpc: ProfinetRpcConfig[];
  outputs?: { enabled: boolean };
  recordWrites?: { enabled: boolean };
  readIm0?: boolean;
  /** The GSDML's names of the device's error types (ChannelDiagList). */
  channelDiagnosis?: { errorType: number | string; name: string; help?: string }[];
  /** The GSDML's names of the device's own diagnoses, by USI (UnitDiagTypeList). */
  unitDiagnosis?: { usi: number | string; name: string }[];
  /** Where the modules came from, for the form only. */
  gsdml?: { file?: string; dap?: string };
}

export interface ProfinetControllerConfig {
  nameOfStation: string;
  realtimePriority?: number;
}

export interface ProfinetBasicConfig {
  interface: string;
  controller: ProfinetControllerConfig;
  devices: ProfinetDeviceConfig[];
}

export enum ProfinetValueKey {
  TIMESERIES = 'timeseries',
  ATTRIBUTES = 'attributes',
  ATTRIBUTES_UPDATES = 'attributeUpdates',
  RPC = 'rpc',
}

/** The RPC methods every device answers; a configured RPC may not use them. */
export const PROFINET_RESERVED_RPCS = ['readRecord', 'writeRecord', 'readIm0', 'status'];

/** Send clock 1 ms × the reduction ratio; powers of two. */
export const PROFINET_REDUCTION_RATIOS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];

export const PROFINET_DEFAULT_REDUCTION_RATIO = 32;
export const PROFINET_DEFAULT_POLL_PERIOD_MS = 1000;
export const PROFINET_DEFAULT_CONTROLLER_NAME = 'sentient-gateway';

/** The gateway that brings the PROFINET connector. */
export const PROFINET_VERSION = '4.8.0';
