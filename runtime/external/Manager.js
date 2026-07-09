'use strict';
let fs;
try { fs = require('original-fs'); } catch (e) { fs = require('fs'); }
const path = require('path');

let D = null;
let AdmZip = null;

const GAME_BODY = 'app.bak.asar';
const DISABLE_EXT = '.disable';
const MOD_META_FILE = 'mods.json';

// 版本号单一真源 = resources/version.json（安装器部署）。RV 只是显示前缀，真正版本号是里面的 version(如 1.2.1)。
const VERSION_PREFIX = 'RV';
const DEFAULT_REPO = 'Luoyu-Wangchai/DevilConnection_ModLoader';
function readVersionInfo() {
	try {
		const p = path.join(D.resourcesPath, 'version.json');
		if (fs.existsSync(p)) {
			const j = JSON.parse(fs.readFileSync(p, 'utf8'));
			return {
				version: String(j.version || '0.0.0'),
				repo: String(j.repo || DEFAULT_REPO),
				name: String(j.name || 'DevilConnection ModLoader')
			};
		}
	} catch (e) {}
	return { version: '0.0.0', repo: DEFAULT_REPO, name: 'DevilConnection ModLoader' };
}
function displayVersion(v) { return VERSION_PREFIX + v; }

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

function readModsConfig() {
	const cfg = { order: [], disabled: [], toggles: [], deleted: [], names: {} };
	try {
		if (fs.existsSync(modsConfigPath())) {
			const j = JSON.parse(fs.readFileSync(modsConfigPath(), 'utf8'));
			cfg.order = Array.isArray(j.order) ? j.order : [];
			cfg.disabled = Array.isArray(j.disabled) ? j.disabled : [];
			cfg.toggles = Array.isArray(j.toggles) ? j.toggles : [];
			cfg.deleted = Array.isArray(j.deleted) ? j.deleted : [];
			cfg.names = (j.names && typeof j.names === 'object') ? j.names : {};
		}
	} catch (e) {}
	return cfg;
}
function writeModsConfig(cfg) {
	ensureDir(pluginsDir());
	fs.writeFileSync(modsConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
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

function migrateLegacyDisabled() {
	const cfg = readModsConfig();
	if (!cfg.disabled.length) return;
	const remain = [];
	for (const name of cfg.disabled) {
		const full = path.join(pluginsDir(), name);
		try {
			if (name.toLowerCase().endsWith('.asar') && fs.existsSync(full) && fs.statSync(full).isFile()) {
				fs.renameSync(full, full + DISABLE_EXT);
			}
		} catch (e) { remain.push(name); }
	}
	cfg.disabled = remain;
	writeModsConfig(cfg);
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
				? String(j.displayVersion).trim() : null
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
	migrateLegacyDisabled();
	const cfg = readModsConfig();
	const deleted = new Set(cfg.deleted || []);
	const entries = scanDiskMods().filter(m => !deleted.has(m.canonical));
	const byName = new Map(entries.map(m => [m.canonical, m]));
	const ordered = [];
	for (const n of (cfg.order || [])) if (byName.has(n) && !ordered.includes(n)) ordered.push(n);
	[...byName.keys()].filter(n => !ordered.includes(n))
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
		.forEach(n => ordered.push(n));
	const toggles = new Set(cfg.toggles || []);
	return ordered.map(name => {
		const m = byName.get(name);
		const meta = readModMeta(m.disk);
		const bare = deriveDisplay(name);
		const pendingToggle = toggles.has(name);
		return {
			name,
			diskName: m.disk,
			displayName: cfg.names[name] || (meta && meta.name) || bare,
			rawNameWithoutPrefix: bare,
			bareName: bare,
			hasMeta: !!meta,
			description: meta ? (meta.description || '') : null,
			versionText: versionText(meta),
			versionNum: meta ? meta.version : null,
			size: m.size,
			disabled: pendingToggle ? !m.disabled : m.disabled,
			pendingToggle,
			hasConfig: readModSchema(m.disk) !== null
		};
	});
}

function getModsData() {
	try {
		const body = path.join(pluginsDir(), GAME_BODY);
		const asarItem = fs.existsSync(body) ? { size: entrySize(body, false) } : null;
		const cfg = readModsConfig();
		const pending = (cfg.deleted || []).length > 0 || (cfg.toggles || []).length > 0;
		return ok({ asarItem, mods: effectiveMods(), pending });
	} catch (e) { return fail(e.message); }
}

function toggleModDisabled(idx) {
	try {
		const mods = effectiveMods();
		const mod = mods[idx];
		if (!mod) return fail('模组不存在', 'notfound');
		const cfg = readModsConfig();
		const toggles = new Set(cfg.toggles || []);
		if (toggles.has(mod.name)) {
			toggles.delete(mod.name);
			cfg.toggles = [...toggles];
			writeModsConfig(cfg);
			return ok({ restartRequired: true });
		}
		const full = path.join(pluginsDir(), mod.diskName);
		const target = mod.diskName.toLowerCase().endsWith(DISABLE_EXT)
			? full.slice(0, -DISABLE_EXT.length)
			: full + DISABLE_EXT;
		try {
			fs.renameSync(full, target);
			return ok({ restartRequired: true });
		} catch (e) {
			toggles.add(mod.name);
			cfg.toggles = [...toggles];
			writeModsConfig(cfg);
			return ok({ restartRequired: true, pendingToggle: true });
		}
	} catch (e) { return fail(e.message); }
}

function renameMod(idx, newName) {
	try {
		const mods = effectiveMods();
		const mod = mods[idx];
		if (!mod) return fail('模组不存在', 'notfound');
		const cfg = readModsConfig();
		cfg.names[mod.name] = sanitizeName(newName);
		writeModsConfig(cfg);
		return ok();
	} catch (e) { return fail(e.message); }
}

function deleteMod(idx) {
	try {
		const mods = effectiveMods();
		const mod = mods[idx];
		if (!mod) return fail('模组不存在', 'notfound');
		const cfg = readModsConfig();
		const full = path.join(pluginsDir(), mod.diskName);
		let removed = false;
		try { fs.rmSync(full, { force: true }); removed = !fs.existsSync(full); } catch (e) {}
		cfg.order = (cfg.order || []).filter(n => n !== mod.name);
		cfg.toggles = (cfg.toggles || []).filter(n => n !== mod.name);
		delete cfg.names[mod.name];
		if (!removed) {
			const del = new Set(cfg.deleted || []); del.add(mod.name); cfg.deleted = [...del];
		}
		writeModsConfig(cfg);
		return ok({ pending: !removed });
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
		cfg.deleted = (cfg.deleted || []).filter(n => n !== canonical);
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
	const cfg = readModsConfig();
	return {
		status: 'conflict', token, kind,
		file: existing.canonical,
		displayName: cfg.names[existing.canonical] || (oldMeta && oldMeta.name) || deriveDisplay(existing.canonical),
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
		version: v.version,                       // "1.2.1"
		displayVersion: displayVersion(v.version), // "RV1.2.1"
		name: v.name,
		repo: v.repo,
		repoUrl: 'https://github.com/' + v.repo
	});
}

// 从版本串里抽出数字段(容忍 "RV1.2.1" / "v1.2.1" / "1.2.1" 前缀)
function parseVer(s) {
	const m = String(s || '').match(/(\d+(?:\.\d+)*)/);
	return m ? m[1].split('.').map(n => parseInt(n, 10) || 0) : null;
}
function cmpVer(a, b) {
	const pa = parseVer(a), pb = parseVer(b);
	if (!pa || !pb) return 0;
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const x = pa[i] || 0, y = pb[i] || 0;
		if (x !== y) return x < y ? -1 : 1;
	}
	return 0;
}

// 去 GitHub release 检查有无新版(网络请求在主进程做, 见 Plan §5)
async function checkForUpdate() {
	const v = readVersionInfo();
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 12000);
	try {
		const api = `https://api.github.com/repos/${v.repo}/releases/latest`;
		const resp = await fetch(api, {
			headers: { 'User-Agent': 'DevilConnection-ModLoader', 'Accept': 'application/vnd.github+json' },
			signal: ctrl.signal
		});
		if (resp.status === 404) {
			return ok({ hasUpdate: false, current: displayVersion(v.version), latest: null, note: '仓库暂无发布版本' });
		}
		if (!resp.ok) return fail(`GitHub 返回 ${resp.status}`, 'http');
		const rel = await resp.json();
		const tag = rel.tag_name || rel.name || '';
		return ok({
			hasUpdate: cmpVer(v.version, tag) < 0,
			current: displayVersion(v.version),
			latest: tag || null,
			url: rel.html_url || ('https://github.com/' + v.repo + '/releases'),
			notes: rel.body || '',
			publishedAt: rel.published_at || ''
		});
	} catch (e) {
		return fail(e.name === 'AbortError' ? '检查更新超时, 请检查网络' : (e.message || '网络错误'), 'network');
	} finally {
		clearTimeout(timer);
	}
}

function setup(deps) {
	D = deps;
	AdmZip = deps.admZip;
	const { ipcMain } = D;

	const H = {
		'mgr:getModsData': () => getModsData(),
		'mgr:toggleModDisabled': (e, idx) => toggleModDisabled(idx),
		'mgr:renameMod': (e, idx, name) => renameMod(idx, name),
		'mgr:deleteMod': (e, idx) => deleteMod(idx),
		'mgr:moveModTo': (e, o, n) => moveModTo(o, n),
		'mgr:importModFromBuffer': (e, fn, bytes) => importModFromBuffer(fn, bytes),
		'mgr:confirmPendingImport': (e, token) => confirmPendingImport(token),
		'mgr:cancelPendingImport': (e, token) => cancelPendingImport(token),
		'mgr:getModConfig': (e, idx) => getModConfig(idx),
		'mgr:saveModConfig': (e, idx, values) => saveModConfig(idx, values),
		'mgr:openModsFolder': () => openModsFolder(),
		'mgr:openExternal': (e, url) => openExternal(url),
		'mgr:getAppInfo': () => getAppInfo(),
		'mgr:checkForUpdate': () => checkForUpdate(),

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
