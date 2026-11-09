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

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  Renderer2,
  ViewContainerRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { SharedModule } from '@shared/public-api';
import { TbPopoverService } from '@shared/components/popover.service';
import { TbPopoverComponent } from '@shared/components/popover.component';
import { EllipsisChipListDirective } from '../../directives/ellipsis-chip-list.directive';
import { DataMappingAction, DataMappingPanel, DataMappingRow } from './data-mapping.models';
import { openKeysSpreadsheet } from './open-keys-spreadsheet';

/** Anything with `subscribe` that hands back something to unsubscribe:
 *  an EventEmitter, or a signal `output()`. */
interface Subscribable {
  subscribe(next: (value: any) => void): { unsubscribe(): void };
}

/**
 * A device's data mapping: one row per list (timeseries, attributes, …)
 * with its entries as chips, an edit button opening the connector's keys
 * panel, and the connector's own buttons after it. The same in every
 * connector's device dialog.
 */
@Component({
  selector: 'st-data-mapping',
  templateUrl: './data-mapping.component.html',
  styleUrls: ['./data-mapping.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule, EllipsisChipListDirective],
})
export class DataMappingComponent implements OnDestroy {

  @Input() form: FormGroup;
  @Input() rows: DataMappingRow[] = [];
  @Input() panel: DataMappingPanel;
  /** True while a keys panel is open: the dialog keeps Save and Cancel back. */
  @Output() panelOpen = new EventEmitter<boolean>();

  private popover: TbPopoverComponent<any>;
  private subscriptions: { unsubscribe(): void }[] = [];

  constructor(private popoverService: TbPopoverService,
              private renderer: Renderer2,
              private viewContainerRef: ViewContainerRef,
              private cd: ChangeDetectorRef) {
  }

  ngOnDestroy(): void {
    this.unsubscribe();
  }

  entries(row: DataMappingRow): any[] {
    return this.form?.get(row.key)?.value || [];
  }

  tooltip(action: DataMappingAction): string {
    return typeof action.tooltip === 'function' ? action.tooltip() : action.tooltip;
  }

  /** Right-click on edit: the keys straight in the full-screen spreadsheet. */
  editAsSpreadsheet($event: MouseEvent, button: MatButton, row: DataMappingRow): void {
    $event.preventDefault();
    if (!this.popoverService.hasPopover(button._elementRef.nativeElement)) {
      this.edit($event, button, row);
    }
    openKeysSpreadsheet(this.popover);
  }

  edit($event: Event, button: MatButton, row: DataMappingRow): void {
    $event?.stopPropagation();
    if (this.popover && !this.popover.tbHidden) {
      this.popover.hide();
    }
    const trigger = button._elementRef.nativeElement;
    if (this.popoverService.hasPopover(trigger)) {
      this.popoverService.hidePopover(trigger);
      return;
    }
    const control = this.form.get(row.key);
    this.unsubscribe();
    this.panelOpen.emit(true);
    this.popover = this.popoverService.displayPopover(
      trigger,
      this.renderer,
      this.viewContainerRef,
      this.panel.component,
      this.panel.placement ?? 'leftTop',
      false,
      null,
      this.panel.context(row, control.value),
      {},
      {},
      {},
      true
    );
    const popover = this.popover;
    const panel = popover.tbComponentRef.instance;
    this.subscriptions.push((panel.keysDataApplied as Subscribable).subscribe(keys => {
      popover.hide();
      control.patchValue(keys);
      control.markAsDirty();
      this.cd.markForCheck();
    }));
    if (panel.cancelled) {
      this.subscriptions.push((panel.cancelled as Subscribable).subscribe(() => popover.hide()));
    }
    this.subscriptions.push(popover.tbHideStart.subscribe(() => {
      this.panelOpen.emit(false);
      this.cd.markForCheck();
    }));
  }

  private unsubscribe(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
    this.subscriptions = [];
  }
}
