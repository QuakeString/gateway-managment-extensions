///
/// Copyright © 2016-2025 The SENTIENT Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///

import { WriteAdapter, WriteTarget } from './add-to-write.models';

const text = (value: unknown): string => value === null || value === undefined ? '' : String(value);

/** Calibration and reporting belong to reads; a write entry carries the
 *  point and its type only. */
const READ_ONLY_FIELDS = [
  'id', 'multiplier', 'divider', 'adder', 'subtractor', 'scaling', 'reportStrategy', 'pollRate', 'rate',
  'calibration', 'enableModifiers', 'modifierType', 'modifierValue',
];

const pointOf = (key: any, drop: string[] = []): any => {
  const out = { ...key };
  for (const field of [...READ_ONLY_FIELDS, ...drop]) {
    delete out[field];
  }
  return out;
};

/**
 * S7, ADS, MC protocol, FINS, EtherCAT and EtherNet/IP: a read key is
 * `{tag, <address>, valueType}`, an RPC is `{method, <address>,
 * valueType, operation}` and an attribute update is a read key shape.
 */
export function tagAddressAdapter(addressField = 'address',
                                  blocked?: (address: string) => string | null): WriteAdapter {
  return {
    keyName: k => text(k.tag),
    address: k => text(k[addressField]),
    dataType: k => text(k.valueType),
    blocked: k => blocked ? blocked(text(k[addressField])) : null,
    toEntry: (k, name, target) => target === 'rpc'
      ? { method: name, [addressField]: k[addressField], ...(k.valueType ? { valueType: k.valueType } : {}), operation: 'write' }
      : { ...pointOf(k), tag: name },
    entryName: (e, target) => text(target === 'rpc' ? e.method : e.tag),
    entryAddress: (e, target) => target === 'rpc' && e.operation === 'read' ? '' : text(e[addressField]),
  };
}

/** S7 inputs (I / E area) are rewritten from the process image every
 *  scan, so a write there is lost. */
export const s7Adapter = (): WriteAdapter =>
  tagAddressAdapter('address', address => /^%?[IE](\d|[BWDL]\d)/i.test(address.trim()) ? 'gateway.write-read-only-input' : null);

// ---------- Modbus ----------

const MODBUS_WRITE_CODE: Record<number, [single: number, many: number]> = { 1: [5, 15], 3: [6, 16] };
const MODBUS_CODE_LABEL: Record<number, string> = {
  5: '05 Write coil', 15: '15 Write coils', 6: '06 Write register', 16: '16 Write registers',
};
/** Which table a function code reads or writes. */
const modbusTable = (code: number): string => [1, 5, 15].includes(code) ? 'Coil' : [3, 6, 16].includes(code) ? 'Holding' : '';
/** Read-only tables are named too, so a skipped key still says where it reads. */
const modbusPlace = (code: number): string => modbusTable(code) || ({ 2: 'Discrete', 4: 'Input' } as Record<number, string>)[code] || '';
const modbusWriteCode = (k: any): number => {
  const codes = MODBUS_WRITE_CODE[Number(k.functionCode ?? 3)];
  if (!codes) {
    return 0;
  }
  const many = Number(k.objectsCount ?? 1) > 1 || ['string', 'bytes'].includes(text(k.type));
  return many ? codes[1] : codes[0];
};

/** Modbus: holding registers (3) are written with 6 / 16 and coils (1)
 *  with 5 / 15, at the same address and count. Input registers (4) and
 *  discrete inputs (2) are read-only, and one bit of a register can't
 *  be written without overwriting the rest of it. */
export const modbusAdapter = (): WriteAdapter => ({
  keyName: k => text(k.tag),
  address: k => {
    const table = modbusPlace(Number(k.functionCode ?? 3));
    return table ? `${table} ${text(k.address)}` : text(k.address);
  },
  dataType: k => text(k.type),
  writesWith: k => MODBUS_CODE_LABEL[modbusWriteCode(k)] ?? '',
  blocked: k => {
    const code = Number(k.functionCode ?? 3);
    if (code === 4) {
      return 'gateway.write-read-only-modbus-input';
    }
    if (code === 2) {
      return 'gateway.write-read-only-modbus-discrete';
    }
    if (code === 3 && k.bit !== undefined && k.bit !== null && text(k.bit) !== '') {
      return 'gateway.write-read-only-modbus-bit';
    }
    return modbusWriteCode(k) ? null : 'gateway.write-read-only-unknown';
  },
  toEntry: (k, name) => ({
    ...pointOf(k, ['value', 'bit', 'bitTargetType']),
    tag: name,
    functionCode: modbusWriteCode(k),
  }),
  entryName: e => text(e.tag),
  entryAddress: e => {
    const table = modbusTable(Number(e.functionCode));
    return table ? `${table} ${text(e.address)}` : '';
  },
});

// ---------- OPC UA ----------

/** `${ns=2;i=5}` → `ns=2;i=5`. */
const stripExpression = (value: string): string => {
  const match = /^\$\{(.*)\}$/.exec(value.trim());
  return (match ? match[1] : value).trim();
};
const isNodeId = (value: string): boolean => /^(ns=\d+;)?[isgb]=./.test(value);

/** OPC UA: the RPC is a variable-bound entry `{method, nodeId, operation:
 *  'write'}`; the gateway reads the node's data type from the server
 *  when it writes. A key given by browse path is bound by its key name,
 *  which the gateway resolves to the same node. Constants can't be
 *  written. */
export const opcUaAdapter = (): WriteAdapter => {
  const nodeOf = (k: any): string => {
    const value = stripExpression(text(k.value));
    return isNodeId(value) ? value : text(k.key);
  };
  return {
    keyName: k => text(k.key),
    address: k => stripExpression(text(k.value)),
    matchAddress: k => nodeOf(k),
    dataType: () => 'gateway.write-type-from-device',
    blocked: k => k.type === 'constant' ? 'gateway.write-read-only-constant' : null,
    toEntry: (k, name, target: WriteTarget) => target === 'rpc'
      ? { method: name, arguments: [], nodeId: nodeOf(k), operation: 'write' }
      : { key: name, type: k.type, value: k.value },
    entryName: (e, target) => text(target === 'rpc' ? e.method : e.key),
    entryAddress: (e, target) => target === 'rpc'
      ? (e.operation === 'read' ? '' : text(e.nodeId))
      : (isNodeId(stripExpression(text(e.value))) ? stripExpression(text(e.value)) : text(e.key)),
  };
};

// ---------- IEC 61850 ----------

/** IEC 61850: setpoints and settings (SP, SE, SG, CF, DC, SV, EX) are
 *  written with the same reference, FC and type; status (ST) and
 *  measured values (MX) can't be written, and controls (CO) need a
 *  control model, so they are added by hand. */
export const iec61850Adapter = (): WriteAdapter => ({
  keyName: k => text(k.tag),
  address: k => k.fc ? `${text(k.reference)} [${k.fc}]` : text(k.reference),
  dataType: k => text(k.valueType),
  blocked: k => ['ST', 'MX', 'CO'].includes(text(k.fc).toUpperCase()) ? 'gateway.write-read-only-status' : null,
  toEntry: (k, name, target) => target === 'rpc'
    ? { method: name, reference: k.reference, ...(k.fc ? { fc: k.fc } : {}), ...(k.valueType ? { valueType: k.valueType } : {}), operation: 'write' }
    : { ...pointOf(k, ['enumMapping']), tag: name },
  entryName: (e, target) => text(target === 'rpc' ? e.method : e.tag),
  entryAddress: (e, target) => target === 'rpc' && e.operation === 'read'
    ? '' : (e.fc ? `${text(e.reference)} [${e.fc}]` : text(e.reference)),
});

// ---------- PROFINET ----------

const PROFINET_PLACE = ['slot', 'subslot', 'offset', 'type', 'bit', 'length', 'area'];
const profinetPlace = (k: any): any => {
  const out: any = {};
  for (const field of PROFINET_PLACE) {
    if (k[field] !== undefined && k[field] !== null && k[field] !== '') {
      out[field] = k[field];
    }
  }
  return out;
};
const profinetAddress = (k: any): string => {
  const bit = k.bit !== undefined && k.bit !== null && k.bit !== '' ? `.${k.bit}` : '';
  return `${text(k.area || 'input')} ${text(k.slot)}/${text(k.subslot ?? 1)} @${text(k.offset ?? 0)}${bit}`;
};

/** PROFINET: only fields in the output area can be written; input data
 *  comes from the device. */
export const profinetAdapter = (): WriteAdapter => ({
  keyName: k => text(k.key),
  address: k => profinetAddress(k),
  dataType: k => text(k.type),
  blocked: k => text(k.area || 'input') !== 'output' ? 'gateway.write-read-only-input' : null,
  toEntry: (k, name, target) => target === 'rpc'
    ? { method: name, ...profinetPlace(k), operation: 'write' }
    : { key: name, ...profinetPlace(k) },
  entryName: (e, target) => text(target === 'rpc' ? e.method : e.key),
  entryAddress: (e, target) => target === 'rpc' && e.operation === 'read' ? '' : profinetAddress({ area: 'output', ...e }),
});

// ---------- DNP3 ----------

const DNP3_OUTPUT_OF: Record<string, string> = {
  binaryOutputStatus: 'binaryOutput',
  analogOutputStatus: 'analogOutput',
};

/** DNP3: an output status point becomes a command on the output point
 *  with the same index (binary → CROB, analog → set point); inputs and
 *  counters can't be commanded. */
export const dnp3Adapter = (): WriteAdapter => ({
  keyName: k => text(k.key),
  address: k => `${text(DNP3_OUTPUT_OF[k.pointType] ?? k.pointType)} ${text(k.index)}`,
  dataType: k => text(k.pointType),
  blocked: k => DNP3_OUTPUT_OF[k.pointType] ? null : 'gateway.write-read-only-input',
  toEntry: (k, name, target) => target === 'rpc'
    ? { method: name, pointType: DNP3_OUTPUT_OF[k.pointType], index: k.index }
    : { key: name, pointType: DNP3_OUTPUT_OF[k.pointType], index: k.index },
  entryName: (e, target) => text(target === 'rpc' ? e.method : e.key),
  entryAddress: e => `${text(e.pointType)} ${text(e.index)}`,
});

// ---------- SNMP ----------

/** SNMP: a single-OID get becomes a set on the same OID with the same
 *  value type. Walks and multi-OID reads can't be copied. The RPC and
 *  attribute filters match the name exactly. */
export const snmpAdapter = (): WriteAdapter => {
  const oidOf = (k: any): string => Array.isArray(k.oid) ? (k.oid.length === 1 ? text(k.oid[0]) : '') : text(k.oid);
  const exact = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const unescape = (filter: string): string => text(filter).replace(/\\(.)/g, '$1');
  return {
    keyName: k => text(k.key),
    address: k => oidOf(k),
    dataType: k => text(k.valueType),
    blocked: k => !['get', 'getnext', ''].includes(text(k.method)) || !oidOf(k) ? 'gateway.write-read-only-several' : null,
    toEntry: (k, name, target) => ({
      [target === 'rpc' ? 'requestFilter' : 'attributeFilter']: exact(name),
      method: 'set',
      oid: oidOf(k),
      ...(k.valueType ? { valueType: k.valueType } : {}),
      ...(k.community ? { community: k.community } : {}),
    }),
    entryName: (e, target) => unescape(target === 'rpc' ? e.requestFilter : e.attributeFilter),
    entryAddress: e => text(e.method) === 'set' ? oidOf(e) : '',
  };
};
