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
///     http://www.apache.org/licenses/LICENSE-2.0
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
import { FormArray, FormBuilder, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { DialogComponent, SharedModule } from '@shared/public-api';
import { Store } from '@ngrx/store';
import { AppState, DeviceService } from '@core/public-api';
import { Router } from '@angular/router';
import { MatButton } from '@angular/material/button';
import { TbPopoverService } from '@shared/components/popover.service';
import { TbPopoverComponent } from '@shared/components/popover.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DeviceProfileNameAutocompleteComponent, EllipsisChipListDirective } from '../../../../../shared/public-api';
import {
  IEC61850DataKey,
  IEC61850DeviceConfig,
  IEC61850RpcConfig,
  IEC61850AcquisitionMode,
  IEC61850ValueKey,
  IEC61850GooseSubscription,
  IEC61850ModelNode,
} from '../../../models/public-api';
import { IEC61850DataKeysPanelComponent } from '../iec61850-data-keys-panel/iec61850-data-keys-panel.component';
import {
  IEC61850ModelBrowserDialogComponent,
  IEC61850ModelBrowserData,
  IEC61850ModelBrowserResult,
  IEC61850BrowserCategory,
} from '../iec61850-model-browser-dialog/iec61850-model-browser-dialog.component';
import { TimeSyncDialogComponent } from '../../../../../shared/components/time-sync-dialog/time-sync-dialog.component';

export interface IEC61850DeviceDialogData {
  device?: IEC61850DeviceConfig;
  isEdit: boolean;
  gatewayDeviceId?: string;
  connectorName?: string;
  modelTree?: { logicalDevices: IEC61850ModelNode[] };
}

@Component({
  selector: 'tb-iec61850-device-dialog',
  templateUrl: './iec61850-device-dialog.component.html',
  styleUrls: ['./iec61850-device-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule, EllipsisChipListDirective, DeviceProfileNameAutocompleteComponent],
})
export class IEC61850DeviceDialogComponent extends DialogComponent<IEC61850DeviceDialogComponent, IEC61850DeviceConfig> {

  readonly AcquisitionMode = IEC61850AcquisitionMode;
  readonly ValueKey = IEC61850ValueKey;
  isEdit: boolean;
  keysPopupClosed = true;
  modelTree: { logicalDevices: IEC61850ModelNode[] } = null;
  browseLoading = false;
  browseError: string = null;
  browsePointCount = 0;
  networkInterfaces: { name: string; ip: string }[] = [];
  loadingInterfaces = false;

  deviceForm = this.fb.group({
    deviceName: ['IEC61850 IED', [Validators.required]],
    deviceType: ['default'],
    host: ['192.168.1.10', [Validators.required]],
    port: [102, [Validators.required, Validators.min(1), Validators.max(65535)]],
    pollPeriod: [5000, [Validators.required, Validators.min(100)]],
    connectionTimeout: [10000, [Validators.min(1000)]],
    connectAttemptCount: [3, [Validators.min(1)]],
    waitAfterFailedAttemptsMs: [30000, [Validators.min(1000)]],
    acquisitionMode: [IEC61850AcquisitionMode.POLLING],
    rcbReference: [''],
    reportId: [''],
    integrityPeriodMs: [60000],
    bufferTimeMs: [100],
    triggerDataChange: [true],
    triggerQualityChange: [true],
    triggerDataUpdate: [false],
    triggerIntegrity: [true],
    triggerGI: [true],
    gooseEnabled: [false],
    gooseInterface: ['eth0'],
    gooseSubscriptions: this.fb.array([]),
    timeSync: this.fb.group({
      enabled: [false],
      intervalSec: [300, [Validators.min(10)]],
      targetReference: [''],
      verified: [false],
    }),
    timeseries: [[] as IEC61850DataKey[]],
    attributes: [[] as IEC61850DataKey[]],
    attributeUpdates: [[] as IEC61850DataKey[]],
    rpc: [[] as IEC61850RpcConfig[]],
  });

  get gooseSubscriptions(): FormArray {
    return this.deviceForm.get('gooseSubscriptions') as FormArray;
  }

  private popoverComponent: TbPopoverComponent<IEC61850DataKeysPanelComponent>;

  constructor(
    protected store: Store<AppState>,
    protected router: Router,
    @Inject(MAT_DIALOG_DATA) public data: IEC61850DeviceDialogData,
    public dialogRef: MatDialogRef<IEC61850DeviceDialogComponent, IEC61850DeviceConfig>,
    private fb: FormBuilder,
    private popoverService: TbPopoverService,
    private renderer: Renderer2,
    private viewContainerRef: ViewContainerRef,
    private destroyRef: DestroyRef,
    private cdr: ChangeDetectorRef,
    private matDialog: MatDialog,
    private deviceService: DeviceService,
  ) {
    super(store, router, dialogRef);
    this.isEdit = data.isEdit;
    this.modelTree = data.modelTree || null;
    if (data.device) {
      const d = data.device;
      this.deviceForm.patchValue({
        ...d,
        acquisitionMode: d.dataAcquisition?.mode || IEC61850AcquisitionMode.POLLING,
      } as any, { emitEvent: false });

      // Populate report config fields
      if (d.dataAcquisition?.reports?.length) {
        const report = d.dataAcquisition.reports[0];
        this.deviceForm.patchValue({
          rcbReference: report.rcbReference || '',
          reportId: report.rptId || '',
          integrityPeriodMs: report.integrityPeriodMs ?? 60000,
          bufferTimeMs: report.bufferTimeMs ?? 100,
          triggerDataChange: report.triggerOptions?.dataChange ?? true,
          triggerQualityChange: report.triggerOptions?.qualityChange ?? true,
          triggerDataUpdate: report.triggerOptions?.dataUpdate ?? false,
          triggerIntegrity: report.triggerOptions?.integrity ?? true,
          triggerGI: report.triggerOptions?.generalInterrogation ?? true,
        }, { emitEvent: false });
      }

      // Populate GOOSE config fields
      if (d.goose) {
        this.deviceForm.patchValue({
          gooseEnabled: d.goose.enabled ?? false,
          gooseInterface: d.goose.interface || 'eth0',
        }, { emitEvent: false });
        if (d.goose.subscriptions?.length) {
          d.goose.subscriptions.forEach(sub => this.addGooseSubscription(sub));
        }
      }
    }

    // Auto-fetch network interfaces if gateway is available
    if (this.data.gatewayDeviceId) {
      this.fetchNetworkInterfaces();
    }
  }

  addGooseSubscription(sub?: IEC61850GooseSubscription): void {
    this.gooseSubscriptions.push(this.fb.group({
      gocbRef: [sub?.gocbRef || '', [Validators.required]],
      appId: [sub?.appId || ''],
    }));
    this.cdr.markForCheck();
  }

  removeGooseSubscription(index: number): void {
    this.gooseSubscriptions.removeAt(index);
    this.cdr.markForCheck();
  }

  cancel(): void {
    if (this.keysPopupClosed) {
      this.dialogRef.close(null);
    }
  }

  save(): void {
    if (this.deviceForm.valid) {
      const v = this.deviceForm.value;
      const result: IEC61850DeviceConfig = {
        deviceName: v.deviceName,
        deviceType: v.deviceType || 'default',
        host: v.host,
        port: v.port,
        pollPeriod: v.pollPeriod,
        connectionTimeout: v.connectionTimeout,
        connectAttemptCount: v.connectAttemptCount,
        waitAfterFailedAttemptsMs: v.waitAfterFailedAttemptsMs,
        dataAcquisition: { mode: v.acquisitionMode },
        timeseries: v.timeseries,
        attributes: v.attributes,
        attributeUpdates: v.attributeUpdates,
        rpc: v.rpc,
      };

      // Build report config when in report mode
      if (v.acquisitionMode === IEC61850AcquisitionMode.REPORT) {
        result.dataAcquisition.reports = [{
          rcbReference: v.rcbReference,
          rptId: v.reportId || undefined,
          integrityPeriodMs: v.integrityPeriodMs,
          bufferTimeMs: v.bufferTimeMs,
          triggerOptions: {
            dataChange: v.triggerDataChange,
            qualityChange: v.triggerQualityChange,
            dataUpdate: v.triggerDataUpdate,
            integrity: v.triggerIntegrity,
            generalInterrogation: v.triggerGI,
          },
        }];
      }

      // Build GOOSE config
      if (v.gooseEnabled) {
        const subs: IEC61850GooseSubscription[] = this.gooseSubscriptions.controls.map(c => ({
          gocbRef: c.value.gocbRef,
          appId: c.value.appId || undefined,
        }));
        result.goose = {
          enabled: true,
          interface: v.gooseInterface,
          subscriptions: subs,
        };
      }

      // Time sync: drop the block entirely when disabled, but keep the verified flag
      // so reopening the dialog still lets the user re-enable auto sync without another manual read.
      if (v.timeSync?.enabled) {
        (result as any).timeSync = {
          enabled: true,
          intervalSec: v.timeSync.intervalSec ?? 300,
          targetReference: v.timeSync.targetReference || '',
          verified: !!v.timeSync.verified,
        };
      } else if (v.timeSync?.verified) {
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
        connectorType: 'iec61850',
      },
    }).afterClosed().subscribe((synced: boolean) => {
      if (synced) {
        this.deviceForm.get('timeSync.verified').setValue(true);
        this.deviceForm.get('timeSync.verified').markAsDirty();
        this.cdr.markForCheck();
      }
    });
  }

  browseIed(): void {
    this.browseLoading = true;
    this.browseError = null;
    this.cdr.markForCheck();

    const gatewayDeviceId = this.data.gatewayDeviceId;
    const connectorName = this.data.connectorName;
    const deviceName = this.deviceForm.get('deviceName').value;

    if (!gatewayDeviceId) {
      this.browseLoading = false;
      this.browseError = 'Gateway device ID not available. Save the connector configuration first.';
      this.cdr.markForCheck();
      return;
    }

    // Send RPC to the gateway connector via DeviceService
    // The gateway routes "iec61850_browseModel" to the IEC 61850 connector
    const rpcBody = {
      method: 'iec61850_browseModel',
      params: {
        deviceName,
        connectorId: connectorName,
      },
      timeout: 15000,
    };

    this.deviceService.sendTwoWayRpcCommand(gatewayDeviceId, rpcBody).subscribe({
      next: (result: any) => {
        if (result?.logicalDevices) {
          this.modelTree = result;
        } else if (result?.result) {
          this.modelTree = result.result;
        } else {
          this.modelTree = { logicalDevices: [] };
        }
        this.browsePointCount = this._countDataPoints(this.modelTree);
        this.browseLoading = false;
        this.browseError = this.browsePointCount === 0 ? 'No data points found on the IED.' : null;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.browseLoading = false;
        this.browseError = 'Discovery failed. Make sure the connector is saved and the gateway is connected to the IED.';
        this.cdr.markForCheck();
      }
    });
  }

  private _countDataPoints(model: any): number {
    let count = 0;
    if (model?.logicalDevices) {
      for (const ld of model.logicalDevices) {
        for (const ln of ld.logicalNodes || []) {
          for (const d of ln.dataObjects || []) {
            count += (d.dataAttributes || []).length;
          }
        }
      }
    }
    return count;
  }

  fetchNetworkInterfaces(): void {
    const gatewayDeviceId = this.data.gatewayDeviceId;
    if (!gatewayDeviceId) { return; }

    this.loadingInterfaces = true;
    this.cdr.markForCheck();

    this.deviceService.sendTwoWayRpcCommand(gatewayDeviceId, {
      method: 'iec61850_getNetworkInterfaces',
      params: {},
      timeout: 10000,
    }).subscribe({
      next: (result: any) => {
        this.networkInterfaces = result?.interfaces || [];
        this.loadingInterfaces = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingInterfaces = false;
        this.cdr.markForCheck();
      }
    });
  }

  browseAndOpen(targetCategory: IEC61850BrowserCategory): void {
    // Always open the dialog immediately — it handles discovery internally
    this.openModelBrowser(targetCategory);
  }

  openModelBrowser(targetCategory: IEC61850BrowserCategory): void {
    let existingReferences: string[];

    if (targetCategory === 'rpc') {
      existingReferences = (this.deviceForm.get('rpc').value || []).map((k: IEC61850RpcConfig) => k.reference);
    } else if (targetCategory === 'attributeUpdates') {
      existingReferences = (this.deviceForm.get('attributeUpdates').value || []).map((k: IEC61850DataKey) => k.reference);
    } else {
      existingReferences = [
        ...(this.deviceForm.get('timeseries').value || []).map((k: IEC61850DataKey) => k.reference),
        ...(this.deviceForm.get('attributes').value || []).map((k: IEC61850DataKey) => k.reference),
      ];
    }

    this.matDialog.open<IEC61850ModelBrowserDialogComponent, IEC61850ModelBrowserData, IEC61850ModelBrowserResult>(
      IEC61850ModelBrowserDialogComponent, {
        data: {
          modelTree: this.modelTree,
          targetCategory,
          existingReferences,
          gatewayDeviceId: this.data.gatewayDeviceId,
          connectorName: this.data.connectorName,
          deviceName: this.deviceForm.get('deviceName').value,
        },
        disableClose: true,
        panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
        autoFocus: false,
        width: '950px',
      }
    ).afterClosed().subscribe(result => {
      if (!result) { return; }

      // Cache the model tree from the dialog (whether discovered or refreshed)
      if (result.modelTree?.logicalDevices?.length) {
        this.modelTree = result.modelTree;
        this.browsePointCount = this._countDataPoints(this.modelTree);
      }

      if (result.category === 'rpc' && result.selectedRpcConfigs?.length) {
        const control = this.deviceForm.get('rpc');
        const current: IEC61850RpcConfig[] = control.value || [];
        control.patchValue([...current, ...result.selectedRpcConfigs]);
        control.markAsDirty();
        this.cdr.markForCheck();
      } else if (result.selectedKeys?.length) {
        const formKey = result.category as 'timeseries' | 'attributes' | 'attributeUpdates';
        const control = this.deviceForm.get(formKey);
        const current: IEC61850DataKey[] = (control.value as IEC61850DataKey[]) || [];
        control.patchValue([...current, ...result.selectedKeys]);
        control.markAsDirty();
        this.cdr.markForCheck();
      }
    });
  }

  manageKeys($event: Event, matButton: MatButton, keysType: IEC61850ValueKey): void {
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
    const ctx = {
      keys: keysControl.value,
      keyType: keysType,
    };
    this.keysPopupClosed = false;
    this.popoverComponent = this.popoverService.displayPopover(
      trigger,
      this.renderer,
      this.viewContainerRef,
      IEC61850DataKeysPanelComponent,
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
      .subscribe((keysData: Array<IEC61850DataKey | IEC61850RpcConfig>) => {
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
