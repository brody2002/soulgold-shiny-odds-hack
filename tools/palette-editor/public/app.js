import { groupPaletteSpriteFiles, parseJascPalette } from "./palette-files.mjs";
import { hsvToRgb, rgbToHsv } from "./color-utils.mjs";

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
let copiedColor = null;
let copiedControl = null;
let droppedFileSequence = 0;
let activePicker = null;

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

const pickerPopover = document.createElement("div");
pickerPopover.className = "color-picker-popover";
pickerPopover.hidden = true;
pickerPopover.setAttribute("role", "dialog");
pickerPopover.setAttribute("aria-modal", "false");

const pickerHeader = document.createElement("div");
pickerHeader.className = "picker-header";
const pickerHeading = document.createElement("strong");
const pickerCloseButton = document.createElement("button");
pickerCloseButton.type = "button";
pickerCloseButton.className = "picker-close";
pickerCloseButton.textContent = "×";
pickerCloseButton.setAttribute("aria-label", "Close color picker");
pickerHeader.append(pickerHeading, pickerCloseButton);

const pickerSpectrum = document.createElement("div");
pickerSpectrum.className = "picker-spectrum";
pickerSpectrum.tabIndex = 0;
pickerSpectrum.setAttribute("role", "slider");
pickerSpectrum.setAttribute("aria-label", "Color saturation and brightness");
const pickerSpectrumCursor = document.createElement("span");
pickerSpectrumCursor.className = "picker-spectrum-cursor";
pickerSpectrum.append(pickerSpectrumCursor);

const hueLabel = document.createElement("label");
hueLabel.className = "picker-slider-field";
const hueLabelText = document.createElement("span");
hueLabelText.textContent = "Hue";
const hueInput = document.createElement("input");
hueInput.type = "range";
hueInput.className = "picker-hue";
hueInput.min = "0";
hueInput.max = "359";
hueInput.step = "1";
hueLabel.append(hueLabelText, hueInput);

const pickerFooter = document.createElement("div");
pickerFooter.className = "picker-footer";
const pickerPreview = document.createElement("span");
pickerPreview.className = "picker-preview";
pickerPreview.setAttribute("aria-hidden", "true");
const hexLabel = document.createElement("label");
hexLabel.className = "picker-hex-field";
const hexLabelText = document.createElement("span");
hexLabelText.textContent = "Hex";
const hexInput = document.createElement("input");
hexInput.type = "text";
hexInput.maxLength = 7;
hexInput.spellcheck = false;
hexInput.setAttribute("aria-label", "Hex color");
hexLabel.append(hexLabelText, hexInput);
const pickerDoneButton = makeButton("Done", "button-primary picker-done");
pickerFooter.append(pickerPreview, hexLabel, pickerDoneButton);
pickerPopover.append(pickerHeader, pickerSpectrum, hueLabel, pickerFooter);
document.body.append(pickerPopover);

function syncPickerPopover(changeColor) {
    if (!activePicker)
        return;
    const { hsv, state, index } = activePicker;
    const color = hsvToRgb(hsv);
    const hex = toHex(color).toUpperCase();
    pickerPopover.style.setProperty("--picker-hue", `hsl(${hsv.h} 100% 50%)`);
    pickerSpectrumCursor.style.left = `${hsv.s}%`;
    pickerSpectrumCursor.style.top = `${100 - hsv.v}%`;
    pickerSpectrum.setAttribute("aria-valuetext", `${Math.round(hsv.s)}% saturation, ${Math.round(hsv.v)}% brightness`);
    hueInput.value = String(Math.round(hsv.h));
    pickerPreview.style.background = hex;
    hexInput.value = hex;
    if (changeColor) {
        state.colors[index] = color;
        noteColorChange(state, index);
    }
}

function positionPickerPopover() {
    if (!activePicker)
        return;
    const anchor = activePicker.button.getBoundingClientRect();
    const popover = pickerPopover.getBoundingClientRect();
    const margin = 10;
    const left = Math.min(window.innerWidth - popover.width - margin, Math.max(margin, anchor.left));
    const roomBelow = window.innerHeight - anchor.bottom;
    const top = roomBelow >= popover.height + margin
        ? anchor.bottom + 8
        : Math.max(margin, anchor.top - popover.height - 8);
    pickerPopover.style.left = `${left}px`;
    pickerPopover.style.top = `${top}px`;
}

function openColorPicker(state, index, button) {
    if (activePicker)
        activePicker.button.setAttribute("aria-expanded", "false");
    activePicker = { state, index, button, hsv: rgbToHsv(state.colors[index]) };
    pickerHeading.textContent = `Color ${String(index).padStart(2, "0")}`;
    pickerPopover.hidden = false;
    button.setAttribute("aria-expanded", "true");
    syncPickerPopover(false);
    window.requestAnimationFrame(positionPickerPopover);
}

function closeColorPicker() {
    if (!activePicker)
        return;
    activePicker.button.setAttribute("aria-expanded", "false");
    activePicker = null;
    pickerPopover.hidden = true;
}

function setSpectrumFromPointer(event) {
    if (!activePicker)
        return;
    const bounds = pickerSpectrum.getBoundingClientRect();
    activePicker.hsv.s = Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100));
    activePicker.hsv.v = Math.min(100, Math.max(0, (1 - ((event.clientY - bounds.top) / bounds.height)) * 100));
    syncPickerPopover(true);
}

let draggingSpectrum = false;
pickerSpectrum.addEventListener("pointerdown", event => {
    draggingSpectrum = true;
    pickerSpectrum.setPointerCapture(event.pointerId);
    setSpectrumFromPointer(event);
});
pickerSpectrum.addEventListener("pointermove", event => {
    if (draggingSpectrum)
        setSpectrumFromPointer(event);
});
pickerSpectrum.addEventListener("pointerup", () => {
    draggingSpectrum = false;
});
hueInput.addEventListener("input", () => {
    if (!activePicker)
        return;
    activePicker.hsv.h = Number(hueInput.value);
    syncPickerPopover(true);
});
hexInput.addEventListener("input", () => {
    if (!activePicker || !/^#[0-9a-f]{6}$/i.test(hexInput.value))
        return;
    activePicker.hsv = rgbToHsv(fromHex(hexInput.value));
    syncPickerPopover(true);
});
pickerCloseButton.addEventListener("click", closeColorPicker);
pickerDoneButton.addEventListener("click", closeColorPicker);
document.addEventListener("pointerdown", event => {
    if (activePicker && !pickerPopover.contains(event.target) && !event.target.closest(".color-picker"))
        closeColorPicker();
});
document.addEventListener("keydown", event => {
    if (event.key === "Escape")
        closeColorPicker();
});
window.addEventListener("resize", positionPickerPopover);

function updateColorControl(state, index) {
    const control = state.colorControls[index];
    const color = state.colors[index];
    const hex = toHex(color).toUpperCase();
    control.picker.style.background = hex;
    color.forEach((value, channel) => {
        control.inputs[channel].value = String(value);
    });
    control.label.textContent = `INDEX ${String(index).padStart(2, "0")} · ${hex}`;
    control.picker.setAttribute("aria-label", `Edit color ${index} ${hex}`);
    control.picker.title = `Edit ${hex}`;
    control.copyButton.setAttribute("aria-label", `Copy color ${index} ${hex}`);
    control.copyButton.title = `Copy ${hex}`;
}

function updatePasteButtons() {
    const hex = copiedColor ? toHex(copiedColor).toUpperCase() : null;
    for (const state of editors.values()) {
        for (const [index, control] of state.colorControls.entries()) {
            control.pasteButton.disabled = !copiedColor;
            control.pasteButton.setAttribute("aria-label", hex ? `Paste ${hex} into color ${index}` : `Paste into color ${index}`);
            control.pasteButton.title = hex ? `Paste ${hex}` : "Copy a color first";
        }
    }
}

function noteColorChange(state, index) {
    const control = state.colorControls[index];
    updateColorControl(state, index);
    if (activePicker?.state === state && activePicker.index === index) {
        activePicker.hsv = rgbToHsv(state.colors[index]);
        syncPickerPopover(false);
    }
    if (copiedControl === control && !colorsEqual([state.colors[index]], [copiedColor])) {
        copiedControl.editor.classList.remove("is-copy-source");
        copiedControl = null;
    }
    markChanged(state);
}

function createColorEditor(state, color, index) {
    const editor = document.createElement("div");
    editor.className = "color-editor";

    const picker = document.createElement("button");
    picker.type = "button";
    picker.className = "color-picker";
    picker.setAttribute("aria-haspopup", "dialog");
    picker.setAttribute("aria-expanded", "false");

    const meta = document.createElement("div");
    meta.className = "color-meta";
    const label = document.createElement("span");
    label.className = "color-index";
    label.textContent = `INDEX ${String(index).padStart(2, "0")} · ${toHex(color).toUpperCase()}`;

    const colorTools = document.createElement("div");
    colorTools.className = "color-tools";
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "color-tool";
    copyButton.textContent = "Copy";
    const pasteButton = document.createElement("button");
    pasteButton.type = "button";
    pasteButton.className = "color-tool";
    pasteButton.textContent = "Paste";
    pasteButton.disabled = copiedColor === null;
    colorTools.append(copyButton, pasteButton);

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
            noteColorChange(state, index);
        });

        input.addEventListener("change", () => {
            const nextValue = Math.min(255, Math.max(0, Number.parseInt(input.value || "0", 10)));
            input.value = String(nextValue);
            state.colors[index][channel] = nextValue;
            noteColorChange(state, index);
        });
        return input;
    });

    picker.addEventListener("click", () => openColorPicker(state, index, picker));

    copyButton.addEventListener("click", () => {
        if (copiedControl)
            copiedControl.editor.classList.remove("is-copy-source");
        copiedColor = [...state.colors[index]];
        copiedControl = state.colorControls[index];
        copiedControl.editor.classList.add("is-copy-source");
        updatePasteButtons();
    });

    pasteButton.addEventListener("click", () => {
        if (!copiedColor)
            return;
        state.colors[index] = [...copiedColor];
        noteColorChange(state, index);
    });

    meta.append(label, rgbInputs, colorTools);
    editor.append(picker, meta);
    state.colorControls.push({ editor, picker, inputs, label, copyButton, pasteButton });
    updateColorControl(state, index);
    updatePasteButtons();
    return editor;
}

function syncColorControls(state) {
    state.colorControls.forEach((control, index) => updateColorControl(state, index));
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

function readDroppedPngDimensions(source) {
    const bytes = new Uint8Array(source);
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 24 || signature.some((value, index) => bytes[index] !== value))
        throw new Error("The matching sprite is not a valid PNG file.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
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

    const assetView = { asset, image, label, buffer: asset.buffer ?? null, objectUrl: null };
    state.assetViews.push(assetView);
    if (assetView.buffer) {
        schedulePreview(state);
        return;
    }
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
    pathLabel.textContent = state.displayPath ?? state.path;
    title.append(heading, pathLabel);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const dirtyLabel = document.createElement("span");
    dirtyLabel.className = "dirty-label";
    dirtyLabel.textContent = "Unsaved";
    dirtyLabel.hidden = true;
    const resetButton = makeButton("Reset");
    const saveButton = makeButton(state.source === "dropped" && !state.fileHandle ? "Download" : "Save", "button-primary");
    const closeButton = makeButton("Close", "button-danger");
    actions.append(dirtyLabel, resetButton, saveButton, closeButton);
    header.append(title, actions);

    const body = document.createElement("div");
    body.className = "card-body";
    const previewPanel = document.createElement("section");
    previewPanel.className = "preview-panel";
    const previewHeading = document.createElement("div");
    previewHeading.className = "section-label";
    previewHeading.textContent = state.source === "dropped"
        ? "Dropped PNG preview"
        : state.target === "unknown" ? "No conventional sprite mapping" : `${state.target} sprite preview`;
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
    updatePasteButtons();
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
        if (activePicker?.state === state)
            closeColorPicker();
        if (copiedControl && state.colorControls.includes(copiedControl)) {
            copiedControl = null;
            copiedColor = null;
        }
        editors.delete(state.path);
        card.remove();
        updatePasteButtons();
        updateSummary();
    });

    state.assets.forEach(asset => loadPreview(state, asset, previewList));
    markChanged(state);
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function markStateSaved(state, content) {
    state.expectedContent = content;
    state.diskColors = cloneColors(state.colors);
    state.dirty = false;
    state.card.classList.remove("is-dirty");
    state.dirtyLabel.hidden = true;
}

function downloadPalette(state, content) {
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = state.paletteName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveDroppedState(state) {
    const content = serializePalette(state);
    if (!state.fileHandle?.createWritable) {
        downloadPalette(state, content);
        markStateSaved(state, content);
        return "downloaded";
    }

    if (state.fileHandle.queryPermission && state.fileHandle.requestPermission) {
        let permission = await state.fileHandle.queryPermission({ mode: "readwrite" });
        if (permission === "prompt")
            permission = await state.fileHandle.requestPermission({ mode: "readwrite" });
        if (permission !== "granted")
            throw new Error(`Write access to ${state.paletteName} was not granted.`);
    }

    const currentContent = await (await state.fileHandle.getFile()).text();
    if (currentContent !== state.expectedContent)
        throw new Error(`${state.paletteName} changed on disk. Drop it again before overwriting it.`);
    const writable = await state.fileHandle.createWritable();
    try {
        await writable.write(content);
        await writable.close();
    } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
    }
    markStateSaved(state, content);
    return "saved";
}

async function saveStates(states) {
    const dirtyStates = states.filter(state => state.dirty);
    if (dirtyStates.length === 0 || saving)
        return;

    saving = true;
    updateSummary();
    try {
        let savedCount = 0;
        let downloadedCount = 0;
        const droppedStates = dirtyStates.filter(state => state.source === "dropped");
        for (const state of droppedStates) {
            const result = await saveDroppedState(state);
            if (result === "saved")
                savedCount += 1;
            else
                downloadedCount += 1;
        }

        const repositoryStates = dirtyStates.filter(state => state.source !== "dropped");
        if (repositoryStates.length > 0) {
            const response = await fetch("/api/save-palettes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    entries: repositoryStates.map(state => ({
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
                if (state)
                    markStateSaved(state, saved.content);
            }
            savedCount += body.saved.length;
        }

        const summaries = [];
        if (savedCount > 0)
            summaries.push(`Saved ${savedCount} palette${savedCount === 1 ? "" : "s"}`);
        if (downloadedCount > 0)
            summaries.push(`downloaded ${downloadedCount} palette${downloadedCount === 1 ? "" : "s"}`);
        addNotice(`${summaries.join(" and ")}.`, "success");
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

async function resolveRepositoryPalettes(items) {
    const payloadFiles = await Promise.all(items.map(async (item, index) => {
        const file = item.file ?? item;
        return {
            clientId: `${Date.now()}-${index}`,
            name: file.name,
            pathHint: file.path || file.webkitRelativePath || "",
            content: await file.text(),
        };
    }));

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
}

async function openDroppedPair(pair) {
    const paletteFile = pair.palette.file ?? pair.palette;
    const pngFile = pair.png.file ?? pair.png;
    const [paletteContent, pngBuffer] = await Promise.all([paletteFile.text(), pngFile.arrayBuffer()]);
    const palette = parseJascPalette(paletteContent);
    const dimensions = readDroppedPngDimensions(pngBuffer);
    const largestDimension = Math.max(dimensions.width, dimensions.height);
    const scale = largestDimension <= 64 ? 3 : largestDimension <= 128 ? 2 : 1;

    openEditor({
        path: `dropped:${++droppedFileSequence}:${paletteFile.name}`,
        displayPath: `${paletteFile.name} + ${pngFile.name}`,
        species: pair.stem,
        paletteName: paletteFile.name,
        version: palette.version,
        colors: palette.colors,
        diskColors: palette.colors,
        expectedContent: paletteContent,
        target: "dropped",
        source: "dropped",
        fileHandle: pair.palette.handle ?? null,
        assets: [{
            label: pngFile.name,
            kind: "dropped",
            scale,
            ...dimensions,
            buffer: pngBuffer,
        }],
    });
}

async function handleFiles(items) {
    const recognizedItems = [...items].filter(item => {
        const file = item.file ?? item;
        return file?.name && /\.(pal|png)$/i.test(file.name);
    });
    const paletteCount = recognizedItems.filter(item => (item.file ?? item).name.toLowerCase().endsWith(".pal")).length;
    if (paletteCount === 0) {
        addNotice("Choose a .pal file and its same-name .png file.");
        return;
    }

    dropZone.classList.add("is-loading");
    try {
        const grouped = groupPaletteSpriteFiles(recognizedItems);
        for (const group of grouped.ambiguous)
            addNotice(`${group.stem}: expected one .pal and one .png, but duplicate filenames were dropped.`);

        for (const pair of grouped.pairs) {
            try {
                await openDroppedPair(pair);
            } catch (error) {
                addNotice(`${pair.stem}: ${error.message}`);
            }
        }

        if (grouped.unmatchedPalettes.length > 0)
            await resolveRepositoryPalettes(grouped.unmatchedPalettes);
        for (const item of grouped.unmatchedPngs) {
            const file = item.file ?? item;
            addNotice(`${file.name}: no .pal file with the same filename was dropped.`);
        }
    } catch (error) {
        addNotice(error.message);
    } finally {
        dropZone.classList.remove("is-loading");
        fileInput.value = "";
    }
}

async function droppedItems(dataTransfer) {
    const items = [...dataTransfer.items].filter(item => item.kind === "file");
    if (items.length === 0)
        return [...dataTransfer.files].map(file => ({ file, handle: null }));
    return Promise.all(items.map(async item => {
        const file = item.getAsFile();
        let handle = null;
        if (item.getAsFileSystemHandle) {
            try {
                handle = await item.getAsFileSystemHandle();
            } catch {
                // Browsers without writable drag handles still support downloading edits.
            }
        }
        return { file, handle };
    }));
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

dropZone.addEventListener("drop", async event => handleFiles(await droppedItems(event.dataTransfer)));
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
        droppedItems(event.dataTransfer).then(handleFiles);
});
updateSummary();
