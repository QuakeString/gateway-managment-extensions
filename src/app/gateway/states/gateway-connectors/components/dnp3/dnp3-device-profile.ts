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

import { Dnp3PointKey, Dnp3PointType } from '../../models/public-api';

/**
 * Reading an IEEE 1815 Device Profile (the DNP3 XML device description a
 * vendor ships, `DNP3DeviceProfileDocument`) into the connector's points.
 *
 * Only the data points list (part 5 of the profile) is read: for each
 * point its index, its name and its change-event class, the double-bit
 * state names, and whether a counter has a frozen counter. Element names
 * are the schema's (checked against opendnp3's own profile, schema
 * 2.10.00, "November2014"), matched by local name so any of the schema's
 * namespaces reads. Outputs come in as their status points; their commands
 * are left to configure by hand, since a profile does not say which CROB
 * a site should send.
 */

export interface Dnp3ProfilePoint {
  point: Dnp3PointKey;
  /** The profile's name for the point, as written. */
  name: string;
  /** 1–3, or 0 when the point reports no events. */
  eventClass: number;
}

export interface Dnp3DeviceProfile {
  /** `documentHeader/documentName`, when the profile has one. */
  documentName?: string;
  points: Dnp3ProfilePoint[];
}

/** A point list of the profile, the element of one point in it, and our type. */
const LISTS: { list: string; item: string; pointType: Dnp3PointType }[] = [
  { list: 'binaryInputPoints', item: 'binaryInput', pointType: Dnp3PointType.BINARY_INPUT },
  { list: 'doubleBitInputPoints', item: 'doubleBitInput', pointType: Dnp3PointType.DOUBLE_BIT_BINARY },
  { list: 'binaryOutputPoints', item: 'binaryOutput', pointType: Dnp3PointType.BINARY_OUTPUT_STATUS },
  { list: 'counterPoints', item: 'counter', pointType: Dnp3PointType.COUNTER },
  { list: 'analogInputPoints', item: 'analogInput', pointType: Dnp3PointType.ANALOG_INPUT },
  { list: 'analogOutputPoints', item: 'analogOutput', pointType: Dnp3PointType.ANALOG_OUTPUT_STATUS },
  { list: 'octetStringPoints', item: 'octetString', pointType: Dnp3PointType.OCTET_STRING },
];

const CLASSES: Record<string, number> = { none: 0, one: 1, two: 2, three: 3 };

function children(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter(child => child.localName === localName);
}

function child(parent: Element, localName: string): Element | undefined {
  return children(parent, localName)[0];
}

function text(parent: Element, localName: string): string {
  return (child(parent, localName)?.textContent ?? '').trim();
}

function eventClass(value: string): number {
  return CLASSES[value.toLowerCase()] ?? 0;
}

/** `BI #0` → `bi0`, `Breaker 1 Status` → `breaker1Status`. */
export function keyFromName(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(word => word);
  return words
    .map((word, i) => i === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

/**
 * The points of a profile. Keys come from the points' names, made unique
 * against each other and against `taken` (the device's existing keys).
 * Throws an `Error` whose message says what is wrong with the file.
 */
export function parseDnp3DeviceProfile(
  xml: string,
  taken: Iterable<string> = [],
  parser: DOMParser = new DOMParser(),
): Dnp3DeviceProfile {
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('not an XML file');
  }
  const root = doc.documentElement;
  if (root?.localName !== 'DNP3DeviceProfileDocument') {
    throw new Error(`not a DNP3 Device Profile: the document is <${root?.localName}>, not <DNP3DeviceProfileDocument>`);
  }
  const lists = Array.from(root.getElementsByTagNameNS('*', 'dataPointsList'));
  if (!lists.length) {
    throw new Error('the profile has no data points list (part 5)');
  }
  const used = new Set<string>(taken);
  const unique = (base: string): string => {
    let key = base;
    for (let n = 2; used.has(key); n++) {
      key = `${base}_${n}`;
    }
    used.add(key);
    return key;
  };
  const header = root.getElementsByTagNameNS('*', 'documentName')[0];
  const points: Dnp3ProfilePoint[] = [];
  for (const { list, item, pointType } of LISTS) {
    const container = child(lists[0], list);
    const dataPoints = container && child(container, 'dataPoints');
    if (!dataPoints) {
      continue;
    }
    for (const element of children(dataPoints, item)) {
      const index = Number.parseInt(text(element, 'index'), 10);
      if (!Number.isInteger(index) || index < 0 || index > 65535) {
        continue;
      }
      const name = text(element, 'name');
      const base = keyFromName(name) || `${pointType}${index}`;
      const point: Dnp3PointKey = { key: unique(base), pointType, index };
      if (pointType === Dnp3PointType.DOUBLE_BIT_BINARY) {
        const states: Record<string, string> = {};
        for (const state of ['0', '1', '2', '3']) {
          const stateName = text(element, `nameState${state}`);
          if (stateName) {
            states[state] = stateName;
          }
        }
        if (Object.keys(states).length) {
          point.states = states;
        }
      }
      const classText = pointType === Dnp3PointType.COUNTER
        ? text(element, 'counterEventClass')
        : text(element, 'changeEventClass');
      points.push({ point, name, eventClass: eventClass(classText) });
      if (pointType === Dnp3PointType.COUNTER && text(element, 'frozenCounterExists') === 'true') {
        points.push({
          point: { key: unique(`${base}Frozen`), pointType: Dnp3PointType.FROZEN_COUNTER, index },
          name: name ? `${name} (frozen)` : '',
          eventClass: eventClass(text(element, 'frozenCounterEventClass')),
        });
      }
    }
  }
  return { documentName: header?.textContent?.trim() || undefined, points };
}
