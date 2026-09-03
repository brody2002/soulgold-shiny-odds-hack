export function rgbToHsv([red, green, blue]) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;

    if (delta !== 0) {
        if (max === r)
            hue = 60 * (((g - b) / delta) % 6);
        else if (max === g)
            hue = 60 * (((b - r) / delta) + 2);
        else
            hue = 60 * (((r - g) / delta) + 4);
    }
    if (hue < 0)
        hue += 360;

    return {
        h: hue,
        s: max === 0 ? 0 : (delta / max) * 100,
        v: max * 100,
    };
}

export function hsvToRgb({ h, s, v }) {
    const hue = ((h % 360) + 360) % 360;
    const saturation = Math.min(100, Math.max(0, s)) / 100;
    const value = Math.min(100, Math.max(0, v)) / 100;
    const chroma = value * saturation;
    const section = hue / 60;
    const x = chroma * (1 - Math.abs((section % 2) - 1));
    let channels;

    if (section < 1)
        channels = [chroma, x, 0];
    else if (section < 2)
        channels = [x, chroma, 0];
    else if (section < 3)
        channels = [0, chroma, x];
    else if (section < 4)
        channels = [0, x, chroma];
    else if (section < 5)
        channels = [x, 0, chroma];
    else
        channels = [chroma, 0, x];

    const match = value - chroma;
    return channels.map(channel => Math.round((channel + match) * 255));
}
