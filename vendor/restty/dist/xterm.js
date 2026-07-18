import { n as e } from "./restty-C1ZKXXYO.js";
//#region src/xterm/app-options.ts
function t(e, t) {
	return (n) => {
		let r = typeof e == "function" ? e(n) : e ?? {}, i = r.beforeInput;
		return {
			...r,
			beforeInput: ({ text: e, source: n }) => {
				let r = i?.({
					text: e,
					source: n
				});
				if (r === null) return null;
				let a = r === void 0 ? e : r;
				return n !== "pty" && a && t(a), a;
			}
		};
	};
}
//#endregion
//#region src/xterm/dimensions.ts
function n(e, t) {
	return typeof e != "number" || !Number.isFinite(e) || e <= 0 ? t : Math.max(1, Math.trunc(e));
}
//#endregion
//#region src/xterm/listeners.ts
function r(e, t) {
	return e.add(t), { dispose: () => {
		e.delete(t);
	} };
}
function i(e, t, n) {
	let r = Array.from(e);
	for (let e = 0; e < r.length; e += 1) try {
		r[e](t);
	} catch (e) {
		console.error(`[restty/xterm] ${n} listener error:`, e);
	}
}
//#endregion
//#region src/xterm.ts
var a = class {
	resttyOptionsBase;
	userAppOptions;
	addons = /* @__PURE__ */ new Set();
	pendingOutput = [];
	dataListeners = /* @__PURE__ */ new Set();
	resizeListeners = /* @__PURE__ */ new Set();
	optionValues;
	resttyInstance = null;
	elementRef = null;
	disposed = !1;
	opened = !1;
	pendingSize = null;
	cols;
	rows;
	constructor(e = {}) {
		let { cols: t, rows: r, appOptions: i, ...a } = e;
		this.resttyOptionsBase = a, this.userAppOptions = i, this.optionValues = { ...e }, delete this.optionValues.cols, delete this.optionValues.rows, this.cols = n(t, 80), this.rows = n(r, 24), Number.isFinite(t) && Number.isFinite(r) && (this.pendingSize = {
			cols: this.cols,
			rows: this.rows
		});
	}
	get element() {
		return this.elementRef;
	}
	get restty() {
		return this.resttyInstance;
	}
	get options() {
		return {
			...this.optionValues,
			cols: this.cols,
			rows: this.rows
		};
	}
	set options(e) {
		this.ensureUsable(), this.applyOptions(e);
	}
	open(n) {
		if (this.ensureUsable(), this.opened) throw Error("xterm compatibility Terminal is already opened");
		if (this.opened = !0, this.elementRef = n, this.resttyInstance = e({
			...this.resttyOptionsBase,
			appOptions: t(this.userAppOptions, (e) => {
				i(this.dataListeners, e, "onData");
			}),
			root: n
		}), this.pendingSize && this.resttyInstance.resize(this.pendingSize.cols, this.pendingSize.rows), this.pendingOutput.length > 0) {
			for (let e = 0; e < this.pendingOutput.length; e += 1) this.resttyInstance.sendInput(this.pendingOutput[e], "pty");
			this.pendingOutput.length = 0;
		}
	}
	write(e, t) {
		if (this.ensureUsable(), !e) {
			t?.();
			return;
		}
		this.resttyInstance ? this.resttyInstance.sendInput(e, "pty") : this.pendingOutput.push(e), t?.();
	}
	writeln(e = "", t) {
		this.write(`${e}\r\n`, t);
	}
	resize(e, t) {
		this.ensureUsable();
		let r = {
			cols: n(e, this.cols),
			rows: n(t, this.rows)
		};
		this.cols = r.cols, this.rows = r.rows, this.pendingSize = r, this.resttyInstance?.resize(r.cols, r.rows), i(this.resizeListeners, r, "onResize");
	}
	focus() {
		this.disposed || this.resttyInstance?.focus();
	}
	blur() {
		this.disposed || this.resttyInstance?.blur();
	}
	clear() {
		if (this.ensureUsable(), this.resttyInstance) {
			this.resttyInstance.clearScreen();
			return;
		}
		this.pendingOutput.length = 0;
	}
	reset() {
		this.ensureUsable(), this.clear(), this.resttyInstance && this.resttyInstance.sendInput("\x1Bc", "pty");
	}
	onData(e) {
		return this.ensureUsable(), r(this.dataListeners, e);
	}
	onResize(e) {
		return this.ensureUsable(), r(this.resizeListeners, e);
	}
	setOption(e, t) {
		this.ensureUsable(), this.applyOptions({ [e]: t });
	}
	getOption(e) {
		return e === "cols" ? this.cols : e === "rows" ? this.rows : this.optionValues[e];
	}
	loadAddon(e) {
		if (this.ensureUsable(), !e || typeof e.activate != "function" || typeof e.dispose != "function") throw Error("xterm compatibility addon must define activate() and dispose()");
		this.addons.has(e) || (e.activate(this), this.addons.add(e));
	}
	dispose() {
		if (this.disposed) return;
		this.disposed = !0;
		let e = Array.from(this.addons);
		this.addons.clear();
		for (let t = 0; t < e.length; t += 1) try {
			e[t].dispose();
		} catch {}
		this.pendingOutput.length = 0, this.pendingSize = null, this.opened = !1, this.elementRef = null, this.dataListeners.clear(), this.resizeListeners.clear(), this.resttyInstance &&= (this.resttyInstance.destroy(), null);
	}
	ensureUsable() {
		if (this.disposed) throw Error("xterm compatibility Terminal is disposed");
	}
	applyOptions(e) {
		let t = Object.prototype.hasOwnProperty.call(e, "cols"), r = Object.prototype.hasOwnProperty.call(e, "rows");
		if (t || r) {
			let i = t ? n(e.cols, this.cols) : this.cols, a = r ? n(e.rows, this.rows) : this.rows;
			this.resize(i, a);
		}
		let i = Object.keys(e);
		for (let t = 0; t < i.length; t += 1) {
			let n = i[t];
			n === "cols" || n === "rows" || (this.optionValues[n] = e[n]);
		}
	}
};
//#endregion
export { a as Terminal };
