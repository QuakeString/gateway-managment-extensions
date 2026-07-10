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
import { FormGroup, NG_VALIDATORS, NG_VALUE_ACCESSOR, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { EtherCatBasicConfig } from '../../../models/public-api';
import { GatewayConnectorBasicConfigDirective } from '../../../abstract/public-api';
import { EtherCatDevicesTableComponent } from '../ethercat-devices-table/ethercat-devices-table.component';

@Component({
  selector: 'tb-ethercat-legacy-basic-config',
  templateUrl: '../ethercat-basic-config/ethercat-basic-config.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => EtherCatLegacyBasicConfigComponent),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => EtherCatLegacyBasicConfigComponent),
      multi: true,
    },
  ],
  standalone: true,
  imports: [CommonModule, SharedModule, EtherCatDevicesTableComponent],
  styleUrls: ['../ethercat-basic-config/ethercat-basic-config.component.scss'],
})
export class EtherCatLegacyBasicConfigComponent extends GatewayConnectorBasicConfigDirective<EtherCatBasicConfig, EtherCatBasicConfig> {

  isLegacy = true;

  protected getMappedValue(config: EtherCatBasicConfig): EtherCatBasicConfig {
    return config;
  }

  protected initBasicFormGroup(): FormGroup {
    return this.fb.group({
      interface: ['eth1', [Validators.required]],
      cycleTimeUs: [1000, [Validators.required, Validators.min(1)]],
      useDistributedClocks: [false],
      devices: [[]],
    });
  }

  protected mapConfigToFormValue(config: EtherCatBasicConfig): EtherCatBasicConfig {
    return {
      interface: config?.interface ?? 'eth1',
      cycleTimeUs: config?.cycleTimeUs ?? 1000,
      useDistributedClocks: config?.useDistributedClocks ?? false,
      devices: config?.devices || [],
    };
  }
}
