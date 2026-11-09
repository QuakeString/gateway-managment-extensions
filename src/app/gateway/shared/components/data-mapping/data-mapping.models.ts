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

import { Type } from '@angular/core';
import { PopoverPlacement } from '@shared/components/popover.models';

/** A button beside a row's edit button: browse, scan… */
export interface DataMappingAction {
  icon: string;
  /** Translation key, or one picked at render time. */
  tooltip: string | (() => string);
  run: () => void;
  disabled?: () => boolean;
  visible?: () => boolean;
}

/** One list of a device's data mapping: timeseries, attributes, RPC… */
export interface DataMappingRow {
  /** The form control holding the list, also the keys type the panel gets. */
  key: string;
  /** Translation key of the row's title. */
  label: string;
  /** Translation key of a hint shown as an (i) beside the title. */
  hint?: string;
  /** What a chip shows for one entry of the list. */
  chip: (entry: any) => string;
  actions?: DataMappingAction[];
}

/** How a row's edit button edits its list. */
export interface DataMappingPanel {
  /** The keys panel: an input per context property, `keysDataApplied` and optionally `cancelled`. */
  component: Type<any>;
  /** The panel's inputs for a row, the current list included. */
  context: (row: DataMappingRow, keys: any[]) => Record<string, any>;
  placement?: PopoverPlacement;
}
