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
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DialogService } from '@core/public-api';
import { SharedModule } from '@shared/public-api';
import { MatDialog } from '@angular/material/dialog';
import { ProfinetDeviceConfig } from '../../../models/public-api';
import { ProfinetDeviceDialogComponent, ProfinetDeviceDialogData } from '../profinet-device-dialog/profinet-device-dialog.component';

@Component({
  selector: 'tb-profinet-devices-table',
  templateUrl: './profinet-devices-table.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ProfinetDevicesTableComponent),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => ProfinetDevicesTableComponent),
      multi: true,
    },
  ],
  standalone: true,
  imports: [CommonModule, SharedModule],
})
export class ProfinetDevicesTableComponent implements ControlValueAccessor, Validator {

  @Input() gatewayDeviceId: string;
  @Input() connectorName: string;
  readonly displayedColumns = ['deviceName', 'nameOfStation', 'cycle', 'modules', 'outputs', 'actions'];

  devices: ProfinetDeviceConfig[] = [];
  filteredDevices: ProfinetDeviceConfig[] = [];
  textSearchMode = false;
  textSearch = new FormControl('');

  @ViewChild('searchInput') searchInputField: ElementRef;

  private dialog = inject(MatDialog);
  private cd = inject(ChangeDetectorRef);
  private dialogService = inject(DialogService);
  private translate = inject(TranslateService);
  private destroyRef = inject(DestroyRef);
  private onChange: (value: ProfinetDeviceConfig[]) => void;

  constructor() {
    this.textSearch.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.updateFilter();
      this.cd.markForCheck();
    });
  }

  writeValue(devices: ProfinetDeviceConfig[]): void {
    this.devices = devices || [];
    this.updateFilter();
    this.cd.markForCheck();
  }

  registerOnChange(fn: (value: ProfinetDeviceConfig[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(_: () => void): void {}

  validate(): ValidationErrors | null {
    return this.devices.length > 0 ? null : { devices: { valid: false } };
  }

  getModuleCount(device: ProfinetDeviceConfig): number {
    return (device.modules ?? []).filter(m => m.slot !== 0).length;
  }

  getKeyCount(device: ProfinetDeviceConfig): number {
    return (device.timeseries?.length || 0)
      + (device.attributes?.length || 0)
      + (device.attributeUpdates?.length || 0)
      + (device.rpc?.length || 0);
  }

  getOriginalIndex(device: ProfinetDeviceConfig): number {
    return this.devices.indexOf(device);
  }

  enterFilterMode(): void {
    this.textSearchMode = true;
    this.cd.markForCheck();
    setTimeout(() => {
      this.searchInputField?.nativeElement?.focus();
    });
  }

  exitFilterMode(): void {
    this.textSearchMode = false;
    this.textSearch.setValue('');
    this.updateFilter();
    this.cd.markForCheck();
  }

  addDevice(): void {
    this.openDialog(undefined).subscribe(result => {
      if (result) {
        this.devices = [...this.devices, result];
        this.updateFilter();
        this.emitChange();
      }
    });
  }

  editDevice(index: number): void {
    this.openDialog(index).subscribe(result => {
      if (result) {
        this.devices = this.devices.map((d, i) => i === index ? result : d);
        this.updateFilter();
        this.emitChange();
      }
    });
  }

  deleteDevice(index: number): void {
    const device = this.devices[index];
    if (!device) {
      return;
    }
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

  private openDialog(index: number | undefined) {
    const others = this.devices.filter((_, i) => i !== index);
    return this.dialog.open<ProfinetDeviceDialogComponent, ProfinetDeviceDialogData, ProfinetDeviceConfig>(
      ProfinetDeviceDialogComponent, {
        data: {
          device: index === undefined ? undefined : this.devices[index],
          isEdit: index !== undefined,
          otherDevices: others,
          gatewayDeviceId: this.gatewayDeviceId,
          connectorName: this.connectorName,
        },
        disableClose: true,
        panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
        autoFocus: false,
      }
    ).afterClosed().pipe(takeUntilDestroyed(this.destroyRef));
  }

  private updateFilter(): void {
    const search = (this.textSearch.value || '').trim().toLowerCase();
    this.filteredDevices = search
      ? this.devices.filter(d =>
          (d.deviceName || '').toLowerCase().includes(search)
          || (d.nameOfStation || '').toLowerCase().includes(search)
          || (d.ip || '').includes(search))
      : [...this.devices];
  }

  private emitChange(): void {
    this.onChange?.(this.devices);
    this.cd.markForCheck();
  }
}
