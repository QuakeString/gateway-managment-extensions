///
/// Copyright © 2016-2025 The Sentient Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///

/**
 * Presentational chassis for the industrial data-keys panels.
 *
 * What it owns:
 *   - Toolbar (pill search, sort menu, fullscreen toggle)
 *   - Virtualization (renderLimit + infinite scroll)
 *   - Sort + filter over a FormArray
 *   - Fullscreen → SpreadsheetKeysComponent switch (same component
 *     all five industrial panels were already using).
 *   - Footer actions (Add / Cancel / Apply)
 *
 * What it does NOT own:
 *   - Form shape / validators / creation — host builds the FormArray
 *     and passes it in.
 *   - Row body / header templates — host provides ng-templates so each
 *     connector can keep its own domain-specific labels and inputs.
 *
 * Host panels become thin wrappers that build the column config, sort
 * fields, and row templates, then hand everything to this shell.
 */

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
  TemplateRef,
  ViewChild,
} from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SpreadsheetKeysComponent } from '../spreadsheet-keys/spreadsheet-keys.component';
import { SpreadsheetColumnConfig } from '../spreadsheet-keys/spreadsheet-keys.models';
import { IndustrialKeysSortFieldOption } from './industrial-keys-panel.models';
import { KeysWriteHandler, WriteTarget } from '../add-to-write/add-to-write.models';

@Component({
  selector: 'tb-industrial-keys-panel',
  templateUrl: './industrial-keys-panel.component.html',
  styleUrls: ['./industrial-keys-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule, ReactiveFormsModule, SpreadsheetKeysComponent],
})
export class IndustrialKeysPanelComponent implements OnInit, OnChanges, OnDestroy {

  /** Form array that backs the list of keys. Host owns it; shell
   *  only reads length + controls for filtering/sorting/display. */
  @Input({ required: true }) keysFormArray!: FormArray;

  @Input() title = 'gateway.gw-data-keys';
  @Input() addKeyLabel = 'gateway.gw-add-key';
  @Input() deleteKeyTitle = 'gateway.gw-delete-key';
  @Input() emptyText = 'gateway.gw-no-keys-configured';

  /** Field names (on each row's FormGroup) to search by. Case-
   *  insensitive substring match; host passes e.g. ['tag', 'address']. */
  @Input() searchFields: string[] = [];

  /** Sort menu items. Host passes e.g. [{value: 'tag', label: 'Key'}]. */
  @Input() sortFields: IndustrialKeysSortFieldOption[] = [];

  /** Column config for the fullscreen spreadsheet view. When empty,
   *  the fullscreen button is hidden (same as fullscreenSupported=false). */
  @Input() spreadsheetColumns: SpreadsheetColumnConfig[] = [];

  /** Host CSS selector the spreadsheet component uses to target its
   *  own fullscreen scope — matches the hostSelector Input of the
   *  spreadsheet component. Default is the shell's own selector. */
  @Input() hostSelector = 'tb-industrial-keys-panel';

  /** Set false to hide the fullscreen button entirely — useful for
   *  row shapes that don't map onto a flat grid (e.g. RPC with
   *  nested arguments). */
  @Input() fullscreenSupported = true;

  /** Row header template — the left side of the mat-expansion-panel
   *  header. Host renders its own labeled field pairs here
   *  (Key: X  Address: Y  Type: Z). Receives the row FormGroup as
   *  `$implicit` and the row index as `index`. */
  @Input() rowHeaderTpl: TemplateRef<{ $implicit: FormGroup; index: number }> | null = null;

  /** Row body template — rendered inside matExpansionPanelContent.
   *  Host puts per-connector form fields, calibration block, and
   *  report strategy here. */
  @Input() rowBodyTpl: TemplateRef<{ $implicit: FormGroup; index: number }> | null = null;

  /** Disable the Apply button. Hosts typically pass
   *  `keysFormArray.invalid || !keysFormArray.dirty`. */
  @Input() applyDisabled = false;

  /** Set by a device dialog on its time-series / attribute panels: rows
   *  get a tick box, and ticked keys can be added to RPC write or
   *  attribute updates. Needs `persistedKeys`. */
  @Input() writeHandler: KeysWriteHandler | null = null;

  /** The keys in the shape the host emits on Apply, in form-array
   *  order; the ticked ones are handed to `writeHandler`. */
  @Input() persistedKeys: (() => any[]) | null = null;

  @Output() addKeyRequested = new EventEmitter<void>();
  @Output() deleteKeyRequested = new EventEmitter<number>();
  @Output() applyRequested = new EventEmitter<void>();
  @Output() cancelRequested = new EventEmitter<void>();

  @ViewChild('panelRoot', { static: true }) panelRoot!: ElementRef<HTMLElement>;
  @ViewChild(SpreadsheetKeysComponent) spreadsheetKeys: SpreadsheetKeysComponent;

  searchControl = new FormControl('');
  filteredControls: { control: FormGroup; index: number }[] = [];
  displayedControls: { control: FormGroup; index: number }[] = [];
  renderLimit = 50;
  lastAddedId: string | null = null;

  isFullscreen = false;
  sortField: string | null = null;
  sortDirection: 'asc' | 'desc' = 'asc';

  private pendingReveal = false;

  /** Ticked rows, by form group so sorting and filtering keep them. */
  readonly selected = new Set<FormGroup>();

  private destroy$ = new Subject<void>();
  private cd = inject(ChangeDetectorRef);
  private elementRef = inject(ElementRef) as ElementRef<HTMLElement>;

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (this.isFullscreen) {
      event.stopImmediatePropagation();
      event.preventDefault();
      this.toggleFullscreen();
    }
  }

  ngOnInit(): void {
    this.updateFilteredControls();
    this.searchControl.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.renderLimit = 50;
        this.updateFilteredControls();
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Hosts may swap the whole form array (rare) or push rows into
    // the existing one (common, via addKeyRequested). We re-derive
    // on reference change; otherwise host should call refresh() after
    // mutations. OnPush prevents auto-detection on internal pushes.
    if (changes['keysFormArray'] && !changes['keysFormArray'].firstChange) {
      this.updateFilteredControls();
    }
  }

  ngOnDestroy(): void {
    if (this.isFullscreen) this.removeFullscreenClass();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Host calls this after mutating the form array (add/delete key)
   *  so the filtered/displayed lists pick up the change under OnPush. */
  refresh(): void {
    this.pruneSelection();
    this.updateFilteredControls();
    this.spreadsheetKeys?.refreshDisplay();
    if (this.pendingReveal) {
      this.pendingReveal = false;
      this.revealLastAdded();
    }
  }

  /** Host can set which row to auto-expand (e.g. a just-added row).
   *  The next refresh() scrolls that row into view and focuses its
   *  first input. */
  setLastAddedId(id: string | null): void {
    this.lastAddedId = id;
    this.pendingReveal = !!id;
    this.cd.markForCheck();
  }

  /** Bring the just-added row into view and put the cursor in its first
   *  field. Appended rows land at the end of the list, which may be
   *  beyond the render limit or below the fold — without this the
   *  operator has to scroll down manually after every Add. */
  private revealLastAdded(): void {
    // An active search would hide the new (empty) row entirely.
    if (this.searchControl.value) {
      this.searchControl.setValue('', { emitEvent: false });
    }
    // Make sure the appended row is actually rendered despite the
    // 50-row virtualization window.
    this.renderLimit = Math.max(this.renderLimit, this.keysFormArray.controls.length);
    this.updateFilteredControls();
    // Wait for the row (and its auto-expanded body) to render before
    // scrolling/focusing; the expansion panel animates open.
    setTimeout(() => {
      const row = this.panelRoot.nativeElement
        .querySelector(`[data-key-id="${this.lastAddedId}"]`) as HTMLElement | null;
      if (!row) {
        return;
      }
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const input = row.querySelector(
        'input:not([type="hidden"]):not([disabled]), mat-select') as HTMLElement | null;
      input?.focus({ preventScroll: true });
    }, 150);
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

  onFullscreenToggled(fullscreen: boolean): void {
    this.isFullscreen = fullscreen;
    if (!fullscreen) {
      this.removeFullscreenClass();
      this.updateFilteredControls();
    }
    this.cd.markForCheck();
  }

  private addFullscreenClass(): void {
    // Handles both mat-dialog (`.cdk-overlay-pane`) and Thingsboard
    // popover (`.tb-popover`) hosting — panels are rendered in both
    // depending on the caller.
    const overlay = this.elementRef.nativeElement.closest('.cdk-overlay-pane') as HTMLElement | null;
    const pop = this.elementRef.nativeElement.closest('.tb-popover') as HTMLElement | null;
    const target = overlay ?? pop;
    target?.classList.add('industrial-keys-fullscreen-pane');
  }

  private removeFullscreenClass(): void {
    const overlay = this.elementRef.nativeElement.closest('.cdk-overlay-pane') as HTMLElement | null;
    const pop = this.elementRef.nativeElement.closest('.tb-popover') as HTMLElement | null;
    overlay?.classList.remove('industrial-keys-fullscreen-pane');
    pop?.classList.remove('industrial-keys-fullscreen-pane');
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
    const items = this.keysFormArray.controls.map((c, i) => ({
      control: c as FormGroup,
      index: i,
    }));

    let next = items;
    if (search) {
      next = items.filter(item => this.searchFields.some(f => {
        const v = item.control.get(f)?.value;
        return v != null && String(v).toLowerCase().includes(search);
      }));
    }

    if (this.sortField) {
      const dir = this.sortDirection === 'asc' ? 1 : -1;
      const field = this.sortField;
      next = [...next].sort((a, b) => {
        const av = (a.control.get(field)?.value ?? '').toString().toLowerCase();
        const bv = (b.control.get(field)?.value ?? '').toString().toLowerCase();
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    }

    this.filteredControls = next;
    this.displayedControls = this.filteredControls.slice(0, this.renderLimit);
    this.cd.markForCheck();
  }

  get canWrite(): boolean {
    return !!this.writeHandler?.targets.length && !!this.persistedKeys;
  }

  hasWriteTarget(target: WriteTarget): boolean {
    return !!this.writeHandler?.targets.includes(target);
  }

  isWritten(row: FormGroup): boolean {
    return !!this.writeHandler && this.writeHandler.isWritten(row.getRawValue());
  }

  toggleRow(row: FormGroup): void {
    if (this.selected.has(row)) {
      this.selected.delete(row);
    } else {
      this.selected.add(row);
    }
    this.cd.markForCheck();
  }

  /** The tick box in the bar: ticks every row the search shows, or
   *  clears them all when they are already ticked. */
  get allShownSelected(): boolean {
    return this.filteredControls.length > 0 && this.filteredControls.every(item => this.selected.has(item.control));
  }

  toggleAllShown(): void {
    if (this.allShownSelected) {
      this.selected.clear();
    } else {
      this.filteredControls.forEach(item => this.selected.add(item.control));
    }
    this.cd.markForCheck();
  }

  clearSelection(): void {
    this.selected.clear();
    this.cd.markForCheck();
  }

  addSelectedToWrite(target: WriteTarget): void {
    if (!this.writeHandler || !this.persistedKeys) {
      return;
    }
    const keys = this.persistedKeys();
    const picked = this.keysFormArray.controls
      .map((c, i) => this.selected.has(c as FormGroup) ? keys[i] : undefined)
      .filter(k => k !== undefined);
    this.writeHandler.add(target, picked, added => {
      // The ticked keys are written now: clear the ticks and show the marks.
      if (added) {
        this.selected.clear();
      }
      this.cd.markForCheck();
    });
  }

  private pruneSelection(): void {
    const present = new Set(this.keysFormArray.controls);
    for (const row of [...this.selected]) {
      if (!present.has(row)) {
        this.selected.delete(row);
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

  trackByFilteredItem(_: number, item: { control: FormGroup; index: number }): any {
    const rawId = (item.control.getRawValue() as any)?.id;
    return rawId ?? item.index;
  }

  onAddClicked(): void {
    this.addKeyRequested.emit();
    // The host appends the new row and refreshes synchronously. In spreadsheet
    // mode, scroll to it and focus its first cell so the operator can type
    // straight away (the ViewChild is null outside spreadsheet mode → no-op).
    this.spreadsheetKeys?.focusLastRow();
  }

  /** Spreadsheet import: the host appends one default row per request,
   *  synchronously, and the spreadsheet fills them in afterwards. */
  onAddRowsRequested(count: number): void {
    for (let i = 0; i < count; i++) {
      this.addKeyRequested.emit();
    }
  }

  onDeleteClicked(index: number): void {
    this.deleteKeyRequested.emit(index);
  }

  onCancelClicked(): void {
    this.cancelRequested.emit();
  }

  onApplyClicked(): void {
    this.applyRequested.emit();
  }

  /** Spreadsheet-row delete event forwarded to host — host decides
   *  how to remove (may need to clear side-maps like Modbus's
   *  enableModifiersControlMap). */
  onSpreadsheetDeleteRowsRequested(rows: FormGroup[]): void {
    // Translate FormGroup refs → indices so hosts have a stable way
    // to remove without having to scan themselves. We emit one
    // `deleteKeyRequested` per row, highest-index first so host
    // loops can use `removeAt` without shifting.
    const indices: number[] = [];
    this.keysFormArray.controls.forEach((c, i) => {
      if (rows.includes(c as FormGroup)) indices.push(i);
    });
    for (let i = indices.length - 1; i >= 0; i--) {
      this.deleteKeyRequested.emit(indices[i]);
    }
  }
}
