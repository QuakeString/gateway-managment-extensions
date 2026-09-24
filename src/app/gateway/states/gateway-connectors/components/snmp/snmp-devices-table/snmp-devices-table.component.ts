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
import { SnmpDeviceConfig, SnmpVersion, SnmpVersionTranslationsMap } from '../../../models/public-api';
import { SnmpDeviceDialogComponent, SnmpDeviceDialogData } from '../snmp-device-dialog/snmp-device-dialog.component';

@Component({
  selector: 'tb-snmp-devices-table',
  templateUrl: './snmp-devices-table.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SnmpDevicesTableComponent),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => SnmpDevicesTableComponent),
      multi: true,
    },
  ],
  standalone: true,
  imports: [CommonModule, SharedModule],
})
export class SnmpDevicesTableComponent implements ControlValueAccessor, Validator {

  @Input() gatewayDeviceId: string;
  @Input() connectorName: string;

  readonly displayedColumns = ['deviceName', 'host', 'version', 'tags', 'actions'];
  readonly SnmpVersionTranslationsMap = SnmpVersionTranslationsMap;

  devices: SnmpDeviceConfig[] = [];
  filteredDevices: SnmpDeviceConfig[] = [];
  textSearchMode = false;
  textSearch = new FormControl('');

  @ViewChild('searchInput') searchInputField: ElementRef;

  private dialog = inject(MatDialog);
  private cd = inject(ChangeDetectorRef);
  private dialogService = inject(DialogService);
  private translate = inject(TranslateService);
  private onChange: (value: SnmpDeviceConfig[]) => void;

  writeValue(devices: SnmpDeviceConfig[]): void {
    this.devices = devices || [];
    this.updateFilter();
    this.cd.markForCheck();
  }

  registerOnChange(fn: (value: SnmpDeviceConfig[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(_: () => void): void {}

  validate(): ValidationErrors | null {
    return this.devices.length > 0 ? null : { devices: { valid: false } };
  }

  getTagCount(device: SnmpDeviceConfig): number {
    return (device.attributes?.length || 0)
      + (device.telemetry?.length || 0)
      + (device.attributeUpdateRequests?.length || 0)
      + (device.serverSideRpcRequests?.length || 0);
  }

  getVersionLabel(device: SnmpDeviceConfig): string {
    return SnmpVersionTranslationsMap.get((device.version || SnmpVersion.V2C) as SnmpVersion) ?? device.version;
  }

  getOriginalIndex(device: SnmpDeviceConfig): number {
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
    this.dialog.open<SnmpDeviceDialogComponent, SnmpDeviceDialogData, SnmpDeviceConfig>(
      SnmpDeviceDialogComponent, {
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
    this.dialog.open<SnmpDeviceDialogComponent, SnmpDeviceDialogData, SnmpDeviceConfig>(
      SnmpDeviceDialogComponent, {
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

  private updateFilter(): void {
    const search = (this.textSearch.value || '').toLowerCase().trim();
    if (!search) {
      this.filteredDevices = [...this.devices];
    } else {
      this.filteredDevices = this.devices.filter(d =>
        d.deviceName?.toLowerCase().includes(search) ||
        d.ip?.toLowerCase().includes(search)
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
