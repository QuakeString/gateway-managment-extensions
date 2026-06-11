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
  ChangeDetectionStrategy, ChangeDetectorRef, Component,
  EventEmitter, Input, Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';

export interface PlcInfoData {
  vendor?: string;
  productType?: string;
  productCode?: number;
  revision?: string;
  serial?: string;
  productName?: string;
  keyswitch?: string;
  name?: string;
  time?: string;
  processorType?: string;
  error?: string;
}

export interface ModuleInfoData {
  slot: number;
  vendor?: string;
  productType?: string;
  productCode?: number;
  revision?: string;
  serial?: string;
  productName?: string;
  error?: string;
}

@Component({
  selector: 'tb-ethernet-ip-device-info-panel',
  templateUrl: './ethernet-ip-device-info-panel.component.html',
  styleUrls: ['./ethernet-ip-device-info-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule],
})
export class EthernetIPDeviceInfoPanelComponent {

  @Input() plcInfo: PlcInfoData = null;
  @Input() plcName: string = null;
  @Input() plcTime: string = null;
  @Input() moduleInfoList: ModuleInfoData[] = [];
  @Input() isLogix = true;
  @Input() isSLC = false;
  @Input() loading = false;

  @Output() refreshInfo = new EventEmitter<void>();
  @Output() syncTime = new EventEmitter<void>();
  @Output() queryModule = new EventEmitter<number>();

  moduleSlot = 0;

  onRefresh(): void {
    this.refreshInfo.emit();
  }

  onSyncTime(): void {
    this.syncTime.emit();
  }

  onQueryModule(): void {
    this.queryModule.emit(this.moduleSlot);
  }

  getInfoRows(): Array<{ label: string; value: string }> {
    if (!this.plcInfo) {
      return [];
    }
    const rows: Array<{ label: string; value: string }> = [];
    if (this.plcInfo.productName) { rows.push({ label: 'gateway.eip-product-name', value: this.plcInfo.productName }); }
    if (this.plcInfo.vendor) { rows.push({ label: 'gateway.gw-vendor', value: this.plcInfo.vendor }); }
    if (this.plcInfo.productType) { rows.push({ label: 'gateway.eip-product-type', value: this.plcInfo.productType }); }
    if (this.plcInfo.revision) { rows.push({ label: 'gateway.eip-firmware-revision', value: this.plcInfo.revision }); }
    if (this.plcInfo.serial) { rows.push({ label: 'gateway.eip-serial-number', value: this.plcInfo.serial }); }
    if (this.plcInfo.keyswitch) { rows.push({ label: 'gateway.eip-keyswitch', value: this.plcInfo.keyswitch }); }
    if (this.plcInfo.processorType) { rows.push({ label: 'gateway.eip-processor-type', value: this.plcInfo.processorType }); }
    if (this.plcName) { rows.push({ label: 'gateway.eip-plc-name', value: this.plcName }); }
    if (this.plcTime) { rows.push({ label: 'gateway.eip-plc-time', value: this.plcTime }); }
    return rows;
  }
}
