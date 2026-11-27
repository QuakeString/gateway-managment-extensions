///
/// Copyright © 2016-2026 The SENTIENT Authors
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

import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';

/** What a device dialog shows: how to reach the device, or what is read from it. */
export type DeviceDialogView = 'connection' | 'mapping';

/** The view a device dialog opens on: a new device starts on its connection,
 *  a saved one on its data mapping, the part that changes after commissioning. */
export function initialDeviceDialogView(isEdit: boolean): DeviceDialogView {
  return isEdit ? 'mapping' : 'connection';
}

/** Where a device dialog opens. The body grows with the open view (Data Mapping
 *  is short, Connection up to 670px), so a centred dialog would jump when the
 *  view changes. Pin its top where the full-height dialog would sit centred;
 *  phones keep the full-screen dialog. */
export function deviceDialogPosition(): { top: string } | undefined {
  return window.matchMedia('(min-width: 600px)').matches
    ? { top: 'max(16px, calc(50vh - 395px))' }
    : undefined;
}

/**
 * The Connection | Data Mapping switch in a device dialog's title bar,
 * the same in every connector's device dialog.
 */
@Component({
  selector: 'st-device-view-switch',
  template: `
    <tb-toggle-select class="st-device-view-switch" appearance="fill"
                      [ngModel]="view" (ngModelChange)="viewChange.emit($event)">
      <tb-toggle-option value="connection">{{ 'gateway.device-view-connection' | translate }}</tb-toggle-option>
      <tb-toggle-option value="mapping">{{ 'gateway.device-view-mapping' | translate }}</tb-toggle-option>
    </tb-toggle-select>
  `,
  styleUrls: ['./device-view-switch.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule],
})
export class DeviceViewSwitchComponent {
  @Input() view: DeviceDialogView = 'connection';
  @Output() viewChange = new EventEmitter<DeviceDialogView>();
}
