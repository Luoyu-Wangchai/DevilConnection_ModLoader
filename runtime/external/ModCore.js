'use strict';
// 特性①：依赖/冲突五大检测。ModLoader.js（启动 gate）与 Manager.js（面板徽章）共用。
// 语义（本加载器：更早加载=优先级更高=序号更小=列表更靠上）：
//   requires          硬·前置：目标须 安装+启用+版本达标+排在本模组之前，否则 block
//   optionalRequires  软·前置：目标若已安装则须排在之前；未安装忽略
//   requiresAfter     硬·后置：目标须 安装+启用+排在本模组之后
//   optionalLoadAfter 软·后置：目标若已安装则须排在之后
//   conflicts         硬·冲突：不可与目标同时启用（对称，双方都记）
// mod: { id, canonical, disabled, version, minLoaderVersion, deps }
//   deps: { requires, optionalRequires, requiresAfter, optionalLoadAfter, conflicts }
//   条目可为字符串 "id" 或对象 { id, minVersion, reason }

function toEntry(d) {
	if (typeof d === 'string') return { id: d };
	if (d && typeof d === 'object' && typeof d.id === 'string') return d;
	return null;
}
function entries(deps, key) {
	const a = deps && deps[key];
	return Array.isArray(a) ? a.map(toEntry).filter(Boolean) : [];
}

// mods：按加载顺序排列的数组；loaderVersion：数字或 null
// 返回 { diagnostics: { [canonical]: { status:'ok'|'blocked', problems:[], index } } }
function resolveMods(mods, loaderVersion) {
	const list = mods.map((m, i) => Object.assign({}, m, { index: i }));
	const enabled = list.filter(m => !m.disabled);
	const byId = new Map();
	for (const m of enabled) if (m.id) byId.set(m.id, m);

	// 冲突（对称）：A 声明与 B 冲突且都启用 → 双方各记
	const conflictWith = new Map();
	const add = (a, b, reason) => {
		if (!conflictWith.has(a)) conflictWith.set(a, new Map());
		if (!conflictWith.get(a).has(b)) conflictWith.get(a).set(b, reason || null);
	};
	for (const m of enabled) for (const c of entries(m.deps, 'conflicts')) {
		if (byId.has(c.id)) { add(m.id, c.id, c.reason); add(c.id, m.id, c.reason); }
	}

	const diagnostics = {};
	for (const m of list) {
		const problems = [];
		if (!m.disabled) {
			const deps = m.deps || {};
			for (const d of entries(deps, 'requires')) {
				const t = byId.get(d.id);
				if (!t) { problems.push({ type: 'missingRequired', target: d.id, need: d.minVersion || null }); continue; }
				if (d.minVersion != null && (t.version == null || t.version < d.minVersion)) problems.push({ type: 'depVersionLow', target: d.id, have: t.version, need: d.minVersion });
				if (t.index >= m.index) problems.push({ type: 'orderViolation', target: d.id, expected: 'before', hard: true });
			}
			for (const d of entries(deps, 'requiresAfter')) {
				const t = byId.get(d.id);
				if (!t) { problems.push({ type: 'missingRequired', target: d.id, after: true }); continue; }
				if (t.index <= m.index) problems.push({ type: 'orderViolation', target: d.id, expected: 'after', hard: true });
			}
			for (const d of entries(deps, 'optionalRequires')) {
				const t = byId.get(d.id);
				if (t && t.index >= m.index) problems.push({ type: 'orderViolation', target: d.id, expected: 'before' });
			}
			for (const d of entries(deps, 'optionalLoadAfter')) {
				const t = byId.get(d.id);
				if (t && t.index <= m.index) problems.push({ type: 'orderViolation', target: d.id, expected: 'after' });
			}
			if (conflictWith.has(m.id)) for (const [cid, reason] of conflictWith.get(m.id)) problems.push({ type: 'conflict', target: cid, reason });
			if (m.minLoaderVersion != null && loaderVersion != null && loaderVersion < m.minLoaderVersion) problems.push({ type: 'needLoaderUpdate', need: m.minLoaderVersion });
		}
		const blocked = !m.disabled && problems.some(p =>
			p.type === 'missingRequired' || p.type === 'depVersionLow' || p.type === 'conflict' || p.type === 'needLoaderUpdate' || (p.type === 'orderViolation' && p.hard));
		diagnostics[m.canonical] = { status: blocked ? 'blocked' : 'ok', problems, index: m.index };
	}
	return { diagnostics };
}

// 拓扑排序建议顺序（只排启用项，返回 canonical 数组）；有环返回 null
function suggestOrder(mods) {
	const enabled = mods.filter(m => !m.disabled && m.id);
	const idToCanon = new Map(enabled.map(m => [m.id, m.canonical]));
	const ids = enabled.map(m => m.id);
	const idSet = new Set(ids);
	const edges = new Map(ids.map(id => [id, new Set()]));
	const indeg = new Map(ids.map(id => [id, 0]));
	const addEdge = (a, b) => { if (idSet.has(a) && idSet.has(b) && a !== b && !edges.get(a).has(b)) { edges.get(a).add(b); indeg.set(b, indeg.get(b) + 1); } };
	for (const m of enabled) {
		const deps = m.deps || {};
		for (const d of entries(deps, 'requires').concat(entries(deps, 'optionalRequires'))) addEdge(d.id, m.id);
		for (const d of entries(deps, 'requiresAfter').concat(entries(deps, 'optionalLoadAfter'))) addEdge(m.id, d.id);
	}
	const orig = new Map(ids.map((id, i) => [id, i]));
	const byOrig = (a, b) => orig.get(a) - orig.get(b);
	let avail = ids.filter(id => indeg.get(id) === 0).sort(byOrig);
	const out = [];
	while (avail.length) {
		const id = avail.shift();
		out.push(idToCanon.get(id));
		for (const nb of edges.get(id)) { indeg.set(nb, indeg.get(nb) - 1); if (indeg.get(nb) === 0) avail.push(nb); }
		avail.sort(byOrig);
	}
	if (out.length !== ids.length) return null;
	return out;
}

// 从磁盘 asar 读内部文件（ofs = original-fs）；失败返回 null
function readAsarInner(ofs, asarPath, innerPath) {
	let fd = null;
	try {
		fd = ofs.openSync(asarPath, 'r');
		const readAt = (off, len) => { const b = Buffer.alloc(len); ofs.readSync(fd, b, 0, len, off); return b; };
		const first8 = readAt(0, 8);
		const headerSize = first8.readUInt32LE(4);
		const headerBuf = readAt(8, headerSize);
		const strLen = headerBuf.readUInt32LE(4);
		const header = JSON.parse(headerBuf.slice(8, 8 + strLen).toString('utf8'));
		let node = header;
		for (const part of String(innerPath).split('/').filter(Boolean)) {
			if (!node.files || !node.files[part]) return null;
			node = node.files[part];
		}
		if (node.files || node.offset === undefined) return null;
		return readAt(8 + headerSize + Number(node.offset), node.size);
	} catch (e) { return null; } finally { if (fd != null) try { ofs.closeSync(fd); } catch (e) {} }
}

// 从解析后的 mods.json 提取 resolve 所需字段（id / version / minLoaderVersion / deps）
function metaForResolve(j) {
	const out = {};
	if (!j || typeof j !== 'object') return out;
	if (typeof j.id === 'string' && /^[a-z0-9_-]+$/i.test(j.id.trim())) out.id = j.id.trim();
	if (typeof j.version === 'number' && isFinite(j.version)) out.version = j.version;
	if (typeof j.minLoaderVersion === 'number' && isFinite(j.minLoaderVersion)) out.minLoaderVersion = j.minLoaderVersion;
	if (j.dependencies && typeof j.dependencies === 'object' && !Array.isArray(j.dependencies)) out.deps = j.dependencies;
	return out;
}

// ---- 加载器版本语义 ----
// 版本串形态：[B]RV1.2.7 / 1.2.7.1 / 1.2.8-3CB3895E54
//   数字段任意长度，第一位优先级最高，逐位比较，缺位补 0
//   "-" 后为构建时间戳（YYMMDDHHmmss 的 hex），数字段全等时比时间戳，无后缀视为 0
//   首字符 B（如 BRV1.2.8）= Beta 测试版；Beta 与否不参与大小比较，通道过滤在 Manager 的 resolveUpdateTarget 做
function parseVerX(s) {
	const str = String(s == null ? '' : s).trim();
	const beta = /^b/i.test(str);
	const nm = str.match(/(\d+(?:\.\d+)*)/);
	const nums = nm ? nm[1].split('.').map(n => parseInt(n, 10) || 0) : null;
	let ts = 0;
	const tm = str.match(/-([0-9a-fA-F]+)\s*$/);
	if (tm) { const v = parseInt(tm[1], 16); if (isFinite(v)) ts = v; }
	return { nums, ts, beta };
}

function cmpVerX(a, b) {
	const pa = (a && typeof a === 'object' && 'nums' in a) ? a : parseVerX(a);
	const pb = (b && typeof b === 'object' && 'nums' in b) ? b : parseVerX(b);
	if (!pa.nums || !pb.nums) return 0;
	const len = Math.max(pa.nums.length, pb.nums.length);
	for (let i = 0; i < len; i++) {
		const x = pa.nums[i] || 0, y = pb.nums[i] || 0;
		if (x !== y) return x < y ? -1 : 1;
	}
	if (pa.ts !== pb.ts) return pa.ts < pb.ts ? -1 : 1;
	return 0;
}

// 模组显示名/身份基名：统一去掉数字优先级前缀（NNN_）与 .asar / .asar.disable 后缀。
// 加载器各处（列表显示名、config 绑定、依赖 id、工坊匹配、steamBypass 检测）都用它，
// 避免同一逻辑的正则在多个文件各写一份、位数限制不一致而产生模组身份分歧。
function bareName(name) {
	return String(name == null ? '' : name).replace(/\.asar(\.disable)?$/i, '').replace(/^\d+_/, '');
}

module.exports = { resolveMods, suggestOrder, entries, readAsarInner, metaForResolve, parseVerX, cmpVerX, bareName };
