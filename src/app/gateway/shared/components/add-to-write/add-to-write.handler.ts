///
/// Copyright © 2016-2025 The SENTIENT Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///

import { AbstractControl } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { AddToWriteDialogComponent, AddToWriteDialogData } from './add-to-write-dialog.component';
import { KeysWriteHandler, normaliseAddress, WRITE_TARGETS, WriteAdapter, WriteTarget } from './add-to-write.models';

export interface KeysWriteHandlerOptions {
  dialog: MatDialog;
  adapter: WriteAdapter;
  /** The form control holding the device's list for each target. A
   *  target without a control is not offered. */
  controls: Partial<Record<WriteTarget, AbstractControl>>;
  /** Called after entries were appended (e.g. markForCheck). */
  changed?: () => void;
}

/** The handler a device dialog passes to its time-series / attribute keys
 *  panel. Appends confirmed entries to the device's RPC or
 *  attribute-update control and marks it dirty, like a keys-panel Apply. */
export function createKeysWriteHandler(options: KeysWriteHandlerOptions): KeysWriteHandler {
  const { dialog, adapter, controls, changed } = options;
  const targets = WRITE_TARGETS.filter(t => !!controls[t]);
  const entries = (target: WriteTarget): any[] => {
    const value = controls[target]?.value;
    return Array.isArray(value) ? value : [];
  };
  return {
    targets,
    isWritten: (key: any) => {
      const address = normaliseAddress(adapter.matchAddress ? adapter.matchAddress(key) : adapter.address(key));
      return !!address && targets.some(t => entries(t).some(e => normaliseAddress(adapter.entryAddress(e, t)) === address));
    },
    add: (target: WriteTarget, keys: any[], done?: (added: number) => void) => {
      const control = controls[target];
      if (!control || !keys.length) {
        return;
      }
      dialog.open<AddToWriteDialogComponent, AddToWriteDialogData, any[] | null>(AddToWriteDialogComponent, {
        disableClose: true,
        autoFocus: false,
        panelClass: ['tb-dialog'],
        data: { target, adapter, keys, existing: entries(target) },
      }).afterClosed().subscribe(added => {
        if (added?.length) {
          control.patchValue([...entries(target), ...added]);
          control.markAsDirty();
          changed?.();
        }
        done?.(added?.length ?? 0);
      });
    },
  };
}
