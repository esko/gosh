import { ResttyWasm, type ResttyWasmExports } from '@eslzzyl/restty/esm/internal';

/** Tracks Restty WASM terminal handles per numeric pane id. */
export class ResttyPaneWasmRegistry {
  private wasm: ResttyWasm | null = null;
  private readonly handles = new Map<number, number>();
  private creatingPaneId: number | null = null;
  private patched = false;

  beginPaneInit(paneId: number): void {
    this.creatingPaneId = paneId;
  }

  releasePane(paneId: number): void {
    this.handles.delete(paneId);
  }

  getWasm(): ResttyWasm | null {
    return this.wasm;
  }

  getHandle(paneId: number): number | undefined {
    const handle = this.handles.get(paneId);
    return handle && handle > 0 ? handle : undefined;
  }

  getExports(): ResttyWasmExports | null {
    return this.wasm?.exports ?? null;
  }

  ensureCreatePatch(): void {
    if (this.patched) return;
    this.patched = true;
    const origCreate = ResttyWasm.prototype.create;
    ResttyWasm.prototype.create = function patchedCreate(
      this: ResttyWasm,
      cols: number,
      rows: number,
      maxScrollback: number,
    ) {
      const handle = origCreate.call(this, cols, rows, maxScrollback);
      const registry = activeRegistry;
      if (registry) {
        registry.wasm = this;
        const paneId = registry.creatingPaneId;
        if (paneId !== null && handle) {
          registry.handles.set(paneId, handle);
          registry.creatingPaneId = null;
        }
      }
      return handle;
    };
  }
}

let activeRegistry: ResttyPaneWasmRegistry | null = null;

/** Install the create patch and bind the active registry (one adapter per tab). */
export function bindResttyPaneWasmRegistry(registry: ResttyPaneWasmRegistry): void {
  registry.ensureCreatePatch();
  activeRegistry = registry;
}

export function unbindResttyPaneWasmRegistry(registry: ResttyPaneWasmRegistry): void {
  if (activeRegistry === registry) activeRegistry = null;
}
