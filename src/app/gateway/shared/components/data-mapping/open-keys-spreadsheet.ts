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

import { TbPopoverComponent } from '@shared/components/popover.component';

/**
 * Switch a just-opened keys panel to its full-screen spreadsheet (what a
 * right-click on a row's edit button asks for). The panel's shell exists
 * once the popover has rendered, so this waits for it a few frames; a
 * panel without a spreadsheet (BACnet, Socket) is left as it opened.
 */
export function openKeysSpreadsheet(popover: TbPopoverComponent<any>, tries = 20): void {
  const shell = popover?.tbComponentRef?.instance?.shell;
  if (shell?.toggleFullscreen) {
    if (!shell.isFullscreen && shell.spreadsheetColumns?.length) {
      shell.toggleFullscreen();
    }
    return;
  }
  if (tries > 0 && popover && !popover.tbHidden) {
    requestAnimationFrame(() => openKeysSpreadsheet(popover, tries - 1));
  }
}
