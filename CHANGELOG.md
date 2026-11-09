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
- S7 tag browser: fixed size, theme colours, sortable columns, every tag
  (paged, select-all covers the whole search), search in its own row,
  fullscreen, and the certificate pin as a shield icon. Keys are named as
  TIA Portal shows them (`TRIGGER_DB.TRIG_5`, inputs/outputs/markers
  without their area), and Attribute Updates and RPC Methods browse too:
  attribute updates skip inputs, RPC rows choose Get / Set / Both (needs
  Sentient Gateway 4.16.0).
- Every connector's device dialog has a **Connection | Data Mapping**
  switch in its title bar; a saved device opens on its data mapping.
- Right-click on a key list's edit button opens it straight in the
  full-screen spreadsheet.
- Telemetry and attribute lists: **Delete selected** for the ticked keys.
- The connectors page selects the first connector on opening.
- S7 and SNMP passwords have the show/hide eye.
- Modbus slave dialog: **Detect order** reads a 32- or 64-bit value and shows
  it in all four byte/word orders with the one that makes sense (needs Sentient
  Gateway 4.14.0), plus help on what common devices use. A new slave defaults
  to BIG / LITTLE.
- Keys spreadsheet (Timeseries, Attributes, Attribute updates, RPC write):
  drag a column's edge to resize it, double-click the edge to reset.

### Fixed
- The PROFINET key popup opened empty, and so did the Modbus legacy slave
  dialog and nine legacy basic-config screens: their templates did not
  compile (a literal `@`, fields the legacy classes lacked) and the build
  shipped them blank.
- Keys spreadsheet: Ctrl+A and the header select only the rows the search
  matches, so Delete no longer removes hidden keys; the selection count is
  shown.
- S7: tag names keep their case in the address field; only absolute
  addresses are uppercased (an uppercased TIA name was not found).
- A browsed tag already in Timeseries can be added to Attributes.

### Changed
- One shared Data Mapping block draws every device dialog's key rows and
  opens their key popups (12 connectors; Modbus keeps its values block).
  Browse buttons sit after the edit button everywhere.
- Key popups open about 7x faster with thousands of keys: the form list is
  built in one go instead of revalidating it on every key.
- A new connector reports on value change or every report period.
- Configuration sync is decided from SENTIENT's own save times, not the
  browser's and the gateway's clocks, and the page checks again after a
  save until the gateway answers.
- Gateway logs show WARN in orange, with colours readable on the dark theme.
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
