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
 * Persisted calibration shape — what the connector configs carry on
 * each data key. Exactly one of these layouts is present on a given
 * key; absence of all fields means no calibration.
 *
 *   {}                                     — no calibration
 *   { multiplier: 0.1 }                    — modifier: value × N
 *   { divider: 10 }                        — modifier: value ÷ N
 *   { adder: 50 }                          — modifier: value + N
 *   { subtractor: 273 }                    — modifier: value − N
 *   { scaling: {rawMin, rawMax,            — 2-point linear
 *              engMin, engMax} }
 *
 * All five industrial connectors (S7 / Modbus / EIP / IEC 61850 /
 * OPC-UA) use this shape on the gateway side.
 */
export interface CalibrationScalingConfig {
  rawMin: number;
  rawMax: number;
  engMin: number;
  engMax: number;
}

export interface CalibrationConfig {
  multiplier?: number;
  divider?: number;
  adder?: number;
  subtractor?: number;
  scaling?: CalibrationScalingConfig;
}

export type CalibrationMode = 'none' | 'modifier' | 'scaling';
