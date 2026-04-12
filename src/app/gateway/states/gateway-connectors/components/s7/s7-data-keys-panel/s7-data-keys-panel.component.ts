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
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import {
  nonZeroFloat,
  ReportStrategyDefaultValue,
  ReportStrategyType,
  ReportStrategyTypeTranslationsMap,
} from '../../../../../shared/public-api';
import { ReportStrategyComponent } from '../../../../../shared/components/public-api';
import { SpreadsheetKeysComponent } from '../../../../../shared/components/spreadsheet-keys/spreadsheet-keys.component';
import { SpreadsheetColumnConfig, SelectOption } from '../../../../../shared/components/spreadsheet-keys/spreadsheet-keys.models';
import { ModifierType, ModifierTypesMap } from '../../../models/public-api';
import { S7DataKey, S7RpcConfig, S7ValueKey, S7ValueType } from '../../../models/public-api';
import { generateSecret } from '@core/public-api';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

type SortDirection = 'asc' | 'desc';

interface SortFieldOption {
  value: string;
  label: string;
}

@Component({
  selector: 'tb-s7-data-keys-panel',
  templateUrl: './s7-data-keys-panel.component.html',
  styleUrls: ['./s7-data-keys-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule, ReactiveFormsModule, ReportStrategyComponent, SpreadsheetKeysComponent],
})
export class S7DataKeysPanelComponent implements OnInit, OnDestroy {

  @Input() panelTitle = 'Data Keys';
  @Input() addKeyTitle = 'Add key';
  @Input() deleteKeyTitle = 'Delete key';
  @Input() noKeysText = 'No data keys configured';
  @Input() keys: Array<S7DataKey | S7RpcConfig> = [];
  @Input() keysType: S7ValueKey = S7ValueKey.TIMESERIES;

  @Output() keysDataApplied = new EventEmitter<Array<S7DataKey | S7RpcConfig>>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild('panelRoot', { static: true }) panelRoot!: ElementRef<HTMLElement>;
  @ViewChild(SpreadsheetKeysComponent) spreadsheetKeys: SpreadsheetKeysComponent;

  private elementRef = inject(ElementRef) as ElementRef<HTMLElement>;

  readonly valueTypes = Object.values(S7ValueType);
  readonly modifierTypes: ModifierType[] = Object.values(ModifierType) as ModifierType[];
  readonly ModifierTypesMap = ModifierTypesMap;
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly ReportStrategyType = ReportStrategyType;
  readonly reportStrategyTypes = Object.values(ReportStrategyType);
  readonly ReportStrategyTypeTranslationsMap = ReportStrategyTypeTranslationsMap;
  readonly S7ValueKey = S7ValueKey;

  private readonly timeseriesSortFields: SortFieldOption[] = [
    { value: 'tag', label: 'Key' },
    { value: 'address', label: 'Address' },
    { value: 'valueType', label: 'Value Type' },
  ];
  private readonly rpcSortFields: SortFieldOption[] = [
    { value: 'method', label: 'Method' },
    { value: 'address', label: 'Address' },
    { value: 'valueType', label: 'Value Type' },
    { value: 'operation', label: 'Operation' },
  ];

  enableModifiersControlMap = new Map<string, FormControl<boolean>>();
  keysFormArray: FormArray;

  searchControl = new FormControl('');
  filteredControls: { control: FormGroup; index: number }[] = [];
  displayedControls: { control: FormGroup; index: number }[] = [];
  renderLimit = 50;
  lastAddedId: string | null = null;

  isFullscreen = false;
  sortField: string | null = null;
  sortDirection: SortDirection = 'asc';

  spreadsheetColumns: SpreadsheetColumnConfig[] = [];
  searchFields: string[] = [];

  private destroy$ = new Subject<void>();
  private fb = new FormBuilder();
  private cd = inject(ChangeDetectorRef);

  get sortFields(): SortFieldOption[] {
    return this.isRpc ? this.rpcSortFields : this.timeseriesSortFields;
  }

  get isRpc(): boolean {
    return this.keysType === S7ValueKey.RPC;
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
          this.observeEnableModifier(form);
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
          const address = (item.control.get('address')?.value?.toString() || '');
          return tag.includes(search) || address.toLowerCase().includes(search);
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
      this.searchFields = ['method', 'address'];
      this.spreadsheetColumns = [
        { key: 'method', label: 'Method', type: 'input', sortable: true, width: 'minmax(150px, 1.4fr)', placeholder: 'setValue' },
        { key: 'address', label: 'Address', type: 'input', sortable: true, width: 'minmax(150px, 1.4fr)', placeholder: 'DB1.DBD0', uppercase: true },
        { key: 'valueType', label: 'Value Type', type: 'select', sortable: true, width: 'minmax(120px, 1fr)',
          options: [{ value: '', label: 'Auto' }, ...this.valueTypes.map(t => ({ value: t, label: t }))] },
        { key: 'operation', label: 'Operation', type: 'select', sortable: true, width: 'minmax(120px, 1fr)',
          options: [{ value: 'read', label: 'Read' }, { value: 'write', label: 'Write' }] },
      ];
    } else {
      this.searchFields = ['tag', 'address'];
      const modifierTypeOptions: SelectOption[] = this.modifierTypes.map(t => ({
        value: t, label: ModifierTypesMap.get(t)?.name || t
      }));
      const reportStrategyOptions: SelectOption[] = this.reportStrategyTypes.map(t => ({
        value: t, label: ReportStrategyTypeTranslationsMap.get(t) || t
      }));
      this.spreadsheetColumns = [
        { key: 'tag', label: 'Key', type: 'input', sortable: true, width: 'minmax(120px, 1.2fr)', placeholder: 'temperature' },
        { key: 'address', label: 'Address', type: 'input', sortable: true, width: 'minmax(140px, 1.2fr)', placeholder: 'DB1.DBD0', uppercase: true },
        { key: 'valueType', label: 'Value Type', type: 'select', sortable: true, width: 'minmax(110px, 0.9fr)',
          options: [{ value: '', label: 'Auto' }, ...this.valueTypes.map(t => ({ value: t, label: t }))] },
        { key: '_modEnabled', label: 'Mod.', type: 'checkbox', width: '44px', headerClass: 'center',
          externalControl: (row) => this.enableModifiersControlMap.get(row.getRawValue().id) },
        { key: 'modifierType', label: 'Mod. Type', type: 'select', width: 'minmax(110px, 0.9fr)', options: modifierTypeOptions, translateLabels: true },
        { key: 'modifierValue', label: 'Mod. Value', type: 'number', width: 'minmax(80px, 0.7fr)', step: 0.1, placeholder: '1' },
        { key: '_stratEnabled', label: 'Strat.', type: 'checkbox', width: '44px', headerClass: 'center',
          getValue: (row) => this.isReportStrategyEnabled(row),
          setValue: (row, v) => this.setReportStrategyEnabled(row, v) },
        { key: '_stratType', label: 'Strat. Type', type: 'select', width: 'minmax(150px, 1fr)', translateLabels: true,
          options: reportStrategyOptions,
          getValue: (row) => this.getReportStrategyType(row),
          setValue: (row, v) => this.setReportStrategyType(row, v),
          cellDisabled: (row) => !this.isReportStrategyEnabled(row) },
        { key: '_stratPeriod', label: 'Period (ms)', type: 'number', width: 'minmax(90px, 0.7fr)', placeholder: 'ms',
          getValue: (row) => this.getReportStrategyPeriod(row),
          setValue: (row, v) => this.setReportStrategyPeriod(row, v),
          cellDisabled: (row) => !this.isReportStrategyPeriodInputEnabled(row) },
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
    this.addKeyAtBottom();
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
  }

  isReportStrategyEnabled(form: FormGroup): boolean {
    return !!form.get('reportStrategy')?.value;
  }

  setReportStrategyEnabled(form: FormGroup, enabled: boolean): void {
    const ctrl = form.get('reportStrategy');
    if (!ctrl) return;
    if (enabled) {
      ctrl.setValue({
        type: ReportStrategyType.OnReportPeriod,
        reportPeriod: ReportStrategyDefaultValue.Key,
      });
    } else {
      ctrl.setValue(null);
    }
    form.markAsDirty();
    this.cd.markForCheck();
  }

  getReportStrategyType(form: FormGroup): ReportStrategyType | null {
    return form.get('reportStrategy')?.value?.type ?? null;
  }

  setReportStrategyType(form: FormGroup, type: ReportStrategyType): void {
    const ctrl = form.get('reportStrategy');
    if (!ctrl) return;
    const cur = ctrl.value ?? {};
    ctrl.setValue({ ...cur, type });
    form.markAsDirty();
    this.cd.markForCheck();
  }

  getReportStrategyPeriod(form: FormGroup): number | null {
    return form.get('reportStrategy')?.value?.reportPeriod ?? null;
  }

  setReportStrategyPeriod(form: FormGroup, value: string | number): void {
    const ctrl = form.get('reportStrategy');
    if (!ctrl) return;
    const cur = ctrl.value ?? {};
    const parsed = typeof value === 'number' ? value : parseInt(value, 10);
    ctrl.setValue({ ...cur, reportPeriod: isNaN(parsed) ? null : parsed });
    form.markAsDirty();
    this.cd.markForCheck();
  }

  isReportStrategyPeriodInputEnabled(form: FormGroup): boolean {
    if (!this.isReportStrategyEnabled(form)) return false;
    const type = this.getReportStrategyType(form);
    return type !== ReportStrategyType.OnChange && type !== ReportStrategyType.OnReceived;
  }

  addKey(): void {
    this.addKeyAtBottom();
  }

  deleteKey(index: number): void {
    this.keysFormArray.removeAt(index);
    this.keysFormArray.markAsDirty();
    this.updateFilteredControls();
  }

  addKeyAtBottom(): void {
    let form: FormGroup;
    if (this.isRpc) {
      form = this.createKeyForm({
        method: '',
        address: '',
        valueType: null,
        operation: 'read',
      } as S7RpcConfig);
    } else {
      form = this.createKeyForm({
        tag: '',
        address: '',
        valueType: null,
      } as S7DataKey);
      this.observeEnableModifier(form);
      this.lastAddedId = form.getRawValue().id;
    }
    this.keysFormArray.push(form);
    this.keysFormArray.markAsDirty();
    this.searchControl.setValue('', { emitEvent: false });
    this.updateFilteredControls();
    this.spreadsheetKeys?.refreshDisplay();
    if (this.isFullscreen) {
      this.spreadsheetKeys?.focusLastRow();
    } else {
      this.focusBottomKey();
    }
  }

  private focusBottomKey(): void {
    const fieldName = this.isRpc ? 'method' : 'tag';
    let attempts = 0;
    const tryFocus = () => {
      const root = this.panelRoot?.nativeElement;
      const inputs = root?.querySelectorAll<HTMLInputElement>(`input[formControlName="${fieldName}"]`) ?? null;
      const input = inputs && inputs.length ? inputs[inputs.length - 1] : null;
      if (input) {
        let el: HTMLElement | null = input.parentElement;
        while (el && el !== document.body) {
          if (el.scrollHeight > el.clientHeight) {
            el.scrollTop = el.scrollHeight;
          }
          el = el.parentElement;
        }
        input.focus();
        input.select();
      } else if (attempts++ < 40) {
        setTimeout(tryFocus, 50);
      }
    };
    setTimeout(tryFocus);
  }

  cancel(): void {
    this.cancelled.emit();
  }

  applyKeysData(): void {
    if (this.keysFormArray.valid) {
      this.keysDataApplied.emit(this.getFormValue());
    }
  }

  onAddressInput(form: FormGroup): void {
    const ctrl = form.get('address');
    if (ctrl) {
      const val = ctrl.value;
      const upper = typeof val === 'string' ? val.toUpperCase() : val;
      if (val !== upper) {
        ctrl.setValue(upper, { emitEvent: false });
      }
    }
  }

  getKeyLabel(keyForm: FormGroup): string {
    if (this.isRpc) {
      const method = keyForm.get('method')?.value;
      const op = keyForm.get('operation')?.value;
      return method ? `${method} (${op})` : 'New RPC';
    }
    return keyForm.get('tag')?.value || 'New key';
  }

  private getFormValue(): Array<S7DataKey | S7RpcConfig> {
    return this.keysFormArray.value.map((key: any, i: number) => {
      if (this.isRpc) return key;
      const { id, modifierType, modifierValue, reportStrategy, ...rest } = key;
      const keyId = (this.keysFormArray.controls[i] as FormGroup).get('id')?.value;
      const result: any = { ...rest };
      if (!result.valueType) {
        delete result.valueType;
      }
      if (this.enableModifiersControlMap.get(keyId)?.value && modifierType) {
        result[modifierType] = modifierValue;
      }
      if (reportStrategy) {
        result.reportStrategy = reportStrategy;
      }
      return result;
    });
  }

  private createKeyForm(key: S7DataKey | S7RpcConfig): FormGroup {
    if (this.isRpc) {
      const rpc = key as S7RpcConfig;
      return this.fb.group({
        method: [rpc.method || '', [Validators.required]],
        address: [rpc.address || '', [Validators.required, Validators.pattern(/^(DB\d+\.DB[XBWDL]\d+(\.\d+)?|[MIQC]\d+\.\d+|[MIQC][BWDL]\d+|[CT]\d+)$/i)]],
        valueType: [rpc.valueType || ''],
        operation: [rpc.operation || 'read', [Validators.required]],
      });
    }
    const dataKey = key as S7DataKey;
    const id = generateSecret(5);
    const hasModifier = !!(dataKey.multiplier || dataKey.divider);
    this.enableModifiersControlMap.set(id, this.fb.control(hasModifier));

    return this.fb.group({
      id: [{ value: id, disabled: true }],
      tag: [dataKey.tag || '', [Validators.required]],
      address: [dataKey.address || '', [Validators.required, Validators.pattern(/^(DB\d+\.DB[XBWDL]\d+(\.\d+)?|[MIQC]\d+\.\d+|[MIQC][BWDL]\d+|[CT]\d+)$/i)]],
      valueType: [dataKey.valueType || ''],
      modifierType: [{ value: dataKey.divider ? ModifierType.DIVIDER : ModifierType.MULTIPLIER, disabled: !hasModifier }],
      modifierValue: [{ value: dataKey.multiplier ?? dataKey.divider ?? 1, disabled: !hasModifier }, [Validators.pattern(nonZeroFloat)]],
      reportStrategy: [dataKey.reportStrategy || null],
    });
  }

  private observeEnableModifier(keyFormGroup: FormGroup): void {
    const id = keyFormGroup.get('id')?.value ?? (keyFormGroup.getRawValue() as any).id;
    this.enableModifiersControlMap.get(id)?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(enabled => {
        const modifierType = keyFormGroup.get('modifierType');
        const modifierValue = keyFormGroup.get('modifierValue');
        if (enabled) {
          modifierType?.enable();
          modifierValue?.enable();
        } else {
          modifierType?.disable();
          modifierValue?.disable();
        }
      });
  }
}
