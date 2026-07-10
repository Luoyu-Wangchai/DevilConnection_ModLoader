'use strict';
let fs;
try { fs = require('original-fs'); } catch (e) { fs = require('fs'); }
const path = require('path');

let D = null;
let AdmZip = null;
let ModCore = null;
try { ModCore = require('./ModCore.js'); } catch (e) {}

const GAME_BODY = 'app.bak.asar';
const DISABLE_EXT = '.disable';
const MOD_META_FILE = 'mods.json';

// 版本号单一真源 = resources/version.json（安装器部署）。RV/BRV 只是显示前缀，真正版本号是里面的 version(如 1.2.8 / 1.2.8-3CB3895E54)。
// beta: true 表示当前装的是 Beta 测试版（显示 BRV 前缀，更新通道见 checkForUpdate）。
const DEFAULT_REPO = 'Luoyu-Wangchai/DevilConnection_ModLoader';
function readVersionInfo() {
	try {
		const p = path.join(D.resourcesPath, 'version.json');
		if (fs.existsSync(p)) {
			const j = JSON.parse(fs.readFileSync(p, 'utf8'));
			return {
				version: String(j.version || '0.0.0'),
				beta: !!j.beta,
				repo: String(j.repo || DEFAULT_REPO),
				name: String(j.name || 'DevilConnection ModLoader')
			};
		}
	} catch (e) {}
	return { version: '0.0.0', beta: false, repo: DEFAULT_REPO, name: 'DevilConnection ModLoader' };
}
function displayVersion(v) { return (v.beta ? 'BRV' : 'RV') + v.version; }

function pluginsDir() { return path.join(D.resourcesPath, 'plugins'); }
function gameRoot() { return path.resolve(D.resourcesPath, '..'); }
function storageDir() { return path.join(gameRoot(), '_storage'); }
function backupsDir() { return path.join(gameRoot(), 'backups'); }
function backupMetaPath() { return path.join(backupsDir(), '.meta.json'); }

function ok(data) { return { ok: true, data: data === undefined ? null : data }; }
function fail(message, reason) { return { ok: false, reason: reason || 'error', message: String(message || '未知错误') }; }
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function dirSize(p) {
	let total = 0;
	try {
		for (const name of fs.readdirSync(p)) {
			const full = path.join(p, name);
			const st = fs.statSync(full);
			total += st.isDirectory() ? dirSize(full) : st.size;
		}
	} catch (e) {}
	return total;
}
function entrySize(full, isDir) {
	try { return isDir ? dirSize(full) : fs.statSync(full).size; } catch (e) { return 0; }
}
function sizeText(bytes) { return (Number(bytes || 0) / 1024 / 1024).toFixed(2) + ' MB'; }

function modsConfigPath() { return path.join(pluginsDir(), 'mods.config.json'); }

// §15：mods.config.json 精简为只剩 order（启停=.disable 后缀、显示名=mods.json.name）。旧字段迁移由 ModLoader.init 一次性做。
function readModsConfig() {
	const cfg = { order: [] };
	try {
		if (fs.existsSync(modsConfigPath())) {
			const j = JSON.parse(fs.readFileSync(modsConfigPath(), 'utf8'));
			cfg.order = Array.isArray(j.order) ? j.order : [];
		}
	} catch (e) {}
	return cfg;
}
function writeModsConfig(cfg) {
	ensureDir(pluginsDir());
	fs.writeFileSync(modsConfigPath(), JSON.stringify({ order: cfg.order || [] }, null, 2), 'utf8');
}
function sanitizeName(name) {
	return String(name).replace(/[\\/:*?"<>|]/g, '').replace(/^\.+/, '').trim() || 'mod';
}
function deriveDisplay(name) {
	let s = name.replace(/\.asar$/i, '');
	const m = s.match(/^(\d{1,4})_(.*)$/);
	if (m) s = m[2];
	return s || name;
}


function scanDiskMods() {
	const dir = pluginsDir();
	ensureDir(dir);
	let names;
	try { names = fs.readdirSync(dir); } catch (e) { return []; }
	const reserved = new Set(['app.bak.asar', 'mods.config.json', '.meta.json', 'mod_loader.log', 'config', '.update']);
	const byCanonical = new Map();
	for (const name of names) {
		if (name.startsWith('.')) continue;
		const lower = name.toLowerCase();
		let canonical, disabled;
		if (lower.endsWith('.asar')) { canonical = name; disabled = false; }
		else if (lower.endsWith('.asar' + DISABLE_EXT)) { canonical = name.slice(0, -DISABLE_EXT.length); disabled = true; }
		else continue;
		if (reserved.has(canonical.toLowerCase())) continue;
		const full = path.join(dir, name);
		let st; try { st = fs.statSync(full); } catch (e) { continue; }
		if (!st.isFile()) continue;
		const prev = byCanonical.get(canonical.toLowerCase());
		if (prev && !prev.disabled) continue;
		byCanonical.set(canonical.toLowerCase(), { disk: name, canonical, disabled, size: st.size });
	}
	return [...byCanonical.values()];
}

function normalizeModMeta(raw) {
	try {
		const j = JSON.parse(raw.toString('utf8'));
		if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
		return {
			name: (typeof j.name === 'string' && j.name.trim()) ? j.name.trim() : null,
			description: (typeof j.description === 'string' && j.description.trim()) ? j.description.trim() : null,
			version: (typeof j.version === 'number' && isFinite(j.version)) ? j.version : null,
			displayVersion: (j.displayVersion !== undefined && j.displayVersion !== null && String(j.displayVersion).trim())
				? String(j.displayVersion).trim() : null,
				update: (j.update && typeof j.update === 'object' && !Array.isArray(j.update)) ? j.update : null,
				id: (typeof j.id === 'string' && /^[a-z0-9_-]+$/i.test(j.id.trim())) ? j.id.trim() : null,
				minLoaderVersion: (typeof j.minLoaderVersion === 'number' && isFinite(j.minLoaderVersion)) ? j.minLoaderVersion : null,
				dependencies: (j.dependencies && typeof j.dependencies === 'object' && !Array.isArray(j.dependencies)) ? j.dependencies : null
};
	} catch (e) { return null; }
}
function readModMeta(diskName) {
	const raw = readAsarInner(path.join(pluginsDir(), diskName), MOD_META_FILE);
	return raw ? normalizeModMeta(raw) : null;
}
function versionText(meta) {
	if (!meta) return null;
	if (meta.displayVersion) return meta.displayVersion;
	if (meta.version !== null) return 'v' + meta.version;
	return null;
}

const MOD_SCHEMA_FILE = 'config.schema.json';

function modConfigDir() { return path.join(pluginsDir(), 'config'); }
function modConfigPath(bareName) { return path.join(modConfigDir(), bareName + '.json'); }

function asarInnerRead(readAt, innerPath) {
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
}

function readAsarInner(asarPath, innerPath) {
	let fd = null;
	try {
		fd = fs.openSync(asarPath, 'r');
		return asarInnerRead((pos, len) => {
			const buf = Buffer.alloc(len);
			fs.readSync(fd, buf, 0, len, pos);
			return buf;
		}, innerPath);
	} catch (e) { return null; }
	finally { if (fd !== null) { try { fs.closeSync(fd); } catch (e) {} } }
}

function readAsarInnerFromBuffer(asarBuf, innerPath) {
	try {
		return asarInnerRead((pos, len) => asarBuf.slice(pos, pos + len), innerPath);
	} catch (e) { return null; }
}

function isValidAsarBuffer(asarBuf) {
	try {
		if (!asarBuf || asarBuf.length < 16) return false;
		const headerSize = asarBuf.readUInt32LE(4);
		if (headerSize <= 8 || headerSize > asarBuf.length) return false;
		const strLen = asarBuf.readUInt32LE(12);
		if (strLen <= 0 || strLen > headerSize) return false;
		const header = JSON.parse(asarBuf.slice(16, 16 + strLen).toString('utf8'));
		return !!(header && header.files);
	} catch (e) { return false; }
}

function readModSchema(diskName) {
	try {
		const raw = readAsarInner(path.join(pluginsDir(), diskName), MOD_SCHEMA_FILE);
		if (!raw) return null;
		const schema = JSON.parse(raw.toString('utf8'));
		if (!schema || !Array.isArray(schema.fields)) return null;
		return schema;
	} catch (e) { return null; }
}

function readModConfigValues(bareName) {
	try {
		const p = modConfigPath(bareName);
		if (!fs.existsSync(p)) return {};
		const v = JSON.parse(fs.readFileSync(p, 'utf8'));
		return (v && typeof v === 'object') ? v : {};
	} catch (e) { return {}; }
}

function getModConfig(idx) {
	try {
		const mod = effectiveMods()[idx];
		if (!mod) return fail('模组不存在', 'notfound');
		const schema = readModSchema(mod.diskName);
		if (!schema) return fail('该模组没有提供配置声明', 'noschema');
		const stored = readModConfigValues(mod.bareName);
		const values = {};
		for (const f of schema.fields) {
			if (!f || !f.key) continue;
			values[f.key] = (stored[f.key] !== undefined) ? stored[f.key]
				: (f.default !== undefined ? f.default : '');
		}
		return ok({ schema, values, bareName: mod.bareName });
	} catch (e) { return fail(e.message); }
}

function saveModConfig(idx, values) {
	try {
		const mod = effectiveMods()[idx];
		if (!mod) return fail('模组不存在', 'notfound');
		if (!values || typeof values !== 'object') return fail('配置内容无效');
		ensureDir(modConfigDir());
		fs.writeFileSync(modConfigPath(mod.bareName), JSON.stringify(values, null, 2), 'utf8');
		return ok({ path: modConfigPath(mod.bareName) });
	} catch (e) { return fail(e.message); }
}

function effectiveMods() {
	const cfg = readModsConfig();
	const entries = scanDiskMods();
	const byName = new Map(entries.map(m => [m.canonical, m]));
	const ordered = [];
	for (const n of (cfg.order || [])) if (byName.has(n) && !ordered.includes(n)) ordered.push(n);
	[...byName.keys()].filter(n => !ordered.includes(n))
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
		.forEach(n => ordered.push(n));
	const metaByName = new Map();
	const items = ordered.map(name => {
		const m = byName.get(name);
		const meta = readModMeta(m.disk);
		metaByName.set(name, meta);
		const bare = deriveDisplay(name);
		return {
			name,
			diskName: m.disk,
			displayName: (meta && meta.name) || bare,
			rawNameWithoutPrefix: bare,
			bareName: bare,
			modId: (meta && meta.id) || bare,
			hasMeta: !!meta,
			description: meta ? (meta.description || '') : null,
			versionText: versionText(meta),
			versionNum: meta ? meta.version : null,
			size: m.size,
			disabled: m.disabled,
			hasConfig: readModSchema(m.disk) !== null,
			hasUpdateChannel: !!(meta && meta.update && meta.update.source === 'github' && meta.update.repo),
			diagnostics: { status: 'ok', problems: [] }
		};
	});
	// 特性①：依赖/冲突诊断（loaderVersion 传 null，minLoaderVersion 门控属特性③，暂不触发）
	if (ModCore && items.length) {
		try {
			const input = items.map(it => {
				const meta = metaByName.get(it.name);
				return { id: it.modId, canonical: it.name, disabled: it.disabled, version: it.versionNum, minLoaderVersion: meta && meta.minLoaderVersion, deps: meta && meta.dependencies };
			});
			const res = ModCore.resolveMods(input, null);
			for (const it of items) it.diagnostics = res.diagnostics[it.name] || { status: 'ok', problems: [] };
		} catch (e) {}
	}
	return items;
}

// 游戏是否运行中（文件被锁）—— 主进程经 setup 传入 isGameRunning
function isGameRunning() {
	try { return !!(D.isGameRunning && D.isGameRunning()); } catch (e) { return false; }
}

function getModsData() {
	try {
		const body = path.join(pluginsDir(), GAME_BODY);
		const asarItem = fs.existsSync(body) ? { size: entrySize(body, false) } : null;
		return ok({ asarItem, mods: effectiveMods(), gameRunning: isGameRunning() });
	} catch (e) { return fail(e.message); }
}

function toggleModDisabled(idx) {
	try {
		const mods = effectiveMods();
		const mod = mods[idx];
		if (!mod) return fail('模组不存在', 'notfound');
		if (isGameRunning()) return fail('游戏运行中无法启用/禁用模组，请先关闭游戏', 'busy');
		const full = path.join(pluginsDir(), mod.diskName);
		const target = mod.diskName.toLowerCase().endsWith(DISABLE_EXT)
			? full.slice(0, -DISABLE_EXT.length)
			: full + DISABLE_EXT;
		try {
			fs.renameSync(full, target);
			return ok({ restartRequired: true });
		} catch (e) {
			return fail('文件被占用，请关闭游戏后再操作', 'busy');
		}
	} catch (e) { return fail(e.message); }
}

function deleteMod(idx) {
	try {
		const mods = effectiveMods();
		const mod = mods[idx];
		if (!mod) return fail('模组不存在', 'notfound');
		if (isGameRunning()) return fail('游戏运行中无法删除模组，请先关闭游戏', 'busy');
		const full = path.join(pluginsDir(), mod.diskName);
		try {
			fs.rmSync(full, { force: true });
			if (fs.existsSync(full)) return fail('文件被占用，请关闭游戏后再操作', 'busy');
		} catch (e) {
			return fail('文件被占用，请关闭游戏后再操作', 'busy');
		}
		const cfg = readModsConfig();
		cfg.order = (cfg.order || []).filter(n => n !== mod.name);
		writeModsConfig(cfg);
		return ok();
	} catch (e) { return fail(e.message); }
}

function moveModTo(oldIndex, newIndex) {
	try {
		const mods = effectiveMods();
		if (oldIndex < 0 || oldIndex >= mods.length) return fail('索引越界');
		const arr = mods.map(m => m.name);
		const [moved] = arr.splice(oldIndex, 1);
		arr.splice(Math.max(0, Math.min(newIndex, arr.length)), 0, moved);
		const cfg = readModsConfig();
		cfg.order = arr;
		writeModsConfig(cfg);
		return ok({ restartRequired: true });
	} catch (e) { return fail(e.message); }
}

// 特性①：一键修复顺序（对 before/after 约束拓扑排序，只重写 order；有环报错）
function autoFixOrder() {
	try {
		if (!ModCore) return fail('依赖解析模块不可用');
		const mods = effectiveMods();
		const input = mods.map(m => { const meta = readModMeta(m.diskName); return { id: m.modId, canonical: m.name, disabled: m.disabled, deps: meta && meta.dependencies }; });
		const enabledOrder = ModCore.suggestOrder(input);
		if (!enabledOrder) return fail('依赖成环，无法自动排序', 'cycle');
		const disabled = mods.filter(m => m.disabled).map(m => m.name);
		const cfg = readModsConfig();
		cfg.order = enabledOrder.concat(disabled);
		writeModsConfig(cfg);
		return ok({ restartRequired: true, order: cfg.order });
	} catch (e) { return fail(e.message); }
}

const pendingImports = new Map();
let importSeq = 0;
function newImportToken() { return 'imp_' + (++importSeq) + '_' + Math.random().toString(36).slice(2, 8); }

function stageAsarImport(fileName, buf) {
	const base = sanitizeName(path.basename(String(fileName || 'mod')).replace(/\.asar$/i, ''));
	const canonical = base + '.asar';
	if (!isValidAsarBuffer(buf)) {
		return { status: 'invalid', file: canonical, message: '不是有效的 asar 模组文件' };
	}
	const newMetaRaw = readAsarInnerFromBuffer(buf, MOD_META_FILE);
	const newMeta = newMetaRaw ? normalizeModMeta(newMetaRaw) : null;
	const bare = deriveDisplay(canonical).toLowerCase();
	const existing = scanDiskMods().find(m => deriveDisplay(m.canonical).toLowerCase() === bare);

	if (!existing) {
		fs.writeFileSync(path.join(pluginsDir(), canonical), buf);
		const cfg = readModsConfig();
		if (!cfg.order.includes(canonical)) cfg.order.push(canonical);
		writeModsConfig(cfg);
		return {
			status: 'added', file: canonical,
			displayName: (newMeta && newMeta.name) || deriveDisplay(canonical),
			newVersionText: versionText(newMeta)
		};
	}

	const oldMeta = readModMeta(existing.disk);
	const oldVer = oldMeta ? oldMeta.version : null;
	const newVer = newMeta ? newMeta.version : null;
	let kind = 'unknown';
	if (oldVer !== null && newVer !== null) {
		kind = newVer > oldVer ? 'upgrade' : (newVer < oldVer ? 'downgrade' : 'same');
	}
	const token = newImportToken();
	pendingImports.set(token, { targetDisk: existing.disk, bytes: buf });
	return {
		status: 'conflict', token, kind,
		file: existing.canonical,
		displayName: (oldMeta && oldMeta.name) || deriveDisplay(existing.canonical),
		oldVersionText: versionText(oldMeta),
		newVersionText: versionText(newMeta),
		disabled: existing.disabled
	};
}

function confirmPendingImport(token) {
	try {
		const p = pendingImports.get(token);
		if (!p) return fail('导入会话已失效，请重新导入', 'expired');
		pendingImports.delete(token);
		try {
			fs.writeFileSync(path.join(pluginsDir(), p.targetDisk), p.bytes);
		} catch (e) {
			return fail('写入失败，模组文件可能正被运行中的游戏占用，请关闭游戏后重试', 'busy');
		}
		return ok({ file: p.targetDisk });
	} catch (e) { return fail(e.message); }
}

function cancelPendingImport(token) {
	pendingImports.delete(token);
	return ok();
}

function importArchiveEntries(entries) {
	const results = [];
	const config = { written: 0, skipped: 0 };
	let matched = false;
	for (const entry of entries) {
		const parts = String(entry.name).replace(/\\/g, '/').split('/').filter(Boolean);
		if (!parts.length || parts.some(p => p === '..')) continue;
		if (parts.length === 1 && parts[0].toLowerCase().endsWith('.asar')) {
			matched = true;
			results.push(stageAsarImport(parts[0], entry.read()));
		} else if (parts.length >= 2 && parts[0].toLowerCase() === 'config') {
			matched = true;
			const target = path.join(modConfigDir(), ...parts.slice(1));
			if (fs.existsSync(target)) { config.skipped++; continue; }
			ensureDir(path.dirname(target));
			fs.writeFileSync(target, entry.read());
			config.written++;
		}
	}
	if (!matched) throw new Error('压缩包根目录未找到 .asar 模组或 config 文件夹');
	return { results, config };
}

function importZipBuffer(buf) {
	const zip = new AdmZip(buf);
	const entries = zip.getEntries()
		.filter(e => !e.isDirectory)
		.map(e => ({ name: e.entryName, read: () => e.getData() }));
	return importArchiveEntries(entries);
}

async function importRarBuffer(buf) {
	const { createExtractorFromData } = require('node-unrar-js');
	const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
	const extractor = await createExtractorFromData({ data });
	const extracted = extractor.extract();
	const entries = [];
	for (const file of extracted.files) {
		if (file.fileHeader.flags.directory || !file.extraction) continue;
		entries.push({ name: file.fileHeader.name, read: () => Buffer.from(file.extraction) });
	}
	return importArchiveEntries(entries);
}

async function importModFromBuffer(fileName, bytes) {
	try {
		ensureDir(pluginsDir());
		const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer ? bytes.buffer : bytes);
		const lower = String(fileName || '').toLowerCase();
		if (lower.endsWith('.asar')) {
			return ok({ results: [stageAsarImport(fileName, buf)], config: { written: 0, skipped: 0 } });
		}
		if (lower.endsWith('.zip')) return ok(importZipBuffer(buf));
		if (lower.endsWith('.rar')) return ok(await importRarBuffer(buf));
		return fail('不支持的文件类型，仅支持 .asar / .zip / .rar', 'unsupported');
	} catch (e) { return fail(e.message); }
}

function readMeta() {
	try {
		if (fs.existsSync(backupMetaPath())) return JSON.parse(fs.readFileSync(backupMetaPath(), 'utf8'));
	} catch (e) {}
	return {};
}
function writeMeta(meta) {
	ensureDir(backupsDir());
	fs.writeFileSync(backupMetaPath(), JSON.stringify(meta, null, 2), 'utf8');
}
function storageHasData() {
	try { return fs.existsSync(storageDir()) && fs.readdirSync(storageDir()).length > 0; }
	catch (e) { return false; }
}
function newBackupId() {
	return 'bak_' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '_' + Math.random().toString(36).slice(2, 6);
}
function zipStorageTo(zipPath) {
	const zip = new AdmZip();
	zip.addLocalFolder(storageDir());
	zip.writeZip(zipPath);
}

function doBackup({ customName, auto }) {
	if (!storageHasData()) return { status: 'skipped' };
	ensureDir(backupsDir());
	const id = newBackupId();
	const zipPath = path.join(backupsDir(), id + '.zip');
	zipStorageTo(zipPath);
	const meta = readMeta();
	meta[id] = {
		id,
		customName: customName || '',
		mtimeMs: Date.now(),
		locked: false,
		auto: !!auto,
		size: fs.statSync(zipPath).size
	};
	writeMeta(meta);
	return { status: 'ok', id };
}

function getBackupsData() {
	try {
		ensureDir(backupsDir());
		const meta = readMeta();
		const out = [];
		for (const name of fs.readdirSync(backupsDir())) {
			if (!name.toLowerCase().endsWith('.zip')) continue;
			const id = name.replace(/\.zip$/i, '');
			const full = path.join(backupsDir(), name);
			let st; try { st = fs.statSync(full); } catch (e) { continue; }
			const m = meta[id] || {};
			out.push({
				name: id,
				customName: m.customName || '',
				isLocked: !!m.locked,
				auto: !!m.auto,
				mtimeMs: m.mtimeMs || st.mtimeMs,
				timeText: new Date(m.mtimeMs || st.mtimeMs).toLocaleString(),
				sizeText: sizeText(st.size)
			});
		}
		out.sort((a, b) => b.mtimeMs - a.mtimeMs);
		return ok(out);
	} catch (e) { return fail(e.message); }
}

function backupNow(taskId, finalName) {
	try {
		const r = doBackup({ customName: finalName, auto: false });
		if (r.status === 'skipped') return fail('当前没有存档可备份', 'empty');
		return ok(r);
	} catch (e) { return fail(e.message); }
}

function autoBackup(settings) {
	try {
		if (!settings || !settings.auto_backup_enabled) return ok({ status: 'disabled' });
		if (!storageHasData()) return ok({ status: 'skipped' });
		const r = doBackup({ customName: '', auto: true });
		pruneAutoBackups(settings);
		return ok(r);
	} catch (e) { return fail(e.message); }
}

function pruneAutoBackups(settings) {
	const meta = readMeta();
	const keepDays = Number(settings.auto_backup_keep_days) || 7;
	const maxCount = Number(settings.auto_backup_max_count) || 15;
	const cutoff = Date.now() - keepDays * 86400000;
	let autos = Object.values(meta).filter(m => m.auto && !m.locked).sort((a, b) => b.mtimeMs - a.mtimeMs);
	const toDelete = new Set();
	autos.forEach((m, i) => {
		if (i >= maxCount || m.mtimeMs < cutoff) toDelete.add(m.id);
	});
	for (const id of toDelete) {
		try { fs.rmSync(path.join(backupsDir(), id + '.zip'), { force: true }); } catch (e) {}
		delete meta[id];
	}
	writeMeta(meta);
}

function restoreBackup(name) {
	try {
		const zipPath = path.join(backupsDir(), name + '.zip');
		if (!fs.existsSync(zipPath)) return fail('备份不存在', 'notfound');
		ensureDir(storageDir());
		for (const f of fs.readdirSync(storageDir())) {
			try { fs.rmSync(path.join(storageDir(), f), { recursive: true, force: true }); } catch (e) {}
		}
		new AdmZip(zipPath).extractAllTo(storageDir(), true);
		return ok();
	} catch (e) { return fail(e.message); }
}

function renameBackup(name, nextLabel) {
	try {
		const meta = readMeta();
		if (!meta[name]) meta[name] = { id: name, mtimeMs: Date.now() };
		meta[name].customName = String(nextLabel || '').trim();
		writeMeta(meta);
		return ok();
	} catch (e) { return fail(e.message); }
}

function toggleBackupLock(name) {
	try {
		const meta = readMeta();
		if (!meta[name]) meta[name] = { id: name, mtimeMs: Date.now() };
		meta[name].locked = !meta[name].locked;
		writeMeta(meta);
		return ok({ locked: meta[name].locked });
	} catch (e) { return fail(e.message); }
}

function deleteBackup(name) {
	try {
		const meta = readMeta();
		if (meta[name] && meta[name].locked) return fail('备份已锁定，无法删除', 'locked');
		try { fs.rmSync(path.join(backupsDir(), name + '.zip'), { force: true }); } catch (e) {}
		delete meta[name];
		writeMeta(meta);
		return ok();
	} catch (e) { return fail(e.message); }
}

async function exportBackupFile(name) {
	try {
		const zipPath = path.join(backupsDir(), name + '.zip');
		if (!fs.existsSync(zipPath)) return fail('备份不存在', 'notfound');
		const res = await D.dialog.showSaveDialog(D.getDialogParent ? D.getDialogParent() : null, {
			title: '导出备份',
			defaultPath: name + '.zip',
			filters: [{ name: 'Zip 备份', extensions: ['zip'] }]
		});
		if (res.canceled || !res.filePath) return fail('已取消', 'cancel');
		fs.copyFileSync(zipPath, res.filePath);
		return ok({ path: res.filePath });
	} catch (e) { return fail(e.message); }
}

async function exportCurrentSave() {
	try {
		if (!storageHasData()) return fail('当前没有存档', 'empty');
		const res = await D.dialog.showSaveDialog(D.getDialogParent ? D.getDialogParent() : null, {
			title: '导出当前存档',
			defaultPath: 'DevilConnection_存档_' + new Date().toISOString().slice(0, 10) + '.zip',
			filters: [{ name: 'Zip 备份', extensions: ['zip'] }]
		});
		if (res.canceled || !res.filePath) return fail('已取消', 'cancel');
		zipStorageTo(res.filePath);
		return ok({ path: res.filePath });
	} catch (e) { return fail(e.message); }
}

function importBackupFromBuffer(fileName, bytes) {
	try {
		ensureDir(backupsDir());
		const id = newBackupId();
		const zipPath = path.join(backupsDir(), id + '.zip');
		fs.writeFileSync(zipPath, Buffer.from(bytes.buffer ? bytes.buffer : bytes));
		const meta = readMeta();
		meta[id] = {
			id,
			customName: '导入_' + String(fileName || '').replace(/\.zip$/i, ''),
			mtimeMs: Date.now(),
			locked: false,
			auto: false,
			size: fs.statSync(zipPath).size
		};
		writeMeta(meta);
		return ok({ id });
	} catch (e) { return fail(e.message); }
}

async function openModsFolder() {
	try {
		const dir = pluginsDir();
		ensureDir(dir);
		const { shell } = require('electron');
		const err = await shell.openPath(dir);
		if (err) return fail(err);
		return ok();
	} catch (e) { return fail(e.message); }
}

async function openExternal(url) {
	try {
		if (!/^https?:\/\//i.test(String(url || ''))) return fail('仅允许 http/https 链接');
		const { shell } = require('electron');
		await shell.openExternal(url);
		return ok();
	} catch (e) { return fail(e.message); }
}

// 面板信息(供渲染层读版本号/仓库, 全部来自 version.json 单一真源)
function getAppInfo() {
	const v = readVersionInfo();
	return ok({
		version: v.version,               // "1.2.8" / "1.2.8-3CB3895E54"
		beta: v.beta,
		displayVersion: displayVersion(v), // "RV1.2.8" / "BRV1.2.8-3CB3895E54"
		name: v.name,
		repo: v.repo,
		repoUrl: 'https://github.com/' + v.repo
	});
}

// 本地联调覆盖：resources/.update_override.json 存在时用其 releasesUrl 替代 GitHub API（测完必删）
function updateOverride() {
	try {
		const p = path.join(D.resourcesPath, '.update_override.json');
		if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
	} catch (e) {}
	return null;
}

// 拉 release 列表并整理成 pickUpdateTarget 的输入（含 Beta/prerelease；draft 匿名 API 拿不到无需过滤）
async function fetchReleases(repo, signal) {
	const o = updateOverride();
	const url = (o && o.releasesUrl) ? String(o.releasesUrl) : `https://api.github.com/repos/${repo}/releases?per_page=30`;
	const resp = await fetch(url, { headers: ghHeaders(), signal });
	if (resp.status === 404) return { status: 404, releases: [] };
	if (!resp.ok) return { status: resp.status, releases: null };
	const list = await resp.json();
	const releases = (Array.isArray(list) ? list : []).map(r => ({
		tag: String(r.tag_name || r.name || ''),
		url: r.html_url || ('https://github.com/' + repo + '/releases'),
		notes: r.body || '',
		publishedAt: r.published_at || '',
		assets: (r.assets || []).map(a => ({ name: String(a.name || ''), url: String(a.browser_download_url || ''), size: Number(a.size) || 0 }))
	}));
	return { status: 200, releases };
}

function updateAssetsOf(target) {
	const assets = (target && target.assets) || [];
	return {
		zip: assets.find(a => a.name === 'update.zip') || null,
		manifest: assets.find(a => a.name === 'update.json') || null
	};
}

// 去 GitHub release 检查有无新版(网络请求在主进程做)。betaEnabled = 面板「检测 Beta 测试版更新」开关
// 通道规则见 ModCore.pickUpdateTarget：Beta 关时若本地是 Beta 版，忽略版本号直接指向最新稳定版
async function checkForUpdate(betaEnabled) {
	if (!ModCore || !ModCore.pickUpdateTarget) return fail('版本模块缺失, 请重装加载器', 'nocore');
	const v = readVersionInfo();
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 12000);
	try {
		const { status, releases } = await fetchReleases(v.repo, ctrl.signal);
		if (status === 404) return ok({ hasUpdate: false, current: displayVersion(v), latest: null, note: '仓库暂无发布版本' });
		if (releases === null) return fail(`GitHub 返回 ${status}`, 'http');
		const picked = ModCore.pickUpdateTarget({ version: v.version, beta: v.beta }, releases, !!betaEnabled);
		if (!picked.hasUpdate || !picked.target) {
			const note = !releases.length ? '仓库暂无发布版本'
				: (!picked.poolSize ? '仓库暂无稳定版发布' : null);
			return ok({ hasUpdate: false, current: displayVersion(v), latest: null, note });
		}
		const t = picked.target;
		const ua = updateAssetsOf(t);
		return ok({
			hasUpdate: true,
			current: displayVersion(v),
			latest: t.tag,
			url: t.url,
			notes: t.notes,
			publishedAt: t.publishedAt,
			reason: picked.reason,                      // 'newer' | 'leaveBeta'
			canAutoUpdate: !!(ua.zip && ua.manifest)    // release 带 update.zip+update.json 才能一键更新
		});
	} catch (e) {
		return fail(e.name === 'AbortError' ? '检查更新超时, 请检查网络' : (e.message || '网络错误'), 'network');
	} finally {
		clearTimeout(timer);
	}
}

// 一键自动更新（外置档路线）：下载 update.zip → sha256 校验 → 覆盖 resources 下外置文件 → 自动重启
// 只覆盖普通文件，绝不碰 app.asar（运行中被锁）；壳需要更新的版本不发 update.zip，自动降级手动安装器
let updateAbort = null;
async function downloadAndApplyUpdate(sender, betaEnabled) {
	if (updateAbort) return fail('已有更新任务进行中', 'busy');
	if (!ModCore || !ModCore.pickUpdateTarget) return fail('版本模块缺失, 请重装加载器', 'nocore');
	if (!AdmZip) return fail('解压模块缺失', 'nozip');
	const send = (payload) => { try { if (sender && !sender.isDestroyed()) sender.send('mgr:updateProgress', payload); } catch (e) {} };
	const ctrl = new AbortController();
	updateAbort = ctrl;
	try {
		send({ phase: 'check', pct: 0, text: '正在获取版本信息...' });
		const v = readVersionInfo();
		const { status, releases } = await fetchReleases(v.repo, ctrl.signal);
		if (releases === null || !releases.length) return fail('获取版本信息失败 (HTTP ' + status + ')', 'http');
		const picked = ModCore.pickUpdateTarget({ version: v.version, beta: v.beta }, releases, !!betaEnabled);
		if (!picked.hasUpdate || !picked.target) return fail('没有可用的更新', 'noupdate');
		const t = picked.target;
		const ua = updateAssetsOf(t);
		if (!ua.zip || !ua.manifest) return fail('该版本未提供自动更新包', 'noAsset');

		const manifest = await (await fetch(ua.manifest.url, { headers: ghHeaders(), signal: ctrl.signal })).json();
		const wantSha = String((manifest && manifest.sha256) || '').toLowerCase();

		send({ phase: 'download', pct: 0, text: '正在下载更新包...' });
		const zresp = await fetch(ua.zip.url, { signal: ctrl.signal });
		if (!zresp.ok || !zresp.body) return fail('下载失败 (HTTP ' + zresp.status + ')', 'download');
		const total = Number(zresp.headers.get('content-length')) || ua.zip.size || 0;
		const reader = zresp.body.getReader();
		const chunks = [];
		let received = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(Buffer.from(value));
			received += value.length;
			send({ phase: 'download', pct: total ? Math.min(99, Math.round(received / total * 100)) : null, received, total, text: '正在下载更新包...' });
		}
		const buf = Buffer.concat(chunks);

		send({ phase: 'verify', pct: 99, text: '正在校验完整性...' });
		const got = require('crypto').createHash('sha256').update(buf).digest('hex');
		if (!wantSha || got !== wantSha) return fail('更新包校验失败 (sha256 不匹配)', 'sha256');

		send({ phase: 'apply', pct: 99, text: '正在应用更新...' });
		// AdmZip 内部是 electron 补丁版 fs，会拦截 .asar 路径——只用它读字节，落盘一律走本文件顶部的 original-fs
		const entries = new AdmZip(buf).getEntries().filter(e => !e.isDirectory);
		const files = [];
		for (const e of entries) {
			const rel = String(e.entryName || '').replace(/\\/g, '/').replace(/^\/+/, '');
			if (!rel || rel.split('/').some(seg => seg === '..' || seg === '')) continue;
			if (/\.asar$/i.test(rel)) continue;
			files.push({ rel, data: e.getData() });
		}
		if (!files.length) return fail('更新包为空或不含可应用文件', 'badzip');
		const backupRoot = path.join(D.resourcesPath, '.update_backup');
		try { fs.rmSync(backupRoot, { recursive: true, force: true }); } catch (e) {}
		const written = [];
		try {
			for (const f of files) {
				const dst = path.join(D.resourcesPath, f.rel);
				if (fs.existsSync(dst)) {
					const bak = path.join(backupRoot, f.rel);
					ensureDir(path.dirname(bak));
					fs.copyFileSync(dst, bak);
				}
				ensureDir(path.dirname(dst));
				fs.writeFileSync(dst, f.data);
				written.push(f.rel);
			}
		} catch (e) {
			for (const rel of written) {
				try {
					const bak = path.join(backupRoot, rel);
					if (fs.existsSync(bak)) fs.copyFileSync(bak, path.join(D.resourcesPath, rel));
				} catch (e2) {}
			}
			return fail('写入更新文件失败, 已回滚: ' + e.message, 'write');
		}

		send({ phase: 'done', pct: 100, text: '更新完成, 即将自动重启...' });
		setTimeout(() => {
			try {
				const { app } = require('electron');
				app.relaunch();
				app.quit();
			} catch (e) {}
		}, 1200);
		return ok({ applied: written.length, version: t.tag, restart: true });
	} catch (e) {
		if (e.name === 'AbortError') return fail('更新已取消', 'cancelled');
		return fail(e.message || '更新失败');
	} finally {
		updateAbort = null;
	}
}

function cancelUpdate() {
	try { if (updateAbort) updateAbort.abort(); } catch (e) {}
	return ok();
}

function ghHeaders() { return { 'User-Agent': 'DevilConnection-ModLoader', 'Accept': 'application/vnd.github+json' }; }

// ---- 模组更新渠道（mods.json.update）----
// 检测单模组远端版本 → status: noChannel/noRelease/unknown/outdated/current/ahead
async function checkModUpdate(idx) {
	try {
		const mods = effectiveMods();
		const mod = mods[idx];
		if (!mod) return fail('模组不存在', 'notfound');
		const meta = readModMeta(mod.diskName);
		const upd = meta && meta.update;
		if (!upd || upd.source !== 'github' || !upd.repo) return ok({ status: 'noChannel' });
		const localVer = (meta.version !== null && meta.version !== undefined) ? meta.version : null;
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 12000);
		try {
			const relResp = await fetch(`https://api.github.com/repos/${upd.repo}/releases/latest`, { headers: ghHeaders(), signal: ctrl.signal });
			if (relResp.status === 404) return ok({ status: 'noRelease' });
			if (!relResp.ok) return fail(`GitHub 返回 ${relResp.status}`, 'http');
			const rel = await relResp.json();
			const assets = rel.assets || [];
			let remoteVer = null, remoteDisplay = rel.tag_name || null;
			const manifestAsset = (upd.manifest && assets.find(a => a.name === upd.manifest)) || assets.find(a => /\.update\.json$/i.test(a.name));
			if (manifestAsset) {
				try {
					const m = await (await fetch(manifestAsset.browser_download_url, { headers: ghHeaders(), signal: ctrl.signal })).json();
					if (m && typeof m.version === 'number') remoteVer = m.version;
					if (m && m.displayVersion) remoteDisplay = String(m.displayVersion);
				} catch (e) {}
			}
			if (remoteVer === null || localVer === null) return ok({ status: 'unknown', remoteDisplay });
			const status = localVer < remoteVer ? 'outdated' : (localVer > remoteVer ? 'ahead' : 'current');
			return ok({ status, localVer, remoteVer, remoteDisplay });
		} finally { clearTimeout(timer); }
	} catch (e) {
		if (e.name === 'AbortError') return fail('检测超时', 'timeout');
		return fail(e.message);
	}
}

// 执行模组更新：下载远端 .asar → 复用导入管线覆盖（保留前缀/启停/config 不丢）
async function updateMod(idx) {
	try {
		const mods = effectiveMods();
		const mod = mods[idx];
		if (!mod) return fail('模组不存在', 'notfound');
		const meta = readModMeta(mod.diskName);
		const upd = meta && meta.update;
		if (!upd || upd.source !== 'github' || !upd.repo) return fail('该模组无更新渠道', 'noChannel');
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 60000);
		try {
			const rel = await (await fetch(`https://api.github.com/repos/${upd.repo}/releases/latest`, { headers: ghHeaders(), signal: ctrl.signal })).json();
			const assets = rel.assets || [];
			let assetName = upd.asset || null;
			if (!assetName) {
				const mf = assets.find(a => /\.update\.json$/i.test(a.name));
				if (mf) { try { const m = await (await fetch(mf.browser_download_url, { headers: ghHeaders(), signal: ctrl.signal })).json(); if (m && m.asset) assetName = String(m.asset); } catch (e) {} }
			}
			const asarAsset = (assetName && assets.find(a => a.name === assetName)) || assets.find(a => /\.asar$/i.test(a.name));
			if (!asarAsset) return fail('远端 release 未找到 .asar 资产');
			const dl = await fetch(asarAsset.browser_download_url, { headers: { 'User-Agent': 'DevilConnection-ModLoader' }, signal: ctrl.signal });
			if (!dl.ok) return fail(`下载失败 (HTTP ${dl.status})`);
			const buf = Buffer.from(new Uint8Array(await dl.arrayBuffer()));
			const r = stageAsarImport(asarAsset.name, buf);
			if (r.status === 'invalid') return fail(r.message || '下载的模组文件无效');
			if (r.status === 'added') return ok({ updated: true, restartRequired: true, note: '已作为新模组安装' });
			const c = confirmPendingImport(r.token);
			if (!c.ok) return c;
			return ok({ updated: true, restartRequired: true, kind: r.kind });
		} finally { clearTimeout(timer); }
	} catch (e) {
		if (e.name === 'AbortError') return fail('更新超时', 'timeout');
		return fail(e.message);
	}
}

function setup(deps) {
	D = deps;
	AdmZip = deps.admZip;
	const { ipcMain } = D;

	const H = {
		'mgr:getModsData': () => getModsData(),
		'mgr:isGameRunning': () => ok(isGameRunning()),
		'mgr:toggleModDisabled': (e, idx) => toggleModDisabled(idx),
		'mgr:deleteMod': (e, idx) => deleteMod(idx),
		'mgr:moveModTo': (e, o, n) => moveModTo(o, n),
		'mgr:autoFixOrder': () => autoFixOrder(),
		'mgr:importModFromBuffer': (e, fn, bytes) => importModFromBuffer(fn, bytes),
		'mgr:confirmPendingImport': (e, token) => confirmPendingImport(token),
		'mgr:cancelPendingImport': (e, token) => cancelPendingImport(token),
		'mgr:getModConfig': (e, idx) => getModConfig(idx),
		'mgr:saveModConfig': (e, idx, values) => saveModConfig(idx, values),
		'mgr:openModsFolder': () => openModsFolder(),
		'mgr:openExternal': (e, url) => openExternal(url),
		'mgr:getAppInfo': () => getAppInfo(),
		'mgr:checkForUpdate': (e, beta) => checkForUpdate(!!beta),
		'mgr:downloadAndApplyUpdate': (e, beta) => downloadAndApplyUpdate(e.sender, !!beta),
		'mgr:cancelUpdate': () => cancelUpdate(),
		'mgr:checkModUpdate': (e, idx) => checkModUpdate(idx),
		'mgr:updateMod': (e, idx) => updateMod(idx),

		'mgr:autoBackup': (e, s) => autoBackup(s),
		'mgr:getBackupsData': () => getBackupsData(),
		'mgr:restoreBackup': (e, name) => restoreBackup(name),
		'mgr:renameBackup': (e, name, label) => renameBackup(name, label),
		'mgr:toggleBackupLock': (e, name) => toggleBackupLock(name),
		'mgr:exportBackupFile': (e, name) => exportBackupFile(name),
		'mgr:deleteBackup': (e, name) => deleteBackup(name),
		'mgr:backupNow': (e, taskId, finalName) => backupNow(taskId, finalName),
		'mgr:importBackupFromBuffer': (e, fn, bytes) => importBackupFromBuffer(fn, bytes),
		'mgr:exportCurrentSave': () => exportCurrentSave()
	};
	for (const [ch, fn] of Object.entries(H)) {
		ipcMain.handle(ch, async (...args) => { try { return await fn(...args); } catch (e) { return fail(e.message); } });
	}
}

module.exports = { setup };
