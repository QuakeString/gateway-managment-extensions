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
import { AdsDataKey, AdsDeviceConfig, AdsRpcConfig, AdsValueKey } from '../../../models/public-api';
import { AdsDataKeysPanelComponent } from '../ads-data-keys-panel/ads-data-keys-panel.component';
import {
  AdsTagBrowserDialogComponent,
  AdsTagBrowserDialogData,
  AdsTagBrowserResult,
} from '../ads-tag-browser-dialog/ads-tag-browser-dialog.component';

export interface AdsDeviceDialogData {
  device?: AdsDeviceConfig;
  isEdit: boolean;
  gatewayDeviceId?: string;
  connectorName?: string;
}

import { DataMappingComponent, DataMappingPanel, DataMappingRow } from '../../../../../shared/public-api';
@Component({
  selector: 'tb-ads-device-dialog',
  templateUrl: './ads-device-dialog.component.html',
  styleUrls: ['./ads-device-dialog.component.scss'],
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
export class AdsDeviceDialogComponent extends DialogComponent<AdsDeviceDialogComponent, AdsDeviceConfig> {

  /** Connection or data mapping: a saved device opens on its data mapping. */
  view: DeviceDialogView = initialDeviceDialogView(!!this.data?.isEdit);

  readonly AdsValueKey = AdsValueKey;
  isEdit: boolean;
  keysPopupClosed = true;

  deviceForm = this.fb.group({
    deviceName: ['', [Validators.required]],
    deviceType: ['default'],
    host: ['', [Validators.required]],
    amsNetId: ['', [Validators.required]],
    amsPort: [851, [Validators.required, Validators.min(1), Validators.max(65535)]],
    clientAmsNetId: [''],
    pollPeriod: [1000, [Validators.required, Validators.min(100)]],
    connectAttemptCount: [3, [Validators.required, Validators.min(1)]],
    waitAfterFailedAttemptsMs: [10000, [Validators.required]],
    enableNotifications: [false],
    timeseries: [[] as AdsDataKey[]],
    attributes: [[] as AdsDataKey[]],
    attributeUpdates: [[] as AdsDataKey[]],
    rpc: [[] as AdsRpcConfig[]],
  });


  private readonly writeDialog = inject(MatDialog);

  constructor(
    protected store: Store<AppState>,
    protected router: Router,
    @Inject(MAT_DIALOG_DATA) public data: AdsDeviceDialogData,
    public dialogRef: MatDialogRef<AdsDeviceDialogComponent, AdsDeviceConfig>,
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
      const result = this.deviceForm.value as unknown as AdsDeviceConfig;
      // clientAmsNetId is optional — drop it when blank to keep the JSON clean.
      if (!result.clientAmsNetId) {
        delete result.clientAmsNetId;
      }
      this.dialogRef.close(result);
    }
  }

  get canBrowseSymbols(): boolean {
    return !!(this.data.gatewayDeviceId && this.data.connectorName
              && this.deviceForm.get('deviceName').value);
  }

  openTagBrowser(targetCategory: 'timeseries' | 'attributes'): void {
    if (!this.canBrowseSymbols) {
      return;
    }
    const existingTags: string[] = [
      ...(this.deviceForm.get('timeseries').value || []).map((k: AdsDataKey) => k.address),
      ...(this.deviceForm.get('attributes').value || []).map((k: AdsDataKey) => k.address),
    ];

    this.matDialog.open<AdsTagBrowserDialogComponent, AdsTagBrowserDialogData, AdsTagBrowserResult>(
      AdsTagBrowserDialogComponent, {
        data: {
          gatewayDeviceId: this.data.gatewayDeviceId,
          connectorName: this.data.connectorName,
          deviceName: this.deviceForm.get('deviceName').value,
          targetCategory,
          existingTags,
        },
        disableClose: true,
        panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
        autoFocus: false,
        width: '900px',
      }
    ).afterClosed().subscribe(result => {
      if (result?.selectedTags?.length) {
        const control = this.deviceForm.get(result.category);
        const current: AdsDataKey[] = control.value || [];
        control.patchValue([...current, ...result.selectedTags]);
        control.markAsDirty();
        this.cdr.markForCheck();
      }
    });
  }

  /** The data mapping rows: the lists this device maps, in order. */
  readonly mappingRows: DataMappingRow[] = [
    { key: AdsValueKey.TIMESERIES, label: 'gateway.gw-timeseries', chip: e => e.tag, actions: [{ icon: 'travel_explore', tooltip: 'gateway.ads-browse-symbols', run: () => this.openTagBrowser('timeseries'), disabled: () => !this.canBrowseSymbols }] },
    { key: AdsValueKey.ATTRIBUTES, label: 'gateway.attributes', chip: e => e.tag, actions: [{ icon: 'travel_explore', tooltip: 'gateway.ads-browse-symbols', run: () => this.openTagBrowser('attributes'), disabled: () => !this.canBrowseSymbols }] },
    { key: AdsValueKey.ATTRIBUTES_UPDATES, label: 'gateway.gw-attribute-updates', chip: e => e.tag },
    { key: AdsValueKey.RPC, label: 'gateway.gw-rpc-methods', chip: e => e.method },
  ];

  /** The keys panel a row's edit button opens. */
  readonly keysPanel: DataMappingPanel = {
    component: AdsDataKeysPanelComponent,
    context: row => this.keysContext(row.key as AdsValueKey),
  };

  private keysContext(keysType: AdsValueKey): Record<string, any> {
    const keysControl = this.deviceForm.get(keysType);
    const panelTitles = {
      [AdsValueKey.TIMESERIES]: 'gateway.gw-timeseries',
      [AdsValueKey.ATTRIBUTES]: 'gateway.attributes',
      [AdsValueKey.ATTRIBUTES_UPDATES]: 'gateway.gw-attribute-updates',
      [AdsValueKey.RPC]: 'gateway.gw-rpc-methods',
    };
    const ctx = {
      keys: keysControl.value,
      keysType,
      panelTitle: panelTitles[keysType],
      // Standardized: data keys → "Add key"; RPC → "Add method".
      addKeyTitle: keysType === AdsValueKey.RPC ? 'gateway.gw-add-method' : 'gateway.gw-add-key',
      deleteKeyTitle: 'gateway.gw-delete-key',
      noKeysText: 'gateway.gw-no-keys-configured-hint',
    };
    if (keysType === AdsValueKey.TIMESERIES || keysType === AdsValueKey.ATTRIBUTES) {
      (ctx as any).writeHandler = createKeysWriteHandler({
        dialog: this.writeDialog,
        adapter: tagAddressAdapter(),
        controls: {
          rpc: this.deviceForm.get(AdsValueKey.RPC),
          attributeUpdates: this.deviceForm.get(AdsValueKey.ATTRIBUTES_UPDATES),
        },
        changed: () => this.cdr.markForCheck(),
      });
    }
    return ctx;
  }

}
