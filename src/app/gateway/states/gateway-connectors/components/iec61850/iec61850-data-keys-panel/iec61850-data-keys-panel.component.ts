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

import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import {
  IEC61850DataKey,
  IEC61850RpcConfig,
  IEC61850ValueKey,
  IEC61850ValueType,
  IEC61850FC,
} from '../../../models/public-api';

@Component({
  selector: 'tb-iec61850-data-keys-panel',
  templateUrl: './iec61850-data-keys-panel.component.html',
  styleUrls: ['./iec61850-data-keys-panel.component.scss'],
  standalone: true,
  imports: [CommonModule, SharedModule],
})
export class IEC61850DataKeysPanelComponent implements OnInit {

  @Input() keys: (IEC61850DataKey | IEC61850RpcConfig)[] = [];
  @Input() keyType: IEC61850ValueKey = IEC61850ValueKey.TIMESERIES;

  @Output() keysDataApplied = new EventEmitter<(IEC61850DataKey | IEC61850RpcConfig)[]>();
  @Output() cancelled = new EventEmitter<void>();

  keysFormArray: FormArray;
  searchText = '';

  readonly ValueType = IEC61850ValueType;
  readonly FC = IEC61850FC;
  readonly valueTypes = Object.values(IEC61850ValueType);
  readonly fcOptions = Object.values(IEC61850FC);

  get isRpc(): boolean {
    return this.keyType === IEC61850ValueKey.RPC;
  }

  get title(): string {
    switch (this.keyType) {
      case IEC61850ValueKey.TIMESERIES: return 'Telemetry Keys';
      case IEC61850ValueKey.ATTRIBUTES: return 'Attribute Keys';
      case IEC61850ValueKey.ATTRIBUTES_UPDATES: return 'Attribute Update Keys';
      case IEC61850ValueKey.RPC: return 'RPC Methods';
      default: return 'Data Keys';
    }
  }

  constructor(private fb: FormBuilder) {}

  ngOnInit(): void {
    this.keysFormArray = this.fb.array([]);
    if (this.keys?.length) {
      this.keys.forEach(key => this.addKeyGroup(key));
    }
  }

  addKey(): void {
    if (this.isRpc) {
      this.addKeyGroup({ method: '', reference: '', operation: 'read' } as IEC61850RpcConfig);
    } else {
      this.addKeyGroup({ tag: '', reference: '', fc: IEC61850FC.MX } as IEC61850DataKey);
    }
  }

  removeKey(index: number): void {
    this.keysFormArray.removeAt(index);
  }

  apply(): void {
    const result = this.keysFormArray.getRawValue();
    this.keysDataApplied.emit(result);
  }

  cancel(): void {
    this.cancelled.emit();
  }

  private addKeyGroup(key: IEC61850DataKey | IEC61850RpcConfig): void {
    let group: FormGroup;

    if (this.isRpc) {
      const rpc = key as IEC61850RpcConfig;
      group = this.fb.group({
        method: [rpc.method || '', [Validators.required]],
        reference: [rpc.reference || '', [Validators.required]],
        fc: [rpc.fc || IEC61850FC.CO],
        valueType: [rpc.valueType || ''],
        operation: [rpc.operation || 'read', [Validators.required]],
        controlModel: [rpc.controlModel],
      });
    } else {
      const dk = key as IEC61850DataKey;
      group = this.fb.group({
        tag: [dk.tag || '', [Validators.required]],
        reference: [dk.reference || '', [Validators.required]],
        fc: [dk.fc || IEC61850FC.MX],
        valueType: [dk.valueType || ''],
      });
    }

    this.keysFormArray.push(group);
  }
}
