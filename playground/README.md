# ODGN Rights Playground

A web-based interactive tool for visualizing permission hierarchies, testing paths, and understanding rule matching in the ODGN Rights library.

## Getting Started

### Development

Run the development server with hot reloading:

```bash
bun playground
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

### Building

Build a standalone, single-file HTML version of the playground:

```bash
bun playground:build
```

The output will be at `dist/playground.html`.

## Features (Phase 1)

- **JSON Configuration Editor**: Edit roles and subject rights directly.
- **Permission Tester**: Test paths against a set of flags (Read, Write, Create, Delete, Execute).
- **Explain Output**: See exactly why a permission was granted or denied, including the matched rule and its source (direct or role).
- **Undo/Redo**: Track and revert changes to the configuration.
- **Presets**: Quick-start with common scenarios like Basic RBAC or Deny Override.

## Architecture

- **React**: UI framework.
- **Jotai**: Atomic state management with undo/redo support.
- **Bun**: Fast bundling and development server.
- **ODGN Rights**: The core library being demonstrated.
