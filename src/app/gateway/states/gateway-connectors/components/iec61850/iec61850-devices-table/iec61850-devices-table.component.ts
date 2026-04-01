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
///     http://www.apache.org/licenses/LICENSE-2.0
///

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  forwardRef,
} from '@angular/core';
import {
  ControlValueAccessor,
  FormControl,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { IEC61850DeviceConfig } from '../../../models/public-api';
import {
  IEC61850DeviceDialogComponent,
  IEC61850DeviceDialogData,
} from '../iec61850-device-dialog/iec61850-device-dialog.component';

@Component({
  selector: 'tb-iec61850-devices-table',
  templateUrl: './iec61850-devices-table.component.html',
  styleUrls: ['./iec61850-devices-table.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => IEC61850DevicesTableComponent),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => IEC61850DevicesTableComponent),
      multi: true,
    },
  ],
  standalone: true,
  imports: [CommonModule, SharedModule],
})
export class IEC61850DevicesTableComponent implements ControlValueAccessor, Validator {

  devices: IEC61850DeviceConfig[] = [];
  filteredDevices: IEC61850DeviceConfig[] = [];
  displayedColumns = ['deviceName', 'host', 'mode', 'tags', 'actions'];

  searchMode = false;
  searchText = '';

  private onChange: (value: IEC61850DeviceConfig[]) => void;
  private onTouched: () => void;

  constructor(
    private dialog: MatDialog,
    private cd: ChangeDetectorRef,
  ) {}

  writeValue(value: IEC61850DeviceConfig[]): void {
    this.devices = value || [];
    this.filteredDevices = [...this.devices];
    this.cd.markForCheck();
  }

  registerOnChange(fn: (value: IEC61850DeviceConfig[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  validate(): ValidationErrors | null {
    return null;
  }

  addDevice(): void {
    this.openDeviceDialog();
  }

  editDevice(index: number): void {
    const originalIndex = this.getOriginalIndex(index);
    this.openDeviceDialog(this.devices[originalIndex], originalIndex);
  }

  deleteDevice(index: number): void {
    const originalIndex = this.getOriginalIndex(index);
    this.devices.splice(originalIndex, 1);
    this.updateFilter();
    this.emitChange();
  }

  toggleSearch(): void {
    this.searchMode = !this.searchMode;
    if (!this.searchMode) {
      this.searchText = '';
      this.filteredDevices = [...this.devices];
    }
    this.cd.markForCheck();
  }

  onSearchChange(text: string): void {
    this.searchText = text;
    this.updateFilter();
  }

  getTagCount(device: IEC61850DeviceConfig): number {
    return (device.timeseries?.length || 0) +
           (device.attributes?.length || 0) +
           (device.attributeUpdates?.length || 0) +
           (device.rpc?.length || 0);
  }

  private openDeviceDialog(device?: IEC61850DeviceConfig, index?: number): void {
    const dialogData: IEC61850DeviceDialogData = {
      device: device ? { ...device } : undefined,
      isEdit: index !== undefined,
    };
    this.dialog.open(IEC61850DeviceDialogComponent, {
      disableClose: true,
      panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
      data: dialogData,
    }).afterClosed().subscribe((result: IEC61850DeviceConfig | undefined) => {
      if (result) {
        if (index !== undefined) {
          this.devices[index] = result;
        } else {
          this.devices.push(result);
        }
        this.updateFilter();
        this.emitChange();
      }
    });
  }

  private updateFilter(): void {
    if (this.searchText) {
      const search = this.searchText.toLowerCase();
      this.filteredDevices = this.devices.filter(d =>
        d.deviceName?.toLowerCase().includes(search) ||
        d.host?.toLowerCase().includes(search)
      );
    } else {
      this.filteredDevices = [...this.devices];
    }
    this.cd.markForCheck();
  }

  private getOriginalIndex(filteredIndex: number): number {
    const device = this.filteredDevices[filteredIndex];
    return this.devices.indexOf(device);
  }

  private emitChange(): void {
    this.onChange?.(this.devices);
    this.onTouched?.();
  }
}
