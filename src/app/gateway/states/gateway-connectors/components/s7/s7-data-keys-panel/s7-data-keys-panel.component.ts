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
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import {
  nonZeroFloat,
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
import { S7DataKey, S7RpcConfig, S7ValueKey, S7ValueType } from '../../../models/public-api';
import { generateSecret } from '@core/public-api';

/**
 * S7 keys panel. Thin wrapper on the shared IndustrialKeysPanel
 * shell + CalibrationBlock CVA. This component now only owns S7-
 * specific concerns:
 *   - S7 address regex validator (DB1.DBD0, M0.0, IW20, etc.)
 *   - S7 value-type enum (UINT8..FLOAT64 / STRING / BOOL)
 *   - Mapping between the row FormGroup and the S7 model's flat
 *     persisted shape (multiplier / divider / adder / subtractor /
 *     scaling), handled by the CalibrationBlock CVA.
 *   - Numeric-type gate for calibration (bool / string can't be
 *     math-calibrated).
 */

// Accepts SIMATIC dot notation (DB1.DBW0, MW100, I0.0), WinCC comma
// notation (DB1,W0 / DB1,DBW0 / DB1,X0.0 / DB1,INT2 / DB1,REAL8 /
// DB1,S20.30), German mnemonics (E/A/Z) and an optional leading '%'
// (IEC notation from TIA Portal exports).
const S7_ADDRESS_REGEX = /^%?(DB\d+\.DB[XBWDL]\d+(\.\d+)?|DB\d+\s*,\s*((DBX|X)\d+(\.\d+)?|(DB[BWDL]|BYTE|BY|B|CHAR|C|WORD|W|INT|I|DWORD|DINT|DW|DI|LREAL|LR|REAL|R)\d+|(STRING|S)\d+\.\d+)|[MIQEA]\d+\.\d+|[MIQEA][BWDLR]\d+|[CTZ]\d+)$/i;

@Component({
  selector: 'tb-s7-data-keys-panel',
  templateUrl: './s7-data-keys-panel.component.html',
  styleUrls: ['./s7-data-keys-panel.component.scss'],
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
export class S7DataKeysPanelComponent implements OnInit {

  @Input() panelTitle = 'gateway.gw-data-keys';
  @Input() addKeyTitle = 'gateway.gw-add-key';
  @Input() deleteKeyTitle = 'gateway.gw-delete-key';
  @Input() noKeysText = 'gateway.keys-no-data-configured';
  @Input() keys: Array<S7DataKey | S7RpcConfig> = [];
  @Input() keysType: S7ValueKey = S7ValueKey.TIMESERIES;

  @Output() keysDataApplied = new EventEmitter<Array<S7DataKey | S7RpcConfig>>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild(IndustrialKeysPanelComponent) shell!: IndustrialKeysPanelComponent;

  readonly valueTypes = Object.values(S7ValueType);
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly S7ValueKey = S7ValueKey;

  keysFormArray: FormArray;
  spreadsheetColumns: SpreadsheetColumnConfig[] = [];
  searchFields: string[] = [];
  sortFields: IndustrialKeysSortFieldOption[] = [];

  /** S7 value types that support numeric calibration. Bool / String
   *  skip it. `''` (Auto) is treated as numeric since the actual type
   *  is resolved at read time and the backend skips non-numeric vals. */
  private static readonly NUMERIC_VALUE_TYPES = new Set<string>([
    '',
    S7ValueType.UINT8, S7ValueType.INT8,
    S7ValueType.UINT16, S7ValueType.INT16,
    S7ValueType.UINT32, S7ValueType.INT32,
    S7ValueType.FLOAT32, S7ValueType.FLOAT64,
  ]);

  private fb = new FormBuilder();

  get isRpc(): boolean {
    return this.keysType === S7ValueKey.RPC;
  }

  canCalibrate(row: FormGroup): boolean {
    const vt = (row.get('valueType')?.value ?? '').toString();
    return S7DataKeysPanelComponent.NUMERIC_VALUE_TYPES.has(vt);
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
      ? ({ method: '', address: '', valueType: null, operation: 'read' } as S7RpcConfig)
      : ({ tag: '', address: '', valueType: null } as S7DataKey);
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

  /** Uppercase the S7 address field as the operator types. S7 address
   *  syntax is case-insensitive (DB1.DBD0 == db1.dbd0) but the UI
   *  canonicalises on uppercase so copy/paste from other tools reads
   *  consistently. */
  onAddressInput(row: FormGroup): void {
    const ctrl = row.get('address');
    if (!ctrl) return;
    const val = ctrl.value;
    const upper = typeof val === 'string' ? val.toUpperCase() : val;
    if (val !== upper) ctrl.setValue(upper, { emitEvent: false });
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
        { key: 'address', label: 'gateway.address', type: 'input', sortable: true, width: 'minmax(150px, 1.4fr)', placeholder: 'DB1.DBD0', uppercase: true, errorText: 'gateway.s7-invalid-address' },
        { key: 'valueType', label: 'gateway.gw-value-type', type: 'select', sortable: true, width: 'minmax(120px, 1fr)', translateLabels: true,
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
      { key: 'address', label: 'gateway.address', type: 'input', sortable: true, width: 'minmax(140px, 1.2fr)', placeholder: 'DB1.DBD0', uppercase: true, errorText: 'gateway.s7-invalid-address' },
      { key: 'valueType', label: 'gateway.gw-value-type', type: 'select', sortable: true, width: 'minmax(110px, 0.9fr)', translateLabels: true,
        options: [{ value: '', label: 'gateway.gw-auto' }, ...this.valueTypes.map(t => ({ value: t, label: t }))] },
      ...calibrationColumns((row) => this.canCalibrate(row)),
      ...reportStrategyColumns(),
    ];
  }

  private createKeyForm(key: S7DataKey | S7RpcConfig): FormGroup {
    const id = generateSecret(5);
    if (this.isRpc) {
      const rpc = key as S7RpcConfig;
      return this.fb.group({
        id: [{ value: id, disabled: true }],
        method: [rpc.method || '', [Validators.required]],
        address: [rpc.address || '', [Validators.required, Validators.pattern(S7_ADDRESS_REGEX)]],
        valueType: [rpc.valueType || ''],
        operation: [rpc.operation || 'read', [Validators.required]],
      });
    }
    const dataKey = key as S7DataKey;
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
      address: [dataKey.address || '', [Validators.required, Validators.pattern(S7_ADDRESS_REGEX)]],
      valueType: [dataKey.valueType || ''],
      calibration: [calibration],
      reportStrategy: [dataKey.reportStrategy || null],
    });
  }

  private getFormValue(): Array<S7DataKey | S7RpcConfig> {
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
