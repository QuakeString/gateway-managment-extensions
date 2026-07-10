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
import { DeviceService } from '@core/public-api';
import { TranslateService } from '@ngx-translate/core';

/** One slave as returned by the connector's `ethercat_getSlaves` RPC. */
export interface EtherCatSlaveDefinition {
  position: number;
  name: string;
  vendorId?: number;
  productCode?: number;
  inputBytes?: number;
  outputBytes?: number;
}

export interface EtherCatSlaveBrowserDialogData {
  gatewayDeviceId: string;
  connectorName: string;
}

/** The picked slave — its bus position is written to the device's `slave` field. */
export interface EtherCatSlaveBrowserResult {
  position: number;
  name: string;
}

@Component({
  selector: 'tb-ethercat-slave-browser-dialog',
  templateUrl: './ethercat-slave-browser-dialog.component.html',
  styleUrls: ['./ethercat-slave-browser-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule],
})
export class EtherCatSlaveBrowserDialogComponent {

  readonly displayedColumns = ['position', 'name', 'vendorId', 'productCode', 'io'];
  allSlaves: EtherCatSlaveDefinition[] = [];
  filteredSlaves: EtherCatSlaveDefinition[] = [];
  textSearch = new FormControl('');

  loading = false;
  error: string = null;

  constructor(
    private dialogRef: MatDialogRef<EtherCatSlaveBrowserDialogComponent, EtherCatSlaveBrowserResult>,
    @Inject(MAT_DIALOG_DATA) private data: EtherCatSlaveBrowserDialogData,
    private cd: ChangeDetectorRef,
    private deviceService: DeviceService,
    private translate: TranslateService,
  ) {
    this.textSearch.valueChanges.subscribe(() => {
      this.applyFilter();
    });

    this.fetchSlaves();
  }

  fetchSlaves(): void {
    this.loading = true;
    this.error = null;
    this.cd.markForCheck();

    // Gateway-level RPC — the gateway routes by the "ethercat_" method
    // prefix to the EtherCAT connector, which scans the bus and returns
    // the detected slaves. No per-device param: the whole bus is scanned.
    const rpcBody = {
      method: 'ethercat_getSlaves',
      params: {},
      timeout: 20000,
    };

    this.deviceService.sendTwoWayRpcCommand(this.data.gatewayDeviceId, rpcBody).subscribe({
      next: (result: any) => {
        // Accept both wrapped ({result:{value}}) and flat ({value}) shapes.
        const body: any = result?.result ?? result ?? {};
        if (body?.success === false) {
          this.error = body.error || this.translate.instant('gateway.ethercat-slaves-failed');
        } else {
          const raw = result?.result?.value ?? result?.value;
          const slaves: EtherCatSlaveDefinition[] = Array.isArray(raw) ? raw : [];
          this.allSlaves = slaves;
          this.filteredSlaves = [...slaves];
        }
        this.loading = false;
        this.cd.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.error = this.translate.instant('gateway.ethercat-slaves-unreachable');
        this.cd.markForCheck();
      },
    });
  }

  applyFilter(): void {
    const search = (this.textSearch.value || '').toLowerCase().trim();
    if (!search) {
      this.filteredSlaves = [...this.allSlaves];
    } else {
      this.filteredSlaves = this.allSlaves.filter(s =>
        s.name?.toLowerCase().includes(search) ||
        `${s.position}`.includes(search)
      );
    }
    this.cd.markForCheck();
  }

  select(slave: EtherCatSlaveDefinition): void {
    this.dialogRef.close({ position: slave.position, name: slave.name });
  }

  cancel(): void {
    this.dialogRef.close(null);
  }
}
