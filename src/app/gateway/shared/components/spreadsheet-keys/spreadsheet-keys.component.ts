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
import { TranslateService } from '@ngx-translate/core';
import * as XLSX from 'xlsx';
import { SelectOption, SortDirection, SortFieldOption, SpreadsheetColumnConfig } from './spreadsheet-keys.models';

interface ActiveCell {
  control: FormGroup;
  key: string;
}

const COLUMN_RESIZE_STEP = 12;
const COLUMN_MIN_WIDTH = 40;
const IMPORT_TRUE_VALUES = new Set(['true', '1', 'yes', 'y', 'x', 'on']);
export const SPREADSHEET_IMPORT_ACCEPT = '.csv,.xlsx,.xls,.ods';

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
  /** Bulk row creation (import): the host appends `count` default rows synchronously. */
  @Output() addRowsRequested = new EventEmitter<number>();
  @Output() deleteRowsRequested = new EventEmitter<FormGroup[]>();

  @ViewChild('spreadsheetRoot', { static: true }) spreadsheetRoot!: ElementRef<HTMLElement>;
  @ViewChild('fileInput') fileInput: ElementRef<HTMLInputElement>;

  private elementRef = inject(ElementRef) as ElementRef<HTMLElement>;
  private cd = inject(ChangeDetectorRef);
  private translate = inject(TranslateService);

  readonly importAccept = SPREADSHEET_IMPORT_ACCEPT;

  searchControl = new FormControl('');
  filteredControls: { control: FormGroup; index: number }[] = [];
  displayedControls: { control: FormGroup; index: number }[] = [];
  renderLimit = 50;

  sortField: string | null = null;
  sortDirection: SortDirection = 'asc';

  selectedRowControls = new Set<FormGroup>();
  private lastSelectedRowControl: FormGroup | null = null;
  // Rows selected through the row-number cells or Ctrl+A. Delete removes rows
  // only for such a selection; with just an active cell it clears the cell.
  private explicitRowSelection = false;

  // Spreadsheet selection: the cell the arrow keys move and typing edits.
  // `editing` is true while that cell's native input owns the focus (edit
  // mode); otherwise the grid wrapper owns it (select mode).
  activeCell: ActiveCell | null = null;
  editing = false;
  // Where focusLastRow() should land after a row added from the keyboard.
  private pendingFocus: { key: string; edit: boolean } | null = null;

  // Per-column widths chosen with the keyboard, remembered per host.
  columnWidths: Record<string, number> = {};

  importStatus: { key: string; params?: Record<string, any>; error?: boolean } | null = null;

  private searchSub: any;

  get sortFields(): SortFieldOption[] {
    return this.columns
      .filter(c => c.sortable)
      .map(c => ({ value: c.key.startsWith('_') ? c.key : c.key, label: c.label }));
  }

  get gridTemplateColumns(): string {
    return '48px ' + this.columns
      .map(c => this.columnWidths[c.key] ? `${this.columnWidths[c.key]}px` : (c.width || 'minmax(100px, 1fr)'))
      .join(' ');
  }

  ngOnInit(): void {
    this.loadColumnWidths();
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
    const pending = this.pendingFocus;
    this.pendingFocus = null;
    const firstCol = this.columns[0];
    if (!firstCol) return;
    // The just-added row is appended at the end; make sure it's within the
    // rendered slice (lazy-load otherwise hides rows past renderLimit) so the
    // focus targets the new row and not the last visible one.
    this.updateFilteredControls();
    if (this.renderLimit < this.filteredControls.length) {
      this.renderLimit = this.filteredControls.length;
      this.displayedControls = this.filteredControls.slice(0, this.renderLimit);
      this.cd.markForCheck();
    }
    const last = this.displayedControls[this.displayedControls.length - 1];
    if (!last) return;
    const key = pending?.key ?? firstCol.key;
    const edit = pending ? pending.edit : true;
    let attempts = 0;
    const tryFocus = () => {
      this.cd.detectChanges();
      const rowIdx = this.displayedControls.length - 1;
      const cellEl = this.cellElement(rowIdx, this.colIndex(key));
      if (cellEl) {
        const wrapper = this.spreadsheetRoot?.nativeElement.querySelector('.spreadsheet-wrapper') as HTMLElement | null;
        if (wrapper) {
          wrapper.scrollTop = wrapper.scrollHeight;
        }
        this.setActiveCell(last.control, key, edit, { selectAll: true });
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
.spreadsheet-sort-menu-panel .mat-mdc-menu-item.sort-selected {
  background: color-mix(in srgb, var(--tb-primary, #26a69a) 14%, transparent) !important;
  color: var(--tb-primary, #26a69a) !important;
}
.spreadsheet-sort-menu-panel .mat-mdc-menu-item.sort-selected .mdc-list-item__primary-text,
.spreadsheet-sort-menu-panel .mat-mdc-menu-item.sort-selected .mat-icon {
  color: var(--tb-primary, #26a69a) !important;
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

  // ---- Row selection --------------------------------------------------------

  /** Header "#" cell: every row of the table, rendered or not, filtered or not. */
  toggleSelectAll(): void {
    const all = this.keysFormArray?.controls ?? [];
    const allSelected = all.length > 0 && all.every(c => this.selectedRowControls.has(c as FormGroup));
    if (allSelected) {
      this.selectedRowControls.clear();
      this.explicitRowSelection = false;
    } else {
      this.selectAllRows();
    }
    this.lastSelectedRowControl = null;
    this.cd.markForCheck();
  }

  selectAllRows(): void {
    this.selectedRowControls.clear();
    (this.keysFormArray?.controls ?? []).forEach(c => this.selectedRowControls.add(c as FormGroup));
    this.explicitRowSelection = this.selectedRowControls.size > 0;
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
    this.explicitRowSelection = this.selectedRowControls.size > 0;
    // A row selection made from the number cell leaves any cell edit and
    // parks the keyboard on the grid so Delete / Ctrl+A act on rows.
    this.exitEditMode(false);
    this.focusGrid();
    this.cd.markForCheck();
  }

  isRowSelected(form: FormGroup): boolean {
    return this.selectedRowControls.has(form);
  }

  /** Mouse down inside a cell: the row becomes the (implicit) selection and the
   *  cell becomes active in edit mode — the native input takes the click. */
  onCellMousedown(form: FormGroup, col: SpreadsheetColumnConfig): void {
    if (!this.selectedRowControls.has(form) || this.selectedRowControls.size !== 1) {
      this.selectedRowControls.clear();
      this.selectedRowControls.add(form);
      this.lastSelectedRowControl = form;
    }
    this.explicitRowSelection = false;
    this.activeCell = { control: form, key: col.key };
    this.editing = true;
    this.cd.markForCheck();
  }

  isActiveCell(form: FormGroup, key: string): boolean {
    return !!this.activeCell && this.activeCell.control === form && this.activeCell.key === key;
  }

  isActiveColumn(key: string): boolean {
    return !!this.activeCell && this.activeCell.key === key;
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
    this.explicitRowSelection = false;
    if (this.activeCell && rows.includes(this.activeCell.control)) {
      this.activeCell = null;
      this.editing = false;
    }
    this.cd.markForCheck();
  }

  // ---- Keyboard: edit mode (a cell's native input has the focus) -----------

  onCellKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const isSelect = target.tagName === 'SELECT';
    const isCheckbox = target instanceof HTMLInputElement && target.type === 'checkbox';
    const isText = target instanceof HTMLInputElement && !isCheckbox;
    if (this.activeCell === null) {
      this.activeCell = this.cellFromElement(target);
    }
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          this.requestRowBelow();
          return;
        }
        if (event.shiftKey) {
          this.moveActive(-1, 0, false);
        } else {
          this.moveDownOrAppend();
        }
        return;
      case 'Escape':
        // Ours, not the dialog's / popover's: the CDK overlay closes on an
        // Escape that reaches the document.
        event.preventDefault();
        event.stopPropagation();
        this.exitEditMode(true);
        return;
      case 'ArrowUp':
      case 'ArrowDown': {
        const dir = event.key === 'ArrowDown' ? 1 : -1;
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.jumpToRow(dir > 0 ? 'last' : 'first');
          return;
        }
        // Text and number cells: the caret only moves left/right, so up/down
        // hand the selection to the neighbouring row (select mode). Selects
        // keep the native option change, checkboxes their native behaviour.
        if (isText) {
          event.preventDefault();
          this.moveActive(dir, 0, false);
        }
        return;
      }
      case 'ArrowLeft':
      case 'ArrowRight':
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (isSelect || isCheckbox)) {
          event.preventDefault();
          this.jumpToColumn(event.key === 'ArrowRight' ? 'last' : 'first');
        }
        return;
      default:
        return;
    }
  }

  // ---- Keyboard: select mode (the grid wrapper has the focus) --------------

  onGridKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
      return;   // edit mode — handled by onCellKeydown on the input itself
    }
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && !event.shiftKey && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault();
      this.selectAllRows();
      return;
    }
    if (event.key === 'Delete' && this.explicitRowSelection && this.selectedRowControls.size > 0) {
      event.preventDefault();
      this.deleteSelectedRows();
      return;
    }
    if (!this.activeCell) {
      if (event.key.startsWith('Arrow') || event.key === 'Enter' || event.key === 'Tab') {
        const first = this.displayedControls[0];
        if (first && this.columns.length) {
          event.preventDefault();
          this.setActiveCell(first.control, this.columns[0].key, false);
        }
      }
      return;
    }
    const col = this.columns.find(c => c.key === this.activeCell.key);
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        event.preventDefault();
        const dir = event.key === 'ArrowRight' ? 1 : -1;
        if (ctrl && event.shiftKey) {
          this.resizeActiveColumn(dir * COLUMN_RESIZE_STEP);
        } else if (ctrl) {
          this.jumpToColumn(dir > 0 ? 'last' : 'first');
        } else {
          this.moveActive(0, dir, false);
        }
        return;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        event.preventDefault();
        const dir = event.key === 'ArrowDown' ? 1 : -1;
        if (ctrl) {
          this.jumpToRow(dir > 0 ? 'last' : 'first');
        } else {
          this.moveActive(dir, 0, false);
        }
        return;
      }
      case 'Home':
        event.preventDefault();
        this.jumpToColumn('first');
        return;
      case 'End':
        event.preventDefault();
        this.jumpToColumn('last');
        return;
      case 'Tab':
        event.preventDefault();
        this.moveActive(0, event.shiftKey ? -1 : 1, false);
        return;
      case 'Enter':
        event.preventDefault();
        if (event.shiftKey) {
          this.moveActive(-1, 0, false);
        } else if (col?.type === 'checkbox') {
          this.toggleActiveCheckbox();
        } else {
          this.enterEditMode({ caretEnd: true });
        }
        return;
      case ' ':
        if (col?.type === 'checkbox') {
          event.preventDefault();
          this.toggleActiveCheckbox();
        }
        return;
      case 'Delete':
        event.preventDefault();
        this.clearActiveCell();
        return;
      case 'Backspace':
        event.preventDefault();
        this.clearActiveCell();
        if (col && (col.type === 'input' || col.type === 'number')) {
          this.enterEditMode({ caretEnd: true });
        }
        return;
      case 'F2':
        event.preventDefault();
        this.enterEditMode({ caretEnd: true });
        return;
      case 'Escape':
        event.stopPropagation();   // keep the keys panel open; Escape only ever leaves a cell
        return;
      default:
        break;
    }
    if (ctrl && event.shiftKey && (event.key === '0' || event.code === 'Digit0')) {
      event.preventDefault();
      this.resetActiveColumnWidth();
      return;
    }
    // Any printable character starts typing over the cell's content: the
    // input is focused with its content selected BEFORE the key's default
    // action runs, so the character lands in the input and replaces it.
    if (event.key.length === 1 && !ctrl && !event.altKey && col) {
      if (col.type === 'input' || col.type === 'number') {
        this.enterEditMode({ selectAll: true });
      } else if (col.type === 'select') {
        this.enterEditMode({});   // native type-ahead picks the option
      }
    }
  }

  // ---- Selection mechanics --------------------------------------------------

  private colIndex(key: string): number {
    return this.columns.findIndex(c => c.key === key);
  }

  private rowIndexOf(control: FormGroup): number {
    return this.displayedControls.findIndex(d => d.control === control);
  }

  private cellElement(rowIdx: number, colIdx: number): HTMLElement | null {
    if (rowIdx < 0 || colIdx < 0) return null;
    const root = this.spreadsheetRoot?.nativeElement;
    const rows = root?.querySelectorAll<HTMLElement>('.spreadsheet-row');
    const row = rows?.[rowIdx];
    return (row?.children[colIdx + 1] as HTMLElement) ?? null;   // +1: row-number cell
  }

  private cellFromElement(el: HTMLElement): ActiveCell | null {
    const cellEl = el.closest('.cell') as HTMLElement | null;
    const rowEl = el.closest('.spreadsheet-row') as HTMLElement | null;
    if (!cellEl || !rowEl) return null;
    const root = this.spreadsheetRoot?.nativeElement;
    const rowIdx = Array.from(root?.querySelectorAll('.spreadsheet-row') ?? []).indexOf(rowEl);
    const colIdx = Array.from(rowEl.children).indexOf(cellEl) - 1;
    const item = this.displayedControls[rowIdx];
    const col = this.columns[colIdx];
    return item && col ? { control: item.control, key: col.key } : null;
  }

  private focusGrid(): void {
    const wrapper = this.spreadsheetRoot?.nativeElement.querySelector('.spreadsheet-wrapper') as HTMLElement | null;
    if (wrapper && document.activeElement !== wrapper) {
      wrapper.focus({ preventScroll: true });
    }
  }

  private ensureRowRendered(rowIdx: number): void {
    if (rowIdx >= this.displayedControls.length && rowIdx < this.filteredControls.length) {
      this.renderLimit = Math.max(this.renderLimit, rowIdx + 50);
      this.displayedControls = this.filteredControls.slice(0, this.renderLimit);
      this.cd.detectChanges();
    }
  }

  /** Makes a cell the active one, in edit mode (focus its input) or in select
   *  mode (focus the grid), and scrolls it into view. */
  private setActiveCell(control: FormGroup, key: string, edit: boolean,
                        opts: { selectAll?: boolean; caretEnd?: boolean } = {}): void {
    this.activeCell = { control, key };
    this.editing = edit;
    const rowIdx = this.rowIndexOf(control);
    const colIdx = this.colIndex(key);
    this.cd.detectChanges();
    const cellEl = this.cellElement(rowIdx, colIdx);
    cellEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (edit) {
      const focusable = cellEl?.querySelector<HTMLElement>('input, select');
      if (focusable && !(focusable as HTMLInputElement).disabled) {
        focusable.focus({ preventScroll: true });
        if (focusable instanceof HTMLInputElement && focusable.type !== 'checkbox') {
          if (opts.selectAll) {
            focusable.select();
          } else if (opts.caretEnd && focusable.type !== 'number') {
            const len = focusable.value.length;
            try { focusable.setSelectionRange(len, len); } catch (e) { /* not supported for this type */ }
          }
        }
      } else {
        this.editing = false;
        this.focusGrid();
      }
    } else {
      const active = document.activeElement as HTMLElement | null;
      if (active && cellEl?.contains(active)) {
        active.blur();
      }
      this.focusGrid();
    }
    this.cd.markForCheck();
  }

  private enterEditMode(opts: { selectAll?: boolean; caretEnd?: boolean }): void {
    if (!this.activeCell) return;
    this.setActiveCell(this.activeCell.control, this.activeCell.key, true, opts);
  }

  /** Escape: keep the cell active but hand the keyboard back to the grid. */
  private exitEditMode(focusGrid: boolean): void {
    const active = document.activeElement as HTMLElement | null;
    const root = this.spreadsheetRoot?.nativeElement;
    if (active && root?.contains(active) && active.tagName !== 'DIV') {
      active.blur();
    }
    this.editing = false;
    if (focusGrid) {
      this.focusGrid();
    }
    this.cd.markForCheck();
  }

  private moveActive(dRow: number, dCol: number, edit: boolean): void {
    if (!this.activeCell) return;
    const rowIdx = this.rowIndexOf(this.activeCell.control);
    const colIdx = this.colIndex(this.activeCell.key);
    if (rowIdx < 0 || colIdx < 0) return;
    const targetRow = Math.max(0, Math.min(this.filteredControls.length - 1, rowIdx + dRow));
    const targetCol = Math.max(0, Math.min(this.columns.length - 1, colIdx + dCol));
    this.ensureRowRendered(targetRow);
    const item = this.displayedControls[targetRow];
    if (!item) return;
    this.setActiveCell(item.control, this.columns[targetCol].key, edit);
  }

  private jumpToRow(where: 'first' | 'last'): void {
    if (!this.activeCell || !this.filteredControls.length) return;
    const targetRow = where === 'first' ? 0 : this.filteredControls.length - 1;
    this.ensureRowRendered(targetRow);
    const item = this.displayedControls[targetRow];
    if (!item) return;
    this.setActiveCell(item.control, this.activeCell.key, false);
  }

  private jumpToColumn(where: 'first' | 'last'): void {
    if (!this.activeCell || !this.columns.length) return;
    const col = where === 'first' ? this.columns[0] : this.columns[this.columns.length - 1];
    this.setActiveCell(this.activeCell.control, col.key, false);
  }

  /** Enter in edit mode: the cell below in select mode, or a new row when the
   *  active cell is on the last row. */
  private moveDownOrAppend(): void {
    if (!this.activeCell) return;
    const rowIdx = this.rowIndexOf(this.activeCell.control);
    if (rowIdx >= 0 && rowIdx < this.filteredControls.length - 1) {
      this.moveActive(1, 0, false);
    } else {
      this.requestRowBelow(false);
    }
  }

  private requestRowBelow(edit = true): void {
    this.pendingFocus = { key: this.activeCell?.key ?? this.columns[0]?.key, edit };
    this.addRowRequested.emit();
  }

  private toggleActiveCheckbox(): void {
    if (!this.activeCell) return;
    const cellEl = this.cellElement(this.rowIndexOf(this.activeCell.control), this.colIndex(this.activeCell.key));
    const box = cellEl?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (box && !box.disabled) {
      box.click();
    }
  }

  private clearActiveCell(): void {
    if (!this.activeCell) return;
    const col = this.columns.find(c => c.key === this.activeCell.key);
    if (!col || this.isCellDisabled(col, this.activeCell.control)) return;
    const row = this.activeCell.control;
    const empty = col.type === 'checkbox' ? false : col.type === 'number' ? null : '';
    if (col.key.startsWith('_') || col.setValue) {
      if (col.type !== 'select') {
        col.setValue?.(row, empty);
      }
    } else {
      const ctrl = row.get(col.key);
      if (ctrl && col.type !== 'select') {
        ctrl.setValue(empty);
        ctrl.markAsDirty();
      }
    }
    this.keysFormArray?.markAsDirty();
    this.cd.markForCheck();
  }

  // ---- Column widths (keyboard) --------------------------------------------

  private get widthsStorageKey(): string {
    return `tb-spreadsheet-widths:${this.hostSelector || 'tb-spreadsheet-keys'}`;
  }

  private loadColumnWidths(): void {
    try {
      const raw = localStorage.getItem(this.widthsStorageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      this.columnWidths = parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      this.columnWidths = {};
    }
  }

  private saveColumnWidths(): void {
    try {
      localStorage.setItem(this.widthsStorageKey, JSON.stringify(this.columnWidths));
    } catch (e) { /* storage unavailable — widths live for this session only */ }
  }

  private resizeActiveColumn(delta: number): void {
    if (!this.activeCell) return;
    const key = this.activeCell.key;
    let current = this.columnWidths[key];
    if (!current) {
      const colIdx = this.colIndex(key);
      const header = this.spreadsheetRoot?.nativeElement
        .querySelectorAll<HTMLElement>('.spreadsheet-table > .header-cell')[colIdx + 1];
      current = header ? Math.round(header.getBoundingClientRect().width) : 120;
    }
    this.columnWidths = { ...this.columnWidths, [key]: Math.max(COLUMN_MIN_WIDTH, current + delta) };
    this.saveColumnWidths();
    this.cd.markForCheck();
  }

  private resetActiveColumnWidth(): void {
    if (!this.activeCell) return;
    const { [this.activeCell.key]: _removed, ...rest } = this.columnWidths;
    this.columnWidths = rest;
    this.saveColumnWidths();
    this.cd.markForCheck();
  }

  // ---- Export (CSV) / import (CSV, XLSX, XLS, ODS) --------------------------

  private columnHeader(col: SpreadsheetColumnConfig): string {
    return this.translate.instant(col.label);
  }

  /** Exports the rows as listed (current search filter and sort) as CSV, one
   *  column per spreadsheet column, select cells as their stored value. */
  exportCsv(): void {
    const headers = this.columns.map(c => this.columnHeader(c));
    const rows = this.filteredControls.map(item => this.columns.map(col => {
      const v = this.getCellValue(col, item.control);
      return v === null || v === undefined ? '' : v;
    }));
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'keys');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const base = (this.hostSelector || 'keys').replace(/^tb-/, '').replace(/-data-keys-panel$/, '');
    XLSX.writeFile(book, `${base}-keys-${stamp}.csv`, { bookType: 'csv' });
  }

  openImport(): void {
    this.fileInput?.nativeElement.click();
  }

  onImportFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => this.setImportStatus('gateway.keys-import-failed', undefined, true);
    reader.onload = () => {
      try {
        const book = XLSX.read(reader.result as ArrayBuffer, { type: 'array' });
        const sheet = book.Sheets[book.SheetNames[0]];
        const table: any[][] = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) : [];
        this.importRows(table);
      } catch (e) {
        this.setImportStatus('gateway.keys-import-failed', undefined, true);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /** First row = headers matched against the column labels (translated) or
   *  keys, case-insensitive; every following non-empty row becomes a new key. */
  private importRows(table: any[][]): void {
    if (!table.length) {
      this.setImportStatus('gateway.keys-import-empty', undefined, true);
      return;
    }
    const norm = (s: any) => String(s ?? '').trim().toLowerCase();
    const headers = table[0].map(norm);
    const mapping: { col: SpreadsheetColumnConfig; index: number }[] = [];
    this.columns.forEach(col => {
      const candidates = [norm(this.columnHeader(col)), norm(col.label), norm(col.key), norm(col.key.replace(/^_/, ''))];
      const index = headers.findIndex(h => h && candidates.includes(h));
      if (index >= 0) mapping.push({ col, index });
    });
    if (!mapping.length) {
      this.setImportStatus('gateway.keys-import-no-columns', undefined, true);
      return;
    }
    const dataRows = table.slice(1).filter(r => r.some(v => norm(v) !== ''));
    if (!dataRows.length) {
      this.setImportStatus('gateway.keys-import-empty', undefined, true);
      return;
    }
    const before = this.keysFormArray.length;
    this.addRowsRequested.emit(dataRows.length);
    const added = this.keysFormArray.length - before;
    for (let i = 0; i < added; i++) {
      const row = this.keysFormArray.at(before + i) as FormGroup;
      const source = dataRows[i];
      for (const { col, index } of mapping) {
        this.applyImportedValue(col, row, source[index]);
      }
    }
    this.keysFormArray.markAsDirty();
    this.searchControl.setValue('', { emitEvent: false });
    this.renderLimit = Math.max(this.renderLimit, this.keysFormArray.length);
    this.updateFilteredControls();
    this.setImportStatus('gateway.keys-import-done', { count: added });
    const wrapper = this.spreadsheetRoot?.nativeElement.querySelector('.spreadsheet-wrapper') as HTMLElement | null;
    if (wrapper) {
      setTimeout(() => wrapper.scrollTop = wrapper.scrollHeight);
    }
  }

  private applyImportedValue(col: SpreadsheetColumnConfig, row: FormGroup, raw: any): void {
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return;
    let value: any = raw;
    switch (col.type) {
      case 'number': {
        const n = typeof raw === 'number' ? raw : parseFloat(String(raw).trim());
        if (isNaN(n)) return;
        value = n;
        break;
      }
      case 'checkbox':
        value = typeof raw === 'boolean' ? raw : IMPORT_TRUE_VALUES.has(String(raw).trim().toLowerCase());
        break;
      case 'select': {
        const options = this.getColumnOptions(col, row);
        const wanted = String(raw).trim().toLowerCase();
        const match = options.find(o => String(o.value).toLowerCase() === wanted)
          ?? options.find(o => String(o.label).toLowerCase() === wanted
            || (col.translateLabels && String(this.translate.instant(o.label)).toLowerCase() === wanted));
        if (!match) return;
        value = match.value;
        break;
      }
      default:
        value = String(raw);
        if (col.uppercase) value = value.toUpperCase();
    }
    if (col.setValue) {
      col.setValue(row, value);
    } else if (!col.key.startsWith('_')) {
      const ctrl = row.get(col.key);
      if (ctrl) {
        ctrl.setValue(value);
        ctrl.markAsDirty();
      }
    }
  }

  private setImportStatus(key: string, params?: Record<string, any>, error = false): void {
    this.importStatus = { key, params, error };
    this.cd.markForCheck();
  }

  clearImportStatus(): void {
    this.importStatus = null;
    this.cd.markForCheck();
  }

  // ---- Data --------------------------------------------------------------

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
    if (this.activeCell && !this.keysFormArray.controls.includes(this.activeCell.control)) {
      this.activeCell = null;
      this.editing = false;
    }
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
