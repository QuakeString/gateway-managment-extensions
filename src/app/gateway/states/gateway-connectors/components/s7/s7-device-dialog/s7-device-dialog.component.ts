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
import { S7DataKey, S7DeviceConfig, S7PlcModel, S7RpcConfig, S7ValueKey } from '../../../models/public-api';
import { S7DataKeysPanelComponent } from '../s7-data-keys-panel/s7-data-keys-panel.component';

export interface S7DeviceDialogData {
  device?: S7DeviceConfig;
  isEdit: boolean;
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
      this.dialogRef.close(this.deviceForm.value as unknown as S7DeviceConfig);
    }
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
