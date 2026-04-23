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
 * Calibration block — one expansion panel with a Mode dropdown and
 * either modifier (× / ÷ / + / −) or scaling (2-point linear) fields.
 *
 * ControlValueAccessor: binds to a single form control on the host's
 * row FormGroup. Persisted value is the flat CalibrationConfig shape
 * (`{multiplier: 0.1}` / `{scaling: {...}}` / `{}`). Internal form is
 * richer — separate mode, modifier, and scaling sub-controls — but
 * only the effective persisted fields leak out through writeValue /
 * onChange.
 *
 * Hosts pass `canCalibrate` to hide the block for non-numeric value
 * types. When hidden, writeValue still round-trips the last-known
 * persisted value so flipping types back restores it.
 */

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  forwardRef,
  inject,
  Input,
  OnDestroy,
  OnInit,
} from '@angular/core';
import {
  ControlValueAccessor,
  FormBuilder,
  FormGroup,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ModifierType, ModifierTypesMap } from '../../../states/gateway-connectors/models/public-api';
import { CalibrationConfig, CalibrationMode } from './calibration-block.models';

@Component({
  selector: 'tb-calibration-block',
  templateUrl: './calibration-block.component.html',
  styleUrls: ['./calibration-block.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, SharedModule, ReactiveFormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CalibrationBlockComponent),
      multi: true,
    },
  ],
})
export class CalibrationBlockComponent implements ControlValueAccessor, OnInit, OnDestroy {

  /** When false the block renders nothing (but still retains value
   *  so it round-trips correctly if the type flips back). Host
   *  computes this from the row's value type (e.g. for S7 / Modbus /
   *  IEC 61850 only numeric types allow calibration). */
  @Input() canCalibrate = true;

  readonly modifierTypes: ModifierType[] = Object.values(ModifierType) as ModifierType[];
  readonly ModifierTypesMap = ModifierTypesMap;

  form: FormGroup;

  private fb = inject(FormBuilder);
  private cd = inject(ChangeDetectorRef);
  private destroy$ = new Subject<void>();

  private onChange: (value: CalibrationConfig) => void = () => {};
  private onTouched: () => void = () => {};

  get mode(): CalibrationMode {
    return this.form.get('mode')!.value as CalibrationMode;
  }

  constructor() {
    // `mode` drives the enable state of modifier vs scaling fields.
    // Modifier: modifierType (enum) + modifierValue (number).
    // Scaling:  nested FormGroup with the four linear-map edges.
    this.form = this.fb.group({
      mode: this.fb.control<CalibrationMode>('none'),
      modifierType: this.fb.control<ModifierType>(ModifierType.MULTIPLIER),
      modifierValue: this.fb.control<number>(1),
      scaling: this.fb.group({
        rawMin: this.fb.control<number>(0),
        rawMax: this.fb.control<number>(65535),
        engMin: this.fb.control<number>(0),
        engMax: this.fb.control<number>(100),
      }),
    });
  }

  ngOnInit(): void {
    this.form.get('mode')!.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(mode => {
        this.applyEnableState(mode as CalibrationMode);
        this.emit();
      });
    this.form.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.emit());
    this.applyEnableState(this.mode);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  writeValue(value: CalibrationConfig | null): void {
    // Parse the flat persisted shape back into the form's richer
    // internal state. Only one of the four modifier keys (or scaling)
    // is expected at a time; if multiple are somehow set, we pick in
    // precedence order so the form is deterministic.
    const v = value ?? {};
    let mode: CalibrationMode = 'none';
    let modifierType = ModifierType.MULTIPLIER;
    let modifierValue = 1;
    if (v.multiplier !== undefined) {
      mode = 'modifier'; modifierType = ModifierType.MULTIPLIER; modifierValue = v.multiplier;
    } else if (v.divider !== undefined) {
      mode = 'modifier'; modifierType = ModifierType.DIVIDER; modifierValue = v.divider;
    } else if (v.adder !== undefined) {
      mode = 'modifier'; modifierType = ModifierType.ADDER; modifierValue = v.adder;
    } else if (v.subtractor !== undefined) {
      mode = 'modifier'; modifierType = ModifierType.SUBTRACTOR; modifierValue = v.subtractor;
    } else if (v.scaling) {
      mode = 'scaling';
    }

    const scaling = v.scaling ?? { rawMin: 0, rawMax: 65535, engMin: 0, engMax: 100 };
    this.form.patchValue({
      mode,
      modifierType,
      modifierValue,
      scaling: {
        rawMin: scaling.rawMin,
        rawMax: scaling.rawMax,
        engMin: scaling.engMin,
        engMax: scaling.engMax,
      },
    }, { emitEvent: false });
    this.applyEnableState(mode);
    this.cd.markForCheck();
  }

  registerOnChange(fn: (value: CalibrationConfig) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    isDisabled ? this.form.disable({ emitEvent: false }) : this.form.enable({ emitEvent: false });
    if (!isDisabled) this.applyEnableState(this.mode);
  }

  private applyEnableState(mode: CalibrationMode): void {
    const modT = this.form.get('modifierType');
    const modV = this.form.get('modifierValue');
    const scaling = this.form.get('scaling') as FormGroup;
    if (mode === 'modifier') {
      modT?.enable({ emitEvent: false });
      modV?.enable({ emitEvent: false });
      scaling?.disable({ emitEvent: false });
    } else if (mode === 'scaling') {
      modT?.disable({ emitEvent: false });
      modV?.disable({ emitEvent: false });
      scaling?.enable({ emitEvent: false });
    } else {
      modT?.disable({ emitEvent: false });
      modV?.disable({ emitEvent: false });
      scaling?.disable({ emitEvent: false });
    }
  }

  private emit(): void {
    const raw = this.form.getRawValue();
    const out: CalibrationConfig = {};
    if (raw.mode === 'modifier' && raw.modifierType != null) {
      (out as any)[raw.modifierType] = raw.modifierValue;
    } else if (raw.mode === 'scaling') {
      out.scaling = {
        rawMin: raw.scaling.rawMin,
        rawMax: raw.scaling.rawMax,
        engMin: raw.scaling.engMin,
        engMax: raw.scaling.engMax,
      };
    }
    this.onChange(out);
    this.onTouched();
  }
}
