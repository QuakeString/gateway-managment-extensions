///
/// Copyright © 2016-2025 The Sentient Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///

/**
 * Column-config helpers shared by every industrial keys panel's
 * spreadsheet view. The calibration + report-strategy columns are
 * identical across S7 / Modbus / EIP / IEC 61850 / OPC-UA; only the
 * container set differs (some panels don't want report strategy,
 * some don't want calibration). Instead of copy-pasting these
 * column configs into each `buildColumnConfigs()` we produce them
 * here from the row FormGroup shape.
 *
 * Contract on the row FormGroup:
 *   - `calibration` control holds a CalibrationConfig
 *     (`{multiplier: N}` / `{divider: N}` / `{adder: N}` /
 *     `{subtractor: N}` / `{scaling: {...}}` / `{}`).
 *   - `reportStrategy` control holds a
 *     `{type: ReportStrategyType, reportPeriod: number}` or null.
 *
 * The returned columns read/write these controls directly so any
 * edit in the spreadsheet round-trips through the same persistent
 * shape that the list view's CalibrationBlockComponent emits.
 */

import { UntypedFormGroup } from '@angular/forms';
import {
  ReportStrategyType,
  ReportStrategyTypeTranslationsMap,
  ReportStrategyDefaultValue,
} from '../../public-api';
import {
  ModifierType,
  ModifierTypesMap,
} from '../../../states/gateway-connectors/models/public-api';
import { SpreadsheetColumnConfig, SelectOption } from '../spreadsheet-keys/spreadsheet-keys.models';
import { CalibrationConfig, CalibrationMode } from '../calibration-block/calibration-block.models';

/** Derive the current calibration mode from the persisted shape.
 *  Precedence matches the backend `_apply_calibration` ordering so
 *  the UI and converter agree on which field wins if a hand-edited
 *  config has more than one set. */
function calibrationModeOf(cfg: CalibrationConfig | null | undefined): CalibrationMode {
  if (!cfg) return 'none';
  if (cfg.multiplier !== undefined || cfg.divider !== undefined
      || cfg.adder !== undefined || cfg.subtractor !== undefined) return 'modifier';
  if (cfg.scaling) return 'scaling';
  return 'none';
}

function modifierKeyOf(cfg: CalibrationConfig | null | undefined): ModifierType | null {
  if (!cfg) return null;
  if (cfg.multiplier !== undefined) return ModifierType.MULTIPLIER;
  if (cfg.divider !== undefined) return ModifierType.DIVIDER;
  if (cfg.adder !== undefined) return ModifierType.ADDER;
  if (cfg.subtractor !== undefined) return ModifierType.SUBTRACTOR;
  return null;
}

function modifierValueOf(cfg: CalibrationConfig | null | undefined): number | null {
  if (!cfg) return null;
  return (cfg.multiplier ?? cfg.divider ?? cfg.adder ?? cfg.subtractor ?? null) as number | null;
}

function setRow(row: UntypedFormGroup, next: CalibrationConfig): void {
  row.get('calibration')?.setValue(next);
  row.markAsDirty();
}

function setModifierKey(row: UntypedFormGroup, key: ModifierType): void {
  const cur = (row.get('calibration')?.value ?? {}) as CalibrationConfig;
  const existingValue = modifierValueOf(cur) ?? 1;
  setRow(row, { [key]: existingValue } as CalibrationConfig);
}

function setModifierValue(row: UntypedFormGroup, v: string | number): void {
  const parsed = typeof v === 'number' ? v : parseFloat(String(v));
  const cur = (row.get('calibration')?.value ?? {}) as CalibrationConfig;
  const key = modifierKeyOf(cur) ?? ModifierType.MULTIPLIER;
  setRow(row, { [key]: isNaN(parsed) ? 0 : parsed } as CalibrationConfig);
}

function setScalingField(row: UntypedFormGroup, field: 'rawMin' | 'rawMax' | 'engMin' | 'engMax', v: string | number): void {
  const parsed = typeof v === 'number' ? v : parseFloat(String(v));
  const cur = (row.get('calibration')?.value ?? {}) as CalibrationConfig;
  const scaling = {
    rawMin: 0, rawMax: 65535, engMin: 0, engMax: 100,
    ...(cur.scaling ?? {}),
  };
  scaling[field] = isNaN(parsed) ? 0 : parsed;
  setRow(row, { scaling });
}

/** Produce the standard calibration column set — Mode / Mod. Type /
 *  Mod. Value / Raw Min / Raw Max / Eng Min / Eng Max. Pass
 *  `canCalibrate` to hide the cells entirely on non-numeric rows. */
export function calibrationColumns(
  canCalibrate: (row: UntypedFormGroup) => boolean,
): SpreadsheetColumnConfig[] {
  const modifierTypeOptions: SelectOption[] = (Object.values(ModifierType) as ModifierType[])
    .map(t => ({ value: t, label: ModifierTypesMap.get(t)?.name || t }));
  const isModifier = (row: UntypedFormGroup) =>
    canCalibrate(row) && calibrationModeOf(row.get('calibration')?.value) === 'modifier';
  const isScaling = (row: UntypedFormGroup) =>
    canCalibrate(row) && calibrationModeOf(row.get('calibration')?.value) === 'scaling';
  return [
    {
      key: '_calMode', label: 'Calibration', type: 'select', width: 'minmax(100px, 0.8fr)',
      options: [
        { value: 'none', label: 'None' },
        { value: 'modifier', label: 'Modifier' },
        { value: 'scaling', label: 'Scale' },
      ],
      getValue: (row) => calibrationModeOf((row as UntypedFormGroup).get('calibration')?.value),
      setValue: (row, v) => {
        const r = row as UntypedFormGroup;
        // Rewrite the calibration object wholesale when the mode
        // flips — simpler than reshaping in place, and guarantees
        // the emitted persisted shape has no stale fields from the
        // previous mode.
        if (v === 'none') {
          setRow(r, {});
        } else if (v === 'modifier') {
          const cur = (r.get('calibration')?.value ?? {}) as CalibrationConfig;
          const key = modifierKeyOf(cur) ?? ModifierType.MULTIPLIER;
          const value = modifierValueOf(cur) ?? 1;
          setRow(r, { [key]: value } as CalibrationConfig);
        } else {
          setRow(r, { scaling: { rawMin: 0, rawMax: 65535, engMin: 0, engMax: 100 } });
        }
      },
      cellVisible: (row) => canCalibrate(row as UntypedFormGroup),
    },
    {
      key: '_modifierType', label: 'Mod. Type', type: 'select', width: 'minmax(110px, 0.9fr)',
      options: modifierTypeOptions, translateLabels: true,
      getValue: (row) => modifierKeyOf((row as UntypedFormGroup).get('calibration')?.value) ?? ModifierType.MULTIPLIER,
      setValue: (row, v) => setModifierKey(row as UntypedFormGroup, v as ModifierType),
      cellVisible: (row) => canCalibrate(row as UntypedFormGroup),
      cellDisabled: (row) => !isModifier(row as UntypedFormGroup),
    },
    {
      key: '_modifierValue', label: 'Mod. Value', type: 'number', width: 'minmax(80px, 0.7fr)',
      step: 0.1, placeholder: '1',
      getValue: (row) => modifierValueOf((row as UntypedFormGroup).get('calibration')?.value) ?? 1,
      setValue: (row, v) => setModifierValue(row as UntypedFormGroup, v),
      cellVisible: (row) => canCalibrate(row as UntypedFormGroup),
      cellDisabled: (row) => !isModifier(row as UntypedFormGroup),
    },
    ...(['rawMin', 'rawMax', 'engMin', 'engMax'] as const).map(f => ({
      key: `_${f}` as string,
      label: ({ rawMin: 'Raw Min', rawMax: 'Raw Max', engMin: 'Eng Min', engMax: 'Eng Max' } as const)[f],
      type: 'number' as const,
      width: 'minmax(80px, 0.7fr)',
      placeholder: ({ rawMin: '0', rawMax: '65535', engMin: '0', engMax: '100' } as const)[f],
      getValue: (row: UntypedFormGroup) =>
        (row.get('calibration')?.value as CalibrationConfig | null)?.scaling?.[f] ?? 0,
      setValue: (row: UntypedFormGroup, v: string | number) => setScalingField(row, f, v),
      cellVisible: (row: UntypedFormGroup) => canCalibrate(row),
      cellDisabled: (row: UntypedFormGroup) => !isScaling(row),
    })),
  ];
}

/** Produce the standard per-key report-strategy column set. All five
 *  connector panels use the same three columns (enable checkbox,
 *  type select, period number) and the same getValue/setValue on
 *  the row's `reportStrategy` control. */
export function reportStrategyColumns(): SpreadsheetColumnConfig[] {
  const reportStrategyOptions: SelectOption[] = (Object.values(ReportStrategyType) as ReportStrategyType[])
    .map(t => ({ value: t, label: ReportStrategyTypeTranslationsMap.get(t) || String(t) }));
  return [
    {
      key: '_stratEnabled', label: 'Strat.', type: 'checkbox', width: '44px', headerClass: 'center',
      getValue: (row) => !!(row as UntypedFormGroup).get('reportStrategy')?.value,
      setValue: (row, v) => {
        const ctrl = (row as UntypedFormGroup).get('reportStrategy');
        if (!ctrl) return;
        ctrl.setValue(v
          ? { type: ReportStrategyType.OnReportPeriod, reportPeriod: ReportStrategyDefaultValue.Key }
          : null);
        row.markAsDirty();
      },
    },
    {
      key: '_stratType', label: 'Strat. Type', type: 'select', width: 'minmax(150px, 1fr)', translateLabels: true,
      options: reportStrategyOptions,
      getValue: (row) => (row as UntypedFormGroup).get('reportStrategy')?.value?.type ?? null,
      setValue: (row, v) => {
        const ctrl = (row as UntypedFormGroup).get('reportStrategy');
        if (!ctrl) return;
        ctrl.setValue({ ...(ctrl.value ?? {}), type: v });
        row.markAsDirty();
      },
      cellDisabled: (row) => !(row as UntypedFormGroup).get('reportStrategy')?.value,
    },
    {
      key: '_stratPeriod', label: 'Period (ms)', type: 'number', width: 'minmax(90px, 0.7fr)', placeholder: 'ms',
      getValue: (row) => (row as UntypedFormGroup).get('reportStrategy')?.value?.reportPeriod ?? null,
      setValue: (row, v) => {
        const ctrl = (row as UntypedFormGroup).get('reportStrategy');
        if (!ctrl) return;
        const parsed = typeof v === 'number' ? v : parseInt(String(v), 10);
        ctrl.setValue({ ...(ctrl.value ?? {}), reportPeriod: isNaN(parsed) ? null : parsed });
        row.markAsDirty();
      },
      cellDisabled: (row) => {
        const rs = (row as UntypedFormGroup).get('reportStrategy')?.value;
        if (!rs) return true;
        return rs.type === ReportStrategyType.OnChange || rs.type === ReportStrategyType.OnReceived;
      },
    },
  ];
}
