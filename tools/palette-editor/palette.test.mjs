import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
    findAffectedSprites,
    parseJascPalette,
    readPngDimensions,
    serializeJascPalette,
} from "./palette.mjs";
import { repoRoot } from "./server.mjs";

const infernapeDirectory = path.join(repoRoot, "graphics/pokemon/infernape");

test("JASC palettes round-trip with all RGB entries intact", async () => {
    const source = await readFile(path.join(infernapeDirectory, "shiny.pal"), "utf8");
    const parsed = parseJascPalette(source);

    assert.equal(parsed.version, "0100");
    assert.equal(parsed.count, 16);
    assert.deepEqual(parseJascPalette(serializeJascPalette(parsed)), parsed);
});

test("JASC parser rejects missing and out-of-range colors", () => {
    assert.throws(
        () => parseJascPalette("JASC-PAL\n0100\n2\n0 0 0\n"),
        /declares 2 colors/,
    );
    assert.throws(
        () => parseJascPalette("JASC-PAL\n0100\n1\n256 0 0\n"),
        /Color 0/,
    );
});

test("palette naming conventions map to the intended Infernape sprites", async () => {
    const icon = await findAffectedSprites(path.join(infernapeDirectory, "icon_shiny.pal"), repoRoot);
    const overworld = await findAffectedSprites(path.join(infernapeDirectory, "overworld_shiny.pal"), repoRoot);
    const battle = await findAffectedSprites(path.join(infernapeDirectory, "shiny.pal"), repoRoot);

    assert.equal(icon.kind, "icon");
    assert.deepEqual(icon.assets.map(asset => path.basename(asset.path)), ["icon.png"]);
    assert.equal(overworld.kind, "overworld");
    assert.deepEqual(overworld.assets.map(asset => path.basename(asset.path)), ["overworld.png"]);
    assert.equal(battle.kind, "battle");
    assert.deepEqual(battle.assets.map(asset => path.basename(asset.path)), ["anim_front.png", "back.png"]);
});

test("GBA and special palettes map to their alternate sprite files", async () => {
    const gba = await findAffectedSprites(path.join(repoRoot, "graphics/pokemon/bulbasaur/normal_gba.pal"), repoRoot);
    const hatch = await findAffectedSprites(path.join(repoRoot, "graphics/pokemon/egg/hatch_shiny.pal"), repoRoot);
    const alcremie = await findAffectedSprites(path.join(repoRoot, "graphics/pokemon/alcremie/berry/berry_default.pal"), repoRoot);

    assert.deepEqual(gba.assets.map(asset => path.basename(asset.path)), ["anim_front_gba.png", "back_gba.png"]);
    assert.deepEqual(hatch.assets.map(asset => path.basename(asset.path)), ["hatch.png"]);
    assert.deepEqual(alcremie.assets.map(asset => path.basename(asset.path)), ["front.png", "back.png"]);
});

test("sprite dimensions are read from the PNG header", async () => {
    const buffer = await readFile(path.join(infernapeDirectory, "icon.png"));
    assert.deepEqual(readPngDimensions(buffer), { width: 32, height: 64 });
});
