const dropZone = document.querySelector("#drop-zone");
const fileInput = document.querySelector("#file-input");
const browseButton = document.querySelector("#browse-files");
const paletteList = document.querySelector("#palette-list");
const emptyState = document.querySelector("#empty-state");
const notices = document.querySelector("#notices");
const saveAllButton = document.querySelector("#save-all");
const changeCount = document.querySelector("#change-count");

const editors = new Map();
let saving = false;

function cloneColors(colors) {
    return colors.map(color => [...color]);
}

function colorsEqual(left, right) {
    return left.length === right.length && left.every((color, index) =>
        color.length === right[index].length && color.every((value, channel) => value === right[index][channel]));
}

function toHex(color) {
    return `#${color.map(value => value.toString(16).padStart(2, "0")).join("")}`;
}

function fromHex(hex) {
    return [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function serializePalette(state) {
    return [
        "JASC-PAL",
        state.version,
        String(state.colors.length),
        ...state.colors.map(color => color.join(" ")),
        "",
    ].join("\r\n");
}

function addNotice(message, type = "error", content) {
    const notice = document.createElement("div");
    notice.className = `notice notice-${type}`;

    const text = document.createElement("span");
    text.textContent = message;
    notice.append(text);
    if (content)
        notice.append(content);

    notices.append(notice);
    if (!content)
        window.setTimeout(() => notice.remove(), type === "success" ? 4500 : 9000);
    return notice;
}

function updateSummary() {
    const dirtyStates = [...editors.values()].filter(state => state.dirty);
    const count = dirtyStates.length;
    changeCount.textContent = count === 0 ? "No unsaved changes" : `${count} unsaved palette${count === 1 ? "" : "s"}`;
    saveAllButton.disabled = count === 0 || saving;
    emptyState.hidden = editors.size > 0;

    for (const state of editors.values()) {
        state.saveButton.disabled = !state.dirty || saving;
        state.resetButton.disabled = !state.dirty || saving;
    }
}

function markChanged(state) {
    state.dirty = !colorsEqual(state.colors, state.diskColors);
    state.card.classList.toggle("is-dirty", state.dirty);
    state.dirtyLabel.hidden = !state.dirty;
    schedulePreview(state);
    updateSummary();
}

function makeButton(label, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button ${className}`.trim();
    button.textContent = label;
    return button;
}

function createColorEditor(state, color, index) {
    const editor = document.createElement("div");
    editor.className = "color-editor";

    const picker = document.createElement("input");
    picker.type = "color";
    picker.className = "color-picker";
    picker.value = toHex(color);
    picker.setAttribute("aria-label", `Color ${index} picker`);

    const meta = document.createElement("div");
    meta.className = "color-meta";
    const label = document.createElement("span");
    label.className = "color-index";
    label.textContent = `INDEX ${String(index).padStart(2, "0")} · ${toHex(color).toUpperCase()}`;

    const rgbInputs = document.createElement("div");
    rgbInputs.className = "rgb-inputs";
    const inputs = color.map((value, channel) => {
        const wrapper = document.createElement("label");
        wrapper.className = "rgb-field";
        const channelLabel = document.createElement("span");
        channelLabel.textContent = ["R", "G", "B"][channel];
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.max = "255";
        input.step = "1";
        input.value = String(value);
        input.setAttribute("aria-label", `Color ${index} ${channelLabel.textContent}`);
        wrapper.append(channelLabel, input);
        rgbInputs.append(wrapper);

        input.addEventListener("input", () => {
            if (input.value === "")
                return;
            const nextValue = Number(input.value);
            if (!Number.isInteger(nextValue) || nextValue < 0 || nextValue > 255)
                return;
            state.colors[index][channel] = nextValue;
            picker.value = toHex(state.colors[index]);
            label.textContent = `INDEX ${String(index).padStart(2, "0")} · ${toHex(state.colors[index]).toUpperCase()}`;
            markChanged(state);
        });

        input.addEventListener("change", () => {
            const nextValue = Math.min(255, Math.max(0, Number.parseInt(input.value || "0", 10)));
            input.value = String(nextValue);
            state.colors[index][channel] = nextValue;
            picker.value = toHex(state.colors[index]);
            label.textContent = `INDEX ${String(index).padStart(2, "0")} · ${toHex(state.colors[index]).toUpperCase()}`;
            markChanged(state);
        });
        return input;
    });

    picker.addEventListener("input", () => {
        state.colors[index] = fromHex(picker.value);
        state.colors[index].forEach((value, channel) => {
            inputs[channel].value = String(value);
        });
        label.textContent = `INDEX ${String(index).padStart(2, "0")} · ${picker.value.toUpperCase()}`;
        markChanged(state);
    });

    meta.append(label, rgbInputs);
    editor.append(picker, meta);
    state.colorControls.push({ picker, inputs, label });
    return editor;
}

function syncColorControls(state) {
    state.colorControls.forEach((control, index) => {
        const color = state.colors[index];
        control.picker.value = toHex(color);
        color.forEach((value, channel) => {
            control.inputs[channel].value = String(value);
        });
        control.label.textContent = `INDEX ${String(index).padStart(2, "0")} · ${toHex(color).toUpperCase()}`;
    });
}

function crc32(bytes, start, end) {
    let crc = 0xffffffff;
    for (let index = start; index < end; index += 1)
        crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let value = 0; value < 256; value += 1) {
        let current = value;
        for (let bit = 0; bit < 8; bit += 1)
            current = (current & 1) ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
        table[value] = current >>> 0;
    }
    return table;
})();

function recolorIndexedPng(source, colors) {
    const bytes = new Uint8Array(source.slice(0));
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 8 || signature.some((value, index) => bytes[index] !== value))
        throw new Error("Sprite is not a PNG file.");

    const view = new DataView(bytes.buffer);
    let offset = 8;
    let changed = false;
    while (offset + 12 <= bytes.length) {
        const length = view.getUint32(offset, false);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        const chunkEnd = dataEnd + 4;
        if (chunkEnd > bytes.length)
            throw new Error("Sprite has a malformed PNG chunk.");

        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        if (type === "PLTE") {
            const paletteLength = Math.min(colors.length, Math.floor(length / 3));
            for (let index = 0; index < paletteLength; index += 1)
                bytes.set(colors[index], dataStart + (index * 3));
            view.setUint32(dataEnd, crc32(bytes, offset + 4, dataEnd), false);
            changed = true;
            break;
        }
        offset = chunkEnd;
    }

    if (!changed)
        throw new Error("Sprite PNG does not contain an indexed PLTE palette.");
    return new Blob([bytes], { type: "image/png" });
}

function schedulePreview(state) {
    if (state.previewFrame)
        return;
    state.previewFrame = window.requestAnimationFrame(() => {
        state.previewFrame = null;
        for (const assetView of state.assetViews) {
            if (!assetView.buffer)
                continue;
            try {
                const nextUrl = URL.createObjectURL(recolorIndexedPng(assetView.buffer, state.colors));
                const previousUrl = assetView.objectUrl;
                assetView.objectUrl = nextUrl;
                assetView.image.src = nextUrl;
                if (previousUrl)
                    URL.revokeObjectURL(previousUrl);
            } catch (error) {
                assetView.label.textContent = `${assetView.asset.label}: ${error.message}`;
            }
        }
    });
}

async function loadPreview(state, asset, previewList) {
    const item = document.createElement("figure");
    item.className = "preview-item";
    const image = document.createElement("img");
    image.className = "sprite-preview";
    image.alt = `${state.species} ${asset.label}`;
    image.width = asset.width * asset.scale;
    image.height = asset.height * asset.scale;
    image.style.width = `${asset.width * asset.scale}px`;
    image.style.height = "auto";
    const label = document.createElement("figcaption");
    label.className = "preview-label";
    label.textContent = `${asset.label} · ${asset.width}×${asset.height}`;
    item.append(image, label);
    previewList.append(item);

    const assetView = { asset, image, label, buffer: null, objectUrl: null };
    state.assetViews.push(assetView);
    try {
        const response = await fetch(`/api/asset?path=${encodeURIComponent(asset.path)}`);
        if (!response.ok)
            throw new Error((await response.json()).error || `HTTP ${response.status}`);
        assetView.buffer = await response.arrayBuffer();
        schedulePreview(state);
    } catch (error) {
        label.textContent = `${asset.label}: ${error.message}`;
    }
}

function openEditor(match) {
    const existing = editors.get(match.path);
    if (existing) {
        existing.card.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
    }

    const state = {
        ...match,
        colors: cloneColors(match.colors),
        diskColors: cloneColors(match.diskColors),
        assetViews: [],
        colorControls: [],
        previewFrame: null,
        dirty: false,
    };

    const card = document.createElement("article");
    card.className = "palette-card";
    const header = document.createElement("header");
    header.className = "card-header";
    const title = document.createElement("div");
    title.className = "card-title";
    const heading = document.createElement("h2");
    heading.textContent = `${state.species} · ${state.paletteName}`;
    const pathLabel = document.createElement("span");
    pathLabel.className = "card-path";
    pathLabel.textContent = state.path;
    title.append(heading, pathLabel);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const dirtyLabel = document.createElement("span");
    dirtyLabel.className = "dirty-label";
    dirtyLabel.textContent = "Unsaved";
    dirtyLabel.hidden = true;
    const resetButton = makeButton("Reset");
    const saveButton = makeButton("Save", "button-primary");
    const closeButton = makeButton("Close", "button-danger");
    actions.append(dirtyLabel, resetButton, saveButton, closeButton);
    header.append(title, actions);

    const body = document.createElement("div");
    body.className = "card-body";
    const previewPanel = document.createElement("section");
    previewPanel.className = "preview-panel";
    const previewHeading = document.createElement("div");
    previewHeading.className = "section-label";
    previewHeading.textContent = state.target === "unknown" ? "No conventional sprite mapping" : `${state.target} sprite preview`;
    const previewList = document.createElement("div");
    previewList.className = "preview-list";
    previewPanel.append(previewHeading, previewList);

    if (state.assets.length === 0) {
        const noAssets = document.createElement("p");
        noAssets.className = "no-assets";
        noAssets.textContent = "This palette filename does not map to a known icon, overworld, front, or back sprite.";
        previewList.append(noAssets);
    }

    const palettePanel = document.createElement("section");
    const paletteHeading = document.createElement("div");
    paletteHeading.className = "section-label";
    paletteHeading.textContent = `${state.colors.length}-color JASC palette`;
    const paletteGrid = document.createElement("div");
    paletteGrid.className = "palette-grid";
    state.colors.forEach((color, index) => paletteGrid.append(createColorEditor(state, color, index)));
    palettePanel.append(paletteHeading, paletteGrid);
    body.append(previewPanel, palettePanel);
    card.append(header, body);

    Object.assign(state, { card, dirtyLabel, resetButton, saveButton });
    editors.set(state.path, state);
    paletteList.append(card);

    resetButton.addEventListener("click", () => {
        state.colors = cloneColors(state.diskColors);
        syncColorControls(state);
        markChanged(state);
    });
    saveButton.addEventListener("click", () => saveStates([state]));
    closeButton.addEventListener("click", () => {
        for (const assetView of state.assetViews) {
            if (assetView.objectUrl)
                URL.revokeObjectURL(assetView.objectUrl);
        }
        if (state.previewFrame)
            window.cancelAnimationFrame(state.previewFrame);
        editors.delete(state.path);
        card.remove();
        updateSummary();
    });

    state.assets.forEach(asset => loadPreview(state, asset, previewList));
    markChanged(state);
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function saveStates(states) {
    const dirtyStates = states.filter(state => state.dirty);
    if (dirtyStates.length === 0 || saving)
        return;

    saving = true;
    updateSummary();
    try {
        const response = await fetch("/api/save-palettes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                entries: dirtyStates.map(state => ({
                    path: state.path,
                    content: serializePalette(state),
                    expectedContent: state.expectedContent,
                })),
            }),
        });
        const body = await response.json();
        if (!response.ok)
            throw new Error(body.error || `Save failed with HTTP ${response.status}.`);

        for (const saved of body.saved) {
            const state = editors.get(saved.path);
            if (!state)
                continue;
            state.expectedContent = saved.content;
            state.diskColors = cloneColors(state.colors);
            state.dirty = false;
            state.card.classList.remove("is-dirty");
            state.dirtyLabel.hidden = true;
        }
        addNotice(`Saved ${body.saved.length} palette${body.saved.length === 1 ? "" : "s"}.`, "success");
    } catch (error) {
        addNotice(error.message);
    } finally {
        saving = false;
        updateSummary();
    }
}

function showAmbiguousChoice(result) {
    const controls = document.createElement("div");
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Choose repository match for ${result.name}`);
    result.matches.forEach((match, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = match.path;
        select.append(option);
    });
    const openButton = makeButton("Open");
    controls.append(select, openButton);
    const notice = addNotice(`${result.name} matches more than one repository palette.`, "error", controls);
    openButton.addEventListener("click", () => {
        openEditor(result.matches[Number(select.value)]);
        notice.remove();
    });
}

async function handleFiles(fileList) {
    const files = [...fileList].filter(file => file.name.toLowerCase().endsWith(".pal"));
    if (files.length === 0) {
        addNotice("Choose at least one .pal file.");
        return;
    }

    const payloadFiles = await Promise.all(files.map(async (file, index) => ({
        clientId: `${Date.now()}-${index}`,
        name: file.name,
        pathHint: file.path || file.webkitRelativePath || "",
        content: await file.text(),
    })));

    dropZone.classList.add("is-loading");
    try {
        const response = await fetch("/api/resolve-palettes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ files: payloadFiles }),
        });
        const body = await response.json();
        if (!response.ok)
            throw new Error(body.error || `Could not inspect files (HTTP ${response.status}).`);

        for (const result of body.results) {
            if (result.error)
                addNotice(`${result.name}: ${result.error}`);
            else if (result.matches.length === 1)
                openEditor(result.matches[0]);
            else
                showAmbiguousChoice(result);
        }
    } catch (error) {
        addNotice(error.message);
    } finally {
        dropZone.classList.remove("is-loading");
        fileInput.value = "";
    }
}

for (const eventName of ["dragenter", "dragover"]) {
    dropZone.addEventListener(eventName, event => {
        event.preventDefault();
        dropZone.classList.add("is-dragging");
    });
}
for (const eventName of ["dragleave", "drop"]) {
    dropZone.addEventListener(eventName, event => {
        event.preventDefault();
        dropZone.classList.remove("is-dragging");
    });
}

dropZone.addEventListener("drop", event => handleFiles(event.dataTransfer.files));
dropZone.addEventListener("click", event => {
    if (!event.target.closest("button"))
        fileInput.click();
});
browseButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => handleFiles(fileInput.files));
saveAllButton.addEventListener("click", () => saveStates([...editors.values()]));

document.addEventListener("dragover", event => event.preventDefault());
document.addEventListener("drop", event => {
    event.preventDefault();
    if (!dropZone.contains(event.target))
        handleFiles(event.dataTransfer.files);
});
updateSummary();
