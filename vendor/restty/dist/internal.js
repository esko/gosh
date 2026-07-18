import { $ as e, A as t, At as n, B as r, Bt as i, C as a, Ct as o, D as s, Dt as c, E as l, Et as u, F as d, Ft as f, G as p, H as ee, I as te, It as ne, J as re, K as ie, L as ae, Lt as oe, M as m, Mt as h, N as g, Nt as _, O as v, Ot as y, P as b, Pt as x, Q as S, R as C, Rt as w, S as T, St as E, T as D, Tt as O, U as k, V as A, W as j, X as M, Y as N, Z as P, _ as F, _t as I, a as L, at as R, b as z, bt as B, c as V, ct as H, d as U, dt as W, et as G, f as K, ft as q, g as se, gt as ce, h as le, ht as ue, it as J, j as de, jt as fe, k as pe, kt as me, l as he, lt as ge, m as _e, mt as ve, nt as ye, o as be, ot as Y, p as xe, pt as Se, q as X, rt as Ce, s as we, st as Te, t as Ee, tt as De, u as Oe, ut as ke, v as Ae, vt as je, w as Me, wt as Ne, x as Pe, xt as Fe, y as Ie, yt as Le, z as Re, zt as ze } from "./restty-C1ZKXXYO.js";
import { i as Be, n as Ve, r as He, t as Ue } from "./catalog-CT_LqUAA.js";
//#region src/renderer/webgpu/state.ts
function Z() {
	return {
		active: !1,
		lastAt: 0,
		cols: 0,
		rows: 0,
		dpr: 1
	};
}
function We() {
	return {
		lastInputAt: 0,
		lastTotal: 0,
		lastOffset: 0,
		lastLen: 0
	};
}
//#endregion
//#region src/fonts/manager/picker.ts
function Ge(e) {
	return e >= 127462 && e <= 127487 || e >= 127744 && e <= 129791;
}
function Ke(e) {
	return e >= 65024 && e <= 65039 || e >= 917760 && e <= 917999;
}
function qe(e) {
	return e >= 768 && e <= 879 || e >= 6832 && e <= 6911 || e >= 7616 && e <= 7679 || e >= 8400 && e <= 8447 || e >= 65056 && e <= 65071;
}
function Je(e) {
	return !!(e === 8204 || e === 8205 || Ke(e) || qe(e) || e >= 917536 && e <= 917631);
}
function Ye(e, t) {
	if (e.includes("️")) return "emoji";
	if (e.includes("︎")) return "text";
	if (e.includes("‍")) return "emoji";
	for (let e of t) if (Ge(e.codePointAt(0) ?? 0)) return "emoji";
	return "auto";
}
function Xe(e, t, n) {
	if (!e.fonts.length) return 0;
	let r = `${n}:${t}`, i = e.fontPickCache.get(r);
	if (i !== void 0) return i;
	let a = Array.from(t), o = a.filter((e) => !Je(e.codePointAt(0) ?? 0)), s = k(t.codePointAt(0) ?? 0), c = Ye(t, a), l = (t) => {
		for (let n = 0; n < e.fonts.length; n += 1) {
			let r = e.fonts[n];
			if (!r?.font || t && !t(r)) continue;
			let i = !0;
			for (let e of o) if (!X(r.font, e)) {
				i = !1;
				break;
			}
			if (i) return n;
		}
		return -1;
	}, u = (t) => t < 0 ? null : (e.fontPickCache.set(r, t), t);
	if (s) {
		let e = u(l((e) => R(e) || Y(e)));
		if (e !== null) return e;
	}
	if (c === "emoji") {
		let e = u(l((e) => J(e)));
		if (e !== null) return e;
	} else if (c === "text") {
		let e = u(l((e) => !J(e)));
		if (e !== null) return e;
	}
	let d = l();
	return d >= 0 ? (e.fontPickCache.set(r, d), d) : (e.fontPickCache.set(r, 0), 0);
}
//#endregion
//#region src/fonts/manager/sources.ts
async function Q(e) {
	try {
		let t = await fetch(e);
		if (t.ok) return t.arrayBuffer();
	} catch {}
	return null;
}
async function $(e) {
	let t = globalThis, n = t.navigator ?? navigator, r = typeof t.queryLocalFonts == "function" ? t.queryLocalFonts.bind(t) : typeof n.queryLocalFonts == "function" ? n.queryLocalFonts.bind(n) : null;
	if (!r) return null;
	let i = e.map((e) => e.toLowerCase()).filter(Boolean);
	if (!i.length) return null;
	let a = n.permissions?.query;
	if (a) try {
		if ((await a({ name: "local-fonts" }))?.state === "denied") return null;
	} catch {}
	try {
		let e = (await r()).find((e) => {
			let t = `${e.family ?? ""} ${e.fullName ?? ""} ${e.postscriptName ?? ""}`.toLowerCase();
			return i.some((e) => t.includes(e));
		});
		if (e) return (await e.blob()).arrayBuffer();
	} catch (e) {
		console.warn("queryLocalFonts failed", e);
	}
	return null;
}
async function Ze(e, t, n) {
	let r = await $(e);
	if (r) return r;
	let i = await Q(t);
	if (i) return i;
	let a = await $(n);
	if (a) return a;
	throw Error("Unable to load primary font.");
}
async function Qe(e) {
	let t = [];
	for (let n of e) {
		let e = await Q(n.url);
		if (e) {
			t.push({
				name: n.name,
				buffer: e
			});
			continue;
		}
		if (n.matchers && n.matchers.length) {
			let e = await $(n.matchers);
			e && t.push({
				name: n.name,
				buffer: e
			});
		}
	}
	return t;
}
//#endregion
export { E as BOX_LINE_MAP, oe as BOX_STYLE_DOUBLE, w as BOX_STYLE_HEAVY, ze as BOX_STYLE_LIGHT, i as BOX_STYLE_NONE, ce as GLYPH_SHADER, r as NERD_CONSTRAINTS, ee as NERD_SYMBOL_RANGES, z as PREEDIT_ACTIVE_BG, Pe as PREEDIT_BG, T as PREEDIT_CARET, a as PREEDIT_FG, Me as PREEDIT_UL, I as RECT_SHADER, Ee as Restty, H as ResttyWasm, Ne as applyAlpha, M as clamp, D as clearPreedit, K as clearSelection, L as colorToFloats, be as colorToRgbU32, P as computeCellMetrics, ke as configureContext, g as connectPty, je as constrainGlyphBox, he as copyToClipboard, j as createFontEntry, p as createFontManagerState, S as createGridState, l as createImeState, Te as createInputHandler, b as createPtyConnection, Z as createResizeState, We as createScrollbarState, xe as createSelectionState, d as createWebSocketPtyTransport, te as disconnectPty, o as drawBlockElement, Fe as drawBoxDrawing, B as drawBraille, Le as drawPowerline, s as endComposition, _e as endSelection, W as ensureGLInstanceBuffer, q as ensureInstanceBuffer, ie as fontAdvanceUnits, X as fontHasGlyph, e as fontHeightUnits, De as fontMaxCellSpan, ye as fontRasterScale, Ce as fontScaleOverride, Ue as getBuiltinTheme, Ve as getBuiltinThemeSource, A as getNerdConstraint, U as getSelectionText, re as glyphWidthUnits, Se as initWebGL, ve as initWebGPU, ue as initWebGPUCore, y as isBlockElement, me as isBoxDrawing, n as isBraille, He as isBuiltinThemeName, fe as isGraphicsElement, h as isLegacyComputing, k as isNerdSymbolCodepoint, R as isNerdSymbolFont, _ as isPowerline, x as isPrivateUse, ae as isPtyConnected, f as isSpaceCp, ne as isSymbolCp, Y as isSymbolFont, Be as listBuiltinThemeNames, Qe as loadFallbackFontBuffers, Ze as loadPrimaryFontBuffer, ge as loadResttyWasm, le as normalizeSelectionCell, we as parseGhosttyColor, V as parseGhosttyTheme, Oe as pasteFromClipboard, Xe as pickFontIndexForText, se as positionToCell, O as pushRect, u as pushRectBox, c as pushRectSnapped, N as resetFontEntry, F as selectionForRow, C as sendPtyInput, Re as sendPtyResize, v as setPreedit, pe as startComposition, Ae as startSelection, t as syncImeSelection, Q as tryFetchFontBuffer, $ as tryLocalFontBuffer, de as updateComposition, G as updateGridState, m as updateImePosition, Ie as updateSelection };
