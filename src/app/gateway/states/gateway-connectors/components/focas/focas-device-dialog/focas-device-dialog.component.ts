///
/// Copyright © 2016-2025 The SENTIENT Authors
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
  Component,
  Inject,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FormBuilder, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { DeviceViewSwitchComponent, DeviceDialogView, initialDeviceDialogView } from '../../../../../shared/public-api';
import { DialogComponent, SharedModule } from '@shared/public-api';
import { Store } from '@ngrx/store';
import { AppState } from '@core/public-api';
import { Router } from '@angular/router';
import { DeviceProfileNameAutocompleteComponent, } from '../../../../../shared/public-api';
import {
  FocasDataKey,
  FocasDeviceConfig,
  FocasRpcConfig,
  FocasValueKey,
  focasOeeAttributes,
  focasOeeTimeseries,
} from '../../../models/public-api';
import { FocasDataKeysPanelComponent } from '../focas-data-keys-panel/focas-data-keys-panel.component';

export interface FocasDeviceDialogData {
  device?: FocasDeviceConfig;
  isEdit: boolean;
  gatewayDeviceId?: string;
  connectorName?: string;
}

import { DataMappingComponent, DataMappingPanel, DataMappingRow } from '../../../../../shared/public-api';
@Component({
  selector: 'tb-focas-device-dialog',
  templateUrl: './focas-device-dialog.component.html',
  styleUrls: ['./focas-device-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    DataMappingComponent,
    DeviceViewSwitchComponent,
    CommonModule,
    SharedModule,
    DeviceProfileNameAutocompleteComponent,
  ],
})
export class FocasDeviceDialogComponent extends DialogComponent<FocasDeviceDialogComponent, FocasDeviceConfig> {

  /** Connection or data mapping: a saved device opens on its data mapping. */
  view: DeviceDialogView = initialDeviceDialogView(!!this.data?.isEdit);

  readonly FocasValueKey = FocasValueKey;
  isEdit: boolean;
  keysPopupClosed = true;

  deviceForm = this.fb.group({
    deviceName: ['', [Validators.required]],
    deviceType: ['default'],
    host: ['', [Validators.required]],
    port: [8193, [Validators.required, Validators.min(1), Validators.max(65535)]],
    timeoutMs: [3000, [Validators.required, Validators.min(100)]],
    pollPeriod: [1000, [Validators.required, Validators.min(100)]],
    maxRequestsPerFrame: [8, [Validators.required, Validators.min(1), Validators.max(32)]],
    connectAttemptCount: [3, [Validators.required, Validators.min(1)]],
    waitAfterFailedAttemptsMs: [10000, [Validators.required]],
    // A new CNC starts with the machine monitoring key set.
    timeseries: [focasOeeTimeseries() as FocasDataKey[]],
    attributes: [focasOeeAttributes() as FocasDataKey[]],
    rpc: [[] as FocasRpcConfig[]],
  });

  constructor(
    protected store: Store<AppState>,
    protected router: Router,
    @Inject(MAT_DIALOG_DATA) public data: FocasDeviceDialogData,
    public dialogRef: MatDialogRef<FocasDeviceDialogComponent, FocasDeviceConfig>,
    private fb: FormBuilder,
  ) {
    super(store, router, dialogRef);
    this.isEdit = data.isEdit;
    if (data.device) {
      // A saved device keeps exactly its own keys: the OEE set is only
      // what a new device starts with.
      this.deviceForm.patchValue(
        { timeseries: [], attributes: [], rpc: [], ...data.device } as any,
        { emitEvent: false },
      );
    }
  }

  cancel(): void {
    if (this.keysPopupClosed) {
      this.dialogRef.close(null);
    }
  }

  save(): void {
    if (this.deviceForm.valid) {
      const result = this.deviceForm.value as unknown as FocasDeviceConfig;
      this.dialogRef.close(result);
    }
  }

  /** The data mapping rows: the lists this device maps, in order. */
  readonly mappingRows: DataMappingRow[] = [
    { key: FocasValueKey.TIMESERIES, label: 'gateway.gw-timeseries', chip: e => e.tag },
    { key: FocasValueKey.ATTRIBUTES, label: 'gateway.attributes', chip: e => e.tag },
    { key: FocasValueKey.RPC, label: 'gateway.gw-rpc-methods', chip: e => e.method },
  ];

  /** The keys panel a row's edit button opens. */
  readonly keysPanel: DataMappingPanel = {
    component: FocasDataKeysPanelComponent,
    context: row => this.keysContext(row.key as FocasValueKey),
  };

  private keysContext(keysType: FocasValueKey): Record<string, any> {
    const keysControl = this.deviceForm.get(keysType);
    const panelTitles = {
      [FocasValueKey.TIMESERIES]: 'gateway.gw-timeseries',
      [FocasValueKey.ATTRIBUTES]: 'gateway.attributes',
      [FocasValueKey.RPC]: 'gateway.gw-rpc-methods',
    };
    const ctx = {
      keys: keysControl.value,
      keysType,
      panelTitle: panelTitles[keysType],
      // Standardized: data keys → "Add key"; RPC → "Add method".
      addKeyTitle: keysType === FocasValueKey.RPC ? 'gateway.gw-add-method' : 'gateway.gw-add-key',
      deleteKeyTitle: 'gateway.gw-delete-key',
      noKeysText: 'gateway.gw-no-keys-configured-hint',
    };
    return ctx;
  }

}
