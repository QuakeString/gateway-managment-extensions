///
/// Copyright © 2016-2025 The Sentient Authors
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

import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { SharedModule } from '@shared/public-api';
import { DeviceService } from '@core/public-api';
import { SelectionModel } from '@angular/cdk/collections';

/** One node as returned by the gateway's `opcua_browseNode` RPC. */
interface BrowsedNode {
  nodeId: string;
  browseName: string;
  displayName: string;
  nodeClass: string;
  hasChildren: boolean;
  dataType?: string;
}

/** Tree-node wrapper for the UI: browsedNode plus local expand/select state.
 *  Rendered flat in a mat-table row — the `depth` field drives indentation. */
interface TreeNode {
  raw: BrowsedNode;
  depth: number;
  expanded: boolean;
  loading: boolean;
  loaded: boolean;
  loadError?: string;
  children: TreeNode[];
}

export interface OpcUaNodeBrowserDialogData {
  gatewayDeviceId: string;
  connectorName: string;
  /** Target controls which node class is selectable + how the result is returned.
   *   - 'timeseries' | 'attributes' → Variable nodes, result carries `tags`.
   *   - 'devices' → Object nodes (subtree anchors), result carries `devices`. */
  targetSection: 'timeseries' | 'attributes' | 'devices';
  /** Existing values (NodeIds for tags, or device-node paths) so already-mapped
   *  entries render dimmed. */
  existingValues: string[];
}

export interface OpcUaDeviceSelection {
  nodeId: string;
  displayName: string;
}

export interface OpcUaNodeBrowserDialogResult {
  tags?: Array<{ key: string; value: string; type: string }>;
  devices?: OpcUaDeviceSelection[];
  targetSection: 'timeseries' | 'attributes' | 'devices';
}

@Component({
  selector: 'tb-opc-ua-node-browser-dialog',
  templateUrl: './opc-ua-node-browser-dialog.component.html',
  styleUrls: ['./opc-ua-node-browser-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SharedModule],
})
export class OpcUaNodeBrowserDialogComponent {

  displayedColumns = ['select', 'name', 'nodeId', 'dataType'];
  rootChildren: TreeNode[] = [];
  displayNodes: TreeNode[] = [];

  selection = new SelectionModel<TreeNode>(true, []);
  textSearch = new FormControl('');
  loading = true;
  refreshing = false;
  loadError: string | null = null;

  private existingSet: Set<string>;

  constructor(
    private dialogRef: MatDialogRef<OpcUaNodeBrowserDialogComponent, OpcUaNodeBrowserDialogResult | null>,
    @Inject(MAT_DIALOG_DATA) public data: OpcUaNodeBrowserDialogData,
    private deviceService: DeviceService,
    private cd: ChangeDetectorRef,
  ) {
    this.existingSet = new Set((data.existingValues || []).map(v => v?.trim()).filter(Boolean));
    this.refresh();
    this.textSearch.valueChanges.subscribe(() => this.rebuildDisplay());
  }

  refresh(): void {
    this.refreshing = true;
    this.loading = true;
    this.loadError = null;
    this.rootChildren = [];
    this.selection.clear();
    this.cd.markForCheck();

    this.loadChildren(null).then(children => {
      this.rootChildren = children.map(n => this.wrap(n, 0));
      this.loading = false;
      this.refreshing = false;
      this.rebuildDisplay();
    }).catch(err => {
      this.loading = false;
      this.refreshing = false;
      this.loadError = err?.message || 'Failed to browse the OPC-UA server.';
      this.cd.markForCheck();
    });
  }

  toggleExpand(node: TreeNode, $event?: Event): void {
    if ($event) $event.stopPropagation();
    if (!node.raw.hasChildren) return;
    if (node.expanded) {
      node.expanded = false;
      this.rebuildDisplay();
      return;
    }
    node.expanded = true;
    if (!node.loaded && !node.loading) {
      node.loading = true;
      this.rebuildDisplay();
      this.loadChildren(node.raw.nodeId).then(children => {
        node.children = children.map(n => this.wrap(n, node.depth + 1));
        node.loaded = true;
        node.loading = false;
        this.rebuildDisplay();
      }).catch(err => {
        node.loading = false;
        node.loadError = err?.message || 'Failed to load';
        this.rebuildDisplay();
      });
    } else {
      this.rebuildDisplay();
    }
  }

  /** Selectable node classes depend on the target:
   *   - Tag modes → Variable nodes (they hold values).
   *   - Device mode → Object nodes (they're subtree anchors). */
  isSelectable(node: TreeNode): boolean {
    if (this.data.targetSection === 'devices') {
      return node.raw.nodeClass === 'Object';
    }
    return node.raw.nodeClass === 'Variable';
  }

  isExisting(node: TreeNode): boolean {
    return this.existingSet.has(node.raw.nodeId);
  }

  onRowClick(node: TreeNode): void {
    // Toggle selection on row click where selectable; otherwise expand/collapse.
    if (this.isSelectable(node) && !this.isExisting(node)) {
      this.selection.toggle(node);
      this.cd.markForCheck();
      return;
    }
    if (node.raw.hasChildren) {
      this.toggleExpand(node);
    }
  }

  isAllVisibleSelected(): boolean {
    const selectable = this.displayNodes.filter(n => this.isSelectable(n) && !this.isExisting(n));
    if (selectable.length === 0) return false;
    return selectable.every(n => this.selection.isSelected(n));
  }

  toggleAllVisible(): void {
    const selectable = this.displayNodes.filter(n => this.isSelectable(n) && !this.isExisting(n));
    if (this.isAllVisibleSelected()) {
      selectable.forEach(n => this.selection.deselect(n));
    } else {
      selectable.forEach(n => this.selection.select(n));
    }
    this.cd.markForCheck();
  }

  apply(): void {
    if (this.data.targetSection === 'devices') {
      const devices: OpcUaDeviceSelection[] = this.selection.selected
        .filter(n => this.isSelectable(n))
        .map(n => ({
          nodeId: n.raw.nodeId,
          displayName: n.raw.displayName || n.raw.browseName,
        }));
      this.dialogRef.close({ devices, targetSection: 'devices' });
      return;
    }
    const tags = this.selection.selected
      .filter(n => this.isSelectable(n))
      .map(n => ({
        key: n.raw.displayName || n.raw.browseName,
        value: n.raw.nodeId,
        type: this.mapDataType(n.raw.dataType),
      }));
    this.dialogRef.close({ tags, targetSection: this.data.targetSection });
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  trackByNodeId(_: number, node: TreeNode): string {
    return node.raw.nodeId;
  }

  get selectableVisibleCount(): number {
    return this.displayNodes.filter(n => this.isSelectable(n) && !this.isExisting(n)).length;
  }

  private wrap(raw: BrowsedNode, depth: number): TreeNode {
    return {
      raw,
      depth,
      expanded: false,
      loading: false,
      loaded: false,
      children: [],
    };
  }

  private rebuildDisplay(): void {
    const search = (this.textSearch.value || '').toLowerCase().trim();
    const out: TreeNode[] = [];
    const push = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        const matches = !search
          || n.raw.displayName.toLowerCase().includes(search)
          || n.raw.nodeId.toLowerCase().includes(search);
        if (matches) out.push(n);
        if (n.expanded && n.children.length) {
          push(n.children);
        }
      }
    };
    push(this.rootChildren);
    this.displayNodes = out;
    this.cd.markForCheck();
  }

  private loadChildren(parentNodeId: string | null): Promise<BrowsedNode[]> {
    const rpcBody = {
      method: 'opcua_browseNode',
      params: parentNodeId ? { nodeId: parentNodeId } : {},
      timeout: 15000,
    };
    return new Promise((resolve, reject) => {
      this.deviceService.sendTwoWayRpcCommand(this.data.gatewayDeviceId, rpcBody).subscribe({
        next: (res: any) => {
          const body = res?.result ?? res ?? {};
          if (body?.success === false) {
            reject(new Error(body.error || 'Browse failed'));
            return;
          }
          resolve(body.children || []);
        },
        error: () => reject(new Error('Gateway unreachable or connector not running')),
      });
    });
  }

  private mapDataType(dt?: string): string {
    if (!dt) return 'string';
    const lower = dt.toLowerCase();
    if (lower.includes('float') || lower.includes('double')) return 'float';
    if (lower.includes('int') || lower.includes('byte') || lower.includes('uint')) return 'integer';
    if (lower.includes('bool')) return 'boolean';
    return 'string';
  }
}
