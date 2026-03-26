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
import {
  EthernetIPDeviceConfig, EthernetIPPlcType, EthernetIPDataKey, EthernetIPRpcConfig,
  EthernetIPValueKey, ETHERNET_IP_LOGIX_TYPES, ETHERNET_IP_LOGIX_DRIVER_TYPES,
} from '../../../models/public-api';
import { MatDialog } from '@angular/material/dialog';
import { EthernetIPDataKeysPanelComponent } from '../ethernet-ip-data-keys-panel/ethernet-ip-data-keys-panel.component';
import {
  EthernetIPTagBrowserDialogComponent,
  EthernetIPTagBrowserDialogData,
  EthernetIPTagBrowserResult,
  PlcTagDefinition,
} from '../ethernet-ip-tag-browser-dialog/ethernet-ip-tag-browser-dialog.component';

export interface EthernetIPDeviceDialogData {
  device?: EthernetIPDeviceConfig;
  isEdit: boolean;
  browsedTags?: PlcTagDefinition[];
}

@Component({
  selector: 'tb-ethernet-ip-device-dialog',
  templateUrl: './ethernet-ip-device-dialog.component.html',
  styleUrls: ['./ethernet-ip-device-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    EllipsisChipListDirective,
    DeviceProfileNameAutocompleteComponent,
  ],
})
export class EthernetIPDeviceDialogComponent extends DialogComponent<EthernetIPDeviceDialogComponent, EthernetIPDeviceConfig> {

  readonly plcTypes = Object.values(EthernetIPPlcType);
  readonly EthernetIPValueKey = EthernetIPValueKey;
  isEdit: boolean;
  keysPopupClosed = true;
  browsedTags: PlcTagDefinition[] = [];

  deviceForm = this.fb.group({
    deviceName: ['', [Validators.required]],
    deviceType: ['default'],
    host: ['', [Validators.required]],
    slot: [0, [Validators.required, Validators.min(0), Validators.max(16)]],
    plcType: [EthernetIPPlcType.CONTROLLOGIX, [Validators.required]],
    initTags: [true],
    pollPeriod: [5000, [Validators.required, Validators.min(100)]],
    connectAttemptCount: [3, [Validators.required, Validators.min(1)]],
    waitAfterFailedAttemptsMs: [30000, [Validators.required, Validators.min(1000)]],
    timeseries: [[] as EthernetIPDataKey[]],
    attributes: [[] as EthernetIPDataKey[]],
    attributeUpdates: [[] as EthernetIPDataKey[]],
    rpc: [[] as EthernetIPRpcConfig[]],
  });

  private popoverComponent: TbPopoverComponent<EthernetIPDataKeysPanelComponent>;

  constructor(
    protected store: Store<AppState>,
    protected router: Router,
    @Inject(MAT_DIALOG_DATA) public data: EthernetIPDeviceDialogData,
    public dialogRef: MatDialogRef<EthernetIPDeviceDialogComponent, EthernetIPDeviceConfig>,
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
    this.browsedTags = data.browsedTags || [];
    if (data.device) {
      this.deviceForm.patchValue(data.device as any, { emitEvent: false });
    }
  }

  get isLogixType(): boolean {
    return ETHERNET_IP_LOGIX_DRIVER_TYPES.has(this.deviceForm.get('plcType').value);
  }

  get supportsTagBrowsing(): boolean {
    return ETHERNET_IP_LOGIX_TYPES.has(this.deviceForm.get('plcType').value);
  }

  cancel(): void {
    if (this.keysPopupClosed) {
      this.dialogRef.close(null);
    }
  }

  save(): void {
    if (this.deviceForm.valid) {
      this.dialogRef.close(this.deviceForm.value as unknown as EthernetIPDeviceConfig);
    }
  }

  openTagBrowser(targetCategory: 'timeseries' | 'attributes'): void {
    const existingTags: string[] = [
      ...(this.deviceForm.get('timeseries').value || []).map((k: EthernetIPDataKey) => k.plcTag),
      ...(this.deviceForm.get('attributes').value || []).map((k: EthernetIPDataKey) => k.plcTag),
    ];

    this.matDialog.open<EthernetIPTagBrowserDialogComponent, EthernetIPTagBrowserDialogData, EthernetIPTagBrowserResult>(
      EthernetIPTagBrowserDialogComponent, {
        data: {
          tags: this.browsedTags,
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
        const current: EthernetIPDataKey[] = control.value || [];
        control.patchValue([...current, ...result.selectedTags]);
        control.markAsDirty();
        this.cdr.markForCheck();
      }
    });
  }

  manageKeys($event: Event, matButton: MatButton, keysType: EthernetIPValueKey): void {
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
      [EthernetIPValueKey.TIMESERIES]: 'Timeseries',
      [EthernetIPValueKey.ATTRIBUTES]: 'Attributes',
      [EthernetIPValueKey.ATTRIBUTES_UPDATES]: 'Attribute Updates',
      [EthernetIPValueKey.RPC]: 'RPC Methods',
    };
    const ctx = {
      keys: keysControl.value,
      keysType,
      panelTitle: panelTitles[keysType],
      addKeyTitle: 'Add key',
      deleteKeyTitle: 'Delete key',
      noKeysText: 'No keys configured. Add a key to get started.',
      isSLC: !this.isLogixType,
    };
    this.keysPopupClosed = false;
    this.popoverComponent = this.popoverService.displayPopover(
      trigger,
      this.renderer,
      this.viewContainerRef,
      EthernetIPDataKeysPanelComponent,
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
      .subscribe((keysData: Array<EthernetIPDataKey | EthernetIPRpcConfig>) => {
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
