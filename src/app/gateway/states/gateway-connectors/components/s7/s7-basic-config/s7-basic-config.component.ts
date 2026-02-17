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

import { ChangeDetectionStrategy, Component, forwardRef } from '@angular/core';
import { FormGroup, NG_VALIDATORS, NG_VALUE_ACCESSOR } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { S7BasicConfig } from '../../../models/public-api';
import { GatewayConnectorBasicConfigDirective } from '../../../abstract/public-api';
import { S7DevicesTableComponent } from '../s7-devices-table/s7-devices-table.component';

@Component({
  selector: 'tb-s7-basic-config',
  templateUrl: './s7-basic-config.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => S7BasicConfigComponent),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => S7BasicConfigComponent),
      multi: true,
    },
  ],
  standalone: true,
  imports: [CommonModule, SharedModule, S7DevicesTableComponent],
  styleUrls: ['./s7-basic-config.component.scss'],
})
export class S7BasicConfigComponent extends GatewayConnectorBasicConfigDirective<S7BasicConfig, S7BasicConfig> {

  isLegacy = false;

  protected getMappedValue(config: S7BasicConfig): S7BasicConfig {
    return config;
  }

  protected initBasicFormGroup(): FormGroup {
    return this.fb.group({
      devices: [[]],
    });
  }

  protected mapConfigToFormValue(config: S7BasicConfig): S7BasicConfig {
    return {
      devices: config?.devices || [],
    };
  }
}
