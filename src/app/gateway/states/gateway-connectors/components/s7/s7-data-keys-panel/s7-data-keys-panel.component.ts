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
  imports: [CommonModule, SharedModule, ReactiveFormsModule, ReportStrategyComponent],
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

  private elementRef = inject(ElementRef) as ElementRef<HTMLElement>;
  private static globalStylesInjected = false;

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

  selectedRowControls = new Set<FormGroup>();
  private lastSelectedRowControl: FormGroup | null = null;

  private destroy$ = new Subject<void>();
  private fb = new FormBuilder();
  private cd = inject(ChangeDetectorRef);

  get sortFields(): SortFieldOption[] {
    return this.isRpc ? this.rpcSortFields : this.timeseriesSortFields;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isFullscreen) {
      this.toggleFullscreen();
    }
  }

  @HostListener('document:keydown.delete', ['$event'])
  onDeleteKey(event: KeyboardEvent): void {
    if (!this.isFullscreen || this.selectedRowControls.size === 0) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    event.preventDefault();
    this.deleteSelectedRows();
  }

  get isRpc(): boolean {
    return this.keysType === S7ValueKey.RPC;
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
    this.injectGlobalStyles();
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
    }
    this.cd.markForCheck();
  }

  private addFullscreenClass(): void {
    const pane = this.elementRef.nativeElement.closest('.cdk-overlay-pane') as HTMLElement | null;
    pane?.classList.add('s7-fullscreen-pane');
  }

  private removeFullscreenClass(): void {
    const pane = this.elementRef.nativeElement.closest('.cdk-overlay-pane') as HTMLElement | null;
    pane?.classList.remove('s7-fullscreen-pane');
  }

  private injectGlobalStyles(): void {
    if (typeof document === 'undefined') return;
    const STYLE_ID = 's7-data-keys-panel-globals-v4';
    // Always remove any existing version (including current) so updated rules take effect.
    document.querySelectorAll('style[id^="s7-data-keys-panel-globals"]').forEach(el => el.remove());
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
/* Sort menu panel theming (rendered in cdk-overlay-container, outside component scope) */
.s7-sort-menu-panel.mat-mdc-menu-panel {
  background: var(--tb-surface-card) !important;
}
.s7-sort-menu-panel .mat-mdc-menu-item {
  color: var(--tb-text-primary) !important;
}
.s7-sort-menu-panel .mat-mdc-menu-item .mdc-list-item__primary-text {
  color: var(--tb-text-primary) !important;
}
.s7-sort-menu-panel .mat-mdc-menu-item:hover:not([disabled]),
.s7-sort-menu-panel .mat-mdc-menu-item.cdk-program-focused:not([disabled]),
.s7-sort-menu-panel .mat-mdc-menu-item.cdk-keyboard-focused:not([disabled]),
.s7-sort-menu-panel .mat-mdc-menu-item-highlighted:not([disabled]) {
  background: color-mix(in srgb, var(--tb-primary, #26a69a) 22%, transparent) !important;
}
.s7-sort-menu-panel .mat-mdc-menu-item .mat-mdc-focus-indicator::before {
  background: transparent !important;
}
.s7-sort-menu-panel .mat-mdc-menu-item .mat-icon {
  color: var(--tb-text-secondary) !important;
}
/* Fullscreen overlay pane — overrides CDK position strategy via !important */
.cdk-overlay-pane.s7-fullscreen-pane {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
  transform: none !important;
  margin: 0 !important;
  padding: 0 !important;
}
.cdk-overlay-pane.s7-fullscreen-pane > div,
.cdk-overlay-pane.s7-fullscreen-pane .tb-popover,
.cdk-overlay-pane.s7-fullscreen-pane .tb-popover-content,
.cdk-overlay-pane.s7-fullscreen-pane .tb-popover-inner,
.cdk-overlay-pane.s7-fullscreen-pane .tb-popover-inner-content {
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
  padding: 0 !important;
  margin: 0 !important;
  box-sizing: border-box !important;
}
.cdk-overlay-pane.s7-fullscreen-pane .tb-popover-arrow {
  display: none !important;
}
.cdk-overlay-pane.s7-fullscreen-pane tb-s7-data-keys-panel {
  display: block !important;
  width: 100% !important;
  height: 100% !important;
}
/* Apply dark color-scheme so native form controls (inputs, selects, checkboxes) and their dropdown popups render dark */
body.tb-dark tb-s7-data-keys-panel,
body.tb-dark .cdk-overlay-pane.s7-fullscreen-pane,
body.tb-dark tb-s7-data-keys-panel .cell-input,
body.tb-dark tb-s7-data-keys-panel .cell-select,
body.tb-dark tb-s7-data-keys-panel .cell-checkbox,
body.tb-dark tb-s7-data-keys-panel input[type="checkbox"],
body.tb-dark tb-s7-data-keys-panel input[type="number"] {
  color-scheme: dark;
}
`;
    document.head.appendChild(style);
    S7DataKeysPanelComponent.globalStylesInjected = true;
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
    this.focusBottomKey();
  }

  private focusBottomKey(): void {
    const fieldName = this.isRpc ? 'method' : 'tag';
    let attempts = 0;
    const tryFocus = () => {
      const root = this.panelRoot?.nativeElement;
      // Spreadsheet view first; fall back to card view input.
      let inputs: NodeListOf<HTMLInputElement> | null =
        (root?.querySelectorAll<HTMLInputElement>(`.spreadsheet-row .cell-input[name="${fieldName}"]`)) ?? null;
      if (!inputs || inputs.length === 0) {
        inputs = root?.querySelectorAll<HTMLInputElement>(`input[formControlName="${fieldName}"]`) ?? null;
      }
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

  toggleSelectAll(): void {
    const allSelected = this.displayedControls.length > 0 &&
      this.displayedControls.every(d => this.selectedRowControls.has(d.control));
    if (allSelected) {
      this.selectedRowControls.clear();
    } else {
      this.selectedRowControls.clear();
      this.displayedControls.forEach(d => this.selectedRowControls.add(d.control));
    }
    this.lastSelectedRowControl = null;
    this.cd.markForCheck();
  }

  selectRow(form: FormGroup, event: MouseEvent): void {
    event.stopPropagation();
    if (event.shiftKey && this.lastSelectedRowControl) {
      const ids = this.displayedControls.map(d => d.control);
      const startIdx = ids.indexOf(this.lastSelectedRowControl);
      const endIdx = ids.indexOf(form);
      if (startIdx >= 0 && endIdx >= 0) {
        const [from, to] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        for (let i = from; i <= to; i++) {
          this.selectedRowControls.add(ids[i]);
        }
      }
    } else if (event.ctrlKey || event.metaKey) {
      if (this.selectedRowControls.has(form)) {
        this.selectedRowControls.delete(form);
      } else {
        this.selectedRowControls.add(form);
      }
      this.lastSelectedRowControl = form;
    } else {
      this.selectedRowControls.clear();
      this.selectedRowControls.add(form);
      this.lastSelectedRowControl = form;
    }
    this.cd.markForCheck();
  }

  isRowSelected(form: FormGroup): boolean {
    return this.selectedRowControls.has(form);
  }

  deleteSelectedRows(): void {
    if (this.selectedRowControls.size === 0) return;
    const indicesToDelete: number[] = [];
    this.keysFormArray.controls.forEach((c, i) => {
      if (this.selectedRowControls.has(c as FormGroup)) {
        indicesToDelete.push(i);
      }
    });
    for (let i = indicesToDelete.length - 1; i >= 0; i--) {
      this.keysFormArray.removeAt(indicesToDelete[i]);
    }
    this.keysFormArray.markAsDirty();
    this.selectedRowControls.clear();
    this.lastSelectedRowControl = null;
    this.updateFilteredControls();
  }

  onCellKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      this.addKeyAtBottom();
      return;
    }
    this.moveToCellBelow(event.target as HTMLElement);
  }

  private moveToCellBelow(currentEl: HTMLElement): void {
    const currentCell = currentEl.closest('.cell') as HTMLElement | null;
    const currentRow = currentEl.closest('.spreadsheet-row') as HTMLElement | null;
    if (!currentCell || !currentRow) return;
    const cellIdx = Array.from(currentRow.children).indexOf(currentCell);
    let nextRow = currentRow.nextElementSibling as HTMLElement | null;
    while (nextRow && !nextRow.classList.contains('spreadsheet-row')) {
      nextRow = nextRow.nextElementSibling as HTMLElement | null;
    }
    if (!nextRow) {
      this.addKeyAtBottom();
      return;
    }
    const nextCell = nextRow.children[cellIdx] as HTMLElement | undefined;
    if (!nextCell) return;
    const focusable = nextCell.querySelector<HTMLElement>('input, select');
    if (focusable) {
      focusable.focus();
      if (focusable instanceof HTMLInputElement) {
        focusable.select();
      }
    }
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
    return keyForm.get('tag')?.value || 'New key';
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

  trackByFilteredItem(_: number, item: { control: FormGroup; index: number }): string {
    return item.control.getRawValue().id ?? item.index.toString();
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
