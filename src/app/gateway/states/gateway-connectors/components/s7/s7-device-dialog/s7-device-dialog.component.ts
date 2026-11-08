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
  DestroyRef,
  Inject,
  Renderer2,
  ViewContainerRef,
  inject,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { createKeysWriteHandler } from '../../../../../shared/components/add-to-write/add-to-write.handler';
import { s7Adapter } from '../../../../../shared/components/add-to-write/write-adapters';
import { FormBuilder, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { DialogComponent, SharedModule } from '@shared/public-api';
import { Store } from '@ngrx/store';
import { AppState } from '@core/public-api';
import { Router } from '@angular/router';
import { MatButton } from '@angular/material/button';
import { TbPopoverService } from '@shared/components/popover.service';
import { TbPopoverComponent } from '@shared/components/popover.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DeviceProfileNameAutocompleteComponent, EllipsisChipListDirective } from '../../../../../shared/public-api';
import { S7DataKey, S7DeviceConfig, S7PlcModel, S7Protocol, S7RedundancyConfig, S7RpcConfig, S7ValueKey, S7_PLUS_CAPABLE_MODELS, S7_REDUNDANCY_CAPABLE_MODELS } from '../../../models/public-api';
import { S7BrowseDialogComponent, S7BrowseDialogData, S7BrowseResult } from '../s7-browse-dialog/s7-browse-dialog.component';
import { S7DataKeysPanelComponent } from '../s7-data-keys-panel/s7-data-keys-panel.component';
import { TimeSyncDialogComponent } from '../../../../../shared/components/time-sync-dialog/time-sync-dialog.component';

export interface S7DeviceDialogData {
  device?: S7DeviceConfig;
  isEdit: boolean;
  gatewayDeviceId?: string;
  connectorName?: string;
}

@Component({
  selector: 'tb-s7-device-dialog',
  templateUrl: './s7-device-dialog.component.html',
  styleUrls: ['./s7-device-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    EllipsisChipListDirective,
    DeviceProfileNameAutocompleteComponent,
  ],
})
export class S7DeviceDialogComponent extends DialogComponent<S7DeviceDialogComponent, S7DeviceConfig> {

  readonly plcModels = Object.values(S7PlcModel);
  readonly S7ValueKey = S7ValueKey;
  readonly S7Protocol = S7Protocol;
  isEdit: boolean;
  keysPopupClosed = true;
  supportsRedundancy = false;

  deviceForm = this.fb.group({
    deviceName: ['', [Validators.required]],
    deviceType: ['default'],
    host: ['', [Validators.required]],
    port: [102, [Validators.required, Validators.min(1), Validators.max(65535)]],
    rack: [0, [Validators.required, Validators.min(0)]],
    slot: [1, [Validators.required, Validators.min(0)]],
    model: [S7PlcModel.S7_1200, [Validators.required]],
    pollPeriod: [5000, [Validators.required, Validators.min(100)]],
    connectAttemptCount: [3, [Validators.required, Validators.min(1)]],
    waitAfterFailedAttemptsMs: [300000, [Validators.required]],
    redundancy: this.fb.group({
      enabled: [false],
      standbyHost: [''],
      standbyPort: [102, [Validators.min(1), Validators.max(65535)]],
      standbyRack: [0, [Validators.min(0)]],
      standbySlot: [1, [Validators.min(0)]],
      heartbeatIntervalMs: [500, [Validators.min(100), Validators.max(10000)]],
      heartbeatTimeoutMs: [300, [Validators.min(50), Validators.max(5000)]],
      failureThreshold: [2, [Validators.min(1), Validators.max(10)]],
    }),
    timeSync: this.fb.group({
      enabled: [false],
      intervalSec: [300, [Validators.min(10)]],
      verified: [false],
    }),
    timeseries: [[] as S7DataKey[]],
    attributes: [[] as S7DataKey[]],
    attributeUpdates: [[] as S7DataKey[]],
    rpc: [[] as S7RpcConfig[]],
    // S7CommPlus for the S7-1200/1500 unless the device says otherwise.
    protocol: [S7Protocol.S7COMMPLUS as S7Protocol],
    tls: this.fb.group({
      enabled: [true],
      caCertificate: [''],
      certificateFingerprint: [''],
    }),
    password: [''],
    username: [''],
    subscriptionCycleMs: [100, [Validators.min(10), Validators.max(60000)]],
    programCheckMs: [30000, [Validators.min(1000)]],
    engineeringSession: [false],
  });

  private popoverComponent: TbPopoverComponent<S7DataKeysPanelComponent>;

  private readonly writeDialog = inject(MatDialog);

  constructor(
    protected store: Store<AppState>,
    protected router: Router,
    @Inject(MAT_DIALOG_DATA) public data: S7DeviceDialogData,
    public dialogRef: MatDialogRef<S7DeviceDialogComponent, S7DeviceConfig>,
    private fb: FormBuilder,
    private popoverService: TbPopoverService,
    private renderer: Renderer2,
    private viewContainerRef: ViewContainerRef,
    private destroyRef: DestroyRef,
    private cdr: ChangeDetectorRef,
    private matDialog: MatDialog,
  ) {
    super(store, router, dialogRef);
    this.isEdit = data.isEdit;
    if (data.device) {
      this.deviceForm.patchValue(data.device as any, { emitEvent: false });
      // A saved device without a protocol was made before S7CommPlus and
      // reads over PUT/GET; it keeps doing so.
      if (!data.device.protocol) {
        this.deviceForm.get('protocol').setValue(S7Protocol.S7COMM, { emitEvent: false });
      }
    }

    // Track whether current model supports redundancy
    this._updateRedundancySupport(this.deviceForm.get('model').value as S7PlcModel);
    this.deviceForm.get('model').valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((model: S7PlcModel) => {
        this._updateRedundancySupport(model);
        // The protocol follows the model: S7CommPlus for an S7-1200/1500,
        // S7comm for everything older.
        this.deviceForm
          .get('protocol')
          .setValue(S7_PLUS_CAPABLE_MODELS.has(model) ? S7Protocol.S7COMMPLUS : S7Protocol.S7COMM);
        this.cdr.markForCheck();
      });
    this.deviceForm.get('protocol').valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.cdr.markForCheck());

    // When redundancy is toggled off, clear standbyHost to avoid stale config
    this.deviceForm.get('redundancy.enabled').valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((enabled: boolean) => {
        if (!enabled) {
          this.deviceForm.get('redundancy.standbyHost').setValue('');
        }
        this.cdr.markForCheck();
      });
  }

  /** The model can speak S7CommPlus (S7-1200, S7-1500). */
  get plusCapable(): boolean {
    return S7_PLUS_CAPABLE_MODELS.has(this.deviceForm.get('model').value as S7PlcModel);
  }

  /** This device is read over S7CommPlus. */
  get isPlus(): boolean {
    return this.plusCapable && this.deviceForm.get('protocol').value === S7Protocol.S7COMMPLUS;
  }

  get canBrowse(): boolean {
    return !!(this.data.gatewayDeviceId && this.data.connectorName && this.deviceForm.get('host').value);
  }

  get browseHint(): string {
    return this.data.gatewayDeviceId && this.data.connectorName
      ? 'gateway.s7plus.browse-hint'
      : 'gateway.s7plus.save-connector-first';
  }

  openBrowse(): void {
    if (!this.canBrowse) {
      return;
    }
    const v = this.deviceForm.value as any;
    const existing = [...(v.timeseries || []), ...(v.attributes || [])].map((k: S7DataKey) => k.address);
    this.matDialog.open<S7BrowseDialogComponent, S7BrowseDialogData, S7BrowseResult>(S7BrowseDialogComponent, {
      disableClose: true,
      autoFocus: false,
      panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
      data: {
        gatewayDeviceId: this.data.gatewayDeviceId,
        connectorName: this.data.connectorName,
        connection: {
          host: v.host,
          port: v.port,
          tls: v.tls,
          password: v.password || undefined,
          username: v.username || undefined,
        },
        existingAddresses: existing,
      },
    }).afterClosed().subscribe(result => {
      if (!result) {
        return;
      }
      if (result.keys?.length) {
        const control = this.deviceForm.get(S7ValueKey.TIMESERIES);
        const current: S7DataKey[] = control.value || [];
        control.setValue([...current, ...result.keys.map(k => ({ tag: k.tag, address: k.address }) as S7DataKey)]);
        control.markAsDirty();
      }
      if (result.pin) {
        this.deviceForm.get('tls.certificateFingerprint').setValue(result.pin);
        this.deviceForm.get('tls.certificateFingerprint').markAsDirty();
      }
      this.cdr.markForCheck();
    });
  }

  private _updateRedundancySupport(model: S7PlcModel): void {
    this.supportsRedundancy = S7_REDUNDANCY_CAPABLE_MODELS.has(model);
    if (!this.supportsRedundancy) {
      this.deviceForm.get('redundancy.enabled').setValue(false, { emitEvent: false });
    }
  }

  cancel(): void {
    if (this.keysPopupClosed) {
      this.dialogRef.close(null);
    }
  }

  save(): void {
    if (this.deviceForm.valid) {
      const result = this.deviceForm.value as unknown as S7DeviceConfig;
      // S7CommPlus settings only for an S7CommPlus device, empty ones left out.
      if (this.isPlus) {
        const tls: any = result.tls || {};
        if (!tls.caCertificate) {
          delete tls.caCertificate;
        }
        if (!tls.certificateFingerprint) {
          delete tls.certificateFingerprint;
        }
        if (!result.password) {
          delete result.password;
        }
        if (!result.username) {
          delete result.username;
        }
        // The gateway's defaults are not written out.
        if (!result.subscriptionCycleMs || result.subscriptionCycleMs === 100) {
          delete result.subscriptionCycleMs;
        }
        if (!result.programCheckMs || result.programCheckMs === 30000) {
          delete result.programCheckMs;
        }
        if (!result.engineeringSession) {
          delete result.engineeringSession;
        }
        delete result.redundancy;
        delete result.timeSync;
      } else {
        delete result.protocol;
        delete result.tls;
        delete result.password;
        delete result.username;
        delete result.subscriptionCycleMs;
        delete result.programCheckMs;
        delete result.engineeringSession;
      }
      // Strip redundancy config if not enabled to keep JSON clean
      if (!result.redundancy?.enabled) {
        delete result.redundancy;
      }
      // Drop the timeSync block entirely when disabled — but keep the verified flag
      // so reopening the dialog still lets the user re-enable auto sync without another manual read.
      const ts: any = result.timeSync;
      if (ts && !ts.enabled && !ts.verified) {
        delete result.timeSync;
      } else if (ts && !ts.enabled) {
        (result as any).timeSync = { enabled: false, verified: true };
      }
      this.dialogRef.close(result);
    }
  }

  get canSyncTimeNow(): boolean {
    return !!(this.data.gatewayDeviceId && this.data.connectorName
              && this.deviceForm.get('deviceName').value);
  }

  get isTimeSyncVerified(): boolean {
    return !!this.deviceForm.get('timeSync.verified')?.value;
  }

  openTimeSyncDialog(): void {
    if (!this.canSyncTimeNow) return;
    this.matDialog.open(TimeSyncDialogComponent, {
      disableClose: true,
      autoFocus: false,
      width: '560px',
      data: {
        gatewayDeviceId: this.data.gatewayDeviceId,
        connectorName: this.data.connectorName,
        deviceName: this.deviceForm.get('deviceName').value,
        connectorType: 's7',
      },
    }).afterClosed().subscribe((synced: boolean) => {
      if (synced) {
        this.deviceForm.get('timeSync.verified').setValue(true);
        this.deviceForm.get('timeSync.verified').markAsDirty();
        this.cdr.markForCheck();
      }
    });
  }

  manageKeys($event: Event, matButton: MatButton, keysType: S7ValueKey): void {
    $event?.stopPropagation();
    if (this.popoverComponent && !this.popoverComponent.tbHidden) {
      this.popoverComponent.hide();
    }
    const trigger = matButton._elementRef.nativeElement;
    if (this.popoverService.hasPopover(trigger)) {
      this.popoverService.hidePopover(trigger);
      return;
    }

    const keysControl = this.deviceForm.get(keysType);
    const panelTitles = {
      [S7ValueKey.TIMESERIES]: 'gateway.gw-timeseries',
      [S7ValueKey.ATTRIBUTES]: 'gateway.attributes',
      [S7ValueKey.ATTRIBUTES_UPDATES]: 'gateway.gw-attribute-updates',
      [S7ValueKey.RPC]: 'gateway.gw-rpc-methods',
    };
    const ctx = {
      keys: keysControl.value,
      keysType,
      panelTitle: panelTitles[keysType],
      // Standardized: data keys → "Add key"; RPC → "Add method".
      addKeyTitle: keysType === S7ValueKey.RPC ? 'gateway.gw-add-method' : 'gateway.gw-add-key',
      deleteKeyTitle: 'gateway.gw-delete-key',
      noKeysText: 'gateway.gw-no-keys-configured-hint',
      symbolic: this.isPlus,
    };
    if (keysType === S7ValueKey.TIMESERIES || keysType === S7ValueKey.ATTRIBUTES) {
      (ctx as any).writeHandler = createKeysWriteHandler({
        dialog: this.writeDialog,
        adapter: s7Adapter(),
        controls: {
          rpc: this.deviceForm.get(S7ValueKey.RPC),
          attributeUpdates: this.deviceForm.get(S7ValueKey.ATTRIBUTES_UPDATES),
        },
        changed: () => this.cdr.markForCheck(),
      });
    }
    this.keysPopupClosed = false;
    this.popoverComponent = this.popoverService.displayPopover(
      trigger,
      this.renderer,
      this.viewContainerRef,
      S7DataKeysPanelComponent,
      'leftTop',
      false,
      null,
      ctx,
      {},
      {},
      {},
      true
    );
    this.popoverComponent.tbComponentRef.instance.keysDataApplied
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((keysData: Array<S7DataKey | S7RpcConfig>) => {
        this.popoverComponent.hide();
        keysControl.patchValue(keysData as any);
        keysControl.markAsDirty();
        this.cdr.markForCheck();
      });
    this.popoverComponent.tbComponentRef.instance.cancelled
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.popoverComponent.hide();
      });
    this.popoverComponent.tbHideStart
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.keysPopupClosed = true;
      });
  }
}
