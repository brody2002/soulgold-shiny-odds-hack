export function normalizePaletteText(text) {
    return String(text).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
}

export function parseJascPalette(text) {
    const lines = normalizePaletteText(text).split("\n").map(line => line.trim());

    if (lines[0] !== "JASC-PAL")
        throw new Error("Expected a JASC-PAL header.");
    if (!/^\d{4}$/.test(lines[1] ?? ""))
        throw new Error("The palette version must be a four-digit value such as 0100.");

    const count = Number.parseInt(lines[2], 10);
    if (!Number.isInteger(count) || count < 1 || count > 256)
        throw new Error("The palette must declare between 1 and 256 colors.");
    if (lines.length < count + 3)
        throw new Error(`The palette declares ${count} colors but only contains ${lines.length - 3}.`);

    const colors = lines.slice(3, count + 3).map((line, index) => {
        const values = line.split(/\s+/).map(value => Number.parseInt(value, 10));
        if (values.length !== 3 || values.some(value => !Number.isInteger(value) || value < 0 || value > 255))
            throw new Error(`Color ${index} must contain three RGB values from 0 to 255.`);
        return values;
    });

    return { version: lines[1], count, colors };
}

function droppedFile(item) {
    return item?.file ?? item;
}

function fileStem(filename) {
    return filename.slice(0, filename.lastIndexOf("."));
}

export function groupPaletteSpriteFiles(items) {
    const groups = new Map();

    for (const item of items) {
        const file = droppedFile(item);
        if (!file || typeof file.name !== "string")
            continue;
        const lowerName = file.name.toLowerCase();
        const extension = lowerName.endsWith(".pal") ? ".pal" : lowerName.endsWith(".png") ? ".png" : null;
        if (!extension)
            continue;

        const stem = fileStem(file.name);
        const key = stem.toLowerCase();
        if (!groups.has(key))
            groups.set(key, { stem, palettes: [], pngs: [] });
        groups.get(key)[extension === ".pal" ? "palettes" : "pngs"].push(item);
    }

    const pairs = [];
    const unmatchedPalettes = [];
    const unmatchedPngs = [];
    const ambiguous = [];

    for (const group of groups.values()) {
        if (group.palettes.length === 1 && group.pngs.length === 1) {
            pairs.push({ stem: group.stem, palette: group.palettes[0], png: group.pngs[0] });
        } else if (group.palettes.length > 1 || group.pngs.length > 1) {
            ambiguous.push(group);
        } else {
            unmatchedPalettes.push(...group.palettes);
            unmatchedPngs.push(...group.pngs);
        }
    }

    return { pairs, unmatchedPalettes, unmatchedPngs, ambiguous };
}
