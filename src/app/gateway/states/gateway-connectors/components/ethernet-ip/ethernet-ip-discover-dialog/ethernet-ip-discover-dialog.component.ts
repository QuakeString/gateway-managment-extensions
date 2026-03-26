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
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { EthernetIPDeviceConfig, EthernetIPPlcType } from '../../../models/public-api';

export interface DiscoveredDevice {
  ipAddress: string;
  vendor: string;
  productType: string;
  productCode: number;
  revision: string;
  serial: string;
  productName: string;
  state: number;
  status: number;
}

export interface EthernetIPDiscoverDialogData {
  discoveredDevices: DiscoveredDevice[];
}

@Component({
  selector: 'tb-ethernet-ip-discover-dialog',
  templateUrl: './ethernet-ip-discover-dialog.component.html',
  styleUrls: ['./ethernet-ip-discover-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule],
})
export class EthernetIPDiscoverDialogComponent {

  readonly displayedColumns = ['ipAddress', 'productName', 'vendor', 'serial', 'revision', 'actions'];

  devices: DiscoveredDevice[];
  error: string = null;

  constructor(
    private dialogRef: MatDialogRef<EthernetIPDiscoverDialogComponent, EthernetIPDeviceConfig>,
    @Inject(MAT_DIALOG_DATA) private data: EthernetIPDiscoverDialogData,
    private cd: ChangeDetectorRef,
  ) {
    this.devices = data.discoveredDevices || [];
    if (!this.devices.length) {
      this.error = 'No EtherNet/IP devices found on the network.';
    }
  }

  addAsDevice(device: DiscoveredDevice): void {
    const config: EthernetIPDeviceConfig = {
      deviceName: device.productName || `EIP-${device.ipAddress}`,
      deviceType: 'default',
      host: device.ipAddress,
      slot: 0,
      plcType: this.guessPlcType(device),
      initTags: true,
      pollPeriod: 5000,
      connectAttemptCount: 3,
      waitAfterFailedAttemptsMs: 30000,
      timeseries: [],
      attributes: [],
      attributeUpdates: [],
      rpc: [],
    };
    this.dialogRef.close(config);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  private guessPlcType(device: DiscoveredDevice): EthernetIPPlcType {
    const name = (device.productName || '').toLowerCase();
    if (name.includes('compactlogix') || name.includes('compact')) {
      return EthernetIPPlcType.COMPACTLOGIX;
    }
    if (name.includes('micro800') || name.includes('micro 800')) {
      return EthernetIPPlcType.MICRO800;
    }
    if (name.includes('micrologix') || name.includes('micro logix')) {
      return EthernetIPPlcType.MICROLOGIX;
    }
    if (name.includes('slc')) {
      return EthernetIPPlcType.SLC500;
    }
    return EthernetIPPlcType.CONTROLLOGIX;
  }
}
