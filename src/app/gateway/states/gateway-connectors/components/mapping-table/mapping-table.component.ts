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

import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  forwardRef,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, take, takeUntil } from 'rxjs/operators';
import {
  ControlValueAccessor,
  FormBuilder,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  UntypedFormArray,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import {
  AttributeUpdate,
  ConnectorMapping,
  ConnectRequest,
  ConverterConnectorMapping,
  ConvertorTypeTranslationsMap,
  DeviceConnectorMapping,
  DisconnectRequest,
  MappingInfo,
  MappingType,
  MappingTypeTranslationsMap,
  MappingValue,
  RequestMappingValue,
  RequestType,
  RequestTypesTranslationsMap,
  ServerSideRpc,
} from '../../models/public-api';
import { TruncateWithTooltipDirective } from '../../../../shared/directives/public-api';
import { MappingDialogComponent } from '../public-api';
import {
  OpcUaTagImportDialogComponent,
  OpcUaTagImportDialogData,
  OpcUaTagImportResult,
} from '../opc/opc-ua-tag-import-dialog/opc-ua-tag-import-dialog.component';
import {
  OpcUaNodeBrowserDialogComponent,
  OpcUaNodeBrowserDialogData,
  OpcUaNodeBrowserDialogResult,
} from '../opc/opc-ua-node-browser-dialog/opc-ua-node-browser-dialog.component';
import { isDefinedAndNotNull, isUndefinedOrNull, DialogService } from '@core/public-api';
import { CommonModule } from '@angular/common';
import { TbTableDatasource, coerceBoolean, SharedModule } from '@shared/public-api';

@Component({
  selector: 'tb-mapping-table',
  templateUrl: './mapping-table.component.html',
  styleUrls: ['./mapping-table.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MappingTableComponent),
      multi: true
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => MappingTableComponent),
      multi: true
    }
  ],
  standalone: true,
  imports: [CommonModule, SharedModule, TruncateWithTooltipDirective]
})
export class MappingTableComponent implements ControlValueAccessor, Validator, AfterViewInit, OnInit, OnDestroy {

  @Input()
  @coerceBoolean()
  required = false;

  @Input()
  @coerceBoolean()
  withReportStrategy = true;

  /** Forwarded from the connector config so per-row actions (browse / import)
   *  can invoke RPCs against the live gateway. */
  @Input() gatewayDeviceId: string;
  @Input() connectorName: string;

  @Input()
  set mappingType(value: MappingType) {
    if (this.mappingTypeValue !== value) {
      this.mappingTypeValue = value;
    }
  }

  get mappingType(): MappingType {
    return this.mappingTypeValue;
  }

  @ViewChild('searchInput') searchInputField: ElementRef;

  mappingTypeTranslationsMap = MappingTypeTranslationsMap;
  mappingTypeEnum = MappingType;
  displayedColumns = [];
  mappingColumns = [];
  textSearchMode = false;
  dataSource: MappingDatasource & any;
  hidePageSize = false;
  activeValue = false;
  dirtyValue = false;
  mappingTypeValue: MappingType;
  mappingFormGroup: UntypedFormArray;
  textSearch = this.fb.control('', {nonNullable: true});

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void  = () => {};

  private destroy$ = new Subject<void>();

  constructor(public translate: TranslateService,
              public dialog: MatDialog,
              private dialogService: DialogService,
              private fb: FormBuilder) {
    this.mappingFormGroup = this.fb.array([]);
    this.dirtyValue = !this.activeValue;
    this.dataSource = new MappingDatasource();
  }

  ngOnInit(): void {
    this.setMappingColumns();
    this.displayedColumns.push(...this.mappingColumns.map(column => column.def), 'actions');
    this.mappingFormGroup.valueChanges.pipe(
      takeUntil(this.destroy$)
    ).subscribe((value) => {
      this.updateTableData(value);
      this.onChange(value);
      this.onTouched();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngAfterViewInit(): void {
    this.textSearch.valueChanges.pipe(
      debounceTime(150),
      distinctUntilChanged((prev, current) => (prev ?? '') === current.trim()),
      takeUntil(this.destroy$)
    ).subscribe((text) => {
      const searchText = text.trim();
      this.updateTableData(this.mappingFormGroup.value, searchText.trim());
    });
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  writeValue(connectorMappings: ConnectorMapping[]): void {
    this.mappingFormGroup.clear();
    this.pushDataAsFormArrays(connectorMappings);
  }

  validate(): ValidationErrors | null {
    return !this.required || this.mappingFormGroup.controls.length ? null : {
      mappingFormGroup: {valid: false}
    };
  }

  enterFilterMode(): void {
    this.textSearchMode = true;
    setTimeout(() => {
      this.searchInputField.nativeElement.focus();
      this.searchInputField.nativeElement.setSelectionRange(0, 0);
    }, 10);
  }

  exitFilterMode(): void {
    this.updateTableData(this.mappingFormGroup.value);
    this.textSearchMode = false;
    this.textSearch.reset();
  }

  manageMapping($event: Event, index?: number): void {
    if ($event) {
      $event.stopPropagation();
    }
    const value = isDefinedAndNotNull(index) ? this.mappingFormGroup.at(index).value : {};
    this.dialog.open<MappingDialogComponent, MappingInfo, ConnectorMapping>(MappingDialogComponent, {
      disableClose: true,
      panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
      data: {
        mappingType: this.mappingType,
        value,
        buttonTitle: isUndefinedOrNull(index) ?  'action.add' : 'action.apply',
        withReportStrategy: this.withReportStrategy,
        // OPC-UA "Browse server" inside the edit dialog needs these
        // to route the node-browser RPC — unused for other protocols.
        gatewayDeviceId: this.gatewayDeviceId,
        connectorName: this.connectorName,
      }
    }).afterClosed()
      .pipe(take(1), takeUntil(this.destroy$))
      .subscribe(res => {
        if (res) {
          if (isDefinedAndNotNull(index)) {
            this.mappingFormGroup.at(index).patchValue(res);
          } else {
            this.pushDataAsFormArrays([res]);
          }
          this.mappingFormGroup.markAsDirty();
        }
    });
  }

  private updateTableData(value: ConnectorMapping[], textSearch?: string): void {
    let tableValue = value.map(mappingValue => this.getMappingValue(mappingValue));
    if (textSearch) {
      tableValue = tableValue.filter(mappingValue =>
        Object.values(mappingValue).some(val =>
          val.toString().toLowerCase().includes(textSearch.toLowerCase())
        )
      );
    }
    this.dataSource.loadData(tableValue);
  }

  deleteMapping($event: Event, index: number): void {
    if ($event) {
      $event.stopPropagation();
    }
    const mapping = this.mappingFormGroup.controls[index].value;
    const name = mapping.deviceInfo?.deviceNameExpression ?? mapping.topicFilter ?? this.getRequestDetails(mapping);
    this.dialogService.confirm(
      this.translate.instant('gateway.delete-mapping-title', { name }),
      this.translate.instant('gateway.delete-mapping-description'),
      this.translate.instant('action.no'),
      this.translate.instant('action.yes'),
      true
    ).subscribe((result) => {
      if (result) {
        this.mappingFormGroup.removeAt(index);
        this.mappingFormGroup.markAsDirty();
      }
    });
  }

  private pushDataAsFormArrays(data: ConnectorMapping[]): void {
    if (data?.length) {
      data.forEach((mapping: ConnectorMapping) => this.mappingFormGroup.push(this.fb.control(mapping)));
    }
  }

  /**
   * Public append-only entry point for parents that discover mappings out
   * of band (e.g. OPC-UA Discover dialog in server-config). Going through
   * the FormControl setValue path would clear-then-repush every existing
   * row and cascade valueChanges up the whole form tree — heavy enough
   * to freeze the page when a device carries many keys. This bypasses
   * that and mirrors the in-component `discoverOpcDevices` flow.
   */
  addMappings(newMappings: ConnectorMapping[]): void {
    if (!newMappings?.length) return;
    // Push silently so N pushes don't fire N cascading valueChanges up
    // the form tree — each carries the whole FormArray value (growing
    // 100 → 200 → … → 2200 tags), and the chain propagates through
    // basic-config → connector form → outer form. With 2000-key devices
    // that's what freezes the UI after Apply. One final
    // updateValueAndValidity fires a single valueChanges with the final
    // value, same net effect, O(1) cost.
    newMappings.forEach(m => this.mappingFormGroup.push(this.fb.control(m), { emitEvent: false }));
    this.mappingFormGroup.updateValueAndValidity();
    this.mappingFormGroup.markAsDirty();
  }

  /**
   * Export the attributes + timeseries lists of one OPC-UA mapping row to a
   * CSV file (`key, value, section, type`) and trigger a browser download.
   * The CSV round-trips back through `importOpcTags()` — the column names
   * match the dialog's auto-detect heuristics.
   */
  exportOpcTags(index: number): void {
    const mapping: any = this.mappingFormGroup.at(index)?.value;
    if (!mapping) return;

    const rows: string[] = ['key,value,section,type'];
    const escape = (v: any) => {
      const s = (v ?? '').toString();
      // Commas in NodeId segments (rare but possible in strings) need quoting.
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    for (const t of (mapping.timeseries || [])) {
      rows.push([escape(t.key), escape(t.value), 'timeseries', escape(t.type || '')].join(','));
    }
    for (const a of (mapping.attributes || [])) {
      rows.push([escape(a.key), escape(a.value), 'attributes', escape(a.type || '')].join(','));
    }

    const name = mapping.deviceInfo?.deviceNameExpression || `opcua-mapping-${index + 1}`;
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}-tags.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Open the node browser in `devices` mode — operator picks Object nodes
   * on the server, each selection becomes a new OPC-UA mapping row anchored
   * to that node. Device name defaults to the node's display name. Operator
   * can refine device/name patterns later via the Edit (pencil) button.
   */
  discoverOpcDevices(): void {
    if (!this.gatewayDeviceId || !this.connectorName) {
      this.dialogService.alert(
        this.translate.instant('gateway.save-connector-first-title') || 'Save connector first',
        this.translate.instant('gateway.save-connector-first-body')
        || 'Save the connector, then use Discover from server — the node browser needs a live gateway connection.',
      ).subscribe();
      return;
    }

    // Compute already-mapped device-node paths so the dialog can dim them.
    const existingDeviceNodes = (this.mappingFormGroup.value as any[])
      .map(m => m?.deviceNodePattern || '')
      .filter(Boolean);

    this.dialog.open<
      OpcUaNodeBrowserDialogComponent,
      OpcUaNodeBrowserDialogData,
      OpcUaNodeBrowserDialogResult
    >(OpcUaNodeBrowserDialogComponent, {
      data: {
        gatewayDeviceId: this.gatewayDeviceId,
        connectorName: this.connectorName,
        targetSection: 'devices',
        existingValues: existingDeviceNodes,
      },
      disableClose: true,
      panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
      autoFocus: false,
    }).afterClosed().pipe(take(1), takeUntil(this.destroy$)).subscribe(result => {
      if (!result || !result.devices?.length) return;
      const newMappings: any[] = result.devices.map(d => ({
        // Path form (Root\.Objects\.<Name>) is easier to read than the
        // numeric NodeId and survives server namespace renumbering — the
        // connector splits this on `\.` to resolve nodes at runtime.
        deviceNodeSource: 'path',
        deviceNodePattern: `Root\\.Objects\\.${d.displayName}`,
        deviceInfo: {
          deviceNameExpressionSource: 'constant',
          deviceNameExpression: d.displayName,
          deviceProfileExpressionSource: 'constant',
          deviceProfileExpression: 'default',
        },
        attributes: [],
        timeseries: [],
        rpc_methods: [],
        attributes_updates: [],
      }));
      this.pushDataAsFormArrays(newMappings);
      this.mappingFormGroup.markAsDirty();
    });
  }

  /**
   * Open the OPC-UA node browser for the given mapping row — operator picks
   * Variable nodes from the live server's address space, and they're
   * appended to the row's timeseries list. Needs the connector saved first
   * (gatewayDeviceId + connectorName wired through) so the RPC can route.
   */
  browseOpcNodes(index: number, section: 'timeseries' | 'attributes' = 'timeseries'): void {
    if (!this.gatewayDeviceId || !this.connectorName) {
      this.dialogService.alert(
        this.translate.instant('gateway.save-connector-first-title') || 'Save connector first',
        this.translate.instant('gateway.save-connector-first-body')
        || 'Save the connector, then reopen this menu — the node browser needs a live gateway connection.',
      ).subscribe();
      return;
    }

    const ctrl = this.mappingFormGroup.at(index);
    if (!ctrl) return;
    const mapping: any = ctrl.value;

    // Prefill existingValues so the dialog can dim already-mapped nodes.
    const existingValues = [
      ...(mapping.timeseries || []),
      ...(mapping.attributes || []),
    ].map((t: any) => t.value).filter(Boolean);

    this.dialog.open<
      OpcUaNodeBrowserDialogComponent,
      OpcUaNodeBrowserDialogData,
      OpcUaNodeBrowserDialogResult
    >(OpcUaNodeBrowserDialogComponent, {
      data: {
        gatewayDeviceId: this.gatewayDeviceId,
        connectorName: this.connectorName,
        targetSection: section,
        existingValues,
      },
      disableClose: true,
      panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
      autoFocus: false,
    }).afterClosed().pipe(take(1), takeUntil(this.destroy$)).subscribe(result => {
      if (!result || !result.tags?.length) return;
      const updated: any = { ...mapping };
      if (result.targetSection === 'attributes') {
        updated.attributes = [...(mapping.attributes || []), ...result.tags];
      } else {
        updated.timeseries = [...(mapping.timeseries || []), ...result.tags];
      }
      ctrl.patchValue(updated);
      this.mappingFormGroup.markAsDirty();
    });
  }

  /**
   * Open the OPC-UA import dialog for one mapping row. Result's rows are
   * appended to the row's attributes + timeseries lists in-place — we
   * intentionally don't dedupe keys here, to match how Add-Key works.
   */
  importOpcTags(index: number): void {
    const ctrl = this.mappingFormGroup.at(index);
    if (!ctrl) return;
    const mapping: any = ctrl.value;
    const mappingName = mapping?.deviceInfo?.deviceNameExpression || `mapping ${index + 1}`;

    this.dialog.open<OpcUaTagImportDialogComponent, OpcUaTagImportDialogData, OpcUaTagImportResult>(
      OpcUaTagImportDialogComponent, {
        data: { mappingName },
        disableClose: true,
        panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
        autoFocus: false,
      },
    ).afterClosed().pipe(take(1), takeUntil(this.destroy$)).subscribe(result => {
      if (!result) return;
      const updated: any = {
        ...mapping,
        attributes: [...(mapping.attributes || []), ...result.attributes],
        timeseries: [...(mapping.timeseries || []), ...result.timeseries],
      };
      ctrl.patchValue(updated);
      this.mappingFormGroup.markAsDirty();
    });
  }

  private getMappingValue(value: ConnectorMapping): MappingValue {
    switch (this.mappingType) {
      case MappingType.DATA:
        const converterType = ConvertorTypeTranslationsMap.get((value as ConverterConnectorMapping).converter?.type);
        return {
          topicFilter: (value as ConverterConnectorMapping).topicFilter,
          QoS: (value as ConverterConnectorMapping).subscriptionQos,
          converter: converterType ? this.translate.instant(converterType) : ''
        };
      case MappingType.REQUESTS:
        return {
          requestType: (value as RequestMappingValue).requestType,
          type: this.translate.instant(RequestTypesTranslationsMap.get((value as RequestMappingValue).requestType)),
          details: this.getRequestDetails(value as RequestMappingValue)
        };
      case MappingType.OPCUA:
        const deviceNamePattern = (value as DeviceConnectorMapping).deviceInfo?.deviceNameExpression;
        const deviceProfileExpression = (value as DeviceConnectorMapping).deviceInfo?.deviceProfileExpression;
        const { deviceNodePattern } = value as DeviceConnectorMapping;
        return {
          deviceNodePattern,
          deviceNamePattern,
          deviceProfileExpression
        };
      default:
        return {} as MappingValue;
    }
  }

  private getRequestDetails(requestValue: RequestMappingValue): string {
    let details: string;
    if (requestValue.requestType === RequestType.ATTRIBUTE_UPDATE) {
      details = (requestValue.requestValue as AttributeUpdate).attributeFilter;
    } else if (requestValue.requestType === RequestType.SERVER_SIDE_RPC) {
      details = (requestValue.requestValue as ServerSideRpc).methodFilter;
    } else {
      details = (requestValue.requestValue as ConnectRequest | DisconnectRequest).topicFilter;
    }
    return details;
  }

  private setMappingColumns(): void {
    switch (this.mappingType) {
      case MappingType.DATA:
        this.mappingColumns.push(
          { def: 'topicFilter', title: 'gateway.topic-filter' },
          { def: 'QoS', title: 'gateway.mqtt-qos' },
          { def: 'converter', title: 'gateway.payload-type' }
        );
        break;
      case MappingType.REQUESTS:
        this.mappingColumns.push(
          { def: 'type', title: 'gateway.type' },
          { def: 'details', title: 'gateway.details' }
        );
        break;
      case MappingType.OPCUA:
        this.mappingColumns.push(
          { def: 'deviceNodePattern', title: 'gateway.device-node' },
          { def: 'deviceNamePattern', title: 'gateway.device-name' },
          { def: 'deviceProfileExpression', title: 'gateway.device-profile' }
        );
    }
  }
}

export class MappingDatasource extends TbTableDatasource<MappingValue> {
  constructor() {
    super();
  }
}
