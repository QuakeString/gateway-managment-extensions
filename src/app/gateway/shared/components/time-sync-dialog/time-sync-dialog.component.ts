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
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogComponent, SharedModule } from '@shared/public-api';
import { Store } from '@ngrx/store';
import { AppState } from '@core/public-api';
import { Router } from '@angular/router';
import { DeviceService } from '@core/public-api';
import { TranslateService } from '@ngx-translate/core';

export interface TimeSyncDialogData {
  gatewayDeviceId: string;
  connectorName: string;
  deviceName: string;
  /** Connector type: 's7' | 'iec61850' | 'ethernet_ip' — used as RPC method prefix */
  connectorType: string;
}

interface TimeInfoResult {
  success?: boolean;
  // Legacy UTC-labeled fields (IEC 61850 returns these as real UTC)
  systemTimeUtc?: string;
  deviceTimeUtc?: string;
  // Local-time fields (S7 / EthernetIP return these — PLC stores local wall clock)
  systemTime?: string;
  deviceTime?: string;
  /** Populated when the PLC does not expose its clock (e.g. S7-300 0xd402). */
  deviceTimeError?: string;
  error?: string;
}

@Component({
  selector: 'tb-time-sync-dialog',
  templateUrl: './time-sync-dialog.component.html',
  styleUrls: ['./time-sync-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, FormsModule, SharedModule],
})
export class TimeSyncDialogComponent extends DialogComponent<TimeSyncDialogComponent, boolean> implements OnDestroy {

  loading = false;
  syncing = false;
  error: string | null = null;
  info: TimeInfoResult | null = null;

  /** When true Apply pushes the gateway's current system time; otherwise it pushes `customDate` + `customTime`. */
  useSystemTime = true;
  /** "YYYY-MM-DD" bound to the date input — preloaded from the PLC's current clock. */
  customDate = '';
  /** "HH:MM:SS" bound to the time input. */
  customTime = '';

  /** Offset (ms) added to `Date.now()` to get the gateway's wall clock.
   *  Set once on refresh, then the ticker projects forward — this keeps the displayed
   *  clocks rolling like Simatic Manager so the time user sees at Apply matches what
   *  the gateway actually sends to the PLC. */
  private gatewayClockOffsetMs = 0;
  /** Same idea, for the PLC's wall clock (not kept in sync with the gateway after open). */
  private deviceClockOffsetMs = 0;
  private systemIsUtc = false;
  private deviceIsUtc = false;

  /** Ticks once a second to re-render projected system/device times. */
  private tickerId: ReturnType<typeof setInterval> | null = null;

  /** True once we've successfully read the PLC clock — caller uses this to gate auto-sync. */
  private readSucceeded = false;

  constructor(
    protected store: Store<AppState>,
    protected router: Router,
    @Inject(MAT_DIALOG_DATA) public data: TimeSyncDialogData,
    public dialogRef: MatDialogRef<TimeSyncDialogComponent, boolean>,
    private deviceService: DeviceService,
    private cd: ChangeDetectorRef,
    private translate: TranslateService,
  ) {
    super(store, router, dialogRef);
    // Report readSucceeded on ESC/backdrop too — caller uses it to gate auto-sync.
    this.dialogRef.keydownEvents().subscribe((e) => {
      if (e.key === 'Escape') this.close();
    });
    this.dialogRef.backdropClick().subscribe(() => this.close());
    this.refresh();
  }

  ngOnDestroy(): void {
    this.stopTicker();
  }

  private buildMethod(name: 'getTimeInfo' | 'syncTime'): string {
    const prefix = this.data.connectorType ? `${this.data.connectorType}_` : '';
    return `${prefix}${name}`;
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.cd.markForCheck();

    const rpcBody = {
      method: this.buildMethod('getTimeInfo'),
      params: {
        deviceName: this.data.deviceName || '',
      },
      timeout: 10000,
    };

    this.deviceService.sendTwoWayRpcCommand(this.data.gatewayDeviceId, rpcBody).subscribe({
      next: (result: any) => {
        const body: TimeInfoResult = result?.result ?? result ?? {};
        this.info = body;
        if (body?.success === false) {
          this.error = body.error || this.translate.instant('gateway.timesync-failed-read');
        }

        // Establish clock offsets so the display can tick forward.
        const browserNow = Date.now();
        const sysIso = body.systemTimeUtc || body.systemTime;
        if (sysIso) {
          this.systemIsUtc = !!body.systemTimeUtc;
          const sysMs = this.isoToEpochMs(sysIso, this.systemIsUtc);
          if (sysMs !== null) this.gatewayClockOffsetMs = sysMs - browserNow;
        }

        if (body?.deviceTimeUtc || body?.deviceTime) {
          this.readSucceeded = true;
          this.deviceIsUtc = !!body.deviceTimeUtc;
          const devIso = body.deviceTimeUtc || body.deviceTime || '';
          const devMs = this.isoToEpochMs(devIso, this.deviceIsUtc);
          if (devMs !== null) this.deviceClockOffsetMs = devMs - browserNow;
          const parts = this.splitIso(devIso, this.deviceIsUtc);
          this.customDate = parts.date;
          this.customTime = parts.time;
        }

        this.loading = false;
        this.cd.markForCheck();
        this.startTicker();
      },
      error: () => {
        this.loading = false;
        this.error = this.translate.instant('gateway.timesync-could-not-reach');
        this.cd.markForCheck();
      },
    });
  }

  apply(): void {
    this.syncing = true;
    this.error = null;
    this.cd.markForCheck();

    const params: Record<string, unknown> = { deviceName: this.data.deviceName || '' };

    if (this.useSystemTime) {
      // Send the live projected gateway wall clock — matches what the user sees ticking.
      const liveSystemMs = Date.now() + this.gatewayClockOffsetMs;
      params.targetDateTime = this.epochMsToNaiveIso(liveSystemMs, this.systemIsUtc);
    } else if (this.customDate && this.customTime) {
      // Build a naive "YYYY-MM-DDTHH:MM:SS" from the two inputs. The gateway interprets
      // this as local time for S7 / UTC for IEC 61850, matching how each protocol stores time —
      // the user is editing the same wall clock the picker showed, so no conversion is needed.
      const t = this.customTime.length === 5 ? `${this.customTime}:00` : this.customTime;
      params.targetDateTime = `${this.customDate}T${t}`;
    }

    const rpcBody = {
      method: this.buildMethod('syncTime'),
      params,
      timeout: 10000,
    };

    this.deviceService.sendTwoWayRpcCommand(this.data.gatewayDeviceId, rpcBody).subscribe({
      next: (result: any) => {
        const body: any = result?.result ?? result ?? {};
        if (body?.success) {
          this.refresh();
        } else {
          this.error = body.error || this.translate.instant('gateway.timesync-failed');
        }
        this.syncing = false;
        this.cd.markForCheck();
      },
      error: () => {
        this.syncing = false;
        this.error = this.translate.instant('gateway.timesync-failed-unreachable');
        this.cd.markForCheck();
      },
    });
  }

  close(): void {
    this.stopTicker();
    this.dialogRef.close(this.readSucceeded);
  }

  get deviceTimeDisplay(): string {
    if (!this.info) return '—';
    if (this.info.deviceTimeError) return `Not available — ${this.info.deviceTimeError}`;
    if (!this.deviceTimeAvailable) return '—';
    const iso = this.epochMsToNaiveIso(Date.now() + this.deviceClockOffsetMs, this.deviceIsUtc);
    return this.formatIso(iso, this.deviceIsUtc);
  }

  get deviceTimeAvailable(): boolean {
    return !!(this.info?.deviceTimeUtc || this.info?.deviceTime);
  }

  get systemTimeDisplay(): string {
    if (!this.info) return '—';
    const iso = this.epochMsToNaiveIso(Date.now() + this.gatewayClockOffsetMs, this.systemIsUtc);
    return this.formatIso(iso, this.systemIsUtc);
  }

  /** Device offset minus gateway offset — computed from the single initial snapshot. */
  private get driftSeconds(): number | null {
    if (!this.deviceTimeAvailable) return null;
    return Math.round((this.deviceClockOffsetMs - this.gatewayClockOffsetMs) / 1000);
  }

  get driftDisplay(): string {
    const s = this.driftSeconds;
    if (s === null) return '—';
    const sign = s >= 0 ? '+' : '';
    return `${sign}${s} s`;
  }

  get driftBehind(): boolean {
    return (this.driftSeconds ?? 0) < 0;
  }

  get driftIsLarge(): boolean {
    // PLC clocks have 1-second resolution, so anything over 1 s is a meaningful drift.
    return Math.abs(this.driftSeconds ?? 0) > 1;
  }

  private startTicker(): void {
    if (this.tickerId) return;
    this.tickerId = setInterval(() => this.cd.markForCheck(), 1000);
  }

  private stopTicker(): void {
    if (this.tickerId) {
      clearInterval(this.tickerId);
      this.tickerId = null;
    }
  }

  /**
   * Format an ISO datetime as "YYYY-MM-DD   HH:MM:SS.mmm AM/PM [UTC]"
   */
  private formatIso(iso?: string | null, isUtc: boolean = false): string {
    if (!iso) return '—';

    let yyyy: number, month: number, day: number, h24: number, min: number, sec: number, ms: number;
    let hasSubsecond = false;

    if (isUtc) {
      const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
      if (isNaN(d.getTime())) return iso;
      yyyy = d.getUTCFullYear();
      month = d.getUTCMonth() + 1;
      day = d.getUTCDate();
      h24 = d.getUTCHours();
      min = d.getUTCMinutes();
      sec = d.getUTCSeconds();
      ms = d.getUTCMilliseconds();
      hasSubsecond = /\.\d+/.test(iso);
    } else {
      const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/);
      if (!m) return iso;
      yyyy = +m[1]; month = +m[2]; day = +m[3];
      h24 = +m[4]; min = +m[5]; sec = +m[6];
      ms = m[7] ? Math.floor(+`0.${m[7]}` * 1000) : 0;
      hasSubsecond = !!m[7];
    }

    const ampm = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 || 12;
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const pad3 = (n: number) => String(n).padStart(3, '0');
    const suffix = isUtc ? ' UTC' : '';
    const subSec = hasSubsecond ? `.${pad3(ms)}` : '';

    return `${yyyy}-${pad2(month)}-${pad2(day)}   ${pad2(h12)}:${pad2(min)}:${pad2(sec)}${subSec} ${ampm}${suffix}`;
  }

  /** Parse an ISO (with or without 'Z') to epoch ms.
   *  For naive local strings, interpret the components as browser-local wall clock. */
  private isoToEpochMs(iso: string, isUtc: boolean): number | null {
    if (!iso) return null;
    if (isUtc) {
      const t = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
      return isNaN(t) ? null : t;
    }
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }

  /** Convert epoch ms back to a naive "YYYY-MM-DDTHH:MM:SS" string — UTC components
   *  when the protocol labels the time as UTC, local wall clock otherwise. */
  private epochMsToNaiveIso(ms: number, asUtc: boolean): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    if (asUtc) {
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T`
           + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    }
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T`
         + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  /** Split a device-time ISO into the two pieces the date/time inputs expect.
   *  For UTC-labeled ISOs, show UTC components; for naive local ISOs, keep literal. */
  private splitIso(iso: string, isUtc: boolean): { date: string; time: string } {
    if (!iso) return { date: '', time: '' };
    const pad = (n: number) => String(n).padStart(2, '0');
    if (isUtc) {
      const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
      if (isNaN(d.getTime())) return { date: '', time: '' };
      return {
        date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
        time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
      };
    }
    const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
    return m ? { date: m[1], time: m[2] } : { date: '', time: '' };
  }
}
