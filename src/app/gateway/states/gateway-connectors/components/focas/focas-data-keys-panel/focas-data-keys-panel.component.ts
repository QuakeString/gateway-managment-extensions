///
/// Copyright © 2016-2025 The SENTIENT Authors
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
  KeysWriteHandler,
  IndustrialKeysSortFieldOption,
  ReportStrategyComponent,
  calibrationColumns,
  reportStrategyColumns,
} from '../../../../../shared/components/public-api';
import { SpreadsheetColumnConfig } from '../../../../../shared/components/spreadsheet-keys/spreadsheet-keys.models';
import {
  FocasDataKey,
  FocasRpcConfig,
  FocasValueKey,
  FocasValueType,
  FOCAS_ADDRESS_EXAMPLES,
  isFocasBitAddress,
  isFocasNumericAddress,
  isFocasPmcAddress,
  isValidFocasAddress,
} from '../../../models/public-api';
import { generateSecret } from '@core/public-api';

/**
 * Fanuc FOCAS keys panel, on the shared IndustrialKeysPanel shell and the
 * CalibrationBlock CVA. The address is the gateway's FOCAS grammar:
 * named CNC values (status.state, alarm.first, program.main,
 * spindle.actual, position.abs.X ...) and the numbered tables
 * param:6711, diag:411, macro:500, pmc:D100 / pmc:R100.3. Only PMC keys
 * take a value type; a bit address is a bool.
 */

/**
 * Cross-field validator applied to each key row: the address must be a
 * valid FOCAS address, and a bit address (".NN" suffix) can only be a
 * bool. Errors are projected onto the controls so both the detail view
 * and the spreadsheet grid light up. Guarded so it converges instead of
 * looping when setErrors re-runs the group validator.
 */
function focasKeyRowValidator(group: AbstractControl): ValidationErrors | null {
  const addressCtrl = group.get('address');
  const valueTypeCtrl = group.get('valueType');
  if (!addressCtrl || !valueTypeCtrl) {
    return null;
  }
  const address = (addressCtrl.value ?? '').toString();

  const badAddress = !!address && !isValidFocasAddress(address);
  const addressErrors = addressCtrl.errors ?? {};
  const hasAddrErr = !!addressErrors['invalidFocasAddress'];
  if (badAddress && !hasAddrErr) {
    addressCtrl.setErrors({ ...addressErrors, invalidFocasAddress: true });
  } else if (!badAddress && hasAddrErr) {
    const { invalidFocasAddress, ...rest } = addressErrors;
    addressCtrl.setErrors(Object.keys(rest).length ? rest : null);
  }

  const valueType = (valueTypeCtrl.value ?? '').toString();
  const boolOnly = !badAddress && isFocasPmcAddress(address) && isFocasBitAddress(address)
    && !!valueType && valueType !== FocasValueType.BOOL;
  const typeErrors = valueTypeCtrl.errors ?? {};
  const hasTypeErr = !!typeErrors['boolOnly'];
  if (boolOnly && !hasTypeErr) {
    valueTypeCtrl.setErrors({ ...typeErrors, boolOnly: true });
  } else if (!boolOnly && hasTypeErr) {
    const { boolOnly: _b, ...rest } = typeErrors;
    valueTypeCtrl.setErrors(Object.keys(rest).length ? rest : null);
  }

  return (badAddress || boolOnly)
    ? { ...(badAddress && { invalidFocasAddress: true }), ...(boolOnly && { boolOnly: true }) }
    : null;
}

@Component({
  selector: 'tb-focas-data-keys-panel',
  templateUrl: './focas-data-keys-panel.component.html',
  styleUrls: ['./focas-data-keys-panel.component.scss'],
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
export class FocasDataKeysPanelComponent implements OnInit {

  @Input() panelTitle = 'gateway.gw-data-keys';
  @Input() addKeyTitle = 'gateway.gw-add-key';
  @Input() deleteKeyTitle = 'gateway.gw-delete-key';
  @Input() noKeysText = 'gateway.keys-no-data-configured';
  @Input() keys: Array<FocasDataKey | FocasRpcConfig> = [];
  @Input() keysType: FocasValueKey = FocasValueKey.TIMESERIES;
  /** Set on time-series / attribute panels: tick keys and add them to
   *  RPC write or attribute updates. */
  @Input() writeHandler: KeysWriteHandler | null = null;
  readonly persistedKeys = (): any[] => this.getFormValue();

  @Output() keysDataApplied = new EventEmitter<Array<FocasDataKey | FocasRpcConfig>>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild(IndustrialKeysPanelComponent) shell!: IndustrialKeysPanelComponent;

  readonly valueTypes = Object.values(FocasValueType);
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly FocasValueKey = FocasValueKey;

  keysFormArray: FormArray;
  spreadsheetColumns: SpreadsheetColumnConfig[] = [];
  searchFields: string[] = [];
  sortFields: IndustrialKeysSortFieldOption[] = [];

  private fb = new FormBuilder();

  get isRpc(): boolean {
    return this.keysType === FocasValueKey.RPC;
  }

  canCalibrate(row: FormGroup): boolean {
    const address = row.get('address')?.value;
    if (isFocasPmcAddress(address)) {
      return (row.get('valueType')?.value ?? '') !== FocasValueType.BOOL && !isFocasBitAddress(address);
    }
    return isFocasNumericAddress(address);
  }

  isPmc(row: FormGroup): boolean {
    return isFocasPmcAddress(row.get('address')?.value);
  }

  /** Suggestions for the address field, narrowed by what is typed. */
  addressExamples(row: FormGroup): string[] {
    const typed = (row.get('address')?.value ?? '').toString().trim().toLowerCase();
    return typed
      ? FOCAS_ADDRESS_EXAMPLES.filter(a => a.toLowerCase().includes(typed))
      : FOCAS_ADDRESS_EXAMPLES;
  }

  isBitAddress(row: FormGroup): boolean {
    return isFocasBitAddress(row.get('address')?.value);
  }

  ngOnInit(): void {
    // Built in one go: pushing one by one revalidates the whole array per
    // push, which took seconds on a PLC with thousands of tags.
    this.keysFormArray = this.fb.array((this.keys ?? []).map(entry => this.createKeyForm(entry)));
    this.buildColumnConfigs();
  }

  onAddRequested(): void {
    const emptyKey = this.isRpc
      ? ({ method: '', address: '', valueType: null, operation: 'read' } as FocasRpcConfig)
      : ({ tag: '', address: '', valueType: null } as FocasDataKey);
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
      { value: '', label: 'gateway.focas-value-type-default' },
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
        { key: 'method', label: 'gateway.method', type: 'input', fill: 'series', sortable: true, width: 'minmax(150px, 1.4fr)', placeholder: 'readPartsCount' },
        { key: 'address', label: 'gateway.address', type: 'input', sortable: true, width: 'minmax(150px, 1.4fr)', placeholder: 'param:6711', errorText: 'gateway.focas-invalid-address' },
        { key: 'valueType', label: 'gateway.gw-value-type', type: 'select', sortable: true, width: 'minmax(120px, 1fr)', translateLabels: true,
          errorText: 'gateway.focas-bool-only',
          options: valueTypeOptions },
        { key: 'operation', label: 'gateway.gw-operation', type: 'select', sortable: true, width: 'minmax(120px, 1fr)', translateLabels: true,
          options: [{ value: 'read', label: 'gateway.gw-read' }] },
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
      { key: 'tag', label: 'gateway.gw-key', type: 'input', fill: 'series', sortable: true, width: 'minmax(120px, 1.2fr)', placeholder: 'partsCount' },
      { key: 'address', label: 'gateway.address', type: 'input', sortable: true, width: 'minmax(140px, 1.2fr)', placeholder: 'param:6711', errorText: 'gateway.focas-invalid-address' },
      { key: 'valueType', label: 'gateway.gw-value-type', type: 'select', sortable: true, width: 'minmax(110px, 0.9fr)', translateLabels: true,
        errorText: 'gateway.focas-bool-only',
        options: valueTypeOptions },
      ...calibrationColumns((row) => this.canCalibrate(row)),
      ...reportStrategyColumns(),
    ];
  }

  private createKeyForm(key: FocasDataKey | FocasRpcConfig): FormGroup {
    const id = generateSecret(5);
    if (this.isRpc) {
      const rpc = key as FocasRpcConfig;
      return this.fb.group({
        id: [{ value: id, disabled: true }],
        method: [rpc.method || '', [Validators.required]],
        address: [rpc.address || '', [Validators.required]],
        valueType: [rpc.valueType || ''],
        operation: [rpc.operation || 'read', [Validators.required]],
      }, { validators: focasKeyRowValidator });
    }
    const dataKey = key as FocasDataKey;
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
    }, { validators: focasKeyRowValidator });
  }

  private getFormValue(): Array<FocasDataKey | FocasRpcConfig> {
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
