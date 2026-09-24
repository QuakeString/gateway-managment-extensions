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

import { ChangeDetectionStrategy, Component, Input, forwardRef } from '@angular/core';
import { FormGroup, NG_VALIDATORS, NG_VALUE_ACCESSOR, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import {
  SNMP_ENGINE_ID_REGEX,
  SNMP_TRAP_DEFAULT_HOST,
  SNMP_TRAP_DEFAULT_PORT,
  SnmpBasicConfig,
  SnmpBasicConfigForm,
  SnmpDeviceConfig,
  snmpNotificationsFromForm,
  snmpNotificationsToForm,
} from '../../../models/public-api';
import { GatewayConnectorBasicConfigDirective } from '../../../abstract/public-api';
import { SnmpDevicesTableComponent } from '../snmp-devices-table/snmp-devices-table.component';

@Component({
  selector: 'tb-snmp-basic-config',
  templateUrl: './snmp-basic-config.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SnmpBasicConfigComponent),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => SnmpBasicConfigComponent),
      multi: true,
    },
  ],
  standalone: true,
  imports: [CommonModule, SharedModule, SnmpDevicesTableComponent],
  styleUrls: ['./snmp-basic-config.component.scss'],
})
export class SnmpBasicConfigComponent extends GatewayConnectorBasicConfigDirective<SnmpBasicConfigForm, SnmpBasicConfig> {

  @Input() gatewayDeviceId: string;
  @Input() connectorName: string;

  isLegacy = false;

  /** Devices that list notifications while the receiver is off: nothing reaches them. */
  get devicesAwaitingReceiver(): number {
    if (this.basicFormGroup.get('notifications.enabled').value) {
      return 0;
    }
    return ((this.basicFormGroup.get('devices').value ?? []) as SnmpDeviceConfig[])
      .filter(device => device.notifications?.length).length;
  }

  protected getMappedValue(form: SnmpBasicConfigForm): SnmpBasicConfig {
    const notifications = snmpNotificationsFromForm(form?.notifications);
    return {
      ...(notifications && { notifications }),
      devices: form?.devices || [],
    };
  }

  protected initBasicFormGroup(): FormGroup {
    return this.fb.group({
      notifications: this.fb.group({
        enabled: [false],
        host: [SNMP_TRAP_DEFAULT_HOST],
        port: [SNMP_TRAP_DEFAULT_PORT, [Validators.min(1), Validators.max(65535)]],
        community: [''],
        engineId: ['', [Validators.pattern(SNMP_ENGINE_ID_REGEX)]],
      }),
      devices: [[]],
    });
  }

  protected mapConfigToFormValue(config: SnmpBasicConfig): SnmpBasicConfigForm {
    return {
      notifications: snmpNotificationsToForm(config?.notifications),
      devices: config?.devices || [],
    };
  }
}
