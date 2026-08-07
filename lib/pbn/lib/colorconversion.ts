// From https://stackoverflow.com/a/9493060/694640

/**
  * Converts an RGB color value to HSL. Conversion formula
  * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
  * Assumes r, g, and b are contained in the set [0, 255] and
  * returns h, s, and l in the set [0, 1].
  *
  * @param   Number  r       The red color value
  * @param   Number  g       The green color value
  * @param   Number  b       The blue color value
  * @return  Array           The HSL representation
  */
export function rgbToHsl(r: number, g: number, b: number) {
    r /= 255, g /= 255, b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0; // achromatic
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
            default: h = 0;
        }
        h /= 6;
    }

    return [h, s, l];
}

/**
 * Converts an HSL color value to RGB. Conversion formula
 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes h, s, and l are contained in the set [0, 1] and
 * returns r, g, and b in the set [0, 255].
 *
 * @param   Number  h       The hue
 * @param   Number  s       The saturation
 * @param   Number  l       The lightness
 * @return  Array           The RGB representation
 */
export function hslToRgb(h: number, s: number, l: number) {
    let r, g, b;

    if (s === 0) {
        r = g = b = l; // achromatic
    } else {
        const hue2rgb = (p: number, q: number, t: number) => {
            if (t < 0) { t += 1; }
            if (t > 1) { t -= 1; }
            if (t < 1 / 6) { return p + (q - p) * 6 * t; }
            if (t < 1 / 2) { return q; }
            if (t < 2 / 3) { return p + (q - p) * (2 / 3 - t) * 6; }
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }

    return [r * 255, g * 255, b * 255];
}

// From https://github.com/antimatter15/rgb-lab/blob/master/color.js

export function lab2rgb(lab: number[]) {
    let y = (lab[0] + 16) / 116,
        x = lab[1] / 500 + y,
        z = y - lab[2] / 200,
        r, g, b;

    x = 0.95047 * ((x * x * x > 0.008856) ? x * x * x : (x - 16 / 116) / 7.787);
    y = 1.00000 * ((y * y * y > 0.008856) ? y * y * y : (y - 16 / 116) / 7.787);
    z = 1.08883 * ((z * z * z > 0.008856) ? z * z * z : (z - 16 / 116) / 7.787);

    r = x * 3.2406 + y * -1.5372 + z * -0.4986;
    g = x * -0.9689 + y * 1.8758 + z * 0.0415;
    b = x * 0.0557 + y * -0.2040 + z * 1.0570;

    r = (r > 0.0031308) ? (1.055 * Math.pow(r, 1 / 2.4) - 0.055) : 12.92 * r;
    g = (g > 0.0031308) ? (1.055 * Math.pow(g, 1 / 2.4) - 0.055) : 12.92 * g;
    b = (b > 0.0031308) ? (1.055 * Math.pow(b, 1 / 2.4) - 0.055) : 12.92 * b;

    return [Math.max(0, Math.min(1, r)) * 255,
    Math.max(0, Math.min(1, g)) * 255,
    Math.max(0, Math.min(1, b)) * 255];
}

export function rgb2lab(rgb: number[]) {
    let r = rgb[0] / 255,
        g = rgb[1] / 255,
        b = rgb[2] / 255,
        x, y, z;

    r = (r > 0.04045) ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = (g > 0.04045) ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = (b > 0.04045) ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;

    x = (x > 0.008856) ? Math.pow(x, 1 / 3) : (7.787 * x) + 16 / 116;
    y = (y > 0.008856) ? Math.pow(y, 1 / 3) : (7.787 * y) + 16 / 116;
    z = (z > 0.008856) ? Math.pow(z, 1 / 3) : (7.787 * z) + 16 / 116;

    return [(116 * y) - 16, 500 * (x - y), 200 * (y - z)];
}

const degreesToRadians = (degrees: number) => degrees * Math.PI / 180;
const radiansToDegrees = (radians: number) => radians * 180 / Math.PI;

function hueAngleDegrees(a: number, b: number) {
    if (a === 0 && b === 0) {
        return 0;
    }
    const angle = radiansToDegrees(Math.atan2(b, a));
    return angle >= 0 ? angle : angle + 360;
}

/**
 * Calculates the perceptual CIEDE2000 difference between two CIELAB colours.
 * Implementation follows Sharma, Wu and Dalal (2005), with unit weighting
 * factors for graphic-art colour comparison: https://doi.org/10.1002/col.20070
 */
export function ciede2000(lab1: number[], lab2: number[]) {
    const [l1, a1, b1] = lab1;
    const [l2, a2, b2] = lab2;

    const c1 = Math.hypot(a1, b1);
    const c2 = Math.hypot(a2, b2);
    const averageC = (c1 + c2) / 2;
    const averageC7 = Math.pow(averageC, 7);
    const g = 0.5 * (1 - Math.sqrt(averageC7 / (averageC7 + Math.pow(25, 7))));

    const a1Prime = (1 + g) * a1;
    const a2Prime = (1 + g) * a2;
    const c1Prime = Math.hypot(a1Prime, b1);
    const c2Prime = Math.hypot(a2Prime, b2);
    const h1Prime = hueAngleDegrees(a1Prime, b1);
    const h2Prime = hueAngleDegrees(a2Prime, b2);

    const deltaLPrime = l2 - l1;
    const deltaCPrime = c2Prime - c1Prime;

    let deltaHPrimeDegrees = 0;
    if (c1Prime * c2Prime !== 0) {
        deltaHPrimeDegrees = h2Prime - h1Prime;
        if (deltaHPrimeDegrees > 180) {
            deltaHPrimeDegrees -= 360;
        } else if (deltaHPrimeDegrees < -180) {
            deltaHPrimeDegrees += 360;
        }
    }

    const deltaHPrime = 2 * Math.sqrt(c1Prime * c2Prime) *
        Math.sin(degreesToRadians(deltaHPrimeDegrees) / 2);
    const averageLPrime = (l1 + l2) / 2;
    const averageCPrime = (c1Prime + c2Prime) / 2;

    let averageHPrime = h1Prime + h2Prime;
    if (c1Prime * c2Prime !== 0) {
        const hueDifference = Math.abs(h1Prime - h2Prime);
        if (hueDifference <= 180) {
            averageHPrime = (h1Prime + h2Prime) / 2;
        } else if (h1Prime + h2Prime < 360) {
            averageHPrime = (h1Prime + h2Prime + 360) / 2;
        } else {
            averageHPrime = (h1Prime + h2Prime - 360) / 2;
        }
    }

    const t = 1
        - 0.17 * Math.cos(degreesToRadians(averageHPrime - 30))
        + 0.24 * Math.cos(degreesToRadians(2 * averageHPrime))
        + 0.32 * Math.cos(degreesToRadians(3 * averageHPrime + 6))
        - 0.20 * Math.cos(degreesToRadians(4 * averageHPrime - 63));
    const deltaTheta = 30 * Math.exp(-Math.pow((averageHPrime - 275) / 25, 2));
    const averageCPrime7 = Math.pow(averageCPrime, 7);
    const rC = 2 * Math.sqrt(averageCPrime7 / (averageCPrime7 + Math.pow(25, 7)));
    const lightnessOffset = averageLPrime - 50;
    const sL = 1 + (0.015 * lightnessOffset * lightnessOffset) /
        Math.sqrt(20 + lightnessOffset * lightnessOffset);
    const sC = 1 + 0.045 * averageCPrime;
    const sH = 1 + 0.015 * averageCPrime * t;
    const rT = -Math.sin(degreesToRadians(2 * deltaTheta)) * rC;

    const lTerm = deltaLPrime / sL;
    const cTerm = deltaCPrime / sC;
    const hTerm = deltaHPrime / sH;
    return Math.sqrt(
        lTerm * lTerm +
        cTerm * cTerm +
        hTerm * hTerm +
        rT * cTerm * hTerm,
    );
}
