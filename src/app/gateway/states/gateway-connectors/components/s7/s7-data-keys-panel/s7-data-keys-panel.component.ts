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

import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { nonZeroFloat, ReportStrategyDefaultValue } from '../../../../../shared/public-api';
import { ReportStrategyComponent } from '../../../../../shared/components/public-api';
import { ModifierType, ModifierTypesMap } from '../../../models/public-api';
import { S7DataKey, S7RpcConfig, S7ValueKey, S7ValueType } from '../../../models/public-api';
import { generateSecret } from '@core/public-api';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';

@Component({
  selector: 'tb-s7-data-keys-panel',
  templateUrl: './s7-data-keys-panel.component.html',
  styleUrls: ['./s7-data-keys-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule, ReactiveFormsModule, ReportStrategyComponent],
})
export class S7DataKeysPanelComponent implements OnInit, OnDestroy {

  @Input() panelTitle = 'Data Keys';
  @Input() addKeyTitle = 'Add key';
  @Input() deleteKeyTitle = 'Delete key';
  @Input() noKeysText = 'No data keys configured';
  @Input() keys: Array<S7DataKey | S7RpcConfig> = [];
  @Input() keysType: S7ValueKey = S7ValueKey.TIMESERIES;

  @Output() keysDataApplied = new EventEmitter<Array<S7DataKey | S7RpcConfig>>();
  @Output() cancelled = new EventEmitter<void>();

  readonly valueTypes = Object.values(S7ValueType);
  readonly modifierTypes: ModifierType[] = Object.values(ModifierType) as ModifierType[];
  readonly ModifierTypesMap = ModifierTypesMap;
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly S7ValueKey = S7ValueKey;

  enableModifiersControlMap = new Map<string, FormControl<boolean>>();
  keysFormArray: FormArray;

  searchControl = new FormControl('');
  filteredControls: { control: FormGroup; index: number }[] = [];
  displayedControls: { control: FormGroup; index: number }[] = [];
  renderLimit = 50;
  lastAddedId: string | null = null;

  private destroy$ = new Subject<void>();
  private fb = new FormBuilder();

  get isRpc(): boolean {
    return this.keysType === S7ValueKey.RPC;
  }

  ngOnInit(): void {
    this.keysFormArray = this.fb.array([]);
    if (this.keys?.length) {
      this.keys.forEach(key => {
        const form = this.createKeyForm(key);
        if (!this.isRpc) {
          this.observeEnableModifier(form);
        }
        this.keysFormArray.push(form);
      });
    }
    this.updateFilteredControls();
    this.searchControl.valueChanges.pipe(
      debounceTime(200),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.renderLimit = 50;
      this.updateFilteredControls();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  addKey(): void {
    if (this.isRpc) {
      const form = this.createKeyForm({
        method: '',
        address: '',
        valueType: null,
        operation: 'read',
      } as S7RpcConfig);
      this.keysFormArray.insert(0, form);
    } else {
      const form = this.createKeyForm({
        tag: '',
        address: '',
        valueType: null,
      } as S7DataKey);
      this.observeEnableModifier(form);
      this.lastAddedId = form.getRawValue().id;
      this.keysFormArray.insert(0, form);
    }
    this.searchControl.setValue('', { emitEvent: false });
    this.updateFilteredControls();
  }

  deleteKey(index: number): void {
    this.keysFormArray.removeAt(index);
    this.keysFormArray.markAsDirty();
    this.updateFilteredControls();
  }

  cancel(): void {
    this.cancelled.emit();
  }

  applyKeysData(): void {
    if (this.keysFormArray.valid) {
      this.keysDataApplied.emit(this.getFormValue());
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

  onKeyPanelScroll(event: Event): void {
    if (this.renderLimit >= this.filteredControls.length) return;
    const el = event.target as HTMLElement;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      this.renderLimit += 50;
      this.displayedControls = this.filteredControls.slice(0, this.renderLimit);
    }
  }

  updateFilteredControls(): void {
    const search = (this.searchControl.value || '').toLowerCase().trim();
    if (!search) {
      this.filteredControls = this.keysFormArray.controls
        .map((c, i) => ({ control: c as FormGroup, index: i }));
    } else {
      this.filteredControls = this.keysFormArray.controls
        .map((c, i) => ({ control: c as FormGroup, index: i }))
        .filter(item => {
          const tag = (item.control.get('tag')?.value || item.control.get('method')?.value || '').toLowerCase();
          const address = (item.control.get('address')?.value?.toString() || '');
          return tag.includes(search) || address.toLowerCase().includes(search);
        });
    }
    this.displayedControls = this.filteredControls.slice(0, this.renderLimit);
  }

  trackByFilteredItem(_: number, item: { control: FormGroup; index: number }): string {
    return item.control.getRawValue().id ?? item.index.toString();
  }

  private getFormValue(): Array<S7DataKey | S7RpcConfig> {
    return this.keysFormArray.value.map((key: any, i: number) => {
      if (this.isRpc) return key;
      const { id, modifierType, modifierValue, reportStrategy, ...rest } = key;
      const keyId = (this.keysFormArray.controls[i] as FormGroup).get('id')?.value;
      const result: any = { ...rest };
      if (this.enableModifiersControlMap.get(keyId)?.value && modifierType) {
        result[modifierType] = modifierValue;
      }
      if (reportStrategy) {
        result.reportStrategy = reportStrategy;
      }
      return result;
    });
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
    const id = generateSecret(5);
    const hasModifier = !!(dataKey.multiplier || dataKey.divider);
    this.enableModifiersControlMap.set(id, this.fb.control(hasModifier));

    return this.fb.group({
      id: [{ value: id, disabled: true }],
      tag: [dataKey.tag || '', [Validators.required]],
      address: [dataKey.address || '', [Validators.required, Validators.pattern(/^(DB\d+\.DB[XBWDL]\d+(\.\d+)?|[MIQC]\d+\.\d+|[MIQC][BWDL]\d+)$/i)]],
      valueType: [dataKey.valueType || null],
      modifierType: [{ value: dataKey.divider ? ModifierType.DIVIDER : ModifierType.MULTIPLIER, disabled: !hasModifier }],
      modifierValue: [{ value: dataKey.multiplier ?? dataKey.divider ?? 1, disabled: !hasModifier }, [Validators.pattern(nonZeroFloat)]],
      reportStrategy: [dataKey.reportStrategy || null],
    });
  }

  private observeEnableModifier(keyFormGroup: FormGroup): void {
    const id = keyFormGroup.get('id')?.value ?? (keyFormGroup.getRawValue() as any).id;
    this.enableModifiersControlMap.get(id)?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(enabled => {
        const modifierType = keyFormGroup.get('modifierType');
        const modifierValue = keyFormGroup.get('modifierValue');
        if (enabled) {
          modifierType?.enable();
          modifierValue?.enable();
        } else {
          modifierType?.disable();
          modifierValue?.disable();
        }
      });
  }
}
