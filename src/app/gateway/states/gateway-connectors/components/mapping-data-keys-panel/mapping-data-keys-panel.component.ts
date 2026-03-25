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
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output
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
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TypeValuePanelComponent } from '../type-value-panel/type-value-panel.component';
import { ConnectorMappingHelpLinkPipe } from '../../pipes/public-api';

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

  keysListFormArray: FormArray;

  searchControl = new FormControl('');
  filteredControls: { control: UntypedFormGroup; index: number }[] = [];
  displayedControls: { control: UntypedFormGroup; index: number }[] = [];
  renderLimit = 50;
  lastAddedControl: AbstractControl | null = null;

  errorText = '';

  private destroy$ = new Subject<void>();

  constructor(private fb: FormBuilder,
              private popover: TbPopoverComponent<MappingDataKeysPanelComponent>,
              protected store: Store<AppState>) {
    super(store);
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
        arguments: [[], []]
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
    let keys = this.keysListFormArray.value.map(({ reportStrategy, ...key }) => ({
      ...key,
      ...reportStrategy && { reportStrategy },
    }));
    if (this.keysType === MappingKeysType.CUSTOM) {
      keys = {};
      for (let key of this.keysListFormArray.value) {
        keys[key.key] = key.value;
      }
    }
    this.keysDataApplied.emit(keys);
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
            arguments: [[...(keyData as RpcMethodsMapping).arguments], []]
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
