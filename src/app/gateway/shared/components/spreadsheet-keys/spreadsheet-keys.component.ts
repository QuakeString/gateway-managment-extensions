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
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { SelectOption, SortDirection, SortFieldOption, SpreadsheetColumnConfig } from './spreadsheet-keys.models';

@Component({
  selector: 'tb-spreadsheet-keys',
  templateUrl: './spreadsheet-keys.component.html',
  styleUrls: ['./spreadsheet-keys.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule, ReactiveFormsModule],
  host: {
    '[class.fullscreen-host]': 'isFullscreen',
  },
})
export class SpreadsheetKeysComponent implements OnInit, OnChanges, OnDestroy {

  @Input() keysFormArray: FormArray;
  @Input() columns: SpreadsheetColumnConfig[] = [];
  @Input() searchFields: string[] = ['tag', 'address'];
  @Input() isFullscreen = false;
  @Input() hostSelector = '';

  @Output() fullscreenToggled = new EventEmitter<boolean>();
  @Output() addRowRequested = new EventEmitter<void>();
  @Output() deleteRowsRequested = new EventEmitter<FormGroup[]>();

  @ViewChild('spreadsheetRoot', { static: true }) spreadsheetRoot!: ElementRef<HTMLElement>;

  private elementRef = inject(ElementRef) as ElementRef<HTMLElement>;
  private cd = inject(ChangeDetectorRef);

  searchControl = new FormControl('');
  filteredControls: { control: FormGroup; index: number }[] = [];
  displayedControls: { control: FormGroup; index: number }[] = [];
  renderLimit = 50;

  sortField: string | null = null;
  sortDirection: SortDirection = 'asc';

  selectedRowControls = new Set<FormGroup>();
  private lastSelectedRowControl: FormGroup | null = null;

  private searchSub: any;

  get sortFields(): SortFieldOption[] {
    return this.columns
      .filter(c => c.sortable)
      .map(c => ({ value: c.key.startsWith('_') ? c.key : c.key, label: c.label }));
  }

  get gridTemplateColumns(): string {
    return '48px ' + this.columns.map(c => c.width || 'minmax(100px, 1fr)').join(' ');
  }

  @HostListener('document:keydown.delete', ['$event'])
  onDeleteKey(event: KeyboardEvent): void {
    if (!this.isFullscreen || this.selectedRowControls.size === 0) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    event.preventDefault();
    this.deleteSelectedRows();
  }

  ngOnInit(): void {
    this.updateFilteredControls();
    this.searchSub = this.searchControl.valueChanges.subscribe(() => {
      this.renderLimit = 50;
      this.updateFilteredControls();
    });
    this.injectGlobalStyles();
    if (this.isFullscreen) {
      this.addFullscreenClass();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['keysFormArray'] || changes['columns']) {
      this.updateFilteredControls();
    }
  }

  ngOnDestroy(): void {
    if (this.isFullscreen) {
      this.removeFullscreenClass();
    }
    this.searchSub?.unsubscribe();
  }

  refreshDisplay(): void {
    this.updateFilteredControls();
  }

  focusLastRow(): void {
    const firstCol = this.columns[0];
    if (!firstCol) return;
    // The just-added row is appended at the end; make sure it's within the
    // rendered slice (lazy-load otherwise hides rows past renderLimit) so the
    // focus targets the new row and not the last visible one.
    if (this.renderLimit < this.filteredControls.length) {
      this.renderLimit = this.filteredControls.length;
      this.displayedControls = this.filteredControls.slice(0, this.renderLimit);
      this.cd.markForCheck();
    }
    const fieldName = firstCol.key.startsWith('_') ? null : firstCol.key;
    let attempts = 0;
    const tryFocus = () => {
      const root = this.spreadsheetRoot?.nativeElement;
      let inputs: NodeListOf<HTMLInputElement> | null = null;
      if (fieldName) {
        inputs = root?.querySelectorAll<HTMLInputElement>(`.spreadsheet-row .cell-input[name="${fieldName}"]`) ?? null;
        if (!inputs || inputs.length === 0) {
          inputs = root?.querySelectorAll<HTMLInputElement>(`.spreadsheet-row .cell-input`) ?? null;
        }
      } else {
        inputs = root?.querySelectorAll<HTMLInputElement>(`.spreadsheet-row .cell-input`) ?? null;
      }
      const input = inputs && inputs.length ? inputs[inputs.length - 1] : null;
      if (input) {
        const wrapper = root?.querySelector('.spreadsheet-wrapper') as HTMLElement | null;
        if (wrapper) {
          wrapper.scrollTop = wrapper.scrollHeight;
        }
        input.focus();
        input.select();
      } else if (attempts++ < 40) {
        setTimeout(tryFocus, 50);
      }
    };
    setTimeout(tryFocus);
  }

  toggleFullscreen(): void {
    this.isFullscreen = !this.isFullscreen;
    if (this.isFullscreen) {
      this.addFullscreenClass();
    } else {
      this.removeFullscreenClass();
    }
    this.fullscreenToggled.emit(this.isFullscreen);
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

  private injectGlobalStyles(): void {
    if (typeof document === 'undefined') return;
    const hostSel = this.hostSelector || 'tb-spreadsheet-keys';

    // Shared styles (once)
    const SHARED_ID = 'spreadsheet-keys-globals-shared';
    if (!document.getElementById(SHARED_ID)) {
      const shared = document.createElement('style');
      shared.id = SHARED_ID;
      shared.textContent = `
.spreadsheet-sort-menu-panel.mat-mdc-menu-panel {
  background: var(--tb-surface-card) !important;
}
.spreadsheet-sort-menu-panel .mat-mdc-menu-item {
  color: var(--tb-text-primary) !important;
}
.spreadsheet-sort-menu-panel .mat-mdc-menu-item .mdc-list-item__primary-text {
  color: var(--tb-text-primary) !important;
}
.spreadsheet-sort-menu-panel .mat-mdc-menu-item:hover:not([disabled]),
.spreadsheet-sort-menu-panel .mat-mdc-menu-item.cdk-program-focused:not([disabled]),
.spreadsheet-sort-menu-panel .mat-mdc-menu-item.cdk-keyboard-focused:not([disabled]),
.spreadsheet-sort-menu-panel .mat-mdc-menu-item-highlighted:not([disabled]) {
  background: color-mix(in srgb, var(--tb-primary, #26a69a) 22%, transparent) !important;
}
.spreadsheet-sort-menu-panel .mat-mdc-menu-item .mat-mdc-focus-indicator::before {
  background: transparent !important;
}
.spreadsheet-sort-menu-panel .mat-mdc-menu-item .mat-icon {
  color: var(--tb-text-secondary) !important;
}
.cdk-overlay-pane.spreadsheet-fullscreen-pane {
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
.cdk-overlay-pane.spreadsheet-fullscreen-pane > div,
.cdk-overlay-pane.spreadsheet-fullscreen-pane .tb-popover,
.cdk-overlay-pane.spreadsheet-fullscreen-pane .tb-popover-content,
.cdk-overlay-pane.spreadsheet-fullscreen-pane .tb-popover-inner,
.cdk-overlay-pane.spreadsheet-fullscreen-pane .tb-popover-inner-content {
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
  padding: 0 !important;
  margin: 0 !important;
  box-sizing: border-box !important;
}
.cdk-overlay-pane.spreadsheet-fullscreen-pane .tb-popover-arrow {
  display: none !important;
}
.cdk-overlay-pane.spreadsheet-fullscreen-pane {
  z-index: 999 !important;
}
.cdk-global-overlay-wrapper {
  z-index: 1000 !important;
}
`;
      document.head.appendChild(shared);
    }

    // Per-host styles (once per hostSelector)
    const HOST_ID = `spreadsheet-keys-globals-${hostSel}`;
    if (!document.getElementById(HOST_ID)) {
      const hostStyle = document.createElement('style');
      hostStyle.id = HOST_ID;
      hostStyle.textContent = `
.cdk-overlay-pane.spreadsheet-fullscreen-pane ${hostSel} {
  display: block !important;
  width: 100% !important;
  height: 100% !important;
}
body.tb-dark ${hostSel},
body.tb-dark .cdk-overlay-pane.spreadsheet-fullscreen-pane,
body.tb-dark ${hostSel} .cell-input,
body.tb-dark ${hostSel} .cell-select,
body.tb-dark ${hostSel} .cell-checkbox,
body.tb-dark ${hostSel} input[type="checkbox"],
body.tb-dark ${hostSel} input[type="number"] {
  color-scheme: dark;
}
`;
      document.head.appendChild(hostStyle);
    }
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

  onCellClick(form: FormGroup): void {
    if (!this.selectedRowControls.has(form)) {
      this.selectedRowControls.clear();
      this.selectedRowControls.add(form);
      this.lastSelectedRowControl = form;
      this.cd.markForCheck();
    }
  }

  onUppercaseInput(form: FormGroup, key: string): void {
    const ctrl = form.get(key);
    if (ctrl) {
      const val = ctrl.value;
      const upper = typeof val === 'string' ? val.toUpperCase() : val;
      if (val !== upper) {
        ctrl.setValue(upper, { emitEvent: false });
      }
    }
  }

  deleteSelectedRows(): void {
    if (this.selectedRowControls.size === 0) return;
    const rows = Array.from(this.selectedRowControls);
    this.deleteRowsRequested.emit(rows);
    this.selectedRowControls.clear();
    this.lastSelectedRowControl = null;
  }

  onCellKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      this.addRowRequested.emit();
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
      this.addRowRequested.emit();
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
    if (!this.keysFormArray) return;
    const search = (this.searchControl.value || '').toLowerCase().trim();
    if (!search) {
      this.filteredControls = this.keysFormArray.controls
        .map((c, i) => ({ control: c as FormGroup, index: i }));
    } else {
      this.filteredControls = this.keysFormArray.controls
        .map((c, i) => ({ control: c as FormGroup, index: i }))
        .filter(item => {
          return this.searchFields.some(field => {
            const val = (item.control.get(field)?.value ?? '').toString().toLowerCase();
            return val.includes(search);
          });
        });
    }
    if (this.sortField) {
      const dir = this.sortDirection === 'asc' ? 1 : -1;
      const field = this.sortField;
      const col = this.columns.find(c => c.key === field);
      this.filteredControls = [...this.filteredControls].sort((a, b) => {
        let av: string, bv: string;
        if (col?.getValue) {
          av = (col.getValue(a.control) ?? '').toString().toLowerCase();
          bv = (col.getValue(b.control) ?? '').toString().toLowerCase();
        } else {
          av = (a.control.get(field)?.value ?? '').toString().toLowerCase();
          bv = (b.control.get(field)?.value ?? '').toString().toLowerCase();
        }
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

  getColumnOptions(col: SpreadsheetColumnConfig, row: FormGroup): SelectOption[] {
    if (!col.options) return [];
    if (typeof col.options === 'function') return col.options(row);
    return col.options;
  }

  getCellValue(col: SpreadsheetColumnConfig, row: FormGroup): any {
    if (col.getValue) return col.getValue(row);
    return row.get(col.key)?.value;
  }

  /** True when an imperative-select option matches the cell's current value.
   *  Drives the native <option [selected]>, which (unlike binding [value] on a
   *  <select> with *ngFor options) reliably reflects the value regardless of
   *  option render order. Compared as strings since the DOM value is a string
   *  while the form value may be a number (e.g. Modbus function codes). */
  isOptionSelected(col: SpreadsheetColumnConfig, row: FormGroup, optValue: any): boolean {
    const current = this.getCellValue(col, row);
    return current != null && String(current) === String(optValue);
  }

  onCellValueChange(col: SpreadsheetColumnConfig, row: FormGroup, event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    let value: any = target.value;
    if (col.type === 'number') {
      value = target.value === '' ? null : parseFloat(target.value);
      if (isNaN(value)) value = null;
    }
    if (col.type === 'checkbox') {
      value = (target as HTMLInputElement).checked;
    }
    if (col.setValue) {
      col.setValue(row, value);
    }
  }

  isCellDisabled(col: SpreadsheetColumnConfig, row: FormGroup): boolean {
    if (col.cellDisabled) return col.cellDisabled(row);
    if (col.key.startsWith('_')) return false;
    return row.get(col.key)?.disabled ?? false;
  }

  isCellVisible(col: SpreadsheetColumnConfig, row: FormGroup): boolean {
    if (col.cellVisible) return col.cellVisible(row);
    return true;
  }

  isCellInvalid(col: SpreadsheetColumnConfig, row: FormGroup): boolean {
    const control = row.get(col.key);
    return !!control && control.invalid && (control.touched || control.dirty);
  }
}
