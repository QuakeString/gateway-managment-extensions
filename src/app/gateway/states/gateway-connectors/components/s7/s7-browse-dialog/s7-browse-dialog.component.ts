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

import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, OnDestroy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FormControl } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { DeviceService } from '@core/public-api';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

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
}

export interface S7BrowseTag {
  name: string;
  type: string;
  accessSequence: string;
}

export interface S7BrowseResult {
  /** New keys: `tag` a telemetry-safe name, `address` the quoted TIA name. */
  keys: { tag: string; address: string }[];
  /** The PLC's certificate fingerprint, when the user chose to pin it. */
  pin?: string;
}

/** The address a browsed name is configured as: its block quoted, so it can never read as an absolute address. */
export function s7TagAddress(name: string): string {
  const end = name.search(/[.[]/);
  return end < 0 ? `"${name}"` : `"${name.slice(0, end)}"${name.slice(end)}`;
}

/** A telemetry key for a browsed name: `Motor.counts[2]` → `Motor_counts_2`. */
export function s7TagKey(name: string): string {
  return name.replace(/[.[\],]+/g, '_').replace(/_+$/, '');
}

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
export class S7BrowseDialogComponent implements OnDestroy {

  loading = false;
  error: string = null;
  plc: string = null;
  tlsVersion: string = null;
  protectionLevel: number = null;
  fingerprint: string = null;
  truncated = false;
  tags: S7BrowseTag[] = [];
  shown: S7BrowseTag[] = [];
  readonly maxShown = 500;
  selected = new Set<string>();
  pin: string = null;
  textSearch = new FormControl('');

  private existing: Set<string>;
  private sub: Subscription;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: S7BrowseDialogData,
    private dialogRef: MatDialogRef<S7BrowseDialogComponent, S7BrowseResult>,
    private deviceService: DeviceService,
    private translate: TranslateService,
    private cd: ChangeDetectorRef,
  ) {
    this.existing = new Set((data.existingAddresses || []).map(a => a.replace(/"/g, '')));
    this.textSearch.valueChanges.subscribe(() => this.filter());
    this.browse();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
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
          this.plc = body.plc ?? null;
        } else {
          this.plc = body.plc ?? null;
          this.tlsVersion = body.tlsVersion ?? null;
          this.protectionLevel = body.protectionLevel ?? null;
          this.fingerprint = body.certificateFingerprint ?? null;
          this.truncated = !!body.truncated;
          this.tags = Array.isArray(body.tags) ? body.tags : [];
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
    const text = (this.textSearch.value || '').trim().toLowerCase();
    const matching = text ? this.tags.filter(t => t.name.toLowerCase().includes(text)) : this.tags;
    this.shown = matching.slice(0, this.maxShown);
    this.cd.markForCheck();
  }

  get matchingCount(): number {
    const text = (this.textSearch.value || '').trim().toLowerCase();
    return text ? this.tags.filter(t => t.name.toLowerCase().includes(text)).length : this.tags.length;
  }

  isExisting(tag: S7BrowseTag): boolean {
    return this.existing.has(tag.name);
  }

  toggle(tag: S7BrowseTag): void {
    if (this.selected.has(tag.name)) {
      this.selected.delete(tag.name);
    } else {
      this.selected.add(tag.name);
    }
    this.cd.markForCheck();
  }

  toggleShown(): void {
    const selectable = this.shown.filter(t => !this.isExisting(t));
    const all = selectable.length > 0 && selectable.every(t => this.selected.has(t.name));
    selectable.forEach(t => all ? this.selected.delete(t.name) : this.selected.add(t.name));
    this.cd.markForCheck();
  }

  get allShownSelected(): boolean {
    const selectable = this.shown.filter(t => !this.isExisting(t));
    return selectable.length > 0 && selectable.every(t => this.selected.has(t.name));
  }

  trackByName(_index: number, tag: S7BrowseTag): string {
    return tag.name;
  }

  pinCertificate(): void {
    this.pin = this.fingerprint;
    this.cd.markForCheck();
  }

  add(): void {
    const keys = Array.from(this.selected).map(name => ({ tag: s7TagKey(name), address: s7TagAddress(name) }));
    this.dialogRef.close({ keys, pin: this.pin ?? undefined });
  }

  cancel(): void {
    this.dialogRef.close(null);
  }
}
