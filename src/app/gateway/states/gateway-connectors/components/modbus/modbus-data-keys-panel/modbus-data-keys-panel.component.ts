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
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, inject, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  UntypedFormArray,
  UntypedFormGroup,
  Validators
} from '@angular/forms';
import { TbPopoverComponent } from '@shared/components/popover.component';
import {
  ModbusFunctionCodeTranslationsMap,
  noLeadTrailSpacesRegex,
  nonZeroFloat,
  ReportStrategyDefaultValue,
  ReportStrategyType,
  ReportStrategyTypeTranslationsMap,
  TruncateWithTooltipDirective,
  ModbusDataType,
  ModbusEditableDataTypes,
  ModbusObjectCountByDataType
} from '../../../../../shared/public-api';
import {
  ModbusBitTargetType,
  ModbusBitTargetTypeTranslationMap,
  ModbusFormValue,
  ModbusValue,
  ModbusValueKey,
  ModifierType,
  ModifierTypesMap,
} from '../../../models/public-api';
import { CommonModule } from '@angular/common';
import { generateSecret } from '@core/public-api';
import { coerceBoolean, SharedModule } from '@shared/public-api';
import { filter, takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { ReportStrategyComponent } from '../../../../../shared/components/public-api';
import { SpreadsheetKeysComponent } from '../../../../../shared/components/spreadsheet-keys/spreadsheet-keys.component';
import { SpreadsheetColumnConfig, SelectOption } from '../../../../../shared/components/spreadsheet-keys/spreadsheet-keys.models';

@Component({
  selector: 'tb-modbus-data-keys-panel',
  templateUrl: './modbus-data-keys-panel.component.html',
  styleUrls: ['./modbus-data-keys-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    ReportStrategyComponent,
    TruncateWithTooltipDirective,
    SpreadsheetKeysComponent,
  ]
})
export class ModbusDataKeysPanelComponent implements OnInit, OnDestroy {

  @coerceBoolean()
  @Input() isMaster = false;
  @coerceBoolean()
  @Input() hideNewFields = false;
  @Input() panelTitle: string;
  @Input() addKeyTitle: string;
  @Input() deleteKeyTitle: string;
  @Input() noKeysText: string;
  @Input() keysType: ModbusValueKey;
  @Input() values: ModbusValue[];

  @Output() keysDataApplied = new EventEmitter<Array<ModbusValue>>();

  @ViewChild(SpreadsheetKeysComponent) spreadsheetKeys: SpreadsheetKeysComponent;

  keysListFormArray: FormArray<UntypedFormGroup>;
  withFunctionCode = true;
  withReportStrategy = true;

  /** Per-row calibration mode picker ('none' | 'modifier' | 'scaling')
   *  — replaces the previous boolean "enable modifier" toggle so each
   *  Modbus row can also carry a 2-point linear scale. Mutually
   *  exclusive; the backend converter honours whichever was persisted. */
  calModeControlMap = new Map<string, FormControl<'none' | 'modifier' | 'scaling'>>();
  showModifiersMap = new Map<string, boolean>();
  functionCodesMap = new Map();
  defaultFunctionCodes = [];

  readonly modbusDataTypes = Object.values(ModbusDataType);
  readonly modifierTypes: ModifierType[] = Object.values(ModifierType) as ModifierType[];
  readonly bitTargetTypes: ModbusBitTargetType[] = Object.values(ModbusBitTargetType) as ModbusBitTargetType[];
  readonly BitTargetTypeTranslationMap = ModbusBitTargetTypeTranslationMap;
  readonly ModbusEditableDataTypes = ModbusEditableDataTypes;
  readonly ModbusFunctionCodeTranslationsMap = ModbusFunctionCodeTranslationsMap;
  readonly ModifierTypesMap = ModifierTypesMap;
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly ModbusDataType = ModbusDataType;
  readonly ModbusValueKey = ModbusValueKey;

  isFullscreen = false;
  spreadsheetColumns: SpreadsheetColumnConfig[] = [];
  searchFields = ['tag', 'address'];

  sortField: string | null = null;
  sortDirection: 'asc' | 'desc' = 'asc';
  readonly sortFields = [
    { value: 'tag', label: 'Key' },
    { value: 'type', label: 'Data Type' },
    { value: 'address', label: 'Address' },
  ];

  searchControl = new FormControl('');
  filteredControls: { control: UntypedFormGroup; index: number }[] = [];
  displayedControls: { control: UntypedFormGroup; index: number }[] = [];
  renderLimit = 50;
  lastAddedId: string | null = null;

  private destroy$ = new Subject<void>();
  private cd = inject(ChangeDetectorRef);
  private elementRef = inject(ElementRef) as ElementRef<HTMLElement>;

  private readonly defaultReadFunctionCodes = [3, 4];
  private readonly bitsReadFunctionCodes = [1, 2];
  private readonly defaultWriteFunctionCodes = [6, 16];
  private readonly bitsWriteFunctionCodes = [5, 15];

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (this.isFullscreen) {
      event.stopImmediatePropagation();
      event.preventDefault();
      this.toggleFullscreen();
    }
  }

  constructor(
    private fb: FormBuilder,
    private popover: TbPopoverComponent<ModbusDataKeysPanelComponent>,
  ) {}

  ngOnInit(): void {
    this.withFunctionCode = !this.isMaster || (this.keysType !== ModbusValueKey.ATTRIBUTES && this.keysType !== ModbusValueKey.TIMESERIES);
    this.withReportStrategy = !this.isMaster
      && (this.keysType === ModbusValueKey.ATTRIBUTES || this.keysType === ModbusValueKey.TIMESERIES)
      && !this.hideNewFields;
    this.keysListFormArray = this.prepareKeysFormArray(this.values);
    this.defaultFunctionCodes = this.getDefaultFunctionCodes();
    this.updateFilteredControls();
    this.searchControl.valueChanges.pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.renderLimit = 50;
      this.updateFilteredControls();
    });
    this.buildColumnConfigs();
  }

  ngOnDestroy(): void {
    if (this.isFullscreen) {
      this.removeFullscreenClass();
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  setSortField(field: string | null): void {
    if (field === null) {
      this.sortField = null;
      this.sortDirection = 'asc';
    } else if (this.sortField === field) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = field;
      this.sortDirection = 'asc';
    }
    this.updateFilteredControls();
  }

  toggleFullscreen(): void {
    this.isFullscreen = !this.isFullscreen;
    if (this.isFullscreen) {
      this.addFullscreenClass();
    } else {
      this.removeFullscreenClass();
      this.updateFilteredControls();
    }
    this.cd.markForCheck();
  }

  private addFullscreenClass(): void {
    const pane = this.elementRef.nativeElement.closest('.cdk-overlay-pane') as HTMLElement | null;
    pane?.classList.add('spreadsheet-fullscreen-pane');
  }

  private removeFullscreenClass(): void {
    const pane = this.elementRef.nativeElement.closest('.cdk-overlay-pane') as HTMLElement | null;
    pane?.classList.remove('spreadsheet-fullscreen-pane');
  }

  private buildColumnConfigs(): void {
    const dataTypeOptions: SelectOption[] = this.modbusDataTypes.map(t => ({ value: t, label: t }));
    const modifierTypeOptions: SelectOption[] = this.modifierTypes.map(t => ({
      value: t, label: ModifierTypesMap.get(t)?.name || t
    }));

    const cols: SpreadsheetColumnConfig[] = [
      { key: 'tag', label: 'Key', type: 'input', sortable: true, width: 'minmax(120px, 1.2fr)', placeholder: 'Tag' },
      { key: 'type', label: 'Data Type', type: 'select', sortable: true, width: 'minmax(100px, 0.8fr)', options: dataTypeOptions },
    ];

    if (this.withFunctionCode) {
      cols.push({
        key: '_functionCode', label: 'Func. Code', type: 'select', width: 'minmax(80px, 0.7fr)', translateLabels: true,
        options: (row) => {
          const codes = this.functionCodesMap.get(row.get('id').value) || this.defaultFunctionCodes;
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

    if (!this.isMaster && (this.keysType === ModbusValueKey.ATTRIBUTES || this.keysType === ModbusValueKey.TIMESERIES)) {
      // Calibration cells are only visible for numeric data types —
      // bytes / bits / strings can't be math-calibrated. Within the
      // visible group, the Mode dropdown decides whether modifier or
      // scaling cells are active; the other set is disabled (kept
      // visible for a consistent column layout during live edits).
      const isVisible = (row: FormGroup) =>
        this.showModifiersMap.get(row.get('id').value) ?? false;
      const isModifierRow = (row: FormGroup) =>
        isVisible(row)
        && this.calModeControlMap.get(row.get('id').value)?.value === 'modifier';
      const isScalingRow = (row: FormGroup) =>
        isVisible(row)
        && this.calModeControlMap.get(row.get('id').value)?.value === 'scaling';
      cols.push(
        { key: '_calMode', label: 'Calibration', type: 'select', width: 'minmax(100px, 0.8fr)',
          options: [
            { value: 'none', label: 'None' },
            { value: 'modifier', label: 'Modifier' },
            { value: 'scaling', label: 'Scale' },
          ],
          cellVisible: isVisible,
          getValue: (row) => this.calModeControlMap.get(row.get('id').value)?.value ?? 'none',
          setValue: (row, v) => {
            const ctrl = this.calModeControlMap.get(row.get('id').value);
            if (ctrl) { ctrl.setValue(v); row.markAsDirty(); }
          } },
        { key: 'modifierType', label: 'Mod. Type', type: 'select', width: 'minmax(100px, 0.8fr)', translateLabels: true,
          options: modifierTypeOptions,
          cellVisible: isVisible, cellDisabled: (row) => !isModifierRow(row) },
        { key: 'modifierValue', label: 'Mod. Value', type: 'number', width: 'minmax(80px, 0.7fr)', step: 0.1, placeholder: '1',
          cellVisible: isVisible, cellDisabled: (row) => !isModifierRow(row) },
        { key: 'rawMin', label: 'Raw Min', type: 'number', width: 'minmax(80px, 0.7fr)', placeholder: '0',
          cellVisible: isVisible, cellDisabled: (row) => !isScalingRow(row) },
        { key: 'rawMax', label: 'Raw Max', type: 'number', width: 'minmax(80px, 0.7fr)', placeholder: '65535',
          cellVisible: isVisible, cellDisabled: (row) => !isScalingRow(row) },
        { key: 'engMin', label: 'Eng Min', type: 'number', width: 'minmax(80px, 0.7fr)', placeholder: '0',
          cellVisible: isVisible, cellDisabled: (row) => !isScalingRow(row) },
        { key: 'engMax', label: 'Eng Max', type: 'number', width: 'minmax(80px, 0.7fr)', placeholder: '100',
          cellVisible: isVisible, cellDisabled: (row) => !isScalingRow(row) },
      );
    }

    if (this.withReportStrategy) {
      const reportStrategyTypes = Object.values(ReportStrategyType);
      const reportStrategyOptions: SelectOption[] = reportStrategyTypes.map(t => ({
        value: t, label: ReportStrategyTypeTranslationsMap.get(t) || t
      }));
      cols.push(
        { key: '_stratEnabled', label: 'Strat.', type: 'checkbox', width: '44px', headerClass: 'center',
          getValue: (row) => !!row.get('reportStrategy')?.value,
          setValue: (row, v) => {
            const ctrl = row.get('reportStrategy');
            if (!ctrl) return;
            ctrl.setValue(v ? { type: ReportStrategyType.OnReportPeriod, reportPeriod: ReportStrategyDefaultValue.Key } : null);
            row.markAsDirty();
            this.cd.markForCheck();
          }
        },
        { key: '_stratType', label: 'Strat. Type', type: 'select', width: 'minmax(140px, 1fr)', translateLabels: true,
          options: reportStrategyOptions,
          getValue: (row) => row.get('reportStrategy')?.value?.type ?? null,
          setValue: (row, v) => {
            const ctrl = row.get('reportStrategy');
            if (!ctrl) return;
            const cur = ctrl.value ?? {};
            ctrl.setValue({ ...cur, type: v });
            row.markAsDirty();
            this.cd.markForCheck();
          },
          cellDisabled: (row) => !row.get('reportStrategy')?.value
        },
        { key: '_stratPeriod', label: 'Period (ms)', type: 'number', width: 'minmax(80px, 0.7fr)', placeholder: 'ms',
          getValue: (row) => row.get('reportStrategy')?.value?.reportPeriod ?? null,
          setValue: (row, v) => {
            const ctrl = row.get('reportStrategy');
            if (!ctrl) return;
            const cur = ctrl.value ?? {};
            const parsed = typeof v === 'number' ? v : parseInt(v, 10);
            ctrl.setValue({ ...cur, reportPeriod: isNaN(parsed) ? null : parsed });
            row.markAsDirty();
            this.cd.markForCheck();
          },
          cellDisabled: (row) => {
            const rs = row.get('reportStrategy')?.value;
            if (!rs) return true;
            return rs.type === ReportStrategyType.OnChange || rs.type === ReportStrategyType.OnReceived;
          }
        },
      );
    }

    if (this.isMaster) {
      cols.push(
        { key: 'value', label: 'Value', type: 'input', width: 'minmax(80px, 0.7fr)', placeholder: 'Value' },
      );
    }

    this.spreadsheetColumns = cols;
  }

  onFullscreenToggled(fullscreen: boolean): void {
    this.isFullscreen = fullscreen;
    if (!fullscreen) {
      this.removeFullscreenClass();
      this.updateFilteredControls();
    }
    this.cd.markForCheck();
  }

  onAddRowRequested(): void {
    this.addKeyAtBottom();
    this.spreadsheetKeys?.refreshDisplay();
    this.spreadsheetKeys?.focusLastRow();
  }

  private addKeyAtBottom(): void {
    const id = generateSecret(5);
    const dataKeyFormGroup = this.fb.group({
      tag: ['', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
      value: [{value: '', disabled: !this.isMaster}, [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
      type: [ModbusDataType.BYTES, [Validators.required]],
      address: [null, [Validators.required]],
      objectsCount: [1, [Validators.required]],
      functionCode: [{ value: this.getDefaultFunctionCodes()[0], disabled: !this.withFunctionCode }, [Validators.required]],
      reportStrategy: [{ value: null, disabled: !this.withReportStrategy }],
      modifierType: [{ value: ModifierType.MULTIPLIER, disabled: true }],
      modifierValue: [{ value: 1, disabled: true }, [Validators.pattern(nonZeroFloat)]],
      rawMin: [{ value: 0, disabled: true }],
      rawMax: [{ value: 65535, disabled: true }],
      engMin: [{ value: 0, disabled: true }],
      engMax: [{ value: 100, disabled: true }],
      bit: [{ value: null, disabled: true }],
      bitTargetType: [{ value: ModbusBitTargetType.IntegerType, disabled: true }],
      id: [{value: id, disabled: true}],
    });
    this.showModifiersMap.set(id, false);
    this.calModeControlMap.set(id, this.fb.control('none'));
    this.observeKeyDataType(dataKeyFormGroup);
    this.observeObjectsCount(dataKeyFormGroup);
    this.observeEnableModifier(dataKeyFormGroup);
    this.keysListFormArray.push(dataKeyFormGroup);
    this.keysListFormArray.markAsDirty();
    this.searchControl.setValue('', { emitEvent: false });
    this.updateFilteredControls();
  }

  onDeleteRowsRequested(rows: FormGroup[]): void {
    const indicesToDelete: number[] = [];
    this.keysListFormArray.controls.forEach((c, i) => {
      if (rows.includes(c as FormGroup)) {
        indicesToDelete.push(i);
      }
    });
    for (let i = indicesToDelete.length - 1; i >= 0; i--) {
      this.keysListFormArray.removeAt(indicesToDelete[i]);
    }
    this.keysListFormArray.markAsDirty();
    this.spreadsheetKeys?.refreshDisplay();
    this.updateFilteredControls();
  }

  trackByControlId(_: number, keyControl: AbstractControl): string {
    return keyControl.value.id;
  }

  addKey(): void {
    const id = generateSecret(5);
    const dataKeyFormGroup = this.fb.group({
      tag: ['', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
      value: [{value: '', disabled: !this.isMaster}, [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
      type: [ModbusDataType.BYTES, [Validators.required]],
      address: [null, [Validators.required]],
      objectsCount: [1, [Validators.required]],
      functionCode: [{ value: this.getDefaultFunctionCodes()[0], disabled: !this.withFunctionCode }, [Validators.required]],
      reportStrategy: [{ value: null, disabled: !this.withReportStrategy }],
      modifierType: [{ value: ModifierType.MULTIPLIER, disabled: true }],
      modifierValue: [{ value: 1, disabled: true }, [Validators.pattern(nonZeroFloat)]],
      rawMin: [{ value: 0, disabled: true }],
      rawMax: [{ value: 65535, disabled: true }],
      engMin: [{ value: 0, disabled: true }],
      engMax: [{ value: 100, disabled: true }],
      bit: [{ value: null, disabled: true }],
      bitTargetType: [{ value: ModbusBitTargetType.IntegerType, disabled: true }],
      id: [{value: id, disabled: true}],
    });
    this.showModifiersMap.set(id, false);
    this.calModeControlMap.set(id, this.fb.control('none'));
    this.observeKeyDataType(dataKeyFormGroup);
    this.observeObjectsCount(dataKeyFormGroup);
    this.observeEnableModifier(dataKeyFormGroup);

    this.lastAddedId = id;
    this.keysListFormArray.push(dataKeyFormGroup);
    this.keysListFormArray.markAsDirty();
    this.searchControl.setValue('', { emitEvent: false });
    this.updateFilteredControls();
    this.spreadsheetKeys?.refreshDisplay();
  }

  deleteKey($event: Event, index: number): void {
    if ($event) {
      $event.stopPropagation();
    }
    this.keysListFormArray.removeAt(index);
    this.keysListFormArray.markAsDirty();
    this.updateFilteredControls();
    this.spreadsheetKeys?.refreshDisplay();
  }

  cancel(): void {
    this.popover.hide();
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
      this.filteredControls = this.keysListFormArray.controls
        .map((c, i) => ({ control: c as UntypedFormGroup, index: i }));
    } else {
      this.filteredControls = this.keysListFormArray.controls
        .map((c, i) => ({ control: c as UntypedFormGroup, index: i }))
        .filter(item => {
          const tag = (item.control.get('tag').value || '').toLowerCase();
          const address = (item.control.get('address').value?.toString() || '');
          return tag.includes(search) || address.includes(search);
        });
    }
    if (this.sortField) {
      const dir = this.sortDirection === 'asc' ? 1 : -1;
      const field = this.sortField;
      this.filteredControls = [...this.filteredControls].sort((a, b) => {
        const av = (a.control.get(field)?.value ?? '').toString().toLowerCase();
        const bv = (b.control.get(field)?.value ?? '').toString().toLowerCase();
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    }
    this.displayedControls = this.filteredControls.slice(0, this.renderLimit);
    this.cd.markForCheck();
  }

  trackByFilteredItem(_: number, item: { control: UntypedFormGroup; index: number }): string {
    return item.control.get('id').value;
  }

  applyKeysData(): void {
    this.keysDataApplied.emit(this.getFormValue());
  }

  private getFormValue(): ModbusValue[] {
    return this.mapKeysWithModifier(
      this.withReportStrategy
      ? this.cleanUpEmptyStrategies(this.keysListFormArray.value)
      : this.keysListFormArray.value
    );
  }

  private cleanUpEmptyStrategies(values: ModbusValue[]): ModbusValue[] {
    return values.map((key) => {
      const { reportStrategy, ...updatedKey } = key;
      return !reportStrategy ? updatedKey : key;
    });
  }

  private mapKeysWithModifier(values: Array<ModbusFormValue>): Array<ModbusValue> {
    return values.map((keyData, i) => {
      const rowId = this.keysListFormArray.controls[i].get('id').value;
      // Always strip the UI-only calibration input fields; emit
      // modifier or scaling only when the row is actually in that
      // mode (and eligible for calibration at all).
      const { modifierType, modifierValue,
              rawMin, rawMax, engMin, engMax,
              ...rest } = keyData as any;
      if (!this.showModifiersMap.get(rowId)) {
        return rest as ModbusValue;
      }
      const mode = this.calModeControlMap.get(rowId)?.value;
      if (mode === 'modifier' && modifierType) {
        return { ...rest, [modifierType]: modifierValue } as ModbusValue;
      }
      if (mode === 'scaling') {
        return { ...rest, scaling: { rawMin, rawMax, engMin, engMax } } as ModbusValue;
      }
      return rest as ModbusValue;
    });
  }

  private prepareKeysFormArray(values: ModbusValue[]): UntypedFormArray {
    const keysControlGroups: Array<AbstractControl> = [];

    if (values) {
      values.forEach(value => {
        const dataKeyFormGroup = this.createDataKeyFormGroup(value);
        this.observeKeyDataType(dataKeyFormGroup);
        this.observeObjectsCount(dataKeyFormGroup);
        this.observeEnableModifier(dataKeyFormGroup);
        this.functionCodesMap.set(dataKeyFormGroup.get('id').value, this.getFunctionCodes(value.type));

        keysControlGroups.push(dataKeyFormGroup);
      });
    }

    return this.fb.array(keysControlGroups);
  }

  private createDataKeyFormGroup(modbusValue: ModbusValue): FormGroup {
    const { tag, value, type, address, objectsCount, functionCode,
            multiplier, divider, reportStrategy, bit, bitTargetType } = modbusValue;
    const scaling = (modbusValue as any).scaling as
      { rawMin: number; rawMax: number; engMin: number; engMax: number } | undefined;
    const adder = (modbusValue as any).adder as number | undefined;
    const subtractor = (modbusValue as any).subtractor as number | undefined;
    const id = generateSecret(5);

    // Calibration is only offered for numeric Modbus data types —
    // bytes / bits / strings skip it. Detect which operator the
    // persisted value carries (exactly one key set in modifier mode).
    const showCalibration = this.shouldShowModifier(type);
    this.showModifiersMap.set(id, showCalibration);
    const existingModifierType =
      multiplier !== undefined  ? ModifierType.MULTIPLIER :
      divider !== undefined     ? ModifierType.DIVIDER :
      adder !== undefined       ? ModifierType.ADDER :
      subtractor !== undefined  ? ModifierType.SUBTRACTOR :
      null;
    const existingModifierValue =
      multiplier ?? divider ?? adder ?? subtractor ?? 1;
    const hasModifier = existingModifierType !== null;
    const hasScaling = !!scaling;
    const initialMode: 'none' | 'modifier' | 'scaling' =
      !showCalibration ? 'none'
      : hasModifier ? 'modifier'
      : hasScaling ? 'scaling'
      : 'none';
    this.calModeControlMap.set(id, this.fb.control(initialMode));

    return this.fb.group({
      tag: [tag, [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
      value: [{ value, disabled: !this.isMaster }, [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
      type: [type, [Validators.required]],
      address: [address, [Validators.required]],
      objectsCount: [objectsCount, [Validators.required]],
      functionCode: [{ value: functionCode, disabled: !this.withFunctionCode }, [Validators.required]],
      modifierType: [{
        value: existingModifierType ?? ModifierType.MULTIPLIER,
        disabled: initialMode !== 'modifier'
      }],
      bit: [{ value: bit, disabled: type !== ModbusDataType.BITS || objectsCount < 2 }, [Validators.max(objectsCount - 1)]],
      bitTargetType: [{ value: bitTargetType ?? ModbusBitTargetType.IntegerType, disabled: type !== ModbusDataType.BITS || this.hideNewFields }],
      modifierValue: [
        { value: existingModifierValue, disabled: initialMode !== 'modifier' },
        [Validators.pattern(nonZeroFloat)]
      ],
      rawMin: [{ value: scaling?.rawMin ?? 0, disabled: initialMode !== 'scaling' }],
      rawMax: [{ value: scaling?.rawMax ?? 65535, disabled: initialMode !== 'scaling' }],
      engMin: [{ value: scaling?.engMin ?? 0, disabled: initialMode !== 'scaling' }],
      engMax: [{ value: scaling?.engMax ?? 100, disabled: initialMode !== 'scaling' }],
      id: [{ value: id, disabled: true }],
      reportStrategy: [{ value: reportStrategy, disabled: !this.withReportStrategy }],
    });
  }

  private shouldShowModifier(type: ModbusDataType): boolean {
    return !this.isMaster
      && (this.keysType === ModbusValueKey.ATTRIBUTES || this.keysType === ModbusValueKey.TIMESERIES)
      && (!this.ModbusEditableDataTypes.includes(type));
  }

  private observeKeyDataType(keyFormGroup: FormGroup): void {
    keyFormGroup.get('type').valueChanges.pipe(takeUntil(this.destroy$)).subscribe(dataType => {
      if (!this.ModbusEditableDataTypes.includes(dataType)) {
        keyFormGroup.get('objectsCount').patchValue(ModbusObjectCountByDataType[dataType], {emitEvent: false});
      }
      this.toggleBitsFields(keyFormGroup);
      const withModifier = this.shouldShowModifier(dataType);
      const id = keyFormGroup.get('id').value;
      this.showModifiersMap.set(id, withModifier);
      // If the operator flips a numeric row to bytes / bits / string
      // mid-edit, force calibration off so the row doesn't silently
      // persist stale multiplier / scaling values with the new type.
      if (!withModifier) {
        const calCtrl = this.calModeControlMap.get(id);
        if (calCtrl && calCtrl.value !== 'none') {
          calCtrl.setValue('none');   // triggers applyCalibrationMode
        } else {
          this.applyCalibrationMode(keyFormGroup, 'none');
        }
      }
      this.updateFunctionCodes(keyFormGroup, dataType);
      this.cd.markForCheck();
    });
  }

  private observeObjectsCount(keyFormGroup: FormGroup): void {
    keyFormGroup.get('objectsCount').valueChanges
      .pipe(filter(() => keyFormGroup.get('type').value === ModbusDataType.BITS), takeUntil(this.destroy$))
      .subscribe(() => this.toggleBitsFields(keyFormGroup));
  }

  private toggleBitsFields(keyFormGroup: FormGroup): void {
    const { objectsCount, type, bit, bitTargetType } = keyFormGroup.controls;
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

  private observeEnableModifier(keyFormGroup: FormGroup): void {
    const id = keyFormGroup.get('id').value;
    this.calModeControlMap.get(id).valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(mode => this.applyCalibrationMode(keyFormGroup, mode));
  }

  private applyCalibrationMode(keyFormGroup: FormGroup, mode: 'none' | 'modifier' | 'scaling'): void {
    const modT = keyFormGroup.get('modifierType');
    const modV = keyFormGroup.get('modifierValue');
    const rMin = keyFormGroup.get('rawMin');
    const rMax = keyFormGroup.get('rawMax');
    const eMin = keyFormGroup.get('engMin');
    const eMax = keyFormGroup.get('engMax');
    const setTo = (ctrls: (typeof modT)[], action: 'enable' | 'disable') =>
      ctrls.forEach(c => c?.[action]({ emitEvent: false }));
    if (mode === 'modifier') {
      setTo([modT, modV], 'enable');
      setTo([rMin, rMax, eMin, eMax], 'disable');
    } else if (mode === 'scaling') {
      setTo([modT, modV], 'disable');
      setTo([rMin, rMax, eMin, eMax], 'enable');
    } else {
      setTo([modT, modV, rMin, rMax, eMin, eMax], 'disable');
    }
    keyFormGroup.markAsDirty();
  }

  private updateFunctionCodes(keyFormGroup: FormGroup, dataType: ModbusDataType): void {
    const functionCodes = this.getFunctionCodes(dataType);
    this.functionCodesMap.set(keyFormGroup.get('id').value, functionCodes);
    if (!functionCodes.includes(keyFormGroup.get('functionCode').value)) {
      keyFormGroup.get('functionCode').patchValue(functionCodes[0], {emitEvent: false});
    }
  }

  private getFunctionCodes(dataType: ModbusDataType): number[] {
    const writeFunctionCodes = [
      ...(dataType === ModbusDataType.BITS ? this.bitsWriteFunctionCodes : []), ...this.defaultWriteFunctionCodes
    ];

    if (this.keysType === ModbusValueKey.ATTRIBUTES_UPDATES) {
      return writeFunctionCodes.sort((a, b) => a - b);
    }

    const functionCodes = [...this.defaultReadFunctionCodes];
    if (dataType === ModbusDataType.BITS) {
      functionCodes.push(...this.bitsReadFunctionCodes);
    }
    if (this.keysType === ModbusValueKey.RPC_REQUESTS) {
      functionCodes.push(...writeFunctionCodes);
    }

    return functionCodes.sort((a, b) => a - b);
  }

  private getDefaultFunctionCodes(): number[] {
    if (this.keysType === ModbusValueKey.ATTRIBUTES_UPDATES) {
      return this.defaultWriteFunctionCodes;
    }
    if (this.keysType === ModbusValueKey.RPC_REQUESTS) {
      return [...this.defaultReadFunctionCodes, ...this.defaultWriteFunctionCodes];
    }
    return this.defaultReadFunctionCodes;
  }
}
