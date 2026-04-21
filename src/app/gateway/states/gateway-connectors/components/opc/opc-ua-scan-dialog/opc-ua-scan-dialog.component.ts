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

import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, OnDestroy, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { SharedModule } from '@shared/public-api';
import { DeviceService } from '@core/public-api';
import { Subscription } from 'rxjs';

/** One EndpointDescription returned by opcua_discoverEndpoints. Multiple
 *  endpoints can share an applicationUri — they're the same server with
 *  different security policy/mode/token combinations. */
interface Endpoint {
  endpointUrl: string;
  securityPolicyUri: string;
  securityMode: string;
  securityLevel: number;
  userTokenTypes?: string[];
  applicationUri?: string;
}

/** Lazy-loaded key row under a device (Variable node inside an Object). */
interface TagNode {
  nodeId: string;
  browseName: string;
  displayName: string;
  nodeClass: string;
  hasChildren: boolean;
  dataType?: string;
  selected?: boolean;
}

/** Top-level Object on a server — candidate for a device mapping.
 *  `tags` lazy-loads when the operator expands the row in the right panel. */
interface DeviceObject {
  nodeId: string;
  displayName: string;
  selected?: boolean;
  expanded?: boolean;
  loading?: boolean;
  loaded?: boolean;
  loadError?: string;
  tags?: TagNode[];
}

/** One server in the left-panel list. May come from a URL probe (user
 *  typed the URL in server-config) OR from an LDS/mDNS network scan. */
interface ScanServer {
  id: string;
  applicationUri: string;
  applicationName: string;
  productUri: string;
  endpointUrl: string;
  securityPolicyUri: string;
  securityMode: string;
  discoveryUrls: string[];
  endpoints: Endpoint[];
  objects: DeviceObject[];
  origin: 'probe' | 'scan';
  selectedEndpointIndex: number;
  warnings?: string[];
}

export interface OpcUaScanDialogData {
  gatewayDeviceId: string;
  connectorName: string;
  /** If present, the dialog auto-probes this URL on open and shows its
   *  server entry in the left list. The operator can still click "Scan
   *  network" to pull in LDS/mDNS-registered servers too. */
  initialUrl?: string;
  /** Existing mapping device-node NodeIds — shown dimmed so the operator
   *  doesn't re-add what's already mapped. */
  existingDeviceNodes?: string[];
}

export interface OpcUaScanDialogResult {
  endpointUrl: string;
  securityPolicy: string;
  /** Object nodes the operator ticked in the right panel. Each entry
   *  carries the tags (Variable children) they ticked inside that
   *  device — empty array if the operator only wanted the device
   *  container with no prefilled timeseries. */
  devices: Array<{
    nodeId: string;
    displayName: string;
    tags: Array<{ key: string; value: string; type: string }>;
  }>;
}

@Component({
  selector: 'tb-opc-ua-scan-dialog',
  templateUrl: './opc-ua-scan-dialog.component.html',
  styleUrls: ['./opc-ua-scan-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Encapsulation.None so the SCSS can reach the `.cdk-overlay-pane` +
  // `.mat-mdc-dialog-container` that wrap this dialog — needed to
  // force full-screen behaviour on xs + sm breakpoints (tb-fullscreen-
  // dialog only activates < 600px, but tablets break the layout too).
  // All selectors in the SCSS are prefixed with `.opc-scan-dialog-panel`
  // so this doesn't leak globally.
  encapsulation: ViewEncapsulation.None,
  standalone: true,
  imports: [CommonModule, SharedModule, ReactiveFormsModule],
})
export class OpcUaScanDialogComponent implements OnDestroy {

  /** URL input lives inside the dialog now — operator can edit it, hit
   *  Discover to (re)probe, or tap Scan network to search via LDS/mDNS.
   *  Prefilled from whatever was in the Server tab URL field when the
   *  dialog opened. */
  urlInput = new FormControl('');

  probing = false;     // URL probe in flight
  scanning = false;    // LDS/mDNS scan in flight
  warnings: string[] = [];
  globalError: string | null = null;

  servers: ScanServer[] = [];
  selectedServerId: string | null = null;

  existingSet: Set<string>;

  /** Held references so Cancel can abort an in-flight RPC. */
  private probeSub?: Subscription;
  private scanSub?: Subscription;

  constructor(
    private dialogRef: MatDialogRef<OpcUaScanDialogComponent, OpcUaScanDialogResult | null>,
    @Inject(MAT_DIALOG_DATA) public data: OpcUaScanDialogData,
    private deviceService: DeviceService,
    private cd: ChangeDetectorRef,
  ) {
    this.existingSet = new Set((data.existingDeviceNodes || []).filter(Boolean));
    this.urlInput.setValue(data.initialUrl || '');
    if (data.initialUrl) {
      // Convenience: if the operator had a URL in the Server tab, probe
      // it right away. They can still cancel and/or tap Scan network.
      this.probeUrl(data.initialUrl);
    }
  }

  ngOnDestroy(): void {
    this.probeSub?.unsubscribe();
    this.scanSub?.unsubscribe();
  }

  /** Fired by the in-dialog Discover button. Uses whatever is currently
   *  in the URL input — empty URL is a no-op. */
  discoverFromInput(): void {
    const url = (this.urlInput.value || '').trim();
    if (!url) return;
    this.probeUrl(url);
  }

  cancelProbe(): void {
    this.probeSub?.unsubscribe();
    this.probeSub = undefined;
    this.probing = false;
    this.cd.markForCheck();
  }

  cancelScan(): void {
    this.scanSub?.unsubscribe();
    this.scanSub = undefined;
    this.scanning = false;
    this.cd.markForCheck();
  }

  dismissError(): void {
    this.globalError = null;
    this.cd.markForCheck();
  }

  get selectedServer(): ScanServer | undefined {
    return this.servers.find(s => s.id === this.selectedServerId);
  }

  // ---------------------------------------------------------------------
  // Left panel: probe + scan
  // ---------------------------------------------------------------------

  /** Probe the given URL via `opcua_scanServers` with probeUrl param — the
   *  backend returns the same ScanServer shape as the LDS path so the UI
   *  only has to merge one list. Cancellable via cancelProbe(). */
  probeUrl(url: string): void {
    if (!url) return;
    this.probeSub?.unsubscribe();
    this.probing = true;
    this.globalError = null;
    this.cd.markForCheck();

    this.probeSub = this.deviceService.sendTwoWayRpcCommand(this.data.gatewayDeviceId, {
      method: 'opcua_scanServers',
      params: { probeUrl: url },
      timeout: 20000,
    }).subscribe({
      next: (res: any) => {
        this.probing = false;
        const body = res?.result ?? res ?? {};
        if (body.success === false) {
          this.globalError = body.error || 'Probe failed.';
          this.cd.markForCheck();
          return;
        }
        this.mergeServers(body.servers || [], body.warnings || [], 'probe');
        if (!this.selectedServerId && this.servers.length) {
          this.selectServer(this.servers[0]);
        }
        this.cd.markForCheck();
      },
      error: () => {
        this.probing = false;
        this.globalError = 'Gateway unreachable or connector not running.';
        this.cd.markForCheck();
      },
    });
  }

  /** Run LDS/mDNS scan and merge results into the existing server list.
   *  Cancellable via cancelScan(). */
  scanNetwork(): void {
    this.scanSub?.unsubscribe();
    this.scanning = true;
    this.globalError = null;
    this.cd.markForCheck();

    this.scanSub = this.deviceService.sendTwoWayRpcCommand(this.data.gatewayDeviceId, {
      method: 'opcua_scanServers',
      params: {},
      timeout: 35000,
    }).subscribe({
      next: (res: any) => {
        this.scanning = false;
        const body = res?.result ?? res ?? {};
        if (body.success === false) {
          this.globalError = body.error || 'Scan failed.';
          this.cd.markForCheck();
          return;
        }
        this.mergeServers(body.servers || [], body.warnings || [], 'scan');
        this.cd.markForCheck();
      },
      error: () => {
        this.scanning = false;
        this.globalError = 'Gateway unreachable or connector not running.';
        this.cd.markForCheck();
      },
    });
  }

  /** Deduplicate by applicationUri (fallback to endpointUrl or first
   *  discoveryUrl). Existing entries keep their selection/expansion state
   *  — only their endpoint/objects metadata is refreshed. */
  private mergeServers(incoming: any[], warnings: string[], origin: 'probe' | 'scan'): void {
    if (warnings?.length) {
      this.warnings = [...this.warnings, ...warnings];
    }
    for (const s of incoming) {
      const id = (s.applicationUri || s.endpointUrl || (s.discoveryUrls && s.discoveryUrls[0]) || '').trim();
      if (!id) continue;

      const endpoints: Endpoint[] = (s.endpoints || []).length
        ? s.endpoints
        : (s.endpointUrl ? [{
            endpointUrl: s.endpointUrl,
            securityPolicyUri: s.securityPolicyUri || '',
            securityMode: s.securityMode || '',
            securityLevel: 0,
            userTokenTypes: [],
            applicationUri: s.applicationUri,
          }] : []);

      const existing = this.servers.find(e => e.id === id);
      if (existing) {
        // Merge: keep operator's selected endpoint + per-device state.
        existing.endpoints = endpoints.length ? endpoints : existing.endpoints;
        existing.endpointUrl = s.endpointUrl || existing.endpointUrl;
        existing.securityPolicyUri = s.securityPolicyUri || existing.securityPolicyUri;
        existing.securityMode = s.securityMode || existing.securityMode;
        existing.applicationName = s.applicationName || existing.applicationName;
        existing.productUri = s.productUri || existing.productUri;
        existing.objects = this.mergeObjects(existing.objects, s.objects || []);
      } else {
        this.servers.push({
          id,
          applicationUri: s.applicationUri || '',
          applicationName: s.applicationName || '',
          productUri: s.productUri || '',
          endpointUrl: s.endpointUrl || (endpoints[0]?.endpointUrl ?? ''),
          securityPolicyUri: s.securityPolicyUri || (endpoints[0]?.securityPolicyUri ?? ''),
          securityMode: s.securityMode || (endpoints[0]?.securityMode ?? ''),
          discoveryUrls: s.discoveryUrls || [],
          endpoints,
          objects: (s.objects || []).map((o: any) => ({
            nodeId: o.nodeId,
            displayName: o.displayName,
            selected: false,
            expanded: false,
            loaded: false,
          })),
          origin,
          selectedEndpointIndex: 0,
        });
      }
    }
  }

  private mergeObjects(existing: DeviceObject[], incoming: any[]): DeviceObject[] {
    if (!incoming?.length) return existing;
    const byId = new Map<string, DeviceObject>(existing.map(o => [o.nodeId, o]));
    for (const o of incoming) {
      if (!byId.has(o.nodeId)) {
        byId.set(o.nodeId, {
          nodeId: o.nodeId,
          displayName: o.displayName,
          selected: false,
          expanded: false,
          loaded: false,
        });
      }
    }
    return Array.from(byId.values());
  }

  selectServer(server: ScanServer): void {
    this.selectedServerId = server.id;
    this.cd.markForCheck();
  }

  // ---------------------------------------------------------------------
  // Right panel: endpoint pick, device/tag selection, lazy browse
  // ---------------------------------------------------------------------

  pickEndpoint(index: number): void {
    const srv = this.selectedServer;
    if (!srv || !srv.endpoints[index]) return;
    srv.selectedEndpointIndex = index;
    const ep = srv.endpoints[index];
    srv.endpointUrl = ep.endpointUrl;
    srv.securityPolicyUri = ep.securityPolicyUri;
    srv.securityMode = ep.securityMode;
    this.cd.markForCheck();
  }

  toggleDeviceSelect(obj: DeviceObject): void {
    if (this.isExisting(obj)) return;
    obj.selected = !obj.selected;
    this.cd.markForCheck();
  }

  /** Expand a device row and lazy-load its Variable children (keys/tags)
   *  from the server via opcua_browseUrl. Safe to call repeatedly — only
   *  the first expand triggers the RPC. */
  toggleDeviceExpand(obj: DeviceObject): void {
    const srv = this.selectedServer;
    if (!srv) return;
    if (obj.expanded) {
      obj.expanded = false;
      this.cd.markForCheck();
      return;
    }
    obj.expanded = true;
    if (obj.loaded || obj.loading) {
      this.cd.markForCheck();
      return;
    }
    obj.loading = true;
    obj.loadError = undefined;
    this.cd.markForCheck();

    this.deviceService.sendTwoWayRpcCommand(this.data.gatewayDeviceId, {
      method: 'opcua_browseUrl',
      params: { url: srv.endpointUrl || srv.discoveryUrls[0], nodeId: obj.nodeId },
      timeout: 15000,
    }).subscribe({
      next: (res: any) => {
        obj.loading = false;
        obj.loaded = true;
        const body = res?.result ?? res ?? {};
        if (body?.success === false) {
          obj.loadError = body.error || 'Browse failed';
          this.cd.markForCheck();
          return;
        }
        obj.tags = (body.children || [])
          .filter((c: any) => c.nodeClass === 'Variable')
          .map((c: any) => ({
            nodeId: c.nodeId,
            browseName: c.browseName,
            displayName: c.displayName,
            nodeClass: c.nodeClass,
            hasChildren: c.hasChildren,
            dataType: c.dataType,
            selected: false,
          }));
        this.cd.markForCheck();
      },
      error: () => {
        obj.loading = false;
        obj.loaded = true;
        obj.loadError = 'Gateway unreachable';
        this.cd.markForCheck();
      },
    });
  }

  toggleTagSelect(tag: TagNode, obj?: DeviceObject): void {
    tag.selected = !tag.selected;
    // Picking a key under a device implies the device itself is part
    // of the selection — Apply() only walks devices where `selected`
    // is true. Auto-tick the parent device so the user doesn't have
    // to check both boxes. Unchecking a key leaves the device as-is
    // (operator may still want the device without preselected keys).
    if (obj && tag.selected) {
      obj.selected = true;
    }
    this.cd.markForCheck();
  }

  toggleAllTags(obj: DeviceObject): void {
    if (!obj.tags?.length) return;
    const target = !obj.tags.every(t => t.selected);
    obj.tags.forEach(t => { t.selected = target; });
    if (target) {
      obj.selected = true;
    }
    this.cd.markForCheck();
  }

  allTagsSelected(obj: DeviceObject): boolean {
    return !!obj.tags?.length && obj.tags.every(t => t.selected);
  }

  isExisting(obj: DeviceObject): boolean {
    return this.existingSet.has(obj.nodeId);
  }

  selectedDeviceCount(): number {
    const srv = this.selectedServer;
    if (!srv) return 0;
    return srv.objects.filter(o => o.selected && !this.isExisting(o)).length;
  }

  selectedTagCount(): number {
    const srv = this.selectedServer;
    if (!srv) return 0;
    return srv.objects.reduce((acc, o) => acc + ((o.tags || []).filter(t => t.selected).length), 0);
  }

  // ---------------------------------------------------------------------
  // Result
  // ---------------------------------------------------------------------

  apply(): void {
    const srv = this.selectedServer;
    if (!srv || !srv.endpointUrl) return;
    const policy = (srv.securityPolicyUri || '').split('#').pop() || '';

    const devices = srv.objects
      .filter(o => o.selected && !this.isExisting(o))
      .map(o => ({
        nodeId: o.nodeId,
        displayName: o.displayName,
        tags: (o.tags || [])
          .filter(t => t.selected)
          .map(t => ({
            key: t.displayName || t.browseName,
            value: t.nodeId,
            type: this.mapDataType(t.dataType),
          })),
      }));

    this.dialogRef.close({
      endpointUrl: srv.endpointUrl,
      securityPolicy: policy,
      devices,
    });
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  /** Clear the server list + warnings. Leaves the URL input intact so
   *  the operator can re-run Discover/Scan without retyping. */
  clearResults(): void {
    this.cancelProbe();
    this.cancelScan();
    this.servers = [];
    this.warnings = [];
    this.selectedServerId = null;
    this.globalError = null;
    this.cd.markForCheck();
  }

  trackServer(_: number, s: ScanServer): string {
    return s.id;
  }

  trackObject(_: number, o: DeviceObject): string {
    return o.nodeId;
  }

  trackTag(_: number, t: TagNode): string {
    return t.nodeId;
  }

  private mapDataType(dt?: string): string {
    if (!dt) return 'string';
    const lower = dt.toLowerCase();
    if (lower.includes('float') || lower.includes('double')) return 'float';
    if (lower.includes('int') || lower.includes('byte') || lower.includes('uint')) return 'integer';
    if (lower.includes('bool')) return 'boolean';
    return 'string';
  }

  shortPolicy(uri: string): string {
    return (uri || '').split('#').pop() || uri || '—';
  }
}
