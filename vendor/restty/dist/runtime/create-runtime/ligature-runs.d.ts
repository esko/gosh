type CellCluster = {
    cp: number;
    text: string;
    span: number;
};
type CursorCell = {
    row: number;
    col: number;
    wide: boolean;
};
type ResolveLigatureRunOptions = {
    idx: number;
    row: number;
    col: number;
    cols: number;
    contentTags: Uint8Array | null;
    styleFlags: Uint16Array | null;
    linkIds: Uint32Array | null;
    fgBytes: Uint8Array;
    bgBytes: Uint8Array | null;
    ulBytes: Uint8Array | null;
    ulStyle: Uint8Array | null;
    cursorBlock: boolean;
    cursorCell: CursorCell | null;
    readCellCluster: (cellIndex: number) => CellCluster | null;
};
type LigatureRun = {
    text: string;
    span: number;
    indices: number[];
};
type ShapedGlyphLike = {
    glyphId: number;
    xAdvance: number;
    xOffset: number;
};
type ShapedClusterLike = {
    glyphs: ShapedGlyphLike[];
    advance: number;
};
type ResolveRenderableLigatureRunOptions<FontEntry> = {
    ligatureRun: LigatureRun;
    stylePreference: string;
    fonts: FontEntry[];
    pickFontIndexForText: (text: string, expectedSpan?: number, stylePreference?: string) => number;
    shapeClusterWithFont: (entry: FontEntry, text: string) => ShapedClusterLike;
    readCellCluster: (cellIndex: number) => CellCluster | null;
};
export declare function resolveLigatureRun(options: ResolveLigatureRunOptions): LigatureRun | null;
export declare function shouldUseLigatureShape(combined: ShapedClusterLike, singles: ShapedClusterLike[]): boolean;
export declare function resolveRenderableLigatureRun<FontEntry>(options: ResolveRenderableLigatureRunOptions<FontEntry>): LigatureRun | null;
export {};
