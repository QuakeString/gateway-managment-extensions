///
/// Copyright © 2016-2025 The SENTIENT Authors
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
  ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FormControl } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { DeviceService } from '@core/public-api';
import { SelectionModel } from '@angular/cdk/collections';
import {
  IEC61850DataKey, IEC61850FlatDataPoint, IEC61850ModelNode,
  IEC61850FC, IEC61850ValueType, IEC61850RpcConfig,
} from '../../../models/public-api';

export type IEC61850BrowserCategory = 'timeseries' | 'attributes' | 'attributeUpdates' | 'rpc';

export interface IEC61850ModelBrowserData {
  modelTree: { logicalDevices: IEC61850ModelNode[] };
  existingReferences: string[];
  targetCategory: IEC61850BrowserCategory;
  gatewayDeviceId?: string;
  connectorName?: string;
  deviceName?: string;
}

export interface IEC61850ModelBrowserResult {
  selectedKeys?: IEC61850DataKey[];
  selectedRpcConfigs?: IEC61850RpcConfig[];
  category: IEC61850BrowserCategory;
  modelTree?: { logicalDevices: IEC61850ModelNode[] };
}

@Component({
  selector: 'tb-iec61850-model-browser-dialog',
  templateUrl: './iec61850-model-browser-dialog.component.html',
  styleUrls: ['./iec61850-model-browser-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule],
})
export class IEC61850ModelBrowserDialogComponent {

  static readonly WRITABLE_FCS = new Set(['CO', 'SP', 'CF', 'DC', 'SG', 'SE']);

  displayedColumns: string[];
  allPoints: IEC61850FlatDataPoint[];
  filteredPoints: IEC61850FlatDataPoint[];
  selection = new SelectionModel<IEC61850FlatDataPoint>(true, []);
  textSearch = new FormControl('');
  targetCategory: IEC61850BrowserCategory;
  existingRefSet: Set<string>;
  operationMap = new Map<IEC61850FlatDataPoint, string>();
  refreshing = false;
  loading = false;
  loadError: string = null;
  private _currentTree: { logicalDevices: IEC61850ModelNode[] } = null;

  constructor(
    private dialogRef: MatDialogRef<IEC61850ModelBrowserDialogComponent, IEC61850ModelBrowserResult>,
    @Inject(MAT_DIALOG_DATA) private data: IEC61850ModelBrowserData,
    private cd: ChangeDetectorRef,
    private deviceService: DeviceService,
  ) {
    this.targetCategory = data.targetCategory || 'timeseries';
    this.existingRefSet = new Set(data.existingReferences || []);

    const baseColumns = ['select', 'reference', 'fc', 'ln', 'do', 'da'];
    this.displayedColumns = this.targetCategory === 'rpc'
      ? [...baseColumns, 'operation']
      : baseColumns;

    // If model data is available, populate immediately
    if (data.modelTree?.logicalDevices?.length) {
      this._populateFromTree(data.modelTree);
    } else {
      // No model data — auto-discover
      this.allPoints = [];
      this.filteredPoints = [];
      this._autoDiscover();
    }

    this.textSearch.valueChanges.subscribe(() => {
      this.applyFilter();
    });
  }

  private _populateFromTree(modelTree: { logicalDevices: IEC61850ModelNode[] }): void {
    this._currentTree = modelTree;
    let points = this.flattenModel(modelTree);
    if (this.targetCategory === 'attributeUpdates') {
      points = points.filter(p => this.isWritable(p));
    }
    this.allPoints = points;
    this.filteredPoints = [...this.allPoints];
    this.initOperationMap();
  }

  private _autoDiscover(): void {
    const gatewayDeviceId = this.data.gatewayDeviceId;
    if (!gatewayDeviceId) {
      this.loadError = 'Save the connector configuration first, then try again.';
      this.cd.markForCheck();
      return;
    }

    this.loading = true;
    this.loadError = null;
    this.cd.markForCheck();

    const rpcBody = {
      method: 'iec61850_browseModel',
      params: {
        deviceName: this.data.deviceName || '',
        connectorId: this.data.connectorName || '',
      },
      timeout: 15000,
    };

    this.deviceService.sendTwoWayRpcCommand(gatewayDeviceId, rpcBody).subscribe({
      next: (result: any) => {
        const tree = result?.logicalDevices ? result : (result?.result || { logicalDevices: [] });
        this._populateFromTree(tree);
        this.loading = false;
        this.loadError = this.allPoints.length === 0 ? 'No data points found on the IED.' : null;
        this.cd.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.loadError = 'Discovery failed. Make sure the connector is saved and the gateway is connected to the IED.';
        this.cd.markForCheck();
      }
    });
  }

  isWritable(point: IEC61850FlatDataPoint): boolean {
    return IEC61850ModelBrowserDialogComponent.WRITABLE_FCS.has(point.fc);
  }

  getOperation(point: IEC61850FlatDataPoint): string {
    return this.operationMap.get(point) || 'read';
  }

  setOperation(point: IEC61850FlatDataPoint, operation: string): void {
    this.operationMap.set(point, operation);
  }

  isAllSelected(): boolean {
    const selectable = this.filteredPoints.filter(p => !this.isExisting(p));
    return selectable.length > 0 && this.selection.selected.length === selectable.length;
  }

  toggleAllRows(): void {
    if (this.isAllSelected()) {
      this.selection.clear();
    } else {
      const selectable = this.filteredPoints.filter(p => !this.isExisting(p));
      this.selection.select(...selectable);
    }
  }

  isExisting(point: IEC61850FlatDataPoint): boolean {
    return this.existingRefSet.has(point.reference);
  }

  applyFilter(): void {
    const search = (this.textSearch.value || '').toLowerCase().trim();
    if (!search) {
      this.filteredPoints = [...this.allPoints];
    } else {
      this.filteredPoints = this.allPoints.filter(p =>
        p.reference.toLowerCase().includes(search) ||
        p.fc.toLowerCase().includes(search) ||
        p.ln.toLowerCase().includes(search) ||
        p.do.toLowerCase().includes(search) ||
        p.da.toLowerCase().includes(search)
      );
    }
    // Clear selections that are no longer visible
    const visibleSet = new Set(this.filteredPoints);
    this.selection.selected
      .filter(s => !visibleSet.has(s))
      .forEach(s => this.selection.deselect(s));
    this.cd.markForCheck();
  }

  addSelected(): void {
    const selected = this.selection.selected.filter(p => !this.isExisting(p));

    if (this.targetCategory === 'rpc') {
      const selectedRpcConfigs: IEC61850RpcConfig[] = selected.map(p => {
        const operation = (this.operationMap.get(p) || 'read') as 'read' | 'write' | 'control';
        const tagName = this.toTagName(p);
        const prefix = operation === 'read' ? 'get_' : 'set_';
        return {
          method: prefix + tagName,
          reference: p.reference,
          fc: p.fc as IEC61850FC,
          valueType: this.inferValueType(p),
          operation,
        };
      });
      this.dialogRef.close({
        selectedRpcConfigs,
        category: this.targetCategory,
        modelTree: this._currentTree,
      });
    } else {
      const selectedKeys: IEC61850DataKey[] = selected.map(p => ({
        tag: this.toTagName(p),
        reference: p.reference,
        fc: p.fc as IEC61850FC,
        valueType: this.inferValueType(p),
      }));
      this.dialogRef.close({
        selectedKeys,
        category: this.targetCategory,
        modelTree: this._currentTree,
      });
    }
  }

  cancel(): void {
    // Return modelTree even on cancel so the parent can cache it
    this.dialogRef.close({ category: this.targetCategory, modelTree: this._currentTree });
  }

  refresh(): void {
    this.selection.clear();
    this.operationMap.clear();
    this._autoDiscover();
  }

  private initOperationMap(): void {
    if (this.targetCategory === 'rpc') {
      for (const p of this.allPoints) {
        this.operationMap.set(p, this.isWritable(p) ? 'write' : 'read');
      }
    }
  }

  private flattenModel(modelTree: { logicalDevices: IEC61850ModelNode[] }): IEC61850FlatDataPoint[] {
    const points: IEC61850FlatDataPoint[] = [];
    if (!modelTree?.logicalDevices) {
      return points;
    }
    for (const ld of modelTree.logicalDevices) {
      if (!ld.logicalNodes) { continue; }
      for (const ln of ld.logicalNodes) {
        if (!ln.dataObjects) { continue; }
        for (const dataObj of ln.dataObjects) {
          if (!dataObj.dataAttributes) { continue; }
          for (const da of dataObj.dataAttributes) {
            points.push({
              reference: da.reference,
              fc: da.fc,
              ld: ld.name,
              ln: ln.name,
              do: dataObj.name,
              da: da.name,
            });
          }
        }
      }
    }
    return points;
  }

  private toTagName(point: IEC61850FlatDataPoint): string {
    // Build a clean tag name: "GGIO1_AnIn1_mag"
    return `${point.ln}_${point.do}_${point.da}`;
  }

  private inferValueType(point: IEC61850FlatDataPoint): IEC61850ValueType {
    const da = point.da.toLowerCase();
    // mag.f or mag → float (analogue magnitude)
    if (da === 'mag' || da === 'mag.f' || da === 'f') {
      return IEC61850ValueType.FLOAT;
    }
    // stVal with MX functional constraint → float, otherwise boolean for ST
    if (da === 'stval') {
      return point.fc === 'MX' ? IEC61850ValueType.FLOAT : IEC61850ValueType.BOOLEAN;
    }
    // ctlVal → boolean (control value)
    if (da === 'ctlval') {
      return IEC61850ValueType.BOOLEAN;
    }
    // setMag → float
    if (da === 'setmag' || da === 'setmag.f') {
      return IEC61850ValueType.FLOAT;
    }
    // instMag → float
    if (da === 'instmag' || da === 'instmag.f') {
      return IEC61850ValueType.FLOAT;
    }
    // Default to string for anything we can't infer
    return IEC61850ValueType.STRING;
  }
}
