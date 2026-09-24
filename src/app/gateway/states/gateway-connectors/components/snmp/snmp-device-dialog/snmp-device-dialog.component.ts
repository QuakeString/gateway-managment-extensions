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
  SNMP_BULK_METHODS,
  SnmpAuthProtocol,
  SnmpDeviceConfig,
  SnmpKeyEntry,
  SnmpMethod,
  SnmpPrivProtocol,
  SnmpSecurityLevel,
  SnmpValueKey,
  SnmpVersion,
  SnmpVersionTranslationsMap,
} from '../../../models/public-api';
import { SnmpDataKeysPanelComponent } from '../snmp-data-keys-panel/snmp-data-keys-panel.component';

export interface SnmpDeviceDialogData {
  device?: SnmpDeviceConfig;
  isEdit: boolean;
  gatewayDeviceId?: string;
  connectorName?: string;
}

/** The v3 (USM) fields; present in the saved device only when version is v3. */
const SECURITY_FIELDS = ['securityName', 'securityLevel', 'authProtocol', 'authKey', 'privProtocol', 'privKey', 'contextName', 'engineId'] as const;

@Component({
  selector: 'tb-snmp-device-dialog',
  templateUrl: './snmp-device-dialog.component.html',
  styleUrls: ['./snmp-device-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    EllipsisChipListDirective,
    DeviceProfileNameAutocompleteComponent,
  ],
})
export class SnmpDeviceDialogComponent extends DialogComponent<SnmpDeviceDialogComponent, SnmpDeviceConfig> {

  readonly SnmpValueKey = SnmpValueKey;
  readonly SnmpVersion = SnmpVersion;
  readonly versions = Object.values(SnmpVersion);
  readonly SnmpVersionTranslationsMap = SnmpVersionTranslationsMap;
  readonly securityLevels = Object.values(SnmpSecurityLevel);
  readonly authProtocols = Object.values(SnmpAuthProtocol);
  readonly privProtocols = Object.values(SnmpPrivProtocol);
  readonly SnmpSecurityLevel = SnmpSecurityLevel;

  isEdit: boolean;
  keysPopupClosed = true;

  deviceForm = this.fb.group({
    deviceName: ['', [Validators.required]],
    deviceType: ['default'],
    ip: ['', [Validators.required]],
    port: [161, [Validators.required, Validators.min(1), Validators.max(65535)]],
    version: [SnmpVersion.V2C as SnmpVersion | string],
    community: ['public'],
    securityName: [''],
    securityLevel: [SnmpSecurityLevel.AUTH_PRIV as SnmpSecurityLevel | string],
    authProtocol: [SnmpAuthProtocol.SHA as SnmpAuthProtocol | string],
    authKey: [''],
    privProtocol: [SnmpPrivProtocol.AES128 as SnmpPrivProtocol | string],
    privKey: [''],
    contextName: [''],
    engineId: [''],
    timeout: [6, [Validators.required, Validators.min(0.1)]],
    pollPeriod: [10000, [Validators.required, Validators.min(100)]],
    connectAttemptCount: [3, [Validators.required, Validators.min(1)]],
    waitAfterFailedAttemptsMs: [30000, [Validators.required, Validators.min(0)]],
    attributes: [[] as SnmpKeyEntry[]],
    telemetry: [[] as SnmpKeyEntry[]],
    attributeUpdateRequests: [[] as SnmpKeyEntry[]],
    serverSideRpcRequests: [[] as SnmpKeyEntry[]],
  });

  private popoverComponent: TbPopoverComponent<SnmpDataKeysPanelComponent>;

  constructor(
    protected store: Store<AppState>,
    protected router: Router,
    @Inject(MAT_DIALOG_DATA) public data: SnmpDeviceDialogData,
    public dialogRef: MatDialogRef<SnmpDeviceDialogComponent, SnmpDeviceConfig>,
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
      // A configuration written by hand may carry `host` where the UI writes `ip`.
      const device = { ...data.device, ip: data.device.ip ?? (data.device as any).host };
      this.deviceForm.patchValue(device as any, { emitEvent: false });
    }
    this.updateSecurityValidators();
    this.deviceForm.get('version').valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateSecurityValidators());
    this.deviceForm.get('securityLevel').valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateSecurityValidators());
  }

  get isV3(): boolean {
    return this.deviceForm.get('version').value === SnmpVersion.V3;
  }

  get needsAuth(): boolean {
    return this.isV3 && this.deviceForm.get('securityLevel').value !== SnmpSecurityLevel.NO_AUTH_NO_PRIV;
  }

  get needsPriv(): boolean {
    return this.isV3 && this.deviceForm.get('securityLevel').value === SnmpSecurityLevel.AUTH_PRIV;
  }

  /** Bulk methods on a v1 device are refused by the gateway at load; say so before saving. */
  get bulkOnV1(): boolean {
    if (this.deviceForm.get('version').value !== SnmpVersion.V1) {
      return false;
    }
    return Object.values(SnmpValueKey).some(list =>
      ((this.deviceForm.get(list).value ?? []) as SnmpKeyEntry[])
        .some(entry => SNMP_BULK_METHODS.includes(entry.method as SnmpMethod)));
  }

  chipLabel(entry: SnmpKeyEntry): string {
    return (entry as any).key ?? (entry as any).attributeFilter ?? (entry as any).requestFilter ?? '';
  }

  cancel(): void {
    if (this.keysPopupClosed) {
      this.dialogRef.close(null);
    }
  }

  save(): void {
    if (this.deviceForm.valid && !this.bulkOnV1) {
      const result = this.deviceForm.value as unknown as SnmpDeviceConfig;
      if (result.version === SnmpVersion.V3) {
        delete result.community;
        for (const field of ['contextName', 'engineId'] as const) {
          if (!result[field]) {
            delete result[field];
          }
        }
        if (!this.needsAuth) {
          delete result.authProtocol;
          delete result.authKey;
        }
        if (!this.needsPriv) {
          delete result.privProtocol;
          delete result.privKey;
        }
      } else {
        for (const field of SECURITY_FIELDS) {
          delete result[field];
        }
      }
      this.dialogRef.close(result);
    }
  }

  manageKeys($event: Event, matButton: MatButton, keysType: SnmpValueKey): void {
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
      [SnmpValueKey.TELEMETRY]: 'gateway.gw-timeseries',
      [SnmpValueKey.ATTRIBUTES]: 'gateway.attributes',
      [SnmpValueKey.ATTRIBUTES_UPDATES]: 'gateway.gw-attribute-updates',
      [SnmpValueKey.RPC]: 'gateway.gw-rpc-methods',
    };
    const ctx = {
      keys: keysControl.value,
      keysType,
      version: this.deviceForm.get('version').value,
      panelTitle: panelTitles[keysType],
      addKeyTitle: keysType === SnmpValueKey.RPC ? 'gateway.gw-add-method' : 'gateway.gw-add-key',
      deleteKeyTitle: 'gateway.gw-delete-key',
      noKeysText: 'gateway.gw-no-keys-configured-hint',
    };
    this.keysPopupClosed = false;
    this.popoverComponent = this.popoverService.displayPopover(
      trigger,
      this.renderer,
      this.viewContainerRef,
      SnmpDataKeysPanelComponent,
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
      .subscribe((keysData: SnmpKeyEntry[]) => {
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

  /** securityName is required on v3; the keys follow the security level. */
  private updateSecurityValidators(): void {
    const set = (name: string, required: boolean) => {
      const control = this.deviceForm.get(name);
      control.setValidators(required ? [Validators.required] : []);
      control.updateValueAndValidity({ emitEvent: false });
    };
    set('securityName', this.isV3);
    set('authKey', this.needsAuth);
    set('privKey', this.needsPriv);
    this.cdr.markForCheck();
  }
}
