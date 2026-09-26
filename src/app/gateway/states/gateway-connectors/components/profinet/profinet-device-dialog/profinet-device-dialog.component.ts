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

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  Inject,
  Renderer2,
  ViewContainerRef,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { AbstractControl, FormBuilder, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { DialogComponent, SharedModule } from '@shared/public-api';
import { Store } from '@ngrx/store';
import { AppState } from '@core/public-api';
import { Router } from '@angular/router';
import { MatButton } from '@angular/material/button';
import { TbPopoverService } from '@shared/components/popover.service';
import { TbPopoverComponent } from '@shared/components/popover.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DeviceProfileNameAutocompleteComponent, EllipsisChipListDirective } from '../../../../../shared/public-api';
import {
  PROFINET_DEFAULT_POLL_PERIOD_MS,
  PROFINET_DEFAULT_REDUCTION_RATIO,
  PROFINET_REDUCTION_RATIOS,
  ProfinetArea,
  ProfinetAttributeUpdate,
  ProfinetDeviceConfig,
  ProfinetKey,
  ProfinetModuleConfig,
  ProfinetRpcConfig,
  ProfinetValueKey,
} from '../../../models/public-api';
import {
  ProfinetDataKeysPanelComponent,
  ProfinetSubmodulePlace,
} from '../profinet-data-keys-panel/profinet-data-keys-panel.component';
import {
  GsdmlDap,
  GsdmlDocument,
  GsdmlModule,
  dapConfig,
  decodeGsdml,
  gsdmlNumber,
  keysFor,
  moduleConfig,
  modulesForSlot,
  parseGsdml,
} from '../profinet-gsdml';

export interface ProfinetDeviceDialogData {
  device?: ProfinetDeviceConfig;
  isEdit: boolean;
  /** The connector's other devices: names and names of station stay unique. */
  otherDevices: ProfinetDeviceConfig[];
  gatewayDeviceId?: string;
  connectorName?: string;
}

/** A slot of an imported GSDML's DAP and the module chosen for it. */
interface SlotChoice {
  slot: number;
  moduleId: string;
  options: GsdmlModule[];
  fixed: boolean;
}

type ProfinetKeys = Array<ProfinetKey | ProfinetAttributeUpdate | ProfinetRpcConfig>;

/** PROFINET's NameOfStation: DNS labels in lower case, dot-separated. */
const NAME_OF_STATION = /^(?!port-\d{3})[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const IPV4 = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/;

/** A 16-bit ident: decimal or 0x hex. */
function ident16(control: AbstractControl): ValidationErrors | null {
  const n = gsdmlNumber(`${control.value ?? ''}`);
  return n !== undefined && n >= 0 && n <= 0xFFFF ? null : { ident: true };
}

export function subslotNumber(v: number | string | undefined): number {
  return typeof v === 'number' ? v : (gsdmlNumber(v) ?? 1);
}

@Component({
  selector: 'tb-profinet-device-dialog',
  templateUrl: './profinet-device-dialog.component.html',
  styleUrls: ['./profinet-device-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    EllipsisChipListDirective,
    DeviceProfileNameAutocompleteComponent,
  ],
})
export class ProfinetDeviceDialogComponent extends DialogComponent<ProfinetDeviceDialogComponent, ProfinetDeviceConfig> {

  readonly ValueKey = ProfinetValueKey;
  readonly reductionRatios = PROFINET_REDUCTION_RATIOS;
  isEdit: boolean;
  keysPopupClosed = true;

  /** A GSDML read and waiting for its modules to be placed. */
  gsdmlImport: {
    file: string;
    doc: GsdmlDocument;
    dapId: string;
    slots: SlotChoice[];
    generateKeys: boolean;
  } | null = null;
  gsdmlError = '';

  deviceForm = this.fb.group({
    deviceName: ['', [Validators.required, Validators.pattern(/\S/), this.unique('deviceName')]],
    deviceType: ['default'],
    nameOfStation: ['', [Validators.required, Validators.pattern(NAME_OF_STATION), this.unique('nameOfStation')]],
    ip: ['', [Validators.pattern(IPV4)]],
    netmask: ['255.255.255.0', [Validators.pattern(IPV4)]],
    gateway: ['', [Validators.pattern(IPV4)]],
    assignIp: [false],
    vendorId: ['', [Validators.required, ident16]],
    deviceId: ['', [Validators.required, ident16]],
    reductionRatio: [PROFINET_DEFAULT_REDUCTION_RATIO, [Validators.required]],
    watchdogFactor: [3, [Validators.required, Validators.min(1), Validators.max(255)]],
    dataHoldFactor: [3, [Validators.required, Validators.min(1), Validators.max(255)]],
    pollPeriod: [PROFINET_DEFAULT_POLL_PERIOD_MS, [Validators.required, Validators.min(10)]],
    readIm0: [true],
    outputsEnabled: [false],
    recordWritesEnabled: [false],
    modules: [[] as ProfinetModuleConfig[], [(c: AbstractControl) => this.modulesValid(c)]],
    timeseries: [[] as ProfinetKey[]],
    attributes: [[] as ProfinetKey[]],
    attributeUpdates: [[] as ProfinetAttributeUpdate[]],
    rpc: [[] as ProfinetRpcConfig[]],
  }, { validators: [(group: AbstractControl) => this.addressValid(group)] });

  private popoverComponent: TbPopoverComponent<ProfinetDataKeysPanelComponent>;
  private gsdmlMeta: { file?: string; dap?: string } | undefined;

  constructor(
    protected store: Store<AppState>,
    protected router: Router,
    @Inject(MAT_DIALOG_DATA) public data: ProfinetDeviceDialogData,
    public dialogRef: MatDialogRef<ProfinetDeviceDialogComponent, ProfinetDeviceConfig>,
    private fb: FormBuilder,
    private popoverService: TbPopoverService,
    private renderer: Renderer2,
    private viewContainerRef: ViewContainerRef,
    private destroyRef: DestroyRef,
    private cdr: ChangeDetectorRef,
  ) {
    super(store, router, dialogRef);
    this.isEdit = data.isEdit;
    const device = data.device;
    if (device) {
      this.deviceForm.patchValue({
        ...(device as any),
        vendorId: `${device.vendorId ?? ''}`,
        deviceId: `${device.deviceId ?? ''}`,
        ip: device.ip ?? '',
        netmask: device.netmask ?? '255.255.255.0',
        gateway: device.gateway ?? '',
        assignIp: !!device.assignIp,
        reductionRatio: device.reductionRatio ?? PROFINET_DEFAULT_REDUCTION_RATIO,
        watchdogFactor: device.watchdogFactor ?? 3,
        dataHoldFactor: device.dataHoldFactor ?? 3,
        pollPeriod: device.pollPeriod ?? PROFINET_DEFAULT_POLL_PERIOD_MS,
        readIm0: device.readIm0 !== false,
        outputsEnabled: !!device.outputs?.enabled,
        recordWritesEnabled: !!device.recordWrites?.enabled,
        modules: device.modules ?? [],
        timeseries: device.timeseries ?? [],
        attributes: device.attributes ?? [],
        attributeUpdates: device.attributeUpdates ?? [],
        rpc: device.rpc ?? [],
      }, { emitEvent: false });
      this.gsdmlMeta = device.gsdml;
    }
  }

  get modules(): ProfinetModuleConfig[] {
    return (this.deviceForm.get('modules').value ?? []) as ProfinetModuleConfig[];
  }

  get cycleMs(): number {
    return Number(this.deviceForm.get('reductionRatio').value) || PROFINET_DEFAULT_REDUCTION_RATIO;
  }

  get gsdmlFile(): string | undefined {
    return this.gsdmlMeta?.file;
  }

  /** Every submodule with data, for the key panels. */
  get submodulePlaces(): ProfinetSubmodulePlace[] {
    return this.modules.flatMap(m => m.submodules.map(s => {
      const subslot = subslotNumber(s.subslot);
      const inputLength = s.inputLength ?? 0;
      const outputLength = s.outputLength ?? 0;
      const io = [inputLength ? `in ${inputLength}` : '', outputLength ? `out ${outputLength}` : ''].filter(x => x).join(', ');
      return {
        slot: m.slot,
        subslot,
        inputLength,
        outputLength,
        label: `${m.slot}/${subslot} ${s.name || m.name || ''}${io ? ` (${io})` : ''}`,
      };
    }));
  }

  moduleIo(m: ProfinetModuleConfig): string {
    const input = m.submodules.reduce((sum, s) => sum + (s.inputLength ?? 0), 0);
    const output = m.submodules.reduce((sum, s) => sum + (s.outputLength ?? 0), 0);
    return [input ? `in ${input}` : '', output ? `out ${output}` : ''].filter(x => x).join(' · ') || '—';
  }

  removeModule(slot: number): void {
    const control = this.deviceForm.get('modules');
    control.setValue(this.modules.filter(m => m.slot !== slot));
    control.markAsDirty();
  }

  cancel(): void {
    if (this.keysPopupClosed) {
      this.dialogRef.close(null);
    }
  }

  save(): void {
    if (this.deviceForm.invalid) {
      return;
    }
    const f = this.deviceForm.getRawValue();
    const trim = (v: string | null | undefined) => (v ?? '').trim();
    const ident = (v: string) => {
      const t = trim(v);
      return /^0x/i.test(t) ? t : Number(t);
    };
    const result: ProfinetDeviceConfig = {
      deviceName: trim(f.deviceName),
      deviceType: f.deviceType || 'default',
      nameOfStation: trim(f.nameOfStation),
      vendorId: ident(f.vendorId),
      deviceId: ident(f.deviceId),
      reductionRatio: Number(f.reductionRatio),
      watchdogFactor: Number(f.watchdogFactor),
      dataHoldFactor: Number(f.dataHoldFactor),
      pollPeriod: Number(f.pollPeriod),
      readIm0: !!f.readIm0,
      outputs: { enabled: !!f.outputsEnabled },
      recordWrites: { enabled: !!f.recordWritesEnabled },
      modules: f.modules as ProfinetModuleConfig[],
      timeseries: f.timeseries as ProfinetKey[],
      attributes: f.attributes as ProfinetKey[],
      attributeUpdates: f.attributeUpdates as ProfinetAttributeUpdate[],
      rpc: f.rpc as ProfinetRpcConfig[],
    };
    if (trim(f.ip)) {
      result.ip = trim(f.ip);
      result.netmask = trim(f.netmask) || '255.255.255.0';
      if (trim(f.gateway)) {
        result.gateway = trim(f.gateway);
      }
    }
    if (f.assignIp) {
      result.assignIp = true;
    }
    if (this.gsdmlMeta) {
      result.gsdml = this.gsdmlMeta;
    }
    // Anything the gateway reads that this form does not show is kept.
    const kept = this.data.device as any;
    for (const key of ['instance', 'reportStrategy']) {
      if (kept?.[key] !== undefined) {
        (result as any)[key] = kept[key];
      }
    }
    this.dialogRef.close(result);
  }

  // ── GSDML import ───────────────────────────────────────────────────────

  /** Read a GSDML and offer its access points and modules, slot by slot. */
  onGsdmlFile(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    // As bytes: older GSDMLs are ISO-8859-1, which `file.text()` would
    // read as UTF-8.
    file.arrayBuffer().then(buffer => {
      try {
        const doc = parseGsdml(decodeGsdml(new Uint8Array(buffer)));
        this.gsdmlImport = { file: file.name, doc, dapId: doc.daps[0].id, slots: [], generateKeys: true };
        this.onDapChosen();
        this.gsdmlError = '';
      } catch (e) {
        this.gsdmlImport = null;
        this.gsdmlError = (e as Error).message;
      }
      this.cdr.markForCheck();
    });
  }

  get importDap(): GsdmlDap | undefined {
    return this.gsdmlImport?.doc.daps.find(d => d.id === this.gsdmlImport.dapId);
  }

  /** The DAP's slots, each with the modules it takes; fixed and used ones filled in. */
  onDapChosen(): void {
    const imp = this.gsdmlImport;
    const dap = this.importDap;
    if (!imp || !dap) {
      return;
    }
    // What is configured already, kept where the new DAP allows it.
    const current = new Map(this.modules.map(m => [m.slot, m.gsdmlId ?? '']));
    imp.slots = dap.physicalSlots.filter(slot => slot !== 0).map(slot => {
      const options = modulesForSlot(imp.doc, dap, slot);
      const fixed = dap.useableModules.find(u => u.fixedInSlots.includes(slot));
      const used = dap.useableModules.find(u => u.usedInSlots.includes(slot));
      const kept = options.find(m => m.id === current.get(slot));
      return {
        slot,
        options,
        fixed: !!fixed,
        moduleId: fixed?.moduleId ?? kept?.id ?? used?.moduleId ?? '',
      };
    }).filter(s => s.options.length);
  }

  get importPlacedCount(): number {
    return (this.gsdmlImport?.slots ?? []).filter(s => s.moduleId).length;
  }

  /** The DAP and the placed modules become the device's modules; keys offered from their data. */
  applyGsdml(): void {
    const imp = this.gsdmlImport;
    const dap = this.importDap;
    if (!imp || !dap) {
      return;
    }
    const modules: ProfinetModuleConfig[] = [dapConfig(dap)];
    const placed: { slot: number; module: GsdmlModule }[] = [];
    for (const s of imp.slots) {
      const module = s.options.find(m => m.id === s.moduleId);
      if (module) {
        modules.push(moduleConfig(module, s.slot));
        placed.push({ slot: s.slot, module });
      }
    }
    const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;
    const patch: any = {
      modules,
      vendorId: hex(imp.doc.vendorId),
      deviceId: hex(imp.doc.deviceId),
    };
    if (!(this.deviceForm.get('nameOfStation').value ?? '').trim() && dap.dnsCompatibleName) {
      patch.nameOfStation = dap.dnsCompatibleName.toLowerCase();
    }
    if (imp.generateKeys) {
      const f = this.deviceForm.getRawValue();
      const taken = new Set<string>([
        ...(f.timeseries as ProfinetKey[]).map(k => k.key),
        ...(f.attributes as ProfinetKey[]).map(k => k.key),
        ...(f.attributeUpdates as ProfinetAttributeUpdate[]).map(k => k.key),
      ]);
      // A key whose place is already configured is not added again.
      const at = (k: { slot: number; subslot?: number | string; offset?: number; bit?: number; area?: string }) =>
        `${k.slot}/${subslotNumber(k.subslot ?? 1)}/${k.offset ?? 0}/${k.bit ?? ''}/${k.area ?? ''}`;
      const readAt = new Set((f.timeseries as ProfinetKey[]).map(at));
      const writeAt = new Set((f.attributeUpdates as ProfinetAttributeUpdate[]).map(k => at({ ...k, area: 'output' })));
      const reads: ProfinetKey[] = [];
      const writes: ProfinetAttributeUpdate[] = [];
      for (const { slot, module } of placed) {
        for (const sub of module.submodules) {
          reads.push(...keysFor(slot, sub, ProfinetArea.INPUT, taken).filter(k => !readAt.has(at(k))));
          writes.push(...keysFor(slot, sub, ProfinetArea.OUTPUT, taken)
            .map(({ area: _area, ...k }) => k)
            .filter(k => !writeAt.has(at({ ...k, area: 'output' }))));
        }
      }
      patch.timeseries = [...(f.timeseries as ProfinetKey[]), ...reads];
      patch.attributeUpdates = [...(f.attributeUpdates as ProfinetAttributeUpdate[]), ...writes];
    }
    this.deviceForm.patchValue(patch);
    this.deviceForm.markAsDirty();
    this.gsdmlMeta = { file: imp.file, dap: dap.id };
    this.gsdmlImport = null;
    this.cdr.markForCheck();
  }

  // ── Keys ───────────────────────────────────────────────────────────────

  manageKeys($event: Event, matButton: MatButton, keysType: ProfinetValueKey): void {
    $event?.stopPropagation();
    if (this.popoverComponent && !this.popoverComponent.tbHidden) {
      this.popoverComponent.hide();
    }
    const trigger = matButton._elementRef.nativeElement;
    if (this.popoverService.hasPopover(trigger)) {
      this.popoverService.hidePopover(trigger);
      return;
    }
    const keysControl = this.deviceForm.get(keysType);
    const panelTitles = {
      [ProfinetValueKey.TIMESERIES]: 'gateway.gw-timeseries',
      [ProfinetValueKey.ATTRIBUTES]: 'gateway.attributes',
      [ProfinetValueKey.ATTRIBUTES_UPDATES]: 'gateway.gw-attribute-updates',
      [ProfinetValueKey.RPC]: 'gateway.gw-rpc-methods',
    };
    const ctx = {
      keys: keysControl.value,
      keysType,
      panelTitle: panelTitles[keysType],
      addKeyTitle: keysType === ProfinetValueKey.RPC ? 'gateway.gw-add-method' : 'gateway.gw-add-key',
      deleteKeyTitle: 'gateway.gw-delete-key',
      noKeysText: 'gateway.gw-no-keys-configured-hint',
      submodules: this.submodulePlaces,
    };
    this.keysPopupClosed = false;
    this.popoverComponent = this.popoverService.displayPopover(
      trigger,
      this.renderer,
      this.viewContainerRef,
      ProfinetDataKeysPanelComponent,
      'leftTop',
      false,
      null,
      ctx,
      {},
      {},
      {},
      true
    );
    this.popoverComponent.tbComponentRef.instance.keysDataApplied
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((keysData: ProfinetKeys) => {
        this.popoverComponent.hide();
        keysControl.patchValue(keysData as any);
        keysControl.markAsDirty();
        this.cdr.markForCheck();
      });
    this.popoverComponent.tbComponentRef.instance.cancelled
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.popoverComponent.hide();
      });
    this.popoverComponent.tbHideStart
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.keysPopupClosed = true;
      });
  }

  // ── Validation ─────────────────────────────────────────────────────────

  private unique(field: 'deviceName' | 'nameOfStation'): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = (control.value ?? '').trim();
      const taken = (this.data?.otherDevices ?? []).some(d => ((d as any)[field] ?? '').trim() === value);
      return value && taken ? { duplicate: true } : null;
    };
  }

  /** The DAP in slot 0 is what a Connect needs first. */
  private modulesValid(control: AbstractControl): ValidationErrors | null {
    const modules = (control.value ?? []) as ProfinetModuleConfig[];
    return modules.some(m => m.slot === 0) ? null : { noDap: true };
  }

  /** Assigning an address needs one. */
  private addressValid(group: AbstractControl): ValidationErrors | null {
    return group.get('assignIp')?.value && !(group.get('ip')?.value ?? '').trim() ? { assignNeedsIp: true } : null;
  }
}
