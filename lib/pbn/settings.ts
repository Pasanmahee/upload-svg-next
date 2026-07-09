import { RGB } from "./common";

export enum ClusteringColorSpace {
    RGB = 0,
    HSL = 1,
    LAB = 2,
}

export class Settings {
    public kMeansNrOfClusters: number = 16;
    public kMeansMinDeltaDifference: number = 1;
    public kMeansClusteringColorSpace: ClusteringColorSpace = ClusteringColorSpace.LAB;

    public kMeansColorRestrictions: Array<RGB | string> = [];

    public colorAliases: { [key: string]: RGB } = {};

    public narrowPixelStripCleanupRuns: number = 3; // 3 seems like a good compromise between removing enough narrow pixel strips to convergence. This fixes e.g. https://i.imgur.com/dz4ANz1.png

    public removeFacetsSmallerThanNrOfPoints: number = 20;
    public removeFacetsFromLargeToSmall: boolean = true;
    public maximumNumberOfFacets: number = Number.MAX_VALUE;

    public nrOfTimesToHalveBorderSegments: number = 2;

    public borderCurveSmoothingEnabled: boolean = true;
    public borderCurveSmoothingIterations: number = 3;
    public borderCurveSmoothingLambda: number = 0.5;
    public borderCurveSmoothingMu: number = -0.53;
    public svgCurveMode: 'quadratic_midpoint' | 'cubic_catmull' = 'cubic_catmull';

    public speckleCleanupEnabled: boolean = true;
    public speckleCleanupRadius: number = 1;
    public speckleCleanupPasses: number = 1;

    public resizeImageIfTooLarge: boolean = true;
    public resizeImageWidth: number = 1024;
    public resizeImageHeight: number = 1024;

    public randomSeed: number = new Date().getTime();
}
