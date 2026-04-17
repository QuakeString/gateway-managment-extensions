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
