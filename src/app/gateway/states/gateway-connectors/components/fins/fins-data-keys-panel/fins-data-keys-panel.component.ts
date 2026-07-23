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
import {
  FinsDataKey,
  FinsRpcConfig,
  FinsValueKey,
  FinsValueType,
  isFinsBitAddress,
  isValidFinsAddress,
} from '../../../models/public-api';
import { generateSecret } from '@core/public-api';

/**
 * FINS keys panel. Thin wrapper on the shared IndustrialKeysPanel
 * shell + CalibrationBlock CVA. This component owns the FINS-specific
 * concerns:
 *   - FINS address is a CX-Programmer-style memory address:
 *     D100 / DM100, CIO20 (or bare 20), W10, H5, A448, E0_100 (EM bank),
 *     T15 / C4 (timer/counter PV), with an optional .bit suffix (0-15)
 *     — e.g. D100.5, CIO20.07. Bit addresses are booleans.
 *   - Value type defaults to WORD (uint16) when left on Default; a bit
 *     address always reads as bool regardless.
 *   - Mapping between the row FormGroup and the model's flat persisted
 *     shape (multiplier / divider / adder / subtractor / scaling),
 *     handled by the CalibrationBlock CVA — same as S7 / ADS / Modbus.
 *   - Numeric-type gate for calibration (bool / string can't be
 *     math-calibrated).
 */

/**
 * Cross-field validator applied to each key row: the address must be a
 * valid FINS address, and a bit address (".NN" suffix) can only be a
 * bool. Errors are projected onto the controls so both the detail view
 * and the spreadsheet grid light up. Guarded so it converges instead of
 * looping when setErrors re-runs the group validator.
 */
function finsKeyRowValidator(group: AbstractControl): ValidationErrors | null {
  const addressCtrl = group.get('address');
  const valueTypeCtrl = group.get('valueType');
  if (!addressCtrl || !valueTypeCtrl) {
    return null;
  }
  const address = (addressCtrl.value ?? '').toString();

  const badAddress = !!address && !isValidFinsAddress(address);
  const addressErrors = addressCtrl.errors ?? {};
  const hasAddrErr = !!addressErrors['invalidFinsAddress'];
  if (badAddress && !hasAddrErr) {
    addressCtrl.setErrors({ ...addressErrors, invalidFinsAddress: true });
  } else if (!badAddress && hasAddrErr) {
    const { invalidFinsAddress, ...rest } = addressErrors;
    addressCtrl.setErrors(Object.keys(rest).length ? rest : null);
  }

  const valueType = (valueTypeCtrl.value ?? '').toString();
  const boolOnly = !badAddress && isFinsBitAddress(address)
    && !!valueType && valueType !== FinsValueType.BOOL;
  const typeErrors = valueTypeCtrl.errors ?? {};
  const hasTypeErr = !!typeErrors['boolOnly'];
  if (boolOnly && !hasTypeErr) {
    valueTypeCtrl.setErrors({ ...typeErrors, boolOnly: true });
  } else if (!boolOnly && hasTypeErr) {
    const { boolOnly: _b, ...rest } = typeErrors;
    valueTypeCtrl.setErrors(Object.keys(rest).length ? rest : null);
  }

  return (badAddress || boolOnly)
    ? { ...(badAddress && { invalidFinsAddress: true }), ...(boolOnly && { boolOnly: true }) }
    : null;
}

@Component({
  selector: 'tb-fins-data-keys-panel',
  templateUrl: './fins-data-keys-panel.component.html',
  styleUrls: ['./fins-data-keys-panel.component.scss'],
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
export class FinsDataKeysPanelComponent implements OnInit {

  @Input() panelTitle = 'gateway.gw-data-keys';
  @Input() addKeyTitle = 'gateway.gw-add-key';
  @Input() deleteKeyTitle = 'gateway.gw-delete-key';
  @Input() noKeysText = 'gateway.keys-no-data-configured';
  @Input() keys: Array<FinsDataKey | FinsRpcConfig> = [];
  @Input() keysType: FinsValueKey = FinsValueKey.TIMESERIES;

  @Output() keysDataApplied = new EventEmitter<Array<FinsDataKey | FinsRpcConfig>>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild(IndustrialKeysPanelComponent) shell!: IndustrialKeysPanelComponent;

  readonly valueTypes = Object.values(FinsValueType);
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly FinsValueKey = FinsValueKey;

  keysFormArray: FormArray;
  spreadsheetColumns: SpreadsheetColumnConfig[] = [];
  searchFields: string[] = [];
  sortFields: IndustrialKeysSortFieldOption[] = [];

  /** FINS value types that support numeric calibration. Bool / String
   *  skip it. `''` (Default = word) is numeric. */
  private static readonly NUMERIC_VALUE_TYPES = new Set<string>([
    '',
    FinsValueType.UINT16, FinsValueType.INT16,
    FinsValueType.UINT32, FinsValueType.INT32,
    FinsValueType.UINT64, FinsValueType.INT64,
    FinsValueType.FLOAT32, FinsValueType.FLOAT64,
  ]);

  private fb = new FormBuilder();

  get isRpc(): boolean {
    return this.keysType === FinsValueKey.RPC;
  }

  canCalibrate(row: FormGroup): boolean {
    const vt = (row.get('valueType')?.value ?? '').toString();
    if (isFinsBitAddress(row.get('address')?.value)) {
      return false;
    }
    return FinsDataKeysPanelComponent.NUMERIC_VALUE_TYPES.has(vt);
  }

  isBitAddress(row: FormGroup): boolean {
    return isFinsBitAddress(row.get('address')?.value);
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
      ? ({ method: '', address: '', valueType: null, operation: 'read' } as FinsRpcConfig)
      : ({ tag: '', address: '', valueType: null } as FinsDataKey);
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
    const valueTypeOptions = [
      { value: '', label: 'gateway.fins-value-type-default' },
      ...this.valueTypes.map(t => ({ value: t, label: t })),
    ];
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
        { key: 'address', label: 'gateway.address', type: 'input', sortable: true, width: 'minmax(150px, 1.4fr)', placeholder: 'D102', errorText: 'gateway.fins-invalid-address' },
        { key: 'valueType', label: 'gateway.gw-value-type', type: 'select', sortable: true, width: 'minmax(120px, 1fr)', translateLabels: true,
          errorText: 'gateway.fins-bool-only',
          options: valueTypeOptions },
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
      { key: 'address', label: 'gateway.address', type: 'input', sortable: true, width: 'minmax(140px, 1.2fr)', placeholder: 'D100', errorText: 'gateway.fins-invalid-address' },
      { key: 'valueType', label: 'gateway.gw-value-type', type: 'select', sortable: true, width: 'minmax(110px, 0.9fr)', translateLabels: true,
        errorText: 'gateway.fins-bool-only',
        options: valueTypeOptions },
      ...calibrationColumns((row) => this.canCalibrate(row)),
      ...reportStrategyColumns(),
    ];
  }

  private createKeyForm(key: FinsDataKey | FinsRpcConfig): FormGroup {
    const id = generateSecret(5);
    if (this.isRpc) {
      const rpc = key as FinsRpcConfig;
      return this.fb.group({
        id: [{ value: id, disabled: true }],
        method: [rpc.method || '', [Validators.required]],
        address: [rpc.address || '', [Validators.required]],
        valueType: [rpc.valueType || ''],
        operation: [rpc.operation || 'read', [Validators.required]],
      }, { validators: finsKeyRowValidator });
    }
    const dataKey = key as FinsDataKey;
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
    }, { validators: finsKeyRowValidator });
  }

  private getFormValue(): Array<FinsDataKey | FinsRpcConfig> {
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
