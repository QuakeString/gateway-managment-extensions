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
  DNP3_NUMERIC_POINT_TYPES,
  DNP3_RESERVED_RPCS,
  Dnp3AttributeUpdate,
  Dnp3CommandMode,
  Dnp3Encoding,
  Dnp3OpType,
  Dnp3OutputPointType,
  Dnp3PointKey,
  Dnp3PointType,
  Dnp3QualityMode,
  Dnp3RpcConfig,
  Dnp3TripClose,
  Dnp3ValueKey,
} from '../../../models/public-api';
import { generateSecret } from '@core/public-api';

type Dnp3Key = Dnp3PointKey | Dnp3AttributeUpdate | Dnp3RpcConfig;

/** A configured RPC may not take a reserved method name. */
function notReserved(control: AbstractControl): ValidationErrors | null {
  const name = (control.value ?? '').toString().trim();
  return DNP3_RESERVED_RPCS.includes(name) ? { reservedMethod: true } : null;
}

/**
 * DNP3 keys panel, on the shared IndustrialKeysPanel shell. Three shapes:
 *   - timeseries / attributes: a measured point (point type + index), its
 *     double-bit state names, quality flags, octet-string encoding,
 *     calibration (numeric types) and report strategy;
 *   - attribute updates: a shared attribute that becomes a command — the
 *     on/off CROBs of a binary output, or a set point in its encoding;
 *   - RPC methods: a named command on one output point.
 */
@Component({
  selector: 'tb-dnp3-data-keys-panel',
  templateUrl: './dnp3-data-keys-panel.component.html',
  styleUrls: ['./dnp3-data-keys-panel.component.scss'],
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
export class Dnp3DataKeysPanelComponent implements OnInit {

  @Input() panelTitle = 'gateway.gw-data-keys';
  @Input() addKeyTitle = 'gateway.gw-add-key';
  @Input() deleteKeyTitle = 'gateway.gw-delete-key';
  @Input() noKeysText = 'gateway.keys-no-data-configured';
  @Input() keys: Dnp3Key[] = [];
  @Input() keysType: Dnp3ValueKey = Dnp3ValueKey.TIMESERIES;
  /** Offer security statistics (gateway 4.5.0). */
  @Input() securityStatistics = true;

  @Output() keysDataApplied = new EventEmitter<Dnp3Key[]>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild(IndustrialKeysPanelComponent) shell!: IndustrialKeysPanelComponent;

  get pointTypes(): string[] {
    return Object.values(Dnp3PointType)
      .filter(type => this.securityStatistics || type !== Dnp3PointType.SECURITY_STATISTIC);
  }
  readonly outputPointTypes = Object.values(Dnp3OutputPointType);
  readonly qualityModes = Object.values(Dnp3QualityMode);
  readonly commandModes = Object.values(Dnp3CommandMode);
  readonly opTypes = Object.values(Dnp3OpType);
  readonly tripCloses = Object.values(Dnp3TripClose);
  readonly encodings = Object.values(Dnp3Encoding);
  readonly states = ['0', '1', '2', '3'];
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;

  keysFormArray: FormArray;
  spreadsheetColumns: SpreadsheetColumnConfig[] = [];
  searchFields: string[] = [];
  sortFields: IndustrialKeysSortFieldOption[] = [];

  private fb = new FormBuilder();

  get isRpc(): boolean {
    return this.keysType === Dnp3ValueKey.RPC;
  }

  get isUpdate(): boolean {
    return this.keysType === Dnp3ValueKey.ATTRIBUTES_UPDATES;
  }

  get isCommand(): boolean {
    return this.isRpc || this.isUpdate;
  }

  canCalibrate(row: FormGroup): boolean {
    return DNP3_NUMERIC_POINT_TYPES.has(row.get('pointType')?.value);
  }

  isDoubleBit(row: FormGroup): boolean {
    return row.get('pointType')?.value === Dnp3PointType.DOUBLE_BIT_BINARY;
  }

  isOctetString(row: FormGroup): boolean {
    return row.get('pointType')?.value === Dnp3PointType.OCTET_STRING;
  }

  isBinaryOutput(row: FormGroup): boolean {
    return row.get('pointType')?.value === Dnp3OutputPointType.BINARY_OUTPUT;
  }

  ngOnInit(): void {
    this.keysFormArray = this.fb.array([]);
    (this.keys ?? []).forEach(key => this.keysFormArray.push(this.createKeyForm(key)));
    this.buildColumnConfigs();
  }

  onAddRequested(): void {
    const empty: Dnp3Key = this.isRpc
      ? { method: '', pointType: Dnp3OutputPointType.BINARY_OUTPUT, index: 0 } as Dnp3RpcConfig
      : this.isUpdate
        ? { key: '', pointType: Dnp3OutputPointType.ANALOG_OUTPUT, index: 0 } as Dnp3AttributeUpdate
        : { key: '', pointType: Dnp3PointType.ANALOG_INPUT, index: 0 } as Dnp3PointKey;
    const form = this.createKeyForm(empty);
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
    const option = (prefix: string) => (value: string) => ({ value, label: `gateway.dnp3-${prefix}-${value}` });
    const index: SpreadsheetColumnConfig = {
      key: 'index', label: 'gateway.dnp3-index', type: 'number', sortable: true, width: 'minmax(80px, 0.6fr)', placeholder: '0',
    };
    if (this.isCommand) {
      const nameKey = this.isRpc ? 'method' : 'key';
      this.searchFields = [nameKey, 'pointType'];
      this.sortFields = [
        { value: nameKey, label: this.isRpc ? 'gateway.method' : 'gateway.gw-key' },
        { value: 'pointType', label: 'gateway.dnp3-point-type' },
        { value: 'index', label: 'gateway.dnp3-index' },
      ];
      this.spreadsheetColumns = [
        { key: nameKey, label: this.isRpc ? 'gateway.method' : 'gateway.gw-key', type: 'input', sortable: true,
          width: 'minmax(140px, 1.3fr)', placeholder: this.isRpc ? 'tripBreaker' : 'setpoint',
          errorText: this.isRpc ? 'gateway.dnp3-method-reserved' : undefined },
        { key: 'pointType', label: 'gateway.dnp3-point-type', type: 'select', sortable: true, width: 'minmax(150px, 1.2fr)',
          translateLabels: true, options: this.outputPointTypes.map(option('point-type')) },
        index,
        { key: 'mode', label: 'gateway.dnp3-mode', type: 'select', sortable: true, width: 'minmax(160px, 1.2fr)',
          translateLabels: true, options: this.commandModes.map(option('mode')) },
        { key: 'encoding', label: 'gateway.dnp3-encoding', type: 'select', width: 'minmax(110px, 0.9fr)',
          options: this.encodings.map(value => ({ value, label: value })),
          cellVisible: (row) => !this.isBinaryOutput(row) },
      ];
      return;
    }
    this.searchFields = ['key', 'pointType'];
    this.sortFields = [
      { value: 'key', label: 'gateway.gw-key' },
      { value: 'pointType', label: 'gateway.dnp3-point-type' },
      { value: 'index', label: 'gateway.dnp3-index' },
    ];
    this.spreadsheetColumns = [
      { key: 'key', label: 'gateway.gw-key', type: 'input', sortable: true, width: 'minmax(130px, 1.2fr)', placeholder: 'busVoltage' },
      { key: 'pointType', label: 'gateway.dnp3-point-type', type: 'select', sortable: true, width: 'minmax(160px, 1.2fr)',
        translateLabels: true, options: this.pointTypes.map(option('point-type')) },
      index,
      { key: 'quality', label: 'gateway.dnp3-quality', type: 'select', width: 'minmax(110px, 0.9fr)',
        translateLabels: true, options: this.qualityModes.map(option('quality')) },
      ...calibrationColumns((row) => this.canCalibrate(row)),
      ...reportStrategyColumns(),
    ];
  }

  private createKeyForm(key: Dnp3Key): FormGroup {
    const id = generateSecret(5);
    const indexValidators = [Validators.required, Validators.min(0), Validators.max(65535)];
    if (this.isCommand) {
      const command = key as Dnp3RpcConfig & Dnp3AttributeUpdate;
      return this.fb.group({
        id: [{ value: id, disabled: true }],
        ...(this.isRpc
          ? { method: [command.method || '', [Validators.required, Validators.pattern(/\S/), notReserved]] }
          : { key: [command.key || '', [Validators.required, Validators.pattern(/\S/)]] }),
        pointType: [command.pointType || Dnp3OutputPointType.BINARY_OUTPUT, [Validators.required]],
        index: [command.index ?? 0, indexValidators],
        mode: [command.mode || Dnp3CommandMode.DIRECT],
        encoding: [command.encoding || Dnp3Encoding.FLOAT32],
        opType: [command.opType || Dnp3OpType.PULSE_ON],
        tripClose: [command.tripClose || Dnp3TripClose.NUL],
        onOpType: [command.onOpType || Dnp3OpType.LATCH_ON],
        onTripClose: [command.onTripClose || Dnp3TripClose.NUL],
        offOpType: [command.offOpType || Dnp3OpType.LATCH_OFF],
        offTripClose: [command.offTripClose || Dnp3TripClose.NUL],
        count: [command.count ?? 1, [Validators.min(0), Validators.max(255)]],
        onTimeMs: [command.onTimeMs ?? 1000, [Validators.min(0)]],
        offTimeMs: [command.offTimeMs ?? 0, [Validators.min(0)]],
      });
    }
    const point = key as Dnp3PointKey;
    const calibration: CalibrationConfig = {
      ...(point.multiplier !== undefined && { multiplier: point.multiplier }),
      ...(point.divider !== undefined && { divider: point.divider }),
      ...(point.adder !== undefined && { adder: point.adder }),
      ...(point.subtractor !== undefined && { subtractor: point.subtractor }),
      ...(point.scaling && { scaling: point.scaling }),
    };
    return this.fb.group({
      id: [{ value: id, disabled: true }],
      key: [point.key || '', [Validators.required, Validators.pattern(/\S/)]],
      pointType: [point.pointType || Dnp3PointType.ANALOG_INPUT, [Validators.required]],
      index: [point.index ?? 0, indexValidators],
      quality: [point.quality || Dnp3QualityMode.NONE],
      onlineOnly: [!!point.onlineOnly],
      encoding: [point.encoding || ''],
      states: this.fb.group({
        '0': [point.states?.['0'] ?? ''],
        '1': [point.states?.['1'] ?? ''],
        '2': [point.states?.['2'] ?? ''],
        '3': [point.states?.['3'] ?? ''],
      }),
      calibration: [calibration],
      reportStrategy: [point.reportStrategy || null],
    });
  }

  /** The persisted shape: only what applies to the row, defaults left out. */
  private getFormValue(): Dnp3Key[] {
    return this.keysFormArray.getRawValue().map((row: any) => {
      if (this.isCommand) {
        const out: any = {
          ...(this.isRpc ? { method: row.method.trim() } : { key: row.key.trim() }),
          pointType: row.pointType,
          index: Number(row.index),
          mode: row.mode,
        };
        if (row.pointType === Dnp3OutputPointType.ANALOG_OUTPUT) {
          out.encoding = row.encoding;
          return out;
        }
        if (this.isRpc) {
          out.opType = row.opType;
          out.tripClose = row.tripClose;
        } else {
          out.onOpType = row.onOpType;
          out.onTripClose = row.onTripClose;
          out.offOpType = row.offOpType;
          out.offTripClose = row.offTripClose;
        }
        out.count = Number(row.count);
        out.onTimeMs = Number(row.onTimeMs);
        out.offTimeMs = Number(row.offTimeMs);
        return out;
      }
      const out: any = {
        key: row.key.trim(),
        pointType: row.pointType,
        index: Number(row.index),
      };
      if (row.quality && row.quality !== Dnp3QualityMode.NONE) out.quality = row.quality;
      if (row.onlineOnly) out.onlineOnly = true;
      if (row.pointType === Dnp3PointType.OCTET_STRING && row.encoding) out.encoding = row.encoding;
      if (row.pointType === Dnp3PointType.DOUBLE_BIT_BINARY) {
        const states = Object.fromEntries(
          Object.entries(row.states ?? {}).filter(([, name]) => (name as string)?.trim())
            .map(([state, name]) => [state, (name as string).trim()]),
        );
        if (Object.keys(states).length) out.states = states;
      }
      if (row.calibration && DNP3_NUMERIC_POINT_TYPES.has(row.pointType)) Object.assign(out, row.calibration);
      if (row.reportStrategy) out.reportStrategy = row.reportStrategy;
      return out;
    });
  }
}
