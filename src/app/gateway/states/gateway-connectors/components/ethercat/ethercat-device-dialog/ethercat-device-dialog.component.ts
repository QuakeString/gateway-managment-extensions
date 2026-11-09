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
  Inject,
  inject,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { createKeysWriteHandler } from '../../../../../shared/components/add-to-write/add-to-write.handler';
import { tagAddressAdapter } from '../../../../../shared/components/add-to-write/write-adapters';
import { FormBuilder, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { DeviceViewSwitchComponent, DeviceDialogView, initialDeviceDialogView } from '../../../../../shared/public-api';
import { DialogComponent, SharedModule } from '@shared/public-api';
import { Store } from '@ngrx/store';
import { AppState } from '@core/public-api';
import { Router } from '@angular/router';
import { DeviceProfileNameAutocompleteComponent, } from '../../../../../shared/public-api';
import { EtherCatDataKey, EtherCatDeviceConfig, EtherCatRpcConfig, EtherCatValueKey } from '../../../models/public-api';
import { EtherCatDataKeysPanelComponent } from '../ethercat-data-keys-panel/ethercat-data-keys-panel.component';
import {
  EtherCatSlaveBrowserDialogComponent,
  EtherCatSlaveBrowserDialogData,
  EtherCatSlaveBrowserResult,
} from '../ethercat-slave-browser-dialog/ethercat-slave-browser-dialog.component';

export interface EtherCatDeviceDialogData {
  device?: EtherCatDeviceConfig;
  isEdit: boolean;
  gatewayDeviceId?: string;
  connectorName?: string;
}

import { DataMappingComponent, DataMappingPanel, DataMappingRow } from '../../../../../shared/public-api';
@Component({
  selector: 'tb-ethercat-device-dialog',
  templateUrl: './ethercat-device-dialog.component.html',
  styleUrls: ['./ethercat-device-dialog.component.scss'],
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
export class EtherCatDeviceDialogComponent extends DialogComponent<EtherCatDeviceDialogComponent, EtherCatDeviceConfig> {

  /** Connection or data mapping: a saved device opens on its data mapping. */
  view: DeviceDialogView = initialDeviceDialogView(!!this.data?.isEdit);

  readonly EtherCatValueKey = EtherCatValueKey;
  isEdit: boolean;
  keysPopupClosed = true;

  deviceForm = this.fb.group({
    deviceName: ['', [Validators.required]],
    deviceType: ['default'],
    slave: [0, [Validators.required, Validators.min(0)]],
    pollPeriod: [1000, [Validators.required, Validators.min(100)]],
    timeseries: [[] as EtherCatDataKey[]],
    attributes: [[] as EtherCatDataKey[]],
    attributeUpdates: [[] as EtherCatDataKey[]],
    rpc: [[] as EtherCatRpcConfig[]],
  });


  private readonly writeDialog = inject(MatDialog);

  constructor(
    protected store: Store<AppState>,
    protected router: Router,
    @Inject(MAT_DIALOG_DATA) public data: EtherCatDeviceDialogData,
    public dialogRef: MatDialogRef<EtherCatDeviceDialogComponent, EtherCatDeviceConfig>,
    private fb: FormBuilder,
    private cdr: ChangeDetectorRef,
    private matDialog: MatDialog,
  ) {
    super(store, router, dialogRef);
    this.isEdit = data.isEdit;
    if (data.device) {
      this.deviceForm.patchValue(data.device as any, { emitEvent: false });
    }
  }

  cancel(): void {
    if (this.keysPopupClosed) {
      this.dialogRef.close(null);
    }
  }

  save(): void {
    if (this.deviceForm.valid) {
      const result = this.deviceForm.value as unknown as EtherCatDeviceConfig;
      this.dialogRef.close(result);
    }
  }

  get canScanBus(): boolean {
    return !!(this.data.gatewayDeviceId && this.data.connectorName);
  }

  scanBus(): void {
    if (!this.canScanBus) {
      return;
    }
    this.matDialog.open<EtherCatSlaveBrowserDialogComponent, EtherCatSlaveBrowserDialogData, EtherCatSlaveBrowserResult>(
      EtherCatSlaveBrowserDialogComponent, {
        data: {
          gatewayDeviceId: this.data.gatewayDeviceId,
          connectorName: this.data.connectorName,
        },
        disableClose: true,
        panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
        autoFocus: false,
        width: '900px',
      }
    ).afterClosed().subscribe(result => {
      if (result && result.position != null) {
        this.deviceForm.get('slave').patchValue(result.position);
        this.deviceForm.get('slave').markAsDirty();
        if (result.name && !this.deviceForm.get('deviceName').value) {
          this.deviceForm.get('deviceName').patchValue(result.name);
          this.deviceForm.get('deviceName').markAsDirty();
        }
        this.cdr.markForCheck();
      }
    });
  }

  /** The data mapping rows: the lists this device maps, in order. */
  readonly mappingRows: DataMappingRow[] = [
    { key: EtherCatValueKey.TIMESERIES, label: 'gateway.gw-timeseries', chip: e => e.tag },
    { key: EtherCatValueKey.ATTRIBUTES, label: 'gateway.attributes', chip: e => e.tag },
    { key: EtherCatValueKey.ATTRIBUTES_UPDATES, label: 'gateway.gw-attribute-updates', chip: e => e.tag },
    { key: EtherCatValueKey.RPC, label: 'gateway.gw-rpc-methods', chip: e => e.method },
  ];

  /** The keys panel a row's edit button opens. */
  readonly keysPanel: DataMappingPanel = {
    component: EtherCatDataKeysPanelComponent,
    context: row => this.keysContext(row.key as EtherCatValueKey),
  };

  private keysContext(keysType: EtherCatValueKey): Record<string, any> {
    const keysControl = this.deviceForm.get(keysType);
    const panelTitles = {
      [EtherCatValueKey.TIMESERIES]: 'gateway.gw-timeseries',
      [EtherCatValueKey.ATTRIBUTES]: 'gateway.attributes',
      [EtherCatValueKey.ATTRIBUTES_UPDATES]: 'gateway.gw-attribute-updates',
      [EtherCatValueKey.RPC]: 'gateway.gw-rpc-methods',
    };
    const ctx = {
      keys: keysControl.value,
      keysType,
      panelTitle: panelTitles[keysType],
      // Standardized: data keys → "Add key"; RPC → "Add method".
      addKeyTitle: keysType === EtherCatValueKey.RPC ? 'gateway.gw-add-method' : 'gateway.gw-add-key',
      deleteKeyTitle: 'gateway.gw-delete-key',
      noKeysText: 'gateway.gw-no-keys-configured-hint',
    };
    if (keysType === EtherCatValueKey.TIMESERIES || keysType === EtherCatValueKey.ATTRIBUTES) {
      (ctx as any).writeHandler = createKeysWriteHandler({
        dialog: this.writeDialog,
        adapter: tagAddressAdapter(),
        controls: {
          rpc: this.deviceForm.get(EtherCatValueKey.RPC),
          attributeUpdates: this.deviceForm.get(EtherCatValueKey.ATTRIBUTES_UPDATES),
        },
        changed: () => this.cdr.markForCheck(),
      });
    }
    return ctx;
  }

}
