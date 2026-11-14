///
/// Copyright © 2016-2025 The SENTIENT Authors
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

/**
 * Fill-drag rules of the key sheet (drag the corner of a cell or of a row
 * number). Everything here is pure: plain values in, plain values out, so the
 * sheet can preview a fill before it touches a form and the rules can be
 * tested without Angular.
 *
 * A rule answers one question: the row next to this one holds `value`; what
 * goes into the following row? `undefined` means "nothing smarter than a copy".
 */

export interface SpreadsheetFillContext {
  /** Value of this column in the neighbouring row the fill continues from. */
  value: any;
  /** The row whose data type decides the step: the neighbouring row when
   *  filling down or carrying whole rows, the row being written when a single
   *  column is filled upwards. Column values by column key, on top of the
   *  row's raw form value (so fields without a column are there too). */
  row: Record<string, any>;
  /** 1 = downwards, -1 = upwards. */
  dir: 1 | -1;
  /** 'row' carries every column, 'cell' fills one column only. */
  mode: 'row' | 'cell';
}

export type SpreadsheetFillFn = (ctx: SpreadsheetFillContext) => any;

/** 'copy' repeats the value (default); 'series' counts a trailing number
 *  (temp9 → temp10); 'increment' adds 1 to a number. */
export type SpreadsheetFillRule = 'copy' | 'series' | 'increment' | SpreadsheetFillFn;

export interface SpreadsheetFillColumn {
  key: string;
  fill?: SpreadsheetFillRule;
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

const keepCase = (sample: string, text: string): string =>
  sample === sample.toLowerCase() && sample !== sample.toUpperCase() ? text.toLowerCase() : text;

/** temp9 → temp10, pump_007 → pump_008. No trailing number: unchanged. */
export function fillTrailingNumber(value: any, dir: number): any {
  const m = /^(.*?)(\d+)$/.exec(String(value ?? ''));
  if (!m) return undefined;
  const n = parseInt(m[2], 10) + dir;
  return n < 0 ? undefined : m[1] + pad(n, m[2].length);
}

/** Counts the last number anywhere in the text: GGIO1.AnIn1.mag.f →
 *  GGIO1.AnIn2.mag.f, Tank[3].Level → Tank[4].Level. */
export function fillLastNumber(value: any, dir: number): any {
  const m = /^(.*\D|)(\d+)(\D*)$/.exec(String(value ?? ''));
  if (!m) return undefined;
  const n = parseInt(m[2], 10) + dir;
  return n < 0 ? undefined : m[1] + pad(n, m[2].length) + m[3];
}

/** For references and symbols: the last number counts (IEC 61850, Logix). */
export const lastNumberFill: SpreadsheetFillFn = ({ value, dir }) => fillLastNumber(value, dir);

function fillNumber(value: any, step: number): any {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!isFinite(n)) return undefined;
  const out = n + step;
  return out < 0 ? undefined : out;
}

/** Bytes a value of this type takes (uint16, int32, float64, …). */
export function valueTypeBytes(type: any): number | undefined {
  const t = String(type ?? '').toLowerCase();
  if (t === 'bool' || t === 'boolean') return 1;
  const m = /^(?:u?int|float)(8|16|32|64)$/.exec(t);
  if (m) return parseInt(m[1], 10) / 8;
  if (t === 'float') return 4;
  if (t === 'double') return 8;
  return undefined;
}

/** byte.bit style counting with a rollover (8 bits of a byte, 16 of a word). */
function stepBit(unit: number, bit: number, dir: number, bitsPerUnit: number): [number, number] | undefined {
  const total = unit * bitsPerUnit + bit + dir;
  return total < 0 ? undefined : [Math.floor(total / bitsPerUnit), total % bitsPerUnit];
}

// ---- Modbus -----------------------------------------------------------------

/** The address moves on by the registers (or coils) the row takes, which is
 *  its Obj. Count: 1 for 16-bit, 2 for 32-bit, 4 for 64-bit types. */
export const modbusAddressFill: SpreadsheetFillFn = ({ value, row, dir }) =>
  fillNumber(value, dir * Math.max(1, Number(row.objectsCount) || 1));

// ---- Siemens S7 ---------------------------------------------------------------

const S7_LETTER_BYTES: Record<string, number> = { B: 1, W: 2, D: 4, L: 8 };
const S7_COMMA_BYTES: Record<string, number> = {
  DBB: 1, BYTE: 1, BY: 1, B: 1, CHAR: 1, C: 1,
  DBW: 2, WORD: 2, W: 2, INT: 2, I: 2,
  DBD: 4, DWORD: 4, DINT: 4, DW: 4, DD: 4, DI: 4, D: 4, REAL: 4, R: 4,
  DBL: 8, LREAL: 8, LR: 8,
};

/**
 * DB1.DBW0 → DB1.DBW2, DB1.DBD4 → DB1.DBD8, DB1.DBX0.7 → DB1.DBX1.0,
 * MW10 → MW12, I0.7 → I1.0, T1 → T2, DB1,REAL8 → DB1,REAL12,
 * DB1,S20.30 → DB1,S52.30 (a string of 30 takes 32 bytes).
 * The value type decides the step; the address letter is the fallback.
 * A symbolic tag name counts its last number.
 */
export const s7AddressFill: SpreadsheetFillFn = ({ value, row, dir }) => {
  const text = String(value ?? '').trim();
  const typed = String(row.valueType ?? '').toLowerCase();
  const typeBytes = typed === 'bool' || typed === 'string' ? undefined : valueTypeBytes(typed);

  let m = /^(%?(?:DB\d+\.DB|P[IQ]|[MIQEA]))([XBWDL]?)(\d+)(?:\.([0-7]))?$/i.exec(text);
  if (m) {
    if (m[4] !== undefined) {
      const next = stepBit(parseInt(m[3], 10), parseInt(m[4], 10), dir, 8);
      return next ? `${m[1]}${m[2]}${next[0]}.${next[1]}` : undefined;
    }
    // A string's length decides its step and the address does not say it.
    const width = typed === 'string' ? undefined : typeBytes ?? S7_LETTER_BYTES[m[2].toUpperCase()];
    if (!width) return undefined;
    const byte = parseInt(m[3], 10) + dir * width;
    return byte < 0 ? undefined : `${m[1]}${m[2]}${byte}`;
  }

  m = /^(DB\d+\s*,\s*)([A-Z]+)(\d+)(?:\.(\d+))?$/i.exec(text);
  if (m) {
    const token = m[2].toUpperCase();
    const offset = parseInt(m[3], 10);
    if (token === 'S' || token === 'STRING') {
      if (m[4] === undefined) return undefined;
      const next = offset + dir * (parseInt(m[4], 10) + 2);
      return next < 0 ? undefined : `${m[1]}${m[2]}${next}.${m[4]}`;
    }
    if (m[4] !== undefined) {
      const next = stepBit(offset, parseInt(m[4], 10), dir, 8);
      return next ? `${m[1]}${m[2]}${next[0]}.${next[1]}` : undefined;
    }
    if (token === 'X' || token === 'DBX') return undefined;
    const width = typeBytes ?? S7_COMMA_BYTES[token];
    if (!width) return undefined;
    const byte = offset + dir * width;
    return byte < 0 ? undefined : `${m[1]}${m[2]}${byte}`;
  }

  m = /^([CTZ])(\d+)$/i.exec(text);
  if (m) {
    const n = parseInt(m[2], 10) + dir;
    return n < 0 ? undefined : `${m[1]}${n}`;
  }
  return fillLastNumber(value, dir);
};

// ---- Mitsubishi MC protocol ---------------------------------------------------

const MC_HEX_DEVICE = /^(SB|DX|DY|SW|ZR|X|Y|B|W)([0-9A-F]+)(?:\.(\d{1,2}))?$/i;
const MC_DEC_DEVICE = /^([A-Z]+)(\d+)(?:\.(\d{1,2}))?$/i;
const MC_BIT_DEVICES = new Set(['SB', 'DX', 'DY', 'X', 'Y', 'B', 'SM', 'STS', 'STC', 'TS', 'TC', 'CS', 'CC',
  'LTS', 'LTC', 'LSTS', 'LCS', 'LCC', 'M', 'L', 'F', 'V']);
// Timer / counter values: one device point each, whatever the value type.
const MC_POINT_DEVICES = new Set(['TN', 'STN', 'CN', 'LTN', 'LSTN', 'LCN', 'LZ']);

/** D100 → D101 (16-bit), D200 → D202 (32-bit), D0 → D4 (64-bit), M200 → M201,
 *  Y1F → Y20 (X, Y, B, W, SB, SW, DX, DY, ZR count in hexadecimal),
 *  D300.15 → D301.0. */
export const mcAddressFill: SpreadsheetFillFn = ({ value, row, dir }) => {
  const text = String(value ?? '').trim();
  let m = MC_HEX_DEVICE.exec(text);
  const hex = !!m;
  if (!m) m = MC_DEC_DEVICE.exec(text);
  if (!m) return undefined;
  const device = m[1].toUpperCase();
  const number = parseInt(m[2], hex ? 16 : 10);
  const show = (n: number) => keepCase(m[2], (hex ? n.toString(16).toUpperCase() : String(n)).padStart(m[2].length, '0'));
  if (m[3] !== undefined) {
    const next = stepBit(number, parseInt(m[3], 10), dir, 16);
    return next ? `${m[1]}${show(next[0])}.${next[1]}` : undefined;
  }
  let step = 1;
  if (!MC_BIT_DEVICES.has(device) && !MC_POINT_DEVICES.has(device)) {
    const bytes = valueTypeBytes(row.valueType);
    if (!bytes) return undefined;            // string: its length decides the step
    step = Math.max(1, bytes / 2);
  }
  const next = number + dir * step;
  return next < 0 ? undefined : `${m[1]}${show(next)}`;
};

// ---- Omron FINS ---------------------------------------------------------------

const FINS_ADDRESS = /^(\s*(?:E\d{1,2}_|(?:CIO|IO|DM|D|WR|W|HR|H|AR|A|TIM|T|CNT|C)\s*)?)(\d{1,5})(?:\.(\d{1,2}))?\s*$/i;

/** D100 → D101 (16-bit) or D102 (32-bit), CIO20.15 → CIO21.00, T15 → T16,
 *  E0_100 → E0_101. */
export const finsAddressFill: SpreadsheetFillFn = ({ value, row, dir }) => {
  const m = FINS_ADDRESS.exec(String(value ?? ''));
  if (!m) return undefined;
  const area = m[1].trim().toUpperCase();
  const number = parseInt(m[2], 10);
  if (m[3] !== undefined) {
    const next = stepBit(number, parseInt(m[3], 10), dir, 16);
    return next ? `${m[1]}${pad(next[0], m[2].length)}.${pad(next[1], m[3].length)}` : undefined;
  }
  let step = 1;
  if (!/^(TIM|T|CNT|C)$/.test(area)) {
    const bytes = valueTypeBytes(row.valueType);
    if (!bytes) return undefined;
    step = Math.max(1, bytes / 2);
  }
  const next = number + dir * step;
  return next < 0 ? undefined : `${m[1]}${pad(next, m[2].length)}`;
};

// ---- EtherCAT -------------------------------------------------------------------

const stepRadix = (text: string, step: number): string | undefined => {
  const hex = /^0x/i.test(text);
  const n = parseInt(text, hex ? 16 : 10) + step;
  if (n < 0) return undefined;
  if (!hex) return String(n);
  const digits = text.slice(2);
  const out = n.toString(16).padStart(digits.length, '0');
  return text.slice(0, 2) + (digits === digits.toLowerCase() ? out : out.toUpperCase());
};

/** pdo:4 → pdo:6 (16-bit), pdo:2.7 → pdo:3.0, sdo:0x6000:1 → sdo:0x6000:2. */
export const ethercatAddressFill: SpreadsheetFillFn = ({ value, row, dir }) => {
  const text = String(value ?? '');
  let m = /^(\s*pdo\s*:\s*)(\d+)(?:\.(\d+))?\s*$/i.exec(text);
  if (m) {
    if (m[3] !== undefined) {
      const next = stepBit(parseInt(m[2], 10), parseInt(m[3], 10), dir, 8);
      return next ? `${m[1]}${next[0]}.${next[1]}` : undefined;
    }
    const bytes = valueTypeBytes(row.valueType);
    if (!bytes) return undefined;
    const next = parseInt(m[2], 10) + dir * bytes;
    return next < 0 ? undefined : `${m[1]}${next}`;
  }
  m = /^(\s*sdo\s*:\s*(?:0x[0-9a-f]+|\d+)\s*:\s*)(0x[0-9a-f]+|\d+)\s*$/i.exec(text);
  if (m) {
    const next = stepRadix(m[2], dir);
    return next === undefined ? undefined : m[1] + next;
  }
  return undefined;
};

// ---- Beckhoff ADS -----------------------------------------------------------------

/** MAIN.fTemp1 → MAIN.fTemp2, MAIN.aLevel[3] → MAIN.aLevel[4],
 *  0x4020:0 → 0x4020:4 (group:offset moves on by the type's bytes). */
export const adsAddressFill: SpreadsheetFillFn = ({ value, row, dir }) => {
  const m = /^(\s*(?:0x[0-9a-f]+|\d+)\s*:\s*)(0x[0-9a-f]+|\d+)\s*$/i.exec(String(value ?? ''));
  if (!m) return fillLastNumber(value, dir);
  const bytes = valueTypeBytes(row.valueType);
  if (!bytes) return undefined;
  const next = stepRadix(m[2], dir * bytes);
  return next === undefined ? undefined : m[1] + next;
};

// ---- EtherNet/IP --------------------------------------------------------------------

/** SLC / MicroLogix data files: N7:0 → N7:1, N7:0{4} → N7:4{4},
 *  B3:0/15 → B3:1/0, B3/17 → B3/18, T4:0.ACC → T4:1.ACC, I:1.0/7 → I:1.0/8.
 *  Logix tags count their last number: Tank[3].Level → Tank[4].Level. */
export function ethernetIpTagFill(isSLC: () => boolean): SpreadsheetFillFn {
  return ({ value, dir }) => {
    if (!isSLC()) return fillLastNumber(value, dir);
    const text = String(value ?? '');
    let m = /^(\s*[A-Z]{1,2}\d{0,3}:)(\d{1,4})(\/(\d{1,2}))?((?:\.[A-Z]+)?)(\{(\d+)\})?\s*$/i.exec(text);
    if (m) {
      if (m[4] !== undefined && !m[5]) {
        const next = stepBit(parseInt(m[2], 10), parseInt(m[4], 10), dir, 16);
        return next ? `${m[1]}${next[0]}/${next[1]}` : undefined;
      }
      const next = parseInt(m[2], 10) + dir * (m[7] ? parseInt(m[7], 10) : 1);
      return next < 0 ? undefined : `${m[1]}${next}${m[3] ?? ''}${m[5]}${m[6] ?? ''}`;
    }
    m = /^(\s*[A-Z]{1,2}\d{0,3}(?::\d{1,3}\.\d{1,3})?\/)(\d{1,4})\s*$/i.exec(text);
    if (m) {
      const next = parseInt(m[2], 10) + dir;
      return next < 0 ? undefined : m[1] + next;
    }
    return undefined;
  };
}

// ---- OPC UA and the other mapping connectors -------------------------------------------

/** ns=2;s=Line1.Temp2 → ns=2;s=Line1.Temp3, ns=3;i=1001 → ns=3;i=1002. Only
 *  the identifier counts, never the namespace; a path or a JSON expression
 *  counts its last number; a constant is copied. */
export const mappingValueFill: SpreadsheetFillFn = ({ value, row, dir }) => {
  if (String(row.type ?? '').toLowerCase() === 'constant' || typeof value !== 'string') return undefined;
  const cut = value.search(/;\s*[sigb]=/i);
  if (cut < 0) return fillLastNumber(value, dir);
  const split = value.indexOf('=', cut) + 1;
  const next = fillLastNumber(value.slice(split), dir);
  return next === undefined ? undefined : value.slice(0, split) + next;
};

// ---- SNMP ---------------------------------------------------------------------------------

/** A table cell counts its instance (…2.2.1.10.1 → …2.2.1.10.2); a scalar,
 *  which always ends in .0, counts the object before it (…1.1.3.0 → …1.1.4.0). */
export const snmpOidFill: SpreadsheetFillFn = ({ value, dir }) => {
  const m = /^(\s*\.?(?:\d+\.)+?)(\d+)(\.0)?\s*$/.exec(String(value ?? ''));
  if (!m) return undefined;
  const n = parseInt(m[2], 10) + dir;
  return n < 0 ? undefined : `${m[1]}${n}${m[3] ?? ''}`;
};

// ---- PROFINET -----------------------------------------------------------------------------

/** Offset moves on by the type's width (string and bytes: their length). A
 *  whole bool row keeps its byte until bit 7, then takes the next byte. */
export function profinetOffsetFill(width: (type: any, length: any) => number): SpreadsheetFillFn {
  return ({ value, row, dir, mode }) => {
    if (row.type === 'bool' && mode === 'row') {
      const bit = Number(row.bit) || 0;
      const rolls = dir > 0 ? bit >= 7 : bit <= 0;
      return rolls ? fillNumber(value, dir) : value;
    }
    const step = width(row.type, row.length);
    return step ? fillNumber(value, dir * step) : undefined;
  };
}

/** 0 … 7, then 0 again. */
export const profinetBitFill: SpreadsheetFillFn = ({ value, row, dir }) => {
  if (row.type !== 'bool' || value === null || value === undefined || value === '') return undefined;
  return (((Number(value) || 0) + dir) % 8 + 8) % 8;
};

// ---- The engine ------------------------------------------------------------------------------

export function applyFillRule(rule: SpreadsheetFillRule | undefined, ctx: SpreadsheetFillContext): any {
  let next: any;
  if (rule === 'series') {
    next = fillTrailingNumber(ctx.value, ctx.dir);
  } else if (rule === 'increment') {
    next = fillNumber(ctx.value, ctx.dir);
  } else if (typeof rule === 'function') {
    next = rule(ctx);
  }
  return next === undefined || next === null ? ctx.value : next;
}

export interface SpreadsheetFillRequest {
  columns: SpreadsheetFillColumn[];
  /** The rows on screen, in order: column values on top of raw form values. */
  rows: Record<string, any>[];
  /** Index of the row the drag started on. */
  from: number;
  /** Index the drag reached; past the last row means new rows. */
  to: number;
  mode: 'row' | 'cell';
  /** The dragged column ('cell' mode). */
  key?: string;
  /** Ctrl held: copy, no counting. */
  plain?: boolean;
}

/**
 * The rows a fill produces, keyed by row index: for every row between `from`
 * (excluded) and `to` the columns to write and their new values. A row past
 * the end of `rows` is a new one and always gets every column.
 */
export function computeFill(req: SpreadsheetFillRequest): Map<number, Record<string, any>> {
  const out = new Map<number, Record<string, any>>();
  const dir: 1 | -1 = req.to >= req.from ? 1 : -1;
  const rows = req.rows.map(r => ({ ...r }));
  for (let r = req.from + dir; dir > 0 ? r <= req.to : r >= req.to; r += dir) {
    if (r < 0) break;
    const ref = rows[r - dir];
    const isNew = r >= rows.length;
    const whole = req.mode === 'row' || isNew;
    const columns = whole ? req.columns : req.columns.filter(c => c.key === req.key);
    const sizing = whole || dir > 0 ? ref : rows[r];
    const patch: Record<string, any> = {};
    for (const col of columns) {
      patch[col.key] = req.plain
        ? ref[col.key]
        : applyFillRule(col.fill, { value: ref[col.key], row: sizing, dir, mode: whole ? 'row' : 'cell' });
    }
    rows[r] = whole ? { ...ref, ...patch } : { ...rows[r], ...patch };
    out.set(r, patch);
  }
  return out;
}
