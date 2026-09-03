# Pokémon Palette Lab

A dependency-free localhost editor for matching JASC `.pal` and indexed `.png` files.

## Run it

From the repository root:

```sh
npm run palette-editor
```

Then open <http://127.0.0.1:4173>.

Do not open `public/index.html` directly with a `file://` address. Palette matching, sprite loading, and saving use the local Node server, so the static HTML file cannot function by itself.

Drag a `.pal` file and a `.png` file with the same basename onto the page—for example, `lugia.pal` and `lugia.png`. The files can be stored anywhere; they do not need to be under `graphics/pokemon`. Multiple pairs can be dropped together.

When the browser supplies a writable file handle, **Save** writes changes back to the dropped `.pal`. Otherwise the button says **Download** and saves an edited copy through the browser. A repository palette dropped without a same-name PNG still uses the older `graphics/pokemon` sprite lookup as a fallback.

Tap a color swatch to open the built-in saturation/brightness spectrum, hue slider, and hex field. Use the compact **Copy** and **Paste** controls in each color tile to reuse a color anywhere among the currently open palettes.

- `normal.pal` and `shiny.pal` preview the front and back battle sprites.
- `icon_normal.pal` and `icon_shiny.pal` preview the icon sheet.
- `overworld_normal.pal` and `overworld_shiny.pal` preview the overworld sheet.
- Female palette variants use female sprite files when the species has them.
- `_gba.pal` variants preview the matching GBA-style front and back sprites.
- Special egg and Alcremie palettes fall back to their same-name or same-folder sprite assets.

For the repository fallback, the browser does not always expose a dragged file's full local path. In that case the app identifies it by filename and exact palette contents. If more than one repository file matches, it asks which one to open.

Use the action on one card or **Save all** in the header to write or download edited palettes. Writable files and repository fallback files are checked for outside changes before the editor overwrites them. Review repository edits with `git diff` before building the ROM.

## Test it

```sh
npm run test:palette-editor
```
