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
import { DeviceService } from '@core/public-api';
import { TranslateService } from '@ngx-translate/core';
import { AdsDataKey, AdsValueType } from '../../../models/public-api';

/** One symbol as returned by the connector's `getSymbols` device RPC. */
export interface AdsSymbolDefinition {
  name: string;
  type: string;
  comment?: string;
  indexGroup?: number;
  indexOffset?: number;
}

export interface AdsTagBrowserDialogData {
  gatewayDeviceId: string;
  connectorName: string;
  deviceName: string;
  targetCategory: 'timeseries' | 'attributes';
  /** Addresses already configured on the device — used to disable dup rows. */
  existingTags: string[];
}

export interface AdsTagBrowserResult {
  selectedTags: AdsDataKey[];
  category: 'timeseries' | 'attributes';
}

/** Map a TwinCAT/ADS symbol type name to the closest canonical AdsValueType. */
const ADS_TYPE_MAP: Record<string, AdsValueType> = {
  bool: AdsValueType.BOOL,
  bit: AdsValueType.BOOL,
  byte: AdsValueType.UINT8,
  usint: AdsValueType.UINT8,
  uint8: AdsValueType.UINT8,
  sint: AdsValueType.INT8,
  int8: AdsValueType.INT8,
  word: AdsValueType.UINT16,
  uint: AdsValueType.UINT16,
  uint16: AdsValueType.UINT16,
  int: AdsValueType.INT16,
  int16: AdsValueType.INT16,
  dword: AdsValueType.UINT32,
  udint: AdsValueType.UINT32,
  uint32: AdsValueType.UINT32,
  dint: AdsValueType.INT32,
  int32: AdsValueType.INT32,
  lword: AdsValueType.UINT64,
  ulint: AdsValueType.UINT64,
  uint64: AdsValueType.UINT64,
  lint: AdsValueType.INT64,
  int64: AdsValueType.INT64,
  real: AdsValueType.FLOAT32,
  float: AdsValueType.FLOAT32,
  float32: AdsValueType.FLOAT32,
  lreal: AdsValueType.FLOAT64,
  double: AdsValueType.FLOAT64,
  float64: AdsValueType.FLOAT64,
  string: AdsValueType.STRING,
  wstring: AdsValueType.STRING,
};

@Component({
  selector: 'tb-ads-tag-browser-dialog',
  templateUrl: './ads-tag-browser-dialog.component.html',
  styleUrls: ['./ads-tag-browser-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule],
})
export class AdsTagBrowserDialogComponent {

  readonly displayedColumns = ['select', 'name', 'type', 'comment'];
  allSymbols: AdsSymbolDefinition[] = [];
  filteredSymbols: AdsSymbolDefinition[] = [];
  selection = new SelectionModel<AdsSymbolDefinition>(true, []);
  textSearch = new FormControl('');
  targetCategory: 'timeseries' | 'attributes';
  existingTagSet: Set<string>;

  loading = false;
  error: string = null;

  constructor(
    private dialogRef: MatDialogRef<AdsTagBrowserDialogComponent, AdsTagBrowserResult>,
    @Inject(MAT_DIALOG_DATA) private data: AdsTagBrowserDialogData,
    private cd: ChangeDetectorRef,
    private deviceService: DeviceService,
    private translate: TranslateService,
  ) {
    this.targetCategory = data.targetCategory || 'timeseries';
    this.existingTagSet = new Set(data.existingTags || []);

    this.textSearch.valueChanges.subscribe(() => {
      this.applyFilter();
    });

    this.fetchSymbols();
  }

  fetchSymbols(): void {
    this.loading = true;
    this.error = null;
    this.cd.markForCheck();

    // Sent to the gateway device, so the gateway routes by the connector-type
    // method prefix ("ads_") to the ADS connector's server_side_rpc_handler,
    // with the target device in params.deviceName. Mirrors the TimeSync dialog.
    const rpcBody = {
      method: 'ads_getSymbols',
      params: {
        deviceName: this.data.deviceName || '',
      },
      timeout: 20000,
    };

    this.deviceService.sendTwoWayRpcCommand(this.data.gatewayDeviceId, rpcBody).subscribe({
      next: (result: any) => {
        const body: any = result?.result ?? result ?? {};
        if (body?.success === false) {
          this.error = body.error || this.translate.instant('gateway.ads-symbols-failed');
        } else {
          const symbols: AdsSymbolDefinition[] = Array.isArray(body?.value) ? body.value : [];
          this.allSymbols = symbols;
          this.filteredSymbols = [...symbols];
        }
        this.loading = false;
        this.cd.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.error = this.translate.instant('gateway.ads-symbols-unreachable');
        this.cd.markForCheck();
      },
    });
  }

  isAllSelected(): boolean {
    const selectable = this.filteredSymbols.filter(s => !this.isExisting(s));
    return selectable.length > 0 && selectable.every(s => this.selection.isSelected(s));
  }

  toggleAllRows(): void {
    if (this.isAllSelected()) {
      this.selection.clear();
    } else {
      this.selection.select(...this.filteredSymbols.filter(s => !this.isExisting(s)));
    }
  }

  isExisting(symbol: AdsSymbolDefinition): boolean {
    return this.existingTagSet.has(symbol.name);
  }

  applyFilter(): void {
    const search = (this.textSearch.value || '').toLowerCase().trim();
    if (!search) {
      this.filteredSymbols = [...this.allSymbols];
    } else {
      this.filteredSymbols = this.allSymbols.filter(s =>
        s.name?.toLowerCase().includes(search) ||
        s.type?.toLowerCase().includes(search) ||
        s.comment?.toLowerCase().includes(search)
      );
    }
    this.cd.markForCheck();
  }

  addSelected(): void {
    const selectedTags: AdsDataKey[] = this.selection.selected
      .filter(s => !this.isExisting(s))
      .map(s => {
        const key: AdsDataKey = {
          tag: this.toTagName(s.name),
          address: s.name,
        };
        const valueType = this.mapType(s.type);
        if (valueType) {
          key.valueType = valueType;
        }
        return key;
      });

    this.dialogRef.close({
      selectedTags,
      category: this.targetCategory,
    });
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  private mapType(type: string): AdsValueType | null {
    if (!type) {
      return null;
    }
    const key = type.toLowerCase().trim();
    if (ADS_TYPE_MAP[key]) {
      return ADS_TYPE_MAP[key];
    }
    // STRING(80) / WSTRING(255) etc. carry a length suffix.
    if (key.startsWith('string') || key.startsWith('wstring')) {
      return AdsValueType.STRING;
    }
    return null;
  }

  private toTagName(symbolName: string): string {
    // Derive a clean platform tag from the symbol path.
    // "MAIN.fTemperature" → "fTemperature"; ".globalVar" → "globalVar".
    let name = symbolName || '';
    const dotIdx = name.lastIndexOf('.');
    if (dotIdx >= 0) {
      name = name.substring(dotIdx + 1);
    }
    return name.replace(/[\[\]]/g, '_').replace(/_+$/, '') || symbolName;
  }
}
