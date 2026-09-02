# Pokémon Palette Lab

A dependency-free localhost editor for the JASC `.pal` files under `graphics/pokemon`.

## Run it

From the repository root:

```sh
npm run palette-editor
```

Then open <http://127.0.0.1:4173>.

Do not open `public/index.html` directly with a `file://` address. Palette matching, sprite loading, and saving use the local Node server, so the static HTML file cannot function by itself.

Drag one or more `.pal` files from `graphics/pokemon` onto the page. The editor matches each file to the repository, finds its conventional sprite assets, and shows the indexed palette beside live previews.

- `normal.pal` and `shiny.pal` preview the front and back battle sprites.
- `icon_normal.pal` and `icon_shiny.pal` preview the icon sheet.
- `overworld_normal.pal` and `overworld_shiny.pal` preview the overworld sheet.
- Female palette variants use female sprite files when the species has them.
- `_gba.pal` variants preview the matching GBA-style front and back sprites.
- Special egg and Alcremie palettes fall back to their same-name or same-folder sprite assets.

The browser does not always expose a dragged file's full local path. In that case the app identifies it by filename and exact palette contents. If more than one repository file matches, it asks which one to open.

Use **Save** on one card or **Save all** in the header to overwrite the corresponding repository `.pal` files. The server rejects a save if another program changed the file after it was opened. Review the result with `git diff` before building the ROM.

## Test it

```sh
npm run test:palette-editor
```
