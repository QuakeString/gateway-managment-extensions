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

import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, Inject, OnDestroy, ViewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FormControl } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { DeviceService } from '@core/public-api';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { MatTableDataSource } from '@angular/material/table';
import { MatSort } from '@angular/material/sort';
import { MatPaginator } from '@angular/material/paginator';

export interface S7BrowseConnection {
  host: string;
  port: number;
  tls: { enabled: boolean; caCertificate?: string; certificateFingerprint?: string };
  password?: string;
  username?: string;
}

export interface S7BrowseDialogData {
  gatewayDeviceId: string;
  connectorName: string;
  connection: S7BrowseConnection;
  /** Addresses already configured, shown as added. */
  existingAddresses: string[];
  /** Which list the chosen tags are added to. */
  targetCategory?: S7BrowseTarget;
}

export type S7BrowseTarget = 'timeseries' | 'attributes' | 'attributeUpdates' | 'rpc';

/** What an RPC entry does with its tag: read it, write it, or both (a get_ and a set_ method). */
export type S7RpcMode = 'get' | 'set' | 'both';

export interface S7BrowseTag {
  name: string;
  type: string;
  accessSequence: string;
}

export interface S7BrowseResult {
  /** New keys: `tag` the name as TIA Portal shows it, `address` the quoted TIA name. */
  keys: { tag: string; address: string }[];
  /** New RPC methods, for the `rpc` target. */
  rpc?: { method: string; address: string; operation: 'read' | 'write' }[];
  /** The PLC's certificate fingerprint, when the user chose to pin it. */
  pin?: string;
}

/** The address a browsed name is configured as: its block quoted, so it can never read as an absolute address. */
export function s7TagAddress(name: string): string {
  const end = name.search(/[.[]/);
  return end < 0 ? `"${name}"` : `"${name.slice(0, end)}"${name.slice(end)}`;
}

/** The process-image areas the PLC names its I, Q and M tags under. */
const S7_AREA_PREFIX = /^(IArea|QArea|MArea)\./;

/** An input is rewritten from the process image every scan: a write to it is lost. */
export function s7TagReadOnly(name: string): boolean {
  return name.startsWith('IArea.');
}

/**
 * The telemetry key for a browsed name: the name as TIA Portal shows it,
 * without the quotes, and without the area for an input, output or marker
 * (`IArea.Valve_open` → `Valve_open`, `Motor_DB.counts[2]` unchanged).
 */
export function s7TagKey(name: string): string {
  return name.replace(S7_AREA_PREFIX, '');
}

/** The dialog's size: fixed, so it does not grow and shrink with the search result. */
export const S7_BROWSE_DIALOG_SIZE = { width: 'min(960px, 95vw)', height: '80vh' };

/**
 * Lists an S7-1200/1500's tags over S7CommPlus (the gateway's `s7_browse`)
 * and adds the chosen ones to the device as keys.
 */
@Component({
  selector: 'tb-s7-browse-dialog',
  templateUrl: './s7-browse-dialog.component.html',
  styleUrls: ['./s7-browse-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule],
})
export class S7BrowseDialogComponent implements AfterViewInit, OnDestroy {

  loading = false;
  error: string = null;
  fingerprint: string = null;
  truncated = false;
  readonly dataSource = new MatTableDataSource<S7BrowseTag>([]);
  readonly pageSizes = [100, 250, 500, 1000];
  displayedColumns = ['select', 'name', 'type', 'block'];
  targetCategory: S7BrowseTarget;
  /** RPC target: the mode new selections take, and the ones changed per tag. */
  rpcBulkMode: S7RpcMode = 'both';
  private rpcModes = new Map<string, S7RpcMode>();
  selected = new Set<string>();
  pin: string = null;
  textSearch = new FormControl('');
  searchOpen = false;
  fullscreen = false;
  /** Every filtered tag that can still be added is selected / some are. */
  allSelected = false;
  someSelected = false;

  @ViewChild(MatSort) set sort(sort: MatSort) {
    this.dataSource.sort = sort;
  }
  @ViewChild(MatPaginator) set paginator(paginator: MatPaginator) {
    this.dataSource.paginator = paginator;
  }
  @ViewChild('searchInput') searchInput: ElementRef<HTMLInputElement>;

  private existing: Set<string>;
  private sub: Subscription;
  private searchSub: Subscription;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: S7BrowseDialogData,
    private dialogRef: MatDialogRef<S7BrowseDialogComponent, S7BrowseResult>,
    private deviceService: DeviceService,
    private translate: TranslateService,
    private cd: ChangeDetectorRef,
  ) {
    this.existing = new Set((data.existingAddresses || []).map(a => a.replace(/"/g, '')));
    this.targetCategory = data.targetCategory || 'timeseries';
    if (this.targetCategory === 'rpc') {
      this.displayedColumns = ['select', 'name', 'rpcMode', 'type', 'block'];
    }
    this.dataSource.filterPredicate = (tag, text) => tag.name.toLowerCase().includes(text);
    // Natural order, so member_2 comes before member_10.
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    this.dataSource.sortData = (tags, sort) => {
      if (!sort.active || !sort.direction) {
        return tags;
      }
      const key = (tag: S7BrowseTag) => sort.active === 'block' ? this.blockOf(tag) : tag[sort.active] ?? '';
      const sign = sort.direction === 'asc' ? 1 : -1;
      return [...tags].sort((a, b) => sign * (collator.compare(key(a), key(b)) || collator.compare(a.name, b.name)));
    };
    this.searchSub = this.textSearch.valueChanges.pipe(debounceTime(150)).subscribe(() => this.filter());
    this.browse();
  }

  ngAfterViewInit(): void {
    this.cd.markForCheck();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.searchSub?.unsubscribe();
  }

  browse(): void {
    this.sub?.unsubscribe();
    this.loading = true;
    this.error = null;
    this.cd.markForCheck();
    const rpcBody = {
      method: 's7_browse',
      params: { ...this.data.connection, connectorName: this.data.connectorName },
      // A large program's type information takes seconds to send.
      timeout: 90000,
    };
    this.sub = this.deviceService.sendTwoWayRpcCommand(this.data.gatewayDeviceId, rpcBody).subscribe({
      next: (response: any) => {
        const body = response?.result ?? response ?? {};
        this.loading = false;
        if (body.success === false || body.code === 404) {
          this.error = body.error?.includes('no running connector')
            ? this.translate.instant('gateway.s7plus.connector-not-running')
            : body.error || this.translate.instant('gateway.s7plus.browse-failed');
        } else {
          this.fingerprint = body.certificateFingerprint ?? null;
          this.truncated = !!body.truncated;
          this.dataSource.data = Array.isArray(body.tags) ? body.tags : [];
          this.filter();
        }
        this.cd.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.error = this.translate.instant('gateway.s7plus.gateway-unreachable');
        this.cd.markForCheck();
      },
    });
  }

  filter(): void {
    this.dataSource.filter = (this.textSearch.value || '').trim().toLowerCase();
    this.dataSource.paginator?.firstPage();
    this.refreshSelection();
  }

  openSearch(): void {
    this.searchOpen = true;
    this.cd.markForCheck();
    setTimeout(() => this.searchInput?.nativeElement.focus());
  }

  closeSearch(): void {
    this.searchOpen = false;
    this.textSearch.setValue('');
  }

  toggleFullscreen(): void {
    this.fullscreen = !this.fullscreen;
    if (this.fullscreen) {
      this.dialogRef.updateSize('100vw', '100vh');
    } else {
      this.dialogRef.updateSize(S7_BROWSE_DIALOG_SIZE.width, S7_BROWSE_DIALOG_SIZE.height);
    }
    this.cd.markForCheck();
  }

  get matchingCount(): number {
    return this.dataSource.filteredData.length;
  }

  isExisting(tag: S7BrowseTag): boolean {
    return this.existing.has(tag.name);
  }

  isReadOnly(tag: S7BrowseTag): boolean {
    return s7TagReadOnly(tag.name);
  }

  /** Attribute updates write the tag, so a read-only one cannot be picked. */
  isBlocked(tag: S7BrowseTag): boolean {
    return this.targetCategory === 'attributeUpdates' && s7TagReadOnly(tag.name);
  }

  /** A tag that cannot be picked: already in the list, or not writable here. */
  isUnavailable(tag: S7BrowseTag): boolean {
    return this.isExisting(tag) || this.isBlocked(tag);
  }

  get titleKey(): string {
    return {
      timeseries: 'gateway.gw-timeseries',
      attributes: 'gateway.attributes',
      attributeUpdates: 'gateway.gw-attribute-updates',
      rpc: 'gateway.gw-rpc-methods',
    }[this.targetCategory];
  }

  rpcModeOf(tag: S7BrowseTag): S7RpcMode {
    return s7TagReadOnly(tag.name) ? 'get' : this.rpcModes.get(tag.name) ?? this.rpcBulkMode;
  }

  setRpcMode(tag: S7BrowseTag, mode: S7RpcMode): void {
    this.rpcModes.set(tag.name, mode);
    this.cd.markForCheck();
  }

  /** The header choice applies to every tag not changed on its own row. */
  setRpcBulkMode(mode: S7RpcMode): void {
    this.rpcBulkMode = mode;
    this.rpcModes.clear();
    this.cd.markForCheck();
  }

  toggle(tag: S7BrowseTag): void {
    if (this.selected.has(tag.name)) {
      this.selected.delete(tag.name);
    } else {
      this.selected.add(tag.name);
    }
    this.refreshSelection();
  }

  /** Selects or clears every tag the search matches, on all pages. */
  toggleAll(): void {
    const select = !this.allSelected;
    for (const t of this.dataSource.filteredData) {
      if (!this.isUnavailable(t)) {
        select ? this.selected.add(t.name) : this.selected.delete(t.name);
      }
    }
    this.refreshSelection();
  }

  private refreshSelection(): void {
    let selectable = 0;
    let chosen = 0;
    for (const t of this.dataSource.filteredData) {
      if (!this.isUnavailable(t)) {
        selectable++;
        if (this.selected.has(t.name)) {
          chosen++;
        }
      }
    }
    this.allSelected = selectable > 0 && chosen === selectable;
    this.someSelected = chosen > 0 && !this.allSelected;
    this.cd.markForCheck();
  }

  trackByName(_index: number, tag: S7BrowseTag): string {
    return tag.name;
  }

  /** The data block or area a tag belongs to: the name before the first dot. */
  blockOf(tag: S7BrowseTag): string {
    const end = tag.name.search(/[.[]/);
    return end < 0 ? tag.name : tag.name.slice(0, end);
  }

  /** Pins the PLC's certificate, or takes the pin back. */
  togglePin(): void {
    this.pin = this.pin ? null : this.fingerprint;
    this.cd.markForCheck();
  }

  add(): void {
    const names = Array.from(this.selected);
    if (this.targetCategory === 'rpc') {
      // As the OPC UA browser names them: get_<key> reads, set_<key> writes.
      const rpc: S7BrowseResult['rpc'] = [];
      for (const name of names) {
        const mode = this.rpcModeOf({ name } as S7BrowseTag);
        const key = s7TagKey(name);
        const address = s7TagAddress(name);
        if (mode !== 'set') {
          rpc.push({ method: `get_${key}`, address, operation: 'read' });
        }
        if (mode !== 'get') {
          rpc.push({ method: `set_${key}`, address, operation: 'write' });
        }
      }
      this.dialogRef.close({ keys: [], rpc, pin: this.pin ?? undefined });
      return;
    }
    const keys = names.map(name => ({ tag: s7TagKey(name), address: s7TagAddress(name) }));
    this.dialogRef.close({ keys, pin: this.pin ?? undefined });
  }

  cancel(): void {
    this.dialogRef.close(null);
  }
}
