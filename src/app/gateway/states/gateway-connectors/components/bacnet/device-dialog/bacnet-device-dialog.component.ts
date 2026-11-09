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

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Inject,
  } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';

import { AppState } from '@core/public-api';
import { DeviceViewSwitchComponent, DeviceDialogView, initialDeviceDialogView } from '../../../../../shared/public-api';
import { DialogComponent, helpBaseUrl, SharedModule } from '@shared/public-api';

import {
  ConnectorType,
  noLeadTrailSpacesRegex,
  ReportStrategyComponent,
  ReportStrategyDefaultValue,
  TruncateWithTooltipDirective,
} from '../../../../../shared/public-api';
import {
  BacnetDeviceConfig,
  BacnetDeviceConfigInfo,
  BacnetDeviceKey,
  BacnetDeviceKeysAddKeyTranslationsMap,
  BacnetDeviceKeysDeleteKeyTranslationsMap,
  BacnetDeviceKeysNoKeysTextTranslationsMap,
  BacnetDeviceKeysPanelTitleTranslationsMap,
  BacnetDeviceKeysType,
  DeviceInfoType,
  ExpressionType,
} from '../../../models/public-api';
import { DeviceInfoTableComponent } from '../../device-info-table/device-info-table.component';
import { BacnetDeviceDataKeysPanelComponent } from '../device-data-keys-pannel/bacnet-device-data-keys-panel.component';

import { DataMappingComponent, DataMappingPanel, DataMappingRow } from '../../../../../shared/public-api';
@Component({
  selector: 'tb-bacnet-device-dialog',
  templateUrl: './bacnet-device-dialog.component.html',
  styleUrls: ['./bacnet-device-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    DataMappingComponent,
    DeviceViewSwitchComponent,
    CommonModule,
    SharedModule,
    TruncateWithTooltipDirective,
    DeviceInfoTableComponent,
    ReportStrategyComponent,
  ]
})
export class BacnetDeviceDialogComponent extends DialogComponent<BacnetDeviceDialogComponent, BacnetDeviceConfig> {

  /** Connection or data mapping: a saved device opens on its data mapping. */
  view: DeviceDialogView = initialDeviceDialogView(this.data?.buttonTitle === 'action.apply');

  deviceFormGroup = this.fb.group({
    host: ['', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
    port: ['', [Validators.required]],
    networkMask: [''],
    deviceInfo: [],
    altResponsesAddresses: [{ value: [] as string[], disabled: this.data.hideNewFields }],
    pollPeriod: [10000, [Validators.required, Validators.min(0)]],
    timeseries: [[] as BacnetDeviceKey[]],
    attributes: [[] as BacnetDeviceKey[]],
    attributeUpdates: [[] as BacnetDeviceKey[]],
    serverSideRpc: [[] as BacnetDeviceKey[]],
    reportStrategy: [{value: null, disabled: !this.data.withReportStrategy}],
  });
  keysPopupClosed = true;

  readonly BacnetDeviceKeysType = BacnetDeviceKeysType;
  readonly DeviceInfoType = DeviceInfoType;
  readonly deviceHelpLink = helpBaseUrl + '/docs/iot-gateway/config/bacnet/#device-object-settings';
  readonly sourceTypes = Object.values(ExpressionType) as ExpressionType[];
  readonly ConnectorType = ConnectorType;
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;


  constructor(protected store: Store<AppState>,
              protected router: Router,
              @Inject(MAT_DIALOG_DATA) public data: BacnetDeviceConfigInfo,
              public dialogRef: MatDialogRef<BacnetDeviceDialogComponent, BacnetDeviceConfig>,
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
      const { altResponsesAddresses, reportStrategy, ...value } = this.deviceFormGroup.value;
      this.dialogRef.close({
        altResponsesAddresses: altResponsesAddresses ?? [],
        ...(reportStrategy ? { reportStrategy } : {}),
        ...value
      } as BacnetDeviceConfig);
    }
  }

  /** The data mapping rows: the lists this device maps, in order. */
  readonly mappingRows: DataMappingRow[] = [
    { key: BacnetDeviceKeysType.ATTRIBUTES, label: 'gateway.attributes', chip: e => e.key },
    { key: BacnetDeviceKeysType.TIMESERIES, label: 'gateway.timeseries', chip: e => e.key },
    { key: BacnetDeviceKeysType.ATTRIBUTES_UPDATES, label: 'gateway.attribute-updates', chip: e => e.key },
    { key: BacnetDeviceKeysType.RPC_METHODS, label: 'gateway.rpc-methods', chip: e => e.method },
  ];

  /** The keys panel a row's edit button opens. */
  readonly keysPanel: DataMappingPanel = {
    component: BacnetDeviceDataKeysPanelComponent,
    placement: 'leftBottom',
    context: row => this.keysContext(row.key as BacnetDeviceKeysType),
  };

  private keysContext(keysType: BacnetDeviceKeysType): Record<string, any> {
    const keysControl = this.deviceFormGroup.get(keysType);
    const ctx = {
      keys: keysControl.value,
      keysType,
      panelTitle: BacnetDeviceKeysPanelTitleTranslationsMap.get(keysType),
      addKeyTitle: BacnetDeviceKeysAddKeyTranslationsMap.get(keysType),
      deleteKeyTitle: BacnetDeviceKeysDeleteKeyTranslationsMap.get(keysType),
      noKeysText: BacnetDeviceKeysNoKeysTextTranslationsMap.get(keysType),
      withReportStrategy: this.data.withReportStrategy,
    };
    return ctx;
  }

}
