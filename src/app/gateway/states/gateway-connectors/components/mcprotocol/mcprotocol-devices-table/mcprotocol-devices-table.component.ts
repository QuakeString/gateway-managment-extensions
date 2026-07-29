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
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  forwardRef,
  inject,
  Input,
  ViewChild,
} from '@angular/core';
import {
  ControlValueAccessor,
  FormControl,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { take } from 'rxjs/operators';
import { DialogService } from '@core/public-api';
import { SharedModule } from '@shared/public-api';
import { MatDialog } from '@angular/material/dialog';
import { McDataKey, McDeviceConfig } from '../../../models/public-api';
import { McProtocolDeviceDialogComponent, McDeviceDialogData } from '../mcprotocol-device-dialog/mcprotocol-device-dialog.component';
import {
  McProtocolTagImportDialogComponent,
  McTagImportDialogData,
  McTagImportResult,
} from '../mcprotocol-tag-import-dialog/mcprotocol-tag-import-dialog.component';

@Component({
  selector: 'tb-mcprotocol-devices-table',
  templateUrl: './mcprotocol-devices-table.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => McProtocolDevicesTableComponent),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => McProtocolDevicesTableComponent),
      multi: true,
    },
  ],
  standalone: true,
  imports: [CommonModule, SharedModule],
})
export class McProtocolDevicesTableComponent implements ControlValueAccessor, Validator {

  @Input() gatewayDeviceId: string;
  @Input() connectorName: string;

  readonly displayedColumns = ['deviceName', 'host', 'tags', 'actions'];

  devices: McDeviceConfig[] = [];
  filteredDevices: McDeviceConfig[] = [];
  textSearchMode = false;
  textSearch = new FormControl('');

  @ViewChild('searchInput') searchInputField: ElementRef;

  private dialog = inject(MatDialog);
  private cd = inject(ChangeDetectorRef);
  private dialogService = inject(DialogService);
  private translate = inject(TranslateService);
  private onChange: (value: McDeviceConfig[]) => void;

  writeValue(devices: McDeviceConfig[]): void {
    this.devices = devices || [];
    this.updateFilter();
    this.cd.markForCheck();
  }

  registerOnChange(fn: (value: McDeviceConfig[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(_: () => void): void {}

  validate(): ValidationErrors | null {
    return this.devices.length > 0 ? null : { devices: { valid: false } };
  }

  getTagCount(device: McDeviceConfig): number {
    return (device.timeseries?.length || 0)
      + (device.attributes?.length || 0)
      + (device.attributeUpdates?.length || 0)
      + (device.rpc?.length || 0);
  }

  getOriginalIndex(device: McDeviceConfig): number {
    return this.devices.indexOf(device);
  }

  enterFilterMode(): void {
    this.textSearchMode = true;
    this.cd.markForCheck();
    setTimeout(() => {
      this.searchInputField?.nativeElement?.focus();
    });
    this.textSearch.valueChanges.subscribe(() => {
      this.updateFilter();
      this.cd.markForCheck();
    });
  }

  exitFilterMode(): void {
    this.textSearchMode = false;
    this.textSearch.setValue('');
    this.updateFilter();
    this.cd.markForCheck();
  }

  addDevice(): void {
    this.dialog.open<McProtocolDeviceDialogComponent, McDeviceDialogData, McDeviceConfig>(
      McProtocolDeviceDialogComponent, {
        data: {
          isEdit: false,
          gatewayDeviceId: this.gatewayDeviceId,
          connectorName: this.connectorName,
        },
        disableClose: true,
        panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
        autoFocus: false,
      }
    ).afterClosed().subscribe(result => {
      if (result) {
        this.devices = [...this.devices, result];
        this.updateFilter();
        this.emitChange();
      }
    });
  }

  editDevice(index: number): void {
    this.dialog.open<McProtocolDeviceDialogComponent, McDeviceDialogData, McDeviceConfig>(
      McProtocolDeviceDialogComponent, {
        data: {
          device: this.devices[index],
          isEdit: true,
          gatewayDeviceId: this.gatewayDeviceId,
          connectorName: this.connectorName,
        },
        disableClose: true,
        panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
        autoFocus: false,
      }
    ).afterClosed().subscribe(result => {
      if (result) {
        this.devices = this.devices.map((d, i) => i === index ? result : d);
        this.updateFilter();
        this.emitChange();
      }
    });
  }

  deleteDevice(index: number): void {
    const device = this.devices[index];
    if (!device) { return; }
    this.dialogService.confirm(
      this.translate.instant('gateway.delete-device-title', { name: device.deviceName }),
      this.translate.instant('gateway.delete-device-description'),
      this.translate.instant('action.no'),
      this.translate.instant('action.yes'),
      true
    ).pipe(take(1)).subscribe((result) => {
      if (result) {
        this.devices = this.devices.filter((_, i) => i !== index);
        this.updateFilter();
        this.emitChange();
      }
    });
  }

  exportTags(index: number): void {
    const device = this.devices[index];
    if (!device) { return; }

    const rows: string[] = ['tag,address,valueType,category,multiplier,divider,reportStrategyType,reportPeriod,operation'];
    const addKeys = (keys: McDataKey[], category: string) => {
      for (const k of (keys || [])) {
        const tag = (k.tag || '').replace(/,/g, ';');
        rows.push([
          tag,
          k.address || '',
          k.valueType || '',
          category,
          k.multiplier ?? '',
          k.divider ?? '',
          k.reportStrategy?.type ?? '',
          k.reportStrategy?.reportPeriod ?? '',
          '',
        ].join(','));
      }
    };
    addKeys(device.timeseries, 'timeseries');
    addKeys(device.attributes, 'attributes');
    addKeys(device.attributeUpdates, 'attributeUpdates');
    // RPC methods have a different shape (method / operation, no tag), so map
    // them explicitly: the method name goes in the tag column and the
    // read/write direction goes in the operation column.
    for (const rpc of (device.rpc || [])) {
      const method = (rpc.method || '').replace(/,/g, ';');
      rows.push([method, rpc.address || '', rpc.valueType || '', 'rpc', '', '', '', '', rpc.operation || ''].join(','));
    }

    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${device.deviceName || 'mcprotocol-device'}-tags.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  importTags(index: number): void {
    const device = this.devices[index];
    if (!device) { return; }

    const existingTags: McDataKey[] = [
      ...(device.timeseries || []),
      ...(device.attributes || []),
      ...(device.attributeUpdates || []),
    ];

    this.dialog.open<McProtocolTagImportDialogComponent, McTagImportDialogData, McTagImportResult>(
      McProtocolTagImportDialogComponent, {
        data: { deviceName: device.deviceName, existingTags },
        disableClose: true,
        panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
        autoFocus: false,
      }
    ).afterClosed().subscribe(result => {
      if (result) {
        const updated = { ...device };
        updated.timeseries = [...(updated.timeseries || []), ...result.timeseries];
        updated.attributes = [...(updated.attributes || []), ...result.attributes];
        updated.attributeUpdates = [...(updated.attributeUpdates || []), ...result.attributeUpdates];
        updated.rpc = [...(updated.rpc || []), ...result.rpc];
        this.devices = this.devices.map((d, i) => i === index ? updated : d);
        this.updateFilter();
        this.emitChange();
      }
    });
  }

  private updateFilter(): void {
    const search = (this.textSearch.value || '').toLowerCase().trim();
    if (!search) {
      this.filteredDevices = [...this.devices];
    } else {
      this.filteredDevices = this.devices.filter(d =>
        d.deviceName?.toLowerCase().includes(search) ||
        d.host?.toLowerCase().includes(search)
      );
    }
  }

  private emitChange(): void {
    this.cd.markForCheck();
    if (this.onChange) {
      this.onChange(this.devices);
    }
  }
}
