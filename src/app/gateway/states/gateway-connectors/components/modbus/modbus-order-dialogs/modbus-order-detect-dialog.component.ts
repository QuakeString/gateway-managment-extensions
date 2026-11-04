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

import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, OnDestroy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { FormBuilder, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { DeviceService } from '@core/public-api';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import {
  ModbusOrderCandidate,
  ModbusOrderChoice,
  ModbusOrderDetectData,
  ModbusOrderDetectResult,
  ModbusOrderHelpData,
  ModbusOrderValueTypes,
} from './modbus-order.models';
import { ModbusOrderHelpDialogComponent } from './modbus-order-help-dialog.component';

/**
 * Reads one multi-register value through the gateway (`modbus_detectOrder`,
 * read-only: function code 3 or 4) and shows it in all four byte/word
 * orders, with the one that makes sense marked. The operator picks; the
 * dialog hands the choice back to the slave form.
 */
@Component({
  selector: 'tb-modbus-order-detect-dialog',
  templateUrl: './modbus-order-detect-dialog.component.html',
  styleUrls: ['./modbus-order-dialogs.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule],
})
export class ModbusOrderDetectDialogComponent implements OnDestroy {

  readonly valueTypes = ModbusOrderValueTypes;

  readForm = this.fb.group({
    address: [0, [Validators.required, Validators.min(0), Validators.max(65535)]],
    functionCode: [3, [Validators.required]],
    valueType: ['32float', [Validators.required]],
  });

  reading = false;
  error: string = null;
  result: ModbusOrderDetectResult = null;

  private readSub: Subscription;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: ModbusOrderDetectData,
    private dialogRef: MatDialogRef<ModbusOrderDetectDialogComponent, ModbusOrderChoice>,
    private dialog: MatDialog,
    private deviceService: DeviceService,
    private translate: TranslateService,
    private fb: FormBuilder,
    private cd: ChangeDetectorRef,
  ) {}

  ngOnDestroy(): void {
    this.readSub?.unsubscribe();
  }

  read(): void {
    if (this.readForm.invalid || this.reading) {
      return;
    }
    this.readSub?.unsubscribe();
    this.reading = true;
    this.error = null;
    this.result = null;
    this.cd.markForCheck();

    const { address, functionCode, valueType } = this.readForm.value;
    // Sent to the gateway device: the gateway hands `modbus_*` to its Modbus
    // connectors, and `connectorName` makes only this one answer.
    const rpcBody = {
      method: 'modbus_detectOrder',
      params: {
        ...this.data.slave,
        timeout: 5,
        connectorName: this.data.connectorName,
        address: Number(address),
        functionCode: Number(functionCode),
        valueType,
      },
      timeout: 20000,
    };
    this.readSub = this.deviceService.sendTwoWayRpcCommand(this.data.gatewayDeviceId, rpcBody).subscribe({
      next: (response: any) => {
        const body: ModbusOrderDetectResult = response?.result ?? response ?? {};
        this.reading = false;
        if (body.success === false || body['code'] === 404) {
          this.error = this.explain(body.error);
        } else {
          this.result = body;
        }
        this.cd.markForCheck();
      },
      error: () => {
        this.reading = false;
        this.error = this.translate.instant('gateway.modbus-order.gateway-unreachable');
        this.cd.markForCheck();
      },
    });
  }

  use(candidate: ModbusOrderChoice): void {
    this.dialogRef.close({ byteOrder: candidate.byteOrder, wordOrder: candidate.wordOrder });
  }

  isCurrent(candidate: ModbusOrderCandidate): boolean {
    return this.data.current?.byteOrder === candidate.byteOrder && this.data.current?.wordOrder === candidate.wordOrder;
  }

  shown(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NaN';
    }
    return typeof value === 'number' && !Number.isInteger(value) ? Number(value.toPrecision(9)).toString() : String(value);
  }

  openHelp(): void {
    this.dialog.open<ModbusOrderHelpDialogComponent, ModbusOrderHelpData, ModbusOrderChoice>(
      ModbusOrderHelpDialogComponent, {
        disableClose: false,
        panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
        data: { selectable: true, current: this.data.current },
      }).afterClosed().subscribe(choice => {
        if (choice) {
          this.dialogRef.close(choice);
        }
      });
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  /** The gateway's reason, or what its silence means. */
  private explain(error?: string): string {
    if (!error) {
      return this.translate.instant('gateway.modbus-order.read-failed');
    }
    if (error.includes('no running connector')) {
      return this.translate.instant('gateway.modbus-order.connector-not-running');
    }
    return error;
  }
}
