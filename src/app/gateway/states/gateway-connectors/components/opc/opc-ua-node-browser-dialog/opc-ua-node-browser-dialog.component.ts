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
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
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
  /** Back-pointer to the parent — so a Variable can look up its owning
   *  device (Object) for inherit-the-device-mode logic in RPC mode. */
  parent?: TreeNode;
}

export interface OpcUaNodeBrowserDialogData {
  gatewayDeviceId: string;
  connectorName: string;
  /** Target controls which node class is selectable + how the result is returned.
   *   - 'timeseries' | 'attributes' → Variable nodes, result carries `tags`.
   *   - 'devices'                   → Object nodes (subtree anchors),
   *                                   result carries `devices`.
   *   - 'rpc_methods'               → Method nodes, result carries
   *                                   `rpcMethods` ready to push into
   *                                   the mapping's rpc_methods array. */
  targetSection: 'timeseries' | 'attributes' | 'devices' | 'rpc_methods';
  /** Existing values so already-mapped entries render dimmed: NodeIds
   *  for tags/rpc-methods, device-node paths for devices. */
  existingValues: string[];
  /** Mapping's `deviceNodePattern` (identifier or absolute path). When
   *  present, the browse tree roots at this device's subtree instead
   *  of /Objects — so tags/attrs dialogs only list keys that actually
   *  belong to the device being edited. Unused in 'devices' mode
   *  (picking devices needs the whole /Objects tree). */
  rootDevicePattern?: string;
}

export interface OpcUaDeviceSelection {
  nodeId: string;
  displayName: string;
}

export interface OpcUaRpcMethodSelection {
  method: string;
  arguments: Array<{ type: string; value: string | number | boolean }>;
  /** NodeId of the Variable this method targets. Stored in the
   *  whitelist so the OPC-UA connector can route the call without the
   *  platform supplying it at runtime. Absent for Method-node entries
   *  (those invoke an actual OPC-UA Method). */
  nodeId?: string;
  /** Operation this method maps to — authoritative, the driver does
   *  NOT parse the method name. Mirrors S7's `S7RpcConfig.operation`. */
  operation?: 'read' | 'write';
  /** Value type for writes — the connector coerces the caller's
   *  value to this type before writing. */
  valueType?: string;
}

export interface OpcUaNodeBrowserDialogResult {
  tags?: Array<{ key: string; value: string; type: string }>;
  devices?: OpcUaDeviceSelection[];
  rpcMethods?: OpcUaRpcMethodSelection[];
  targetSection: 'timeseries' | 'attributes' | 'devices' | 'rpc_methods';
}

@Component({
  selector: 'tb-opc-ua-node-browser-dialog',
  templateUrl: './opc-ua-node-browser-dialog.component.html',
  styleUrls: ['./opc-ua-node-browser-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, SharedModule],
})
export class OpcUaNodeBrowserDialogComponent {

  displayedColumns: string[] = [];
  rootChildren: TreeNode[] = [];
  displayNodes: TreeNode[] = [];

  selection = new SelectionModel<TreeNode>(true, []);
  textSearch = new FormControl('');
  loading = true;
  refreshing = false;
  loadError: string | null = null;

  /** Visible-row cap — rendering 2000 mat-rows at once freezes the
   *  browser. We render the first N matching rows and show a "Show
   *  more / Show all" button. The operator can also search to narrow
   *  the set. */
  private static readonly DEFAULT_VISIBLE_CAP = 300;
  visibleCap = OpcUaNodeBrowserDialogComponent.DEFAULT_VISIBLE_CAP;
  totalMatches = 0;

  /** RPC mode only. Per-device default — lives on the device (Object)
   *  row in the table, keyed by the device's NodeId. Newly-selected
   *  Variables under that device inherit this value at the moment of
   *  selection. */
  rpcDeviceModes = new Map<string, 'get' | 'set' | 'both'>();

  /** RPC mode only. Per-Variable override, keyed by NodeId — lets the
   *  operator flip a single row's direction without touching the
   *  device-level default. Frozen at selection time. */
  rpcVariableOverrides = new Map<string, 'get' | 'set' | 'both'>();

  /** Default direction for a device when the operator hasn't chosen
   *  one yet. */
  private static readonly DEFAULT_RPC_MODE: 'get' | 'set' | 'both' = 'get';

  /** Master default shown in the column header — applies to every
   *  newly-selected Variable whose visible tree ancestor chain has no
   *  Object row (the common case now that the browse dialog roots at
   *  the mapping's device). Per-device Object toggles override it when
   *  present (tag-mode with a tree that does include Objects). */
  rpcBulkMode: 'get' | 'set' | 'both' = OpcUaNodeBrowserDialogComponent.DEFAULT_RPC_MODE;

  /** Default for a given Variable: nearest ancestor Object's toggle if
   *  one exists in the visible tree, otherwise the master header
   *  toggle — so operators always have exactly one place to flip a
   *  bulk direction, regardless of browse-root depth. */
  deviceModeFor(node: TreeNode): 'get' | 'set' | 'both' {
    let p = node.parent;
    while (p) {
      if (p.raw.nodeClass === 'Object') {
        return this.rpcDeviceModes.get(p.raw.nodeId) ?? this.rpcBulkMode;
      }
      p = p.parent;
    }
    return this.rpcBulkMode;
  }

  /** Exposed to the template for the device row's own toggle. */
  deviceMode(node: TreeNode): 'get' | 'set' | 'both' {
    return this.rpcDeviceModes.get(node.raw.nodeId) ?? OpcUaNodeBrowserDialogComponent.DEFAULT_RPC_MODE;
  }

  setDeviceMode(node: TreeNode, value: 'get' | 'set' | 'both'): void {
    this.rpcDeviceModes.set(node.raw.nodeId, value);
  }

  private existingSet: Set<string>;

  constructor(
    private dialogRef: MatDialogRef<OpcUaNodeBrowserDialogComponent, OpcUaNodeBrowserDialogResult | null>,
    @Inject(MAT_DIALOG_DATA) public data: OpcUaNodeBrowserDialogData,
    private deviceService: DeviceService,
    private cd: ChangeDetectorRef,
  ) {
    this.existingSet = new Set((data.existingValues || []).map(v => v?.trim()).filter(Boolean));

    // RPC mode gets an extra "Variable as" column between NodeId and
    // the type badge. That column hosts the bulk toggle (in its header)
    // and a per-row override toggle (in cells for selected Variables).
    this.displayedColumns = data.targetSection === 'rpc_methods'
      ? ['select', 'name', 'nodeId', 'rpcMode', 'dataType']
      : ['select', 'name', 'nodeId', 'dataType'];

    // Freeze each Variable's rpc direction at the moment of selection
    // using its parent device's current default — so flipping the
    // device toggle afterwards only affects *future* picks, never
    // ones already in the set. Deselection clears the override.
    this.selection.changed.subscribe(change => {
      if (data.targetSection !== 'rpc_methods') return;
      for (const n of change.added) {
        if (n.raw.nodeClass === 'Variable'
            && !this.rpcVariableOverrides.has(n.raw.nodeId)) {
          this.rpcVariableOverrides.set(n.raw.nodeId, this.deviceModeFor(n));
        }
      }
      for (const n of change.removed) {
        this.rpcVariableOverrides.delete(n.raw.nodeId);
      }
    });

    this.refresh();
    this.textSearch.valueChanges.subscribe(() => this.rebuildDisplay());
  }

  refresh(): void {
    this.refreshing = true;
    this.loading = true;
    this.loadError = null;
    this.rootChildren = [];
    this.selection.clear();
    this.visibleCap = OpcUaNodeBrowserDialogComponent.DEFAULT_VISIBLE_CAP;
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
        node.children = children.map(n => this.wrap(n, node.depth + 1, node));
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
   *   - Tag modes      → Variable nodes (they hold values).
   *   - Device mode    → Object nodes (subtree anchors).
   *   - RPC-methods    → Method nodes (OPC-UA Call) AND Variable
   *                      nodes (each becomes a `get`/`set` whitelist
   *                      entry for read/write RPC). */
  isSelectable(node: TreeNode): boolean {
    if (this.data.targetSection === 'devices') {
      return node.raw.nodeClass === 'Object';
    }
    if (this.data.targetSection === 'rpc_methods') {
      return node.raw.nodeClass === 'Method' || node.raw.nodeClass === 'Variable';
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

  // -- Per-device "select all" ----------------------------------------
  // When browsing in 'timeseries' / 'attributes' mode, only Variable
  // nodes are selectable individually. Objects (devices) get a
  // tri-state checkbox that toggles every loaded Variable descendant
  // in one click — matching the Discover dialog's per-device picker.

  /** Tag mode only: a device / Object-class node should show a "select
   *  all its children" checkbox rather than being individually
   *  selectable. Device mode keeps its existing one-per-row behaviour. */
  isChildrenSelector(node: TreeNode): boolean {
    return this.data.targetSection !== 'devices'
        && node.raw.nodeClass === 'Object'
        && node.children.some(c => c.raw.nodeClass === 'Variable');
  }

  /** Selectable Variable descendants (recursive) that are loaded
   *  under this tree node — skips children that haven't been expanded
   *  yet because the sub-browse hasn't run. */
  private selectableDescendants(node: TreeNode): TreeNode[] {
    const out: TreeNode[] = [];
    const walk = (n: TreeNode) => {
      for (const c of n.children) {
        if (c.raw.nodeClass === 'Variable' && !this.isExisting(c)) {
          out.push(c);
        }
        if (c.loaded) walk(c);
      }
    };
    walk(node);
    return out;
  }

  allChildrenSelected(node: TreeNode): boolean {
    const kids = this.selectableDescendants(node);
    return kids.length > 0 && kids.every(c => this.selection.isSelected(c));
  }

  anyChildrenSelected(node: TreeNode): boolean {
    return this.selectableDescendants(node).some(c => this.selection.isSelected(c));
  }

  toggleChildrenSelect(node: TreeNode): void {
    const kids = this.selectableDescendants(node);
    if (kids.length === 0) return;
    if (this.allChildrenSelected(node)) {
      kids.forEach(c => this.selection.deselect(c));
    } else {
      kids.forEach(c => this.selection.select(c));
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
    if (this.data.targetSection === 'rpc_methods') {
      // Matches the IEC 61850 model browser's naming — `get_<name>` /
      // `set_<name>` so each entry in the rpc_methods whitelist is
      // self-identifying. Without this, repeated selections would
      // collapse into duplicate `get` / `set` rows that the operator
      // can't tell apart later.
      //   - Variable + 'get'  → `get_<sanitized>` with no arguments (read)
      //   - Variable + 'set'  → `set_<sanitized>` with one argument of
      //                          the matching MappingValueType (pre-
      //                          filled so the user sees a typed
      //                          template, not an empty row)
      //   - Variable + 'both' → both entries above
      //   - Method            → the method's own displayName, verbatim
      const rpcMethods: OpcUaRpcMethodSelection[] = [];
      for (const n of this.selection.selected) {
        if (!this.isSelectable(n)) continue;
        if (n.raw.nodeClass === 'Method') {
          rpcMethods.push({
            method: n.raw.displayName || n.raw.browseName,
            arguments: [],
          });
          continue;
        }
        const tagName = this.toRpcTagName(n.raw.displayName || n.raw.browseName);
        const mode = this.rpcVariableOverrides.get(n.raw.nodeId) ?? this.deviceModeFor(n);
        const argTemplate = this.defaultArgumentFor(n.raw.dataType);
        if (mode === 'get' || mode === 'both') {
          rpcMethods.push({
            method: `get_${tagName}`,
            arguments: [],
            nodeId: n.raw.nodeId,
            operation: 'read',
            valueType: argTemplate.type,
          });
        }
        if (mode === 'set' || mode === 'both') {
          rpcMethods.push({
            method: `set_${tagName}`,
            arguments: [argTemplate],
            nodeId: n.raw.nodeId,
            operation: 'write',
            valueType: argTemplate.type,
          });
        }
      }
      this.dialogRef.close({ rpcMethods, targetSection: 'rpc_methods' });
      return;
    }
    const tags = this.selection.selected
      .filter(n => this.isSelectable(n))
      .map(n => ({
        key: n.raw.displayName || n.raw.browseName,
        value: n.raw.nodeId,
        type: this.mapSourceType(n.raw.dataType),
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

  private wrap(raw: BrowsedNode, depth: number, parent?: TreeNode): TreeNode {
    return {
      raw,
      depth,
      parent,
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
    this.totalMatches = out.length;
    // Cap the rendered window — mat-table is O(n) per cell binding and
    // renders everything in one pass, so 2000+ rows freeze the thread
    // on first paint AND again each time Angular CD walks the rows.
    this.displayNodes = out.slice(0, this.visibleCap);
    this.cd.markForCheck();
  }

  /** "Show more" — step the cap forward; "Show all" — drop the cap. */
  increaseVisibleCap(step = OpcUaNodeBrowserDialogComponent.DEFAULT_VISIBLE_CAP): void {
    this.visibleCap = Math.min(this.totalMatches, this.visibleCap + step);
    this.rebuildDisplay();
  }

  showAll(): void {
    this.visibleCap = this.totalMatches || Number.POSITIVE_INFINITY;
    this.rebuildDisplay();
  }

  /** Infinite-scroll-ish: bump the cap when the operator nears the
   *  bottom of the table. Avoids requiring an explicit click on Show
   *  more to continue paging through the address space. */
  onTableScroll(event: Event): void {
    if (this.visibleCap >= this.totalMatches) return;
    const el = event.target as HTMLElement;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 200) {
      this.increaseVisibleCap();
    }
  }

  private loadChildren(parentNodeId: string | null): Promise<BrowsedNode[]> {
    // Root-level call (parentNodeId null) + a device pattern from the
    // mapping → ask the backend to resolve the pattern and root the
    // tree there. Subsequent expansions use the returned child NodeIds
    // directly, so `devicePattern` is only set on the initial request.
    const isRoot = !parentNodeId;
    const useDevicePattern = isRoot
      && !!this.data.rootDevicePattern
      && this.data.targetSection !== 'devices';
    const rpcBody = {
      method: 'opcua_browseNode',
      params: useDevicePattern
        ? { devicePattern: this.data.rootDevicePattern }
        : (parentNodeId ? { nodeId: parentNodeId } : {}),
      timeout: 15000,
    };
    return new Promise((resolve, reject) => {
      this.deviceService.sendTwoWayRpcCommand(this.data.gatewayDeviceId, rpcBody).subscribe({
        next: (res: any) => {
          const body = res?.result ?? res ?? {};
          const rawErr = body?.error as string | undefined;
          // Any error response from the gateway almost always means the
          // connector isn't responding — either disabled, unsaved, or
          // crashed. Surface the same "enable the connector" prompt in
          // all cases unless the backend returned a specific actionable
          // error about nodes/paths etc. (those would have `success: false`
          // AND a non-routing error string).
          if (body?.success === false || rawErr) {
            const routingIssue = !rawErr
              || rawErr.toLowerCase().includes('not found')
              || rawErr.toLowerCase().includes('not connected')
              || rawErr.toLowerCase().includes('disabled')
              || rawErr.toLowerCase().includes('unreachable')
              || body?.code === 404;
            reject(new Error(routingIssue
              ? 'Connector is disabled or not responding. Enable it in the Connectors list and try again.'
              : rawErr || 'Browse failed'));
            return;
          }
          resolve(body.children || []);
        },
        error: () => reject(new Error('Connector is disabled or not responding. Enable it in the Connectors list and try again.')),
      });
    });
  }

  /** For OPC-UA tags the keys-panel Source mat-select binds to the
   *  `type` field using OPCUaSourceType values ('path' | 'identifier' |
   *  'constant'). Since we're returning a resolved NodeId from the
   *  browse, `'identifier'` is always the right source type — the
   *  value column is literally `ns=...;s/i=...`. */
  private mapSourceType(_dt?: string): string {
    return 'identifier';
  }

  /** Strip characters that would break a method name (spaces, dots,
   *  colons, slashes) so `get_<displayName>` stays a valid identifier —
   *  the same rationale as IEC 61850's `${ln}_${do}_${da}` tag builder. */
  private toRpcTagName(name: string): string {
    return (name || 'var').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'var';
  }

  /** Pre-fill the single argument slot on a `set_<name>` RPC entry with
   *  a typed template so the operator sees a ready-to-edit row instead
   *  of "No arguments". OPC-UA built-in type names map onto the four
   *  MappingValueType buckets the keys panel already knows about. */
  private defaultArgumentFor(dataType?: string): { type: string; value: string | number | boolean } {
    const dt = (dataType || '').toLowerCase();
    if (dt === 'boolean') {
      return { type: 'boolean', value: false };
    }
    if (dt.startsWith('int') || dt.startsWith('uint') || dt === 'byte' || dt === 'sbyte') {
      return { type: 'integer', value: 0 };
    }
    if (dt === 'float' || dt === 'double') {
      return { type: 'double', value: 0 };
    }
    return { type: 'string', value: '' };
  }
}
