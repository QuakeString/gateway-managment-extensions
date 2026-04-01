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

export enum S7PlcModel {
  S7_200 = 'S7-200',
  S7_200Smart = 'S7-200Smart',
  LOGO = 'LOGO',
  S7_300 = 'S7-300',
  S7_400 = 'S7-400',
  S7_1200 = 'S7-1200',
  S7_1500 = 'S7-1500',
}

export enum S7ValueType {
  BOOL = 'bool',
  UINT8 = 'uint8',
  INT8 = 'int8',
  UINT16 = 'uint16',
  INT16 = 'int16',
  UINT32 = 'uint32',
  INT32 = 'int32',
  FLOAT32 = 'float32',
  FLOAT64 = 'float64',
  STRING = 'string',
}

export interface S7DataKey {
  tag: string;
  address: string;
  valueType?: S7ValueType;
  multiplier?: number;
  divider?: number;
  reportStrategy?: ReportStrategyConfig;
}

export interface S7Scaling {
  rawMin: number;
  rawMax: number;
  engMin: number;
  engMax: number;
}

export interface S7RpcConfig {
  method: string;
  address: string;
  valueType?: S7ValueType;
  operation: 'read' | 'write';
}

export interface S7RedundancyConfig {
  enabled: boolean;
  standbyHost: string;
  standbyPort: number;
  standbyRack: number;
  standbySlot: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  failureThreshold: number;
}

export const S7_REDUNDANCY_CAPABLE_MODELS: Set<S7PlcModel> = new Set([
  S7PlcModel.S7_300,
  S7PlcModel.S7_400,
  S7PlcModel.S7_1500,
]);

export interface S7DeviceConfig {
  deviceName: string;
  deviceType: string;
  host: string;
  port: number;
  rack: number;
  slot: number;
  model: S7PlcModel;
  pollPeriod: number;
  connectAttemptCount: number;
  waitAfterFailedAttemptsMs: number;
  reportStrategy?: ReportStrategyConfig;
  redundancy?: S7RedundancyConfig;
  timeseries: S7DataKey[];
  attributes: S7DataKey[];
  attributeUpdates: S7DataKey[];
  rpc: S7RpcConfig[];
}

export interface S7BasicConfig {
  devices: S7DeviceConfig[];
}

export enum S7ValueKey {
  TIMESERIES = 'timeseries',
  ATTRIBUTES = 'attributes',
  ATTRIBUTES_UPDATES = 'attributeUpdates',
  RPC = 'rpc',
}
