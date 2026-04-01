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
///     http://www.apache.org/licenses/LICENSE-2.0
///

import { ChangeDetectionStrategy, Component, forwardRef } from '@angular/core';
import { FormGroup, NG_VALIDATORS, NG_VALUE_ACCESSOR } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { IEC61850BasicConfig } from '../../../models/public-api';
import { GatewayConnectorBasicConfigDirective } from '../../../abstract/public-api';
import { IEC61850DevicesTableComponent } from '../iec61850-devices-table/iec61850-devices-table.component';

@Component({
  selector: 'tb-iec61850-basic-config',
  templateUrl: './iec61850-basic-config.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => IEC61850BasicConfigComponent),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => IEC61850BasicConfigComponent),
      multi: true,
    },
  ],
  standalone: true,
  imports: [CommonModule, SharedModule, IEC61850DevicesTableComponent],
  styleUrls: ['./iec61850-basic-config.component.scss'],
})
export class IEC61850BasicConfigComponent extends GatewayConnectorBasicConfigDirective<IEC61850BasicConfig, IEC61850BasicConfig> {

  isLegacy = false;

  protected getMappedValue(config: IEC61850BasicConfig): IEC61850BasicConfig {
    return config;
  }

  protected initBasicFormGroup(): FormGroup {
    return this.fb.group({
      devices: [[]],
    });
  }

  protected mapConfigToFormValue(config: IEC61850BasicConfig): IEC61850BasicConfig {
    return {
      devices: config?.devices || [],
    };
  }
}
