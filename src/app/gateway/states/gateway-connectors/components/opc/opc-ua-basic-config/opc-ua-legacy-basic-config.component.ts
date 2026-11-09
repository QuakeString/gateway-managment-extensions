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

import { ChangeDetectionStrategy, Component, forwardRef, Input, ViewChild } from '@angular/core';
import { FormGroup, NG_VALIDATORS, NG_VALUE_ACCESSOR } from '@angular/forms';
import {
  DeviceConnectorMapping,
  LegacyServerConfig,
  MappingType,
  OPCBasicConfig_v3_5_2,
  OPCLegacyBasicConfig,
  ServerConfig,
} from '../../../models/public-api';
import { CommonModule } from '@angular/common';
import { coerceBoolean, SharedModule } from '@shared/public-api';
import { MappingTableComponent } from '../../mapping-table/mapping-table.component';
import { OpcServerConfigComponent } from '../opc-server-config/opc-server-config.component';
import { GatewayConnectorBasicConfigDirective } from '../../../abstract/public-api';
import { OpcVersionMappingUtil } from '../../../utils/public-api';

@Component({
  selector: 'tb-opc-ua-legacy-basic-config',
  templateUrl: './opc-ua-basic-config.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => OpcUaLegacyBasicConfigComponent),
      multi: true
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => OpcUaLegacyBasicConfigComponent),
      multi: true
    }
  ],
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    MappingTableComponent,
    OpcServerConfigComponent,
  ],
  styleUrls: ['./opc-ua-basic-config.component.scss']
})
export class OpcUaLegacyBasicConfigComponent extends GatewayConnectorBasicConfigDirective<OPCBasicConfig_v3_5_2, OPCLegacyBasicConfig> {

  @ViewChild(MappingTableComponent) mappingTable?: MappingTableComponent;

  @Input() @coerceBoolean() withReportStrategy = true;
  @Input() gatewayDeviceId: string;
  @Input() connectorName: string;

  mappingTypes = MappingType;
  isLegacy = true;

  protected override initBasicFormGroup(): FormGroup {
    return this.fb.group({
      mapping: [],
      server: [],
    });
  }

  protected override mapConfigToFormValue(config: OPCLegacyBasicConfig | OPCBasicConfig_v3_5_2): OPCBasicConfig_v3_5_2 {
    let mapping: DeviceConnectorMapping[];
    if (config?.server && 'mapping' in config?.server) {
      mapping = OpcVersionMappingUtil.mapMappingToUpgradedVersion(config.server.mapping);
    } else if (config && 'mapping' in config) {
      mapping = OpcVersionMappingUtil.mapMappingToCurrentVersion(config.mapping);
    } else {
      mapping = []
    }
    return {
      server: config.server ? OpcVersionMappingUtil.mapServerToUpgradedVersion(config.server as LegacyServerConfig) : {} as ServerConfig,
      mapping,
    };
  }

  protected override getMappedValue(value: OPCBasicConfig_v3_5_2): OPCLegacyBasicConfig {
    return {
      server: OpcVersionMappingUtil.mapServerToDowngradedVersion(value),
    };
  }

  /**
   * Called when the discovery dialog returns a list of Object nodes to add
   * as device mappings, each carrying the keys the operator ticked inside
   * it. Each device becomes a new OPC-UA mapping row anchored to that
   * NodeId, with ticked Variable children prefilled as timeseries tags.
   * The operator can add/remove more tags later via the mapping row's
   * 3-dot menu → Browse.
   */
  appendDiscoveredDevices(devices: Array<{
    nodeId: string;
    displayName: string;
    tags: Array<{ key: string; value: string; type: string }>;
  }>): void {
    if (!devices?.length) return;
    const newMappings = devices.map(d => ({
      // The node's own NodeId: a path built from the display name breaks
      // when the browse name differs from it or carries a namespace.
      deviceNodeSource: 'identifier',
      deviceNodePattern: d.nodeId,
      deviceInfo: {
        deviceNameExpressionSource: 'constant',
        deviceNameExpression: d.displayName,
        deviceProfileExpressionSource: 'constant',
        deviceProfileExpression: 'default',
      },
      attributes: [],
      timeseries: d.tags || [],
      rpc_methods: [],
      attributes_updates: [],
    })) as any[];
    this.mappingTable?.addMappings(newMappings);
  }
}
