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

import { ChangeDetectionStrategy, Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import {
  ModbusOrderChoice,
  ModbusOrderConventions,
  ModbusOrderHelpData,
  ModbusOrderNames,
  orderName,
} from './modbus-order.models';

/**
 * What byte and word order devices usually use — for setting a slave up
 * before the device can be reached, when the Detect button cannot help.
 */
@Component({
  selector: 'tb-modbus-order-help-dialog',
  templateUrl: './modbus-order-help-dialog.component.html',
  styleUrls: ['./modbus-order-dialogs.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule],
})
export class ModbusOrderHelpDialogComponent {

  readonly orders = ModbusOrderNames;
  readonly conventions = ModbusOrderConventions;
  readonly orderName = orderName;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: ModbusOrderHelpData,
    private dialogRef: MatDialogRef<ModbusOrderHelpDialogComponent, ModbusOrderChoice>,
  ) {}

  isCurrent(choice: ModbusOrderChoice): boolean {
    return this.data.current?.byteOrder === choice.byteOrder && this.data.current?.wordOrder === choice.wordOrder;
  }

  use(choice: ModbusOrderChoice): void {
    this.dialogRef.close({ byteOrder: choice.byteOrder, wordOrder: choice.wordOrder });
  }

  close(): void {
    this.dialogRef.close(null);
  }
}
