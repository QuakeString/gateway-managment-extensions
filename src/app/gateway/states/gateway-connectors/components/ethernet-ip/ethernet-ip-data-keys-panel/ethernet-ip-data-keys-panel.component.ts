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
  ValidatorFn,
  AbstractControl,
  ValidationErrors,
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
  isValidEthernetIpTag,
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

  @Input() panelTitle = 'gateway.gw-data-keys';
  @Input() addKeyTitle = 'gateway.gw-add-key';
  @Input() deleteKeyTitle = 'gateway.gw-delete-key';
  @Input() noKeysText = 'gateway.keys-no-data-configured';
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
        { value: 'method', label: 'gateway.method' },
        { value: 'plcTag', label: 'gateway.eip-plc-tag' },
      ];
      this.spreadsheetColumns = [
        { key: 'method', label: 'gateway.method', type: 'input', sortable: true, width: 'minmax(140px, 1.2fr)', placeholder: 'readTemperature' },
        { key: 'operation', label: 'gateway.gw-operation', type: 'select', sortable: true, width: 'minmax(100px, 0.8fr)', translateLabels: true,
          options: [{ value: 'read', label: 'gateway.gw-read' }, { value: 'write', label: 'gateway.gw-write' }] },
        { key: 'plcTag', label: 'gateway.eip-plc-tag', type: 'input', sortable: true, width: 'minmax(140px, 1.2fr)',
          placeholder: this.isSLC ? 'N7:0' : 'MotorSpeed' },
        { key: 'valueType', label: 'gateway.gw-value-type', type: 'select', sortable: true, width: 'minmax(120px, 1fr)', translateLabels: true,
          options: [{ value: null as any, label: 'gateway.gw-auto' }, ...this.dataTypes.map(t => ({ value: t, label: t }))] },
      ];
      return;
    }
    this.searchFields = ['tag', 'plcTag'];
    this.sortFields = [
      { value: 'tag', label: 'gateway.gw-key' },
      { value: 'plcTag', label: 'gateway.eip-plc-tag' },
    ];
    // Calibration + report-strategy columns come from the shared
    // helpers so every connector panel's spreadsheet view has the
    // same set. EIP rows have no value type on the mapping, so
    // calibration is offered on every row (backend skips non-
    // numeric reads at runtime).
    this.spreadsheetColumns = [
      { key: 'tag', label: 'gateway.gw-key', type: 'input', sortable: true, width: 'minmax(140px, 1.2fr)', placeholder: 'temperature' },
      { key: 'plcTag', label: 'gateway.eip-plc-tag', type: 'input', sortable: true, width: 'minmax(180px, 1.4fr)',
        placeholder: this.isSLC ? 'N7:0' : 'Program:MainProgram.Temperature' },
      ...calibrationColumns(() => true),
      ...reportStrategyColumns(),
    ];
  }

  /** Validates plcTag against the addressing the selected PLC actually
   *  uses: SLC/MicroLogix data files (N7:0, B3/17, T4:0.ACC) or Logix
   *  symbolic tags (MotorSpeed, Program:Main.Temp). Without this a typo
   *  like "N7:" only surfaces as a runtime read error on the PLC. */
  private plcTagValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = (control.value ?? '').toString();
      if (!value.trim()) {
        return null;   // required-validator's job
      }
      return isValidEthernetIpTag(value, this.isSLC) ? null : { invalidPlcTag: true };
    };
  }

  private createKeyForm(key: EthernetIPDataKey | EthernetIPRpcConfig): FormGroup {
    const id = generateSecret(5);
    if (this.isRpc) {
      const rpc = key as EthernetIPRpcConfig;
      return this.fb.group({
        id: [{ value: id, disabled: true }],
        method: [rpc.method || '', [Validators.required]],
        plcTag: [rpc.plcTag || '', [Validators.required, this.plcTagValidator()]],
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
      plcTag: [dk.plcTag || '', [Validators.required, this.plcTagValidator()]],
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
