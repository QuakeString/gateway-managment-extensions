///
/// Copyright © 2016-2025 The SENTIENT Authors
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
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  NgZone,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AttributeData,
  AttributeScope,
  EntityType,
  SharedModule,
  TelemetrySubscriber,
} from '@shared/public-api';
import { DeviceService, TelemetryWebsocketService } from '@core/public-api';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import {
  rpcBody,
  samePort,
  SERIAL_SCAN_ATTRIBUTE,
  SerialScanChoice,
  SerialScanDevice,
  SerialScanScope,
  SerialScanState,
} from './serial-port.models';

interface FoundRow {
  device: SerialScanDevice;
  line: string;
  identity: string;
  orders: string;
  reply: string;
}

/**
 * Auto detect for a Modbus serial port: the gateway walks the line
 * settings and unit IDs and reports the devices that answer. Progress
 * arrives as the gateway's `serialScan` client attribute over the
 * websocket; nothing is polled.
 */
@Component({
  selector: 'st-modbus-serial-scan',
  templateUrl: './modbus-serial-scan.component.html',
  styleUrls: ['./modbus-serial-scan.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule],
})
export class ModbusSerialScanComponent {

  readonly gatewayDeviceId = input.required<string>();
  readonly port = input.required<string>();
  /** The dialog's stop bits, reported for no-parity lines when it is 2. */
  readonly stopbits = input<number>(1);
  /** Connectors the gateway says use this port. */
  readonly inUse = input<string[]>([]);

  readonly use = output<SerialScanChoice>();
  readonly closed = output<void>();

  readonly scope = signal<SerialScanScope>('quick');
  /** The scan this panel follows. */
  readonly jobId = signal<number>(null);
  readonly starting = signal(false);
  readonly error = signal<string>(null);
  readonly picked = signal(0);
  /** The gateway's latest `serialScan`, whichever scan it is. */
  private readonly remote = signal<SerialScanState>(null);
  /** The scan already running when the panel opened was looked at once. */
  private adopted = false;

  readonly scan = computed(() => {
    const remote = this.remote();
    return remote && remote.id === this.jobId() ? remote : null;
  });

  readonly phase = computed<'idle' | 'running' | 'done'>(() => {
    if (this.jobId() === null && !this.starting()) {
      return 'idle';
    }
    const state = this.scan()?.state;
    return !state || state === 'running' ? 'running' : 'done';
  });

  readonly percent = computed(() => {
    const scan = this.scan();
    return scan?.total ? Math.min(100, Math.round(scan.done * 100 / scan.total)) : 0;
  });

  readonly probeText = computed(() => {
    const probe = this.scan()?.probe;
    return probe
      ? this.translate.instant('gateway.serial.scan-trying', { probe })
      : this.translate.instant('gateway.serial.scan-preparing');
  });

  readonly remainText = computed(() => {
    const eta = this.scan()?.etaSeconds;
    if (eta === null || eta === undefined) {
      return '';
    }
    return eta > 90
      ? this.translate.instant('gateway.serial.scan-minutes-left', { n: Math.round(eta / 60) })
      : this.translate.instant('gateway.serial.scan-seconds-left', { n: Math.max(1, Math.round(eta)) });
  });

  readonly rows = computed<FoundRow[]>(() => (this.scan()?.found ?? []).map(device => ({
    device,
    line: `${device.baudrate} · ${device.bytesize}${device.parity}${device.stopbits}`,
    identity: [device.vendor, device.product].filter(Boolean).join(' · '),
    orders: device.byteOrder && device.wordOrder
      ? this.translate.instant('gateway.serial.scan-orders', {
        byte: this.orderLabel(device.byteOrder),
        word: this.orderLabel(device.wordOrder),
      })
      : '',
    reply: this.translate.instant(device.reply === 'exception'
      ? 'gateway.serial.scan-reply-exception' : 'gateway.serial.scan-reply-data'),
  })));

  readonly foundTitle = computed(() => {
    const count = this.rows().length;
    if (this.phase() === 'running') {
      return this.translate.instant('gateway.serial.scan-found-so-far');
    }
    return count === 1
      ? this.translate.instant('gateway.serial.scan-found-one')
      : this.translate.instant('gateway.serial.scan-found-many', { n: count });
  });

  readonly failure = computed(() => this.error() ?? (this.scan()?.state === 'failed'
    ? this.translate.instant('gateway.serial.scan-failed', { error: this.scan().error ?? '' }) : null));

  readonly nothingFound = computed(() => this.phase() === 'done' && !this.failure() && !this.rows().length);

  readonly scopeText = computed(() => this.translate.instant(this.scope() === 'quick'
    ? 'gateway.serial.scan-quick-text' : 'gateway.serial.scan-thorough-text'));

  private readonly deviceService = inject(DeviceService);
  private readonly telemetryWsService = inject(TelemetryWebsocketService);
  private readonly translate = inject(TranslateService);
  private readonly zone = inject(NgZone);
  private subscriber: TelemetrySubscriber;
  private dataSub: Subscription;
  private request: Subscription;

  constructor() {
    effect((onCleanup) => {
      this.follow(this.gatewayDeviceId());
      onCleanup(() => this.unfollow());
    });
    // Pick the first device as soon as one is there.
    effect(() => {
      if (this.picked() >= this.rows().length && this.rows().length) {
        this.picked.set(0);
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.request?.unsubscribe();
      // Closing the dialog ends the search: the connector is paused for it.
      if (this.phase() === 'running') {
        this.sendStop();
      }
    });
  }

  pickScope(scope: SerialScanScope): void {
    this.scope.set(scope);
  }

  start(): void {
    this.request?.unsubscribe();
    this.error.set(null);
    this.picked.set(0);
    this.starting.set(true);
    this.jobId.set(null);
    this.request = this.deviceService.sendTwoWayRpcCommand(this.gatewayDeviceId(), {
      method: 'gateway_serial_scan',
      params: {
        port: this.port().trim(),
        scope: this.scope(),
        stopbits: Number(this.stopbits()) || 1,
      },
      timeout: 10000,
    }, { ignoreLoading: true, ignoreErrors: true }).subscribe({
      next: (response) => {
        const body = rpcBody(response);
        this.starting.set(false);
        if ((body.code === 200 || body.code === 409) && body.id !== undefined) {
          // 409: a search is running already; follow it.
          this.jobId.set(Number(body.id));
        } else {
          this.error.set(body.code === 501 || body.code === 404 || body.code === undefined
            ? this.translate.instant('gateway.serial.scan-unsupported')
            : (body.error ?? this.translate.instant('gateway.serial.unreachable')));
        }
      },
      error: () => {
        this.starting.set(false);
        this.error.set(this.translate.instant('gateway.serial.unreachable'));
      },
    });
  }

  stop(): void {
    this.sendStop();
  }

  again(): void {
    this.jobId.set(null);
    this.error.set(null);
    this.picked.set(0);
  }

  close(): void {
    if (this.phase() === 'running') {
      this.sendStop();
    }
    this.closed.emit();
  }

  apply(): void {
    const row = this.rows()[this.picked()];
    if (!row) {
      return;
    }
    const d = row.device;
    const choice: SerialScanChoice = {
      unitId: d.unit,
      baudrate: d.baudrate,
      bytesize: d.bytesize,
      parity: d.parity,
      stopbits: d.stopbits,
    };
    if (d.byteOrder && d.wordOrder) {
      choice.byteOrder = d.byteOrder.toUpperCase();
      choice.wordOrder = d.wordOrder.toUpperCase();
    }
    this.use.emit(choice);
  }

  private sendStop(): void {
    this.deviceService.sendTwoWayRpcCommand(this.gatewayDeviceId(), {
      method: 'gateway_serial_scan_stop',
      params: {},
      timeout: 10000,
    }, { ignoreLoading: true, ignoreErrors: true }).subscribe({ error: () => {} });
  }

  private follow(deviceId: string): void {
    if (!deviceId) {
      return;
    }
    this.subscriber = TelemetrySubscriber.createEntityAttributesSubscription(
      this.telemetryWsService, { entityType: EntityType.DEVICE, id: deviceId },
      AttributeScope.CLIENT_SCOPE, this.zone, [SERIAL_SCAN_ATTRIBUTE]);
    this.dataSub = this.subscriber.attributeData$().subscribe((data: AttributeData[]) => {
      const entry = data?.find(a => a.key === SERIAL_SCAN_ATTRIBUTE);
      const state = this.parse(entry?.value);
      if (!state) {
        return;
      }
      this.remote.set(state);
      // A search on this port already running when the panel opened.
      if (!this.adopted) {
        this.adopted = true;
        if (state.state === 'running' && this.jobId() === null && samePort(state.port, this.port())) {
          this.jobId.set(state.id);
        }
      }
    });
    this.subscriber.subscribe();
  }

  private unfollow(): void {
    this.dataSub?.unsubscribe();
    this.subscriber?.unsubscribe();
    this.dataSub = null;
    this.subscriber = null;
  }

  private parse(value: unknown): SerialScanState {
    let state: any = value;
    if (typeof value === 'string') {
      try {
        state = JSON.parse(value);
      } catch {
        return null;
      }
    }
    return state && typeof state === 'object' && state.id !== undefined ? { ...state, id: Number(state.id) } : null;
  }

  private orderLabel(order: string): string {
    return this.translate.instant(order.toUpperCase() === 'LITTLE' ? 'gateway.serial.order-little' : 'gateway.serial.order-big');
  }
}
