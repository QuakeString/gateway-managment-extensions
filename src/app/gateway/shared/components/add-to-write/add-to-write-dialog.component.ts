///
/// Copyright © 2016-2025 The SENTIENT Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///

import { ChangeDetectionStrategy, Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { DialogComponent, SharedModule } from '@shared/public-api';
import { Store } from '@ngrx/store';
import { AppState } from '@core/public-api';
import { Router } from '@angular/router';
import { normaliseAddress, WriteAdapter, WriteTarget } from './add-to-write.models';

export interface AddToWriteDialogData {
  target: WriteTarget;
  adapter: WriteAdapter;
  /** The ticked read keys, in the keys panel's persisted shape. */
  keys: any[];
  /** The device's current RPC / attribute-update entries. */
  existing: any[];
}

export type NamePattern = 'key' | 'set';

interface Row {
  key: string;
  address: string;
  dataType: string;
  writesWith: string;
  source: any;
  /** Set when the key is added. */
  name?: FormControl<string>;
  /** Translation key of why it is skipped. */
  skip?: string;
  skipArgs?: Record<string, string>;
  /** Address of the existing entry whose name this key's name clashed with. */
  clashAddress?: string;
}

/**
 * Lists the ticked keys with the write entry each becomes. A key whose
 * address already has an entry is skipped; a key whose name is taken by
 * an entry for another address gets the next free name (`name_2`), shown
 * in orange and editable.
 */
@Component({
  selector: 'st-add-to-write-dialog',
  templateUrl: './add-to-write-dialog.component.html',
  styleUrls: ['./add-to-write-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SharedModule],
})
export class AddToWriteDialogComponent extends DialogComponent<AddToWriteDialogComponent, any[] | null> {

  readonly pattern = new FormControl<NamePattern>('key');
  readonly rows: Row[];

  constructor(
    protected store: Store<AppState>,
    protected router: Router,
    @Inject(MAT_DIALOG_DATA) public data: AddToWriteDialogData,
    public dialogRef: MatDialogRef<AddToWriteDialogComponent, any[] | null>,
  ) {
    super(store, router, dialogRef);
    this.rows = this.buildRows();
    this.applyPattern();
    this.pattern.valueChanges.subscribe(() => this.applyPattern());
  }

  get isRpc(): boolean {
    return this.data.target === 'rpc';
  }

  get added(): Row[] {
    return this.rows.filter(r => r.name);
  }

  /** A name is wrong when it is empty, used by an existing entry, or used
   *  twice in this batch. */
  nameError(row: Row): string | null {
    const name = (row.name?.value ?? '').trim();
    if (!name) {
      return 'gateway.write-name-required';
    }
    if (this.existingNames().has(name) || this.added.filter(r => r !== row && r.name.value.trim() === name).length) {
      return 'gateway.write-name-in-use';
    }
    return null;
  }

  get valid(): boolean {
    return this.added.length > 0 && this.added.every(r => !this.nameError(r));
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  add(): void {
    if (!this.valid) {
      return;
    }
    const { adapter, target } = this.data;
    this.dialogRef.close(this.added.map(r => adapter.toEntry(r.source, r.name.value.trim(), target)));
  }

  private existingNames(): Set<string> {
    return new Set(this.data.existing.map(e => this.data.adapter.entryName(e, this.data.target)).filter(Boolean));
  }

  private buildRows(): Row[] {
    const { adapter, target, keys, existing } = this.data;
    const byAddress = new Map<string, string>();
    for (const e of existing) {
      const address = normaliseAddress(adapter.entryAddress(e, target));
      if (address && !byAddress.has(address)) {
        byAddress.set(address, adapter.entryName(e, target));
      }
    }
    const seen = new Set<string>();
    return keys.map(source => {
      const address = adapter.address(source);
      const match = normaliseAddress(adapter.matchAddress ? adapter.matchAddress(source) : address);
      const row: Row = {
        key: adapter.keyName(source),
        address,
        dataType: adapter.dataType(source),
        writesWith: adapter.writesWith ? adapter.writesWith(source, target) : '',
        source,
      };
      const blocked = adapter.blocked ? adapter.blocked(source, target) : null;
      if (blocked) {
        row.skip = blocked;
      } else if (match && byAddress.has(match)) {
        row.skip = 'gateway.write-already-written-by';
        row.skipArgs = { name: byAddress.get(match) };
      } else if (match && seen.has(match)) {
        row.skip = 'gateway.write-same-address-twice';
      } else {
        row.name = new FormControl('', { nonNullable: true });
      }
      if (match) {
        seen.add(match);
      }
      return row;
    });
  }

  /** Name each added key from the chosen pattern, stepping past names
   *  already taken (`name_2`, `name_3`, …). */
  private applyPattern(): void {
    const { adapter, target, existing } = this.data;
    const taken = new Map<string, string>();
    for (const e of existing) {
      const name = adapter.entryName(e, target);
      if (name) {
        taken.set(name, adapter.entryAddress(e, target));
      }
    }
    const prefix = this.pattern.value === 'set' ? 'set_' : '';
    for (const row of this.added) {
      const base = prefix + row.key;
      let name = base;
      for (let n = 2; taken.has(name); n++) {
        name = `${base}_${n}`;
      }
      row.clashAddress = name !== base ? taken.get(base) || '?' : undefined;
      taken.set(name, row.address);
      row.name.setValue(name);
    }
  }
}
