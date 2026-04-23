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
///     http://www.apache.org/licenses/LICENSE-2.0
///

import { ReportStrategyConfig } from '../../../shared/models/public-api';

export enum IEC61850FC {
  ST = 'ST',
  MX = 'MX',
  CO = 'CO',
  SP = 'SP',
  SG = 'SG',
  SE = 'SE',
  SV = 'SV',
  CF = 'CF',
  DC = 'DC',
  EX = 'EX',
}

export enum IEC61850ValueType {
  BOOLEAN = 'boolean',
  INT32 = 'int32',
  FLOAT = 'float',
  DOUBLE = 'double',
  STRING = 'string',
  UNSIGNED = 'unsigned',
}

export enum IEC61850ControlModel {
  STATUS_ONLY = 0,
  DIRECT_NORMAL = 1,
  SBO_NORMAL = 2,
  DIRECT_ENHANCED = 3,
  SBO_ENHANCED = 4,
}

export enum IEC61850AcquisitionMode {
  POLLING = 'polling',
  REPORT = 'report',
}

export interface IEC61850DataKey {
  tag: string;
  reference: string;
  fc?: IEC61850FC;
  valueType?: IEC61850ValueType;
  enumMapping?: Record<string, string>;
  /** Calibration — modifier (exactly one of multiplier / divider /
   *  adder / subtractor) and scaling (2-point linear) are mutually
   *  exclusive in the UI. Only applied to numeric value types; bool
   *  / string skip calibration at the converter. Matches the shape
   *  used by S7 / Modbus / Ethernet-IP so the data-keys panels stay
   *  consistent across industrial connectors. */
  multiplier?: number;
  divider?: number;
  adder?: number;
  subtractor?: number;
  scaling?: IEC61850Scaling;
  reportStrategy?: ReportStrategyConfig;
}

export interface IEC61850Scaling {
  rawMin: number;
  rawMax: number;
  engMin: number;
  engMax: number;
}

export interface IEC61850RpcConfig {
  method: string;
  reference: string;
  fc?: IEC61850FC;
  valueType?: IEC61850ValueType;
  operation: 'read' | 'write' | 'control';
  controlModel?: IEC61850ControlModel;
}

export interface IEC61850ReportConfig {
  rcbReference: string;
  rptId?: string;
  triggerOptions?: IEC61850TriggerOptions;
  integrityPeriodMs?: number;
  bufferTimeMs?: number;
}

export interface IEC61850TriggerOptions {
  dataChange?: boolean;
  qualityChange?: boolean;
  dataUpdate?: boolean;
  integrity?: boolean;
  generalInterrogation?: boolean;
}

export interface IEC61850GooseSubscription {
  gocbRef: string;
  appId?: string;
}

export interface IEC61850GooseConfig {
  enabled: boolean;
  interface?: string;
  subscriptions?: IEC61850GooseSubscription[];
}

export interface IEC61850TlsConfig {
  enabled: boolean;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
}

export interface IEC61850DataAcquisition {
  mode: IEC61850AcquisitionMode;
  reports?: IEC61850ReportConfig[];
  polledDataPoints?: { reference: string; fc: IEC61850FC }[];
}

export interface IEC61850TimeSyncConfig {
  enabled: boolean;
  intervalSec?: number;
  targetReference?: string;
}

export interface IEC61850DeviceConfig {
  deviceName: string;
  deviceType: string;
  host: string;
  port: number;
  pollPeriod: number;
  connectionTimeout: number;
  connectAttemptCount: number;
  waitAfterFailedAttemptsMs: number;
  reportStrategy?: ReportStrategyConfig;
  dataAcquisition?: IEC61850DataAcquisition;
  tls?: IEC61850TlsConfig;
  goose?: IEC61850GooseConfig;
  timeSync?: IEC61850TimeSyncConfig;
  timeseries: IEC61850DataKey[];
  attributes: IEC61850DataKey[];
  attributeUpdates: IEC61850DataKey[];
  rpc: IEC61850RpcConfig[];
}

export interface IEC61850BasicConfig {
  devices: IEC61850DeviceConfig[];
}

export enum IEC61850ValueKey {
  TIMESERIES = 'timeseries',
  ATTRIBUTES = 'attributes',
  ATTRIBUTES_UPDATES = 'attributeUpdates',
  RPC = 'rpc',
}

// Model browser types (browseModel RPC response)

export interface IEC61850ModelNode {
  name: string;
  logicalNodes?: IEC61850ModelLN[];
}

export interface IEC61850ModelLN {
  name: string;
  dataObjects?: IEC61850ModelDO[];
}

export interface IEC61850ModelDO {
  name: string;
  dataAttributes?: IEC61850ModelDA[];
}

export interface IEC61850ModelDA {
  name: string;
  fc: string;
  reference: string;
}

export interface IEC61850FlatDataPoint {
  reference: string;
  fc: string;
  ld: string;
  ln: string;
  do: string;
  da: string;
  selected?: boolean;
  existing?: boolean;
}
