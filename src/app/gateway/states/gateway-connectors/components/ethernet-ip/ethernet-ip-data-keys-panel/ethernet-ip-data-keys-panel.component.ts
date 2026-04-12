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

import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, inject, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
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
import { ReportStrategyDefaultValue, ReportStrategyType, ReportStrategyTypeTranslationsMap } from '../../../../../shared/public-api';
import { ReportStrategyComponent } from '../../../../../shared/components/public-api';
import { SpreadsheetKeysComponent } from '../../../../../shared/components/spreadsheet-keys/spreadsheet-keys.component';
import { SpreadsheetColumnConfig, SelectOption } from '../../../../../shared/components/spreadsheet-keys/spreadsheet-keys.models';
import { EthernetIPDataKey, EthernetIPRpcConfig, EthernetIPDataType, EthernetIPValueKey } from '../../../models/public-api';
import { generateSecret } from '@core/public-api';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'tb-ethernet-ip-data-keys-panel',
  templateUrl: './ethernet-ip-data-keys-panel.component.html',
  styleUrls: ['./ethernet-ip-data-keys-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule, ReactiveFormsModule, ReportStrategyComponent, SpreadsheetKeysComponent],
})
export class EthernetIPDataKeysPanelComponent implements OnInit, OnDestroy {

  @Input() panelTitle = 'Data Keys';
  @Input() addKeyTitle = 'Add key';
  @Input() deleteKeyTitle = 'Delete key';
  @Input() noKeysText = 'No data keys configured';
  @Input() keys: Array<EthernetIPDataKey | EthernetIPRpcConfig> = [];
  @Input() keysType: EthernetIPValueKey = EthernetIPValueKey.TIMESERIES;
  @Input() isSLC = false;

  @Output() keysDataApplied = new EventEmitter<Array<EthernetIPDataKey | EthernetIPRpcConfig>>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild(SpreadsheetKeysComponent) spreadsheetKeys: SpreadsheetKeysComponent;

  readonly dataTypes = Object.values(EthernetIPDataType);
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly EthernetIPValueKey = EthernetIPValueKey;

  enableScalingControlMap = new Map<string, FormControl<boolean>>();
  keysFormArray: FormArray;

  searchControl = new FormControl('');
  filteredControls: { control: FormGroup; index: number }[] = [];
  displayedControls: { control: FormGroup; index: number }[] = [];
  renderLimit = 50;

  isFullscreen = false;
  spreadsheetColumns: SpreadsheetColumnConfig[] = [];
  searchFields: string[] = [];
  lastAddedId: string | null = null;

  sortField: string | null = null;
  sortDirection: 'asc' | 'desc' = 'asc';
  readonly sortFields = [
    { value: 'tag', label: 'Key' },
    { value: 'plcTag', label: 'PLC Tag' },
  ];

  private destroy$ = new Subject<void>();
  private fb = new FormBuilder();
  private cd = inject(ChangeDetectorRef);
  private elementRef = inject(ElementRef) as ElementRef<HTMLElement>;

  get isRpc(): boolean {
    return this.keysType === EthernetIPValueKey.RPC;
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
      this.keys.forEach(key => {
        const form = this.createKeyForm(key);
        if (!this.isRpc) {
          this.observeEnableScaling(form);
        }
        this.keysFormArray.push(form);
      });
    }
    this.updateFilteredControls();
    this.searchControl.valueChanges.pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.renderLimit = 50;
      this.updateFilteredControls();
    });
    this.buildColumnConfigs();
  }

  ngOnDestroy(): void {
    if (this.isFullscreen) {
      this.removeFullscreenClass();
    }
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

  private addFullscreenClass(): void {
    const pane = this.elementRef.nativeElement.closest('.cdk-overlay-pane') as HTMLElement | null;
    pane?.classList.add('spreadsheet-fullscreen-pane');
  }

  private removeFullscreenClass(): void {
    const pane = this.elementRef.nativeElement.closest('.cdk-overlay-pane') as HTMLElement | null;
    pane?.classList.remove('spreadsheet-fullscreen-pane');
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
          const plcTag = (item.control.get('plcTag')?.value?.toString() || '');
          return tag.includes(search) || plcTag.toLowerCase().includes(search);
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

  private buildColumnConfigs(): void {
    if (this.isRpc) {
      this.searchFields = ['method', 'plcTag'];
      this.spreadsheetColumns = [
        { key: 'method', label: 'Method', type: 'input', sortable: true, width: 'minmax(140px, 1.2fr)', placeholder: 'readTemperature' },
        { key: 'operation', label: 'Operation', type: 'select', sortable: true, width: 'minmax(100px, 0.8fr)',
          options: [{ value: 'read', label: 'Read' }, { value: 'write', label: 'Write' }] },
        { key: 'plcTag', label: 'PLC Tag', type: 'input', sortable: true, width: 'minmax(140px, 1.2fr)',
          placeholder: this.isSLC ? 'N7:0' : 'MotorSpeed' },
        { key: 'valueType', label: 'Value Type', type: 'select', sortable: true, width: 'minmax(120px, 1fr)',
          options: [{ value: null, label: 'Auto' }, ...this.dataTypes.map(t => ({ value: t, label: t }))] },
      ];
    } else {
      this.searchFields = ['tag', 'plcTag'];
      const reportStrategyTypes = Object.values(ReportStrategyType);
      const reportStrategyOptions: SelectOption[] = reportStrategyTypes.map(t => ({
        value: t, label: ReportStrategyTypeTranslationsMap.get(t) || t
      }));
      this.spreadsheetColumns = [
        { key: 'tag', label: 'Key', type: 'input', sortable: true, width: 'minmax(120px, 1.2fr)', placeholder: 'temperature' },
        { key: 'plcTag', label: 'PLC Tag', type: 'input', sortable: true, width: 'minmax(140px, 1.2fr)',
          placeholder: this.isSLC ? 'N7:0' : 'Program:MainProgram.Temperature' },
        { key: '_scalingEnabled', label: 'Scale', type: 'checkbox', width: '44px', headerClass: 'center',
          externalControl: (row) => this.enableScalingControlMap.get(row.getRawValue().id) },
        { key: 'rawMin', label: 'Raw Min', type: 'number', width: 'minmax(80px, 0.7fr)', placeholder: '0' },
        { key: 'rawMax', label: 'Raw Max', type: 'number', width: 'minmax(80px, 0.7fr)', placeholder: '65535' },
        { key: 'engMin', label: 'Eng Min', type: 'number', width: 'minmax(80px, 0.7fr)', placeholder: '0' },
        { key: 'engMax', label: 'Eng Max', type: 'number', width: 'minmax(80px, 0.7fr)', placeholder: '100' },
        { key: '_stratEnabled', label: 'Strat.', type: 'checkbox', width: '44px', headerClass: 'center',
          getValue: (row) => !!row.get('reportStrategy')?.value,
          setValue: (row, v) => {
            const ctrl = row.get('reportStrategy');
            if (!ctrl) return;
            ctrl.setValue(v ? { type: ReportStrategyType.OnReportPeriod, reportPeriod: ReportStrategyDefaultValue.Key } : null);
            row.markAsDirty();
            this.cd.markForCheck();
          }
        },
        { key: '_stratType', label: 'Strat. Type', type: 'select', width: 'minmax(140px, 1fr)', translateLabels: true,
          options: reportStrategyOptions,
          getValue: (row) => row.get('reportStrategy')?.value?.type ?? null,
          setValue: (row, v) => {
            const ctrl = row.get('reportStrategy');
            if (!ctrl) return;
            const cur = ctrl.value ?? {};
            ctrl.setValue({ ...cur, type: v });
            row.markAsDirty();
            this.cd.markForCheck();
          },
          cellDisabled: (row) => !row.get('reportStrategy')?.value
        },
        { key: '_stratPeriod', label: 'Period (ms)', type: 'number', width: 'minmax(90px, 0.7fr)', placeholder: 'ms',
          getValue: (row) => row.get('reportStrategy')?.value?.reportPeriod ?? null,
          setValue: (row, v) => {
            const ctrl = row.get('reportStrategy');
            if (!ctrl) return;
            const cur = ctrl.value ?? {};
            const parsed = typeof v === 'number' ? v : parseInt(v, 10);
            ctrl.setValue({ ...cur, reportPeriod: isNaN(parsed) ? null : parsed });
            row.markAsDirty();
            this.cd.markForCheck();
          },
          cellDisabled: (row) => {
            const rs = row.get('reportStrategy')?.value;
            if (!rs) return true;
            return rs.type === ReportStrategyType.OnChange || rs.type === ReportStrategyType.OnReceived;
          }
        },
      ];
    }
  }

  onFullscreenToggled(fullscreen: boolean): void {
    this.isFullscreen = fullscreen;
    if (!fullscreen) {
      this.removeFullscreenClass();
      this.updateFilteredControls();
    }
    this.cd.markForCheck();
  }

  onAddRowRequested(): void {
    if (this.isRpc) {
      const form = this.createKeyForm({
        method: '', plcTag: '', valueType: null, operation: 'read',
      } as EthernetIPRpcConfig);
      this.keysFormArray.push(form);
    } else {
      const form = this.createKeyForm({
        tag: '', plcTag: '',
      } as EthernetIPDataKey);
      this.observeEnableScaling(form);
      this.keysFormArray.push(form);
    }
    this.keysFormArray.markAsDirty();
    this.searchControl.setValue('', { emitEvent: false });
    this.updateFilteredControls();
    this.spreadsheetKeys?.refreshDisplay();
    this.spreadsheetKeys?.focusLastRow();
  }

  onDeleteRowsRequested(rows: FormGroup[]): void {
    const indicesToDelete: number[] = [];
    this.keysFormArray.controls.forEach((c, i) => {
      if (rows.includes(c as FormGroup)) {
        indicesToDelete.push(i);
      }
    });
    for (let i = indicesToDelete.length - 1; i >= 0; i--) {
      this.keysFormArray.removeAt(indicesToDelete[i]);
    }
    this.keysFormArray.markAsDirty();
    this.spreadsheetKeys?.refreshDisplay();
    this.updateFilteredControls();
  }

  addKey(): void {
    if (this.isRpc) {
      const form = this.createKeyForm({
        method: '',
        plcTag: '',
        valueType: null,
        operation: 'read',
      } as EthernetIPRpcConfig);
      this.keysFormArray.push(form);
    } else {
      const form = this.createKeyForm({
        tag: '',
        plcTag: '',
      } as EthernetIPDataKey);
      this.observeEnableScaling(form);
      this.lastAddedId = form.getRawValue().id;
      this.keysFormArray.push(form);
    }
    this.keysFormArray.markAsDirty();
    this.searchControl.setValue('', { emitEvent: false });
    this.updateFilteredControls();
    this.spreadsheetKeys?.refreshDisplay();
  }

  deleteKey(index: number): void {
    this.keysFormArray.removeAt(index);
    this.keysFormArray.markAsDirty();
    this.updateFilteredControls();
    this.spreadsheetKeys?.refreshDisplay();
  }

  cancel(): void {
    this.cancelled.emit();
  }

  applyKeysData(): void {
    if (this.keysFormArray.valid) {
      this.keysDataApplied.emit(this.getFormValue());
    }
  }

  getKeyLabel(keyForm: FormGroup): string {
    if (this.isRpc) {
      const method = keyForm.get('method')?.value;
      const op = keyForm.get('operation')?.value;
      return method ? `${method} (${op})` : 'New RPC';
    }
    return keyForm.get('tag')?.value || 'New Key';
  }

  private getFormValue(): Array<EthernetIPDataKey | EthernetIPRpcConfig> {
    return this.keysFormArray.value.map((key: any, i: number) => {
      if (this.isRpc) {
        const result: any = { method: key.method, plcTag: key.plcTag, operation: key.operation };
        if (key.valueType) { result.valueType = key.valueType; }
        return result;
      }
      const keyId = (this.keysFormArray.controls[i] as FormGroup).get('id')?.value;
      const result: any = { tag: key.tag, plcTag: key.plcTag };
      if (this.enableScalingControlMap.get(keyId)?.value) {
        result.scaling = {
          rawMin: key.rawMin,
          rawMax: key.rawMax,
          engMin: key.engMin,
          engMax: key.engMax,
        };
      }
      if (key.reportStrategy) {
        result.reportStrategy = key.reportStrategy;
      }
      return result;
    });
  }

  private createKeyForm(key: EthernetIPDataKey | EthernetIPRpcConfig): FormGroup {
    if (this.isRpc) {
      const rpc = key as EthernetIPRpcConfig;
      return this.fb.group({
        method: [rpc.method || '', [Validators.required]],
        plcTag: [rpc.plcTag || '', [Validators.required]],
        valueType: [rpc.valueType || null],
        operation: [rpc.operation || 'read', [Validators.required]],
      });
    }
    const dataKey = key as EthernetIPDataKey;
    const id = generateSecret(5);
    const hasScaling = !!dataKey.scaling;
    this.enableScalingControlMap.set(id, this.fb.control(hasScaling));

    return this.fb.group({
      id: [{ value: id, disabled: true }],
      tag: [dataKey.tag || '', [Validators.required]],
      plcTag: [dataKey.plcTag || '', [Validators.required]],
      rawMin: [{ value: dataKey.scaling?.rawMin ?? 0, disabled: !hasScaling }],
      rawMax: [{ value: dataKey.scaling?.rawMax ?? 65535, disabled: !hasScaling }],
      engMin: [{ value: dataKey.scaling?.engMin ?? 0, disabled: !hasScaling }],
      engMax: [{ value: dataKey.scaling?.engMax ?? 100, disabled: !hasScaling }],
      reportStrategy: [dataKey.reportStrategy || null],
    });
  }

  private observeEnableScaling(keyFormGroup: FormGroup): void {
    const id = keyFormGroup.get('id')?.value ?? (keyFormGroup.getRawValue() as any).id;
    this.enableScalingControlMap.get(id)?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(enabled => {
        ['rawMin', 'rawMax', 'engMin', 'engMax'].forEach(field => {
          const ctrl = keyFormGroup.get(field);
          if (enabled) { ctrl?.enable(); } else { ctrl?.disable(); }
        });
      });
  }
}
