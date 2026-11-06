# Changelog

Notable changes to the gateway management extension, the part of the SENTIENT
UI that configures gateways and their connectors. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The extension has no releases of its own: its bundle is committed to SENTIENT
(`data/resources/js_modules/`) and ships in a SENTIENT release, built against
the `sentient-ui-types` tag of that release. Sections are named by the
SENTIENT release that first carried the change. The connector features need a
Sentient Gateway new enough to support them (named in the entry).

## [Unreleased]

### Added
- Modbus slave dialog: **Detect order** reads a 32- or 64-bit value and shows
  it in all four byte/word orders with the one that makes sense (needs Sentient
  Gateway 4.14.0), plus help on what common devices use. A new slave defaults
  to BIG / LITTLE.
- Keys spreadsheet (Timeseries, Attributes, Attribute updates, RPC write):
  drag a column's edge to resize it, double-click the edge to reset.

### Changed
- Keys spreadsheet in full screen fills the window edge to edge, with square
  corners and no frame or shadow.

## [4.3.0.56] - 2026-11-02

### Changed
- Gateway labels say SENTIENT instead of ThingsBoard ([#4](https://github.com/QuakeString/gateway-managment-extensions/pull/4)).
- Keys panel: copy hover no longer clipped, one-line key cards, write buttons
  in the spreadsheet, and the row checkbox level with the delete button
  ([#2](https://github.com/QuakeString/gateway-managment-extensions/pull/2), [#3](https://github.com/QuakeString/gateway-managment-extensions/pull/3)).

## [4.3.0.55] - 2026-10-28

### Added
- Tick read keys and add them to RPC write or attribute updates with the same
  address and data type (needs Sentient Gateway 4.13.3 for the same on the
  gateway's own page) ([#1](https://github.com/QuakeString/gateway-managment-extensions/pull/1)).

## [4.3.0.50] - 2026-10-24

### Added
- Copy button on data key row headers.

### Changed
- OPC UA Discover Devices maps any folder by NodeId, with its variables; full
  screen and compact layout on both discover dialogs.

## [4.3.0.42] - 2026-10-10

### Added
- PROFINET connector form with GSDML import, keeping the device's diagnosis
  texts (gateway 4.8.0), and commissioning: network scan, names, addresses and
  resets (gateway 4.9.0).
- DNP3 connector: basic configuration (gateway 4.3.0), TLS and serial channels
  and Device Profile import (4.4.0), Secure Authentication and security
  statistic points (4.5.0), UDP channels (4.6.0), alternate addresses, a TCP
  local address and the reconnect delay (4.7.0).
- SNMP connector configuration form, trap receiver panel with SNMPv3 engine
  ID, and a Notifications list per device.
- Spreadsheet key editor: keyboard cell model, column resize, CSV export,
  import from several formats, select all.

### Fixed
- PROFINET scan dialog rows lay out as rows; Find on network names an
  unnamed device.

## Earlier

Built against upstream `thingsboard-ui-types` until SENTIENT 4.3.0.22, then
against `sentient-ui-types` from that tag.
