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
import { McDataKey, McDeviceConfig, McRpcConfig, McValueKey } from '../../../models/public-api';
import { McProtocolDataKeysPanelComponent } from '../mcprotocol-data-keys-panel/mcprotocol-data-keys-panel.component';

export interface McDeviceDialogData {
  device?: McDeviceConfig;
  isEdit: boolean;
  gatewayDeviceId?: string;
  connectorName?: string;
}

@Component({
  selector: 'tb-mcprotocol-device-dialog',
  templateUrl: './mcprotocol-device-dialog.component.html',
  styleUrls: ['./mcprotocol-device-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    EllipsisChipListDirective,
    DeviceProfileNameAutocompleteComponent,
  ],
})
export class McProtocolDeviceDialogComponent extends DialogComponent<McProtocolDeviceDialogComponent, McDeviceConfig> {

  readonly McValueKey = McValueKey;
  isEdit: boolean;
  keysPopupClosed = true;

  readonly plcSeriesOptions = ['Q', 'L', 'QnA', 'iQ-L', 'iQ-R'];
  readonly frameOptions = ['3E', '4E'];
  readonly commTypeOptions = ['binary', 'ascii'];

  deviceForm = this.fb.group({
    deviceName: ['', [Validators.required]],
    deviceType: ['default'],
    host: ['', [Validators.required]],
    port: [5007, [Validators.required, Validators.min(1), Validators.max(65535)]],
    plcSeries: ['Q', [Validators.required]],
    frame: ['3E', [Validators.required]],
    commType: ['binary', [Validators.required]],
    network: [0, [Validators.min(0), Validators.max(255)]],
    pcStation: [255, [Validators.min(0), Validators.max(255)]],
    destModuleIo: [1023, [Validators.min(0), Validators.max(65535)]],
    destModuleStation: [0, [Validators.min(0), Validators.max(255)]],
    timeoutMs: [3000, [Validators.required, Validators.min(100)]],
    pollPeriod: [1000, [Validators.required, Validators.min(100)]],
    connectAttemptCount: [3, [Validators.required, Validators.min(1)]],
    waitAfterFailedAttemptsMs: [10000, [Validators.required]],
    timeseries: [[] as McDataKey[]],
    attributes: [[] as McDataKey[]],
    attributeUpdates: [[] as McDataKey[]],
    rpc: [[] as McRpcConfig[]],
  });

  private popoverComponent: TbPopoverComponent<McProtocolDataKeysPanelComponent>;

  constructor(
    protected store: Store<AppState>,
    protected router: Router,
    @Inject(MAT_DIALOG_DATA) public data: McDeviceDialogData,
    public dialogRef: MatDialogRef<McProtocolDeviceDialogComponent, McDeviceConfig>,
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
      this.deviceForm.patchValue(data.device as any, { emitEvent: false });
    }
  }

  cancel(): void {
    if (this.keysPopupClosed) {
      this.dialogRef.close(null);
    }
  }

  save(): void {
    if (this.deviceForm.valid) {
      this.dialogRef.close(this.deviceForm.value as unknown as McDeviceConfig);
    }
  }

  manageKeys($event: Event, matButton: MatButton, keysType: McValueKey): void {
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
      [McValueKey.TIMESERIES]: 'gateway.gw-timeseries',
      [McValueKey.ATTRIBUTES]: 'gateway.attributes',
      [McValueKey.ATTRIBUTES_UPDATES]: 'gateway.gw-attribute-updates',
      [McValueKey.RPC]: 'gateway.gw-rpc-methods',
    };
    const ctx = {
      keys: keysControl.value,
      keysType,
      panelTitle: panelTitles[keysType],
      // Standardized: data keys → "Add key"; RPC → "Add method".
      addKeyTitle: keysType === McValueKey.RPC ? 'gateway.gw-add-method' : 'gateway.gw-add-key',
      deleteKeyTitle: 'gateway.gw-delete-key',
      noKeysText: 'gateway.gw-no-keys-configured-hint',
    };
    this.keysPopupClosed = false;
    this.popoverComponent = this.popoverService.displayPopover(
      trigger,
      this.renderer,
      this.viewContainerRef,
      McProtocolDataKeysPanelComponent,
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
      .subscribe((keysData: Array<McDataKey | McRpcConfig>) => {
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
