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
  ValidatorFn,
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
  SNMP_BULK_METHODS,
  SNMP_WRITE_METHODS,
  SnmpDataKey,
  SnmpKeyEntry,
  SnmpMethod,
  SnmpMethodTranslationsMap,
  SnmpNotification,
  SnmpNotificationTarget,
  SnmpNotificationTargetTranslationsMap,
  SnmpOidShape,
  SnmpPolledEntry,
  SnmpValueKey,
  SnmpValueType,
  SnmpValueTypeTranslationsMap,
  SnmpVersion,
  formatOidList,
  isValidOid,
  parseOidList,
  snmpOidShape,
} from '../../../models/public-api';
import { generateSecret } from '@core/public-api';

/**
 * SNMP keys panel. Thin wrapper on the shared IndustrialKeysPanel shell,
 * as the FINS / S7 / ADS panels are. What is SNMP-specific:
 *   - the method decides what a row addresses: one OID, a list of OIDs
 *     (typed comma-separated), scalar + repeating OIDs with a list size
 *     for bulkget, or OID → value mappings for multiset;
 *   - the four lists differ only in the platform-side name: a key for
 *     attributes and telemetry, an attribute filter for attribute
 *     updates, a request filter for RPC;
 *   - a GETBULK method on a v1 device is an error here, as it is when
 *     the gateway loads the configuration;
 *   - the notifications list has no method at all: a row names the trap
 *     it takes and the varbind it publishes, both optional.
 */

function toggleError(control: AbstractControl | null, name: string, on: boolean): void {
  if (!control) {
    return;
  }
  const errors = control.errors ?? {};
  const has = !!errors[name];
  if (on && !has) {
    control.setErrors({ ...errors, [name]: true });
  } else if (!on && has) {
    const { [name]: _dropped, ...rest } = errors;
    control.setErrors(Object.keys(rest).length ? rest : null);
  }
}

/** Cross-field validator for one row: what the method needs is there and well-formed. */
function snmpKeyRowValidator(version: SnmpVersion | string, polled: boolean): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const method = group.get('method')?.value as SnmpMethod;
    const shape = snmpOidShape(method);

    const bulkV1 = version === SnmpVersion.V1 && SNMP_BULK_METHODS.includes(method);
    toggleError(group.get('method'), 'bulkV1', bulkV1);

    const oids = parseOidList(group.get('oid')?.value);
    const oidNeeded = shape === 'single' || shape === 'list';
    const oidMissing = oidNeeded && oids.length === 0;
    const oidInvalid = oidNeeded && (oids.some(o => !isValidOid(o)) || (shape === 'single' && oids.length > 1));
    toggleError(group.get('oid'), 'oidRequired', oidMissing);
    toggleError(group.get('oid'), 'invalidOid', oidInvalid);

    const scalars = parseOidList(group.get('scalarOid')?.value);
    const repeaters = parseOidList(group.get('repeatingOid')?.value);
    const bulkMissing = shape === 'bulkget' && scalars.length === 0 && repeaters.length === 0;
    toggleError(group.get('scalarOid'), 'oidRequired', bulkMissing);
    toggleError(group.get('scalarOid'), 'invalidOid', shape === 'bulkget' && scalars.some(o => !isValidOid(o)));
    toggleError(group.get('repeatingOid'), 'invalidOid', shape === 'bulkget' && repeaters.some(o => !isValidOid(o)));

    const mappings = group.get('mappings') as FormArray | null;
    const mappingsMissing = shape === 'mappings' && polled && (mappings?.length ?? 0) === 0;
    const mappingsInvalid = shape === 'mappings' && !!mappings?.invalid;

    const errors: ValidationErrors = {
      ...(bulkV1 && { bulkV1: true }),
      ...(oidMissing && { oidRequired: true }),
      ...(oidInvalid && { invalidOid: true }),
      ...(bulkMissing && { oidRequired: true }),
      ...(mappingsMissing && { mappingsRequired: true }),
      ...(mappingsInvalid && { invalidMapping: true }),
    };
    return Object.keys(errors).length ? errors : null;
  };
}

function oidValidator(control: AbstractControl): ValidationErrors | null {
  return isValidOid(control.value) ? null : { invalidOid: true };
}

/** An OID that may be left empty. */
function optionalOidValidator(control: AbstractControl): ValidationErrors | null {
  const value = (control.value ?? '').toString().trim();
  return !value || isValidOid(value) ? null : { invalidOid: true };
}

function calibrationOf(entry: Partial<SnmpDataKey>): CalibrationConfig {
  return {
    ...(entry.multiplier !== undefined && { multiplier: entry.multiplier }),
    ...(entry.divider !== undefined && { divider: entry.divider }),
    ...(entry.adder !== undefined && { adder: entry.adder }),
    ...(entry.subtractor !== undefined && { subtractor: entry.subtractor }),
    ...(entry.scaling && { scaling: entry.scaling }),
  };
}

@Component({
  selector: 'tb-snmp-data-keys-panel',
  templateUrl: './snmp-data-keys-panel.component.html',
  styleUrls: ['./snmp-data-keys-panel.component.scss'],
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
export class SnmpDataKeysPanelComponent implements OnInit {

  @Input() panelTitle = 'gateway.gw-data-keys';
  @Input() addKeyTitle = 'gateway.gw-add-key';
  @Input() deleteKeyTitle = 'gateway.gw-delete-key';
  @Input() noKeysText = 'gateway.keys-no-data-configured';
  @Input() keys: SnmpKeyEntry[] = [];
  @Input() keysType: SnmpValueKey = SnmpValueKey.TELEMETRY;
  /** The device's SNMP version: decides whether GETBULK methods are allowed. */
  @Input() version: SnmpVersion | string = SnmpVersion.V2C;

  @Output() keysDataApplied = new EventEmitter<SnmpKeyEntry[]>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild(IndustrialKeysPanelComponent) shell!: IndustrialKeysPanelComponent;

  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly SnmpValueKey = SnmpValueKey;
  readonly SnmpMethodTranslationsMap = SnmpMethodTranslationsMap;
  readonly valueTypes = Object.values(SnmpValueType);
  readonly SnmpValueTypeTranslationsMap = SnmpValueTypeTranslationsMap;
  readonly notificationTargets = Object.values(SnmpNotificationTarget);
  readonly SnmpNotificationTargetTranslationsMap = SnmpNotificationTargetTranslationsMap;

  keysFormArray: FormArray;
  methods: SnmpMethod[] = [];
  spreadsheetColumns: SpreadsheetColumnConfig[] = [];
  searchFields: string[] = [];
  sortFields: IndustrialKeysSortFieldOption[] = [];

  private fb = new FormBuilder();

  /** Attributes and telemetry are polled; the other two lists act on request. */
  get isPolled(): boolean {
    return this.keysType === SnmpValueKey.ATTRIBUTES || this.keysType === SnmpValueKey.TELEMETRY;
  }

  get isRpc(): boolean {
    return this.keysType === SnmpValueKey.RPC;
  }

  get isAttributeUpdate(): boolean {
    return this.keysType === SnmpValueKey.ATTRIBUTES_UPDATES;
  }

  /** Traps and informs the device sends: no method, a trap filter and a varbind instead. */
  get isNotification(): boolean {
    return this.keysType === SnmpValueKey.NOTIFICATIONS;
  }

  /** The platform-side field of a row: key, attributeFilter or requestFilter. */
  get nameField(): string {
    if (this.isRpc) {
      return 'requestFilter';
    }
    return this.isAttributeUpdate ? 'attributeFilter' : 'key';
  }

  get nameLabel(): string {
    if (this.isRpc) {
      return 'gateway.snmp-request-filter';
    }
    return this.isAttributeUpdate ? 'gateway.attribute-filter' : 'gateway.gw-key';
  }

  shapeOf(row: FormGroup): SnmpOidShape {
    return snmpOidShape(row.get('method')?.value);
  }

  writes(row: FormGroup): boolean {
    return SNMP_WRITE_METHODS.includes(row.get('method')?.value);
  }

  mappingsOf(row: FormGroup): FormArray {
    return row.get('mappings') as FormArray;
  }

  /** What the row addresses, for the collapsed header. */
  targetOf(row: FormGroup): string {
    switch (this.shapeOf(row)) {
      case 'bulkget':
        return [row.get('scalarOid')?.value, row.get('repeatingOid')?.value].filter(v => !!v).join(' | ');
      case 'mappings':
        return `${this.mappingsOf(row).length} × OID → value`;
      default:
        return row.get('oid')?.value ?? '';
    }
  }

  ngOnInit(): void {
    this.methods = this.isAttributeUpdate ? [...SNMP_WRITE_METHODS] : Object.values(SnmpMethod);
    this.keysFormArray = this.fb.array([]);
    if (this.keys?.length) {
      this.keys.forEach(key => this.keysFormArray.push(this.createKeyForm(key)));
    }
    this.buildColumnConfigs();
  }

  onAddRequested(): void {
    const method = this.isPolled ? SnmpMethod.GET : SnmpMethod.SET;
    const form = this.isNotification
      ? this.createNotificationForm({ key: '', type: SnmpNotificationTarget.TELEMETRY })
      : this.createKeyForm({ [this.nameField]: '', method } as unknown as SnmpKeyEntry);
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

  addMapping(row: FormGroup): void {
    this.mappingsOf(row).push(this.createMappingForm('', ''));
    row.updateValueAndValidity();
    this.keysFormArray.markAsDirty();
  }

  removeMapping(row: FormGroup, index: number): void {
    this.mappingsOf(row).removeAt(index);
    row.updateValueAndValidity();
    this.keysFormArray.markAsDirty();
  }

  private buildColumnConfigs(): void {
    if (this.isNotification) {
      this.buildNotificationColumns();
      return;
    }
    const methodOptions = this.methods.map(m => ({ value: m, label: SnmpMethodTranslationsMap.get(m) }));
    const valueTypeOptions = [
      { value: '', label: 'gateway.snmp-value-type-default' },
      ...this.valueTypes.map(t => ({ value: t, label: SnmpValueTypeTranslationsMap.get(t) })),
    ];
    const isOidShape = (row: FormGroup) => ['single', 'list'].includes(this.shapeOf(row));
    const isBulkGet = (row: FormGroup) => this.shapeOf(row) === 'bulkget';

    this.searchFields = [this.nameField, 'oid'];
    this.sortFields = [
      { value: this.nameField, label: this.nameLabel },
      { value: 'method', label: 'gateway.method' },
      { value: 'oid', label: 'gateway.snmp-oid' },
    ];
    this.spreadsheetColumns = [
      { key: this.nameField, label: this.nameLabel, type: 'input', sortable: true, width: 'minmax(130px, 1.2fr)',
        placeholder: this.isPolled ? 'sysUpTime' : (this.isRpc ? 'setValue' : 'sysContact') },
      { key: 'method', label: 'gateway.method', type: 'select', sortable: true, width: 'minmax(120px, 1fr)', translateLabels: true,
        errorText: 'gateway.snmp-bulk-v1', options: methodOptions },
      { key: 'oid', label: 'gateway.snmp-oid', type: 'input', sortable: true, width: 'minmax(190px, 1.6fr)',
        placeholder: '1.3.6.1.2.1.1.1.0', errorText: 'gateway.snmp-invalid-oid', cellVisible: isOidShape },
      { key: 'scalarOid', label: 'gateway.snmp-scalar-oids', type: 'input', width: 'minmax(160px, 1.4fr)',
        placeholder: '1.3.6.1.2.1.1.3.0', errorText: 'gateway.snmp-invalid-oid', cellVisible: isBulkGet },
      { key: 'repeatingOid', label: 'gateway.snmp-repeating-oids', type: 'input', width: 'minmax(160px, 1.4fr)',
        placeholder: '1.3.6.1.2.1.2.2.1.10', errorText: 'gateway.snmp-invalid-oid', cellVisible: isBulkGet },
      { key: 'maxListSize', label: 'gateway.snmp-max-list-size', type: 'number', width: 'minmax(90px, 0.7fr)', cellVisible: isBulkGet },
      { key: 'valueType', label: 'gateway.gw-value-type', type: 'select', width: 'minmax(140px, 1fr)', translateLabels: true,
        options: valueTypeOptions, cellVisible: (row) => this.writes(row) },
      { key: 'community', label: 'gateway.snmp-community', type: 'input', width: 'minmax(110px, 0.9fr)' },
      { key: 'timeout', label: 'gateway.snmp-timeout-s', type: 'number', width: 'minmax(90px, 0.7fr)' },
      ...(this.isPolled ? [...calibrationColumns(() => true), ...reportStrategyColumns()] : []),
    ];
  }

  private buildNotificationColumns(): void {
    const targetOptions = this.notificationTargets
      .map(t => ({ value: t, label: SnmpNotificationTargetTranslationsMap.get(t) }));
    this.searchFields = ['key', 'trapOid', 'oid'];
    this.sortFields = [
      { value: 'key', label: 'gateway.gw-key' },
      { value: 'trapOid', label: 'gateway.snmp-trap-oid' },
      { value: 'oid', label: 'gateway.snmp-oid' },
    ];
    this.spreadsheetColumns = [
      { key: 'key', label: 'gateway.gw-key', type: 'input', sortable: true, width: 'minmax(130px, 1.2fr)',
        placeholder: 'linkDown' },
      { key: 'trapOid', label: 'gateway.snmp-trap-oid', type: 'input', sortable: true, width: 'minmax(190px, 1.6fr)',
        placeholder: '1.3.6.1.6.3.1.1.5.3', errorText: 'gateway.snmp-invalid-oid' },
      { key: 'oid', label: 'gateway.snmp-oid', type: 'input', sortable: true, width: 'minmax(190px, 1.6fr)',
        placeholder: '1.3.6.1.2.1.2.2.1.8', errorText: 'gateway.snmp-invalid-oid' },
      { key: 'type', label: 'gateway.snmp-notification-type', type: 'select', width: 'minmax(130px, 1fr)',
        translateLabels: true, options: targetOptions },
      ...calibrationColumns(() => true),
      ...reportStrategyColumns(),
    ];
  }

  private createNotificationForm(entry: SnmpNotification): FormGroup {
    return this.fb.group({
      id: [{ value: generateSecret(5), disabled: true }],
      key: [entry.key || '', [Validators.required]],
      trapOid: [entry.trapOid ?? '', [optionalOidValidator]],
      oid: [entry.oid ?? '', [optionalOidValidator]],
      type: [entry.type || SnmpNotificationTarget.TELEMETRY],
      calibration: [calibrationOf(entry)],
      reportStrategy: [entry.reportStrategy || null],
    });
  }

  private createMappingForm(oid: string, value: string): FormGroup {
    return this.fb.group({
      oid: [oid, [Validators.required, oidValidator]],
      value: [value ?? ''],
    });
  }

  private createKeyForm(anyEntry: SnmpKeyEntry): FormGroup {
    if (this.isNotification) {
      return this.createNotificationForm(anyEntry as SnmpNotification);
    }
    const entry = anyEntry as SnmpPolledEntry;
    const id = generateSecret(5);
    const mappings = this.fb.array(
      Object.entries(entry.mappings ?? {}).map(([oid, value]) => this.createMappingForm(oid, String(value ?? '')))
    );
    const controls: Record<string, any> = {
      id: [{ value: id, disabled: true }],
      [this.nameField]: [(entry as any)[this.nameField] || '', [Validators.required]],
      method: [entry.method || (this.isPolled ? SnmpMethod.GET : SnmpMethod.SET), [Validators.required]],
      oid: [formatOidList(entry.oid)],
      scalarOid: [formatOidList(entry.scalarOid)],
      repeatingOid: [formatOidList(entry.repeatingOid)],
      maxListSize: [entry.maxListSize ?? 10, [Validators.min(1)]],
      mappings,
      valueType: [entry.valueType || ''],
      community: [entry.community || ''],
      timeout: [entry.timeout ?? null, [Validators.min(0.1)]],
    };
    if (this.isPolled) {
      const dataKey = entry as SnmpDataKey;
      controls.calibration = [calibrationOf(dataKey)];
      controls.reportStrategy = [dataKey.reportStrategy || null];
    }
    return this.fb.group(controls, { validators: snmpKeyRowValidator(this.version, this.isPolled) });
  }

  private getFormValue(): SnmpKeyEntry[] {
    if (this.isNotification) {
      return this.keysFormArray.getRawValue().map((row: any) => {
        const out: SnmpNotification = { key: row.key, type: row.type || SnmpNotificationTarget.TELEMETRY };
        const trapOid = (row.trapOid ?? '').toString().trim();
        const oid = (row.oid ?? '').toString().trim();
        if (trapOid) out.trapOid = trapOid;
        if (oid) out.oid = oid;
        if (row.calibration) Object.assign(out, row.calibration);
        if (row.reportStrategy) out.reportStrategy = row.reportStrategy;
        return out;
      });
    }
    return this.keysFormArray.getRawValue().map((row: any) => {
      const out: any = {
        [this.nameField]: row[this.nameField],
        method: row.method,
      };
      switch (snmpOidShape(row.method)) {
        case 'single':
          out.oid = parseOidList(row.oid)[0];
          break;
        case 'list':
          out.oid = parseOidList(row.oid);
          break;
        case 'bulkget': {
          const scalars = parseOidList(row.scalarOid);
          const repeaters = parseOidList(row.repeatingOid);
          if (scalars.length) out.scalarOid = scalars;
          if (repeaters.length) out.repeatingOid = repeaters;
          out.maxListSize = Number(row.maxListSize) || 10;
          break;
        }
        case 'mappings':
          if (row.mappings?.length) {
            out.mappings = Object.fromEntries(row.mappings.map((m: any) => [m.oid.trim(), m.value]));
          }
          break;
      }
      if (SNMP_WRITE_METHODS.includes(row.method) && row.valueType) out.valueType = row.valueType;
      if (row.community) out.community = row.community;
      if (row.timeout !== null && row.timeout !== undefined && row.timeout !== '') out.timeout = Number(row.timeout);
      if (this.isPolled) {
        if (row.calibration) Object.assign(out, row.calibration);
        if (row.reportStrategy) out.reportStrategy = row.reportStrategy;
      }
      return out as SnmpKeyEntry;
    });
  }
}
