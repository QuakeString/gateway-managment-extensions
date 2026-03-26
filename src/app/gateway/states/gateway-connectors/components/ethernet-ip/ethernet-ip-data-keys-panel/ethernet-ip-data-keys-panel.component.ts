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

import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, inject, Input, OnDestroy, OnInit, Output } from '@angular/core';
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
import { ReportStrategyDefaultValue } from '../../../../../shared/public-api';
import { ReportStrategyComponent } from '../../../../../shared/components/public-api';
import { EthernetIPDataKey, EthernetIPRpcConfig, EthernetIPDataType, EthernetIPValueKey } from '../../../models/public-api';
import { generateSecret } from '@core/public-api';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'tb-ethernet-ip-data-keys-panel',
  templateUrl: './ethernet-ip-data-keys-panel.component.html',
  styleUrls: ['./ethernet-ip-data-keys-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule, ReactiveFormsModule, ReportStrategyComponent],
})
export class EthernetIPDataKeysPanelComponent implements OnInit, OnDestroy {

  @Input() panelTitle = 'Data Keys';
  @Input() addKeyTitle = 'Add key';
  @Input() deleteKeyTitle = 'Delete key';
  @Input() noKeysText = 'No data keys configured';
  @Input() keys: Array<EthernetIPDataKey | EthernetIPRpcConfig> = [];
  @Input() keysType: EthernetIPValueKey = EthernetIPValueKey.TIMESERIES;
  @Input() isSLC = false;

  @Output() keysDataApplied = new EventEmitter<Array<EthernetIPDataKey | EthernetIPRpcConfig>>();
  @Output() cancelled = new EventEmitter<void>();

  readonly dataTypes = Object.values(EthernetIPDataType);
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly EthernetIPValueKey = EthernetIPValueKey;

  enableScalingControlMap = new Map<string, FormControl<boolean>>();
  keysFormArray: FormArray;

  searchControl = new FormControl('');
  filteredControls: { control: FormGroup; index: number }[] = [];
  displayedControls: { control: FormGroup; index: number }[] = [];
  renderLimit = 50;
  lastAddedId: string | null = null;

  private destroy$ = new Subject<void>();
  private fb = new FormBuilder();
  private cd = inject(ChangeDetectorRef);

  get isRpc(): boolean {
    return this.keysType === EthernetIPValueKey.RPC;
  }

  ngOnInit(): void {
    this.keysFormArray = this.fb.array([]);
    if (this.keys?.length) {
      this.keys.forEach(key => {
        const form = this.createKeyForm(key);
        if (!this.isRpc) {
          this.observeEnableScaling(form);
        }
        this.keysFormArray.push(form);
      });
    }
    this.updateFilteredControls();
    this.searchControl.valueChanges.pipe(
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
        plcTag: '',
        valueType: null,
        operation: 'read',
      } as EthernetIPRpcConfig);
      this.keysFormArray.insert(0, form);
    } else {
      const form = this.createKeyForm({
        tag: '',
        plcTag: '',
      } as EthernetIPDataKey);
      this.observeEnableScaling(form);
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
    return keyForm.get('tag')?.value || 'New Key';
  }

  onKeyPanelScroll(event: Event): void {
    if (this.renderLimit >= this.filteredControls.length) return;
    const el = event.target as HTMLElement;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      this.renderLimit += 50;
      this.displayedControls = this.filteredControls.slice(0, this.renderLimit);
      this.cd.markForCheck();
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
          const plcTag = (item.control.get('plcTag')?.value?.toString() || '');
          return tag.includes(search) || plcTag.toLowerCase().includes(search);
        });
    }
    this.displayedControls = this.filteredControls.slice(0, this.renderLimit);
    this.cd.markForCheck();
  }

  trackByFilteredItem(_: number, item: { control: FormGroup; index: number }): string {
    return item.control.getRawValue().id ?? item.index.toString();
  }

  private getFormValue(): Array<EthernetIPDataKey | EthernetIPRpcConfig> {
    return this.keysFormArray.value.map((key: any, i: number) => {
      if (this.isRpc) {
        const result: any = { method: key.method, plcTag: key.plcTag, operation: key.operation };
        if (key.valueType) { result.valueType = key.valueType; }
        return result;
      }
      const keyId = (this.keysFormArray.controls[i] as FormGroup).get('id')?.value;
      const result: any = { tag: key.tag, plcTag: key.plcTag };
      if (this.enableScalingControlMap.get(keyId)?.value) {
        result.scaling = {
          rawMin: key.rawMin,
          rawMax: key.rawMax,
          engMin: key.engMin,
          engMax: key.engMax,
        };
      }
      if (key.reportStrategy) {
        result.reportStrategy = key.reportStrategy;
      }
      return result;
    });
  }

  private createKeyForm(key: EthernetIPDataKey | EthernetIPRpcConfig): FormGroup {
    if (this.isRpc) {
      const rpc = key as EthernetIPRpcConfig;
      return this.fb.group({
        method: [rpc.method || '', [Validators.required]],
        plcTag: [rpc.plcTag || '', [Validators.required]],
        valueType: [rpc.valueType || null],
        operation: [rpc.operation || 'read', [Validators.required]],
      });
    }
    const dataKey = key as EthernetIPDataKey;
    const id = generateSecret(5);
    const hasScaling = !!dataKey.scaling;
    this.enableScalingControlMap.set(id, this.fb.control(hasScaling));

    return this.fb.group({
      id: [{ value: id, disabled: true }],
      tag: [dataKey.tag || '', [Validators.required]],
      plcTag: [dataKey.plcTag || '', [Validators.required]],
      rawMin: [{ value: dataKey.scaling?.rawMin ?? 0, disabled: !hasScaling }],
      rawMax: [{ value: dataKey.scaling?.rawMax ?? 65535, disabled: !hasScaling }],
      engMin: [{ value: dataKey.scaling?.engMin ?? 0, disabled: !hasScaling }],
      engMax: [{ value: dataKey.scaling?.engMax ?? 100, disabled: !hasScaling }],
      reportStrategy: [dataKey.reportStrategy || null],
    });
  }

  private observeEnableScaling(keyFormGroup: FormGroup): void {
    const id = keyFormGroup.get('id')?.value ?? (keyFormGroup.getRawValue() as any).id;
    this.enableScalingControlMap.get(id)?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(enabled => {
        ['rawMin', 'rawMax', 'engMin', 'engMax'].forEach(field => {
          const ctrl = keyFormGroup.get(field);
          if (enabled) { ctrl?.enable(); } else { ctrl?.disable(); }
        });
      });
  }
}
