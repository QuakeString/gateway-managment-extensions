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

export enum AdsValueType {
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

export interface AdsDataKey {
  tag: string;
  address: string;
  valueType?: AdsValueType;
  /** Calibration — `modifier` (one of multiply / divide / add /
   *  subtract) and `scaling` (2-point linear) are mutually exclusive
   *  in the UI; both absent means the raw value is reported as-is.
   *  Exactly one of `multiplier` / `divider` / `adder` / `subtractor`
   *  is set when modifier mode is active. Matches the shape used by
   *  Modbus / Ethernet-IP / S7 so the data-keys panel stays consistent
   *  across connectors. */
  multiplier?: number;
  divider?: number;
  adder?: number;
  subtractor?: number;
  scaling?: AdsScaling;
  reportStrategy?: ReportStrategyConfig;
}

export interface AdsScaling {
  rawMin: number;
  rawMax: number;
  engMin: number;
  engMax: number;
}

export interface AdsRpcConfig {
  method: string;
  address: string;
  valueType?: AdsValueType;
  operation: 'read' | 'write';
}

export interface AdsDeviceConfig {
  deviceName: string;
  deviceType: string;
  host: string;
  amsNetId: string;
  amsPort: number;
  clientAmsNetId?: string;
  pollPeriod: number;
  connectAttemptCount: number;
  waitAfterFailedAttemptsMs: number;
  /** Opt-in: use ADS device notifications (push-on-change) instead of polling. */
  enableNotifications?: boolean;
  reportStrategy?: ReportStrategyConfig;
  timeseries: AdsDataKey[];
  attributes: AdsDataKey[];
  attributeUpdates: AdsDataKey[];
  rpc: AdsRpcConfig[];
}

export interface AdsBasicConfig {
  devices: AdsDeviceConfig[];
}

export enum AdsValueKey {
  TIMESERIES = 'timeseries',
  ATTRIBUTES = 'attributes',
  ATTRIBUTES_UPDATES = 'attributeUpdates',
  RPC = 'rpc',
}
