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
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
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
import {
  IEC61850DataKey,
  IEC61850DeviceConfig,
  IEC61850RpcConfig,
  IEC61850AcquisitionMode,
  IEC61850ValueKey,
} from '../../../models/public-api';
import { IEC61850DataKeysPanelComponent } from '../iec61850-data-keys-panel/iec61850-data-keys-panel.component';

export interface IEC61850DeviceDialogData {
  device?: IEC61850DeviceConfig;
  isEdit: boolean;
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
    timeseries: [[] as IEC61850DataKey[]],
    attributes: [[] as IEC61850DataKey[]],
    attributeUpdates: [[] as IEC61850DataKey[]],
    rpc: [[] as IEC61850RpcConfig[]],
  });

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
  ) {
    super(store, router, dialogRef);
    this.isEdit = data.isEdit;
    if (data.device) {
      const d = data.device;
      this.deviceForm.patchValue({
        ...d,
        acquisitionMode: d.dataAcquisition?.mode || IEC61850AcquisitionMode.POLLING,
      } as any, { emitEvent: false });
    }
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
      this.dialogRef.close(result);
    }
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
