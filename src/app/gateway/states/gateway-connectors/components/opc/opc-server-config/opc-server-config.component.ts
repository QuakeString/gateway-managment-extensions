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

import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, forwardRef, Input, OnDestroy, Output } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
  OpcUaScanDialogComponent,
  OpcUaScanDialogData,
  OpcUaScanDialogResult,
} from '../opc-ua-scan-dialog/opc-ua-scan-dialog.component';
import {
  ControlValueAccessor,
  FormBuilder,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  UntypedFormGroup,
  ValidationErrors,
  Validator,
  Validators
} from '@angular/forms';
import {
  SecurityMode,
  SecurityPolicy,
  SecurityPolicyTypes,
  ServerConfig,
} from '../../../models/public-api';
import {
  ErrorTooltipIconComponent,
  noLeadTrailSpacesRegex,
  TruncateWithTooltipDirective
} from '../../../../../shared/public-api';
import { SharedModule, HOUR, coerceBoolean } from '@shared/public-api';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  SecurityConfigComponent
} from '../../security-config/security-config.component';
import { DeviceService } from '@core/public-api';

@Component({
  selector: 'tb-opc-server-config',
  templateUrl: './opc-server-config.component.html',
  styleUrls: ['./opc-server-config.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => OpcServerConfigComponent),
      multi: true
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => OpcServerConfigComponent),
      multi: true
    }
  ],
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    SecurityConfigComponent,
    TruncateWithTooltipDirective,
    ErrorTooltipIconComponent,
  ]
})
export class OpcServerConfigComponent implements ControlValueAccessor, Validator, AfterViewInit, OnDestroy {

  @Input()
  @coerceBoolean()
  hideNewFields: boolean = false;

  /** Threaded down from the connector form so we can invoke RPCs against the
   *  already-running gateway — needed by the Discover Endpoints button. */
  @Input() gatewayDeviceId: string;
  @Input() connectorName: string;

  /** Devices (with their picked tags) returned from the discovery dialog —
   *  the parent basic-config appends them to the mapping form. Server-
   *  config stays focused on the server tab's own fields; device rows
   *  live on the Data mapping tab. */
  @Output() devicesDiscovered = new EventEmitter<Array<{
    nodeId: string;
    displayName: string;
    tags: Array<{ key: string; value: string; type: string }>;
  }>>();

  discoverError: string | null = null;

  securityPolicyTypes = SecurityPolicyTypes;
  SecurityMode = SecurityMode;
  serverConfigFormGroup: UntypedFormGroup;

  onChange!: (value: ServerConfig) => void;
  onTouched!: () => void;

  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private deviceService: DeviceService,
    private dialog: MatDialog,
    private cd: ChangeDetectorRef,
  ) {
    this.serverConfigFormGroup = this.fb.group({
      url: ['', [Validators.required, Validators.pattern(noLeadTrailSpacesRegex)]],
      timeoutInMillis: [1000, [Validators.required, Validators.min(1000)]],
      scanPeriodInMillis: [HOUR, [Validators.required, Validators.min(1000)]],
      pollPeriodInMillis: [5000, [Validators.required, Validators.min(50)]],
      enableSubscriptions: [true, []],
      subCheckPeriodInMillis: [100, [Validators.required, Validators.min(100)]],
      showMap: [false, []],
      security: [SecurityPolicy.BASIC128, []],
      identity: []
    });

    this.serverConfigFormGroup.valueChanges.pipe(
      takeUntil(this.destroy$)
    ).subscribe((value) => {
      this.onChange(value);
      this.onTouched();
    });
  }

  ngAfterViewInit(): void {
    if (this.hideNewFields) {
      this.serverConfigFormGroup.get('pollPeriodInMillis').disable({emitEvent: false});
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  registerOnChange(fn: (value: ServerConfig) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  validate(): ValidationErrors | null {
    return this.serverConfigFormGroup.valid ? null : {
      serverConfigFormGroup: { valid: false }
    };
  }

  /**
   * Just opens the unified discovery dialog — the dialog itself owns the
   * URL input, Discover/Scan buttons, and cancel. The button here has no
   * loading state: opening a dialog is instant, and the dialog can be
   * closed any time.
   *
   * On apply the dialog returns `{endpointUrl, securityPolicy, devices}`;
   * URL + security get written into the form, devices (+ their picked
   * keys) are emitted upward so basic-config can append them to the
   * mapping form as new device rows.
   */
  discoverEndpoints(): void {
    if (!this.gatewayDeviceId || !this.connectorName) {
      this.discoverError = 'Save the connector first, then click Discover.';
      return;
    }
    this.discoverError = null;
    const url = this.serverConfigFormGroup.get('url')?.value || '';

    this.dialog.open<
      OpcUaScanDialogComponent,
      OpcUaScanDialogData,
      OpcUaScanDialogResult
    >(OpcUaScanDialogComponent, {
      data: {
        gatewayDeviceId: this.gatewayDeviceId,
        connectorName: this.connectorName,
        initialUrl: url || undefined,
        existingDeviceNodes: [],
      },
      // Fixed outer width + max-height so the dialog doesn't resize
      // based on inner content on desktop. `tb-fullscreen-dialog`
      // panel class flips the dialog to 100vw/100vh on mobile via
      // Sentient's global styles — mobile media query in the dialog's
      // own SCSS handles layout reflow (split becomes rows, etc.).
      width: '900px',
      maxWidth: '92vw',
      height: 'auto',
      maxHeight: '85vh',
      disableClose: false,
      // `opc-scan-dialog-panel` is the hook the scan dialog's SCSS uses
      // to force full-screen on xs + sm breakpoints (tb-fullscreen-
      // dialog only activates < 600px, but the dialog also needs it
      // up to 959px / tablets).
      panelClass: ['tb-dialog', 'tb-fullscreen-dialog', 'opc-scan-dialog-panel'],
      autoFocus: false,
    }).afterClosed().subscribe((result) => {
      if (!result) return;
      this.serverConfigFormGroup.get('url')?.setValue(result.endpointUrl);
      if (result.securityPolicy
          && this.securityPolicyTypes.some(p => p.value === result.securityPolicy)) {
        this.serverConfigFormGroup.get('security')?.setValue(result.securityPolicy);
      }
      this.serverConfigFormGroup.markAsDirty();
      if (result.devices?.length) {
        this.devicesDiscovered.emit(result.devices);
      }
      this.cd.markForCheck();
    });
  }

  writeValue(serverConfig: ServerConfig): void {
    const {
      timeoutInMillis = 1000,
      scanPeriodInMillis = HOUR,
      pollPeriodInMillis = 5000,
      enableSubscriptions = true,
      subCheckPeriodInMillis = 100,
      showMap = false,
      security = SecurityPolicy.BASIC128,
      identity = {},
    } = serverConfig;

    this.serverConfigFormGroup.reset({
      ...serverConfig,
      timeoutInMillis,
      scanPeriodInMillis,
      pollPeriodInMillis,
      enableSubscriptions,
      subCheckPeriodInMillis,
      showMap,
      security,
      identity,
    }, { emitEvent: false });
  }
}
