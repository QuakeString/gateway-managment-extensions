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
  MappingType,
  OPCBasicConfig_v3_5_2,
  ServerConfig,
} from '../../../models/public-api';
import { CommonModule } from '@angular/common';
import { coerceBoolean, SharedModule } from '@shared/public-api';
import { MappingTableComponent } from '../../mapping-table/mapping-table.component';
import {
  SecurityConfigComponent
} from '../../security-config/security-config.component';
import {
  OpcServerConfigComponent
} from '../opc-server-config/opc-server-config.component';
import { GatewayConnectorBasicConfigDirective } from '../../../abstract/public-api';

@Component({
  selector: 'tb-opc-ua-basic-config',
  templateUrl: './opc-ua-basic-config.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => OpcUaBasicConfigComponent),
      multi: true
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => OpcUaBasicConfigComponent),
      multi: true
    }
  ],
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    SecurityConfigComponent,
    MappingTableComponent,
    OpcServerConfigComponent,
  ],
  styleUrls: ['./opc-ua-basic-config.component.scss']
})
export class OpcUaBasicConfigComponent extends GatewayConnectorBasicConfigDirective<OPCBasicConfig_v3_5_2, OPCBasicConfig_v3_5_2> {

  @Input() @coerceBoolean() withReportStrategy = true;
  // Propagated down to the server-config + mapping-table so their child
  // dialogs (endpoint discover, node browser, tag import) can reach the
  // live gateway connector via the platform's two-way RPC channel.
  @Input() gatewayDeviceId: string;
  @Input() connectorName: string;

  /** ViewChild handle so we can append discovered devices directly into
   *  the mapping form via mapping-table's own append-only API instead of
   *  clearing/repushing the whole FormControl value. */
  @ViewChild(MappingTableComponent) mappingTable?: MappingTableComponent;

  mappingTypes = MappingType;
  isLegacy = false;

  protected override initBasicFormGroup(): FormGroup {
    return this.fb.group({
      mapping: [],
      server: [],
    });
  }

  protected override mapConfigToFormValue(config: OPCBasicConfig_v3_5_2): OPCBasicConfig_v3_5_2 {
    return {
      server: config.server ?? {} as ServerConfig,
      mapping: config.mapping ?? [],
    };
  }

  protected override getMappedValue(value: OPCBasicConfig_v3_5_2): OPCBasicConfig_v3_5_2 {
    return {
      server: value.server,
      mapping: value.mapping,
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
      // Path form is easier to read than a numeric NodeId (`ns=2;i=1`)
      // and survives if the server renumbers its namespace. The scan
      // dialog only lists top-level Object nodes under /Objects, so the
      // path is always `Root\.Objects\.<DisplayName>` — the connector
      // splits that string on `\.` (see opcua_connector.find_nodes).
      deviceNodeSource: 'path',
      deviceNodePattern: `Root\\.Objects\\.${d.displayName}`,
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
