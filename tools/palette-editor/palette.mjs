import path from "node:path";
import { access, readdir } from "node:fs/promises";
import { normalizePaletteText, parseJascPalette } from "./public/palette-files.mjs";

export { normalizePaletteText, parseJascPalette } from "./public/palette-files.mjs";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function serializeJascPalette(palette) {
    const colors = palette.colors ?? [];
    if (colors.length < 1 || colors.length > 256)
        throw new Error("A palette must contain between 1 and 256 colors.");

    for (const [index, color] of colors.entries()) {
        if (!Array.isArray(color) || color.length !== 3 || color.some(value => !Number.isInteger(value) || value < 0 || value > 255))
            throw new Error(`Color ${index} must contain three RGB values from 0 to 255.`);
    }

    return [
        "JASC-PAL",
        palette.version ?? "0100",
        String(colors.length),
        ...colors.map(color => color.join(" ")),
        "",
    ].join("\r\n");
}

export async function collectFiles(root, extension) {
    const results = [];

    async function visit(directory) {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory())
                await visit(absolutePath);
            else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension))
                results.push(absolutePath);
        }
    }

    await visit(root);
    return results.sort();
}

async function firstExisting(directory, names) {
    for (const name of names) {
        const candidate = path.join(directory, name);
        try {
            await access(candidate);
            return candidate;
        } catch {
            // Try the next conventional filename.
        }
    }
    return null;
}

function paletteKind(filename) {
    const lower = filename.toLowerCase();
    if (lower.startsWith("iconf_"))
        return { kind: "icon", female: true, gba: false };
    if (lower.startsWith("icon_"))
        return { kind: "icon", female: false, gba: false };
    if (lower.startsWith("overworld_") && /f\.pal$/.test(lower))
        return { kind: "overworld", female: true, gba: false };
    if (lower.startsWith("overworld_"))
        return { kind: "overworld", female: false, gba: false };
    if (/^(normal|shiny)f\.pal$/.test(lower))
        return { kind: "battle", female: true, gba: false };
    if (/^(normal|shiny)_gba\.pal$/.test(lower))
        return { kind: "battle", female: false, gba: true };
    if (/^(normal|shiny)\.pal$/.test(lower))
        return { kind: "battle", female: false, gba: false };
    return { kind: "unknown", female: false, gba: false };
}

export async function findAffectedSprites(palettePath, repoRoot) {
    const directory = path.dirname(palettePath);
    const filename = path.basename(palettePath);
    const descriptor = paletteKind(filename);
    const assets = [];

    if (descriptor.kind === "icon") {
        const asset = await firstExisting(directory, descriptor.female ? ["iconf.png", "icon.png"] : ["icon.png"]);
        if (asset)
            assets.push({ path: path.relative(repoRoot, asset), label: descriptor.female ? "Female icon frames" : "Icon frames", kind: "icon", scale: 4 });
    } else if (descriptor.kind === "overworld") {
        const asset = await firstExisting(directory, descriptor.female ? ["overworldf.png", "overworld.png"] : ["overworld.png"]);
        if (asset)
            assets.push({ path: path.relative(repoRoot, asset), label: descriptor.female ? "Female overworld frames" : "Overworld frames", kind: "overworld", scale: 3 });
    } else if (descriptor.kind === "battle") {
        const frontNames = descriptor.gba
            ? ["anim_front_gba.png", "front_gba.png"]
            : descriptor.female
                ? ["anim_frontf.png", "frontf.png", "anim_front.png"]
                : ["anim_front.png", "front.png"];
        const backNames = descriptor.gba
            ? ["back_gba.png"]
            : descriptor.female
                ? ["backf.png", "back.png"]
                : ["back.png"];
        const front = await firstExisting(directory, frontNames);
        const back = await firstExisting(directory, backNames);
        if (front)
            assets.push({ path: path.relative(repoRoot, front), label: descriptor.gba ? "GBA front battle sprite" : "Front battle sprite", kind: "battle-front", scale: 3 });
        if (back)
            assets.push({ path: path.relative(repoRoot, back), label: descriptor.gba ? "GBA back battle sprite" : "Back battle sprite", kind: "battle-back", scale: 3 });
    } else {
        const stem = filename.slice(0, -path.extname(filename).length).replace(/_shiny$/i, "");
        const sameNameAsset = await firstExisting(directory, [`${stem}.png`]);
        if (sameNameAsset) {
            descriptor.kind = "special";
            assets.push({ path: path.relative(repoRoot, sameNameAsset), label: `${stem.replaceAll("_", " ")} sprite`, kind: "special", scale: 3 });
        } else {
            const front = await firstExisting(directory, ["anim_front.png", "front.png"]);
            const back = await firstExisting(directory, ["back.png"]);
            if (front || back)
                descriptor.kind = "battle variant";
            if (front)
                assets.push({ path: path.relative(repoRoot, front), label: "Front battle sprite", kind: "battle-front", scale: 3 });
            if (back)
                assets.push({ path: path.relative(repoRoot, back), label: "Back battle sprite", kind: "battle-back", scale: 3 });
        }
    }

    return { ...descriptor, assets };
}

export function readPngDimensions(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE))
        throw new Error("Not a valid PNG file.");
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
