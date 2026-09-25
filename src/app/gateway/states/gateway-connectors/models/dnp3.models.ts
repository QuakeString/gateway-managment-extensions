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
 * The DNP3 connector's configuration, as the Rust gateway (4.3.0+) reads it
 * (`crates/connectors/dnp3/src/config.rs`, `docs/DNP3_PLAN.md` §8).
 * Channels are connector-level because an RS-485 line is shared by several
 * outstations; each device is an association on one channel.
 */

export enum Dnp3ChannelType {
  TCP_CLIENT = 'tcpClient',
  /** From gateway 4.4.0: TCP wrapped in TLS (IEC 62351-3). */
  TLS = 'tls',
  /** From gateway 4.4.0: RS-232, or an RS-485 line with several outstations. */
  SERIAL = 'serial',
  /** From gateway 4.6.0: one frame per datagram, as opendnp3's UDP channel. */
  UDP = 'udp',
}

export enum Dnp3Parity {
  NONE = 'none',
  EVEN = 'even',
  ODD = 'odd',
}

export enum Dnp3FlowControl {
  NONE = 'none',
  SOFTWARE = 'software',
  HARDWARE = 'hardware',
}

/** Another address of a channel's outstation; its port is the channel's unless set. */
export interface Dnp3Alternate {
  host: string;
  port?: number;
}

export interface Dnp3ChannelConfig {
  name: string;
  type: Dnp3ChannelType | string;
  // tcpClient, tls and udp
  host?: string;
  port?: number;
  // tcpClient and tls (gateway 4.7.0): more addresses, tried in turn
  alternates?: Dnp3Alternate[];
  // udp: where the gateway's own socket is bound; tcpClient and tls
  // (4.7.0): the address it connects from
  localAddress?: string;
  localPort?: number;
  // all (4.7.0): the wait before reopening a link that dropped
  reconnectDelayMs?: number;
  connectTimeoutMs?: number;
  minRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  // serial
  path?: string;
  baudRate?: number;
  dataBits?: number;
  parity?: Dnp3Parity | string;
  stopBits?: number;
  flowControl?: Dnp3FlowControl | string;
  openDelayMs?: number;
  // tls: files on the gateway
  serverName?: string;
  caCert?: string;
  cert?: string;
  key?: string;
  minTlsVersion?: '1.2' | '1.3' | string;
}

export enum Dnp3PointType {
  BINARY_INPUT = 'binaryInput',
  DOUBLE_BIT_BINARY = 'doubleBitBinary',
  BINARY_OUTPUT_STATUS = 'binaryOutputStatus',
  COUNTER = 'counter',
  FROZEN_COUNTER = 'frozenCounter',
  ANALOG_INPUT = 'analogInput',
  ANALOG_OUTPUT_STATUS = 'analogOutputStatus',
  OCTET_STRING = 'octetString',
  /** Secure Authentication's security statistics (g121/g122); gateway 4.5.0. */
  SECURITY_STATISTIC = 'securityStatistic',
}

/** Point types whose values are numbers and can be calibrated. */
export const DNP3_NUMERIC_POINT_TYPES = new Set<string>([
  Dnp3PointType.COUNTER,
  Dnp3PointType.FROZEN_COUNTER,
  Dnp3PointType.ANALOG_INPUT,
  Dnp3PointType.ANALOG_OUTPUT_STATUS,
  Dnp3PointType.SECURITY_STATISTIC,
]);

export enum Dnp3QualityMode {
  NONE = 'none',
  ATTRIBUTE = 'attribute',
  TELEMETRY = 'telemetry',
}

export enum Dnp3OutputPointType {
  BINARY_OUTPUT = 'binaryOutput',
  ANALOG_OUTPUT = 'analogOutput',
}

export enum Dnp3CommandMode {
  DIRECT = 'direct',
  DIRECT_NO_ACK = 'directNoAck',
  SELECT_BEFORE_OPERATE = 'selectBeforeOperate',
}

export enum Dnp3OpType {
  NUL = 'nul',
  PULSE_ON = 'pulseOn',
  PULSE_OFF = 'pulseOff',
  LATCH_ON = 'latchOn',
  LATCH_OFF = 'latchOff',
}

export enum Dnp3TripClose {
  NUL = 'nul',
  CLOSE = 'close',
  TRIP = 'trip',
}

export enum Dnp3Encoding {
  INT16 = 'int16',
  INT32 = 'int32',
  FLOAT32 = 'float32',
  FLOAT64 = 'float64',
}

export enum Dnp3TimeSync {
  NONE = 'none',
  LAN = 'lan',
  NON_LAN = 'nonLan',
}

/** A measured point: a point type and an index, and where its value goes. */
export interface Dnp3PointKey {
  key: string;
  pointType: Dnp3PointType | string;
  index: number;
  /** Double-bit state names by state, "0"–"3". */
  states?: Record<string, string>;
  quality?: Dnp3QualityMode | string;
  onlineOnly?: boolean;
  /** Octet strings: text or hex. */
  encoding?: 'text' | 'hex' | string;
  multiplier?: number;
  divider?: number;
  adder?: number;
  subtractor?: number;
  scaling?: { rawMin: number; rawMax: number; engMin: number; engMax: number };
  reportStrategy?: ReportStrategyConfig;
}

/** The CROB fields of a binary output command. */
export interface Dnp3CrobFields {
  opType?: Dnp3OpType | string;
  tripClose?: Dnp3TripClose | string;
  count?: number;
  onTimeMs?: number;
  offTimeMs?: number;
}

/** A shared attribute that becomes a command: on/off CROBs or a set point. */
export interface Dnp3AttributeUpdate {
  key: string;
  pointType: Dnp3OutputPointType | string;
  index: number;
  mode?: Dnp3CommandMode | string;
  encoding?: Dnp3Encoding | string;
  onOpType?: Dnp3OpType | string;
  onTripClose?: Dnp3TripClose | string;
  offOpType?: Dnp3OpType | string;
  offTripClose?: Dnp3TripClose | string;
  count?: number;
  onTimeMs?: number;
  offTimeMs?: number;
}

/** A named RPC that operates one output point. */
export interface Dnp3RpcConfig extends Dnp3CrobFields {
  method: string;
  pointType: Dnp3OutputPointType | string;
  index: number;
  mode?: Dnp3CommandMode | string;
  encoding?: Dnp3Encoding | string;
}

export interface Dnp3StartupConfig {
  disableUnsolicited: boolean;
  integrityPoll: boolean;
  enableUnsolicited: number[];
}

export interface Dnp3PollConfig {
  integrityMs?: number;
  class1Ms?: number;
  class2Ms?: number;
  class3Ms?: number;
}

export interface Dnp3DeviceConfig {
  deviceName: string;
  deviceType: string;
  channel: string;
  masterAddress: number;
  outstationAddress: number;
  responseTimeoutMs?: number;
  retries?: number;
  taskRetryMs?: number;
  maxTaskRetryMs?: number;
  keepAliveMs?: number;
  startup?: Dnp3StartupConfig;
  polls?: Dnp3PollConfig;
  eventScanOnIin?: boolean;
  timeSync?: Dnp3TimeSync | string;
  useOutstationTime?: boolean;
  allowRestart?: boolean;
  secureAuthentication?: Dnp3SecureAuthentication;
  reportStrategy?: ReportStrategyConfig;
  timeseries: Dnp3PointKey[];
  attributes: Dnp3PointKey[];
  attributeUpdates: Dnp3AttributeUpdate[];
  rpc: Dnp3RpcConfig[];
}

/** A user the gateway authenticates as; its update key is a file on the gateway. */
export interface Dnp3SecureAuthUser {
  number: number;
  updateKeyFile: string;
}

/** Secure Authentication v5 (IEEE 1815-2012). The device's requests run as user 1. */
export interface Dnp3SecureAuthentication {
  enabled?: boolean;
  users: Dnp3SecureAuthUser[];
  sessionKeyChangeIntervalMs?: number;
}

export const DNP3_SESSION_KEY_CHANGE_DEFAULT_MS = 600000;

export interface Dnp3BasicConfig {
  channels: Dnp3ChannelConfig[];
  devices: Dnp3DeviceConfig[];
}

export enum Dnp3ValueKey {
  TIMESERIES = 'timeseries',
  ATTRIBUTES = 'attributes',
  ATTRIBUTES_UPDATES = 'attributeUpdates',
  RPC = 'rpc',
}

/** The RPC methods every device answers; a configured RPC may not use them. */
export const DNP3_RESERVED_RPCS = [
  'read',
  'integrityPoll',
  'eventPoll',
  'timeSync',
  'enableUnsolicited',
  'disableUnsolicited',
  'coldRestart',
  'warmRestart',
  'freeze',
  'freezeAtTime',
];

/** DNP3 link addresses: 0–65519 (0xFFF0 and up are reserved). */
export const DNP3_MAX_ADDRESS = 65519;

export const DNP3_DEFAULT_PORT = 20000;

/** IANA's dnp-sec, the port of DNP3 over TLS. */
export const DNP3_TLS_DEFAULT_PORT = 19999;

/** The gateway that brings serial and TLS channels. */
export const DNP3_SERIAL_TLS_VERSION = '4.4.0';

/** The gateway that brings Secure Authentication. */
export const DNP3_SECURE_AUTH_VERSION = '4.5.0';

/** The gateway that brings UDP channels. */
export const DNP3_UDP_VERSION = '4.6.0';

/** The gateway that brings alternate addresses, a TCP local address and the reconnect delay. */
export const DNP3_FAILOVER_VERSION = '4.7.0';
