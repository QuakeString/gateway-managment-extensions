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

import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject } from '@angular/core';
import { PageEvent } from '@angular/material/paginator';
import { Sort } from '@angular/material/sort';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { SharedModule } from '@shared/public-api';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AdsDataKey, AdsRpcConfig, AdsValueType } from '../../../models/public-api';
import { ReportStrategyConfig } from '../../../../../shared/models/public-api';
import * as XLSX from 'xlsx';

/** Index-group/offset form: "<ig>:<io>", each decimal or 0x-hex. */
const ADS_INDEXED_ADDRESS_REGEX = /^\s*(0x[0-9a-fA-F]+|\d+)\s*:\s*(0x[0-9a-fA-F]+|\d+)\s*$/;

const VALUE_TYPE_MAP: Record<string, AdsValueType> = {
  'bool': AdsValueType.BOOL,
  'boolean': AdsValueType.BOOL,
  'bit': AdsValueType.BOOL,
  'binary': AdsValueType.BOOL,
  'byte': AdsValueType.UINT8,
  'usint': AdsValueType.UINT8,
  'uint8': AdsValueType.UINT8,
  'sint': AdsValueType.INT8,
  'int8': AdsValueType.INT8,
  'word': AdsValueType.UINT16,
  'uint': AdsValueType.UINT16,
  'uint16': AdsValueType.UINT16,
  'int': AdsValueType.INT16,
  'int16': AdsValueType.INT16,
  'dword': AdsValueType.UINT32,
  'udint': AdsValueType.UINT32,
  'uint32': AdsValueType.UINT32,
  'dint': AdsValueType.INT32,
  'int32': AdsValueType.INT32,
  'lword': AdsValueType.UINT64,
  'ulint': AdsValueType.UINT64,
  'uint64': AdsValueType.UINT64,
  'lint': AdsValueType.INT64,
  'int64': AdsValueType.INT64,
  'real': AdsValueType.FLOAT32,
  'float': AdsValueType.FLOAT32,
  'float32': AdsValueType.FLOAT32,
  'lreal': AdsValueType.FLOAT64,
  'double': AdsValueType.FLOAT64,
  'float64': AdsValueType.FLOAT64,
  'string': AdsValueType.STRING,
  'wstring': AdsValueType.STRING,
};

export interface AdsTagImportDialogData {
  deviceName: string;
  existingTags: AdsDataKey[];
}

export interface AdsTagImportResult {
  timeseries: AdsDataKey[];
  attributes: AdsDataKey[];
  attributeUpdates: AdsDataKey[];
  rpc: AdsRpcConfig[];
}

type AdsCategory = 'timeseries' | 'attributes' | 'attributeUpdates' | 'rpc';

interface ParsedTag {
  tag: string;
  address: string;
  valueType: AdsValueType | null;
  multiplier: number | null;
  divider: number | null;
  reportStrategy: ReportStrategyConfig | null;
  category: AdsCategory;
  // RPC methods carry a read/write operation; ignored for data keys.
  operation: 'read' | 'write';
  valid: boolean;
  error: string;
}

@Component({
  selector: 'tb-ads-tag-import-dialog',
  templateUrl: './ads-tag-import-dialog.component.html',
  styleUrls: ['./ads-tag-import-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule, ReactiveFormsModule],
})
export class AdsTagImportDialogComponent {

  fileName = '';
  parsedTags: ParsedTag[] = [];
  validTags: ParsedTag[] = [];
  invalidTags: ParsedTag[] = [];
  fileLoaded = false;
  showInvalid = false;

  /** Duplicate addresses are skipped by default; the operator can opt to
   *  import them anyway (some projects intentionally map one PLC address
   *  to several platform keys). */
  allowDuplicates = false;

  pageIndex = 0;
  pageSize = 10;

  tagColumnControl = new FormControl('');
  addressColumnControl = new FormControl('');
  typeColumnControl = new FormControl('');
  multiplierColumnControl = new FormControl('');
  dividerColumnControl = new FormControl('');
  reportStrategyTypeColumnControl = new FormControl('');
  reportPeriodColumnControl = new FormControl('');
  categoryColumnControl = new FormControl('');
  operationColumnControl = new FormControl('');

  detectedColumns: string[] = [];
  rawRows: Record<string, any>[] = [];

  private existingAddresses: Set<string>;

  constructor(
    private dialogRef: MatDialogRef<AdsTagImportDialogComponent>,
    private cd: ChangeDetectorRef,
    private translate: TranslateService,
    @Inject(MAT_DIALOG_DATA) public data: AdsTagImportDialogData,
  ) {
    this.existingAddresses = new Set(
      (data.existingTags || []).map(t => t.address?.toLowerCase())
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
        this.parsedTags = [];
        this.validTags = [];
        this.invalidTags = [];
      }
      this.fileLoaded = true;
      this.cd.markForCheck();
    };

    reader.readAsArrayBuffer(file);
  }

  get paginatedValidTags(): ParsedTag[] {
    const start = this.pageIndex * this.pageSize;
    return this.validTags.slice(start, start + this.pageSize);
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
    this.validTags.sort((a, b) => {
      let valA: any;
      let valB: any;
      switch (sort.active) {
        case 'tag': valA = a.tag; valB = b.tag; break;
        case 'address': valA = a.address; valB = b.address; break;
        case 'valueType': valA = a.valueType || ''; valB = b.valueType || ''; break;
        case 'modifier':
          valA = a.multiplier || a.divider || 0;
          valB = b.multiplier || b.divider || 0;
          break;
        case 'reportStrategy':
          valA = a.reportStrategy?.type || '';
          valB = b.reportStrategy?.type || '';
          break;
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

  get validTimeseriesCount(): number {
    return this.validTags.filter(t => t.category === 'timeseries').length;
  }

  get validAttributesCount(): number {
    return this.validTags.filter(t => t.category === 'attributes').length;
  }

  get validAttributeUpdatesCount(): number {
    return this.validTags.filter(t => t.category === 'attributeUpdates').length;
  }

  get validRpcCount(): number {
    return this.validTags.filter(t => t.category === 'rpc').length;
  }

  onAllowDuplicatesChange(): void {
    this.processRows();
    this.cd.markForCheck();
  }

  toggleInvalid(): void {
    this.showInvalid = !this.showInvalid;
  }

  importTags(): void {
    const result: AdsTagImportResult = {
      timeseries: [],
      attributes: [],
      attributeUpdates: [],
      rpc: [],
    };

    for (const tag of this.validTags) {
      // RPC methods have a different shape (method / address / operation),
      // so build an AdsRpcConfig instead of a data key.
      if (tag.category === 'rpc') {
        const rpc: AdsRpcConfig = {
          method: tag.tag,
          address: tag.address,
          operation: tag.operation,
        };
        if (tag.valueType) {
          rpc.valueType = tag.valueType;
        }
        result.rpc.push(rpc);
        continue;
      }

      const key: AdsDataKey = {
        tag: tag.tag,
        address: tag.address,
      };
      if (tag.valueType) {
        key.valueType = tag.valueType;
      }
      if (tag.multiplier != null) {
        key.multiplier = tag.multiplier;
      }
      if (tag.divider != null) {
        key.divider = tag.divider;
      }
      if (tag.reportStrategy) {
        key.reportStrategy = tag.reportStrategy;
      }
      if (tag.category === 'attributes') {
        result.attributes.push(key);
      } else if (tag.category === 'attributeUpdates') {
        result.attributeUpdates.push(key);
      } else {
        result.timeseries.push(key);
      }
    }

    this.dialogRef.close(result);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  private autoDetectColumns(): void {
    const cols = this.detectedColumns.map(c => c.toLowerCase());

    // Auto-detect tag/name column
    const tagIdx = cols.findIndex(c =>
      c === 'tag' || c === 'name' || c === 'tagname' || c === 'tag_name' || c === 'symbol'
    );
    if (tagIdx >= 0) {
      this.tagColumnControl.setValue(this.detectedColumns[tagIdx]);
    }

    // Auto-detect address column
    const addrIdx = cols.findIndex(c =>
      c === 'address' || c === 'addr' || c === 'symbol' || c === 'symbolname' || c === 'symbol_name'
    );
    if (addrIdx >= 0) {
      this.addressColumnControl.setValue(this.detectedColumns[addrIdx]);
    }

    // Auto-detect value type column
    const typeIdx = cols.findIndex(c =>
      c === 'valuetype' || c === 'value_type' || c === 'datatype' || c === 'data_type' || c === 'type'
    );
    if (typeIdx >= 0) {
      this.typeColumnControl.setValue(this.detectedColumns[typeIdx]);
    }

    // Auto-detect multiplier column
    const multIdx = cols.findIndex(c => c === 'multiplier');
    if (multIdx >= 0) {
      this.multiplierColumnControl.setValue(this.detectedColumns[multIdx]);
    }

    // Auto-detect divider column
    const divIdx = cols.findIndex(c => c === 'divider');
    if (divIdx >= 0) {
      this.dividerColumnControl.setValue(this.detectedColumns[divIdx]);
    }

    // Auto-detect report strategy type column
    const rsTypeIdx = cols.findIndex(c =>
      c === 'reportstrategytype' || c === 'report_strategy_type' || c === 'reportstrategy'
    );
    if (rsTypeIdx >= 0) {
      this.reportStrategyTypeColumnControl.setValue(this.detectedColumns[rsTypeIdx]);
    }

    // Auto-detect report period column
    const rpIdx = cols.findIndex(c =>
      c === 'reportperiod' || c === 'report_period'
    );
    if (rpIdx >= 0) {
      this.reportPeriodColumnControl.setValue(this.detectedColumns[rpIdx]);
    }

    // Auto-detect category column (explicit timeseries/attributes per tag)
    const catIdx = cols.findIndex(c =>
      c === 'category' || c === 'keytype' || c === 'key_type' ||
      c === 'datakeytype' || c === 'tagtype' || c === 'tag_type'
    );
    if (catIdx >= 0) {
      this.categoryColumnControl.setValue(this.detectedColumns[catIdx]);
    }

    // Auto-detect operation column (rpc read/write direction)
    const opIdx = cols.findIndex(c =>
      c === 'operation' || c === 'rpcoperation' || c === 'rpc_operation' || c === 'direction'
    );
    if (opIdx >= 0) {
      this.operationColumnControl.setValue(this.detectedColumns[opIdx]);
    }
  }

  private processRows(): void {
    const tagCol = this.tagColumnControl.value;
    const addrCol = this.addressColumnControl.value;
    const typeCol = this.typeColumnControl.value;
    const multCol = this.multiplierColumnControl.value;
    const divCol = this.dividerColumnControl.value;
    const rsTypeCol = this.reportStrategyTypeColumnControl.value;
    const rpCol = this.reportPeriodColumnControl.value;
    const catCol = this.categoryColumnControl.value;
    const opCol = this.operationColumnControl.value;

    if (!tagCol || !addrCol) {
      this.parsedTags = [];
      this.validTags = [];
      this.invalidTags = [];
      return;
    }

    const seenAddresses = new Set<string>();
    this.parsedTags = [];

    for (const row of this.rawRows) {
      const tagName = String(row[tagCol] || '').trim();
      const rawAddress = String(row[addrCol] || '').trim();
      const rawType = typeCol ? String(row[typeCol] || '').trim() : '';

      if (!tagName && !rawAddress) { continue; }

      // Parse modifier fields
      const rawMult = multCol ? String(row[multCol] || '').trim() : '';
      const rawDiv = divCol ? String(row[divCol] || '').trim() : '';
      const multiplier = rawMult && !isNaN(Number(rawMult)) ? Number(rawMult) : null;
      const divider = rawDiv && !isNaN(Number(rawDiv)) ? Number(rawDiv) : null;

      // Parse report strategy fields
      const rawRsType = rsTypeCol ? String(row[rsTypeCol] || '').trim() : '';
      const rawRp = rpCol ? String(row[rpCol] || '').trim() : '';
      let reportStrategy: ReportStrategyConfig | null = null;
      if (rawRsType) {
        reportStrategy = { type: rawRsType as any };
        if (rawRp && !isNaN(Number(rawRp))) {
          reportStrategy.reportPeriod = Number(rawRp);
        }
      }

      // Category comes straight from the CSV column
      // (timeseries/attributes/attributeUpdates/rpc).
      // When unspecified, default to attributes.
      const rawCat = catCol ? String(row[catCol] || '').trim() : '';
      const rawOp = opCol ? String(row[opCol] || '').trim() : '';

      const valueType = this.resolveValueType(rawType);
      const tag: ParsedTag = {
        tag: tagName,
        address: rawAddress,
        valueType,
        multiplier,
        divider,
        reportStrategy,
        category: this.normalizeCategory(rawCat),
        operation: this.normalizeOperation(rawOp),
        valid: true,
        error: '',
      };

      // Validate — ADS address is EITHER a symbol name OR an indexed
      // "<ig>:<io>" pair; the indexed form additionally requires a type.
      const errors: string[] = [];
      if (!tagName) {
        errors.push(this.translate.instant('gateway.gw-missing-tag-name'));
      }
      if (!rawAddress) {
        errors.push(this.translate.instant('gateway.gw-missing-address'));
      } else if (ADS_INDEXED_ADDRESS_REGEX.test(rawAddress) && !valueType) {
        errors.push(this.translate.instant('gateway.ads-value-type-required'));
      }
      if (rawAddress && this.existingAddresses.has(rawAddress.toLowerCase())) {
        if (!this.allowDuplicates) { errors.push(this.translate.instant('gateway.gw-dup-address-device')); }
      }
      if (rawAddress && seenAddresses.has(rawAddress.toLowerCase())) {
        if (!this.allowDuplicates) { errors.push(this.translate.instant('gateway.gw-dup-address-file')); }
      }

      if (errors.length > 0) {
        tag.valid = false;
        tag.error = errors.join('; ');
      } else {
        seenAddresses.add(rawAddress.toLowerCase());
      }

      this.parsedTags.push(tag);
    }

    this.validTags = this.parsedTags.filter(t => t.valid);
    this.invalidTags = this.parsedTags.filter(t => !t.valid);
    this.pageIndex = 0;
  }

  private resolveValueType(raw: string): AdsValueType | null {
    if (!raw) { return null; }
    const lower = raw.toLowerCase().trim();
    if (VALUE_TYPE_MAP[lower]) {
      return VALUE_TYPE_MAP[lower];
    }
    // STRING(80) / WSTRING(255) carry a length suffix.
    if (lower.startsWith('string') || lower.startsWith('wstring')) {
      return AdsValueType.STRING;
    }
    if (lower.includes('lreal') || lower.includes('double')) {
      return AdsValueType.FLOAT64;
    }
    if (lower.includes('real') || lower.includes('float')) {
      return AdsValueType.FLOAT32;
    }
    if (lower.includes('bool') || lower.includes('bit')) {
      return AdsValueType.BOOL;
    }
    return null;
  }

  // Resolve the data-key category from the CSV's explicit category value.
  // Recognises all four gateway buckets; anything missing/blank/unknown
  // defaults to attributes (matching the export's category column).
  private normalizeCategory(raw: string): AdsCategory {
    const v = raw.toLowerCase().trim();
    if (v === 'timeseries' || v === 'time_series' || v === 'time series' ||
        v === 'ts' || v.startsWith('telem')) {
      return 'timeseries';
    }
    if (v === 'rpc' || v.startsWith('rpc')) {
      return 'rpc';
    }
    if (v === 'attributeupdates' || v === 'attribute_updates' || v === 'attribute updates' ||
        v === 'attribute-updates' || v === 'attributeupdate' || v === 'shared') {
      return 'attributeUpdates';
    }
    return 'attributes';
  }

  // RPC operation direction; defaults to the non-mutating 'read' when the
  // CSV omits it (e.g. a hand-authored file or a pre-operation export).
  private normalizeOperation(raw: string): 'read' | 'write' {
    return raw.toLowerCase().trim() === 'write' ? 'write' : 'read';
  }
}
