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
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { SharedModule } from '@shared/public-api';
import { DeviceService } from '@core/public-api';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import {
  rpcBody,
  samePort,
  SerialPortInfo,
  SerialPortsAnswer,
  SerialPortsProblem,
} from './serial-port.models';

interface PortRow {
  port: SerialPortInfo;
  desc: string;
  inUse: string;
}

/**
 * The Port field of a serial connection: free text, with the serial ports
 * the gateway can see offered below it. Typing filters the list; what is
 * typed is used as it is when nothing is picked. In Docker with nothing
 * passed in, the list explains the compose lines instead.
 */
@Component({
  selector: 'st-serial-port-field',
  templateUrl: './serial-port-field.component.html',
  styleUrls: ['./serial-port-field.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule, ReactiveFormsModule, CdkOverlayOrigin, CdkConnectedOverlay],
})
export class SerialPortFieldComponent {

  readonly control = input.required<FormControl<string>>();
  /** The gateway device; without it there is nothing to ask. */
  readonly gatewayDeviceId = input<string>();
  /** The list as the gateway gave it, for the dialog's auto detect. */
  readonly portsChange = output<SerialPortsAnswer>();

  readonly open = signal(false);
  readonly loading = signal(false);
  readonly answer = signal<SerialPortsAnswer>(null);
  readonly problem = signal<SerialPortsProblem>(null);
  /** The user typed since the list opened: filter by it. */
  readonly typed = signal(false);
  readonly active = signal(-1);
  readonly copied = signal(false);
  readonly width = signal(0);

  readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];

  private readonly deviceService = inject(DeviceService);
  private readonly translate = inject(TranslateService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly field = viewChild<ElementRef<HTMLElement>>('field');
  private readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('inputEl');
  private request: Subscription;
  private copyTimer: ReturnType<typeof setTimeout>;

  /** The control's value, kept as a signal for the list's filter. */
  private readonly value = signal('');

  readonly isWindows = computed(() => this.answer()?.os === 'windows');
  readonly inDocker = computed(() => !!this.answer()?.container && !this.isWindows());
  readonly placeholder = computed(() => this.isWindows() ? 'COM3' : '/dev/ttyUSB0');

  readonly title = computed(() => {
    const a = this.answer();
    if (!a) {
      return this.translate.instant('gateway.serial.ports-title');
    }
    const key = a.os === 'windows' ? 'gateway.serial.ports-title-windows'
      : a.container ? 'gateway.serial.ports-title-docker' : 'gateway.serial.ports-title-linux';
    return this.translate.instant(key);
  });

  readonly rows = computed<PortRow[]>(() => {
    const ports = this.answer()?.ports ?? [];
    const query = this.typed() ? (this.value() ?? '').trim().toLowerCase() : '';
    return ports
      .map(port => ({
        port,
        desc: this.describe(port),
        inUse: port.inUse?.length
          ? this.translate.instant('gateway.serial.in-use', { name: port.inUse.join(', ') })
          : '',
      }))
      .filter(row => !query
        || row.port.path.toLowerCase().includes(query)
        || (row.port.byId ?? '').toLowerCase().includes(query)
        || row.desc.toLowerCase().includes(query));
  });

  readonly noPorts = computed(() => !!this.answer() && !this.answer().ports.length);
  readonly noMatch = computed(() => !!this.answer()?.ports.length && !this.rows().length);
  readonly noAccess = computed(() => this.rows().map(r => r.port).filter(p => !p.access));
  readonly groupHint = computed(() => {
    const groups = [...new Set(this.noAccess().map(p => p.group).filter(g => g !== undefined && g !== null))];
    return groups.join(', ');
  });

  /** The compose lines for a gateway in Docker that sees no port. */
  readonly composeSnippet = computed(() => {
    const typed = (this.value() ?? '').trim();
    const path = typed.startsWith('/dev/') ? typed : '/dev/ttyUSB0';
    return [
      'devices:',
      `  - ${path}:${path}`,
      'group_add:',
      `  # ${this.translate.instant('gateway.serial.compose-group-comment')}`,
      `  # stat -c %g ${path}`,
      '  - "20"',
    ].join('\n');
  });

  constructor() {
    effect((onCleanup) => {
      const control = this.control();
      this.value.set(control.value ?? '');
      const sub = control.valueChanges.subscribe(v => this.value.set(v ?? ''));
      onCleanup(() => sub.unsubscribe());
    });
    inject(DestroyRef).onDestroy(() => {
      this.request?.unsubscribe();
      clearTimeout(this.copyTimer);
    });
  }

  show(): void {
    if (this.control().disabled) {
      return;
    }
    if (!this.open()) {
      this.width.set(this.field()?.nativeElement.getBoundingClientRect().width ?? 320);
      this.typed.set(false);
      this.active.set(-1);
      this.open.set(true);
    }
    if (!this.answer() && !this.loading()) {
      this.load();
    }
  }

  hide(): void {
    this.open.set(false);
  }

  toggle(event: MouseEvent): void {
    event.preventDefault();
    if (this.open()) {
      this.hide();
    } else {
      this.inputEl()?.nativeElement.focus();
      this.show();
    }
  }

  onInput(): void {
    this.show();
    this.typed.set(true);
    this.active.set(-1);
  }

  onBlur(): void {
    // A click in the list keeps the focus (mousedown is prevented there);
    // anything else closes it.
    this.hide();
  }

  onKey(event: KeyboardEvent): void {
    const rows = this.rows();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.show();
        this.active.set(rows.length ? (this.active() + 1) % rows.length : -1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.show();
        this.active.set(rows.length ? (this.active() <= 0 ? rows.length - 1 : this.active() - 1) : -1);
        break;
      case 'Enter':
        if (this.open() && this.active() >= 0 && rows[this.active()]) {
          event.preventDefault();
          this.pick(rows[this.active()].port);
        }
        break;
      case 'Escape':
        if (this.open()) {
          event.stopPropagation();
          this.hide();
        }
        break;
    }
  }

  pick(port: SerialPortInfo): void {
    const control = this.control();
    control.setValue(port.path);
    control.markAsDirty();
    control.markAsTouched();
    this.hide();
  }

  isCurrent(port: SerialPortInfo): boolean {
    return samePort(port.path, this.value());
  }

  refresh(event: MouseEvent): void {
    event.preventDefault();
    this.load();
  }

  copy(event: MouseEvent): void {
    event.preventDefault();
    const text = this.composeSnippet();
    const done = () => {
      this.copied.set(true);
      clearTimeout(this.copyTimer);
      this.copyTimer = setTimeout(() => this.copied.set(false), 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => this.copyFallback(text, done));
    } else {
      this.copyFallback(text, done);
    }
  }

  private copyFallback(text: string, done: () => void): void {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    this.host.nativeElement.appendChild(area);
    area.select();
    try {
      if (document.execCommand('copy')) {
        done();
      }
    } finally {
      area.remove();
      this.inputEl()?.nativeElement.focus();
    }
  }

  load(): void {
    const id = this.gatewayDeviceId();
    if (!id) {
      this.problem.set('unreachable');
      return;
    }
    this.request?.unsubscribe();
    this.loading.set(true);
    this.problem.set(null);
    this.request = this.deviceService.sendTwoWayRpcCommand(id, {
      method: 'gateway_serial_ports',
      params: {},
      timeout: 10000,
    }, { ignoreLoading: true, ignoreErrors: true }).subscribe({
      next: (response) => {
        const body = rpcBody(response);
        this.loading.set(false);
        if (Array.isArray(body?.ports)) {
          const answer: SerialPortsAnswer = {
            os: body.os ?? 'linux',
            container: !!body.container,
            ports: body.ports,
          };
          this.answer.set(answer);
          this.portsChange.emit(answer);
        } else {
          // An older gateway: the method is not there.
          this.problem.set('unsupported');
        }
      },
      error: () => {
        this.loading.set(false);
        this.problem.set('unreachable');
      },
    });
  }

  private describe(port: SerialPortInfo): string {
    const parts: string[] = [this.translate.instant(`gateway.serial.kind-${port.kind ?? 'generic'}`)];
    const name = port.product
      ? (port.manufacturer && !port.product.toLowerCase().includes(port.manufacturer.toLowerCase().split(' ')[0])
        ? `${port.manufacturer} ${port.product}` : port.product)
      : port.chip;
    if (name) {
      parts.push(name);
    }
    if (port.usbId) {
      parts.push(port.usbId);
    }
    if (port.kind === 'builtin' && port.bus === 'RS-485') {
      parts.push(this.translate.instant('gateway.serial.rs485-in-os'));
    }
    return parts.join(' · ');
  }
}
