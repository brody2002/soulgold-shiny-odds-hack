import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import {
    collectFiles,
    findAffectedSprites,
    normalizePaletteText,
    parseJascPalette,
    readPngDimensions,
} from "./palette.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(moduleDirectory, "../..");
export const paletteRoot = path.join(repoRoot, "graphics/pokemon");
const publicRoot = path.join(moduleDirectory, "public");
const MAX_BODY_SIZE = 2 * 1024 * 1024;

const MIME_TYPES = new Map([
    [".css", "text/css; charset=utf-8"],
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".png", "image/png"],
    [".svg", "image/svg+xml"],
]);

function isWithin(parent, candidate) {
    const relative = path.relative(parent, candidate);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function safeRepoPath(relativePath, extension) {
    if (typeof relativePath !== "string")
        throw new Error("A repository-relative path is required.");
    const absolutePath = path.resolve(repoRoot, relativePath);
    if (!isWithin(paletteRoot, absolutePath) || (extension && path.extname(absolutePath).toLowerCase() !== extension))
        throw new Error("The requested path is outside graphics/pokemon.");
    return absolutePath;
}

function sendJson(response, statusCode, body) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(body));
}

async function readJson(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY_SIZE)
            throw new Error("Request body is too large.");
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function contentHash(text) {
    return crypto.createHash("sha256").update(normalizePaletteText(text)).digest("hex");
}

async function buildPaletteIndex() {
    const files = await collectFiles(paletteRoot, ".pal");
    const entries = [];
    for (const absolutePath of files) {
        const content = await readFile(absolutePath, "utf8");
        entries.push({
            absolutePath,
            relativePath: path.relative(repoRoot, absolutePath),
            filename: path.basename(absolutePath).toLowerCase(),
            hash: contentHash(content),
        });
    }
    return entries;
}

function resolvePathHint(pathHint) {
    if (!pathHint || typeof pathHint !== "string")
        return null;

    let absolutePath;
    if (path.isAbsolute(pathHint)) {
        absolutePath = path.resolve(pathHint);
    } else {
        const normalized = pathHint.replaceAll("\\", "/");
        const marker = "graphics/pokemon/";
        const markerIndex = normalized.indexOf(marker);
        if (markerIndex === -1)
            return null;
        absolutePath = path.resolve(repoRoot, normalized.slice(markerIndex));
    }

    return isWithin(paletteRoot, absolutePath) && path.extname(absolutePath).toLowerCase() === ".pal" ? absolutePath : null;
}

async function describeMatch(entry, droppedContent) {
    const diskContent = await readFile(entry.absolutePath, "utf8");
    const droppedPalette = parseJascPalette(droppedContent);
    const diskPalette = parseJascPalette(diskContent);
    const target = await findAffectedSprites(entry.absolutePath, repoRoot);

    for (const asset of target.assets) {
        const buffer = await readFile(path.join(repoRoot, asset.path));
        Object.assign(asset, readPngDimensions(buffer));
    }

    return {
        path: entry.relativePath,
        species: path.basename(path.dirname(entry.absolutePath)),
        paletteName: path.basename(entry.absolutePath),
        version: droppedPalette.version,
        colors: droppedPalette.colors,
        diskColors: diskPalette.colors,
        expectedContent: diskContent,
        target: target.kind,
        assets: target.assets,
    };
}

async function resolvePaletteFiles(request, response, paletteIndex) {
    const body = await readJson(request);
    if (!Array.isArray(body.files) || body.files.length < 1 || body.files.length > 50)
        return sendJson(response, 400, { error: "Choose between 1 and 50 palette files." });

    const results = [];
    for (const file of body.files) {
        try {
            if (typeof file.name !== "string" || !file.name.toLowerCase().endsWith(".pal"))
                throw new Error("Only .pal files are supported.");
            parseJascPalette(file.content);

            const hintedPath = resolvePathHint(file.pathHint);
            let candidates = [];
            if (hintedPath) {
                const hintedEntry = paletteIndex.find(entry => entry.absolutePath === hintedPath);
                if (hintedEntry)
                    candidates = [hintedEntry];
            }

            if (candidates.length === 0) {
                const hash = contentHash(file.content);
                candidates = paletteIndex.filter(entry => entry.filename === file.name.toLowerCase() && entry.hash === hash);
            }

            const matches = [];
            for (const entry of candidates.slice(0, 50))
                matches.push(await describeMatch(entry, file.content));

            results.push({
                clientId: file.clientId,
                name: file.name,
                matches,
                error: matches.length === 0 ? "No exact repository match was found. Drag the unmodified .pal file from graphics/pokemon." : null,
            });
        } catch (error) {
            results.push({ clientId: file.clientId, name: file.name, matches: [], error: error.message });
        }
    }

    sendJson(response, 200, { results });
}

async function savePalettes(request, response, paletteIndex) {
    const body = await readJson(request);
    if (!Array.isArray(body.entries) || body.entries.length < 1 || body.entries.length > 50)
        return sendJson(response, 400, { error: "Choose between 1 and 50 palettes to save." });

    const validated = [];
    for (const entry of body.entries) {
        const absolutePath = safeRepoPath(entry.path, ".pal");
        parseJascPalette(entry.content);
        const diskContent = await readFile(absolutePath, "utf8");
        if (diskContent !== entry.expectedContent)
            return sendJson(response, 409, { error: `${entry.path} changed on disk. Drop it again before overwriting it.` });
        validated.push({ ...entry, absolutePath });
    }

    const saved = [];
    for (const entry of validated) {
        const temporaryPath = `${entry.absolutePath}.palette-editor-${process.pid}-${crypto.randomUUID()}`;
        try {
            await writeFile(temporaryPath, entry.content, "utf8");
            await rename(temporaryPath, entry.absolutePath);
        } finally {
            await unlink(temporaryPath).catch(() => {});
        }
        const indexedEntry = paletteIndex.find(candidate => candidate.absolutePath === entry.absolutePath);
        if (indexedEntry)
            indexedEntry.hash = contentHash(entry.content);
        saved.push({ path: entry.path, content: entry.content });
    }

    sendJson(response, 200, { saved });
}

async function serveAsset(requestUrl, response) {
    const relativePath = requestUrl.searchParams.get("path");
    const absolutePath = safeRepoPath(relativePath, ".png");
    const body = await readFile(absolutePath);
    response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
    response.end(body);
}

async function serveStatic(pathname, response) {
    const requested = pathname === "/" ? "index.html" : pathname.slice(1);
    const absolutePath = path.resolve(publicRoot, requested);
    if (!isWithin(publicRoot, absolutePath) && absolutePath !== path.join(publicRoot, "index.html"))
        throw new Error("Invalid static path.");
    const info = await stat(absolutePath);
    if (!info.isFile())
        throw new Error("Static path is not a file.");
    const body = await readFile(absolutePath);
    response.writeHead(200, {
        "Content-Type": MIME_TYPES.get(path.extname(absolutePath)) ?? "application/octet-stream",
        "Cache-Control": "no-store",
    });
    response.end(body);
}

export async function createPaletteEditorServer() {
    const paletteIndex = await buildPaletteIndex();
    return http.createServer(async (request, response) => {
        try {
            const requestUrl = new URL(request.url, "http://127.0.0.1");
            if (request.method === "GET" && requestUrl.pathname === "/api/health")
                return sendJson(response, 200, { ok: true, palettes: paletteIndex.length });
            if (request.method === "POST" && requestUrl.pathname === "/api/resolve-palettes")
                return await resolvePaletteFiles(request, response, paletteIndex);
            if (request.method === "POST" && requestUrl.pathname === "/api/save-palettes")
                return await savePalettes(request, response, paletteIndex);
            if (request.method === "GET" && requestUrl.pathname === "/api/asset")
                return await serveAsset(requestUrl, response);
            if (request.method === "GET")
                return await serveStatic(decodeURIComponent(requestUrl.pathname), response);
            sendJson(response, 405, { error: "Method not allowed." });
        } catch (error) {
            const statusCode = error.code === "ENOENT" ? 404 : 400;
            sendJson(response, statusCode, { error: error.message });
        }
    });
}

export async function startPaletteEditor() {
    const host = "127.0.0.1";
    const port = Number.parseInt(process.env.PALETTE_EDITOR_PORT ?? "4173", 10);
    const server = await createPaletteEditorServer();
    server.listen(port, host, () => {
        console.log(`Pokémon Palette Lab: http://${host}:${port}`);
        console.log(`Indexed ${path.relative(repoRoot, paletteRoot)} for .pal files.`);
    });
    return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
    await startPaletteEditor();
