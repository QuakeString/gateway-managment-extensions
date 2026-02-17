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

import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { S7DataKey, S7RpcConfig, S7ValueKey, S7ValueType } from '../../../models/public-api';

@Component({
  selector: 'tb-s7-data-keys-panel',
  templateUrl: './s7-data-keys-panel.component.html',
  styleUrls: ['./s7-data-keys-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule, ReactiveFormsModule],
})
export class S7DataKeysPanelComponent implements OnInit {

  @Input() panelTitle = 'Data Keys';
  @Input() addKeyTitle = 'Add key';
  @Input() deleteKeyTitle = 'Delete key';
  @Input() noKeysText = 'No data keys configured';
  @Input() keys: Array<S7DataKey | S7RpcConfig> = [];
  @Input() keysType: S7ValueKey = S7ValueKey.TIMESERIES;

  @Output() keysDataApplied = new EventEmitter<Array<S7DataKey | S7RpcConfig>>();
  @Output() cancelled = new EventEmitter<void>();

  readonly valueTypes = Object.values(S7ValueType);
  readonly S7ValueKey = S7ValueKey;
  keysFormArray: FormArray;

  private fb = new FormBuilder();

  get isRpc(): boolean {
    return this.keysType === S7ValueKey.RPC;
  }

  ngOnInit(): void {
    this.keysFormArray = this.fb.array([]);
    if (this.keys?.length) {
      this.keys.forEach(key => this.keysFormArray.push(this.createKeyForm(key)));
    }
  }

  addKey(): void {
    if (this.isRpc) {
      this.keysFormArray.push(this.createKeyForm({
        method: '',
        address: '',
        valueType: null,
        operation: 'read',
      } as S7RpcConfig));
    } else {
      this.keysFormArray.push(this.createKeyForm({
        tag: '',
        address: '',
        valueType: null,
      } as S7DataKey));
    }
  }

  deleteKey(index: number): void {
    this.keysFormArray.removeAt(index);
    this.keysFormArray.markAsDirty();
  }

  cancel(): void {
    this.cancelled.emit();
  }

  applyKeysData(): void {
    if (this.keysFormArray.valid) {
      this.keysDataApplied.emit(this.keysFormArray.value);
    }
  }

  getKeyLabel(keyForm: FormGroup): string {
    if (this.isRpc) {
      const method = keyForm.get('method')?.value;
      const op = keyForm.get('operation')?.value;
      return method ? `${method} (${op})` : 'New RPC';
    }
    return keyForm.get('tag')?.value || 'New key';
  }

  private createKeyForm(key: S7DataKey | S7RpcConfig): FormGroup {
    if (this.isRpc) {
      const rpc = key as S7RpcConfig;
      return this.fb.group({
        method: [rpc.method || '', [Validators.required]],
        address: [rpc.address || '', [Validators.required, Validators.pattern(/^(DB\d+\.DB[XBWDL]\d+(\.\d+)?|[MIQC]\d+\.\d+|[MIQC][BWDL]\d+)$/i)]],
        valueType: [rpc.valueType || null],
        operation: [rpc.operation || 'read', [Validators.required]],
      });
    }
    const dataKey = key as S7DataKey;
    return this.fb.group({
      tag: [dataKey.tag || '', [Validators.required]],
      address: [dataKey.address || '', [Validators.required, Validators.pattern(/^(DB\d+\.DB[XBWDL]\d+(\.\d+)?|[MIQC]\d+\.\d+|[MIQC][BWDL]\d+)$/i)]],
      valueType: [dataKey.valueType || null],
    });
  }
}
