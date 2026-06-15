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

import { FormControl, FormGroup } from '@angular/forms';

export type SortDirection = 'asc' | 'desc';

export interface SortFieldOption {
  value: string;
  label: string;
}

export interface SelectOption {
  value: any;
  label: string;
}

export interface SpreadsheetColumnConfig {
  key: string;
  label: string;
  type: 'input' | 'number' | 'select' | 'checkbox';
  sortable?: boolean;
  options?: SelectOption[] | ((row: FormGroup) => SelectOption[]);
  width?: string;
  placeholder?: string;
  step?: number;
  headerClass?: string;
  cellClass?: string;
  uppercase?: boolean;
  translateLabels?: boolean;
  /** Translation key for the tooltip shown when the cell's control is invalid. */
  errorText?: string;
  cellVisible?: (row: FormGroup) => boolean;
  cellDisabled?: (row: FormGroup) => boolean;
  externalControl?: (row: FormGroup) => FormControl<boolean>;
  getValue?: (row: FormGroup) => any;
  setValue?: (row: FormGroup, value: any) => void;
}
