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
import { NG_VALIDATORS, NG_VALUE_ACCESSOR } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { SnmpDevicesTableComponent } from '../snmp-devices-table/snmp-devices-table.component';
import { SnmpBasicConfigComponent } from '../snmp-basic-config/snmp-basic-config.component';

/** The same form as the current one; only the legacy flag differs. */
@Component({
  selector: 'tb-snmp-legacy-basic-config',
  templateUrl: '../snmp-basic-config/snmp-basic-config.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SnmpLegacyBasicConfigComponent),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => SnmpLegacyBasicConfigComponent),
      multi: true,
    },
  ],
  standalone: true,
  imports: [CommonModule, SharedModule, SnmpDevicesTableComponent],
  styleUrls: ['../snmp-basic-config/snmp-basic-config.component.scss'],
})
export class SnmpLegacyBasicConfigComponent extends SnmpBasicConfigComponent {

  override isLegacy = true;
}
