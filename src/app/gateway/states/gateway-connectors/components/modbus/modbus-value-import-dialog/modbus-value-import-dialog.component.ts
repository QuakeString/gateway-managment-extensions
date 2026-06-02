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

import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject } from '@angular/core';
import { PageEvent } from '@angular/material/paginator';
import { Sort } from '@angular/material/sort';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { SharedModule } from '@shared/public-api';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ModbusBitTargetType, ModbusScaling, ModbusValue } from '../../../models/public-api';
import {
  ModbusDataType,
  ModbusObjectCountByDataType,
  ReportStrategyConfig,
} from '../../../../../shared/models/public-api';
import * as XLSX from 'xlsx';

/** The four key buckets a Modbus value can land in — same shape the
 *  slave config stores. Import merges into all four based on each row's
 *  `category`. */
type ModbusKeyCategory = 'timeseries' | 'attributes' | 'attributeUpdates' | 'rpc';

/** Accepts both the canonical Modbus enum strings ("16uint", "32float")
 *  and the friendlier aliases operators tend to put in spreadsheets
 *  ("uint16", "float", "word"). */
const TYPE_MAP: Record<string, ModbusDataType> = {
  string: ModbusDataType.STRING,
  bytes: ModbusDataType.BYTES,
  bits: ModbusDataType.BITS, bit: ModbusDataType.BITS, bool: ModbusDataType.BITS, boolean: ModbusDataType.BITS,
  '8int': ModbusDataType.INT8, int8: ModbusDataType.INT8,
  '8uint': ModbusDataType.UINT8, uint8: ModbusDataType.UINT8,
  '16int': ModbusDataType.INT16, int16: ModbusDataType.INT16, short: ModbusDataType.INT16,
  '16uint': ModbusDataType.UINT16, uint16: ModbusDataType.UINT16, word: ModbusDataType.UINT16,
  '16float': ModbusDataType.FLOAT16, float16: ModbusDataType.FLOAT16,
  '32int': ModbusDataType.INT32, int32: ModbusDataType.INT32, long: ModbusDataType.INT32,
  '32uint': ModbusDataType.UINT32, uint32: ModbusDataType.UINT32, dword: ModbusDataType.UINT32,
  '32float': ModbusDataType.FLOAT32, float32: ModbusDataType.FLOAT32, float: ModbusDataType.FLOAT32, real: ModbusDataType.FLOAT32,
  '64int': ModbusDataType.INT64, int64: ModbusDataType.INT64,
  '64uint': ModbusDataType.UINT64, uint64: ModbusDataType.UINT64,
  '64float': ModbusDataType.FLOAT64, float64: ModbusDataType.FLOAT64, double: ModbusDataType.FLOAT64,
};

const VALID_CATEGORIES: ModbusKeyCategory[] = ['timeseries', 'attributes', 'attributeUpdates', 'rpc'];

export interface ModbusValueImportDialogData {
  deviceName: string;
  existingValues: ModbusValue[];
}

export interface ModbusValueImportResult {
  timeseries: ModbusValue[];
  attributes: ModbusValue[];
  attributeUpdates: ModbusValue[];
  rpc: ModbusValue[];
}

interface ParsedValue {
  tag: string;
  address: number | null;
  type: ModbusDataType;
  functionCode: number;
  objectsCount: number;
  multiplier: number | null;
  divider: number | null;
  adder: number | null;
  subtractor: number | null;
  scaling: ModbusScaling | null;
  reportStrategy: ReportStrategyConfig | null;
  bit: number | null;
  bitTargetType: ModbusBitTargetType | null;
  category: ModbusKeyCategory;
  rawAddress: string;
  valid: boolean;
  error: string;
}

@Component({
  selector: 'tb-modbus-value-import-dialog',
  templateUrl: './modbus-value-import-dialog.component.html',
  styleUrls: ['./modbus-value-import-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule, ReactiveFormsModule],
})
export class ModbusValueImportDialogComponent {

  fileName = '';
  parsedValues: ParsedValue[] = [];
  validValues: ParsedValue[] = [];
  invalidValues: ParsedValue[] = [];
  fileLoaded = false;
  showInvalid = false;

  pageIndex = 0;
  pageSize = 10;

  tagColumnControl = new FormControl('');
  addressColumnControl = new FormControl('');
  typeColumnControl = new FormControl('');
  functionCodeColumnControl = new FormControl('');
  objectsCountColumnControl = new FormControl('');
  multiplierColumnControl = new FormControl('');
  dividerColumnControl = new FormControl('');
  adderColumnControl = new FormControl('');
  subtractorColumnControl = new FormControl('');
  reportStrategyTypeColumnControl = new FormControl('');
  reportPeriodColumnControl = new FormControl('');
  categoryColumnControl = new FormControl('');

  detectedColumns: string[] = [];
  rawRows: Record<string, any>[] = [];

  /** key = `${functionCode}:${address}` of every value already on the slave. */
  private existingKeys: Set<string>;

  constructor(
    private dialogRef: MatDialogRef<ModbusValueImportDialogComponent>,
    private cd: ChangeDetectorRef,
    @Inject(MAT_DIALOG_DATA) public data: ModbusValueImportDialogData,
  ) {
    this.existingKeys = new Set(
      (data.existingValues || []).map(v => `${v.functionCode ?? ''}:${v.address}`)
    );
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) { return; }

    this.fileName = file.name;
    const reader = new FileReader();

    reader.onload = (e: ProgressEvent<FileReader>) => {
      try {
        const data = new Uint8Array(e.target.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        this.rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });

        if (this.rawRows.length > 0) {
          this.detectedColumns = Object.keys(this.rawRows[0]);
          this.autoDetectColumns();
          this.processRows();
        }
      } catch {
        this.parsedValues = [];
        this.validValues = [];
        this.invalidValues = [];
      }
      this.fileLoaded = true;
      this.cd.markForCheck();
    };

    reader.readAsArrayBuffer(file);
  }

  get paginatedValidValues(): ParsedValue[] {
    const start = this.pageIndex * this.pageSize;
    return this.validValues.slice(start, start + this.pageSize);
  }

  onPageChange(event: PageEvent): void {
    this.pageIndex = event.pageIndex;
    this.pageSize = event.pageSize;
    this.cd.markForCheck();
  }

  onSortChange(sort: Sort): void {
    if (!sort.active || sort.direction === '') {
      return;
    }
    const dir = sort.direction === 'asc' ? 1 : -1;
    this.validValues.sort((a, b) => {
      let valA: any;
      let valB: any;
      switch (sort.active) {
        case 'tag': valA = a.tag; valB = b.tag; break;
        case 'address': valA = a.address ?? 0; valB = b.address ?? 0; break;
        case 'type': valA = a.type; valB = b.type; break;
        case 'functionCode': valA = a.functionCode; valB = b.functionCode; break;
        case 'category': valA = a.category; valB = b.category; break;
        default: return 0;
      }
      if (typeof valA === 'string') {
        return valA.localeCompare(valB) * dir;
      }
      return (valA - valB) * dir;
    });
    this.pageIndex = 0;
    this.cd.markForCheck();
  }

  reprocess(): void {
    this.processRows();
    this.cd.markForCheck();
  }

  countFor(category: ModbusKeyCategory): number {
    return this.validValues.filter(v => v.category === category).length;
  }

  toggleInvalid(): void {
    this.showInvalid = !this.showInvalid;
  }

  importValues(): void {
    const result: ModbusValueImportResult = {
      timeseries: [],
      attributes: [],
      attributeUpdates: [],
      rpc: [],
    };

    for (const v of this.validValues) {
      const key: ModbusValue = {
        tag: v.tag,
        type: v.type,
        address: v.address as number,
        objectsCount: v.objectsCount,
        functionCode: v.functionCode,
      };
      if (v.multiplier != null) { key.multiplier = v.multiplier; }
      if (v.divider != null) { key.divider = v.divider; }
      if (v.adder != null) { key.adder = v.adder; }
      if (v.subtractor != null) { key.subtractor = v.subtractor; }
      if (v.scaling) { key.scaling = v.scaling; }
      if (v.reportStrategy) { key.reportStrategy = v.reportStrategy; }
      if (v.type === ModbusDataType.BITS && v.bit != null) {
        key.bit = v.bit;
        key.bitTargetType = v.bitTargetType ?? ModbusBitTargetType.IntegerType;
      }
      result[v.category].push(key);
    }

    this.dialogRef.close(result);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  private autoDetectColumns(): void {
    const cols = this.detectedColumns.map(c => c.toLowerCase());
    const pick = (control: FormControl, matches: string[]): void => {
      const idx = cols.findIndex(c => matches.includes(c));
      if (idx >= 0) { control.setValue(this.detectedColumns[idx]); }
    };
    pick(this.tagColumnControl, ['tag', 'name', 'tagname', 'tag_name', 'key']);
    pick(this.addressColumnControl, ['address', 'addr', 'register', 'reg']);
    pick(this.typeColumnControl, ['type', 'datatype', 'data_type', 'valuetype', 'value_type']);
    pick(this.functionCodeColumnControl, ['functioncode', 'function_code', 'fc', 'func', 'funccode']);
    pick(this.objectsCountColumnControl, ['objectscount', 'objects_count', 'objcount', 'count', 'registers']);
    pick(this.multiplierColumnControl, ['multiplier', 'mult']);
    pick(this.dividerColumnControl, ['divider', 'div']);
    pick(this.adderColumnControl, ['adder', 'add', 'offset']);
    pick(this.subtractorColumnControl, ['subtractor', 'sub']);
    pick(this.reportStrategyTypeColumnControl, ['reportstrategytype', 'report_strategy_type', 'reportstrategy']);
    pick(this.reportPeriodColumnControl, ['reportperiod', 'report_period']);
    pick(this.categoryColumnControl, ['category', 'section', 'bucket']);
  }

  private processRows(): void {
    const tagCol = this.tagColumnControl.value;
    const addrCol = this.addressColumnControl.value;
    const typeCol = this.typeColumnControl.value;
    const fcCol = this.functionCodeColumnControl.value;
    const ocCol = this.objectsCountColumnControl.value;
    const multCol = this.multiplierColumnControl.value;
    const divCol = this.dividerColumnControl.value;
    const addCol = this.adderColumnControl.value;
    const subCol = this.subtractorColumnControl.value;
    const rsTypeCol = this.reportStrategyTypeColumnControl.value;
    const rpCol = this.reportPeriodColumnControl.value;
    const catCol = this.categoryColumnControl.value;

    if (!tagCol || !addrCol) {
      this.parsedValues = [];
      this.validValues = [];
      this.invalidValues = [];
      return;
    }

    const seen = new Set<string>();
    this.parsedValues = [];

    const num = (col: string | null, row: Record<string, any>): number | null => {
      if (!col) { return null; }
      const raw = String(row[col] ?? '').trim();
      return raw !== '' && !isNaN(Number(raw)) ? Number(raw) : null;
    };

    for (const row of this.rawRows) {
      const tagName = String(row[tagCol] ?? '').trim();
      const rawAddress = String(row[addrCol] ?? '').trim();
      if (!tagName && !rawAddress) { continue; }

      const category = this.resolveCategory(catCol ? String(row[catCol] ?? '').trim() : '', tagName);
      const type = this.resolveType(typeCol ? String(row[typeCol] ?? '').trim() : '');

      const address = rawAddress !== '' && /^-?\d+$/.test(rawAddress) ? Number(rawAddress) : null;

      const fcFromFile = num(fcCol, row);
      const functionCode = fcFromFile ?? this.defaultFunctionCode(type, category);

      const ocFromFile = num(ocCol, row);
      const objectsCount = ocFromFile ?? (ModbusObjectCountByDataType[type] ?? 1);

      const scaling = this.resolveScaling(row);

      const rawRsType = rsTypeCol ? String(row[rsTypeCol] ?? '').trim() : '';
      let reportStrategy: ReportStrategyConfig | null = null;
      if (rawRsType) {
        reportStrategy = { type: rawRsType as any };
        const rp = num(rpCol, row);
        if (rp != null) { reportStrategy.reportPeriod = rp; }
      }

      const parsed: ParsedValue = {
        tag: tagName,
        address,
        type,
        functionCode,
        objectsCount,
        multiplier: num(multCol, row),
        divider: num(divCol, row),
        adder: num(addCol, row),
        subtractor: num(subCol, row),
        scaling,
        reportStrategy,
        bit: null,
        bitTargetType: null,
        category,
        rawAddress,
        valid: true,
        error: '',
      };

      const errors: string[] = [];
      if (!tagName) { errors.push('Missing tag name'); }
      if (rawAddress === '') {
        errors.push('Missing address');
      } else if (address === null || address < 0 || address > 65535) {
        errors.push(`Invalid Modbus address: ${rawAddress} (expected 0–65535)`);
      }
      const dedupeKey = `${functionCode}:${address}`;
      if (address !== null && this.existingKeys.has(dedupeKey)) {
        errors.push('Duplicate: address already exists on slave');
      }
      if (address !== null && seen.has(dedupeKey)) {
        errors.push('Duplicate: address repeated in file');
      }

      if (errors.length > 0) {
        parsed.valid = false;
        parsed.error = errors.join('; ');
      } else {
        seen.add(dedupeKey);
      }

      this.parsedValues.push(parsed);
    }

    this.validValues = this.parsedValues.filter(v => v.valid);
    this.invalidValues = this.parsedValues.filter(v => !v.valid);
    this.pageIndex = 0;
  }

  private resolveType(raw: string): ModbusDataType {
    const lower = raw.toLowerCase().trim();
    if (TYPE_MAP[lower]) { return TYPE_MAP[lower]; }
    if (lower.includes('float') || lower.includes('real')) { return ModbusDataType.FLOAT32; }
    if (lower.includes('bool') || lower.includes('bit')) { return ModbusDataType.BITS; }
    if (lower.includes('dword') || lower.includes('unsigned 32')) { return ModbusDataType.UINT32; }
    if (lower.includes('word') || lower.includes('unsigned 16')) { return ModbusDataType.UINT16; }
    if (lower.includes('long') || lower.includes('signed 32')) { return ModbusDataType.INT32; }
    if (lower.includes('string')) { return ModbusDataType.STRING; }
    // Default to a common 16-bit register when the type can't be resolved.
    return ModbusDataType.UINT16;
  }

  private resolveCategory(raw: string, tagName: string): ModbusKeyCategory {
    const lower = raw.toLowerCase().trim();
    const direct = VALID_CATEGORIES.find(c => c.toLowerCase() === lower);
    if (direct) { return direct; }
    if (lower === 'attribute') { return 'attributes'; }
    if (lower === 'attributeupdate' || lower === 'attribute_update' || lower === 'attribute_updates') {
      return 'attributeUpdates';
    }
    // No usable category column → classify read keys by tag-name heuristic
    // (set-points / deadbands lean to attributes, everything else telemetry).
    const n = tagName.toLowerCase();
    if (/_sp$/i.test(n) || /_sp_/i.test(n) || /set/i.test(n) || /deadband/i.test(n)) {
      return 'attributes';
    }
    return 'timeseries';
  }

  /** Read keys (timeseries / attributes / rpc) default to FC3 (FC1 for
   *  bits); write keys (attributeUpdates) default to FC6 (FC5 for bits).
   *  Mirrors the data-keys panel defaults. */
  private defaultFunctionCode(type: ModbusDataType, category: ModbusKeyCategory): number {
    const isWrite = category === 'attributeUpdates';
    if (type === ModbusDataType.BITS) { return isWrite ? 5 : 1; }
    return isWrite ? 6 : 3;
  }

  private resolveScaling(row: Record<string, any>): ModbusScaling | null {
    const get = (keys: string[]): number | null => {
      for (const k of keys) {
        const col = this.detectedColumns.find(c => c.toLowerCase() === k);
        if (col) {
          const raw = String(row[col] ?? '').trim();
          if (raw !== '' && !isNaN(Number(raw))) { return Number(raw); }
        }
      }
      return null;
    };
    const rawMin = get(['scalingrawmin', 'scaling_raw_min', 'rawmin', 'raw_min']);
    const rawMax = get(['scalingrawmax', 'scaling_raw_max', 'rawmax', 'raw_max']);
    const engMin = get(['scalingengmin', 'scaling_eng_min', 'engmin', 'eng_min']);
    const engMax = get(['scalingengmax', 'scaling_eng_max', 'engmax', 'eng_max']);
    if (rawMin == null && rawMax == null && engMin == null && engMax == null) {
      return null;
    }
    return { rawMin: rawMin ?? 0, rawMax: rawMax ?? 0, engMin: engMin ?? 0, engMax: engMax ?? 0 };
  }
}
