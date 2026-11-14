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
  signal,
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
import { WriteTarget } from '../add-to-write/add-to-write.models';
import { computeFill } from './spreadsheet-fill';

interface ActiveCell {
  control: FormGroup;
  key: string;
}

/** A fill being dragged, or the one just dropped (it stays tinted a moment). */
interface FillRange {
  mode: 'row' | 'cell';
  /** The dragged column; null carries whole rows. */
  key: string | null;
  /** Indexes into the rows the search shows; `to` past the end means new rows. */
  from: number;
  to: number;
  /** Ctrl held: copy without counting. */
  plain: boolean;
}

interface FillUndo {
  rows: { control: FormGroup; raw: any; cells: Map<string, any> }[];
  added: FormGroup[];
}

const FILL_HANDLE_SIZE = 10;
const FILL_MAX_NEW_ROWS = 500;
const FILL_SCROLL_MS = 50;
const FILL_DONE_MS = 700;
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
  /** Write lists the selected rows can be copied to ("Add to RPC write",
   *  "Add to attribute updates"); empty hides the buttons. */
  @Input() writeTargets: WriteTarget[] = [];
  @Output() writeRequested = new EventEmitter<{ target: WriteTarget; rows: FormGroup[] }>();

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
  explicitRowSelection = false;

  // Spreadsheet selection: the cell the arrow keys move and typing edits.
  // `editing` is true while that cell's native input owns the focus (edit
  // mode); otherwise the grid wrapper owns it (select mode).
  activeCell: ActiveCell | null = null;
  editing = false;
  // Where focusLastRow() should land after a row added from the keyboard.
  private pendingFocus: { key: string; edit: boolean } | null = null;

  // Per-column widths chosen with the mouse or keyboard, remembered per host.
  columnWidths: Record<string, number> = {};
  // Column whose edge is being dragged (highlights its resize handle).
  resizingColumnKey: string | null = null;
  private stopColumnResize: (() => void) | null = null;

  importStatus: { key: string; params?: Record<string, any>; error?: boolean; undo?: boolean } | null = null;

  // Fill-drag: the range under the mouse while a corner handle is dragged,
  // then (briefly) the range that was filled.
  readonly fillRange = signal<FillRange | null>(null);
  /** Preview of the rows a drag past the last row would add, one text per column. */
  readonly fillGhostRows = signal<string[][]>([]);
  /** What the drag will write into the rows it covers: row index → column key → text. */
  private readonly fillPreview = signal<Map<number, Record<string, string>>>(new Map());
  readonly filling = signal(false);
  private fillUndo: FillUndo | null = null;
  private stopFill: (() => void) | null = null;
  private fillDoneTimer: any = null;
  private swallowRowClick = false;

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
    this.stopColumnResize?.();
    this.stopFill?.();
    clearTimeout(this.fillDoneTimer);
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
/* Edge to edge: no rounded corners, frame or shadow while the sheet fills
   the viewport, so nothing shows through at the corners. */
.cdk-overlay-pane.spreadsheet-fullscreen-pane .tb-popover-inner,
.cdk-overlay-pane.spreadsheet-fullscreen-pane .mat-mdc-dialog-container,
.cdk-overlay-pane.spreadsheet-fullscreen-pane .mat-mdc-dialog-surface {
  border-radius: 0 !important;
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
  --mdc-dialog-container-shape: 0;
}
.cdk-overlay-pane.spreadsheet-fullscreen-pane {
  z-index: 999 !important;
}
.st-fill-tip {
  position: fixed;
  z-index: 100000;
  pointer-events: none;
  padding: 4px 8px;
  border-radius: 4px;
  font: 500 12px Roboto, "Helvetica Neue", sans-serif;
  white-space: nowrap;
  color: #fff;
  background: #37474f;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}
body.st-col-resizing,
body.st-col-resizing * {
  cursor: col-resize !important;
  user-select: none !important;
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

  requestWrite(target: WriteTarget): void {
    // Rows in the list's order, not the order they were clicked in.
    const rows = (this.keysFormArray?.controls ?? [])
      .filter(c => this.selectedRowControls.has(c as FormGroup)) as FormGroup[];
    if (rows.length) {
      this.writeRequested.emit({ target, rows });
    }
  }

  // ---- Row selection --------------------------------------------------------

  /** Header "#" cell: every row the search matches, rendered or not. */
  toggleSelectAll(): void {
    const all = this.filteredControls.map(f => f.control);
    const allSelected = all.length > 0 && all.every(c => this.selectedRowControls.has(c));
    if (allSelected) {
      this.selectedRowControls.clear();
      this.explicitRowSelection = false;
    } else {
      this.selectAllRows();
    }
    this.lastSelectedRowControl = null;
    this.cd.markForCheck();
  }

  /** Ctrl+A: every row the search matches. With a search, rows it hides
   *  are never selected, so Delete cannot remove keys nobody can see. */
  selectAllRows(): void {
    this.selectedRowControls.clear();
    this.filteredControls.forEach(f => this.selectedRowControls.add(f.control));
    this.explicitRowSelection = this.selectedRowControls.size > 0;
    this.cd.markForCheck();
  }

  selectRow(form: FormGroup, event: MouseEvent): void {
    event.stopPropagation();
    if (this.swallowRowClick) {   // the click that ends a fill-drag on its own row
      this.swallowRowClick = false;
      return;
    }
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
  onCellMousedown(form: FormGroup, col: SpreadsheetColumnConfig, event?: MouseEvent): void {
    if (event && this.isActiveCell(form, col.key) && this.onFillHandle(event)) {
      this.startFill('cell', form, col.key, event);
      return;
    }
    this.forgetFill();
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

  /** Whether the column uppercases this value. */
  uppercases(col: SpreadsheetColumnConfig, value: any): boolean {
    return typeof col.uppercase === 'function'
      ? typeof value === 'string' && col.uppercase(value)
      : !!col.uppercase;
  }

  onUppercaseInput(form: FormGroup, col: SpreadsheetColumnConfig): void {
    const ctrl = form.get(col.key);
    if (ctrl && this.uppercases(col, ctrl.value)) {
      const val = ctrl.value;
      const upper = typeof val === 'string' ? val.toUpperCase() : val;
      if (val !== upper) {
        ctrl.setValue(upper, { emitEvent: false });
      }
    }
  }

  deleteSelectedRows(): void {
    if (this.selectedRowControls.size === 0) return;
    this.forgetFill();
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
    if (ctrl && !event.shiftKey && (event.key === 'z' || event.key === 'Z') && this.fillUndo) {
      event.preventDefault();
      this.undoFill();
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
    this.forgetFill();
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

  /** Spreadsheet-style resize: drag a header's right edge. On the first drag
   *  every column is pinned to its rendered width, so only the dragged column
   *  changes and the others stay put (the grid scrolls sideways if needed). */
  onColumnResizeStart(event: MouseEvent, col: SpreadsheetColumnConfig): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.stopColumnResize?.();
    const headers = this.spreadsheetRoot?.nativeElement
      .querySelectorAll<HTMLElement>('.spreadsheet-table > .header-cell');
    if (!headers) return;
    const pinned: Record<string, number> = {};
    this.columns.forEach((c, i) => {
      const header = headers[i + 1];
      pinned[c.key] = this.columnWidths[c.key]
        ?? (header ? Math.round(header.getBoundingClientRect().width) : 120);
    });
    const rtl = getComputedStyle(this.spreadsheetRoot.nativeElement).direction === 'rtl';
    const startX = event.clientX;
    const startWidth = pinned[col.key];
    this.columnWidths = pinned;
    this.resizingColumnKey = col.key;
    document.body.classList.add('st-col-resizing');
    this.cd.markForCheck();

    const onMove = (e: MouseEvent) => {
      const delta = (e.clientX - startX) * (rtl ? -1 : 1);
      const width = Math.max(COLUMN_MIN_WIDTH, Math.round(startWidth + delta));
      if (width !== this.columnWidths[col.key]) {
        this.columnWidths = { ...this.columnWidths, [col.key]: width };
        this.cd.markForCheck();
      }
    };
    const stop = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', stop);
      document.body.classList.remove('st-col-resizing');
      this.stopColumnResize = null;
      this.resizingColumnKey = null;
      this.saveColumnWidths();
      this.cd.markForCheck();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', stop);
    this.stopColumnResize = stop;
  }

  /** Double-click on a column edge: back to the column's default width. */
  resetColumnWidth(key: string, event?: MouseEvent): void {
    event?.preventDefault();
    event?.stopPropagation();
    const { [key]: _removed, ...rest } = this.columnWidths;
    this.columnWidths = rest;
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
    this.forgetFill();
    const addedRows = this.appendRows(dataRows.length);
    const added = addedRows.length;
    for (let i = 0; i < added; i++) {
      const row = addedRows[i];
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
        if (this.uppercases(col, value)) value = value.toUpperCase();
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
    this.fillUndo = null;
    this.importStatus = null;
    this.cd.markForCheck();
  }

  // ---- Fill-drag -------------------------------------------------------------
  // Dragging the square in the corner of the active cell repeats that cell
  // down (or up) its column; the square of a selected row number carries the
  // whole row. Each column's `fill` rule says how its value continues: copy,
  // count a trailing number, or the connector's own address step. Dragging
  // past the last row adds keys. Ctrl copies without counting; Escape cancels.

  /** The single selected row whose number cell shows the fill handle. */
  showsRowFillHandle(form: FormGroup): boolean {
    return this.explicitRowSelection && this.selectedRowControls.size === 1 && this.selectedRowControls.has(form);
  }

  onRowNumberMousedown(form: FormGroup, event: MouseEvent): void {
    if (this.showsRowFillHandle(form) && this.onFillHandle(event)) {
      this.swallowRowClick = true;
      this.startFill('row', form, null, event);
    }
  }

  /** Tints the cells a drag will fill (and, for a moment, the ones it filled). */
  isFillTarget(rowIdx: number, key: string | null): boolean {
    const range = this.fillRange();
    if (!range || rowIdx === range.from) return false;
    const inRows = range.to > range.from
      ? rowIdx > range.from && rowIdx <= range.to
      : rowIdx < range.from && rowIdx >= range.to;
    return inRows && (range.mode === 'row' || key === range.key);
  }

  /** Text shown over a cell the drag will write; null leaves the cell as it is. */
  fillPreviewText(rowIdx: number, key: string): string | null {
    return this.fillPreview().get(rowIdx)?.[key] ?? null;
  }

  /** The handle is drawn by CSS inside the cell's bottom-right corner, so a
   *  press there lands on the cell itself, never on its input. */
  private onFillHandle(event: MouseEvent): boolean {
    const cell = event.currentTarget as HTMLElement | null;
    if (!cell || event.button !== 0 || event.target !== cell) return false;
    const rect = cell.getBoundingClientRect();
    return rect.right - event.clientX <= FILL_HANDLE_SIZE && rect.bottom - event.clientY <= FILL_HANDLE_SIZE;
  }

  private fillSnapshot(control: FormGroup): Record<string, any> {
    const row: Record<string, any> = { ...control.getRawValue() };
    this.columns.forEach(col => row[col.key] = this.getCellValue(col, control));
    return row;
  }

  private startFill(mode: 'row' | 'cell', control: FormGroup, key: string | null, event: MouseEvent): void {
    const wrapper = this.spreadsheetRoot?.nativeElement.querySelector('.spreadsheet-wrapper') as HTMLElement | null;
    const from = this.filteredControls.findIndex(f => f.control === control);
    if (!wrapper || from < 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.stopFill?.();
    clearTimeout(this.fillDoneTimer);   // the tint of the last fill must not end this drag
    this.forgetFill();
    this.exitEditMode(true);

    const seed = control;
    const targets = this.filteredControls.map(f => f.control);
    const rows = targets.map(c => this.fillSnapshot(c));
    // New rows land at the end of the list, so they only make sense while
    // the sheet shows every key in its own order.
    const canAppend = !this.sortField && !(this.searchControl.value || '').trim();
    const maxIdx = rows.length - 1 + (canAppend ? FILL_MAX_NEW_ROWS : 0);
    const doc = wrapper.ownerDocument;
    const tip = doc.createElement('div');
    tip.className = 'st-fill-tip';
    tip.style.display = 'none';
    // Inside the sheet, not on <body>: a full-screen panel sits above the page.
    this.spreadsheetRoot.nativeElement.appendChild(tip);

    let lastX = event.clientX;
    let lastY = event.clientY;
    let slow = 0;
    const plan = (range: FillRange) => computeFill({
      columns: this.columns, rows, from: range.from, to: range.to, mode: range.mode, key: range.key ?? undefined, plain: range.plain,
    });
    const indexAt = (clientY: number): number => {
      const first = this.cellElement(0, 0);
      if (!first) return from;
      const rect = first.getBoundingClientRect();
      return Math.floor((clientY - rect.top) / (rect.height || 28));
    };
    const show = (to: number, plain: boolean) => {
      to = Math.max(0, Math.min(maxIdx, to));
      const current = this.fillRange();
      if (!current || current.to !== to || current.plain !== plain) {
        this.ensureRowRendered(Math.min(to, rows.length - 1));
        const range: FillRange = { mode, key, from, to, plain };
        const result = plan(range);
        const ghosts: string[][] = [];
        const preview = new Map<number, Record<string, string>>();
        result.forEach((patch, idx) => {
          const target = targets[idx];
          if (!target) {
            // A new key: cells the seed row does not use stay empty.
            ghosts.push(this.columns.map(col => this.isCellVisible(col, seed) ? this.fillText(col, seed, patch[col.key]) : ''));
            return;
          }
          const texts: Record<string, string> = {};
          for (const col of this.columns) {
            if (col.key in patch && col.type !== 'checkbox' && this.takesFill(col, target, patch[col.key])) {
              texts[col.key] = this.fillText(col, target, patch[col.key]);
            }
          }
          preview.set(idx, texts);
        });
        this.fillRange.set(range);
        this.fillGhostRows.set(ghosts);
        this.fillPreview.set(preview);
        const count = Math.abs(to - from);
        if (count) {
          const col = this.columns.find(c => c.key === key) ?? this.columns[0];
          const value = col ? (result.get(to) ?? {})[col.key] : '';
          const added = Math.max(0, to - (rows.length - 1));
          tip.textContent = [
            this.fillText(col, seed, value),
            this.translate.instant(added ? 'gateway.keys-fill-tip-new' : 'gateway.keys-fill-tip', { count, added }),
            ...(plain ? [this.translate.instant('gateway.keys-fill-tip-copy')] : []),
          ].filter(t => t !== '').join('  ·  ');
        }
        tip.style.display = count ? '' : 'none';
        if (ghosts.length) {
          // Keep the newest preview row in view without waiting for the timer.
          this.cd.detectChanges();
          if (to === maxIdx || lastY >= wrapper.getBoundingClientRect().bottom) {
            wrapper.scrollTop = wrapper.scrollHeight;
          }
        }
      }
      tip.style.left = `${lastX + 14}px`;
      tip.style.top = `${lastY + 16}px`;
    };
    // `scroll` is true on the timer: the pointer rests outside the sheet, so
    // the sheet scrolls towards it and, at its end, grows row by row.
    const step = (scroll: boolean, plain: boolean) => {
      const rect = wrapper.getBoundingClientRect();
      const top = rect.top + 28;                       // below the sticky header
      const bottom = rect.top + wrapper.clientHeight;  // above a horizontal scrollbar
      const current = this.fillRange()?.to ?? from;
      let to: number;
      if (lastY >= bottom) {
        const atEnd = wrapper.scrollTop + wrapper.clientHeight >= wrapper.scrollHeight - 1;
        if (scroll && !atEnd) wrapper.scrollTop += 28;
        // A sheet with nothing to scroll grows in place, so the pointer's
        // distance below it counts row for row.
        const grows = wrapper.scrollHeight <= wrapper.clientHeight + 1;
        to = Math.max(indexAt(grows ? lastY : bottom - 2), current);
        if (scroll && atEnd && ++slow % 3 === 0) to = Math.max(to, rows.length - 1) + 1;
        if (!canAppend) to = Math.min(to, rows.length - 1);
      } else if (lastY <= top) {
        if (scroll) wrapper.scrollTop -= 28;
        to = Math.min(indexAt(top + 2), current);
      } else {
        to = indexAt(lastY);
      }
      show(to, plain);
    };

    let plainNow = event.ctrlKey || event.metaKey;
    const onMove = (e: MouseEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      plainNow = e.ctrlKey || e.metaKey;
      step(false, plainNow);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Cancels the drag only: the panel behind must not close on this key.
        e.stopImmediatePropagation();
        finish(false);
      } else if (e.key === 'Control' || e.key === 'Meta') {
        plainNow = e.type === 'keydown';
        step(false, plainNow);
      }
    };
    const onUp = () => finish(true);
    const timer = setInterval(() => step(true, plainNow), FILL_SCROLL_MS);
    const finish = (commit: boolean) => {
      clearInterval(timer);
      doc.removeEventListener('mousemove', onMove, true);
      doc.removeEventListener('mouseup', onUp, true);
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('keyup', onKey, true);
      tip.remove();
      this.stopFill = null;
      const range = this.fillRange();
      this.filling.set(false);
      this.fillGhostRows.set([]);
      this.fillPreview.set(new Map());
      this.fillRange.set(null);
      // Let the click that follows the mouse-up pass, then stop swallowing.
      setTimeout(() => this.swallowRowClick = false);
      if (commit && range && range.to !== range.from) {
        this.commitFill(range, targets, plan(range));
      }
    };
    doc.addEventListener('mousemove', onMove, true);
    doc.addEventListener('mouseup', onUp, true);
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('keyup', onKey, true);
    this.stopFill = () => finish(false);
    this.filling.set(true);
    this.fillRange.set({ mode, key, from, to: from, plain: plainNow });
  }

  /** Asks the host for `count` default rows and returns them, at the end of
   *  the list: a host may put a new key first (the mapping panel does). */
  private appendRows(count: number): FormGroup[] {
    const before = new Set(this.keysFormArray.controls);
    this.addRowsRequested.emit(count);
    const added = this.keysFormArray.controls.filter(c => !before.has(c)) as FormGroup[];
    const tail = this.keysFormArray.controls.slice(this.keysFormArray.length - added.length);
    if (added.some((c, i) => tail[i] !== c)) {
      added.forEach(c => this.keysFormArray.removeAt(this.keysFormArray.controls.indexOf(c), { emitEvent: false }));
      added.forEach(c => this.keysFormArray.push(c, { emitEvent: false }));
      this.keysFormArray.updateValueAndValidity();
    }
    return added;
  }

  /** What a preview cell shows for a value: a select shows its option's label. */
  private fillText(col: SpreadsheetColumnConfig | undefined, row: FormGroup, value: any): string {
    if (!col || col.type === 'checkbox' || value === null || value === undefined) return '';
    if (col.type === 'select') {
      const option = this.getColumnOptions(col, row).find(o => String(o.value) === String(value));
      if (option) return col.translateLabels ? this.translate.instant(option.label) : option.label;
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  private commitFill(range: FillRange, targets: FormGroup[], result: Map<number, Record<string, any>>): void {
    const newCount = Math.max(0, range.to - (targets.length - 1));
    const added = newCount ? this.appendRows(newCount) : [];
    const undo: FillUndo = { rows: [], added };
    let filled = 0;
    result.forEach((patch, idx) => {
      const isNew = idx >= targets.length;
      const control = isNew ? added[idx - targets.length] : targets[idx];
      if (!control) return;
      if (!isNew) {
        undo.rows.push({
          control,
          raw: control.getRawValue(),
          cells: new Map(this.columns.map(col => [col.key, this.getCellValue(col, control)])),
        });
      }
      for (const col of this.columns) {
        if (col.key in patch) this.writeFillValue(col, control, patch[col.key]);
      }
      filled++;
    });
    this.keysFormArray.markAsDirty();
    this.renderLimit = Math.max(this.renderLimit, Math.max(range.from, range.to) + 1);
    this.updateFilteredControls();
    this.fillUndo = undo;
    this.importStatus = {
      key: added.length ? 'gateway.keys-fill-done-new' : 'gateway.keys-fill-done',
      params: { count: filled, added: added.length },
      undo: true,
    };
    // The filled cells keep their tint for a moment, then let go.
    this.fillRange.set(range);
    clearTimeout(this.fillDoneTimer);
    this.fillDoneTimer = setTimeout(() => this.fillRange.set(null), FILL_DONE_MS);
    this.cd.detectChanges();
    const endCol = Math.max(0, this.colIndex(range.key ?? this.columns[0]?.key));
    this.cellElement(range.to, endCol)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.focusGrid();
  }

  /** A cell does not take a filled value when it is hidden or disabled for
   *  that row, or is a select without that option. */
  private takesFill(col: SpreadsheetColumnConfig, row: FormGroup, value: any): boolean {
    if (!this.isCellVisible(col, row) || this.isCellDisabled(col, row)) return false;
    return col.type !== 'select' || this.getColumnOptions(col, row).some(o => String(o.value) === String(value));
  }

  private writeFillValue(col: SpreadsheetColumnConfig, row: FormGroup, value: any): void {
    if (!this.takesFill(col, row, value) || this.getCellValue(col, row) === value) return;
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

  /** Ctrl+Z or the Undo link: the last fill, as long as nothing was edited since. */
  undoFill(): void {
    const undo = this.fillUndo;
    if (!undo) return;
    this.fillUndo = null;
    this.importStatus = null;
    const alive = new Set(this.keysFormArray.controls);
    for (const row of undo.rows) {
      if (!alive.has(row.control)) continue;
      row.control.patchValue(row.raw);
      for (const col of this.columns) {
        this.writeFillValue(col, row.control, row.cells.get(col.key));
      }
    }
    const added = undo.added.filter(c => alive.has(c));
    if (added.length) {
      this.deleteRowsRequested.emit(added);
    }
    this.keysFormArray.markAsDirty();
    this.updateFilteredControls();
    this.focusGrid();
  }

  /** An edit after a fill makes its undo stale; drop it and its status line. */
  private forgetFill(): void {
    if (!this.fillUndo) return;
    this.fillUndo = null;
    if (this.importStatus?.undo) {
      this.importStatus = null;
    }
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
    // A selection never reaches past what the search shows.
    if (this.selectedRowControls.size) {
      const shown = new Set(this.filteredControls.map(f => f.control));
      this.selectedRowControls.forEach(c => !shown.has(c) && this.selectedRowControls.delete(c));
      this.explicitRowSelection = this.explicitRowSelection && this.selectedRowControls.size > 0;
    }
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
