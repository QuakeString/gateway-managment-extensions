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
import { EtherCatDataKey, EtherCatRpcConfig, EtherCatValueKey, EtherCatValueType } from '../../../models/public-api';
import { generateSecret } from '@core/public-api';

/**
 * EtherCAT keys panel. Thin wrapper on the shared IndustrialKeysPanel
 * shell + CalibrationBlock CVA. This component owns the EtherCAT-specific
 * concerns:
 *   - EtherCAT address is EITHER a process-data form
 *     "pdo:<byteOffset>[.<bit>]" (the optional `.bit` addresses a single
 *     bit and is only valid for a bool value type — a bool PDO must
 *     always carry a `.bit`) OR a mailbox object dictionary form
 *     "sdo:<index>:<subindex>" (decimal or 0x-hex).
 *   - valueType is ALWAYS required (unlike ADS the gateway never infers
 *     the type from the wire).
 *   - EtherCAT value-type enum (bool / (u)int8..64 / float32/64 / string).
 *   - Mapping between the row FormGroup and the EtherCAT model's flat
 *     persisted shape (multiplier / divider / adder / subtractor /
 *     scaling), handled by the CalibrationBlock CVA.
 *   - Numeric-type gate for calibration (bool / string can't be
 *     math-calibrated).
 */

/** PDO form: "pdo:<byteOffset>[.<bit>]". */
const ETHERCAT_PDO_ADDRESS_REGEX = /^\s*pdo\s*:\s*(\d+)(?:\.(\d+))?\s*$/i;
/** SDO form: "sdo:<index>:<subindex>", each decimal or 0x-hex. */
const ETHERCAT_SDO_ADDRESS_REGEX = /^\s*sdo\s*:\s*(0x[0-9a-fA-F]+|\d+)\s*:\s*(0x[0-9a-fA-F]+|\d+)\s*$/i;

export interface EtherCatAddressParse {
  kind: 'pdo' | 'sdo' | null;
  /** For a PDO address, true when the `.bit` suffix is present. */
  hasBit: boolean;
}

export function parseEtherCatAddress(value: string): EtherCatAddressParse {
  const address = (value ?? '').toString();
  const pdo = ETHERCAT_PDO_ADDRESS_REGEX.exec(address);
  if (pdo) {
    return { kind: 'pdo', hasBit: pdo[2] !== undefined };
  }
  if (ETHERCAT_SDO_ADDRESS_REGEX.test(address)) {
    return { kind: 'sdo', hasBit: false };
  }
  return { kind: null, hasBit: false };
}

/**
 * Cross-field validator applied to each key row. Enforces:
 *   1. address must match the PDO or SDO form (else `invalidAddress`
 *      on the address control);
 *   2. valueType is required on every row (`valueTypeRequired` on the
 *      valueType control);
 *   3. a PDO with a `.bit` suffix must be a `bool` (`bitRequiresBool`);
 *   4. a `bool` PDO must carry a `.bit` suffix (`boolRequiresBit`
 *      surfaced on the address control).
 * Errors are projected onto the individual controls so both the detail
 * view and the spreadsheet grid (`control.invalid`) light up. Guarded so
 * it converges instead of looping when setErrors re-runs the validator.
 */
function etherCatKeyRowValidator(group: AbstractControl): ValidationErrors | null {
  const addressCtrl = group.get('address');
  const valueTypeCtrl = group.get('valueType');
  if (!addressCtrl || !valueTypeCtrl) {
    return null;
  }
  const address = (addressCtrl.value ?? '').toString().trim();
  const valueType = (valueTypeCtrl.value ?? '').toString();
  const parsed = parseEtherCatAddress(address);

  // --- address control errors: invalidAddress + boolRequiresBit ---
  const addrErrors = { ...(addressCtrl.errors ?? {}) };
  let addrChanged = false;
  const setAddr = (key: string, on: boolean) => {
    if (on && !addrErrors[key]) { addrErrors[key] = true; addrChanged = true; }
    else if (!on && addrErrors[key]) { delete addrErrors[key]; addrChanged = true; }
  };
  // Only flag a bad format when something was actually typed — the
  // empty case is handled by the `Validators.required` on the control.
  setAddr('invalidAddress', !!address && parsed.kind === null);
  setAddr('boolRequiresBit', parsed.kind === 'pdo' && !parsed.hasBit && valueType === EtherCatValueType.BOOL);
  if (addrChanged) {
    const preserved = { ...addrErrors };
    // keep the built-in required error if present
    addressCtrl.setErrors(Object.keys(preserved).length ? preserved : null);
  }

  // --- valueType control errors: valueTypeRequired + bitRequiresBool ---
  const vtErrors = { ...(valueTypeCtrl.errors ?? {}) };
  let vtChanged = false;
  const setVt = (key: string, on: boolean) => {
    if (on && !vtErrors[key]) { vtErrors[key] = true; vtChanged = true; }
    else if (!on && vtErrors[key]) { delete vtErrors[key]; vtChanged = true; }
  };
  setVt('valueTypeRequired', !valueType);
  setVt('bitRequiresBool', parsed.kind === 'pdo' && parsed.hasBit && !!valueType && valueType !== EtherCatValueType.BOOL);
  if (vtChanged) {
    valueTypeCtrl.setErrors(Object.keys(vtErrors).length ? vtErrors : null);
  }

  const rowInvalid = (!!address && parsed.kind === null)
    || !valueType
    || (parsed.kind === 'pdo' && parsed.hasBit && !!valueType && valueType !== EtherCatValueType.BOOL)
    || (parsed.kind === 'pdo' && !parsed.hasBit && valueType === EtherCatValueType.BOOL);
  return rowInvalid ? { etherCatRowInvalid: true } : null;
}

@Component({
  selector: 'tb-ethercat-data-keys-panel',
  templateUrl: './ethercat-data-keys-panel.component.html',
  styleUrls: ['./ethercat-data-keys-panel.component.scss'],
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
export class EtherCatDataKeysPanelComponent implements OnInit {

  @Input() panelTitle = 'gateway.gw-data-keys';
  @Input() addKeyTitle = 'gateway.gw-add-key';
  @Input() deleteKeyTitle = 'gateway.gw-delete-key';
  @Input() noKeysText = 'gateway.keys-no-data-configured';
  @Input() keys: Array<EtherCatDataKey | EtherCatRpcConfig> = [];
  @Input() keysType: EtherCatValueKey = EtherCatValueKey.TIMESERIES;

  @Output() keysDataApplied = new EventEmitter<Array<EtherCatDataKey | EtherCatRpcConfig>>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild(IndustrialKeysPanelComponent) shell!: IndustrialKeysPanelComponent;

  readonly valueTypes = Object.values(EtherCatValueType);
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly EtherCatValueKey = EtherCatValueKey;

  keysFormArray: FormArray;
  spreadsheetColumns: SpreadsheetColumnConfig[] = [];
  searchFields: string[] = [];
  sortFields: IndustrialKeysSortFieldOption[] = [];

  /** EtherCAT value types that support numeric calibration. Bool /
   *  String skip it. */
  private static readonly NUMERIC_VALUE_TYPES = new Set<string>([
    EtherCatValueType.UINT8, EtherCatValueType.INT8,
    EtherCatValueType.UINT16, EtherCatValueType.INT16,
    EtherCatValueType.UINT32, EtherCatValueType.INT32,
    EtherCatValueType.UINT64, EtherCatValueType.INT64,
    EtherCatValueType.FLOAT32, EtherCatValueType.FLOAT64,
  ]);

  private fb = new FormBuilder();

  get isRpc(): boolean {
    return this.keysType === EtherCatValueKey.RPC;
  }

  canCalibrate(row: FormGroup): boolean {
    const vt = (row.get('valueType')?.value ?? '').toString();
    return EtherCatDataKeysPanelComponent.NUMERIC_VALUE_TYPES.has(vt);
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
      ? ({ method: '', address: '', valueType: null, operation: 'read' } as EtherCatRpcConfig)
      : ({ tag: '', address: '', valueType: null } as EtherCatDataKey);
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
    const valueTypeOptions = this.valueTypes.map(t => ({ value: t, label: t }));
    if (this.isRpc) {
      this.searchFields = ['method', 'address'];
      this.sortFields = [
        { value: 'method', label: 'gateway.method' },
        { value: 'address', label: 'gateway.address' },
        { value: 'valueType', label: 'gateway.gw-value-type' },
        { value: 'operation', label: 'gateway.gw-operation' },
      ];
      this.spreadsheetColumns = [
        { key: 'method', label: 'gateway.method', type: 'input', sortable: true, width: 'minmax(150px, 1.4fr)', placeholder: 'reset' },
        { key: 'address', label: 'gateway.address', type: 'input', sortable: true, width: 'minmax(150px, 1.4fr)', placeholder: 'pdo:2.1', errorText: 'gateway.ethercat-invalid-address' },
        { key: 'valueType', label: 'gateway.gw-value-type', type: 'select', sortable: true, width: 'minmax(120px, 1fr)', translateLabels: true,
          errorText: 'gateway.ethercat-value-type-required',
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
      { key: 'tag', label: 'gateway.gw-key', type: 'input', sortable: true, width: 'minmax(120px, 1.2fr)', placeholder: 'statusWord' },
      { key: 'address', label: 'gateway.address', type: 'input', sortable: true, width: 'minmax(140px, 1.2fr)', placeholder: 'pdo:0', errorText: 'gateway.ethercat-invalid-address' },
      { key: 'valueType', label: 'gateway.gw-value-type', type: 'select', sortable: true, width: 'minmax(110px, 0.9fr)', translateLabels: true,
        errorText: 'gateway.ethercat-value-type-required',
        options: valueTypeOptions },
      ...calibrationColumns((row) => this.canCalibrate(row)),
      ...reportStrategyColumns(),
    ];
  }

  private createKeyForm(key: EtherCatDataKey | EtherCatRpcConfig): FormGroup {
    const id = generateSecret(5);
    if (this.isRpc) {
      const rpc = key as EtherCatRpcConfig;
      return this.fb.group({
        id: [{ value: id, disabled: true }],
        method: [rpc.method || '', [Validators.required]],
        address: [rpc.address || '', [Validators.required]],
        valueType: [rpc.valueType || ''],
        operation: [rpc.operation || 'read', [Validators.required]],
      }, { validators: etherCatKeyRowValidator });
    }
    const dataKey = key as EtherCatDataKey;
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
    }, { validators: etherCatKeyRowValidator });
  }

  private getFormValue(): Array<EtherCatDataKey | EtherCatRpcConfig> {
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
