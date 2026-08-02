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
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { SharedModule } from '@shared/public-api';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { EthernetIPDataKey, EthernetIPDataType, EthernetIPRpcConfig } from '../../../models/public-api';
import * as XLSX from 'xlsx';

export interface EthernetIPTagImportDialogData {
  deviceName: string;
  existingTags: EthernetIPDataKey[];
}

export interface EthernetIPTagImportResult {
  timeseries: EthernetIPDataKey[];
  attributes: EthernetIPDataKey[];
  attributeUpdates: EthernetIPDataKey[];
  rpc: EthernetIPRpcConfig[];
}

type EthernetIPCategory = 'timeseries' | 'attributes' | 'attributeUpdates' | 'rpc';

interface ParsedTag {
  tag: string;
  plcTag: string;
  // RPC methods carry a value type and a read/write operation; both are
  // ignored for data keys (EIP data keys have no per-key value type).
  valueType: EthernetIPDataType | null;
  operation: 'read' | 'write';
  category: EthernetIPCategory;
  valid: boolean;
  error: string;
}

@Component({
  selector: 'tb-ethernet-ip-tag-import-dialog',
  templateUrl: './ethernet-ip-tag-import-dialog.component.html',
  styleUrls: ['./ethernet-ip-tag-import-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule, ReactiveFormsModule],
})
export class EthernetIPTagImportDialogComponent {

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

  tagColumnControl = new FormControl('');
  plcTagColumnControl = new FormControl('');
  categoryColumnControl = new FormControl('');
  valueTypeColumnControl = new FormControl('');
  operationColumnControl = new FormControl('');

  detectedColumns: string[] = [];
  rawRows: Record<string, any>[] = [];

  private existingPlcTags: Set<string>;

  constructor(
    private dialogRef: MatDialogRef<EthernetIPTagImportDialogComponent>,
    private cd: ChangeDetectorRef,
    private translate: TranslateService,
    @Inject(MAT_DIALOG_DATA) public data: EthernetIPTagImportDialogData,
  ) {
    this.existingPlcTags = new Set(
      (data.existingTags || []).map(t => t.plcTag?.toLowerCase())
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
    const result: EthernetIPTagImportResult = {
      timeseries: [],
      attributes: [],
      attributeUpdates: [],
      rpc: [],
    };

    for (const tag of this.validTags) {
      // RPC methods have a different shape (method / plcTag / operation),
      // so build an EthernetIPRpcConfig instead of a data key.
      if (tag.category === 'rpc') {
        const rpc: EthernetIPRpcConfig = {
          method: tag.tag,
          plcTag: tag.plcTag,
          operation: tag.operation,
        };
        if (tag.valueType) {
          rpc.valueType = tag.valueType;
        }
        result.rpc.push(rpc);
        continue;
      }

      const key: EthernetIPDataKey = { tag: tag.tag, plcTag: tag.plcTag };
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

    const tagIdx = cols.findIndex(c =>
      c === 'tag' || c === 'name' || c === 'tagname' || c === 'tag_name'
    );
    if (tagIdx >= 0) { this.tagColumnControl.setValue(this.detectedColumns[tagIdx]); }

    const plcTagIdx = cols.findIndex(c =>
      c === 'plctag' || c === 'plc_tag' || c === 'address' || c === 'plcaddress' || c === 'plc_address'
    );
    if (plcTagIdx >= 0) { this.plcTagColumnControl.setValue(this.detectedColumns[plcTagIdx]); }

    const catIdx = cols.findIndex(c =>
      c === 'category' || c === 'keytype' || c === 'key_type' ||
      c === 'datakeytype' || c === 'tagtype' || c === 'tag_type'
    );
    if (catIdx >= 0) { this.categoryColumnControl.setValue(this.detectedColumns[catIdx]); }

    const typeIdx = cols.findIndex(c =>
      c === 'valuetype' || c === 'value_type' || c === 'datatype' || c === 'data_type' || c === 'type'
    );
    if (typeIdx >= 0) { this.valueTypeColumnControl.setValue(this.detectedColumns[typeIdx]); }

    const opIdx = cols.findIndex(c =>
      c === 'operation' || c === 'rpcoperation' || c === 'rpc_operation' || c === 'direction'
    );
    if (opIdx >= 0) { this.operationColumnControl.setValue(this.detectedColumns[opIdx]); }
  }

  private processRows(): void {
    const tagCol = this.tagColumnControl.value;
    const plcTagCol = this.plcTagColumnControl.value;
    const catCol = this.categoryColumnControl.value;
    const typeCol = this.valueTypeColumnControl.value;
    const opCol = this.operationColumnControl.value;

    if (!tagCol || !plcTagCol) {
      this.parsedTags = [];
      this.validTags = [];
      this.invalidTags = [];
      return;
    }

    const seenPlcTags = new Set<string>();
    this.parsedTags = [];

    for (const row of this.rawRows) {
      const tagName = String(row[tagCol] || '').trim();
      const plcTag = String(row[plcTagCol] || '').trim();

      if (!tagName && !plcTag) { continue; }

      // Category comes straight from the CSV column
      // (timeseries/attributes/attributeUpdates/rpc).
      // When unspecified, default to attributes.
      const rawCat = catCol ? String(row[catCol] || '').trim() : '';
      const rawType = typeCol ? String(row[typeCol] || '').trim() : '';
      const rawOp = opCol ? String(row[opCol] || '').trim() : '';

      const tag: ParsedTag = {
        tag: tagName,
        plcTag,
        valueType: rawType ? (rawType as EthernetIPDataType) : null,
        operation: this.normalizeOperation(rawOp),
        category: this.normalizeCategory(rawCat),
        valid: true,
        error: '',
      };

      const errors: string[] = [];
      if (!tagName) { errors.push(this.translate.instant('gateway.gw-missing-tag-name')); }
      if (!plcTag) { errors.push(this.translate.instant('gateway.gw-missing-plc-tag')); }
      if (plcTag && this.existingPlcTags.has(plcTag.toLowerCase())) {
        if (!this.allowDuplicates) { errors.push(this.translate.instant('gateway.gw-dup-plc-tag-device')); }
      }
      if (plcTag && seenPlcTags.has(plcTag.toLowerCase())) {
        if (!this.allowDuplicates) { errors.push(this.translate.instant('gateway.gw-dup-plc-tag-file')); }
      }

      if (errors.length > 0) {
        tag.valid = false;
        tag.error = errors.join('; ');
      } else {
        seenPlcTags.add(plcTag.toLowerCase());
      }

      this.parsedTags.push(tag);
    }

    this.validTags = this.parsedTags.filter(t => t.valid);
    this.invalidTags = this.parsedTags.filter(t => !t.valid);
  }

  // Resolve the data-key category from the CSV's explicit category value.
  // Recognises all four gateway buckets; anything missing/blank/unknown
  // defaults to attributes (matching the export's category column).
  private normalizeCategory(raw: string): EthernetIPCategory {
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
