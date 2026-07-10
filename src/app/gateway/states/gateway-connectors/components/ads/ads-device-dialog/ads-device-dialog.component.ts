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
import { AdsDataKey, AdsDeviceConfig, AdsRpcConfig, AdsValueKey } from '../../../models/public-api';
import { AdsDataKeysPanelComponent } from '../ads-data-keys-panel/ads-data-keys-panel.component';
import {
  AdsTagBrowserDialogComponent,
  AdsTagBrowserDialogData,
  AdsTagBrowserResult,
} from '../ads-tag-browser-dialog/ads-tag-browser-dialog.component';

export interface AdsDeviceDialogData {
  device?: AdsDeviceConfig;
  isEdit: boolean;
  gatewayDeviceId?: string;
  connectorName?: string;
}

@Component({
  selector: 'tb-ads-device-dialog',
  templateUrl: './ads-device-dialog.component.html',
  styleUrls: ['./ads-device-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    EllipsisChipListDirective,
    DeviceProfileNameAutocompleteComponent,
  ],
})
export class AdsDeviceDialogComponent extends DialogComponent<AdsDeviceDialogComponent, AdsDeviceConfig> {

  readonly AdsValueKey = AdsValueKey;
  isEdit: boolean;
  keysPopupClosed = true;

  deviceForm = this.fb.group({
    deviceName: ['', [Validators.required]],
    deviceType: ['default'],
    host: ['', [Validators.required]],
    amsNetId: ['', [Validators.required]],
    amsPort: [851, [Validators.required, Validators.min(1), Validators.max(65535)]],
    clientAmsNetId: [''],
    pollPeriod: [1000, [Validators.required, Validators.min(100)]],
    connectAttemptCount: [3, [Validators.required, Validators.min(1)]],
    waitAfterFailedAttemptsMs: [10000, [Validators.required]],
    enableNotifications: [false],
    timeseries: [[] as AdsDataKey[]],
    attributes: [[] as AdsDataKey[]],
    attributeUpdates: [[] as AdsDataKey[]],
    rpc: [[] as AdsRpcConfig[]],
  });

  private popoverComponent: TbPopoverComponent<AdsDataKeysPanelComponent>;

  constructor(
    protected store: Store<AppState>,
    protected router: Router,
    @Inject(MAT_DIALOG_DATA) public data: AdsDeviceDialogData,
    public dialogRef: MatDialogRef<AdsDeviceDialogComponent, AdsDeviceConfig>,
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
  }

  cancel(): void {
    if (this.keysPopupClosed) {
      this.dialogRef.close(null);
    }
  }

  save(): void {
    if (this.deviceForm.valid) {
      const result = this.deviceForm.value as unknown as AdsDeviceConfig;
      // clientAmsNetId is optional — drop it when blank to keep the JSON clean.
      if (!result.clientAmsNetId) {
        delete result.clientAmsNetId;
      }
      this.dialogRef.close(result);
    }
  }

  get canBrowseSymbols(): boolean {
    return !!(this.data.gatewayDeviceId && this.data.connectorName
              && this.deviceForm.get('deviceName').value);
  }

  openTagBrowser(targetCategory: 'timeseries' | 'attributes'): void {
    if (!this.canBrowseSymbols) {
      return;
    }
    const existingTags: string[] = [
      ...(this.deviceForm.get('timeseries').value || []).map((k: AdsDataKey) => k.address),
      ...(this.deviceForm.get('attributes').value || []).map((k: AdsDataKey) => k.address),
    ];

    this.matDialog.open<AdsTagBrowserDialogComponent, AdsTagBrowserDialogData, AdsTagBrowserResult>(
      AdsTagBrowserDialogComponent, {
        data: {
          gatewayDeviceId: this.data.gatewayDeviceId,
          connectorName: this.data.connectorName,
          deviceName: this.deviceForm.get('deviceName').value,
          targetCategory,
          existingTags,
        },
        disableClose: true,
        panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
        autoFocus: false,
        width: '900px',
      }
    ).afterClosed().subscribe(result => {
      if (result?.selectedTags?.length) {
        const control = this.deviceForm.get(result.category);
        const current: AdsDataKey[] = control.value || [];
        control.patchValue([...current, ...result.selectedTags]);
        control.markAsDirty();
        this.cdr.markForCheck();
      }
    });
  }

  manageKeys($event: Event, matButton: MatButton, keysType: AdsValueKey): void {
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
      [AdsValueKey.TIMESERIES]: 'gateway.gw-timeseries',
      [AdsValueKey.ATTRIBUTES]: 'gateway.attributes',
      [AdsValueKey.ATTRIBUTES_UPDATES]: 'gateway.gw-attribute-updates',
      [AdsValueKey.RPC]: 'gateway.gw-rpc-methods',
    };
    const ctx = {
      keys: keysControl.value,
      keysType,
      panelTitle: panelTitles[keysType],
      // Standardized: data keys → "Add key"; RPC → "Add method".
      addKeyTitle: keysType === AdsValueKey.RPC ? 'gateway.gw-add-method' : 'gateway.gw-add-key',
      deleteKeyTitle: 'gateway.gw-delete-key',
      noKeysText: 'gateway.gw-no-keys-configured-hint',
    };
    this.keysPopupClosed = false;
    this.popoverComponent = this.popoverService.displayPopover(
      trigger,
      this.renderer,
      this.viewContainerRef,
      AdsDataKeysPanelComponent,
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
      .subscribe((keysData: Array<AdsDataKey | AdsRpcConfig>) => {
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
