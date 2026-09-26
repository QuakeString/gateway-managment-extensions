///
/// Copyright © 2016-2025 The Sentient Authors
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
import { FormGroup, NG_VALIDATORS, NG_VALUE_ACCESSOR, ValidatorFn, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import {
  PROFINET_DEFAULT_CONTROLLER_NAME,
  ProfinetBasicConfig,
} from '../../../models/public-api';
import { GatewayConnectorBasicConfigDirective } from '../../../abstract/public-api';
import { ProfinetDevicesTableComponent } from '../profinet-devices-table/profinet-devices-table.component';

const NOT_BLANK: ValidatorFn[] = [Validators.required, Validators.pattern(/\S/)];

/**
 * The PROFINET connector's form: the NIC facing the devices, the
 * controller's own name of station, the cyclic thread's real-time
 * priority, and the devices. Anything else the configuration holds (a test
 * `backend`) is carried through untouched.
 */
@Component({
  selector: 'tb-profinet-basic-config',
  templateUrl: './profinet-basic-config.component.html',
  styleUrls: ['./profinet-basic-config.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ProfinetBasicConfigComponent),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => ProfinetBasicConfigComponent),
      multi: true,
    },
  ],
  standalone: true,
  imports: [CommonModule, SharedModule, ProfinetDevicesTableComponent],
})
export class ProfinetBasicConfigComponent extends GatewayConnectorBasicConfigDirective<ProfinetBasicConfig, ProfinetBasicConfig> {

  @Input() gatewayDeviceId: string;
  @Input() connectorName: string;
  @Input() gatewayVersion: string;

  isLegacy = false;

  /** Keys the form does not show, kept as they were. */
  private extra: Record<string, unknown> = {};

  protected initBasicFormGroup(): FormGroup {
    return this.fb.group({
      interface: ['', NOT_BLANK],
      controller: this.fb.group({
        nameOfStation: [PROFINET_DEFAULT_CONTROLLER_NAME, [...NOT_BLANK, Validators.pattern(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/)]],
        realtimePriority: [null as number | null, [Validators.min(1), Validators.max(99)]],
      }),
      devices: [[]],
    });
  }

  protected mapConfigToFormValue(config: ProfinetBasicConfig): ProfinetBasicConfig {
    const { interface: nic, controller, devices, ...rest } = (config ?? {}) as any;
    this.extra = rest;
    return {
      interface: nic ?? '',
      controller: {
        nameOfStation: controller?.nameOfStation ?? PROFINET_DEFAULT_CONTROLLER_NAME,
        realtimePriority: controller?.realtimePriority ?? null,
      },
      devices: devices ?? [],
    };
  }

  protected getMappedValue(config: ProfinetBasicConfig): ProfinetBasicConfig {
    const controller: any = { nameOfStation: (config?.controller?.nameOfStation ?? '').trim() };
    const priority = config?.controller?.realtimePriority;
    if (priority !== null && priority !== undefined && `${priority}` !== '') {
      controller.realtimePriority = Number(priority);
    }
    return {
      ...this.extra,
      interface: (config?.interface ?? '').trim(),
      controller,
      devices: config?.devices ?? [],
    } as ProfinetBasicConfig;
  }
}
