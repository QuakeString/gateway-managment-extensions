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
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  UntypedFormGroup,
  Validators,
} from '@angular/forms';
import { TbPopoverComponent } from '@shared/components/popover.component';
import {
  ModbusDataType,
  ModbusEditableDataTypes,
  ModbusFunctionCodeTranslationsMap,
  ModbusObjectCountByDataType,
  noLeadTrailSpacesRegex,
  ReportStrategyDefaultValue,
  TruncateWithTooltipDirective,
} from '../../../../../shared/public-api';
import {
  ModbusBitTargetType,
  ModbusBitTargetTypeTranslationMap,
  ModbusValue,
  ModbusValueKey,
} from '../../../models/public-api';
import { CommonModule } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { generateSecret } from '@core/public-api';
import { coerceBoolean, SharedModule } from '@shared/public-api';
import { filter, takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import {
  CalibrationBlockComponent,
  CalibrationConfig,
  IndustrialKeysPanelComponent,
  IndustrialKeysSortFieldOption,
  ReportStrategyComponent,
  calibrationColumns,
  reportStrategyColumns,
} from '../../../../../shared/components/public-api';
import { SpreadsheetColumnConfig, SelectOption } from '../../../../../shared/components/spreadsheet-keys/spreadsheet-keys.models';

/**
 * Modbus keys panel. Migrated onto the shared IndustrialKeysPanel
 * shell + CalibrationBlock CVA. Connector-specific bits retained:
 *   - Modbus data type + function code + objectsCount
 *   - Bits-typed rows: per-row `bit` + `bitTargetType` visible when
 *     type === BITS + objectsCount > 1
 *   - Master mode (adds a `value` column, disables most editing)
 *   - Type-change observers that keep function codes + objects
 *     count consistent as the operator flips between data types
 */
@Component({
  selector: 'tb-modbus-data-keys-panel',
  templateUrl: './modbus-data-keys-panel.component.html',
  styleUrls: ['./modbus-data-keys-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    ReactiveFormsModule,
    ReportStrategyComponent,
    TruncateWithTooltipDirective,
    IndustrialKeysPanelComponent,
    CalibrationBlockComponent,
  ],
})
export class ModbusDataKeysPanelComponent implements OnInit, OnDestroy {

  @coerceBoolean()
  @Input() isMaster = false;
  @coerceBoolean()
  @Input() hideNewFields = false;
  @Input() panelTitle = 'Data Keys';
  @Input() addKeyTitle = 'Add key';
  @Input() deleteKeyTitle = 'Delete key';
  @Input() noKeysText = 'No data keys configured';
  @Input() keysType: ModbusValueKey;
  @Input() values: ModbusValue[] = [];

  @Output() keysDataApplied = new EventEmitter<Array<ModbusValue>>();

  @ViewChild(IndustrialKeysPanelComponent) shell!: IndustrialKeysPanelComponent;

  keysFormArray: FormArray<UntypedFormGroup>;
  withFunctionCode = true;
  withReportStrategy = true;

  functionCodesMap = new Map<string, number[]>();
  defaultFunctionCodes: number[] = [];

  readonly modbusDataTypes = Object.values(ModbusDataType);
  readonly bitTargetTypes: ModbusBitTargetType[] = Object.values(ModbusBitTargetType) as ModbusBitTargetType[];
  readonly BitTargetTypeTranslationMap = ModbusBitTargetTypeTranslationMap;
  readonly ModbusEditableDataTypes = ModbusEditableDataTypes;
  readonly ModbusFunctionCodeTranslationsMap = ModbusFunctionCodeTranslationsMap;
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly ModbusDataType = ModbusDataType;
  readonly ModbusValueKey = ModbusValueKey;

  spreadsheetColumns: SpreadsheetColumnConfig[] = [];
  searchFields: string[] = [];
  sortFields: IndustrialKeysSortFieldOption[] = [
    { value: 'tag', label: 'Key' },
    { value: 'type', label: 'Data Type' },
    { value: 'address', label: 'Address' },
  ];

  private destroy$ = new Subject<void>();

  private readonly defaultReadFunctionCodes = [3, 4];
  private readonly bitsReadFunctionCodes = [1, 2];
  private readonly defaultWriteFunctionCodes = [6, 16];
  private readonly bitsWriteFunctionCodes = [5, 15];

  constructor(
    private fb: FormBuilder,
    private popover: TbPopoverComponent<ModbusDataKeysPanelComponent>,
    private translate: TranslateService,
  ) {}

  /** Callers pass translation keys — translate here because the
   *  shell component takes plain strings for its toolbar labels. */
  get translatedTitle(): string {
    return this.panelTitle ? this.translate.instant(this.panelTitle) : '';
  }
  get translatedAddLabel(): string {
    return this.addKeyTitle ? this.translate.instant(this.addKeyTitle) : '';
  }
  get translatedDeleteTitle(): string {
    return this.deleteKeyTitle ? this.translate.instant(this.deleteKeyTitle) : '';
  }
  get translatedEmptyText(): string {
    return this.noKeysText ? this.translate.instant(this.noKeysText) : '';
  }

  ngOnInit(): void {
    this.withFunctionCode = !this.isMaster || (this.keysType !== ModbusValueKey.ATTRIBUTES && this.keysType !== ModbusValueKey.TIMESERIES);
    this.withReportStrategy = !this.isMaster
      && (this.keysType === ModbusValueKey.ATTRIBUTES || this.keysType === ModbusValueKey.TIMESERIES)
      && !this.hideNewFields;
    this.defaultFunctionCodes = this.getDefaultFunctionCodes();
    this.keysFormArray = this.fb.array<UntypedFormGroup>([]);
    if (this.values?.length) {
      this.values.forEach(v => this.keysFormArray.push(this.createKeyForm(v)));
    }
    this.buildColumnConfigs();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Non-Modbus-editable types (bytes / bits / string) can't be
   *  calibrated — the calibration CVA is hidden for them. Master
   *  mode and non-data key types (RPC etc) also skip calibration. */
  canCalibrate(row: FormGroup): boolean {
    if (this.isMaster) return false;
    if (this.keysType !== ModbusValueKey.ATTRIBUTES && this.keysType !== ModbusValueKey.TIMESERIES) return false;
    const type = row.get('type')?.value as ModbusDataType;
    return !this.ModbusEditableDataTypes.includes(type);
  }

  onAddRequested(): void {
    const emptyValue: ModbusValue = {
      tag: '',
      type: ModbusDataType.BYTES,
      address: 0,
      objectsCount: 1,
      functionCode: this.defaultFunctionCodes[0],
    } as ModbusValue;
    const form = this.createKeyForm(emptyValue);
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
    this.keysDataApplied.emit(this.getFormValue());
  }

  onCancelRequested(): void {
    this.popover?.hide();
  }

  private buildColumnConfigs(): void {
    this.searchFields = ['tag', 'address'];
    const dataTypeOptions: SelectOption[] = this.modbusDataTypes.map(t => ({ value: t, label: t }));
    const cols: SpreadsheetColumnConfig[] = [
      { key: 'tag', label: 'Key', type: 'input', sortable: true, width: 'minmax(120px, 1.2fr)', placeholder: 'Tag' },
      { key: 'type', label: 'Data Type', type: 'select', sortable: true, width: 'minmax(100px, 0.8fr)', options: dataTypeOptions },
    ];
    if (this.withFunctionCode) {
      cols.push({
        key: '_functionCode', label: 'Func. Code', type: 'select', width: 'minmax(80px, 0.7fr)', translateLabels: true,
        options: (row) => {
          const id = (row.getRawValue() as any).id;
          const codes = this.functionCodesMap.get(id) || this.defaultFunctionCodes;
          return codes.map((c: number) => ({ value: c, label: ModbusFunctionCodeTranslationsMap.get(c) || `FC ${c}` }));
        },
        getValue: (row) => row.get('functionCode')?.value,
        setValue: (row, v) => { row.get('functionCode')?.setValue(parseInt(v, 10)); row.markAsDirty(); },
        cellDisabled: (row) => row.get('functionCode')?.disabled ?? false,
      });
    }
    cols.push(
      { key: 'objectsCount', label: 'Obj. Count', type: 'number', width: 'minmax(80px, 0.7fr)',
        cellDisabled: (row) => !this.ModbusEditableDataTypes.includes(row.get('type')?.value) },
      { key: 'address', label: 'Address', type: 'number', sortable: true, width: 'minmax(80px, 0.7fr)', placeholder: '0' },
    );
    if (this.isMaster) {
      cols.push({ key: 'value', label: 'Value', type: 'input', width: 'minmax(80px, 0.7fr)', placeholder: 'Value' });
    } else if (this.keysType === ModbusValueKey.ATTRIBUTES || this.keysType === ModbusValueKey.TIMESERIES) {
      // Calibration hidden on non-numeric Modbus types (bytes / bits
      // / string) — same gate `shouldShowModifier()` used for the
      // pre-migration `showModifiersMap`. Report strategy is always
      // visible for attribute / timeseries rows (matches the
      // withReportStrategy flag set in ngOnInit).
      cols.push(
        ...calibrationColumns((row) => this.canCalibrate(row)),
        ...(this.withReportStrategy ? reportStrategyColumns() : []),
      );
    }
    this.spreadsheetColumns = cols;
  }

  private createKeyForm(modbusValue: ModbusValue): UntypedFormGroup {
    const { tag, value, type, address, objectsCount, functionCode,
            reportStrategy, bit, bitTargetType } = modbusValue;
    const id = generateSecret(5);

    const calibration: CalibrationConfig = {
      ...(modbusValue.multiplier !== undefined && { multiplier: modbusValue.multiplier }),
      ...(modbusValue.divider !== undefined && { divider: modbusValue.divider }),
      ...(modbusValue.adder !== undefined && { adder: modbusValue.adder }),
      ...(modbusValue.subtractor !== undefined && { subtractor: modbusValue.subtractor }),
      ...(modbusValue.scaling && { scaling: modbusValue.scaling }),
    };

    const group = this.fb.group({
      id: [{ value: id, disabled: true }],
      tag: [tag, [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
      value: [{ value, disabled: !this.isMaster }, [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
      type: [type, [Validators.required]],
      address: [address, [Validators.required]],
      objectsCount: [objectsCount, [Validators.required]],
      functionCode: [{ value: functionCode, disabled: !this.withFunctionCode }, [Validators.required]],
      bit: [{ value: bit, disabled: type !== ModbusDataType.BITS || (objectsCount ?? 1) < 2 }, [Validators.max((objectsCount ?? 1) - 1)]],
      bitTargetType: [{ value: bitTargetType ?? ModbusBitTargetType.IntegerType, disabled: type !== ModbusDataType.BITS || this.hideNewFields }],
      calibration: [calibration],
      reportStrategy: [{ value: reportStrategy, disabled: !this.withReportStrategy }],
    });

    this.functionCodesMap.set(id, this.getFunctionCodes(type));
    this.observeKeyDataType(group);
    this.observeObjectsCount(group);

    return group;
  }

  /** Modbus-specific: when the row's data type changes, adjust the
   *  default objects count, toggle the bits-only fields, reconcile
   *  the function-code select, and force calibration to 'none' if
   *  the new type is non-numeric (bytes / bits / string). */
  private observeKeyDataType(row: UntypedFormGroup): void {
    row.get('type')!.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe((dataType: ModbusDataType) => {
        if (!this.ModbusEditableDataTypes.includes(dataType)) {
          row.get('objectsCount')!.patchValue(ModbusObjectCountByDataType[dataType], { emitEvent: false });
        }
        this.toggleBitsFields(row);
        this.updateFunctionCodes(row, dataType);
        // If the new type can't be calibrated, reset the calibration
        // control so the persisted key doesn't carry orphan values.
        if (!this.canCalibrate(row)) {
          row.get('calibration')?.setValue({});
        }
      });
  }

  private observeObjectsCount(row: UntypedFormGroup): void {
    row.get('objectsCount')!.valueChanges
      .pipe(filter(() => row.get('type')!.value === ModbusDataType.BITS), takeUntil(this.destroy$))
      .subscribe(() => this.toggleBitsFields(row));
  }

  private toggleBitsFields(row: UntypedFormGroup): void {
    const { objectsCount, type, bit, bitTargetType } = row.controls;
    const isBitsType = type.value === ModbusDataType.BITS;
    const hasMultipleObjects = objectsCount.value > 1;
    if (isBitsType && hasMultipleObjects) {
      bit.enable({ emitEvent: false });
      bit.setValidators(Validators.max(objectsCount.value - 1));
    } else {
      bit.disable({ emitEvent: false });
    }
    bit.updateValueAndValidity({ emitEvent: false });
    bitTargetType[isBitsType ? 'enable' : 'disable']({ emitEvent: false });
  }

  private updateFunctionCodes(row: UntypedFormGroup, dataType: ModbusDataType): void {
    const codes = this.getFunctionCodes(dataType);
    const id = row.get('id')!.value;
    this.functionCodesMap.set(id, codes);
    if (!codes.includes(row.get('functionCode')!.value)) {
      row.get('functionCode')!.patchValue(codes[0], { emitEvent: false });
    }
  }

  private getFunctionCodes(dataType: ModbusDataType): number[] {
    const writeFunctionCodes = [
      ...(dataType === ModbusDataType.BITS ? this.bitsWriteFunctionCodes : []),
      ...this.defaultWriteFunctionCodes,
    ];
    if (this.keysType === ModbusValueKey.ATTRIBUTES_UPDATES) {
      return writeFunctionCodes.sort((a, b) => a - b);
    }
    const codes = [...this.defaultReadFunctionCodes];
    if (dataType === ModbusDataType.BITS) codes.push(...this.bitsReadFunctionCodes);
    if (this.keysType === ModbusValueKey.RPC_REQUESTS) codes.push(...writeFunctionCodes);
    return codes.sort((a, b) => a - b);
  }

  private getDefaultFunctionCodes(): number[] {
    if (this.keysType === ModbusValueKey.ATTRIBUTES_UPDATES) return this.defaultWriteFunctionCodes;
    if (this.keysType === ModbusValueKey.RPC_REQUESTS) return [...this.defaultReadFunctionCodes, ...this.defaultWriteFunctionCodes];
    return this.defaultReadFunctionCodes;
  }

  private getFormValue(): ModbusValue[] {
    return this.keysFormArray.getRawValue().map((row: any) => {
      const { id: _id, calibration, reportStrategy, ...rest } = row;
      const out: any = { ...rest };
      if (calibration) Object.assign(out, calibration);
      if (reportStrategy && this.withReportStrategy) out.reportStrategy = reportStrategy;
      return out;
    });
  }
}
