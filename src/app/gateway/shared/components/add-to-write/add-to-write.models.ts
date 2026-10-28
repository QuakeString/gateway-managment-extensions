///
/// Copyright © 2016-2025 The SENTIENT Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///

/**
 * "Add to RPC write" / "Add to attribute updates": turn keys a device
 * already reads (time series, attributes) into write entries with the
 * same address and data type. The result is a plain copy in the
 * connector's own RPC / attribute-update format, so the gateway needs
 * nothing new.
 */

export type WriteTarget = 'rpc' | 'attributeUpdates';

export const WRITE_TARGETS: WriteTarget[] = ['rpc', 'attributeUpdates'];

/** How one connector maps a read key onto a write entry. Keys are the
 *  persisted shape the keys panel emits on Apply. */
export interface WriteAdapter {
  /** The read key's name (`tag`, `key`, …). */
  keyName(key: any): string;
  /** Where the key reads from, as shown. Compared with `entryAddress`
   *  through `normaliseAddress`. */
  address(key: any): string;
  /** What `entryAddress` is compared with, when it differs from the
   *  shown address. */
  matchAddress?(key: any): string;
  /** Data type shown in the dialog; empty when the device decides. */
  dataType(key: any): string;
  /** How the write goes out, e.g. "06 Write register". Optional. */
  writesWith?(key: any, target: WriteTarget): string;
  /** A translation key saying why this key can't be written, or null. */
  blocked?(key: any, target: WriteTarget): string | null;
  /** The new write entry, named `name`. */
  toEntry(key: any, name: string, target: WriteTarget): any;
  /** An existing entry's method name / attribute name. */
  entryName(entry: any, target: WriteTarget): string;
  /** An existing entry's address, in the same notation as `address()`. */
  entryAddress(entry: any, target: WriteTarget): string;
}

/** What a device dialog hands its keys panel so the panel can offer
 *  the action. Absent means the panel shows no selection at all. */
export interface KeysWriteHandler {
  targets: WriteTarget[];
  /** True when a read key (panel's persisted shape) already has a
   *  write entry at the same address. */
  isWritten(key: any): boolean;
  /** Open the confirm dialog for these keys and, on confirm, append
   *  the entries to the device's RPC / attribute-update list. `done`
   *  gets the number of entries added (0 when cancelled). */
  add(target: WriteTarget, keys: any[], done?: (added: number) => void): void;
}

export const normaliseAddress = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).trim().toUpperCase();
