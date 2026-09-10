# IFCpluck 🍒

**Pick elements from an IFC model. Get a new, valid IFC file with just those elements.**

Open a model in the browser, click the walls, pumps, slabs or rooms you need, and pluck them into a standalone IFC. Everything runs locally in your browser: the model is never uploaded.

## Features

- **WebGPU 3D viewer:** orbit, pan, zoom, click to pick, Ctrl/⌘-click to add or remove.
- **Model tree:** browse project → site → building → storey, and add everything on a storey in one click.
- **Select by type:** add every `IfcWall`, `IfcDoor`, … in the model.
- **Choose what comes along:** property and quantity sets, openings with their doors and windows, type objects, materials, assemblies and their parts. The spatial structure each element sits in always comes along, so the result opens correctly in any IFC tool.
- **Only what you picked:** a picked wall brings its openings, doors and windows, but a picked door or window never drags its host wall along.
- **Preview:** isolate exactly what will be written before you download it.
- **Keeps georeferencing:** the plucked model sits exactly where the source model does.

## Getting started

Requires Node.js 20+ and a browser with WebGPU (recent Chrome, Edge, Firefox or Safari).

```bash
npm install
npm run dev
```

Then open the URL Vite prints and drop an `.ifc` file onto the viewer.

Other scripts:

| Command | What it does |
|---|---|
| `npm run build` | Typecheck and build for production into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run smoke -- model.ifc out.ifc IfcWall 3` | Headless check: pluck the first 3 walls of `model.ifc` into `out.ifc` and verify the result |

## How it works

IFCpluck is a thin, focused interface on top of [IFClite](https://ifclite.dev):

| Package | Role |
|---|---|
| `@ifc-lite/parser` | Reads the IFC into a columnar data store |
| `@ifc-lite/data` | Entity tables, relationships and spatial hierarchy |
| `@ifc-lite/geometry` | Tessellates IFC geometry (WASM) |
| `@ifc-lite/renderer` | WebGPU rendering and GPU picking |
| `@ifc-lite/query` | Type-based selection |
| `@ifc-lite/export` | Walks relationships from the picked elements and writes the subset as IFC |

The extraction itself lives in [`src/pluck.ts`](src/pluck.ts): `collectRelatedEntities` expands the selection with the context it needs, and `StepExporter` writes exactly that subset, dropping references to anything left behind.

## Hosting

The dev and preview servers send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which IFClite's WASM geometry needs. Configure the same headers wherever you deploy `dist/`.

## Credits

Built on [IFClite](https://github.com/LTplus-AG/ifc-lite) by LTplus AG (MPL-2.0).
