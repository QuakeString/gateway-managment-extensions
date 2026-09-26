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

import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FormBuilder, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { DeviceService, DialogService } from '@core/public-api';
import { TranslateService } from '@ngx-translate/core';
import { Observable, take } from 'rxjs';

/** One station as the connector's `profinet_scan` RPC answers it. */
export interface ProfinetStation {
  mac: string;
  nameOfStation: string;
  typeOfStation?: string;
  vendorId?: number;
  deviceId?: number;
  ip?: string;
  netmask?: string;
  gateway?: string;
  ipSet?: boolean;
}

export interface ProfinetScanDialogData {
  gatewayDeviceId: string;
  connectorName: string;
  /** Opened from a device: a station may be picked for it. */
  pick: boolean;
}

/** PROFINET's NameOfStation: DNS labels in lower case, dot-separated. */
const NAME_OF_STATION = /^(?!port-\d{3})[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const IPV4 = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/;

/**
 * The link's stations, as a DCP Identify All finds them through the
 * gateway — TIA's "accessible devices" — and what may be done to one: its
 * LED flashed, and, when the connector's commissioning is enabled, its
 * name of station, its address, or a reset to factory settings. Opened
 * from a device, a station is picked to fill its name, address and
 * identity.
 */
@Component({
  selector: 'tb-profinet-scan-dialog',
  templateUrl: './profinet-scan-dialog.component.html',
  styleUrls: ['./profinet-scan-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule],
})
export class ProfinetScanDialogComponent {

  readonly displayedColumns = ['mac', 'nameOfStation', 'ip', 'type', 'actions'];
  stations: ProfinetStation[] = [];
  selected: ProfinetStation = null;
  loading = false;
  busy = false;
  error: string = null;
  message: string = null;

  readonly nameForm = this.fb.group({
    name: ['', [Validators.required, Validators.pattern(NAME_OF_STATION), Validators.maxLength(240)]],
  });
  readonly ipForm = this.fb.group({
    ip: ['', [Validators.required, Validators.pattern(IPV4)]],
    netmask: ['255.255.255.0', [Validators.required, Validators.pattern(IPV4)]],
    gateway: ['', [Validators.pattern(IPV4)]],
  });

  constructor(
    private dialogRef: MatDialogRef<ProfinetScanDialogComponent, ProfinetStation>,
    @Inject(MAT_DIALOG_DATA) public data: ProfinetScanDialogData,
    private cd: ChangeDetectorRef,
    private fb: FormBuilder,
    private deviceService: DeviceService,
    private dialogService: DialogService,
    private translate: TranslateService,
  ) {
    this.scan();
  }

  /** The connector's answer, flat or wrapped in `result`. */
  private call(method: string, params: object): Observable<any> {
    // Gateway-level RPC, routed by its `profinet_` prefix to this
    // connector (named, should the gateway have several).
    return this.deviceService.sendTwoWayRpcCommand(this.data.gatewayDeviceId, {
      method: `profinet_${method}`,
      params: { connectorName: this.data.connectorName, ...params },
      timeout: 20000,
    });
  }

  private static body(result: any): any {
    return result?.result ?? result ?? {};
  }

  scan(): void {
    this.loading = true;
    this.error = null;
    this.message = null;
    this.cd.markForCheck();
    this.call('scan', { timeoutMs: 2000 }).subscribe({
      next: (result) => {
        const body = ProfinetScanDialogComponent.body(result);
        if (body?.success === false) {
          this.error = body.error || this.translate.instant('gateway.profinet-scan-failed');
        } else {
          const raw = body?.value;
          this.stations = Array.isArray(raw) ? raw : [];
          const mac = this.selected?.mac;
          this.selected = this.stations.find(s => s.mac === mac) ?? null;
        }
        this.loading = false;
        this.cd.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.error = this.translate.instant('gateway.profinet-scan-unreachable');
        this.cd.markForCheck();
      },
    });
  }

  select(station: ProfinetStation): void {
    this.selected = station;
    this.message = null;
    this.error = null;
    this.nameForm.reset({ name: station.nameOfStation ?? '' });
    this.ipForm.reset({
      ip: station.ip ?? '',
      netmask: station.netmask ?? '255.255.255.0',
      gateway: station.gateway && station.gateway !== station.ip ? station.gateway : '',
    });
    this.cd.markForCheck();
  }

  /** A DCP Set to the selected station; a scan after, to show it. */
  private set(method: string, params: object, done: string): void {
    if (!this.selected) {
      return;
    }
    this.busy = true;
    this.error = null;
    this.message = null;
    this.cd.markForCheck();
    this.call(method, { mac: this.selected.mac, ...params }).subscribe({
      next: (result) => {
        const body = ProfinetScanDialogComponent.body(result);
        this.busy = false;
        if (body?.success === false) {
          this.error = body.error || this.translate.instant('gateway.profinet-scan-failed');
          this.cd.markForCheck();
        } else {
          this.message = this.translate.instant(done);
          if (method === 'signal') {
            this.cd.markForCheck();
          } else {
            this.scan();
          }
        }
      },
      error: () => {
        this.busy = false;
        this.error = this.translate.instant('gateway.profinet-scan-unreachable');
        this.cd.markForCheck();
      },
    });
  }

  signal(): void {
    this.set('signal', {}, 'gateway.profinet-signal-sent');
  }

  assignName(): void {
    this.set('setNameOfStation', { name: this.nameForm.value.name.trim() }, 'gateway.profinet-name-assigned');
  }

  assignIp(): void {
    const v = this.ipForm.value;
    const params: any = { ip: v.ip.trim(), netmask: v.netmask.trim() };
    if (v.gateway?.trim()) {
      params.gateway = v.gateway.trim();
    }
    this.set('setIp', params, 'gateway.profinet-ip-assigned');
  }

  resetToFactory(): void {
    this.dialogService.confirm(
      this.translate.instant('gateway.profinet-reset-title', { mac: this.selected?.mac }),
      this.translate.instant('gateway.profinet-reset-description'),
      this.translate.instant('action.no'),
      this.translate.instant('action.yes'),
      true
    ).pipe(take(1)).subscribe((yes) => {
      if (yes) {
        this.set('resetToFactory', {}, 'gateway.profinet-reset-done');
      }
    });
  }

  pick(): void {
    this.dialogRef.close(this.selected);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }
}
