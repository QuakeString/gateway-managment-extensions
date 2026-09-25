///
/// Copyright © 2016-2025 The Sentient Authors
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
import { AbstractControl, FormArray, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
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
  DNP3_MAX_ADDRESS,
  DNP3_SESSION_KEY_CHANGE_DEFAULT_MS,
  Dnp3AttributeUpdate,
  Dnp3DeviceConfig,
  Dnp3PointKey,
  Dnp3PointType,
  Dnp3RpcConfig,
  Dnp3SecureAuthentication,
  Dnp3SecureAuthUser,
  Dnp3TimeSync,
  Dnp3ValueKey,
} from '../../../models/public-api';
import { Dnp3DataKeysPanelComponent } from '../dnp3-data-keys-panel/dnp3-data-keys-panel.component';
import { Dnp3ProfilePoint, parseDnp3DeviceProfile } from '../dnp3-device-profile';

/** The points of an imported Device Profile of one type, and whether to take them. */
interface ProfileGroup {
  pointType: string;
  points: Dnp3ProfilePoint[];
  selected: boolean;
}

export interface Dnp3DeviceDialogData {
  device?: Dnp3DeviceConfig;
  isEdit: boolean;
  /** The connector's channel names. */
  channels: string[];
  /** Whether the gateway has Secure Authentication (4.5.0); unknown counts as yes. */
  secureAuthSupported?: boolean;
  /** The connector's other devices: names and (channel, address) pairs must stay unique. */
  otherDevices: Dnp3DeviceConfig[];
  gatewayDeviceId?: string;
  connectorName?: string;
}

type Dnp3Keys = Array<Dnp3PointKey | Dnp3AttributeUpdate | Dnp3RpcConfig>;

@Component({
  selector: 'tb-dnp3-device-dialog',
  templateUrl: './dnp3-device-dialog.component.html',
  styleUrls: ['./dnp3-device-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    EllipsisChipListDirective,
    DeviceProfileNameAutocompleteComponent,
  ],
})
export class Dnp3DeviceDialogComponent extends DialogComponent<Dnp3DeviceDialogComponent, Dnp3DeviceConfig> {

  readonly Dnp3ValueKey = Dnp3ValueKey;
  readonly timeSyncModes = Object.values(Dnp3TimeSync);
  readonly maxAddress = DNP3_MAX_ADDRESS;
  isEdit: boolean;
  keysPopupClosed = true;

  /** A Device Profile read and waiting for the user to choose. */
  profileImport: { documentName?: string; groups: ProfileGroup[]; alreadyConfigured: number } | null = null;
  profileError = '';

  get profileSelectedCount(): number {
    return (this.profileImport?.groups ?? [])
      .filter(group => group.selected)
      .reduce((sum, group) => sum + group.points.length, 0);
  }

  deviceForm = this.fb.group({
    deviceName: ['', [Validators.required, Validators.pattern(/\S/), this.uniqueName()]],
    deviceType: ['default'],
    channel: ['', [Validators.required]],
    masterAddress: [1, [Validators.required, Validators.min(0), Validators.max(DNP3_MAX_ADDRESS)]],
    outstationAddress: [10, [Validators.required, Validators.min(0), Validators.max(DNP3_MAX_ADDRESS)]],
    responseTimeoutMs: [5000, [Validators.required, Validators.min(100)]],
    retries: [2, [Validators.required, Validators.min(0)]],
    taskRetryMs: [5000, [Validators.required, Validators.min(100)]],
    maxTaskRetryMs: [60000, [Validators.required, Validators.min(100)]],
    keepAliveMs: [60000, [Validators.required, Validators.min(0)]],
    startup: this.fb.group({
      disableUnsolicited: [true],
      integrityPoll: [true],
      unsolicitedClass1: [true],
      unsolicitedClass2: [true],
      unsolicitedClass3: [true],
    }),
    polls: this.fb.group({
      integrityMs: [3600000, [Validators.min(0)]],
      class1Ms: [0, [Validators.min(0)]],
      class2Ms: [0, [Validators.min(0)]],
      class3Ms: [0, [Validators.min(0)]],
    }),
    eventScanOnIin: [true],
    timeSync: [Dnp3TimeSync.NONE as string],
    useOutstationTime: [true],
    allowRestart: [false],
    secureAuthentication: this.fb.group({
      enabled: [false],
      users: this.fb.array([] as FormGroup[]),
      sessionKeyChangeIntervalMs: [DNP3_SESSION_KEY_CHANGE_DEFAULT_MS, [Validators.required, Validators.min(1000)]],
    }, { validators: [(group: AbstractControl) => this.secureAuthUsersValid(group)] }),
    timeseries: [[] as Dnp3PointKey[]],
    attributes: [[] as Dnp3PointKey[]],
    attributeUpdates: [[] as Dnp3AttributeUpdate[]],
    rpc: [[] as Dnp3RpcConfig[]],
  }, { validators: [(group: AbstractControl) => this.addressesValid(group)] });

  private popoverComponent: TbPopoverComponent<Dnp3DataKeysPanelComponent>;

  constructor(
    protected store: Store<AppState>,
    protected router: Router,
    @Inject(MAT_DIALOG_DATA) public data: Dnp3DeviceDialogData,
    public dialogRef: MatDialogRef<Dnp3DeviceDialogComponent, Dnp3DeviceConfig>,
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
      const device = data.device;
      const classes = device.startup?.enableUnsolicited ?? [1, 2, 3];
      this.deviceForm.patchValue({
        ...(device as any),
        startup: {
          disableUnsolicited: device.startup?.disableUnsolicited ?? true,
          integrityPoll: device.startup?.integrityPoll ?? true,
          unsolicitedClass1: classes.includes(1),
          unsolicitedClass2: classes.includes(2),
          unsolicitedClass3: classes.includes(3),
        },
        polls: {
          integrityMs: device.polls?.integrityMs ?? 0,
          class1Ms: device.polls?.class1Ms ?? 0,
          class2Ms: device.polls?.class2Ms ?? 0,
          class3Ms: device.polls?.class3Ms ?? 0,
        },
      }, { emitEvent: false });
    } else if (data.channels?.length) {
      this.deviceForm.patchValue({ channel: data.channels[0] }, { emitEvent: false });
    }
    const secureAuth = data.device?.secureAuthentication;
    for (const user of secureAuth?.users ?? []) {
      this.saUsers.push(this.saUserGroup(user));
    }
    (this.deviceForm.get('secureAuthentication') as FormGroup).patchValue({
      enabled: !!secureAuth && secureAuth.enabled !== false,
      sessionKeyChangeIntervalMs: secureAuth?.sessionKeyChangeIntervalMs ?? DNP3_SESSION_KEY_CHANGE_DEFAULT_MS,
    }, { emitEvent: false });
    // An older gateway cannot run it; a device that already has it keeps it editable.
    if (data.secureAuthSupported === false && !secureAuth) {
      this.deviceForm.get('secureAuthentication.enabled').disable({ emitEvent: false });
    }
    this.onSecureAuthToggled(false);
    this.deviceForm.get('secureAuthentication.enabled').valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.onSecureAuthToggled(true));
  }

  get saUsers(): FormArray {
    return this.deviceForm.get('secureAuthentication.users') as FormArray;
  }

  get secureAuthEnabled(): boolean {
    return !!this.deviceForm.get('secureAuthentication.enabled').value;
  }

  addSaUser(): void {
    const taken = new Set((this.saUsers.getRawValue() as Dnp3SecureAuthUser[]).map(u => Number(u.number)));
    let number = 1;
    while (taken.has(number)) {
      number++;
    }
    this.saUsers.push(this.saUserGroup({ number, updateKeyFile: '' }));
    this.deviceForm.get('secureAuthentication').updateValueAndValidity();
  }

  removeSaUser(index: number): void {
    this.saUsers.removeAt(index);
    this.deviceForm.get('secureAuthentication').updateValueAndValidity();
  }

  private saUserGroup(user: Dnp3SecureAuthUser): FormGroup {
    return this.fb.group({
      number: [user.number, [Validators.required, Validators.min(1), Validators.max(65535)]],
      updateKeyFile: [user.updateKeyFile, [Validators.required, Validators.pattern(/\S/)]],
    });
  }

  /** Users and the interval count only while it is on; switching it on offers user 1. */
  private onSecureAuthToggled(offerDefaultUser: boolean): void {
    const group = this.deviceForm.get('secureAuthentication');
    const on = this.secureAuthEnabled;
    if (on && offerDefaultUser && !this.saUsers.length) {
      this.saUsers.push(this.saUserGroup({ number: 1, updateKeyFile: '' }));
    }
    for (const name of ['users', 'sessionKeyChangeIntervalMs']) {
      const control = group.get(name);
      if (on) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
    }
    group.updateValueAndValidity();
    this.cdr.markForCheck();
  }

  /** The device's requests run as user 1, so it must be there; each number once. */
  private secureAuthUsersValid(group: AbstractControl): ValidationErrors | null {
    if (!group.get('enabled')?.value) {
      return null;
    }
    const numbers = ((group.get('users') as FormArray).getRawValue() as Dnp3SecureAuthUser[])
      .map(user => Number(user.number));
    if (!numbers.includes(1)) {
      return { needsDefaultUser: true };
    }
    if (new Set(numbers).size !== numbers.length) {
      return { duplicateUser: true };
    }
    return null;
  }

  /** What is saved: the block when on; when off, only if the device had one (kept, switched off). */
  private secureAuthResult(): Dnp3SecureAuthentication | undefined {
    const raw = this.deviceForm.get('secureAuthentication').getRawValue();
    const users = (raw.users as Dnp3SecureAuthUser[]).map(user => ({
      number: Number(user.number),
      updateKeyFile: (user.updateKeyFile ?? '').trim(),
    }));
    const sessionKeyChangeIntervalMs = Number(raw.sessionKeyChangeIntervalMs);
    if (raw.enabled) {
      return { users, sessionKeyChangeIntervalMs };
    }
    if (this.data.device?.secureAuthentication) {
      return { enabled: false, users, sessionKeyChangeIntervalMs };
    }
    return undefined;
  }

  get channelUnknown(): boolean {
    const channel = this.deviceForm.get('channel').value;
    return !!channel && !this.data.channels.includes(channel);
  }

  cancel(): void {
    if (this.keysPopupClosed) {
      this.dialogRef.close(null);
    }
  }

  save(): void {
    if (this.deviceForm.invalid) {
      return;
    }
    const form = this.deviceForm.getRawValue();
    const { startup, secureAuthentication: _secureAuthentication, ...rest } = form;
    const enableUnsolicited = [
      startup.unsolicitedClass1 && 1,
      startup.unsolicitedClass2 && 2,
      startup.unsolicitedClass3 && 3,
    ].filter(Boolean) as number[];
    const result: Dnp3DeviceConfig = {
      ...(rest as any),
      deviceName: (rest.deviceName ?? '').trim(),
      startup: {
        disableUnsolicited: startup.disableUnsolicited,
        integrityPoll: startup.integrityPoll,
        enableUnsolicited,
      },
    };
    const secureAuth = this.secureAuthResult();
    if (secureAuth) {
      result.secureAuthentication = secureAuth;
    }
    this.dialogRef.close(result);
  }

  /** Read an IEEE 1815 Device Profile and offer its points, by type. */
  onProfileFile(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    file.text().then(xml => {
      const existing = [
        ...(this.deviceForm.get('timeseries').value as Dnp3PointKey[]),
        ...(this.deviceForm.get('attributes').value as Dnp3PointKey[]),
      ];
      const configured = new Set(existing.map(point => `${point.pointType}:${point.index}`));
      try {
        const profile = parseDnp3DeviceProfile(xml, existing.map(point => point.key));
        const fresh = profile.points.filter(p => !configured.has(`${p.point.pointType}:${p.point.index}`));
        const groups: ProfileGroup[] = [];
        for (const point of fresh) {
          let group = groups.find(g => g.pointType === point.point.pointType);
          if (!group) {
            group = { pointType: point.point.pointType, points: [], selected: true };
            groups.push(group);
          }
          group.points.push(point);
        }
        // In the point types' own order, not the order of first appearance.
        const order = Object.values(Dnp3PointType) as string[];
        groups.sort((a, b) => order.indexOf(a.pointType) - order.indexOf(b.pointType));
        this.profileImport = {
          documentName: profile.documentName,
          groups,
          alreadyConfigured: profile.points.length - fresh.length,
        };
        this.profileError = '';
      } catch (e) {
        this.profileImport = null;
        this.profileError = (e as Error).message;
      }
      this.cdr.markForCheck();
    });
  }

  /** Add the chosen groups' points to the time series. */
  applyProfile(): void {
    const points = (this.profileImport?.groups ?? [])
      .filter(group => group.selected)
      .flatMap(group => group.points.map(point => point.point));
    const control = this.deviceForm.get('timeseries');
    control.setValue([...(control.value as Dnp3PointKey[]), ...points]);
    control.markAsDirty();
    this.profileImport = null;
  }

  manageKeys($event: Event, matButton: MatButton, keysType: Dnp3ValueKey): void {
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
      [Dnp3ValueKey.TIMESERIES]: 'gateway.gw-timeseries',
      [Dnp3ValueKey.ATTRIBUTES]: 'gateway.attributes',
      [Dnp3ValueKey.ATTRIBUTES_UPDATES]: 'gateway.gw-attribute-updates',
      [Dnp3ValueKey.RPC]: 'gateway.gw-rpc-methods',
    };
    const ctx = {
      keys: keysControl.value,
      keysType,
      panelTitle: panelTitles[keysType],
      addKeyTitle: keysType === Dnp3ValueKey.RPC ? 'gateway.gw-add-method' : 'gateway.gw-add-key',
      deleteKeyTitle: 'gateway.gw-delete-key',
      noKeysText: 'gateway.gw-no-keys-configured-hint',
      securityStatistics: this.data.secureAuthSupported !== false,
    };
    this.keysPopupClosed = false;
    this.popoverComponent = this.popoverService.displayPopover(
      trigger,
      this.renderer,
      this.viewContainerRef,
      Dnp3DataKeysPanelComponent,
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
      .subscribe((keysData: Dnp3Keys) => {
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

  private uniqueName() {
    return (control: AbstractControl): ValidationErrors | null => {
      const name = (control.value ?? '').trim();
      const taken = (this.data?.otherDevices ?? []).some(d => (d.deviceName ?? '').trim() === name);
      return name && taken ? { duplicateName: true } : null;
    };
  }

  /** Master and outstation differ, and no other device on the channel has the outstation's address. */
  private addressesValid(group: AbstractControl): ValidationErrors | null {
    const master = group.get('masterAddress')?.value;
    const outstation = group.get('outstationAddress')?.value;
    const channel = group.get('channel')?.value;
    if (master !== null && master === outstation) {
      return { sameAddress: true };
    }
    const taken = (this.data?.otherDevices ?? [])
      .some(d => d.channel === channel && d.outstationAddress === outstation);
    return taken ? { outstationAddressTaken: true } : null;
  }
}
