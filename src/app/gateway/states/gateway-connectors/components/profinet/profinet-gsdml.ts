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

import {
  ProfinetArea,
  ProfinetDeviceConfig,
  ProfinetKey,
  ProfinetModuleConfig,
  ProfinetSubmoduleConfig,
  ProfinetValueType,
} from '../../models/public-api';

/**
 * Reading a GSDML — the XML a PROFINET device's vendor ships — into the
 * connector's configuration: the device's identity, its access points
 * (DAPs) and the modules each takes in which slots, each submodule's IO
 * data (DataItems, bit by bit) and its parameter records with their
 * defaults. It is the gateway's own parser (`sentient-profinet`'s
 * `gsdml.rs`) in TypeScript, element for element, so that the modules the
 * form writes are the expected configuration the gateway's Connect sends —
 * which the gateway's tests hold to what TIA Portal sent for the same
 * device. Element names are matched by local name, as the schema's
 * namespace varies between GSDML versions.
 */

export interface GsdmlBit {
  bit: number;
  name: string;
}

export interface GsdmlDataItem {
  name: string;
  /** As the GSDML spells it: Unsigned8, Float32, OctetString… */
  dataType: string;
  /** Octets. */
  length: number;
  /** Its offset in the submodule's data. */
  offset: number;
  bits: GsdmlBit[];
}

export interface GsdmlParameterRef {
  name: string;
  dataType: string;
  byteOffset: number;
  bitOffset?: number;
  bitLength?: number;
  defaultValue?: string;
  allowedValues?: string;
  changeable: boolean;
  visible: boolean;
}

export interface GsdmlRecord {
  index: number;
  length: number;
  name: string;
  consts: { offset: number; data: number[] }[];
  refs: GsdmlParameterRef[];
}

export interface GsdmlSubmodule {
  id: string;
  ident: number;
  subslot: number;
  name: string;
  input: GsdmlDataItem[];
  output: GsdmlDataItem[];
  records: GsdmlRecord[];
}

export interface GsdmlModule {
  id: string;
  ident: number;
  name: string;
  orderNumber?: string;
  submodules: GsdmlSubmodule[];
}

export interface GsdmlUseableModule {
  moduleId: string;
  allowedInSlots: number[];
  usedInSlots: number[];
  fixedInSlots: number[];
}

export interface GsdmlDap {
  id: string;
  moduleIdent: number;
  name: string;
  dnsCompatibleName?: string;
  orderNumber?: string;
  physicalSlots: number[];
  minDeviceInterval?: number;
  /** Its own virtual submodules, then its interface and ports. */
  submodules: GsdmlSubmodule[];
  useableModules: GsdmlUseableModule[];
  sendClocks: number[];
  reductionRatios: number[];
}

/** What the device calls an error type (ChannelDiagList). */
export interface GsdmlChannelDiag {
  errorType: number;
  name: string;
  help?: string;
}

/** A manufacturer's diagnosis's name, by its USI (UnitDiagTypeList). */
export interface GsdmlUnitDiag {
  usi: number;
  name: string;
}

export interface GsdmlDocument {
  vendorId: number;
  deviceId: number;
  vendorName: string;
  info: string;
  daps: GsdmlDap[];
  modules: GsdmlModule[];
  channelDiagnosis: GsdmlChannelDiag[];
  unitDiagnosis: GsdmlUnitDiag[];
}

/** Octets of the GSDML's fixed data types. */
const FIXED_LENGTHS: Record<string, number> = {
  Integer8: 1,
  Integer16: 2,
  Integer32: 4,
  Integer64: 8,
  Unsigned8: 1,
  Unsigned16: 2,
  Unsigned32: 4,
  Unsigned64: 8,
  Float32: 4,
  Float64: 8,
  'Unsigned8+Unsigned8': 2,
  'Unsigned16_S': 3,
  'Integer16_S': 3,
  'Float32+Unsigned8': 5,
  Date: 7,
  'TimeOfDay with date indication': 6,
  'TimeDifference with date indication': 6,
  'TimeOfDay without date indication': 4,
  'TimeDifference without date indication': 4,
  F_MessageTrailer4Byte: 4,
  F_MessageTrailer5Byte: 5,
};

/** A data type's octets: fixed, or its item's `Length`. */
export function dataTypeLength(dataType: string, length?: number): number {
  const fixed = FIXED_LENGTHS[dataType];
  if (fixed !== undefined) {
    return fixed;
  }
  if (length === undefined) {
    throw new Error(`data type "${dataType}" without a Length`);
  }
  return length;
}

function children(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter(c => c.localName === localName);
}

function child(parent: Element | undefined, localName: string): Element | undefined {
  return parent ? children(parent, localName)[0] : undefined;
}

function find(parent: Element, localName: string): Element | undefined {
  return Array.from(parent.getElementsByTagNameNS('*', localName))[0];
}

/** Decimal or 0x hex, as a GSDML writes numbers. */
export function gsdmlNumber(v: string | null | undefined): number | undefined {
  if (v === null || v === undefined) {
    return undefined;
  }
  const t = v.trim();
  const n = /^0x[0-9a-f]+$/i.test(t) ? Number.parseInt(t.slice(2), 16) : /^-?\d+$/.test(t) ? Number(t) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function numberAttr(n: Element, name: string): number | undefined {
  return gsdmlNumber(n.getAttribute(name));
}

function requiredNumber(n: Element, name: string): number {
  const raw = n.getAttribute(name);
  if (raw === null) {
    throw new Error(`no ${name}`);
  }
  const v = gsdmlNumber(raw);
  if (v === undefined || v < 0 || v > 0xFFFFFFFF) {
    throw new Error(`${name} "${raw}" is not valid`);
  }
  return v;
}

function boolAttr(n: Element, name: string, fallback: boolean): boolean {
  const v = n.getAttribute(name);
  return v === null ? fallback : v === 'true';
}

/** `1..4`, `0 2 5`, or `1..3 7`. */
export function slotList(v: string | null | undefined): number[] {
  const out: number[] = [];
  for (const part of (v ?? '').split(/\s+/).filter(p => p)) {
    const range = part.split('..');
    if (range.length === 2) {
      const a = Number(range[0]);
      const b = Number(range[1]);
      if (Number.isInteger(a) && Number.isInteger(b)) {
        for (let i = a; i <= b; i++) {
          out.push(i);
        }
      }
    } else if (/^\d+$/.test(part)) {
      out.push(Number(part));
    }
  }
  return out;
}

/** `0x01,0x02,…` as GSDML writes octets. */
function octets(v: string): number[] | undefined {
  const out: number[] = [];
  for (const part of v.split(',').filter(p => p.trim())) {
    const n = gsdmlNumber(part);
    if (n === undefined || n < 0 || n > 255) {
      return undefined;
    }
    out.push(n);
  }
  return out;
}

type Text = (n: Element | undefined) => string;

function dataItems(n: Element | undefined, text: Text): GsdmlDataItem[] {
  const out: GsdmlDataItem[] = [];
  let offset = 0;
  for (const d of n ? children(n, 'DataItem') : []) {
    const dataType = d.getAttribute('DataType') ?? '';
    const length = dataTypeLength(dataType, numberAttr(d, 'Length'));
    const bits = children(d, 'BitDataItem')
      .map(b => ({ bit: numberAttr(b, 'BitOffset'), name: text(b) }))
      .filter((b): b is GsdmlBit => b.bit !== undefined);
    out.push({ name: text(d), dataType, length, offset, bits });
    offset += length;
  }
  return out;
}

function records(n: Element, text: Text): GsdmlRecord[] {
  const list = child(n, 'RecordDataList');
  if (!list) {
    return [];
  }
  return children(list, 'ParameterRecordDataItem').map(item => ({
    index: requiredNumber(item, 'Index'),
    length: requiredNumber(item, 'Length'),
    name: text(child(item, 'Name')),
    // A Const without Data, or with octets that do not read, is skipped.
    consts: children(item, 'Const')
      .map(c => {
        const raw = c.getAttribute('Data');
        return { offset: numberAttr(c, 'ByteOffset') ?? 0, data: raw === null ? undefined : octets(raw) };
      })
      .filter((c): c is { offset: number; data: number[] } => c.data !== undefined),
    refs: children(item, 'Ref').map(r => ({
      name: text(r),
      dataType: r.getAttribute('DataType') ?? '',
      byteOffset: numberAttr(r, 'ByteOffset') ?? 0,
      bitOffset: numberAttr(r, 'BitOffset'),
      bitLength: numberAttr(r, 'BitLength'),
      defaultValue: r.getAttribute('DefaultValue') ?? undefined,
      allowedValues: r.getAttribute('AllowedValues') ?? undefined,
      changeable: boolAttr(r, 'Changeable', true),
      visible: boolAttr(r, 'Visible', true),
    })),
  }));
}

function nameOf(n: Element, text: Text): string {
  return text(child(child(n, 'ModuleInfo'), 'Name'));
}

function orderNumber(n: Element): string | undefined {
  return child(child(n, 'ModuleInfo'), 'OrderNumber')?.getAttribute('Value') ?? undefined;
}

function submodule(n: Element, text: Text): GsdmlSubmodule {
  const io = child(n, 'IOData');
  return {
    id: n.getAttribute('ID') ?? '',
    ident: requiredNumber(n, 'SubmoduleIdentNumber'),
    subslot: slotList(n.getAttribute('FixedInSubslots'))[0] ?? 1,
    name: nameOf(n, text),
    input: dataItems(child(io, 'Input'), text),
    output: dataItems(child(io, 'Output'), text),
    records: records(n, text),
  };
}

function module(n: Element, text: Text, items: Map<string, GsdmlSubmodule>): GsdmlModule {
  const submodules: GsdmlSubmodule[] = [];
  for (const item of children(child(n, 'VirtualSubmoduleList') ?? n, 'VirtualSubmoduleItem')) {
    submodules.push(submodule(item, text));
  }
  // Pluggable submodules fixed in a subslot are part of the module.
  for (const r of children(child(n, 'UseableSubmodules') ?? n, 'SubmoduleItemRef')) {
    const sub = items.get(r.getAttribute('SubmoduleItemTarget') ?? '');
    const fixed = slotList(r.getAttribute('FixedInSubslots'));
    if (sub && fixed.length) {
      submodules.push({ ...sub, subslot: fixed[0] });
    }
  }
  return {
    id: n.getAttribute('ID') ?? '',
    ident: requiredNumber(n, 'ModuleIdentNumber'),
    name: nameOf(n, text),
    orderNumber: orderNumber(n),
    submodules,
  };
}

function dap(n: Element, text: Text): GsdmlDap {
  const submodules: GsdmlSubmodule[] = [];
  for (const item of children(child(n, 'VirtualSubmoduleList') ?? n, 'VirtualSubmoduleItem')) {
    submodules.push(submodule(item, text));
  }
  let sendClocks: number[] = [];
  let reductionRatios: number[] = [];
  for (const item of Array.from(child(n, 'SystemDefinedSubmoduleList')?.children ?? [])) {
    if (item.localName !== 'InterfaceSubmoduleItem' && item.localName !== 'PortSubmoduleItem') {
      continue;
    }
    const timing = find(item, 'TimingProperties');
    if (timing) {
      sendClocks = slotList(timing.getAttribute('SendClock'));
      reductionRatios = slotList(timing.getAttribute('ReductionRatio'));
    }
    const subslot = numberAttr(item, 'SubslotNumber');
    if (subslot === undefined) {
      throw new Error('no SubslotNumber');
    }
    submodules.push({
      id: item.getAttribute('ID') ?? '',
      ident: requiredNumber(item, 'SubmoduleIdentNumber'),
      subslot,
      name: text(item),
      input: [],
      output: [],
      records: [],
    });
  }
  return {
    id: n.getAttribute('ID') ?? '',
    moduleIdent: requiredNumber(n, 'ModuleIdentNumber'),
    name: nameOf(n, text),
    dnsCompatibleName: n.getAttribute('DNS_CompatibleName') ?? undefined,
    orderNumber: orderNumber(n),
    physicalSlots: slotList(n.getAttribute('PhysicalSlots')),
    minDeviceInterval: numberAttr(n, 'MinDeviceInterval'),
    submodules,
    useableModules: children(child(n, 'UseableModules') ?? n, 'ModuleItemRef').map(r => ({
      moduleId: r.getAttribute('ModuleItemTarget') ?? '',
      allowedInSlots: slotList(r.getAttribute('AllowedInSlots')),
      usedInSlots: slotList(r.getAttribute('UsedInSlots')),
      fixedInSlots: slotList(r.getAttribute('FixedInSlots')),
    })),
    sendClocks,
    reductionRatios,
  };
}

const ENCODINGS: Record<string, string> = {
  'utf-8': 'utf-8',
  utf8: 'utf-8',
  // As browsers read it (the WHATWG Encoding Standard); the gateway's
  // parser reads it the same way.
  'iso-8859-1': 'windows-1252',
  'iso8859-1': 'windows-1252',
  latin1: 'windows-1252',
  'latin-1': 'windows-1252',
  'windows-1252': 'windows-1252',
  cp1252: 'windows-1252',
};

/**
 * A GSDML file's text, as its bytes say: a UTF-8 or UTF-16 byte-order
 * mark, else the XML declaration's encoding — UTF-8, or ISO-8859-1 or
 * windows-1252, which older GSDMLs (Siemens' among them) are written in —
 * else UTF-8. The gateway's `gsdml::decode`, in TypeScript.
 */
export function decodeGsdml(bytes: Uint8Array): string {
  const utf8 = (b: Uint8Array) => {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(b);
    } catch {
      throw new Error('the UTF-8 text is not valid');
    }
  };
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return utf8(bytes.subarray(3));
  }
  if ((bytes[0] === 0xFF && bytes[1] === 0xFE) || (bytes[0] === 0xFE && bytes[1] === 0xFF)) {
    try {
      return new TextDecoder(bytes[0] === 0xFF ? 'utf-16le' : 'utf-16be', { fatal: true }).decode(bytes.subarray(2));
    } catch {
      throw new Error('the UTF-16 text is not valid');
    }
  }
  const head = Array.from(bytes.subarray(0, 200)).map(b => String.fromCharCode(b)).join('');
  const declared = /encoding=(["'])([^"']*)\1/.exec(head)?.[2]?.toLowerCase();
  if (declared === undefined) {
    return utf8(bytes);
  }
  const encoding = ENCODINGS[declared];
  if (!encoding) {
    throw new Error(`encoding "${declared}" is not valid`);
  }
  return encoding === 'utf-8' ? utf8(bytes) : new TextDecoder(encoding).decode(bytes);
}

/**
 * A GSDML. Throws an `Error` whose message says what is wrong with the
 * file.
 */
export function parseGsdml(xml: string, parser: DOMParser = new DOMParser()): GsdmlDocument {
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('not an XML file');
  }
  const root = doc.documentElement;
  if (root?.localName !== 'ISO15745Profile') {
    throw new Error(`not a GSDML: the document is <${root?.localName}>, not <ISO15745Profile>`);
  }
  const texts = new Map<string, string>();
  const primary = find(root, 'PrimaryLanguage');
  for (const t of primary ? children(primary, 'Text') : []) {
    const id = t.getAttribute('TextId');
    const value = t.getAttribute('Value');
    if (id !== null && value !== null) {
      texts.set(id, value);
    }
  }
  const text: Text = n => {
    if (!n) {
      return '';
    }
    const id = n.getAttribute('TextId');
    return (id !== null ? texts.get(id) : undefined) ?? n.getAttribute('Value') ?? '';
  };
  const identity = find(root, 'DeviceIdentity');
  if (!identity) {
    throw new Error('no DeviceIdentity: not a PROFINET GSDML');
  }
  const process = find(root, 'ApplicationProcess');
  if (!process) {
    throw new Error('no ApplicationProcess');
  }
  const items = new Map<string, GsdmlSubmodule>();
  for (const item of children(child(process, 'SubmoduleList') ?? process, 'SubmoduleItem')) {
    const sub = submodule(item, text);
    items.set(sub.id, sub);
  }
  const modules = children(child(process, 'ModuleList') ?? process, 'ModuleItem').map(m => module(m, text, items));
  const dapList = find(process, 'DeviceAccessPointList');
  const daps = dapList ? children(dapList, 'DeviceAccessPointItem').map(d => dap(d, text)) : [];
  if (!daps.length) {
    throw new Error('no DeviceAccessPointItem');
  }
  const channelDiagnosis: GsdmlChannelDiag[] = [];
  const channelList = child(process, 'ChannelDiagList');
  for (const item of channelList ? Array.from(channelList.children) : []) {
    const errorType = numberAttr(item, 'ErrorType');
    if (errorType === undefined) {
      continue;
    }
    const help = child(item, 'Help');
    channelDiagnosis.push({
      errorType: errorType & 0xffff,
      name: text(child(item, 'Name')),
      ...(help ? { help: text(help) } : {}),
    });
  }
  const unitDiagnosis: GsdmlUnitDiag[] = [];
  const unitList = child(process, 'UnitDiagTypeList');
  for (const item of unitList ? Array.from(unitList.children) : []) {
    const usi = numberAttr(item, 'UserStructureIdentifier');
    if (usi !== undefined) {
      unitDiagnosis.push({ usi: usi & 0xffff, name: text(child(item, 'Name')) });
    }
  }
  return {
    vendorId: requiredNumber(identity, 'VendorID'),
    deviceId: requiredNumber(identity, 'DeviceID'),
    vendorName: child(identity, 'VendorName')?.getAttribute('Value') ?? '',
    info: text(child(identity, 'InfoText')),
    daps,
    modules,
    channelDiagnosis,
    unitDiagnosis,
  };
}

/** The device's diagnosis texts as the gateway's configuration takes them;
 * an entry the GSDML leaves unnamed (Siemens' UnitDiagTypeItems) says
 * nothing and is left out. */
export function diagnosisConfig(doc: GsdmlDocument): Pick<ProfinetDeviceConfig, 'channelDiagnosis' | 'unitDiagnosis'> {
  const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;
  return {
    channelDiagnosis: doc.channelDiagnosis
      .filter(c => c.name)
      .map(c => ({ errorType: hex(c.errorType), name: c.name, ...(c.help ? { help: c.help } : {}) })),
    unitDiagnosis: doc.unitDiagnosis.filter(u => u.name).map(u => ({ usi: hex(u.usi), name: u.name })),
  };
}

// ── Records ──────────────────────────────────────────────────────────────

/** The record with every Const and every Ref's default in place. */
export function recordDefaultData(record: GsdmlRecord): number[] {
  const data = new Array<number>(record.length).fill(0);
  for (const c of record.consts) {
    c.data.forEach((b, i) => {
      if (c.offset + i < data.length) {
        data[c.offset + i] = b;
      }
    });
  }
  for (const r of record.refs) {
    if (r.defaultValue !== undefined) {
      writeValue(data, r, r.defaultValue);
    }
  }
  return data;
}

function writeValue(data: number[], r: GsdmlParameterRef, v: string): void {
  const bad = () => new Error(`parameter value ${r.name} = ${v} is not valid`);
  const at = r.byteOffset;
  const put = (bytes: number[]) => {
    if (at + bytes.length > data.length) {
      throw bad();
    }
    bytes.forEach((b, i) => data[at + i] = b);
  };
  const integer = (width: number) => {
    const t = v.trim();
    let n: bigint;
    try {
      n = /^0x/i.test(t) ? BigInt(t) : BigInt(t.replace(/^\+/, ''));
    } catch {
      throw bad();
    }
    const mask = (BigInt(1) << BigInt(8 * width)) - BigInt(1);
    let u = n & mask;
    const out: number[] = [];
    for (let i = 0; i < width; i++) {
      out.unshift(Number(u & BigInt(0xFF)));
      u >>= BigInt(8);
    }
    put(out);
  };
  switch (r.dataType) {
    case 'Bit':
    case 'BitArea': {
      const n = gsdmlNumber(v);
      if (n === undefined || at >= data.length) {
        throw bad();
      }
      const bit = r.bitOffset ?? 0;
      const len = r.bitLength ?? 1;
      const mask = (((1 << len) - 1) << bit) & 0xFF;
      data[at] = (data[at] & ~mask & 0xFF) | ((n << bit) & mask);
      return;
    }
    case 'Integer8':
    case 'Unsigned8':
      return integer(1);
    case 'Integer16':
    case 'Unsigned16':
      return integer(2);
    case 'Integer32':
    case 'Unsigned32':
      return integer(4);
    case 'Integer64':
    case 'Unsigned64':
      return integer(8);
    case 'Float32':
    case 'Float64': {
      const f = Number(v.trim());
      if (!Number.isFinite(f)) {
        throw bad();
      }
      const width = r.dataType === 'Float32' ? 4 : 8;
      const view = new DataView(new ArrayBuffer(width));
      if (width === 4) {
        view.setFloat32(0, f);
      } else {
        view.setFloat64(0, f);
      }
      put(Array.from(new Uint8Array(view.buffer)));
      return;
    }
    case 'OctetString': {
      const bytes = octets(v);
      if (!bytes) {
        throw bad();
      }
      return put(bytes);
    }
    case 'VisibleString':
      return put(Array.from(new TextEncoder().encode(v)));
    default:
      throw bad();
  }
}

export function toHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Into the connector's configuration ──────────────────────────────────

function lengthOf(items: GsdmlDataItem[]): number {
  return items.reduce((sum, d) => sum + d.length, 0);
}

/** A submodule as the connector expects it, its records at their defaults. */
export function submoduleConfig(sub: GsdmlSubmodule): ProfinetSubmoduleConfig {
  const config: ProfinetSubmoduleConfig = {
    subslot: sub.subslot >= 0x8000 ? `0x${sub.subslot.toString(16).toUpperCase()}` : sub.subslot,
    submoduleIdent: `0x${sub.ident.toString(16).toUpperCase().padStart(8, '0')}`,
    name: sub.name || sub.id,
  };
  const input = lengthOf(sub.input);
  const output = lengthOf(sub.output);
  if (input) {
    config.inputLength = input;
  }
  if (output) {
    config.outputLength = output;
  }
  if (sub.records.length) {
    config.records = sub.records.map(r => ({ index: r.index, data: toHex(recordDefaultData(r)) }));
  }
  return config;
}

/** The DAP in slot 0. */
export function dapConfig(d: GsdmlDap): ProfinetModuleConfig {
  return {
    slot: 0,
    moduleIdent: `0x${d.moduleIdent.toString(16).toUpperCase().padStart(8, '0')}`,
    name: d.name || d.id,
    gsdmlId: d.id,
    submodules: d.submodules.map(submoduleConfig),
  };
}

/** A module placed in `slot`. */
export function moduleConfig(m: GsdmlModule, slot: number): ProfinetModuleConfig {
  return {
    slot,
    moduleIdent: `0x${m.ident.toString(16).toUpperCase().padStart(8, '0')}`,
    name: m.name || m.id,
    gsdmlId: m.id,
    submodules: m.submodules.map(submoduleConfig),
  };
}

/** The modules a DAP takes in `slot`. */
export function modulesForSlot(gsdml: GsdmlDocument, d: GsdmlDap, slot: number): GsdmlModule[] {
  return d.useableModules
    .filter(u => u.allowedInSlots.includes(slot) || u.fixedInSlots.includes(slot))
    .map(u => gsdml.modules.find(m => m.id === u.moduleId))
    .filter((m): m is GsdmlModule => !!m);
}

/** A GSDML data type as the connector's: its type and, for text and octets, its length. */
export function valueTypeOf(item: GsdmlDataItem): { type: ProfinetValueType; length?: number } {
  switch (item.dataType) {
    case 'Unsigned8': return { type: ProfinetValueType.UINT8 };
    case 'Integer8': return { type: ProfinetValueType.INT8 };
    case 'Unsigned16': return { type: ProfinetValueType.UINT16 };
    case 'Integer16': return { type: ProfinetValueType.INT16 };
    case 'Unsigned32': return { type: ProfinetValueType.UINT32 };
    case 'Integer32': return { type: ProfinetValueType.INT32 };
    case 'Unsigned64': return { type: ProfinetValueType.UINT64 };
    case 'Integer64': return { type: ProfinetValueType.INT64 };
    case 'Float32': return { type: ProfinetValueType.FLOAT32 };
    case 'Float64': return { type: ProfinetValueType.FLOAT64 };
    case 'VisibleString': return { type: ProfinetValueType.STRING, length: item.length };
    default: return { type: ProfinetValueType.BYTES, length: item.length };
  }
}

/** `Input 8 bits` → `input8Bits`. */
export function keyFromName(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(w => w);
  return words
    .map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

/**
 * The keys of a placed submodule's data: one per DataItem, and one bool
 * per named bit of an item used as bits. Keys come from the GSDML's names,
 * prefixed by the slot (`s4EchoValue`) and, for outputs, by `set`
 * (`setS4EchoValue`), and are made unique against `taken`.
 */
export function keysFor(
  slot: number,
  sub: GsdmlSubmodule,
  area: ProfinetArea,
  taken: Set<string>,
): ProfinetKey[] {
  const unique = (base: string): string => {
    let key = base;
    for (let n = 2; taken.has(key); n++) {
      key = `${base}_${n}`;
    }
    taken.add(key);
    return key;
  };
  const items = area === ProfinetArea.INPUT ? sub.input : sub.output;
  const camel = (name: string): string => {
    const key = keyFromName(name);
    return key ? key[0].toUpperCase() + key.slice(1) : '';
  };
  const place = (offset: number) => ({
    slot,
    ...(sub.subslot !== 1 ? { subslot: sub.subslot } : {}),
    offset,
    ...(area === ProfinetArea.OUTPUT ? { area: ProfinetArea.OUTPUT } : {}),
  });
  const keys: ProfinetKey[] = [];
  items.forEach((item, i) => {
    // Outputs are what a shared attribute sets: `setS2Valve`.
    const name = `s${slot}${camel(item.name) || `${area === ProfinetArea.INPUT ? 'In' : 'Out'}${i}`}`;
    const base = area === ProfinetArea.OUTPUT ? `set${name[0].toUpperCase()}${name.slice(1)}` : name;
    if (item.bits.length) {
      for (const b of item.bits) {
        keys.push({
          key: unique(`${base}${camel(b.name) || `Bit${b.bit}`}`),
          ...place(item.offset),
          type: ProfinetValueType.BOOL,
          bit: b.bit,
        });
      }
    } else {
      keys.push({ key: unique(base), ...place(item.offset), ...valueTypeOf(item) });
    }
  });
  return keys;
}
