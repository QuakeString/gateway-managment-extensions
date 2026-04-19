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
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { SharedModule } from '@shared/public-api';
import * as XLSX from 'xlsx';

/**
 * Result shape returned to the mapping-table: two arrays of tag rows
 * matching OPC-UA's `attributes` and `timeseries` list schemas. The caller
 * appends each array to the corresponding list on the selected mapping.
 */
export interface OpcUaTagImportResult {
  attributes: Array<{ key: string; value: string; type: string }>;
  timeseries: Array<{ key: string; value: string; type: string }>;
}

export interface OpcUaTagImportDialogData {
  mappingName: string;
}

/**
 * One parsed row with the route (attributes/timeseries) we'll send it down.
 * `error` is a short string that gets rendered next to invalid rows so the
 * operator can spot bad CSVs without trial-and-error.
 */
interface ParsedTag {
  key: string;
  value: string;
  type: string;
  section: 'attributes' | 'timeseries';
  valid: boolean;
  error: string;
}

const TYPE_DEFAULT = 'string';

@Component({
  selector: 'tb-opc-ua-tag-import-dialog',
  templateUrl: './opc-ua-tag-import-dialog.component.html',
  styleUrls: ['./opc-ua-tag-import-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule, ReactiveFormsModule],
})
export class OpcUaTagImportDialogComponent {
  fileName = '';
  fileLoaded = false;

  detectedColumns: string[] = [];
  rawRows: Record<string, any>[] = [];
  parsedTags: ParsedTag[] = [];

  /** Column pickers — prefilled by `autoDetectColumns()` after a file loads. */
  keyColumnControl = new FormControl('');
  valueColumnControl = new FormControl('');
  sectionColumnControl = new FormControl('');
  typeColumnControl = new FormControl('');

  /** Fallback section when the CSV has no `section` column. */
  defaultSectionControl = new FormControl<'timeseries' | 'attributes'>('timeseries');

  showInvalid = false;

  constructor(
    private dialogRef: MatDialogRef<OpcUaTagImportDialogComponent, OpcUaTagImportResult | null>,
    private cd: ChangeDetectorRef,
    @Inject(MAT_DIALOG_DATA) public data: OpcUaTagImportDialogData,
  ) {}

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;
    input.value = '';
    this.fileName = file.name;

    const reader = new FileReader();
    reader.onerror = () => {
      this.parsedTags = [];
      this.fileLoaded = true;
      this.cd.markForCheck();
    };
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        this.rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
        this.detectedColumns = this.rawRows.length > 0 ? Object.keys(this.rawRows[0]) : [];
        this.autoDetectColumns();
        this.processRows();
      } catch {
        this.rawRows = [];
        this.detectedColumns = [];
        this.parsedTags = [];
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

  get validTags(): ParsedTag[] {
    return this.parsedTags.filter(t => t.valid);
  }

  get invalidTags(): ParsedTag[] {
    return this.parsedTags.filter(t => !t.valid);
  }

  get validTimeseriesCount(): number {
    return this.validTags.filter(t => t.section === 'timeseries').length;
  }

  get validAttributesCount(): number {
    return this.validTags.filter(t => t.section === 'attributes').length;
  }

  toggleInvalid(): void {
    this.showInvalid = !this.showInvalid;
  }

  importTags(): void {
    const result: OpcUaTagImportResult = { attributes: [], timeseries: [] };
    for (const t of this.validTags) {
      const row = { key: t.key, value: t.value, type: t.type || TYPE_DEFAULT };
      if (t.section === 'attributes') {
        result.attributes.push(row);
      } else {
        result.timeseries.push(row);
      }
    }
    this.dialogRef.close(result);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  /** Pick sensible column names by heuristic so operators don't manually map. */
  private autoDetectColumns(): void {
    const lower = this.detectedColumns.map(c => c.toLowerCase());

    const keyIdx = lower.findIndex(c =>
      c === 'key' || c === 'tag' || c === 'name' || c === 'tagname' || c === 'displayname',
    );
    if (keyIdx >= 0) this.keyColumnControl.setValue(this.detectedColumns[keyIdx]);

    const valueIdx = lower.findIndex(c =>
      c === 'value' || c === 'nodeid' || c === 'node_id' || c === 'path' || c === 'identifier',
    );
    if (valueIdx >= 0) this.valueColumnControl.setValue(this.detectedColumns[valueIdx]);

    const sectionIdx = lower.findIndex(c =>
      c === 'section' || c === 'category' || c === 'kind',
    );
    if (sectionIdx >= 0) this.sectionColumnControl.setValue(this.detectedColumns[sectionIdx]);

    const typeIdx = lower.findIndex(c =>
      c === 'type' || c === 'datatype' || c === 'data_type' || c === 'valuetype',
    );
    if (typeIdx >= 0) this.typeColumnControl.setValue(this.detectedColumns[typeIdx]);
  }

  private processRows(): void {
    const keyCol = this.keyColumnControl.value;
    const valueCol = this.valueColumnControl.value;
    const sectionCol = this.sectionColumnControl.value;
    const typeCol = this.typeColumnControl.value;
    const fallbackSection = this.defaultSectionControl.value ?? 'timeseries';

    if (!keyCol || !valueCol) {
      this.parsedTags = [];
      return;
    }

    this.parsedTags = this.rawRows.map(row => {
      const key = (row[keyCol] ?? '').toString().trim();
      const value = (row[valueCol] ?? '').toString().trim();
      const type = (typeCol ? (row[typeCol] ?? '').toString().trim() : '') || TYPE_DEFAULT;
      const rawSection = sectionCol ? (row[sectionCol] ?? '').toString().trim().toLowerCase() : '';
      let section: 'attributes' | 'timeseries';
      if (rawSection.startsWith('attr')) {
        section = 'attributes';
      } else if (rawSection.startsWith('time') || rawSection.startsWith('telem') || rawSection.startsWith('ts')) {
        section = 'timeseries';
      } else {
        section = fallbackSection;
      }

      let valid = true;
      let error = '';
      if (!key) {
        valid = false;
        error = 'missing key';
      } else if (!value) {
        valid = false;
        error = 'missing value';
      }

      return { key, value, type, section, valid, error };
    });
  }
}
