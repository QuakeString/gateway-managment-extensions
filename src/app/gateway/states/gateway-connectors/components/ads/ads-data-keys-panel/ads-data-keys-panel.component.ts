///
/// Copyright © 2016-2025 The Sentient Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///

import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import {
  ReportStrategyDefaultValue,
} from '../../../../../shared/public-api';
import {
  CalibrationBlockComponent,
  CalibrationConfig,
  IndustrialKeysPanelComponent,
  IndustrialKeysSortFieldOption,
  ReportStrategyComponent,
  calibrationColumns,
  reportStrategyColumns,
} from '../../../../../shared/components/public-api';
import { SpreadsheetColumnConfig } from '../../../../../shared/components/spreadsheet-keys/spreadsheet-keys.models';
import { AdsDataKey, AdsRpcConfig, AdsValueKey, AdsValueType } from '../../../models/public-api';
import { generateSecret } from '@core/public-api';

/**
 * ADS keys panel. Thin wrapper on the shared IndustrialKeysPanel
 * shell + CalibrationBlock CVA. This component owns the ADS-specific
 * concerns:
 *   - ADS address is EITHER a non-empty TwinCAT symbol name
 *     (MAIN.fTemp, GVL.bReady, .globalVar) OR an index-group/offset
 *     pair "<ig>:<io>" (decimal or 0x-hex, e.g. 0x4020:0x0, 16416:0).
 *   - When the address is the indexed form, valueType is REQUIRED
 *     (the gateway cannot infer the type from a raw handle).
 *   - ADS value-type enum (bool / (u)int8..64 / float32/64 / string).
 *   - Mapping between the row FormGroup and the ADS model's flat
 *     persisted shape (multiplier / divider / adder / subtractor /
 *     scaling), handled by the CalibrationBlock CVA.
 *   - Numeric-type gate for calibration (bool / string can't be
 *     math-calibrated).
 */

/** Index-group/offset form: "<ig>:<io>", each decimal or 0x-hex. */
const ADS_INDEXED_ADDRESS_REGEX = /^\s*(0x[0-9a-fA-F]+|\d+)\s*:\s*(0x[0-9a-fA-F]+|\d+)\s*$/;

export function isAdsIndexedAddress(value: string): boolean {
  return ADS_INDEXED_ADDRESS_REGEX.test((value ?? '').toString());
}

/**
 * Cross-field validator applied to each key row: when the address is
 * an index-group/offset pair, the valueType becomes mandatory. The
 * error is projected onto the `valueType` control so both the detail
 * view (`hasError('valueTypeRequired')`) and the spreadsheet grid
 * (`control.invalid`) light up. Guarded so it converges instead of
 * looping when setErrors re-runs the group validator.
 */
function adsKeyRowValidator(group: AbstractControl): ValidationErrors | null {
  const addressCtrl = group.get('address');
  const valueTypeCtrl = group.get('valueType');
  if (!addressCtrl || !valueTypeCtrl) {
    return null;
  }
  const address = (addressCtrl.value ?? '').toString();
  const needsType = isAdsIndexedAddress(address) && !valueTypeCtrl.value;

  const currentErrors = valueTypeCtrl.errors ?? {};
  const hasErr = !!currentErrors['valueTypeRequired'];
  if (needsType && !hasErr) {
    valueTypeCtrl.setErrors({ ...currentErrors, valueTypeRequired: true });
  } else if (!needsType && hasErr) {
    const { valueTypeRequired, ...rest } = currentErrors;
    valueTypeCtrl.setErrors(Object.keys(rest).length ? rest : null);
  }
  return needsType ? { valueTypeRequired: true } : null;
}

@Component({
  selector: 'tb-ads-data-keys-panel',
  templateUrl: './ads-data-keys-panel.component.html',
  styleUrls: ['./ads-data-keys-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    ReactiveFormsModule,
    ReportStrategyComponent,
    IndustrialKeysPanelComponent,
    CalibrationBlockComponent,
  ],
})
export class AdsDataKeysPanelComponent implements OnInit {

  @Input() panelTitle = 'gateway.gw-data-keys';
  @Input() addKeyTitle = 'gateway.gw-add-key';
  @Input() deleteKeyTitle = 'gateway.gw-delete-key';
  @Input() noKeysText = 'gateway.keys-no-data-configured';
  @Input() keys: Array<AdsDataKey | AdsRpcConfig> = [];
  @Input() keysType: AdsValueKey = AdsValueKey.TIMESERIES;

  @Output() keysDataApplied = new EventEmitter<Array<AdsDataKey | AdsRpcConfig>>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild(IndustrialKeysPanelComponent) shell!: IndustrialKeysPanelComponent;

  readonly valueTypes = Object.values(AdsValueType);
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly AdsValueKey = AdsValueKey;

  keysFormArray: FormArray;
  spreadsheetColumns: SpreadsheetColumnConfig[] = [];
  searchFields: string[] = [];
  sortFields: IndustrialKeysSortFieldOption[] = [];

  /** ADS value types that support numeric calibration. Bool / String
   *  skip it. `''` (Auto) is treated as numeric since the actual type
   *  is resolved at read time and the backend skips non-numeric vals. */
  private static readonly NUMERIC_VALUE_TYPES = new Set<string>([
    '',
    AdsValueType.UINT8, AdsValueType.INT8,
    AdsValueType.UINT16, AdsValueType.INT16,
    AdsValueType.UINT32, AdsValueType.INT32,
    AdsValueType.UINT64, AdsValueType.INT64,
    AdsValueType.FLOAT32, AdsValueType.FLOAT64,
  ]);

  private fb = new FormBuilder();

  get isRpc(): boolean {
    return this.keysType === AdsValueKey.RPC;
  }

  canCalibrate(row: FormGroup): boolean {
    const vt = (row.get('valueType')?.value ?? '').toString();
    return AdsDataKeysPanelComponent.NUMERIC_VALUE_TYPES.has(vt);
  }

  isIndexedAddress(row: FormGroup): boolean {
    return isAdsIndexedAddress(row.get('address')?.value);
  }

  ngOnInit(): void {
    this.keysFormArray = this.fb.array([]);
    if (this.keys?.length) {
      this.keys.forEach(key => this.keysFormArray.push(this.createKeyForm(key)));
    }
    this.buildColumnConfigs();
  }

  onAddRequested(): void {
    const emptyKey = this.isRpc
      ? ({ method: '', address: '', valueType: null, operation: 'read' } as AdsRpcConfig)
      : ({ tag: '', address: '', valueType: null } as AdsDataKey);
    const form = this.createKeyForm(emptyKey);
    this.keysFormArray.push(form);
    this.keysFormArray.markAsDirty();
    this.shell?.setLastAddedId(form.getRawValue().id);
    this.shell?.refresh();
  }

  onDeleteRequested(index: number): void {
    this.keysFormArray.removeAt(index);
    this.keysFormArray.markAsDirty();
    this.shell?.refresh();
  }

  onApplyRequested(): void {
    if (this.keysFormArray.valid) {
      this.keysDataApplied.emit(this.getFormValue());
    }
  }

  onCancelRequested(): void {
    this.cancelled.emit();
  }

  private buildColumnConfigs(): void {
    if (this.isRpc) {
      this.searchFields = ['method', 'address'];
      this.sortFields = [
        { value: 'method', label: 'gateway.method' },
        { value: 'address', label: 'gateway.address' },
        { value: 'valueType', label: 'gateway.gw-value-type' },
        { value: 'operation', label: 'gateway.gw-operation' },
      ];
      this.spreadsheetColumns = [
        { key: 'method', label: 'gateway.method', type: 'input', sortable: true, width: 'minmax(150px, 1.4fr)', placeholder: 'setValue' },
        { key: 'address', label: 'gateway.address', type: 'input', sortable: true, width: 'minmax(150px, 1.4fr)', placeholder: 'MAIN.bReset', errorText: 'gateway.ads-invalid-address' },
        { key: 'valueType', label: 'gateway.gw-value-type', type: 'select', sortable: true, width: 'minmax(120px, 1fr)', translateLabels: true,
          errorText: 'gateway.ads-value-type-required',
          options: [{ value: '', label: 'gateway.gw-auto' }, ...this.valueTypes.map(t => ({ value: t, label: t }))] },
        { key: 'operation', label: 'gateway.gw-operation', type: 'select', sortable: true, width: 'minmax(120px, 1fr)', translateLabels: true,
          options: [{ value: 'read', label: 'gateway.gw-read' }, { value: 'write', label: 'gateway.gw-write' }] },
      ];
      return;
    }
    this.searchFields = ['tag', 'address'];
    this.sortFields = [
      { value: 'tag', label: 'gateway.gw-key' },
      { value: 'address', label: 'gateway.address' },
      { value: 'valueType', label: 'gateway.gw-value-type' },
    ];
    this.spreadsheetColumns = [
      { key: 'tag', label: 'gateway.gw-key', type: 'input', sortable: true, width: 'minmax(120px, 1.2fr)', placeholder: 'temperature' },
      { key: 'address', label: 'gateway.address', type: 'input', sortable: true, width: 'minmax(140px, 1.2fr)', placeholder: 'MAIN.fTemp', errorText: 'gateway.ads-invalid-address' },
      { key: 'valueType', label: 'gateway.gw-value-type', type: 'select', sortable: true, width: 'minmax(110px, 0.9fr)', translateLabels: true,
        errorText: 'gateway.ads-value-type-required',
        options: [{ value: '', label: 'gateway.gw-auto' }, ...this.valueTypes.map(t => ({ value: t, label: t }))] },
      ...calibrationColumns((row) => this.canCalibrate(row)),
      ...reportStrategyColumns(),
    ];
  }

  private createKeyForm(key: AdsDataKey | AdsRpcConfig): FormGroup {
    const id = generateSecret(5);
    if (this.isRpc) {
      const rpc = key as AdsRpcConfig;
      return this.fb.group({
        id: [{ value: id, disabled: true }],
        method: [rpc.method || '', [Validators.required]],
        address: [rpc.address || '', [Validators.required]],
        valueType: [rpc.valueType || ''],
        operation: [rpc.operation || 'read', [Validators.required]],
      }, { validators: adsKeyRowValidator });
    }
    const dataKey = key as AdsDataKey;
    const calibration: CalibrationConfig = {
      ...(dataKey.multiplier !== undefined && { multiplier: dataKey.multiplier }),
      ...(dataKey.divider !== undefined && { divider: dataKey.divider }),
      ...(dataKey.adder !== undefined && { adder: dataKey.adder }),
      ...(dataKey.subtractor !== undefined && { subtractor: dataKey.subtractor }),
      ...(dataKey.scaling && { scaling: dataKey.scaling }),
    };
    return this.fb.group({
      id: [{ value: id, disabled: true }],
      tag: [dataKey.tag || '', [Validators.required]],
      address: [dataKey.address || '', [Validators.required]],
      valueType: [dataKey.valueType || ''],
      calibration: [calibration],
      reportStrategy: [dataKey.reportStrategy || null],
    }, { validators: adsKeyRowValidator });
  }

  private getFormValue(): Array<AdsDataKey | AdsRpcConfig> {
    return this.keysFormArray.getRawValue().map((row: any) => {
      if (this.isRpc) {
        const { id: _id, ...rest } = row;
        return rest;
      }
      const out: any = {
        tag: row.tag,
        address: row.address,
      };
      if (row.valueType) out.valueType = row.valueType;
      // Calibration CVA emits the flat persisted shape directly —
      // `{multiplier: 0.1}` / `{scaling: {...}}` / `{}` depending on
      // the user-chosen mode. Spread into the output.
      if (row.calibration) Object.assign(out, row.calibration);
      if (row.reportStrategy) out.reportStrategy = row.reportStrategy;
      return out;
    });
  }
}
