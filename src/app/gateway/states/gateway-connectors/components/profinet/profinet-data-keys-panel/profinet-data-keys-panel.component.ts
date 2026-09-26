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
  PROFINET_NUMERIC_TYPES,
  PROFINET_RESERVED_RPCS,
  PROFINET_TYPE_WIDTH,
  ProfinetArea,
  ProfinetAttributeUpdate,
  ProfinetKey,
  ProfinetQualityMode,
  ProfinetRpcConfig,
  ProfinetValueKey,
  ProfinetValueType,
} from '../../../models/public-api';
import { generateSecret } from '@core/public-api';

type ProfinetAnyKey = ProfinetKey | ProfinetAttributeUpdate | ProfinetRpcConfig;

/** The place's submodule: its data lengths, as the device's modules say. */
export interface ProfinetSubmodulePlace {
  slot: number;
  subslot: number;
  inputLength: number;
  outputLength: number;
  label: string;
}

/** A configured RPC may not take a reserved method name. */
function notReserved(control: AbstractControl): ValidationErrors | null {
  const name = (control.value ?? '').toString().trim();
  return PROFINET_RESERVED_RPCS.includes(name) ? { reservedMethod: true } : null;
}

/** Octets a row's value spans. */
export function profinetWidth(type: string, length?: number | string | null): number {
  if (type === ProfinetValueType.STRING || type === ProfinetValueType.BYTES) {
    return Number(length) || 0;
  }
  return PROFINET_TYPE_WIDTH[type] ?? 0;
}

/**
 * PROFINET keys panel, on the shared IndustrialKeysPanel shell. Every key
 * is a place in a submodule's IO data — slot, subslot, octet offset, type,
 * a bit for a bool — checked against the device's modules as the gateway
 * checks it at load:
 *   - timeseries / attributes: read from the input frame (or read back
 *     from the output), with quality, calibration and report strategy;
 *   - attribute updates: a shared attribute written to an output;
 *   - RPC methods: a named write to an output, or a read.
 */
@Component({
  selector: 'tb-profinet-data-keys-panel',
  templateUrl: './profinet-data-keys-panel.component.html',
  styleUrls: ['./profinet-data-keys-panel.component.scss'],
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
export class ProfinetDataKeysPanelComponent implements OnInit {

  @Input() panelTitle = 'gateway.gw-data-keys';
  @Input() addKeyTitle = 'gateway.gw-add-key';
  @Input() deleteKeyTitle = 'gateway.gw-delete-key';
  @Input() noKeysText = 'gateway.keys-no-data-configured';
  @Input() keys: ProfinetAnyKey[] = [];
  @Input() keysType: ProfinetValueKey = ProfinetValueKey.TIMESERIES;
  /** The device's submodules, to pick a place from and check it against. */
  @Input() submodules: ProfinetSubmodulePlace[] = [];

  @Output() keysDataApplied = new EventEmitter<ProfinetAnyKey[]>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild(IndustrialKeysPanelComponent) shell!: IndustrialKeysPanelComponent;

  readonly valueTypes = Object.values(ProfinetValueType);
  readonly areas = Object.values(ProfinetArea);
  readonly qualityModes = Object.values(ProfinetQualityMode);
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly ValueType = ProfinetValueType;

  keysFormArray: FormArray;
  spreadsheetColumns: SpreadsheetColumnConfig[] = [];
  searchFields: string[] = [];
  sortFields: IndustrialKeysSortFieldOption[] = [];

  private fb = new FormBuilder();

  get isRpc(): boolean {
    return this.keysType === ProfinetValueKey.RPC;
  }

  get isUpdate(): boolean {
    return this.keysType === ProfinetValueKey.ATTRIBUTES_UPDATES;
  }

  /** Reads: timeseries, attributes and an RPC with operation read. */
  isRead(row: FormGroup): boolean {
    return !this.isUpdate && (!this.isRpc || row.get('operation')?.value === 'read');
  }

  canCalibrate(row: FormGroup): boolean {
    return PROFINET_NUMERIC_TYPES.has(row.get('type')?.value);
  }

  isBool(row: FormGroup): boolean {
    return row.get('type')?.value === ProfinetValueType.BOOL;
  }

  hasLength(row: FormGroup): boolean {
    const type = row.get('type')?.value;
    return type === ProfinetValueType.STRING || type === ProfinetValueType.BYTES;
  }

  /** The submodules offering data in the row's frame. */
  placesFor(row: FormGroup): ProfinetSubmodulePlace[] {
    const output = this.areaOf(row) === ProfinetArea.OUTPUT;
    return this.submodules.filter(s => output ? s.outputLength > 0 : s.inputLength > 0);
  }

  placeKey(p: ProfinetSubmodulePlace): string {
    return `${p.slot}:${p.subslot}`;
  }

  ngOnInit(): void {
    this.keysFormArray = this.fb.array([]);
    (this.keys ?? []).forEach(key => this.keysFormArray.push(this.createKeyForm(key)));
    this.buildColumnConfigs();
  }

  onAddRequested(): void {
    const output = this.isUpdate || this.isRpc;
    const first = this.submodules.find(s => output ? s.outputLength > 0 : s.inputLength > 0);
    const place = { slot: first?.slot ?? 1, subslot: first?.subslot ?? 1, offset: 0, type: ProfinetValueType.UINT8 };
    const empty: ProfinetAnyKey = this.isRpc
      ? { method: '', ...place } as ProfinetRpcConfig
      : { key: '', ...place } as ProfinetKey;
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

  private areaOf(row: AbstractControl): ProfinetArea {
    if (this.isUpdate || (this.isRpc && row.get('operation')?.value !== 'read')) {
      return ProfinetArea.OUTPUT;
    }
    return row.get('area')?.value === ProfinetArea.OUTPUT ? ProfinetArea.OUTPUT : ProfinetArea.INPUT;
  }

  /** The place fits its submodule's data in its frame, as the gateway checks at load. */
  private placeValid(row: AbstractControl): ValidationErrors | null {
    const slot = Number(row.get('slot')?.value);
    const subslot = Number(row.get('subslot')?.value || 1);
    const sub = this.submodules.find(s => s.slot === slot && s.subslot === subslot);
    if (!sub) {
      return this.submodules.length ? { placeUnknown: true } : null;
    }
    const output = this.areaOf(row) === ProfinetArea.OUTPUT;
    const available = output ? sub.outputLength : sub.inputLength;
    const width = profinetWidth(row.get('type')?.value, row.get('length')?.value);
    const offset = Number(row.get('offset')?.value || 0);
    if (!width) {
      return { lengthRequired: true };
    }
    return offset + width > available ? { placeTooLong: { available } } : null;
  }

  private buildColumnConfigs(): void {
    const nameKey = this.isRpc ? 'method' : 'key';
    this.searchFields = [nameKey, 'type'];
    this.sortFields = [
      { value: nameKey, label: this.isRpc ? 'gateway.method' : 'gateway.gw-key' },
      { value: 'slot', label: 'gateway.profinet-slot' },
      { value: 'offset', label: 'gateway.profinet-offset' },
    ];
    const typeOptions = this.valueTypes.map(value => ({ value, label: value }));
    this.spreadsheetColumns = [
      { key: nameKey, label: this.isRpc ? 'gateway.method' : 'gateway.gw-key', type: 'input', sortable: true,
        width: 'minmax(140px, 1.3fr)', placeholder: this.isRpc ? 'setValve' : 'temperature',
        errorText: this.isRpc ? 'gateway.profinet-method-reserved' : undefined },
      { key: 'slot', label: 'gateway.profinet-slot', type: 'number', sortable: true, width: 'minmax(70px, 0.5fr)', placeholder: '1' },
      { key: 'subslot', label: 'gateway.profinet-subslot', type: 'number', width: 'minmax(80px, 0.5fr)', placeholder: '1' },
      { key: 'offset', label: 'gateway.profinet-offset', type: 'number', sortable: true, width: 'minmax(80px, 0.5fr)', placeholder: '0' },
      { key: 'type', label: 'gateway.profinet-type', type: 'select', sortable: true, width: 'minmax(110px, 0.8fr)', options: typeOptions },
      { key: 'bit', label: 'gateway.profinet-bit', type: 'number', width: 'minmax(60px, 0.4fr)', placeholder: '—',
        cellVisible: (row) => this.isBool(row) },
      ...(this.isUpdate || this.isRpc ? [] : [
        { key: 'quality', label: 'gateway.profinet-quality', type: 'select', width: 'minmax(110px, 0.8fr)',
          translateLabels: true, options: this.qualityModes.map(value => ({ value, label: `gateway.profinet-quality-${value}` })) },
        ...calibrationColumns((row) => this.canCalibrate(row)),
        ...reportStrategyColumns(),
      ] as SpreadsheetColumnConfig[]),
    ];
  }

  private createKeyForm(key: ProfinetAnyKey): FormGroup {
    const id = generateSecret(5);
    const k = key as ProfinetKey & ProfinetRpcConfig;
    const calibration: CalibrationConfig = {
      ...(k.multiplier !== undefined && { multiplier: k.multiplier }),
      ...(k.divider !== undefined && { divider: k.divider }),
      ...(k.adder !== undefined && { adder: k.adder }),
      ...(k.subtractor !== undefined && { subtractor: k.subtractor }),
      ...(k.scaling && { scaling: k.scaling }),
    };
    const nameValidators = this.isRpc
      ? [Validators.required, Validators.pattern(/\S/), notReserved]
      : [Validators.required, Validators.pattern(/\S/)];
    const group = this.fb.group({
      id: [{ value: id, disabled: true }],
      [this.isRpc ? 'method' : 'key']: [(this.isRpc ? k.method : k.key) || '', nameValidators],
      operation: [k.operation === 'read' ? 'read' : 'write'],
      slot: [k.slot ?? 1, [Validators.required, Validators.min(0), Validators.max(0x7FFF)]],
      subslot: [Number(k.subslot ?? 1), [Validators.required, Validators.min(1), Validators.max(0xFFFF)]],
      offset: [k.offset ?? 0, [Validators.required, Validators.min(0)]],
      type: [k.type || ProfinetValueType.UINT8, [Validators.required]],
      bit: [k.bit ?? null, [Validators.min(0), Validators.max(7)]],
      length: [k.length ?? null, [Validators.min(1)]],
      area: [k.area === ProfinetArea.OUTPUT ? ProfinetArea.OUTPUT : ProfinetArea.INPUT],
      quality: [k.quality || ProfinetQualityMode.NONE],
      goodOnly: [!!k.goodOnly],
      calibration: [calibration],
      reportStrategy: [k.reportStrategy || null],
    }, { validators: [(row: AbstractControl) => this.placeValid(row)] });
    return group;
  }

  /** The persisted shape: only what applies to the row, defaults left out. */
  private getFormValue(): ProfinetAnyKey[] {
    return this.keysFormArray.getRawValue().map((row: any) => {
      const out: any = this.isRpc ? { method: row.method.trim() } : { key: row.key.trim() };
      out.slot = Number(row.slot);
      if (Number(row.subslot) !== 1) {
        out.subslot = Number(row.subslot);
      }
      out.offset = Number(row.offset || 0);
      out.type = row.type;
      if (row.type === ProfinetValueType.BOOL && row.bit !== null && row.bit !== '' && row.bit !== undefined) {
        out.bit = Number(row.bit);
      }
      if ((row.type === ProfinetValueType.STRING || row.type === ProfinetValueType.BYTES) && row.length) {
        out.length = Number(row.length);
      }
      if (this.isRpc) {
        if (row.operation === 'read') {
          out.operation = 'read';
          if (row.area === ProfinetArea.OUTPUT) out.area = ProfinetArea.OUTPUT;
        }
        return out;
      }
      if (this.isUpdate) {
        return out;
      }
      if (row.area === ProfinetArea.OUTPUT) out.area = ProfinetArea.OUTPUT;
      if (row.quality && row.quality !== ProfinetQualityMode.NONE) out.quality = row.quality;
      if (row.goodOnly) out.goodOnly = true;
      if (row.calibration && PROFINET_NUMERIC_TYPES.has(row.type)) Object.assign(out, row.calibration);
      if (row.reportStrategy) out.reportStrategy = row.reportStrategy;
      return out;
    });
  }
}
