///
/// Copyright © 2016-2025 The Sentient Authors
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
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  inject,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
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
import {
  ReportStrategyDefaultValue,
  ReportStrategyType,
  ReportStrategyTypeTranslationsMap,
} from '../../../../../shared/public-api';
import { ReportStrategyComponent } from '../../../../../shared/components/public-api';
import { SpreadsheetKeysComponent } from '../../../../../shared/components/spreadsheet-keys/spreadsheet-keys.component';
import { SpreadsheetColumnConfig, SelectOption } from '../../../../../shared/components/spreadsheet-keys/spreadsheet-keys.models';
import {
  IEC61850ControlModel,
  IEC61850DataKey,
  IEC61850RpcConfig,
  IEC61850ValueKey,
  IEC61850ValueType,
  IEC61850FC,
  ModifierType,
  ModifierTypesMap,
} from '../../../models/public-api';
import { generateSecret } from '@core/public-api';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

type SortDirection = 'asc' | 'desc';
interface SortFieldOption { value: string; label: string; }

@Component({
  selector: 'tb-iec61850-data-keys-panel',
  templateUrl: './iec61850-data-keys-panel.component.html',
  styleUrls: ['./iec61850-data-keys-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    ReactiveFormsModule,
    ReportStrategyComponent,
    SpreadsheetKeysComponent,
  ],
})
export class IEC61850DataKeysPanelComponent implements OnInit, OnDestroy {

  @Input() keys: (IEC61850DataKey | IEC61850RpcConfig)[] = [];
  @Input() keyType: IEC61850ValueKey = IEC61850ValueKey.TIMESERIES;

  @Output() keysDataApplied = new EventEmitter<(IEC61850DataKey | IEC61850RpcConfig)[]>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild('panelRoot', { static: true }) panelRoot!: ElementRef<HTMLElement>;
  @ViewChild(SpreadsheetKeysComponent) spreadsheetKeys: SpreadsheetKeysComponent;

  keysFormArray: FormArray;

  readonly ValueType = IEC61850ValueType;
  readonly FC = IEC61850FC;
  readonly valueTypes = Object.values(IEC61850ValueType);
  readonly fcOptions = Object.values(IEC61850FC);
  readonly modifierTypes: ModifierType[] = Object.values(ModifierType) as ModifierType[];
  readonly ModifierTypesMap = ModifierTypesMap;
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly reportStrategyTypes = Object.values(ReportStrategyType);
  readonly ReportStrategyType = ReportStrategyType;
  readonly ReportStrategyTypeTranslationsMap = ReportStrategyTypeTranslationsMap;
  readonly IEC61850ValueKey = IEC61850ValueKey;

  readonly controlModelOptions = [
    { value: IEC61850ControlModel.STATUS_ONLY, label: 'Status Only' },
    { value: IEC61850ControlModel.DIRECT_NORMAL, label: 'Direct Normal' },
    { value: IEC61850ControlModel.SBO_NORMAL, label: 'SBO Normal' },
    { value: IEC61850ControlModel.DIRECT_ENHANCED, label: 'Direct Enhanced' },
    { value: IEC61850ControlModel.SBO_ENHANCED, label: 'SBO Enhanced' },
  ];

  /** Per-row calibration mode — mirrors S7/Modbus/EIP. */
  calModeControlMap = new Map<string, FormControl<'none' | 'modifier' | 'scaling'>>();

  /** IEC 61850 numeric value types that support calibration. Boolean
   *  and string skip it. Auto ('') is treated as numeric since the
   *  real type is resolved at read time. */
  private static readonly NUMERIC_VALUE_TYPES = new Set<string>([
    '',
    IEC61850ValueType.INT32,
    IEC61850ValueType.FLOAT,
    IEC61850ValueType.DOUBLE,
    IEC61850ValueType.UNSIGNED,
  ]);

  /** Search + list-view virtualization (fixes the 2000-row freeze —
   *  previously rendered every key via *ngFor, now only the first
   *  `renderLimit` visible rows materialize, more load on scroll). */
  searchControl = new FormControl('');
  filteredControls: { control: FormGroup; index: number }[] = [];
  displayedControls: { control: FormGroup; index: number }[] = [];
  renderLimit = 50;
  lastAddedId: string | null = null;

  isFullscreen = false;
  sortField: string | null = null;
  sortDirection: SortDirection = 'asc';

  spreadsheetColumns: SpreadsheetColumnConfig[] = [];
  searchFields: string[] = [];

  private readonly timeseriesSortFields: SortFieldOption[] = [
    { value: 'tag', label: 'Key' },
    { value: 'reference', label: 'Reference' },
    { value: 'fc', label: 'FC' },
    { value: 'valueType', label: 'Value Type' },
  ];
  private readonly rpcSortFields: SortFieldOption[] = [
    { value: 'method', label: 'Method' },
    { value: 'reference', label: 'Reference' },
    { value: 'fc', label: 'FC' },
    { value: 'operation', label: 'Operation' },
  ];

  private destroy$ = new Subject<void>();
  private fb = new FormBuilder();
  private cd = inject(ChangeDetectorRef);
  private elementRef = inject(ElementRef) as ElementRef<HTMLElement>;

  get isRpc(): boolean {
    return this.keyType === IEC61850ValueKey.RPC;
  }

  get sortFields(): SortFieldOption[] {
    return this.isRpc ? this.rpcSortFields : this.timeseriesSortFields;
  }

  get title(): string {
    switch (this.keyType) {
      case IEC61850ValueKey.TIMESERIES: return 'Telemetry Keys';
      case IEC61850ValueKey.ATTRIBUTES: return 'Attribute Keys';
      case IEC61850ValueKey.ATTRIBUTES_UPDATES: return 'Attribute Update Keys';
      case IEC61850ValueKey.RPC: return 'RPC Methods';
      default: return 'Data Keys';
    }
  }

  canCalibrate(group: FormGroup): boolean {
    const vt = (group.get('valueType')?.value ?? '').toString();
    return IEC61850DataKeysPanelComponent.NUMERIC_VALUE_TYPES.has(vt);
  }

  calModeFor(group: FormGroup): FormControl<'none' | 'modifier' | 'scaling'> | undefined {
    return this.calModeControlMap.get(group.get('id').value);
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (this.isFullscreen) {
      event.stopImmediatePropagation();
      event.preventDefault();
      this.toggleFullscreen();
    }
  }

  ngOnInit(): void {
    this.keysFormArray = this.fb.array([]);
    if (this.keys?.length) {
      this.keys.forEach(key => this.addKeyGroup(key));
    }
    this.updateFilteredControls();
    this.searchControl.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.renderLimit = 50;
        this.updateFilteredControls();
      });
    this.buildColumnConfigs();
  }

  ngOnDestroy(): void {
    if (this.isFullscreen) this.removeFullscreenClass();
    this.destroy$.next();
    this.destroy$.complete();
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

  onFullscreenToggled(fullscreen: boolean): void {
    this.isFullscreen = fullscreen;
    if (!fullscreen) {
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
          const ref = (item.control.get('reference')?.value || '').toLowerCase();
          return tag.includes(search) || ref.includes(search);
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

  onKeyPanelScroll(event: Event): void {
    if (this.renderLimit >= this.filteredControls.length) return;
    const el = event.target as HTMLElement;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      this.renderLimit += 50;
      this.displayedControls = this.filteredControls.slice(0, this.renderLimit);
      this.cd.markForCheck();
    }
  }

  trackByFilteredItem(_: number, item: { control: FormGroup; index: number }): string {
    return item.control.getRawValue().id ?? item.index.toString();
  }

  onAddRowRequested(): void {
    this.addKeyAtBottom();
  }

  onDeleteRowsRequested(rows: FormGroup[]): void {
    const indicesToDelete: number[] = [];
    this.keysFormArray.controls.forEach((c, i) => {
      if (rows.includes(c as FormGroup)) indicesToDelete.push(i);
    });
    for (let i = indicesToDelete.length - 1; i >= 0; i--) {
      this.keysFormArray.removeAt(indicesToDelete[i]);
    }
    this.keysFormArray.markAsDirty();
    this.spreadsheetKeys?.refreshDisplay();
    this.updateFilteredControls();
  }

  // --- Report strategy accessors (shared with spreadsheet cells) ---
  isReportStrategyEnabled(form: FormGroup): boolean {
    return !!form.get('reportStrategy')?.value;
  }
  setReportStrategyEnabled(form: FormGroup, enabled: boolean): void {
    const ctrl = form.get('reportStrategy');
    if (!ctrl) return;
    ctrl.setValue(enabled
      ? { type: ReportStrategyType.OnReportPeriod, reportPeriod: ReportStrategyDefaultValue.Key }
      : null);
    form.markAsDirty();
    this.cd.markForCheck();
  }
  getReportStrategyType(form: FormGroup): ReportStrategyType | null {
    return form.get('reportStrategy')?.value?.type ?? null;
  }
  setReportStrategyType(form: FormGroup, type: ReportStrategyType): void {
    const ctrl = form.get('reportStrategy');
    if (!ctrl) return;
    ctrl.setValue({ ...(ctrl.value ?? {}), type });
    form.markAsDirty();
    this.cd.markForCheck();
  }
  getReportStrategyPeriod(form: FormGroup): number | null {
    return form.get('reportStrategy')?.value?.reportPeriod ?? null;
  }
  setReportStrategyPeriod(form: FormGroup, value: string | number): void {
    const ctrl = form.get('reportStrategy');
    if (!ctrl) return;
    const parsed = typeof value === 'number' ? value : parseInt(value, 10);
    ctrl.setValue({ ...(ctrl.value ?? {}), reportPeriod: isNaN(parsed) ? null : parsed });
    form.markAsDirty();
    this.cd.markForCheck();
  }
  isReportStrategyPeriodInputEnabled(form: FormGroup): boolean {
    if (!this.isReportStrategyEnabled(form)) return false;
    const type = this.getReportStrategyType(form);
    return type !== ReportStrategyType.OnChange && type !== ReportStrategyType.OnReceived;
  }

  private buildColumnConfigs(): void {
    if (this.isRpc) {
      this.searchFields = ['method', 'reference'];
      this.spreadsheetColumns = [
        { key: 'method', label: 'Method', type: 'input', sortable: true, width: 'minmax(140px, 1.2fr)', placeholder: 'setValue' },
        { key: 'reference', label: 'Reference', type: 'input', sortable: true, width: 'minmax(200px, 1.5fr)', placeholder: 'GenericIO/GGIO1.AnIn1.mag.f' },
        { key: 'fc', label: 'FC', type: 'select', sortable: true, width: 'minmax(70px, 0.5fr)',
          options: this.fcOptions.map(fc => ({ value: fc, label: fc })) },
        { key: 'valueType', label: 'Value Type', type: 'select', sortable: true, width: 'minmax(100px, 0.8fr)',
          options: [{ value: '', label: 'Auto' }, ...this.valueTypes.map(t => ({ value: t, label: t }))] },
        { key: 'operation', label: 'Operation', type: 'select', sortable: true, width: 'minmax(100px, 0.8fr)',
          options: [
            { value: 'read', label: 'Read' },
            { value: 'write', label: 'Write' },
            { value: 'control', label: 'Control' },
          ] },
      ];
    } else {
      this.searchFields = ['tag', 'reference'];
      const modifierTypeOptions: SelectOption[] = this.modifierTypes.map(t => ({
        value: t, label: ModifierTypesMap.get(t)?.name || t,
      }));
      const reportStrategyOptions: SelectOption[] = this.reportStrategyTypes.map(t => ({
        value: t, label: ReportStrategyTypeTranslationsMap.get(t) || t,
      }));
      const isModifierRow = (row: FormGroup) =>
        this.canCalibrate(row)
        && this.calModeControlMap.get(row.getRawValue().id)?.value === 'modifier';
      const isScalingRow = (row: FormGroup) =>
        this.canCalibrate(row)
        && this.calModeControlMap.get(row.getRawValue().id)?.value === 'scaling';
      this.spreadsheetColumns = [
        { key: 'tag', label: 'Key', type: 'input', sortable: true, width: 'minmax(120px, 1.1fr)', placeholder: 'analog_input_1' },
        { key: 'reference', label: 'Reference', type: 'input', sortable: true, width: 'minmax(200px, 1.5fr)', placeholder: 'GenericIO/GGIO1.AnIn1.mag.f' },
        { key: 'fc', label: 'FC', type: 'select', sortable: true, width: 'minmax(70px, 0.5fr)',
          options: this.fcOptions.map(fc => ({ value: fc, label: fc })) },
        { key: 'valueType', label: 'Value Type', type: 'select', sortable: true, width: 'minmax(100px, 0.8fr)',
          options: [{ value: '', label: 'Auto' }, ...this.valueTypes.map(t => ({ value: t, label: t }))] },
        { key: '_calMode', label: 'Calibration', type: 'select', width: 'minmax(100px, 0.8fr)',
          options: [
            { value: 'none', label: 'None' },
            { value: 'modifier', label: 'Modifier' },
            { value: 'scaling', label: 'Scale' },
          ],
          getValue: (row) => this.calModeControlMap.get(row.getRawValue().id)?.value ?? 'none',
          setValue: (row, v) => {
            const ctrl = this.calModeControlMap.get(row.getRawValue().id);
            if (ctrl) { ctrl.setValue(v); row.markAsDirty(); }
          },
          cellDisabled: (row) => !this.canCalibrate(row) },
        { key: 'modifierType', label: 'Mod. Type', type: 'select', width: 'minmax(100px, 0.8fr)',
          options: modifierTypeOptions, translateLabels: true,
          cellDisabled: (row) => !isModifierRow(row) },
        { key: 'modifierValue', label: 'Mod. Value', type: 'number', width: 'minmax(80px, 0.7fr)',
          step: 0.1, placeholder: '1', cellDisabled: (row) => !isModifierRow(row) },
        // Scaling cells bind to nested `scaling` FormGroup fields via
        // getValue/setValue — `_`-prefixed so the spreadsheet doesn't
        // try to attach formControlName.
        { key: '_rawMin', label: 'Raw Min', type: 'number', width: 'minmax(80px, 0.7fr)',
          getValue: (row) => (row.get('scaling') as FormGroup)?.get('rawMin')?.value,
          setValue: (row, v) => { (row.get('scaling') as FormGroup)?.get('rawMin')?.setValue(v); row.markAsDirty(); },
          cellDisabled: (row) => !isScalingRow(row) },
        { key: '_rawMax', label: 'Raw Max', type: 'number', width: 'minmax(80px, 0.7fr)',
          getValue: (row) => (row.get('scaling') as FormGroup)?.get('rawMax')?.value,
          setValue: (row, v) => { (row.get('scaling') as FormGroup)?.get('rawMax')?.setValue(v); row.markAsDirty(); },
          cellDisabled: (row) => !isScalingRow(row) },
        { key: '_engMin', label: 'Eng Min', type: 'number', width: 'minmax(80px, 0.7fr)',
          getValue: (row) => (row.get('scaling') as FormGroup)?.get('engMin')?.value,
          setValue: (row, v) => { (row.get('scaling') as FormGroup)?.get('engMin')?.setValue(v); row.markAsDirty(); },
          cellDisabled: (row) => !isScalingRow(row) },
        { key: '_engMax', label: 'Eng Max', type: 'number', width: 'minmax(80px, 0.7fr)',
          getValue: (row) => (row.get('scaling') as FormGroup)?.get('engMax')?.value,
          setValue: (row, v) => { (row.get('scaling') as FormGroup)?.get('engMax')?.setValue(v); row.markAsDirty(); },
          cellDisabled: (row) => !isScalingRow(row) },
        { key: '_stratEnabled', label: 'Strat.', type: 'checkbox', width: '44px', headerClass: 'center',
          getValue: (row) => this.isReportStrategyEnabled(row),
          setValue: (row, v) => this.setReportStrategyEnabled(row, v) },
        { key: '_stratType', label: 'Strat. Type', type: 'select', width: 'minmax(140px, 1fr)', translateLabels: true,
          options: reportStrategyOptions,
          getValue: (row) => this.getReportStrategyType(row),
          setValue: (row, v) => this.setReportStrategyType(row, v),
          cellDisabled: (row) => !this.isReportStrategyEnabled(row) },
        { key: '_stratPeriod', label: 'Period (ms)', type: 'number', width: 'minmax(90px, 0.7fr)', placeholder: 'ms',
          getValue: (row) => this.getReportStrategyPeriod(row),
          setValue: (row, v) => this.setReportStrategyPeriod(row, v),
          cellDisabled: (row) => !this.isReportStrategyPeriodInputEnabled(row) },
      ];
    }
  }

  addKey(): void {
    this.addKeyAtBottom();
  }

  private addKeyAtBottom(): void {
    if (this.isRpc) {
      this.addKeyGroup({ method: '', reference: '', fc: IEC61850FC.CO, operation: 'read' } as IEC61850RpcConfig);
    } else {
      this.addKeyGroup({ tag: '', reference: '', fc: IEC61850FC.MX } as IEC61850DataKey);
    }
    this.keysFormArray.markAsDirty();
    this.searchControl.setValue('', { emitEvent: false });
    this.updateFilteredControls();
    this.spreadsheetKeys?.refreshDisplay();
    if (this.isFullscreen) this.spreadsheetKeys?.focusLastRow();
  }

  removeKey(index: number): void {
    this.keysFormArray.removeAt(index);
    this.keysFormArray.markAsDirty();
    this.updateFilteredControls();
  }

  cancel(): void {
    this.cancelled.emit();
  }

  apply(): void {
    const result = this.keysFormArray.getRawValue().map((key: any, i: number) => {
      if (this.isRpc) return key;
      const group = this.keysFormArray.controls[i] as FormGroup;
      const mode = this.calModeFor(group)?.value;
      const { id: _id, modifierType, modifierValue, scaling, ...rest } = key;
      const out: any = { ...rest };
      if (this.canCalibrate(group) && mode === 'modifier' && modifierType) {
        out[modifierType] = modifierValue;
      } else if (this.canCalibrate(group) && mode === 'scaling') {
        out.scaling = scaling;
      }
      if (!out.reportStrategy) delete out.reportStrategy;
      return out;
    });
    this.keysDataApplied.emit(result);
  }

  private addKeyGroup(key: IEC61850DataKey | IEC61850RpcConfig): void {
    const id = generateSecret(5);
    let group: FormGroup;

    if (this.isRpc) {
      const rpc = key as IEC61850RpcConfig;
      group = this.fb.group({
        id: [{ value: id, disabled: true }],
        method: [rpc.method || '', [Validators.required]],
        reference: [rpc.reference || '', [Validators.required]],
        fc: [rpc.fc || IEC61850FC.CO],
        valueType: [rpc.valueType || ''],
        operation: [rpc.operation || 'read', [Validators.required]],
        controlModel: [rpc.controlModel ?? IEC61850ControlModel.DIRECT_NORMAL],
      });
    } else {
      const dk = key as IEC61850DataKey;
      const existingModifierType =
        dk.multiplier !== undefined ? ModifierType.MULTIPLIER :
        dk.divider !== undefined    ? ModifierType.DIVIDER :
        dk.adder !== undefined      ? ModifierType.ADDER :
        dk.subtractor !== undefined ? ModifierType.SUBTRACTOR :
        null;
      const existingModifierValue =
        dk.multiplier ?? dk.divider ?? dk.adder ?? dk.subtractor ?? 1;
      const hasModifier = existingModifierType !== null;
      const hasScaling = !!dk.scaling;
      const initialMode: 'none' | 'modifier' | 'scaling' =
        hasModifier ? 'modifier' : hasScaling ? 'scaling' : 'none';
      const calModeCtrl = this.fb.control(initialMode);
      this.calModeControlMap.set(id, calModeCtrl);

      group = this.fb.group({
        id: [{ value: id, disabled: true }],
        tag: [dk.tag || '', [Validators.required]],
        reference: [dk.reference || '', [Validators.required]],
        fc: [dk.fc || IEC61850FC.MX],
        valueType: [dk.valueType || ''],
        modifierType: [existingModifierType ?? ModifierType.MULTIPLIER],
        modifierValue: [existingModifierValue],
        scaling: this.fb.group({
          rawMin: [dk.scaling?.rawMin ?? 0],
          rawMax: [dk.scaling?.rawMax ?? 65535],
          engMin: [dk.scaling?.engMin ?? 0],
          engMax: [dk.scaling?.engMax ?? 100],
        }),
        reportStrategy: [dk.reportStrategy || null],
      });

      // If the operator flips valueType to bool/string mid-edit,
      // force mode back to 'none' so the row doesn't carry orphan
      // calibration values with a non-numeric type.
      group.get('valueType')?.valueChanges
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => {
          if (!this.canCalibrate(group) && calModeCtrl.value !== 'none') {
            calModeCtrl.setValue('none');
          }
          this.cd.markForCheck();
        });
    }

    this.keysFormArray.push(group);
    this.lastAddedId = id;
  }
}
