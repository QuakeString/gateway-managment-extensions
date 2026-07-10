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

export enum EtherCatValueType {
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
}

export interface EtherCatDataKey {
  tag: string;
  address: string;
  valueType?: EtherCatValueType;
  /** Calibration — `modifier` (one of multiply / divide / add /
   *  subtract) and `scaling` (2-point linear) are mutually exclusive
   *  in the UI; both absent means the raw value is reported as-is.
   *  Exactly one of `multiplier` / `divider` / `adder` / `subtractor`
   *  is set when modifier mode is active. Matches the shape used by
   *  Modbus / Ethernet-IP / S7 / ADS so the data-keys panel stays
   *  consistent across connectors. */
  multiplier?: number;
  divider?: number;
  adder?: number;
  subtractor?: number;
  scaling?: EtherCatScaling;
  reportStrategy?: ReportStrategyConfig;
}

export interface EtherCatScaling {
  rawMin: number;
  rawMax: number;
  engMin: number;
  engMax: number;
}

export interface EtherCatRpcConfig {
  method: string;
  address: string;
  valueType?: EtherCatValueType;
  operation: 'read' | 'write';
}

export interface EtherCatDeviceConfig {
  deviceName: string;
  deviceType: string;
  /** Slave POSITION on the bus (0-based). */
  slave: number;
  pollPeriod: number;
  reportStrategy?: ReportStrategyConfig;
  timeseries: EtherCatDataKey[];
  attributes: EtherCatDataKey[];
  attributeUpdates: EtherCatDataKey[];
  rpc: EtherCatRpcConfig[];
}

export interface EtherCatBasicConfig {
  /** The dedicated NIC the connector binds to, e.g. "eth1". */
  interface: string;
  /** Cyclic PDO period in microseconds. */
  cycleTimeUs: number;
  /** Enable EtherCAT Distributed Clocks. */
  useDistributedClocks: boolean;
  devices: EtherCatDeviceConfig[];
}

export enum EtherCatValueKey {
  TIMESERIES = 'timeseries',
  ATTRIBUTES = 'attributes',
  ATTRIBUTES_UPDATES = 'attributeUpdates',
  RPC = 'rpc',
}
