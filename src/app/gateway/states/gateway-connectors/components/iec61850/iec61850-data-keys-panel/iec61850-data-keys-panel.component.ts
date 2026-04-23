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
import { ReportStrategyDefaultValue } from '../../../../../shared/public-api';
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
  IEC61850ControlModel,
  IEC61850DataKey,
  IEC61850FC,
  IEC61850RpcConfig,
  IEC61850ValueKey,
  IEC61850ValueType,
} from '../../../models/public-api';
import { generateSecret } from '@core/public-api';

/**
 * IEC 61850 keys panel. Thin wrapper on the shared industrial shell
 * + calibration CVA. Connector-specific bits retained:
 *   - Reference + FC (functional constraint) fields
 *   - ControlModel for RPC 'control' operations
 *   - Numeric-type gate (bool / string skip calibration)
 */
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
    IndustrialKeysPanelComponent,
    CalibrationBlockComponent,
  ],
})
export class IEC61850DataKeysPanelComponent implements OnInit {

  @Input() keys: (IEC61850DataKey | IEC61850RpcConfig)[] = [];
  @Input() keyType: IEC61850ValueKey = IEC61850ValueKey.TIMESERIES;

  @Output() keysDataApplied = new EventEmitter<(IEC61850DataKey | IEC61850RpcConfig)[]>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild(IndustrialKeysPanelComponent) shell!: IndustrialKeysPanelComponent;

  readonly valueTypes = Object.values(IEC61850ValueType);
  readonly fcOptions = Object.values(IEC61850FC);
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly IEC61850ValueKey = IEC61850ValueKey;

  readonly controlModelOptions = [
    { value: IEC61850ControlModel.STATUS_ONLY, label: 'Status Only' },
    { value: IEC61850ControlModel.DIRECT_NORMAL, label: 'Direct Normal' },
    { value: IEC61850ControlModel.SBO_NORMAL, label: 'SBO Normal' },
    { value: IEC61850ControlModel.DIRECT_ENHANCED, label: 'Direct Enhanced' },
    { value: IEC61850ControlModel.SBO_ENHANCED, label: 'SBO Enhanced' },
  ];

  keysFormArray: FormArray;
  spreadsheetColumns: SpreadsheetColumnConfig[] = [];
  searchFields: string[] = [];
  sortFields: IndustrialKeysSortFieldOption[] = [];

  /** Numeric IEC 61850 value types. Boolean / String skip calibration;
   *  Auto ('') is treated as numeric (resolved at read time; backend
   *  skips non-numeric values). */
  private static readonly NUMERIC_VALUE_TYPES = new Set<string>([
    '',
    IEC61850ValueType.INT32,
    IEC61850ValueType.FLOAT,
    IEC61850ValueType.DOUBLE,
    IEC61850ValueType.UNSIGNED,
  ]);

  private fb = new FormBuilder();

  get isRpc(): boolean {
    return this.keyType === IEC61850ValueKey.RPC;
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

  canCalibrate(row: FormGroup): boolean {
    const vt = (row.get('valueType')?.value ?? '').toString();
    return IEC61850DataKeysPanelComponent.NUMERIC_VALUE_TYPES.has(vt);
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
      ? ({ method: '', reference: '', fc: IEC61850FC.CO, operation: 'read' } as IEC61850RpcConfig)
      : ({ tag: '', reference: '', fc: IEC61850FC.MX } as IEC61850DataKey);
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
    this.keysDataApplied.emit(this.getFormValue());
  }

  onCancelRequested(): void {
    this.cancelled.emit();
  }

  private buildColumnConfigs(): void {
    if (this.isRpc) {
      this.searchFields = ['method', 'reference'];
      this.sortFields = [
        { value: 'method', label: 'Method' },
        { value: 'reference', label: 'Reference' },
        { value: 'fc', label: 'FC' },
        { value: 'operation', label: 'Operation' },
      ];
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
      return;
    }
    this.searchFields = ['tag', 'reference'];
    this.sortFields = [
      { value: 'tag', label: 'Key' },
      { value: 'reference', label: 'Reference' },
      { value: 'fc', label: 'FC' },
      { value: 'valueType', label: 'Value Type' },
    ];
    this.spreadsheetColumns = [
      { key: 'tag', label: 'Key', type: 'input', sortable: true, width: 'minmax(120px, 1.1fr)', placeholder: 'analog_input_1' },
      { key: 'reference', label: 'Reference', type: 'input', sortable: true, width: 'minmax(200px, 1.5fr)', placeholder: 'GenericIO/GGIO1.AnIn1.mag.f' },
      { key: 'fc', label: 'FC', type: 'select', sortable: true, width: 'minmax(70px, 0.5fr)',
        options: this.fcOptions.map(fc => ({ value: fc, label: fc })) },
      { key: 'valueType', label: 'Value Type', type: 'select', sortable: true, width: 'minmax(100px, 0.8fr)',
        options: [{ value: '', label: 'Auto' }, ...this.valueTypes.map(t => ({ value: t, label: t }))] },
      ...calibrationColumns((row) => this.canCalibrate(row)),
      ...reportStrategyColumns(),
    ];
  }

  private createKeyForm(key: IEC61850DataKey | IEC61850RpcConfig): FormGroup {
    const id = generateSecret(5);
    if (this.isRpc) {
      const rpc = key as IEC61850RpcConfig;
      return this.fb.group({
        id: [{ value: id, disabled: true }],
        method: [rpc.method || '', [Validators.required]],
        reference: [rpc.reference || '', [Validators.required]],
        fc: [rpc.fc || IEC61850FC.CO],
        valueType: [rpc.valueType || ''],
        operation: [rpc.operation || 'read', [Validators.required]],
        controlModel: [rpc.controlModel ?? IEC61850ControlModel.DIRECT_NORMAL],
      });
    }
    const dk = key as IEC61850DataKey;
    const calibration: CalibrationConfig = {
      ...(dk.multiplier !== undefined && { multiplier: dk.multiplier }),
      ...(dk.divider !== undefined && { divider: dk.divider }),
      ...(dk.adder !== undefined && { adder: dk.adder }),
      ...(dk.subtractor !== undefined && { subtractor: dk.subtractor }),
      ...(dk.scaling && { scaling: dk.scaling }),
    };
    return this.fb.group({
      id: [{ value: id, disabled: true }],
      tag: [dk.tag || '', [Validators.required]],
      reference: [dk.reference || '', [Validators.required]],
      fc: [dk.fc || IEC61850FC.MX],
      valueType: [dk.valueType || ''],
      calibration: [calibration],
      reportStrategy: [dk.reportStrategy || null],
    });
  }

  private getFormValue(): (IEC61850DataKey | IEC61850RpcConfig)[] {
    return this.keysFormArray.getRawValue().map((row: any) => {
      if (this.isRpc) {
        const { id: _id, ...rest } = row;
        return rest;
      }
      const out: any = {
        tag: row.tag,
        reference: row.reference,
        fc: row.fc,
      };
      if (row.valueType) out.valueType = row.valueType;
      if (row.calibration) Object.assign(out, row.calibration);
      if (row.reportStrategy) out.reportStrategy = row.reportStrategy;
      return out;
    });
  }
}
