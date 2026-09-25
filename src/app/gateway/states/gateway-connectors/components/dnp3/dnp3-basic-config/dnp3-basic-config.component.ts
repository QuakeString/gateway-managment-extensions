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
import { AbstractControl, FormArray, FormGroup, NG_VALIDATORS, NG_VALUE_ACCESSOR, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import {
  DNP3_DEFAULT_PORT,
  DNP3_SERIAL_TLS_VERSION,
  DNP3_TLS_DEFAULT_PORT,
  Dnp3BasicConfig,
  Dnp3ChannelConfig,
  Dnp3ChannelType,
  Dnp3FlowControl,
  Dnp3Parity,
} from '../../../models/public-api';
import { GatewayConnectorVersionMappingUtil } from '../../../utils/gateway-connector-version-mapping.util';
import { GatewayConnectorBasicConfigDirective } from '../../../abstract/public-api';
import { Dnp3DevicesTableComponent } from '../dnp3-devices-table/dnp3-devices-table.component';

const NOT_BLANK: ValidatorFn[] = [Validators.required, Validators.pattern(/\S/)];

/** The keys each channel type writes; the rest of the form is left out. */
const CHANNEL_KEYS: Record<string, (keyof Dnp3ChannelConfig)[]> = {
  [Dnp3ChannelType.TCP_CLIENT]: ['name', 'type', 'host', 'port', 'connectTimeoutMs', 'minRetryDelayMs', 'maxRetryDelayMs'],
  [Dnp3ChannelType.TLS]: [
    'name', 'type', 'host', 'port', 'connectTimeoutMs', 'minRetryDelayMs', 'maxRetryDelayMs',
    'serverName', 'caCert', 'cert', 'key', 'minTlsVersion',
  ],
  [Dnp3ChannelType.SERIAL]: [
    'name', 'type', 'path', 'baudRate', 'dataBits', 'parity', 'stopBits', 'flowControl', 'openDelayMs',
    'minRetryDelayMs', 'maxRetryDelayMs',
  ],
};

/** A TLS channel's certificate and key go together. */
function certAndKeyTogether(group: AbstractControl): ValidationErrors | null {
  if (group.get('type')?.value !== Dnp3ChannelType.TLS) {
    return null;
  }
  const cert = (group.get('cert')?.value ?? '').trim();
  const key = (group.get('key')?.value ?? '').trim();
  return !cert === !key ? null : { certAndKey: true };
}

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
  /** The gateway's own version: serial and TLS channels need 4.4.0. */
  @Input() gatewayVersion: string;

  readonly ChannelType = Dnp3ChannelType;
  readonly parities = Object.values(Dnp3Parity);
  readonly flowControls = Object.values(Dnp3FlowControl);
  readonly baudRates = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

  isLegacy = false;

  /** Unknown (no version reported yet) counts as able. */
  get serialAndTlsSupported(): boolean {
    return !this.gatewayVersion
      || GatewayConnectorVersionMappingUtil.parseVersion(this.gatewayVersion)
        >= GatewayConnectorVersionMappingUtil.parseVersion(DNP3_SERIAL_TLS_VERSION);
  }

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
      channels: (config?.channels ?? []).map(channel => this.channelToWrite(channel)),
      devices: config?.devices ?? [],
    };
  }

  /** Only the chosen type's keys, trimmed; empty optional strings left out. */
  private channelToWrite(channel: Dnp3ChannelConfig): Dnp3ChannelConfig {
    const keys = CHANNEL_KEYS[channel.type] ?? CHANNEL_KEYS[Dnp3ChannelType.TCP_CLIENT];
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      let value = channel[key] as unknown;
      if (typeof value === 'string') {
        value = value.trim();
        if (value === '' && key !== 'name') {
          continue;
        }
      }
      if (value !== undefined && value !== null) {
        out[key] = value;
      }
    }
    return out as unknown as Dnp3ChannelConfig;
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
    const type = channel.type ?? Dnp3ChannelType.TCP_CLIENT;
    const defaultPort = type === Dnp3ChannelType.TLS ? DNP3_TLS_DEFAULT_PORT : DNP3_DEFAULT_PORT;
    const group = this.fb.group({
      name: [channel.name ?? '', NOT_BLANK],
      type: [type],
      host: [channel.host ?? ''],
      port: [channel.port ?? defaultPort],
      connectTimeoutMs: [channel.connectTimeoutMs ?? 5000, [Validators.min(100)]],
      minRetryDelayMs: [channel.minRetryDelayMs ?? 1000, [Validators.min(100)]],
      maxRetryDelayMs: [channel.maxRetryDelayMs ?? 60000, [Validators.min(100)]],
      path: [channel.path ?? ''],
      baudRate: [channel.baudRate ?? 9600, [Validators.min(1)]],
      dataBits: [channel.dataBits ?? 8, [Validators.min(5), Validators.max(8)]],
      parity: [channel.parity ?? Dnp3Parity.NONE],
      stopBits: [channel.stopBits ?? 1],
      flowControl: [channel.flowControl ?? Dnp3FlowControl.NONE],
      openDelayMs: [channel.openDelayMs ?? 500, [Validators.min(0)]],
      serverName: [channel.serverName ?? ''],
      caCert: [channel.caCert ?? ''],
      cert: [channel.cert ?? ''],
      key: [channel.key ?? ''],
      minTlsVersion: [channel.minTlsVersion ?? '1.2'],
    }, { validators: [certAndKeyTogether] });
    this.applyTypeValidators(group, type);
    group.get('type').valueChanges.subscribe(next => {
      // Carry the port over to the other TCP flavour's default, unless it
      // was set by hand.
      const port = group.get('port');
      if (next === Dnp3ChannelType.TLS && port.value === DNP3_DEFAULT_PORT) {
        port.setValue(DNP3_TLS_DEFAULT_PORT);
      } else if (next === Dnp3ChannelType.TCP_CLIENT && port.value === DNP3_TLS_DEFAULT_PORT) {
        port.setValue(DNP3_DEFAULT_PORT);
      }
      this.applyTypeValidators(group, next);
    });
    return group;
  }

  /** Require what the chosen type needs, and nothing the others do. */
  private applyTypeValidators(group: FormGroup, type: string): void {
    const tcp = type === Dnp3ChannelType.TCP_CLIENT || type === Dnp3ChannelType.TLS;
    const set = (name: string, validators: ValidatorFn[] | null) => {
      const control = group.get(name);
      control.setValidators(validators);
      control.updateValueAndValidity({ emitEvent: false });
    };
    set('host', tcp ? NOT_BLANK : null);
    set('port', tcp ? [Validators.required, Validators.min(1), Validators.max(65535)] : null);
    set('path', type === Dnp3ChannelType.SERIAL ? NOT_BLANK : null);
    set('caCert', type === Dnp3ChannelType.TLS ? NOT_BLANK : null);
    group.updateValueAndValidity({ emitEvent: false });
  }
}
