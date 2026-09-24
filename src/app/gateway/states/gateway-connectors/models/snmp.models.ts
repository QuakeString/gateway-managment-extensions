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

export enum SnmpVersion {
  V1 = 'v1',
  V2C = 'v2c',
  V3 = 'v3',
}

export const SnmpVersionTranslationsMap = new Map<SnmpVersion, string>([
  [SnmpVersion.V1, 'gateway.snmp-version-v1'],
  [SnmpVersion.V2C, 'gateway.snmp-version-v2c'],
  [SnmpVersion.V3, 'gateway.snmp-version-v3'],
]);

export enum SnmpMethod {
  GET = 'get',
  MULTIGET = 'multiget',
  GETNEXT = 'getnext',
  WALK = 'walk',
  MULTIWALK = 'multiwalk',
  BULKWALK = 'bulkwalk',
  BULKGET = 'bulkget',
  TABLE = 'table',
  BULKTABLE = 'bulktable',
  SET = 'set',
  MULTISET = 'multiset',
}

/** Same translation keys the RPC page already uses for SNMP methods. */
export const SnmpMethodTranslationsMap = new Map<SnmpMethod, string>([
  [SnmpMethod.GET, 'gateway.rpc.get'],
  [SnmpMethod.MULTIGET, 'gateway.rpc.multi-get'],
  [SnmpMethod.GETNEXT, 'gateway.rpc.get-next'],
  [SnmpMethod.WALK, 'gateway.rpc.walk'],
  [SnmpMethod.MULTIWALK, 'gateway.rpc.multi-walk'],
  [SnmpMethod.BULKWALK, 'gateway.rpc.bulk-walk'],
  [SnmpMethod.BULKGET, 'gateway.rpc.bulk-get'],
  [SnmpMethod.TABLE, 'gateway.rpc.table'],
  [SnmpMethod.BULKTABLE, 'gateway.rpc.bulk-table'],
  [SnmpMethod.SET, 'gateway.rpc.set'],
  [SnmpMethod.MULTISET, 'gateway.rpc.multiset'],
]);

/** GETBULK methods: SNMPv1 has no PDU for them, the gateway refuses them on a v1 device. */
export const SNMP_BULK_METHODS: SnmpMethod[] = [SnmpMethod.BULKGET, SnmpMethod.BULKWALK, SnmpMethod.BULKTABLE];

/** Methods that write to the agent — the only ones an attribute update can use. */
export const SNMP_WRITE_METHODS: SnmpMethod[] = [SnmpMethod.SET, SnmpMethod.MULTISET];

/**
 * What a method needs beside its name:
 *   single   — exactly one `oid`
 *   list     — one or more `oid`s
 *   bulkget  — `scalarOid` and/or `repeatingOid` plus `maxListSize`
 *   mappings — `mappings` {oid: value}; may be left to the request in
 *              attribute-update and RPC entries
 */
export type SnmpOidShape = 'single' | 'list' | 'bulkget' | 'mappings';

export function snmpOidShape(method: SnmpMethod | string): SnmpOidShape {
  switch (method) {
    case SnmpMethod.MULTIGET:
    case SnmpMethod.MULTIWALK:
    case SnmpMethod.BULKWALK:
      return 'list';
    case SnmpMethod.BULKGET:
      return 'bulkget';
    case SnmpMethod.MULTISET:
      return 'mappings';
    default:
      return 'single';
  }
}

export enum SnmpSecurityLevel {
  NO_AUTH_NO_PRIV = 'noAuthNoPriv',
  AUTH_NO_PRIV = 'authNoPriv',
  AUTH_PRIV = 'authPriv',
}

export enum SnmpAuthProtocol {
  MD5 = 'MD5',
  SHA = 'SHA',
  SHA224 = 'SHA224',
  SHA256 = 'SHA256',
  SHA384 = 'SHA384',
  SHA512 = 'SHA512',
}

export enum SnmpPrivProtocol {
  DES = 'DES',
  AES128 = 'AES128',
  AES192 = 'AES192',
  AES256 = 'AES256',
}

/** ASN.1 type a SET writes; OCTET STRING when left on Default. */
export enum SnmpValueType {
  OCTET_STRING = 'octetstring',
  INTEGER = 'integer',
  OID = 'oid',
  IP_ADDRESS = 'ipaddress',
  COUNTER32 = 'counter32',
  GAUGE32 = 'gauge32',
  TIMETICKS = 'timeticks',
  COUNTER64 = 'counter64',
}

export const SnmpValueTypeTranslationsMap = new Map<SnmpValueType, string>([
  [SnmpValueType.OCTET_STRING, 'OCTET STRING'],
  [SnmpValueType.INTEGER, 'INTEGER'],
  [SnmpValueType.OID, 'OBJECT IDENTIFIER'],
  [SnmpValueType.IP_ADDRESS, 'IpAddress'],
  [SnmpValueType.COUNTER32, 'Counter32'],
  [SnmpValueType.GAUGE32, 'Gauge32'],
  [SnmpValueType.TIMETICKS, 'TimeTicks'],
  [SnmpValueType.COUNTER64, 'Counter64'],
]);

export interface SnmpScaling {
  rawMin: number;
  rawMax: number;
  engMin: number;
  engMax: number;
}

/** The part of an entry every list shares: the method and what it addresses. */
export interface SnmpKeyBase {
  method: SnmpMethod | string;
  /** One OID for get/getnext/walk/table/bulktable/set, a list for multiget/multiwalk/bulkwalk. */
  oid?: string | string[];
  scalarOid?: string[];
  repeatingOid?: string[];
  maxListSize?: number;
  /** multiset: OID → value; `${attribute}` / `${name}` take the value from the request. */
  mappings?: Record<string, string>;
  valueType?: SnmpValueType | string;
  /** Per-key overrides of the device's community and timeout (seconds). */
  community?: string;
  timeout?: number;
}

export interface SnmpDataKey extends SnmpKeyBase {
  key: string;
  multiplier?: number;
  divider?: number;
  adder?: number;
  subtractor?: number;
  scaling?: SnmpScaling;
  reportStrategy?: ReportStrategyConfig;
}

export interface SnmpAttributeUpdate extends SnmpKeyBase {
  attributeFilter: string;
}

export interface SnmpRpcRequest extends SnmpKeyBase {
  requestFilter: string;
}

export interface SnmpDeviceConfig {
  deviceName: string;
  deviceType: string;
  ip: string;
  port: number;
  version: SnmpVersion | string;
  /** v1 / v2c only. */
  community?: string;
  /** v3 (USM) only. */
  securityName?: string;
  securityLevel?: SnmpSecurityLevel | string;
  authProtocol?: SnmpAuthProtocol | string;
  authKey?: string;
  privProtocol?: SnmpPrivProtocol | string;
  privKey?: string;
  contextName?: string;
  engineId?: string;
  /** Seconds, as the gateway reads it. */
  timeout: number;
  pollPeriod: number;
  connectAttemptCount: number;
  waitAfterFailedAttemptsMs: number;
  reportStrategy?: ReportStrategyConfig;
  attributes: SnmpDataKey[];
  telemetry: SnmpDataKey[];
  attributeUpdateRequests: SnmpAttributeUpdate[];
  serverSideRpcRequests: SnmpRpcRequest[];
}

export interface SnmpBasicConfig {
  devices: SnmpDeviceConfig[];
}

export enum SnmpValueKey {
  ATTRIBUTES = 'attributes',
  TELEMETRY = 'telemetry',
  ATTRIBUTES_UPDATES = 'attributeUpdateRequests',
  RPC = 'serverSideRpcRequests',
}

export type SnmpKeyEntry = SnmpDataKey | SnmpAttributeUpdate | SnmpRpcRequest;

/** A dotted numeric OID, with or without a leading dot: 1.3.6.1.2.1.1.1.0 */
export const SNMP_OID_REGEX = /^\.?\d+(\.\d+)+$/;

export function isValidOid(value: string): boolean {
  return SNMP_OID_REGEX.test((value ?? '').toString().trim());
}

/** "1.3.6.1, 1.3.6.2" (commas, spaces or newlines) → ["1.3.6.1", "1.3.6.2"]. */
export function parseOidList(text: string | string[] | undefined): string[] {
  if (Array.isArray(text)) {
    return text.map(o => (o ?? '').toString().trim()).filter(o => !!o);
  }
  return (text ?? '').toString().split(/[\s,;]+/).map(o => o.trim()).filter(o => !!o);
}

export function formatOidList(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(', ') : (value ?? '').toString();
}
