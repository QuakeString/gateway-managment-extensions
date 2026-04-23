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
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  FormBuilder,
  UntypedFormGroup,
  Validators
} from '@angular/forms';
import { coerceBoolean, SharedModule } from '@shared/public-api';
import { TbPopoverComponent } from '@shared/components/popover.component';
import { Store } from '@ngrx/store';
import { PageComponent } from '@shared/public-api';
import { isDefinedAndNotNull, AppState } from '@core/public-api';
import {
  MqttConverterType,
  MappingDataKey,
  MappingKeysType,
  ModifierType,
  ModifierTypesMap,
  OPCUaSourceType,
  RpcMethodsMapping,
  SourceType,
} from '../../models/public-api';
import {
  noLeadTrailSpacesRegex,
  ReportStrategyDefaultValue,
  MappingValueType,
  mappingValueTypesMap,
  ReportStrategyComponent,
  ConnectorType,
} from '../../../../shared/public-api';
import { generateSecret } from '@core/public-api';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TypeValuePanelComponent } from '../type-value-panel/type-value-panel.component';
import { ConnectorMappingHelpLinkPipe } from '../../pipes/public-api';
import { SpreadsheetKeysComponent } from '../../../../shared/components/spreadsheet-keys/spreadsheet-keys.component';
import { SpreadsheetColumnConfig, SelectOption } from '../../../../shared/components/spreadsheet-keys/spreadsheet-keys.models';

@Component({
  selector: 'tb-mapping-data-keys-panel',
  templateUrl: './mapping-data-keys-panel.component.html',
  styleUrls: ['./mapping-data-keys-panel.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    ReportStrategyComponent,
    TypeValuePanelComponent,
    ConnectorMappingHelpLinkPipe,
    SpreadsheetKeysComponent,
  ],
})
export class MappingDataKeysPanelComponent extends PageComponent implements OnInit, OnDestroy {

  @Input() panelTitle: string;
  @Input() addKeyTitle: string;
  @Input() deleteKeyTitle: string;
  @Input() noKeysText: string;
  @Input() keys: Array<MappingDataKey> | {[key: string]: any};
  @Input() keysType: MappingKeysType;
  @Input() connectorType: ConnectorType;
  @Input() convertorType: MqttConverterType;
  @Input() sourceType: SourceType;
  @Input() valueTypeEnum = MappingValueType;
  @Input() valueTypes: Map<string, unknown> = mappingValueTypesMap;
  @Input() valueTypeKeys: Array<MappingValueType | OPCUaSourceType> = Object.values(MappingValueType) as MappingValueType[];
  @Input() @coerceBoolean() rawData = false;
  @Input() @coerceBoolean() withReportStrategy = true;

  @Output() keysDataApplied = new EventEmitter<Array<MappingDataKey> | {[key: string]: unknown}>();

  readonly MappingKeysType = MappingKeysType;
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly ConnectorType = ConnectorType;
  readonly modifierTypes: ModifierType[] = Object.values(ModifierType) as ModifierType[];
  readonly ModifierTypesMap = ModifierTypesMap;

  /** Per-row calibration mode — same semantics as the industrial
   *  panels. Only populated for OPC-UA timeseries/attributes rows. */
  calModeControlMap = new Map<string, FormControl<'none' | 'modifier' | 'scaling'>>();

  keysListFormArray: FormArray;

  @ViewChild('panelRoot', { static: true }) panelRoot!: ElementRef<HTMLElement>;
  @ViewChild(SpreadsheetKeysComponent) spreadsheetKeys: SpreadsheetKeysComponent;

  spreadsheetColumns: SpreadsheetColumnConfig[] = [];
  searchFields: string[] = [];

  /** Fullscreen spreadsheet is useful for dense attribute/timeseries
   *  lists but doesn't map well onto RPC entries (complex nested
   *  `arguments` form group) or custom key/value pairs. Hide the
   *  fullscreen button for those modes. */
  get fullscreenSupported(): boolean {
    return this.keysType !== MappingKeysType.RPC_METHODS;
  }

  searchControl = new FormControl('');
  filteredControls: { control: UntypedFormGroup; index: number }[] = [];
  displayedControls: { control: UntypedFormGroup; index: number }[] = [];
  renderLimit = 50;
  lastAddedControl: AbstractControl | null = null;

  /** Fullscreen + sort state — mirrors the S7 / Modbus / EIP /
   *  IEC 61850 data-keys panels so the same set of toolbar controls
   *  (search, sort, fullscreen) appears everywhere. */
  isFullscreen = false;
  sortField: string | null = null;
  sortDirection: 'asc' | 'desc' = 'asc';

  /** Sort fields depend on what's in the form: RPC has `method`,
   *  everything else has `key` + `value`. */
  get sortFields(): { value: string; label: string }[] {
    if (this.keysType === MappingKeysType.RPC_METHODS) {
      return [{ value: 'method', label: 'Method' }];
    }
    return [
      { value: 'key', label: 'Key' },
      { value: 'value', label: 'Value' },
    ];
  }

  /** True when this panel instance should show calibration inputs —
   *  OPC-UA only, attribute / timeseries only. RPC / custom / other
   *  connectors bypass the calibration UI entirely. */
  get calibrationEnabled(): boolean {
    return this.connectorType === ConnectorType.OPCUA
      && (this.keysType === MappingKeysType.ATTRIBUTES
          || this.keysType === MappingKeysType.TIMESERIES);
  }

  /** OPC-UA's `type` field is the SOURCE type (path / identifier /
   *  constant), not the value type — the server resolves the actual
   *  value type at read time. So we allow calibration on every OPC-UA
   *  attribute/timeseries row; the backend converter skips it
   *  automatically when the read value is non-numeric. Same pattern
   *  as EIP (which also has no per-key value type on the mapping). */
  canCalibrate(_group: UntypedFormGroup): boolean {
    return this.calibrationEnabled;
  }

  calModeFor(group: UntypedFormGroup): FormControl<'none' | 'modifier' | 'scaling'> | undefined {
    return this.calModeControlMap.get(group.get('_id')?.value);
  }

  errorText = '';

  private destroy$ = new Subject<void>();
  private cd = inject(ChangeDetectorRef);
  private elementRef = inject(ElementRef) as ElementRef<HTMLElement>;

  constructor(private fb: FormBuilder,
              private popover: TbPopoverComponent<MappingDataKeysPanelComponent>,
              protected store: Store<AppState>) {
    super(store);
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (this.isFullscreen) {
      event.stopImmediatePropagation();
      event.preventDefault();
      this.toggleFullscreen();
    }
  }

  toggleFullscreen(): void {
    this.isFullscreen = !this.isFullscreen;
    // Find the outer floating container — either mat-dialog's
    // `.cdk-overlay-pane` or the Thingsboard popover's `.tb-popover`
    // (this panel is hosted in both places depending on caller).
    // Apply the fullscreen class to whichever we find so the outer
    // chrome stretches along with the inner panel.
    const overlay = this.elementRef.nativeElement.closest('.cdk-overlay-pane') as HTMLElement | null;
    const pop = this.elementRef.nativeElement.closest('.tb-popover') as HTMLElement | null;
    const target = overlay ?? pop ?? this.panelRoot?.nativeElement;
    if (this.isFullscreen) {
      target?.classList.add('mapping-keys-fullscreen-pane');
    } else {
      target?.classList.remove('mapping-keys-fullscreen-pane');
    }
    this.cd.markForCheck();
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

  ngOnInit(): void {
    this.keysListFormArray = this.prepareKeysFormArray(this.keys);
    this.updateFilteredControls();
    this.searchControl.valueChanges.pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.renderLimit = 50;
      this.updateFilteredControls();
    });
    this.buildColumnConfigs();
  }

  private buildColumnConfigs(): void {
    if (this.keysType === MappingKeysType.CUSTOM) {
      this.searchFields = ['key', 'value'];
      this.spreadsheetColumns = [
        { key: 'key', label: 'Key', type: 'input', sortable: true, width: 'minmax(160px, 1.2fr)', placeholder: 'name' },
        { key: 'value', label: 'Value', type: 'input', sortable: true, width: 'minmax(200px, 1.4fr)', placeholder: 'value' },
      ];
      return;
    }
    if (this.keysType === MappingKeysType.RPC_METHODS) {
      // Not used (fullscreen disabled for RPC), but leave a minimal
      // config so the spreadsheet component doesn't crash if toggled.
      this.searchFields = ['method'];
      this.spreadsheetColumns = [
        { key: 'method', label: 'Method', type: 'input', sortable: true, width: 'minmax(160px, 1fr)' },
      ];
      return;
    }

    // Attributes / Timeseries / Attribute updates.
    this.searchFields = ['key', 'value'];
    const typeOptions: SelectOption[] = (this.valueTypeKeys as string[])
      .map(t => ({ value: t, label: String(t) }));
    const cols: SpreadsheetColumnConfig[] = [
      { key: 'key', label: 'Key', type: 'input', sortable: true, width: 'minmax(140px, 1fr)', placeholder: 'name' },
    ];
    if (typeOptions.length > 0) {
      cols.push({
        key: 'type', label: 'Source', type: 'select', sortable: true, width: 'minmax(110px, 0.8fr)',
        options: typeOptions,
      });
    }
    cols.push({
      key: 'value', label: 'Value', type: 'input', sortable: true, width: 'minmax(180px, 1.4fr)', placeholder: 'ns=2;s=...',
    });

    if (this.calibrationEnabled) {
      const modifierTypeOptions: SelectOption[] = this.modifierTypes.map(t => ({
        value: t, label: ModifierTypesMap.get(t)?.name || t,
      }));
      const isModifierRow = (row: UntypedFormGroup) =>
        this.calModeControlMap.get(row.get('_id')?.value)?.value === 'modifier';
      const isScalingRow = (row: UntypedFormGroup) =>
        this.calModeControlMap.get(row.get('_id')?.value)?.value === 'scaling';
      cols.push(
        { key: '_calMode', label: 'Calibration', type: 'select', width: 'minmax(100px, 0.8fr)',
          options: [
            { value: 'none', label: 'None' },
            { value: 'modifier', label: 'Modifier' },
            { value: 'scaling', label: 'Scale' },
          ],
          getValue: (row) => this.calModeControlMap.get(row.get('_id')?.value)?.value ?? 'none',
          setValue: (row, v) => {
            const ctrl = this.calModeControlMap.get(row.get('_id')?.value);
            if (ctrl) { ctrl.setValue(v); row.markAsDirty(); }
          } },
        { key: 'modifierType', label: 'Mod. Type', type: 'select', width: 'minmax(100px, 0.8fr)',
          options: modifierTypeOptions, translateLabels: true,
          cellDisabled: (row) => !isModifierRow(row) },
        { key: 'modifierValue', label: 'Mod. Value', type: 'number', width: 'minmax(80px, 0.7fr)',
          step: 0.1, placeholder: '1', cellDisabled: (row) => !isModifierRow(row) },
        { key: '_rawMin', label: 'Raw Min', type: 'number', width: 'minmax(80px, 0.7fr)',
          getValue: (row) => (row.get('scaling') as UntypedFormGroup)?.get('rawMin')?.value,
          setValue: (row, v) => { (row.get('scaling') as UntypedFormGroup)?.get('rawMin')?.setValue(v); row.markAsDirty(); },
          cellDisabled: (row) => !isScalingRow(row) },
        { key: '_rawMax', label: 'Raw Max', type: 'number', width: 'minmax(80px, 0.7fr)',
          getValue: (row) => (row.get('scaling') as UntypedFormGroup)?.get('rawMax')?.value,
          setValue: (row, v) => { (row.get('scaling') as UntypedFormGroup)?.get('rawMax')?.setValue(v); row.markAsDirty(); },
          cellDisabled: (row) => !isScalingRow(row) },
        { key: '_engMin', label: 'Eng Min', type: 'number', width: 'minmax(80px, 0.7fr)',
          getValue: (row) => (row.get('scaling') as UntypedFormGroup)?.get('engMin')?.value,
          setValue: (row, v) => { (row.get('scaling') as UntypedFormGroup)?.get('engMin')?.setValue(v); row.markAsDirty(); },
          cellDisabled: (row) => !isScalingRow(row) },
        { key: '_engMax', label: 'Eng Max', type: 'number', width: 'minmax(80px, 0.7fr)',
          getValue: (row) => (row.get('scaling') as UntypedFormGroup)?.get('engMax')?.value,
          setValue: (row, v) => { (row.get('scaling') as UntypedFormGroup)?.get('engMax')?.setValue(v); row.markAsDirty(); },
          cellDisabled: (row) => !isScalingRow(row) },
      );
    }
    this.spreadsheetColumns = cols;
  }

  onAddRowRequested(): void {
    this.addKey();
    this.spreadsheetKeys?.refreshDisplay();
    this.spreadsheetKeys?.focusLastRow();
  }

  onDeleteRowsRequested(rows: UntypedFormGroup[]): void {
    const indicesToDelete: number[] = [];
    this.keysListFormArray.controls.forEach((c, i) => {
      if (rows.includes(c as UntypedFormGroup)) indicesToDelete.push(i);
    });
    for (let i = indicesToDelete.length - 1; i >= 0; i--) {
      this.keysListFormArray.removeAt(indicesToDelete[i]);
    }
    this.keysListFormArray.markAsDirty();
    this.spreadsheetKeys?.refreshDisplay();
    this.updateFilteredControls();
  }

  onFullscreenToggled(fullscreen: boolean): void {
    this.isFullscreen = fullscreen;
    if (!fullscreen) {
      const pane = this.elementRef.nativeElement.closest('.tb-popover') as HTMLElement | null;
      pane?.classList.remove('mapping-keys-fullscreen-pane');
      this.panelRoot?.nativeElement.classList.remove('mapping-keys-fullscreen-pane');
      this.updateFilteredControls();
    }
    this.cd.markForCheck();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  trackByKey(index: number, keyControl: AbstractControl): any {
    return keyControl;
  }

  addKey(): void {
    let dataKeyFormGroup: FormGroup;
    if (this.keysType === MappingKeysType.RPC_METHODS) {
      dataKeyFormGroup = this.fb.group({
        method: ['', [Validators.required]],
        arguments: [[], []],
        // OPC-UA only — carried through when the entry was imported
        // from the discovery dialog; blank for manually-added methods
        // (those still call an OPC-UA Method node by name).
        nodeId: [null],
        operation: [null],
        valueType: [null]
      });
    } else if (this.keysType === MappingKeysType.CUSTOM) {
      dataKeyFormGroup = this.fb.group({
        key: ['', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
        value: ['', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
      });
    } else {
      dataKeyFormGroup = this.fb.group({
        key: ['', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
        type: [this.rawData ? 'raw' : this.valueTypeKeys[0]],
        value: ['', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
        reportStrategy: [{value: null, disabled: this.isReportStrategyDisabled()}]
      });
      this.attachCalibrationControls(dataKeyFormGroup, {} as MappingDataKey);
    }
    this.lastAddedControl = dataKeyFormGroup;
    this.keysListFormArray.insert(0, dataKeyFormGroup);
    this.searchControl.setValue('', { emitEvent: false });
    this.updateFilteredControls();
  }

  deleteKey($event: Event, index: number): void {
    if ($event) {
      $event.stopPropagation();
    }
    this.keysListFormArray.removeAt(index);
    this.keysListFormArray.markAsDirty();
    this.updateFilteredControls();
  }

  cancel(): void {
    this.popover?.hide();
  }

  applyKeysData(): void {
    if (this.keysType === MappingKeysType.CUSTOM) {
      const custom: {[key: string]: any} = {};
      for (const key of this.keysListFormArray.value) {
        custom[key.key] = key.value;
      }
      this.keysDataApplied.emit(custom);
      return;
    }
    const keys: any[] = this.keysListFormArray.controls.map((ctrl) => {
      const group = ctrl as UntypedFormGroup;
      // Drop UI-only fields (_id + calibration inputs) and emit
      // exactly one of modifier / scaling based on the per-row mode.
      const raw = group.getRawValue();
      const { reportStrategy, _id,
              modifierType, modifierValue, scaling,
              ...rest } = raw;
      const out: any = { ...rest };
      if (reportStrategy) out.reportStrategy = reportStrategy;
      if (this.calibrationEnabled && this.canCalibrate(group)) {
        const mode = this.calModeFor(group)?.value;
        if (mode === 'modifier' && modifierType) {
          out[modifierType] = modifierValue;
        } else if (mode === 'scaling' && scaling) {
          out.scaling = scaling;
        }
      }
      return out;
    });
    this.keysDataApplied.emit(keys);
  }

  /** Adds the calibration + UI id controls to a freshly-built row.
   *  No-op for panels where calibration doesn't apply (MQTT / REST /
   *  RPC / custom). The `_id` control is needed because the form
   *  group value itself is the submission payload and we need a
   *  stable key for `calModeControlMap` lookups. */
  private attachCalibrationControls(group: UntypedFormGroup, keyData: MappingDataKey): void {
    if (!this.calibrationEnabled) return;
    const id = generateSecret(5);
    const existingModifierType =
      keyData.multiplier !== undefined ? ModifierType.MULTIPLIER :
      keyData.divider !== undefined    ? ModifierType.DIVIDER :
      keyData.adder !== undefined      ? ModifierType.ADDER :
      keyData.subtractor !== undefined ? ModifierType.SUBTRACTOR :
      null;
    const existingModifierValue =
      keyData.multiplier ?? keyData.divider ?? keyData.adder ?? keyData.subtractor ?? 1;
    const hasModifier = existingModifierType !== null;
    const hasScaling = !!keyData.scaling;
    const initialMode: 'none' | 'modifier' | 'scaling' =
      hasModifier ? 'modifier' : hasScaling ? 'scaling' : 'none';
    const modeCtrl = this.fb.control<'none' | 'modifier' | 'scaling'>(initialMode);
    this.calModeControlMap.set(id, modeCtrl);
    group.addControl('_id', this.fb.control({ value: id, disabled: true }));
    group.addControl('modifierType', this.fb.control(existingModifierType ?? ModifierType.MULTIPLIER));
    group.addControl('modifierValue', this.fb.control(existingModifierValue));
    group.addControl('scaling', this.fb.group({
      rawMin: [keyData.scaling?.rawMin ?? 0],
      rawMax: [keyData.scaling?.rawMax ?? 65535],
      engMin: [keyData.scaling?.engMin ?? 0],
      engMax: [keyData.scaling?.engMax ?? 100],
    }));
    // Flipping the value type to a non-numeric (string / raw) forces
    // the mode back to 'none' so the persisted key doesn't carry
    // orphan calibration values alongside the new type.
    group.get('type')?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (!this.canCalibrate(group) && modeCtrl.value !== 'none') {
          modeCtrl.setValue('none');
        }
      });
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
          const key = (item.control.get('key')?.value || item.control.get('method')?.value || '').toLowerCase();
          const value = (item.control.get('value')?.value?.toString() || '').toLowerCase();
          return key.includes(search) || value.includes(search);
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
  }

  trackByFilteredItem(_: number, item: { control: UntypedFormGroup; index: number }): any {
    return item.control;
  }

  private prepareKeysFormArray(keys: Array<MappingDataKey | RpcMethodsMapping> | {[key: string]: any}): FormArray {
    const keysControlGroups: Array<AbstractControl> = [];
    if (keys) {
      if (this.keysType === MappingKeysType.CUSTOM) {
        keys = Object.keys(keys).map(key => {
          return {key, value: keys[key], type: ''};
        });
      }
      keys.forEach((keyData) => {
        let dataKeyFormGroup: FormGroup;
        if (this.keysType === MappingKeysType.RPC_METHODS) {
          dataKeyFormGroup = this.fb.group({
            method: [(keyData as RpcMethodsMapping).method, [Validators.required]],
            arguments: [[...(keyData as RpcMethodsMapping).arguments], []],
            // Preserved round-trip — discovery-imported OPC-UA entries
            // carry {nodeId, operation, valueType}; manually-added or
            // legacy entries stay null and the driver falls back to
            // calling an OPC-UA Method node by name.
            nodeId: [(keyData as any).nodeId ?? null],
            operation: [(keyData as any).operation ?? null],
            valueType: [(keyData as any).valueType ?? null]
          });
        } else if (this.keysType === MappingKeysType.CUSTOM) {
          const { key, value } = keyData;
          dataKeyFormGroup = this.fb.group({
            key: [key, [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
            value: [value, [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
          });
        } else {
          const { key, value, type, reportStrategy } = keyData;
          dataKeyFormGroup = this.fb.group({
            key: [key, [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
            type: [type],
            value: [value, [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
            reportStrategy: [{ value: reportStrategy, disabled: this.isReportStrategyDisabled()}]
          });
          this.attachCalibrationControls(dataKeyFormGroup, keyData as MappingDataKey);
        }
        keysControlGroups.push(dataKeyFormGroup);
      });
    }
    return this.fb.array(keysControlGroups);
  }

  valueTitle(keyControl: FormControl): string {
    const value = this.keysType === MappingKeysType.RPC_METHODS ? keyControl.get('method').value : keyControl.get('value').value;
    if (isDefinedAndNotNull(value)) {
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return value;
    }
    return '';
  }

  private isReportStrategyDisabled(): boolean {
    return !(this.withReportStrategy && (this.keysType === MappingKeysType.ATTRIBUTES || this.keysType === MappingKeysType.TIMESERIES));
  }
}
