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
import { SpreadsheetColumnConfig, SelectOption } from '../../../../../shared/components/spreadsheet-keys/spreadsheet-keys.models';
import {
  EthernetIPDataKey,
  EthernetIPDataType,
  EthernetIPRpcConfig,
  EthernetIPValueKey,
} from '../../../models/public-api';
import { generateSecret } from '@core/public-api';

/**
 * EIP keys panel. Migrated onto the shared IndustrialKeysPanel shell
 * — this wrapper now only owns EIP-specific bits:
 *   - Form shape (tag / plcTag / calibration / reportStrategy OR
 *     method / plcTag / valueType / operation for RPC)
 *   - Column config for the spreadsheet view
 *   - Row header + body templates
 *
 * The shell handles search / sort / fullscreen / virtualization, and
 * the CalibrationBlockComponent (CVA) handles the mode + modifier +
 * scaling UI behind a single `calibration` form control.
 */
@Component({
  selector: 'tb-ethernet-ip-data-keys-panel',
  templateUrl: './ethernet-ip-data-keys-panel.component.html',
  styleUrls: ['./ethernet-ip-data-keys-panel.component.scss'],
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
export class EthernetIPDataKeysPanelComponent implements OnInit {

  @Input() panelTitle = 'Data Keys';
  @Input() addKeyTitle = 'Add key';
  @Input() deleteKeyTitle = 'Delete key';
  @Input() noKeysText = 'No data keys configured';
  @Input() keys: Array<EthernetIPDataKey | EthernetIPRpcConfig> = [];
  @Input() keysType: EthernetIPValueKey = EthernetIPValueKey.TIMESERIES;
  @Input() isSLC = false;

  @Output() keysDataApplied = new EventEmitter<Array<EthernetIPDataKey | EthernetIPRpcConfig>>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild(IndustrialKeysPanelComponent) shell!: IndustrialKeysPanelComponent;

  readonly dataTypes = Object.values(EthernetIPDataType);
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly EthernetIPValueKey = EthernetIPValueKey;

  keysFormArray: FormArray;
  spreadsheetColumns: SpreadsheetColumnConfig[] = [];
  searchFields: string[] = [];
  sortFields: IndustrialKeysSortFieldOption[] = [];

  private fb = new FormBuilder();

  get isRpc(): boolean {
    return this.keysType === EthernetIPValueKey.RPC;
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
      ? ({ method: '', plcTag: '', operation: 'read' } as EthernetIPRpcConfig)
      : ({ tag: '', plcTag: '' } as EthernetIPDataKey);
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
      this.searchFields = ['method', 'plcTag'];
      this.sortFields = [
        { value: 'method', label: 'Method' },
        { value: 'plcTag', label: 'PLC Tag' },
      ];
      this.spreadsheetColumns = [
        { key: 'method', label: 'Method', type: 'input', sortable: true, width: 'minmax(140px, 1.2fr)', placeholder: 'readTemperature' },
        { key: 'operation', label: 'Operation', type: 'select', sortable: true, width: 'minmax(100px, 0.8fr)',
          options: [{ value: 'read', label: 'Read' }, { value: 'write', label: 'Write' }] },
        { key: 'plcTag', label: 'PLC Tag', type: 'input', sortable: true, width: 'minmax(140px, 1.2fr)',
          placeholder: this.isSLC ? 'N7:0' : 'MotorSpeed' },
        { key: 'valueType', label: 'Value Type', type: 'select', sortable: true, width: 'minmax(120px, 1fr)',
          options: [{ value: null as any, label: 'Auto' }, ...this.dataTypes.map(t => ({ value: t, label: t }))] },
      ];
      return;
    }
    this.searchFields = ['tag', 'plcTag'];
    this.sortFields = [
      { value: 'tag', label: 'Key' },
      { value: 'plcTag', label: 'PLC Tag' },
    ];
    // Calibration + report-strategy columns come from the shared
    // helpers so every connector panel's spreadsheet view has the
    // same set. EIP rows have no value type on the mapping, so
    // calibration is offered on every row (backend skips non-
    // numeric reads at runtime).
    this.spreadsheetColumns = [
      { key: 'tag', label: 'Key', type: 'input', sortable: true, width: 'minmax(140px, 1.2fr)', placeholder: 'temperature' },
      { key: 'plcTag', label: 'PLC Tag', type: 'input', sortable: true, width: 'minmax(180px, 1.4fr)',
        placeholder: this.isSLC ? 'N7:0' : 'Program:MainProgram.Temperature' },
      ...calibrationColumns(() => true),
      ...reportStrategyColumns(),
    ];
  }

  private createKeyForm(key: EthernetIPDataKey | EthernetIPRpcConfig): FormGroup {
    const id = generateSecret(5);
    if (this.isRpc) {
      const rpc = key as EthernetIPRpcConfig;
      return this.fb.group({
        id: [{ value: id, disabled: true }],
        method: [rpc.method || '', [Validators.required]],
        plcTag: [rpc.plcTag || '', [Validators.required]],
        valueType: [rpc.valueType || null],
        operation: [rpc.operation || 'read', [Validators.required]],
      });
    }
    const dk = key as EthernetIPDataKey;
    // Calibration CVA takes the flat persisted shape as-is. The form
    // control emits the same shape back on change, so we just pipe
    // the key fields straight through.
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
      plcTag: [dk.plcTag || '', [Validators.required]],
      calibration: [calibration],
      reportStrategy: [dk.reportStrategy || null],
    });
  }

  private getFormValue(): Array<EthernetIPDataKey | EthernetIPRpcConfig> {
    return this.keysFormArray.getRawValue().map((row: any) => {
      if (this.isRpc) {
        const result: any = { method: row.method, plcTag: row.plcTag, operation: row.operation };
        if (row.valueType) result.valueType = row.valueType;
        return result;
      }
      // Spread calibration's flat shape directly into the output —
      // `{multiplier: 0.1}` / `{scaling: {...}}` / `{}` depending on
      // the mode the CVA was in.
      const out: any = { tag: row.tag, plcTag: row.plcTag };
      if (row.calibration) Object.assign(out, row.calibration);
      if (row.reportStrategy) out.reportStrategy = row.reportStrategy;
      return out;
    });
  }
}
