import type { RenderState } from "../../../wasm";
import type { RuntimeCell } from "./types";
type DesktopWordSelectionRange = {
    start: number;
    end: number;
};
export declare function resolveDesktopWordSelectionRange(render: RenderState | null, cell: RuntimeCell): DesktopWordSelectionRange | null;
export {};
