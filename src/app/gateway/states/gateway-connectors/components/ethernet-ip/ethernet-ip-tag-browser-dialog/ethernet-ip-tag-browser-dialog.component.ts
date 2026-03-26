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

import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FormControl } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { SelectionModel } from '@angular/cdk/collections';
import { EthernetIPDataKey } from '../../../models/public-api';

export interface PlcTagDefinition {
  tagName: string;
  dataType: string;
  tagType: string;
  dim: number;
  dimensions: number[];
  externalAccess: string;
  alias?: boolean;
}

export interface EthernetIPTagBrowserDialogData {
  tags: PlcTagDefinition[];
  targetCategory: 'timeseries' | 'attributes';
  existingTags: string[];
}

export interface EthernetIPTagBrowserResult {
  selectedTags: EthernetIPDataKey[];
  category: 'timeseries' | 'attributes';
}

@Component({
  selector: 'tb-ethernet-ip-tag-browser-dialog',
  templateUrl: './ethernet-ip-tag-browser-dialog.component.html',
  styleUrls: ['./ethernet-ip-tag-browser-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule],
})
export class EthernetIPTagBrowserDialogComponent {

  readonly displayedColumns = ['select', 'tagName', 'dataType', 'tagType', 'dim', 'externalAccess'];
  allTags: PlcTagDefinition[];
  filteredTags: PlcTagDefinition[];
  selection = new SelectionModel<PlcTagDefinition>(true, []);
  textSearch = new FormControl('');
  targetCategory: 'timeseries' | 'attributes';
  existingTagSet: Set<string>;

  loading = false;
  error: string = null;

  constructor(
    private dialogRef: MatDialogRef<EthernetIPTagBrowserDialogComponent, EthernetIPTagBrowserResult>,
    @Inject(MAT_DIALOG_DATA) private data: EthernetIPTagBrowserDialogData,
    private cd: ChangeDetectorRef,
  ) {
    this.allTags = data.tags || [];
    this.filteredTags = [...this.allTags];
    this.targetCategory = data.targetCategory || 'timeseries';
    this.existingTagSet = new Set(data.existingTags || []);

    this.textSearch.valueChanges.subscribe(() => {
      this.applyFilter();
    });
  }

  isAllSelected(): boolean {
    return this.selection.selected.length === this.filteredTags.length && this.filteredTags.length > 0;
  }

  toggleAllRows(): void {
    if (this.isAllSelected()) {
      this.selection.clear();
    } else {
      this.selection.select(...this.filteredTags);
    }
  }

  isExisting(tag: PlcTagDefinition): boolean {
    return this.existingTagSet.has(tag.tagName);
  }

  applyFilter(): void {
    const search = (this.textSearch.value || '').toLowerCase().trim();
    if (!search) {
      this.filteredTags = [...this.allTags];
    } else {
      this.filteredTags = this.allTags.filter(t =>
        t.tagName.toLowerCase().includes(search) ||
        t.dataType.toLowerCase().includes(search) ||
        t.tagType.toLowerCase().includes(search)
      );
    }
    this.cd.markForCheck();
  }

  getDimensionsDisplay(tag: PlcTagDefinition): string {
    if (!tag.dim || tag.dim === 0) {
      return '-';
    }
    return tag.dimensions?.filter(d => d > 0).join(' x ') || String(tag.dim) + 'D';
  }

  addSelected(): void {
    const selectedTags: EthernetIPDataKey[] = this.selection.selected
      .filter(t => !this.isExisting(t))
      .map(t => ({
        tag: this.toTagName(t.tagName),
        plcTag: t.tagName,
      }));

    this.dialogRef.close({
      selectedTags,
      category: this.targetCategory,
    });
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  private toTagName(plcTag: string): string {
    // Convert PLC tag to a clean platform tag name
    // "Program:MainProgram.Temperature" → "Temperature"
    // "MyTag[0]" → "MyTag_0"
    let name = plcTag;
    const dotIdx = name.lastIndexOf('.');
    if (dotIdx >= 0) {
      name = name.substring(dotIdx + 1);
    }
    return name.replace(/[\[\]]/g, '_').replace(/_+$/, '');
  }
}
