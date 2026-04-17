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
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
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
import { S7DataKey, S7DeviceConfig, S7PlcModel, S7RedundancyConfig, S7RpcConfig, S7ValueKey, S7_REDUNDANCY_CAPABLE_MODELS } from '../../../models/public-api';
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
  });

  private popoverComponent: TbPopoverComponent<S7DataKeysPanelComponent>;

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
    }

    // Track whether current model supports redundancy
    this._updateRedundancySupport(this.deviceForm.get('model').value as S7PlcModel);
    this.deviceForm.get('model').valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((model: S7PlcModel) => {
        this._updateRedundancySupport(model);
        this.cdr.markForCheck();
      });

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
      [S7ValueKey.TIMESERIES]: 'Timeseries',
      [S7ValueKey.ATTRIBUTES]: 'Attributes',
      [S7ValueKey.ATTRIBUTES_UPDATES]: 'Attribute Updates',
      [S7ValueKey.RPC]: 'RPC Methods',
    };
    const ctx = {
      keys: keysControl.value,
      keysType,
      panelTitle: panelTitles[keysType],
      addKeyTitle: 'Add key',
      deleteKeyTitle: 'Delete key',
      noKeysText: 'No keys configured. Add a key to get started.',
    };
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
