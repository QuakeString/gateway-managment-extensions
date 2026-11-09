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

import { ChangeDetectorRef, Directive, inject, Inject, OnDestroy } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  UntypedFormGroup,
  Validators,
} from '@angular/forms';
import {
  ModbusBaudrates,
  ModbusByteSizes,
  ModbusDefaultRetries,
  ModbusMethodLabelsMap,
  ModbusMethodType,
  ModbusOrderType,
  ModbusParity,
  ModbusParityLabelsMap,
  ModbusProtocolLabelsMap,
  ModbusProtocolType,
  ModbusSerialMethodType,
  ModbusSlaveInfo,
  PortLimits,
} from '../../../models/public-api';
import {
  noLeadTrailSpacesRegex,
  ReportStrategyDefaultValue,
} from '../../../../../shared/public-api';
import { Subject } from 'rxjs';
import { DialogComponent, helpBaseUrl } from '@shared/public-api';
import { Store } from '@ngrx/store';
import { AppState, isEqual, isNumber } from '@core/public-api';
import { Router } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import {
  ModbusOrderChoice,
  ModbusOrderDetectData,
  ModbusOrderHelpData,
} from '../modbus-order-dialogs/modbus-order.models';
import { ModbusOrderDetectDialogComponent } from '../modbus-order-dialogs/modbus-order-detect-dialog.component';
import { ModbusOrderHelpDialogComponent } from '../modbus-order-dialogs/modbus-order-help-dialog.component';
import { takeUntil } from 'rxjs/operators';
import { DeviceDialogView, initialDeviceDialogView } from '../../../../../shared/public-api';

@Directive()
export abstract class ModbusSlaveDialogAbstract<Component, Config> extends DialogComponent<Component, Config> implements OnDestroy {

  slaveConfigFormGroup: UntypedFormGroup;
  /** Connection or data mapping: a saved device opens on its data mapping. */
  view: DeviceDialogView;
  showSecurityControl: FormControl<boolean>;
  portLimits = PortLimits;

  readonly modbusProtocolTypes = Object.values(ModbusProtocolType);
  readonly modbusMethodTypes = Object.values(ModbusMethodType);
  readonly modbusSerialMethodTypes = Object.values(ModbusSerialMethodType);
  readonly modbusParities = Object.values(ModbusParity);
  readonly modbusByteSizes = ModbusByteSizes;
  readonly modbusBaudrates = ModbusBaudrates;
  readonly modbusOrderType = Object.values(ModbusOrderType);
  readonly ModbusProtocolType = ModbusProtocolType;
  readonly ModbusParityLabelsMap = ModbusParityLabelsMap;
  readonly ModbusProtocolLabelsMap = ModbusProtocolLabelsMap;
  readonly ModbusMethodLabelsMap = ModbusMethodLabelsMap;
  readonly ReportStrategyDefaultValue = ReportStrategyDefaultValue;
  readonly modbusHelpLink =
    helpBaseUrl + '/docs/iot-gateway/config/modbus/#section-master-description-and-configuration-parameters';

  private readonly serialSpecificControlKeys = ['serialPort', 'baudrate', 'stopbits', 'bytesize', 'parity', 'strict'];
  private readonly tcpUdpSpecificControlKeys = ['port', 'security', 'host'];

  private destroy$ = new Subject<void>();
  private matDialog = inject(MatDialog);
  private cdr = inject(ChangeDetectorRef);

  constructor(
    protected fb: FormBuilder,
    protected store: Store<AppState>,
    protected router: Router,
    @Inject(MAT_DIALOG_DATA) public data: ModbusSlaveInfo,
    public dialogRef: MatDialogRef<Component, Config>,
  ) {
    super(store, router, dialogRef);

    this.view = initialDeviceDialogView(this.data?.buttonTitle === 'action.apply');
    this.showSecurityControl = this.fb.control(false);
    this.initializeSlaveFormGroup();
    this.updateSlaveFormGroup();
    this.updateControlsEnabling(this.data.value.type);
    this.observeTypeChange();
    this.observeShowSecurity();
    this.showSecurityControl.patchValue(!!this.data.value.security && !isEqual(this.data.value.security, {}));
  }

  get protocolType(): ModbusProtocolType {
    return this.slaveConfigFormGroup.get('type').value;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  add(): void {
    if (!this.slaveConfigFormGroup.valid) {
      return;
    }

    this.dialogRef.close(this.getSlaveResultData());
  }

  private initializeSlaveFormGroup(): void {
    this.slaveConfigFormGroup = this.fb.group({
      type: [ModbusProtocolType.TCP],
      host: ['', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
      port: [null, [Validators.required, Validators.min(PortLimits.MIN), Validators.max(PortLimits.MAX)]],
      serialPort: ['', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
      method: [ModbusMethodType.SOCKET, [Validators.required]],
      baudrate: [this.modbusBaudrates[0]],
      stopbits: [1],
      bytesize: [ModbusByteSizes[0]],
      parity: [ModbusParity.None],
      strict: [true],
      unitId: [null, [Validators.required]],
      deviceName: ['', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
      deviceType: ['', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
      timeout: [35],
      byteOrder: [ModbusOrderType.BIG],
      // CDAB: the usual PLC layout. A saved slave keeps whatever it has.
      wordOrder: [ModbusOrderType.LITTLE],
      retries: [ModbusDefaultRetries],
      retryOnEmpty: [true],
      retryOnInvalid: [true],
      pollPeriod: [1000, [Validators.required]],
      connectAttemptTimeMs: [500, [Validators.required]],
      connectAttemptCount: [5, [Validators.required]],
      waitAfterFailedAttemptsMs: [30000, [Validators.required]],
      values: [{}],
      security: [{}],
      redundancy: this.fb.group({
        enabled: [false],
        standbyHost: [''],
        standbyPort: [502, [Validators.min(1), Validators.max(65535)]],
        heartbeatIntervalMs: [2000, [Validators.min(100), Validators.max(30000)]],
        heartbeatTimeoutMs: [1000, [Validators.min(50), Validators.max(10000)]],
        failureThreshold: [3, [Validators.min(1), Validators.max(20)]],
      }),
    });
    this.addFieldsToFormGroup();
  }

  private updateSlaveFormGroup(): void {
    this.slaveConfigFormGroup.patchValue({
      ...this.data.value,
      port: this.data.value.type === ModbusProtocolType.Serial ? null : this.data.value.port,
      serialPort: this.data.value.type === ModbusProtocolType.Serial ? this.data.value.port : '',
      retries:  this.data.value.retries === false ? 0 :
        isNumber(this.data.value.retries) ? this.data.value.retries :
          ModbusDefaultRetries,
      values: {
        attributes: this.data.value.attributes ?? [],
        timeseries: this.data.value.timeseries ?? [],
        attributeUpdates: this.data.value.attributeUpdates ?? [],
        rpc: this.data.value.rpc ?? [],
      },
      redundancy: this.data.value.redundancy ?? {
        enabled: false,
        standbyHost: '',
        standbyPort: 502,
        heartbeatIntervalMs: 2000,
        heartbeatTimeoutMs: 1000,
        failureThreshold: 3,
      },
    });
  }

  private observeTypeChange(): void {
    this.slaveConfigFormGroup.get('type').valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(type => {
        this.updateControlsEnabling(type);
        this.updateMethodType(type);
      });
  }

  private updateMethodType(type: ModbusProtocolType): void {
    if (this.slaveConfigFormGroup.get('method').value !== ModbusMethodType.RTU) {
      this.slaveConfigFormGroup.get('method').patchValue(
        type === ModbusProtocolType.Serial
          ? ModbusSerialMethodType.ASCII
          : ModbusMethodType.SOCKET,
        {emitEvent: false}
      );
    }
  }

  private updateControlsEnabling(type: ModbusProtocolType): void {
    const [enableKeys, disableKeys] = type === ModbusProtocolType.Serial
      ? [this.serialSpecificControlKeys, this.tcpUdpSpecificControlKeys]
      : [this.tcpUdpSpecificControlKeys, this.serialSpecificControlKeys];

    enableKeys.forEach(key => this.slaveConfigFormGroup.get(key)?.enable({ emitEvent: false }));
    disableKeys.forEach(key => this.slaveConfigFormGroup.get(key)?.disable({ emitEvent: false }));

    this.updateSecurityEnabling(this.showSecurityControl.value);
  }

  private observeShowSecurity(): void {
    this.showSecurityControl.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(value => this.updateSecurityEnabling(value));
  }

  private updateSecurityEnabling(isEnabled: boolean): void {
    if (isEnabled && this.protocolType !== ModbusProtocolType.Serial) {
      this.slaveConfigFormGroup.get('security').enable({emitEvent: false});
    } else {
      this.slaveConfigFormGroup.get('security').disable({emitEvent: false});
    }
  }

  /** Detection asks the gateway, so it needs a saved connector and an address to reach. */
  get canDetectOrder(): boolean {
    const form = this.slaveConfigFormGroup;
    const reachable = this.protocolType === ModbusProtocolType.Serial
      ? form.get('serialPort').valid
      : form.get('host').valid && form.get('port').valid;
    return !!(this.data.gatewayDeviceId && this.data.connectorName) && reachable && form.get('unitId').valid;
  }

  get detectOrderHint(): string {
    if (!this.data.gatewayDeviceId || !this.data.connectorName) {
      return 'gateway.modbus-order.save-connector-first';
    }
    return this.canDetectOrder ? 'gateway.modbus-order.detect-hint' : 'gateway.modbus-order.fill-connection-first';
  }

  openOrderDetection(): void {
    if (!this.canDetectOrder) {
      return;
    }
    const { values, serialPort, security, ...rest } = this.slaveConfigFormGroup.value;
    const slave: Record<string, unknown> = { ...rest };
    for (const key of ['deviceName', 'deviceType', 'reportStrategy', 'redundancy', 'pollPeriod',
      'byteOrder', 'wordOrder', 'timeout', 'retries']) {
      delete slave[key];
    }
    if (this.protocolType === ModbusProtocolType.Serial) {
      slave.port = serialPort;
    } else if (security && this.showSecurityControl.value) {
      slave.security = security;
    }
    this.matDialog.open<ModbusOrderDetectDialogComponent, ModbusOrderDetectData, ModbusOrderChoice>(
      ModbusOrderDetectDialogComponent, {
        disableClose: true,
        panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
        data: {
          gatewayDeviceId: this.data.gatewayDeviceId,
          connectorName: this.data.connectorName,
          slave,
          current: this.currentOrder(),
        },
      }).afterClosed().subscribe(choice => this.applyOrder(choice));
  }

  openOrderHelp(): void {
    this.matDialog.open<ModbusOrderHelpDialogComponent, ModbusOrderHelpData, ModbusOrderChoice>(
      ModbusOrderHelpDialogComponent, {
        panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
        data: { selectable: true, current: this.currentOrder() },
      }).afterClosed().subscribe(choice => this.applyOrder(choice));
  }

  private currentOrder(): ModbusOrderChoice {
    return {
      byteOrder: this.slaveConfigFormGroup.get('byteOrder').value,
      wordOrder: this.slaveConfigFormGroup.get('wordOrder').value,
    };
  }

  private applyOrder(choice?: ModbusOrderChoice): void {
    if (choice) {
      this.slaveConfigFormGroup.patchValue({ byteOrder: choice.byteOrder, wordOrder: choice.wordOrder });
      this.slaveConfigFormGroup.markAsDirty();
      this.cdr.markForCheck();
    }
  }

  protected abstract addFieldsToFormGroup(): void;
  protected abstract getSlaveResultData(): Config;
}
