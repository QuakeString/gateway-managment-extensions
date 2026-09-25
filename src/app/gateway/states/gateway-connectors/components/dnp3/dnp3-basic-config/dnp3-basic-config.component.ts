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
import { AbstractControl, FormArray, FormGroup, NG_VALIDATORS, NG_VALUE_ACCESSOR, ValidationErrors, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import {
  DNP3_DEFAULT_PORT,
  Dnp3BasicConfig,
  Dnp3ChannelConfig,
  Dnp3ChannelType,
} from '../../../models/public-api';
import { GatewayConnectorBasicConfigDirective } from '../../../abstract/public-api';
import { Dnp3DevicesTableComponent } from '../dnp3-devices-table/dnp3-devices-table.component';

/** Channel names must be unique: devices refer to their channel by name. */
function uniqueChannelNames(array: AbstractControl): ValidationErrors | null {
  const names = ((array.value ?? []) as Dnp3ChannelConfig[]).map(c => (c.name ?? '').trim()).filter(n => n);
  return new Set(names).size === names.length ? null : { duplicateChannelName: true };
}

@Component({
  selector: 'tb-dnp3-basic-config',
  templateUrl: './dnp3-basic-config.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Dnp3BasicConfigComponent),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => Dnp3BasicConfigComponent),
      multi: true,
    },
  ],
  standalone: true,
  imports: [CommonModule, SharedModule, Dnp3DevicesTableComponent],
  styleUrls: ['./dnp3-basic-config.component.scss'],
})
export class Dnp3BasicConfigComponent extends GatewayConnectorBasicConfigDirective<Dnp3BasicConfig, Dnp3BasicConfig> {

  @Input() gatewayDeviceId: string;
  @Input() connectorName: string;

  isLegacy = false;

  get channelsArray(): FormArray {
    return this.basicFormGroup.get('channels') as FormArray;
  }

  get channelNames(): string[] {
    return ((this.channelsArray.value ?? []) as Dnp3ChannelConfig[])
      .map(channel => (channel.name ?? '').trim())
      .filter(name => name);
  }

  addChannel(): void {
    const taken = new Set(this.channelNames);
    let n = this.channelsArray.length + 1;
    while (taken.has(`channel-${n}`)) {
      n++;
    }
    this.channelsArray.push(this.channelForm({
      name: `channel-${n}`,
      type: Dnp3ChannelType.TCP_CLIENT,
      host: '',
      port: DNP3_DEFAULT_PORT,
    }));
    this.channelsArray.markAsDirty();
  }

  removeChannel(index: number): void {
    this.channelsArray.removeAt(index);
    this.channelsArray.markAsDirty();
  }

  protected getMappedValue(config: Dnp3BasicConfig): Dnp3BasicConfig {
    return {
      channels: (config?.channels ?? []).map(channel => ({ ...channel, name: (channel.name ?? '').trim() })),
      devices: config?.devices ?? [],
    };
  }

  protected initBasicFormGroup(): FormGroup {
    return this.fb.group({
      channels: this.fb.array([], { validators: [uniqueChannelNames] }),
      devices: [[]],
    });
  }

  protected mapConfigToFormValue(config: Dnp3BasicConfig): Dnp3BasicConfig {
    // The channel rows are a FormArray: rebuild it to the config's length
    // before the value is patched in.
    // `setValue` wants every key of every row: fill in the defaults of a
    // channel saved without its optional fields.
    const channels = (config?.channels ?? []).map(channel => this.channelForm(channel).value as Dnp3ChannelConfig);
    const array = this.basicFormGroup?.get('channels') as FormArray;
    if (array) {
      array.clear({ emitEvent: false });
      channels.forEach(channel => array.push(this.channelForm(channel), { emitEvent: false }));
    }
    return {
      channels,
      devices: config?.devices ?? [],
    };
  }

  private channelForm(channel: Dnp3ChannelConfig): FormGroup {
    return this.fb.group({
      name: [channel.name ?? '', [Validators.required, Validators.pattern(/\S/)]],
      type: [channel.type ?? Dnp3ChannelType.TCP_CLIENT],
      host: [channel.host ?? '', [Validators.required, Validators.pattern(/\S/)]],
      port: [channel.port ?? DNP3_DEFAULT_PORT, [Validators.required, Validators.min(1), Validators.max(65535)]],
      connectTimeoutMs: [channel.connectTimeoutMs ?? 5000, [Validators.min(100)]],
      minRetryDelayMs: [channel.minRetryDelayMs ?? 1000, [Validators.min(100)]],
      maxRetryDelayMs: [channel.maxRetryDelayMs ?? 60000, [Validators.min(100)]],
    });
  }
}
