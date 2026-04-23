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
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  UntypedFormGroup,
  Validators,
} from '@angular/forms';
import { coerceBoolean, SharedModule } from '@shared/public-api';
import { TbPopoverComponent } from '@shared/components/popover.component';
import { Store } from '@ngrx/store';
import { PageComponent } from '@shared/public-api';
import { AppState, isDefinedAndNotNull } from '@core/public-api';
import {
  MappingDataKey,
  MappingKeysType,
  MqttConverterType,
  OPCUaSourceType,
  RpcMethodsMapping,
  SourceType,
} from '../../models/public-api';
import {
  ConnectorType,
  MappingValueType,
  noLeadTrailSpacesRegex,
  ReportStrategyDefaultValue,
  mappingValueTypesMap,
} from '../../../../shared/public-api';
import { CommonModule } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TypeValuePanelComponent } from '../type-value-panel/type-value-panel.component';
import { ConnectorMappingHelpLinkPipe } from '../../pipes/public-api';
import { SpreadsheetColumnConfig, SelectOption } from '../../../../shared/components/spreadsheet-keys/spreadsheet-keys.models';
import {
  CalibrationBlockComponent,
  CalibrationConfig,
  IndustrialKeysPanelComponent,
  IndustrialKeysSortFieldOption,
  ReportStrategyComponent,
  calibrationColumns,
  reportStrategyColumns,
} from '../../../../shared/components/public-api';
import { generateSecret } from '@core/public-api';

/**
 * Mapping keys panel — shared by OPC-UA / MQTT / REST. Migrated onto
 * the industrial shell + calibration CVA. Three distinct row shapes:
 *   - ATTRIBUTES / TIMESERIES: `{key, type (source-type), value}`,
 *     plus calibration + report strategy for OPC-UA only.
 *   - CUSTOM: `{key, value}` pairs; emitted as a dict on save.
 *   - RPC_METHODS: `{method, arguments, nodeId, operation, valueType}`,
 *     with nested `arguments` FormArray — fullscreen disabled.
 */
@Component({
  selector: 'tb-mapping-data-keys-panel',
  templateUrl: './mapping-data-keys-panel.component.html',
  styleUrls: ['./mapping-data-keys-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    ReactiveFormsModule,
    ReportStrategyComponent,
    TypeValuePanelComponent,
    ConnectorMappingHelpLinkPipe,
    IndustrialKeysPanelComponent,
    CalibrationBlockComponent,
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

  @ViewChild(IndustrialKeysPanelComponent) shell!: IndustrialKeysPanelComponent;

  readonly MappingKeysType = MappingKeysType;
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly ConnectorType = ConnectorType;

  keysListFormArray: FormArray;
  spreadsheetColumns: SpreadsheetColumnConfig[] = [];
  searchFields: string[] = [];
  sortFields: IndustrialKeysSortFieldOption[] = [];

  errorText = '';

  private destroy$ = new Subject<void>();
  private cd = inject(ChangeDetectorRef);

  constructor(
    private fb: FormBuilder,
    private popover: TbPopoverComponent<MappingDataKeysPanelComponent>,
    protected store: Store<AppState>,
    private translate: TranslateService,
  ) {
    super(store);
  }

  /** Caller passes translation keys (e.g. `gateway.add-timeseries`)
   *  — translate them here because the shell component takes plain
   *  strings for its toolbar labels. Using `translate.instant()` keeps
   *  everything synchronous and avoids the pipe-in-attribute-binding
   *  edge cases we hit when evaluating `(x | translate) || ''` in
   *  the template. */
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

  get calibrationEnabled(): boolean {
    return this.connectorType === ConnectorType.OPCUA
      && (this.keysType === MappingKeysType.ATTRIBUTES
          || this.keysType === MappingKeysType.TIMESERIES);
  }

  get isRpc(): boolean {
    return this.keysType === MappingKeysType.RPC_METHODS;
  }

  get isCustom(): boolean {
    return this.keysType === MappingKeysType.CUSTOM;
  }

  get fullscreenSupported(): boolean {
    // RPC has nested arguments that don't map onto a flat grid.
    return this.keysType !== MappingKeysType.RPC_METHODS;
  }

  canCalibrate(_row: FormGroup): boolean {
    // OPC-UA's `type` is a source type (path / identifier / constant),
    // not a value type — we don't know the numeric-ness at config
    // time. Backend skips calibration for non-numeric reads.
    return this.calibrationEnabled;
  }

  ngOnInit(): void {
    this.keysListFormArray = this.prepareKeysFormArray(this.keys);
    this.buildColumnConfigs();
  }

  override ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    super.ngOnDestroy?.();
  }

  onAddRequested(): void {
    const form = this.createKeyForm(null);
    this.keysListFormArray.insert(0, form);
    this.shell?.setLastAddedId(form.getRawValue()._id || null);
    this.shell?.refresh();
  }

  onDeleteRequested(index: number): void {
    this.keysListFormArray.removeAt(index);
    this.keysListFormArray.markAsDirty();
    this.shell?.refresh();
  }

  onApplyRequested(): void {
    if (this.isCustom) {
      const dict: {[key: string]: any} = {};
      for (const key of this.keysListFormArray.value) {
        dict[key.key] = key.value;
      }
      this.keysDataApplied.emit(dict);
      return;
    }
    const out = this.keysListFormArray.controls.map((ctrl) => {
      const group = ctrl as UntypedFormGroup;
      const raw = group.getRawValue();
      const { reportStrategy, _id,
              calibration, ...rest } = raw;
      const result: any = { ...rest };
      if (reportStrategy) result.reportStrategy = reportStrategy;
      if (this.calibrationEnabled && calibration) Object.assign(result, calibration);
      return result;
    });
    this.keysDataApplied.emit(out);
  }

  onCancelRequested(): void {
    this.popover?.hide();
  }

  valueTitle(keyControl: FormGroup): string {
    const v = this.isRpc
      ? keyControl.get('method')?.value
      : keyControl.get('value')?.value;
    if (!isDefinedAndNotNull(v)) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }

  private buildColumnConfigs(): void {
    if (this.isRpc) {
      this.searchFields = ['method'];
      this.sortFields = [{ value: 'method', label: 'Method' }];
      this.spreadsheetColumns = [
        { key: 'method', label: 'Method', type: 'input', sortable: true, width: 'minmax(160px, 1fr)' },
      ];
      return;
    }
    if (this.isCustom) {
      this.searchFields = ['key', 'value'];
      this.sortFields = [
        { value: 'key', label: 'Key' },
        { value: 'value', label: 'Value' },
      ];
      this.spreadsheetColumns = [
        { key: 'key', label: 'Key', type: 'input', sortable: true, width: 'minmax(160px, 1.2fr)', placeholder: 'name' },
        { key: 'value', label: 'Value', type: 'input', sortable: true, width: 'minmax(200px, 1.4fr)', placeholder: 'value' },
      ];
      return;
    }
    // Attributes / timeseries / attribute_updates.
    this.searchFields = ['key', 'value'];
    this.sortFields = [
      { value: 'key', label: 'Key' },
      { value: 'value', label: 'Value' },
    ];
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
    // Calibration columns visible only when the panel represents
    // an OPC-UA attribute / timeseries (calibrationEnabled). MQTT /
    // REST share this panel but don't need calibration. Report
    // strategy visible for any attribute / timeseries row.
    if (this.calibrationEnabled) {
      cols.push(...calibrationColumns((row) => this.canCalibrate(row)));
    }
    if (this.withReportStrategy
        && (this.keysType === MappingKeysType.ATTRIBUTES
            || this.keysType === MappingKeysType.TIMESERIES)) {
      cols.push(...reportStrategyColumns());
    }
    this.spreadsheetColumns = cols;
  }

  private prepareKeysFormArray(keys: Array<MappingDataKey | RpcMethodsMapping> | {[key: string]: any}): FormArray {
    const groups: AbstractControl[] = [];
    if (keys) {
      if (this.isCustom) {
        keys = Object.keys(keys).map(key => ({ key, value: (keys as any)[key], type: '' }));
      }
      (keys as any[]).forEach((keyData) => {
        groups.push(this.createKeyForm(keyData));
      });
    }
    return this.fb.array(groups);
  }

  /** Build a form for the current keysType. Pass `null` for an empty
   *  new row; otherwise pass the persisted data for round-tripping. */
  private createKeyForm(keyData: any | null): UntypedFormGroup {
    const rowId = generateSecret(5);
    if (this.isRpc) {
      const d = keyData as RpcMethodsMapping | null;
      return this.fb.group({
        _id: [{ value: rowId, disabled: true }],
        method: [d?.method ?? '', [Validators.required]],
        arguments: [d ? [...d.arguments] : [], []],
        nodeId: [(d as any)?.nodeId ?? null],
        operation: [(d as any)?.operation ?? null],
        valueType: [(d as any)?.valueType ?? null],
      });
    }
    if (this.isCustom) {
      return this.fb.group({
        _id: [{ value: rowId, disabled: true }],
        key: [keyData?.key ?? '', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
        value: [keyData?.value ?? '', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
      });
    }
    // Attributes / timeseries / attribute_updates.
    const calibration: CalibrationConfig = keyData ? {
      ...(keyData.multiplier !== undefined && { multiplier: keyData.multiplier }),
      ...(keyData.divider !== undefined && { divider: keyData.divider }),
      ...(keyData.adder !== undefined && { adder: keyData.adder }),
      ...(keyData.subtractor !== undefined && { subtractor: keyData.subtractor }),
      ...(keyData.scaling && { scaling: keyData.scaling }),
    } : {};
    return this.fb.group({
      _id: [{ value: rowId, disabled: true }],
      key: [keyData?.key ?? '', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
      type: [keyData?.type ?? (this.rawData ? 'raw' : this.valueTypeKeys[0])],
      value: [keyData?.value ?? '', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
      reportStrategy: [{ value: keyData?.reportStrategy ?? null, disabled: this.isReportStrategyDisabled() }],
      calibration: [calibration],
    });
  }

  private isReportStrategyDisabled(): boolean {
    return !(this.withReportStrategy && (this.keysType === MappingKeysType.ATTRIBUTES || this.keysType === MappingKeysType.TIMESERIES));
  }
}
