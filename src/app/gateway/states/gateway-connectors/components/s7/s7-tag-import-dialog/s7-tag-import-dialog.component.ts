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
import { S7DataKey, S7ValueType } from '../../../models/public-api';
import { ReportStrategyConfig } from '../../../../../shared/models/public-api';
import * as XLSX from 'xlsx';

const S7_ADDRESS_REGEX = /^(DB\d+\.DB[XBWDL]\d+(\.\d+)?|[MIQC]\d+\.\d+|[MIQC][BWDL]\d+)$/i;

const VALUE_TYPE_MAP: Record<string, S7ValueType> = {
  'bool': S7ValueType.BOOL,
  'boolean': S7ValueType.BOOL,
  'binary': S7ValueType.BOOL,
  'uint8': S7ValueType.UINT8,
  'int8': S7ValueType.INT8,
  'uint16': S7ValueType.UINT16,
  'int16': S7ValueType.INT16,
  'uint32': S7ValueType.UINT32,
  'int32': S7ValueType.INT32,
  'float32': S7ValueType.FLOAT32,
  'float': S7ValueType.FLOAT32,
  'float64': S7ValueType.FLOAT64,
  'double': S7ValueType.FLOAT64,
  'string': S7ValueType.STRING,
};

export interface S7TagImportDialogData {
  deviceName: string;
  existingTags: S7DataKey[];
}

export interface S7TagImportResult {
  timeseries: S7DataKey[];
  attributes: S7DataKey[];
}

interface ParsedTag {
  tag: string;
  address: string;
  valueType: S7ValueType | null;
  multiplier: number | null;
  divider: number | null;
  reportStrategy: ReportStrategyConfig | null;
  category: 'timeseries' | 'attributes';
  valid: boolean;
  error: string;
}

@Component({
  selector: 'tb-s7-tag-import-dialog',
  templateUrl: './s7-tag-import-dialog.component.html',
  styleUrls: ['./s7-tag-import-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule, ReactiveFormsModule],
})
export class S7TagImportDialogComponent {

  fileName = '';
  parsedTags: ParsedTag[] = [];
  validTags: ParsedTag[] = [];
  invalidTags: ParsedTag[] = [];
  fileLoaded = false;
  showInvalid = false;

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

  detectedColumns: string[] = [];
  rawRows: Record<string, any>[] = [];

  private existingAddresses: Set<string>;

  constructor(
    private dialogRef: MatDialogRef<S7TagImportDialogComponent>,
    private cd: ChangeDetectorRef,
    private translate: TranslateService,
    @Inject(MAT_DIALOG_DATA) public data: S7TagImportDialogData,
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

  toggleInvalid(): void {
    this.showInvalid = !this.showInvalid;
  }

  importTags(): void {
    const result: S7TagImportResult = {
      timeseries: [],
      attributes: [],
    };

    for (const tag of this.validTags) {
      const key: S7DataKey = {
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
      c === 'tag' || c === 'name' || c === 'tagname' || c === 'tag_name'
    );
    if (tagIdx >= 0) {
      this.tagColumnControl.setValue(this.detectedColumns[tagIdx]);
    }

    // Auto-detect address column
    const addrIdx = cols.findIndex(c =>
      c === 'address' || c === 'addr' || c === 'plc_address' || c === 'plcaddress'
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

      // Category comes straight from the CSV column (timeseries/attributes).
      // When unspecified, default to attributes.
      const rawCat = catCol ? String(row[catCol] || '').trim() : '';

      const tag: ParsedTag = {
        tag: tagName,
        address: rawAddress,
        valueType: this.resolveValueType(rawType),
        multiplier,
        divider,
        reportStrategy,
        category: this.normalizeCategory(rawCat),
        valid: true,
        error: '',
      };

      // Validate
      const errors: string[] = [];
      if (!tagName) {
        errors.push(this.translate.instant('gateway.gw-missing-tag-name'));
      }
      if (!rawAddress) {
        errors.push(this.translate.instant('gateway.gw-missing-address'));
      } else if (!S7_ADDRESS_REGEX.test(rawAddress)) {
        errors.push(this.translate.instant('gateway.s7-invalid-address-prefix', { address: rawAddress }));
      }
      if (rawAddress && this.existingAddresses.has(rawAddress.toLowerCase())) {
        errors.push(this.translate.instant('gateway.gw-dup-address-device'));
      }
      if (rawAddress && seenAddresses.has(rawAddress.toLowerCase())) {
        errors.push(this.translate.instant('gateway.gw-dup-address-file'));
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

  private resolveValueType(raw: string): S7ValueType | null {
    if (!raw) { return null; }
    const lower = raw.toLowerCase().trim();
    if (VALUE_TYPE_MAP[lower]) {
      return VALUE_TYPE_MAP[lower];
    }
    // Try partial matching for common WinCC types
    if (lower.includes('floating') || lower.includes('float') || lower.includes('real')) {
      return S7ValueType.FLOAT32;
    }
    if (lower.includes('binary') || lower.includes('bool')) {
      return S7ValueType.BOOL;
    }
    if (lower.includes('unsigned 32') || lower.includes('dword')) {
      return S7ValueType.UINT32;
    }
    if (lower.includes('unsigned 16') || lower.includes('word')) {
      return S7ValueType.UINT16;
    }
    if (lower.includes('signed 32') || lower.includes('long')) {
      return S7ValueType.INT32;
    }
    if (lower.includes('signed 16') || lower.includes('short')) {
      return S7ValueType.INT16;
    }
    if (lower.includes('string')) {
      return S7ValueType.STRING;
    }
    return null;
  }

  // Resolve the data-key category from the CSV's explicit category value.
  // Only an explicit time-series value maps to timeseries; anything else —
  // including a missing/blank/unknown value — defaults to attributes.
  private normalizeCategory(raw: string): 'timeseries' | 'attributes' {
    const v = raw.toLowerCase().trim();
    if (v === 'timeseries' || v === 'time_series' || v === 'time series' ||
        v === 'ts' || v.startsWith('telem')) {
      return 'timeseries';
    }
    return 'attributes';
  }
}
