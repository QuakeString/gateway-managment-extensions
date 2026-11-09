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
  } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { AppState, deleteNullProperties } from '@core/public-api';
import { FormBuilder, Validators } from '@angular/forms';
import { DeviceViewSwitchComponent, DeviceDialogView, initialDeviceDialogView } from '../../../../../shared/public-api';
import { DialogComponent, helpBaseUrl, SharedModule } from '@shared/public-api';
import { Router } from '@angular/router';
import {
  DeviceProfileNameAutocompleteComponent,
  noLeadTrailSpacesRegex,
  ReportStrategyComponent,
  ReportStrategyDefaultValue,
  SocketEncoding,
} from '../../../../../shared/public-api';
import {
  DevicesConfigMapping,
  MappingInfo,
  SocketDeviceKeys,
  SocketKeysAddKeyTranslationsMap,
  SocketKeysDeleteKeyTranslationsMap,
  SocketKeysNoKeysTextTranslationsMap,
  SocketKeysPanelTitleTranslationsMap,
  SocketValueKey,
} from '../../../models/public-api';
import { DeviceDataKeysPanelComponent } from '../device-data-keys-pannel/device-data-keys-panel.component';
import { CommonModule } from '@angular/common';

import { DataMappingComponent, DataMappingPanel, DataMappingRow } from '../../../../../shared/public-api';
@Component({
  selector: 'tb-device-dialog',
  templateUrl: './device-dialog.component.html',
  styleUrls: ['./device-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    DataMappingComponent,
    DeviceViewSwitchComponent,
    CommonModule,
    SharedModule,
    ReportStrategyComponent,
    DeviceProfileNameAutocompleteComponent,
  ]
})
export class DeviceDialogComponent extends DialogComponent<DeviceDialogComponent, DevicesConfigMapping> {

  /** Connection or data mapping: a saved device opens on its data mapping. */
  view: DeviceDialogView = initialDeviceDialogView(this.data?.buttonTitle === 'action.apply');

  deviceFormGroup = this.fb.group({
    address: ['', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
    deviceName: ['', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
    deviceType: ['', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
    encoding: [SocketEncoding.UTF8],
    telemetry: [[] as SocketDeviceKeys[]],
    attributes: [[] as SocketDeviceKeys[]],
    attributeRequests: [[] as SocketDeviceKeys[]],
    attributeUpdates: [[] as SocketDeviceKeys[]],
    serverSideRpc: [[] as SocketDeviceKeys[]],
    reportStrategy: [{value: null, disabled: !this.data.withReportStrategy}],
  });
  keysPopupClosed = true;

  readonly SocketValueKey = SocketValueKey;
  readonly socketDeviceHelpLink = helpBaseUrl + '/docs/iot-gateway/config/socket/#device-subsection';
  readonly socketEncoding = Object.values(SocketEncoding);
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;


  constructor(protected store: Store<AppState>,
              protected router: Router,
              @Inject(MAT_DIALOG_DATA) public data: MappingInfo,
              public dialogRef: MatDialogRef<DeviceDialogComponent, DevicesConfigMapping>,
              private fb: FormBuilder,
              private cdr: ChangeDetectorRef,
  ) {
    super(store, router, dialogRef);

    this.deviceFormGroup.patchValue(this.data.value, { emitEvent: false })
  }

  cancel(): void {
    if (this.keysPopupClosed) {
      this.dialogRef.close(null);
    }
  }

  add(): void {
    if (this.deviceFormGroup.valid) {
      const value = this.deviceFormGroup.value;
      deleteNullProperties(value);
      this.dialogRef.close(value as DevicesConfigMapping);
    }
  }

  /** The data mapping rows: the lists this device maps, in order. */
  readonly mappingRows: DataMappingRow[] = [
    { key: SocketValueKey.TIMESERIES, label: 'gateway.timeseries', chip: e => e.key },
    { key: SocketValueKey.ATTRIBUTES, label: 'gateway.attributes', chip: e => e.key },
    { key: SocketValueKey.ATTRIBUTES_REQUESTS, label: 'gateway.attribute-requests', chip: e => e.type },
    { key: SocketValueKey.ATTRIBUTES_UPDATES, label: 'gateway.attribute-updates', chip: e => e.encoding },
    { key: SocketValueKey.RPC_METHODS, label: 'gateway.rpc-methods', chip: e => e.methodRPC },
  ];

  /** The keys panel a row's edit button opens. */
  readonly keysPanel: DataMappingPanel = {
    component: DeviceDataKeysPanelComponent,
    placement: 'leftBottom',
    context: row => this.keysContext(row.key as SocketValueKey),
  };

  private keysContext(keysType: SocketValueKey): Record<string, any> {
    const keysControl = this.deviceFormGroup.get(keysType);
    const ctx = {
      keys: keysControl.value,
      keysType,
      panelTitle: SocketKeysPanelTitleTranslationsMap.get(keysType),
      addKeyTitle: SocketKeysAddKeyTranslationsMap.get(keysType),
      deleteKeyTitle: SocketKeysDeleteKeyTranslationsMap.get(keysType),
      noKeysText: SocketKeysNoKeysTextTranslationsMap.get(keysType),
      withReportStrategy: this.data.withReportStrategy,
    };
    return ctx;
  }

}
