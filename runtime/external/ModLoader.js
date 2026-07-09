'use strict';

const fs = require('fs');
const path = require('path');
const electron = require('electron');
const crypto = require('crypto');

let ofs;
try { ofs = require('original-fs'); } catch (e) { ofs = fs; }

const PLUGIN_DIR_NAME = 'plugins';
const CACHE_SUB_DIR = 'mod_loader_cache';
const ENV_FILE_NAME = '.env';
const ASAR_EXT = '.asar';
const TARGET_ASAR_BODY = 'app.bak.asar';
const LOG_FILE_NAME = 'mod_loader.log';
const ENCRYPT_SIG = 'DC_ENC_v1';
const IS_DEBUG = true;
const MAX_PATH_CACHE = 2000;
const MAX_CONFIG_CACHE = 100;
const BRAND_SUFFIX = ' - DevilConnection ModLoader';

const BLACKLIST = new Set([
	'modloader.js', 'manager.js', 'package.json', 'main.js',
	'preload.js', 'preload_manager.js', 'steam.js', 'node_modules',
	'manager', 'private.pem', 'public.pem', '.env', '.env.example',
	'config', 'version.json', '.update'
]);

const O = {
	readFileSync: fs.readFileSync,
	readFile: fs.readFile,
	writeFileSync: fs.writeFileSync,
	appendFileSync: fs.appendFileSync,
	renameSync: fs.renameSync,
	existsSync: fs.existsSync,
	statSync: fs.statSync,
	lstatSync: fs.lstatSync,
	readdirSync: fs.readdirSync,
	mkdirSync: fs.mkdirSync,
	rmSync: fs.rmSync || fs.rmdirSync,
	accessSync: fs.accessSync,
	access: fs.access,
	createReadStream: fs.createReadStream,
	promises: {
		readFile: fs.promises.readFile,
		access: fs.promises.access,
		stat: fs.promises.stat
	}
};

class LRU {
	constructor(limit) { this.limit = limit; this.map = new Map(); }
	has(k) { return this.map.has(k); }
	get(k) {
		if (!this.map.has(k)) return null;
		const v = this.map.get(k);
		this.map.delete(k); this.map.set(k, v);
		return v;
	}
	set(k, v) {
		if (this.map.has(k)) this.map.delete(k);
		else if (this.map.size >= this.limit) this.map.delete(this.map.keys().next().value);
		this.map.set(k, v);
	}
}

const Logger = {
	logPath: '',
	init(resourcesPath) {
		this.logPath = path.join(resourcesPath, LOG_FILE_NAME);
		const header = `\n[${new Date().toLocaleString()}] === 启动日志 ===\n`;
		try {
			let clear = false;
			if (O.existsSync(this.logPath) && O.statSync(this.logPath).size > 5 * 1024 * 1024) clear = true;
			if (clear) O.writeFileSync(this.logPath, header, 'utf8');
			else O.appendFileSync(this.logPath, header, 'utf8');
		} catch (e) { console.error('[ModLoader] 日志初始化失败', e); }
	},
	write(level, msg) {
		if (!this.logPath) return;
		try { O.appendFileSync(this.logPath, `[${new Date().toLocaleTimeString()}] [${level}] ${msg}\n`, 'utf8'); } catch (e) {}
	},
	info(m) { console.log(`[ModLoader] ${m}`); this.write('信息', m); },
	debug(m) { if (IS_DEBUG) { console.log(`[ModLoader] ${m}`); this.write('调试', m); } },
	error(m, e) { console.error(`[ModLoader] ${m}`, e); this.write('错误', `${m}${e ? ': ' + e.message : ''}`); }
};

const ConfigManager = {
	cache: new LRU(MAX_CONFIG_CACHE),

	deobfuscateKey(fakeKey) {
		if (!fakeKey) return null;
		try {
			let content = fakeKey
				.replace('-----BEGIN RSA PRIVATE KEY-----', '')
				.replace('-----END RSA PRIVATE KEY-----', '').trim();
			const b64 = content.split('').reverse().join('');
			const lines = b64.match(/.{1,64}/g);
			if (!lines) return null;
			return `-----BEGIN RSA PRIVATE KEY-----\n${lines.join('\n')}\n-----END RSA PRIVATE KEY-----`;
		} catch (e) { Logger.error('私钥还原失败', e); return null; }
	},

	getConfigForFile(filePath) {
		const root = PluginManager.getPluginRoot(filePath);
		if (!root) return null;
		if (this.cache.has(root)) return this.cache.get(root);

		const cfg = { encrypted: false, key: null, white: [], black: [] };
		const envPath = path.join(root, ENV_FILE_NAME);
		if (O.existsSync(envPath)) {
			try {
				cfg.encrypted = true;
				O.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
					const t = line.trim();
					if (!t || t.startsWith('#')) return;
					const i = t.indexOf('=');
					if (i === -1) return;
					const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim();
					if (k === 'ENCRYPT_WHITELIST' && v) cfg.white = v.split(',').map(s => new RegExp(s.trim(), 'i'));
					if (k === 'ENCRYPT_BLACKLIST' && v) cfg.black = v.split(',').map(s => new RegExp(s.trim(), 'i'));
					if (k === 'PRIVATE_KEY_B64' && v) cfg.key = this.deobfuscateKey(v);
				});
				if (!cfg.key) {
					const pem = path.join(root, 'private.pem');
					if (O.existsSync(pem)) cfg.key = O.readFileSync(pem, 'utf8');
				}
				if (cfg.encrypted && !cfg.key) Logger.error(`[严重] 加密模组 ${path.basename(root)} 缺少解密密钥`);
			} catch (e) { Logger.error('解析 .env 失败', e); }
		}
		this.cache.set(root, cfg);
		return cfg;
	},

	shouldDecrypt(filePath) {
		const cfg = this.getConfigForFile(filePath);
		if (!cfg || !cfg.encrypted || !cfg.key) return false;
		const fileName = path.basename(filePath.replace(/\\/g, '/'));
		for (const re of cfg.black) if (re.test(fileName)) return false;
		if (cfg.white.length > 0) return cfg.white.some(re => re.test(fileName));
		return true;
	}
};

const Env = {
	isMain: (typeof process !== 'undefined' && process.type === 'browser'),
	getResourcesPath() {
		try {
			if (process.resourcesPath) return path.normalize(process.resourcesPath);
			const _app = electron.app || (electron.remote && electron.remote.app);
			let p = _app ? _app.getAppPath() : process.cwd();
			p = p.replace(/\\/g, '/');
			if (process.platform === 'win32' && p.toLowerCase().includes('/resources/')) {
				p = p.substring(0, p.toLowerCase().lastIndexOf('/resources/') + 10);
			}
			return path.normalize(p);
		} catch (e) {
			return path.join(process.cwd(), 'resources');
		}
	},
	getUserDataPath() {
		try {
			const app = electron.app || (electron.remote && electron.remote.app);
			if (app) return app.getPath('userData');
			return path.join(this.getResourcesPath(), '..', '.mod_cache');
		} catch (e) {
			return path.join(require('os').tmpdir(), 'devil_connection_mod_cache');
		}
	}
};

const PluginManager = {
	resourcesPath: Env.getResourcesPath(),
	pluginDir: '',
	cacheDir: '',
	plugins: [],
	pathCache: new LRU(MAX_PATH_CACHE),

	init() {
		this.pluginDir = path.join(this.resourcesPath, PLUGIN_DIR_NAME);
		this.cacheDir = path.join(Env.getUserDataPath(), CACHE_SUB_DIR);

		Logger.init(this.resourcesPath);
		Logger.debug(`资源目录: ${this.resourcesPath}`);
		Logger.debug(`插件目录: ${this.pluginDir}`);
		Logger.debug(`缓存目录: ${this.cacheDir}`);

		if (!O.existsSync(this.pluginDir)) {
			try { O.mkdirSync(this.pluginDir, { recursive: true }); } catch (e) { Logger.error('创建插件目录失败', e); }
		}
		try {
			if (O.existsSync(this.cacheDir)) O.rmSync(this.cacheDir, { recursive: true, force: true });
			O.mkdirSync(this.cacheDir, { recursive: true });
		} catch (e) { Logger.error(`缓存目录操作失败: ${this.cacheDir}`, e); }

		try {
			const cfg = this.loadConfigAndApplyPending();

			const disk = O.readdirSync(this.pluginDir).filter(name => {
				if (name.startsWith('.')) return false;
				if (name.toLowerCase() === TARGET_ASAR_BODY) return false;
				if (BLACKLIST.has(name.toLowerCase())) return false;
				if (name === 'mods.config.json') return false;
				if (!name.toLowerCase().endsWith(ASAR_EXT)) return false;
				try {
					return ofs.statSync(path.join(this.pluginDir, name)).isFile();
				} catch (e) { return false; }
			});

			const ordered = [];
			for (const n of (cfg.order || [])) if (disk.includes(n) && !ordered.includes(n)) ordered.push(n);
			disk.filter(n => !ordered.includes(n))
				.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
				.forEach(n => ordered.push(n));

			this.plugins = ordered.map(n => path.join(this.pluginDir, n));
			const body = path.join(this.pluginDir, TARGET_ASAR_BODY);
			if (O.existsSync(body)) this.plugins.push(body);

			Logger.info(`扫描完成, 已加载 ${this.plugins.length} 个模组.`);
			this.plugins.forEach((p, i) => Logger.info(`优先级 [${i + 1}]: ${path.basename(p)}`));
		} catch (e) { Logger.error('初始化失败', e); }
	},

	configPath() { return path.join(this.pluginDir, 'mods.config.json'); },

	loadConfigAndApplyPending() {
		let cfg = { order: [], disabled: [], toggles: [], deleted: [], names: {} };
		try {
			if (O.existsSync(this.configPath())) {
				cfg = Object.assign(cfg, JSON.parse(O.readFileSync(this.configPath(), 'utf8')));
			}
		} catch (e) { Logger.error('读取 mods.config.json 失败', e); }

		let dirty = false;

		if (Array.isArray(cfg.disabled) && cfg.disabled.length) {
			const remain = [];
			for (const name of cfg.disabled) {
				const full = path.join(this.pluginDir, name);
				try {
					if (name.toLowerCase().endsWith(ASAR_EXT) && ofs.existsSync(full) && ofs.statSync(full).isFile()) {
						ofs.renameSync(full, full + '.disable');
						Logger.info(`旧配置迁移: ${name} → ${name}.disable`);
					}
				} catch (e) { Logger.error(`迁移禁用项 ${name} 失败(可能仍被占用)`, e); remain.push(name); }
			}
			cfg.disabled = remain;
			dirty = true;
		}

		if (Array.isArray(cfg.toggles) && cfg.toggles.length) {
			const remain = [];
			for (const name of cfg.toggles) {
				const full = path.join(this.pluginDir, name);
				try {
					if (ofs.existsSync(full)) ofs.renameSync(full, full + '.disable');
					else if (ofs.existsSync(full + '.disable')) ofs.renameSync(full + '.disable', full);
					Logger.info(`已应用挂起启停: ${name}`);
				} catch (e) { Logger.error(`启停 ${name} 失败(可能仍被占用)`, e); remain.push(name); }
			}
			cfg.toggles = remain;
			dirty = true;
		}

		if (Array.isArray(cfg.deleted) && cfg.deleted.length) {
			const remain = [];
			for (const name of cfg.deleted) {
				try {
					for (const variant of [name, name + '.disable']) {
						const full = path.join(this.pluginDir, variant);
						if (ofs.existsSync(full)) ofs.rmSync(full, { force: true });
					}
					Logger.info(`已应用挂起删除: ${name}`);
				} catch (e) { Logger.error(`删除 ${name} 失败(可能仍被占用)`, e); remain.push(name); }
			}
			cfg.deleted = remain;
			cfg.order = (cfg.order || []).filter(n =>
				ofs.existsSync(path.join(this.pluginDir, n)) || ofs.existsSync(path.join(this.pluginDir, n + '.disable')));
			dirty = true;
		}

		if (dirty) {
			try { O.writeFileSync(this.configPath(), JSON.stringify(cfg, null, 2), 'utf8'); } catch (e) {}
		}
		return cfg;
	},

	norm(p) { return (!p || typeof p !== 'string') ? '' : path.normalize(p).replace(/\\/g, '/').toLowerCase(); },
	isSafe(target) {
		const n = this.norm(target);
		return [this.norm(this.pluginDir), this.norm(this.cacheDir)].some(s => n.startsWith(s));
	},
	getPluginRoot(filePath) {
		const n = this.norm(filePath);
		for (const p of this.plugins) if (n.startsWith(this.norm(p))) return p;
		return null;
	},

	decryptContent(buffer, privateKey) {
		try {
			if (!buffer || buffer.length < ENCRYPT_SIG.length + 4) return null;
			if (buffer.slice(0, ENCRYPT_SIG.length).toString() !== ENCRYPT_SIG) return null;
			const keyLen = buffer.readUInt32BE(ENCRYPT_SIG.length);
			if (buffer.length < ENCRYPT_SIG.length + 4 + keyLen) return null;
			const encKey = buffer.slice(ENCRYPT_SIG.length + 4, ENCRYPT_SIG.length + 4 + keyLen);
			const info = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, encKey);
			const aesKey = info.slice(0, 32), iv = info.slice(32, 48);
			const cipher = buffer.slice(ENCRYPT_SIG.length + 4 + keyLen);
			const d = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
			return Buffer.concat([d.update(cipher), d.final()]);
		} catch (e) { Logger.error('内容解密失败', e); return null; }
	},

	getDecodedCachePath(originalPath) {
		if (!ConfigManager.shouldDecrypt(originalPath)) return originalPath;
		if (!this.isSafe(originalPath)) return originalPath;
		const hash = crypto.createHash('md5').update(originalPath).digest('hex');
		const cacheFile = path.join(this.cacheDir, `${hash}${path.extname(originalPath)}`);
		if (O.existsSync(cacheFile)) return cacheFile;
		try {
			const buf = O.readFileSync(originalPath);
			const cfg = ConfigManager.getConfigForFile(originalPath);
			const dec = this.decryptContent(buf, cfg.key);
			if (dec) { O.writeFileSync(cacheFile, dec); Logger.debug(`[解密] ${path.basename(originalPath)}`); return cacheFile; }
		} catch (e) { Logger.error(`解密缓存失败: ${originalPath}`, e); }
		return originalPath;
	},

	resolvePath(target) {
		if (!target || typeof target !== 'string') return null;
		const key = this.norm(target);
		if (this.pathCache.has(key)) return this.pathCache.get(key);

		let result = null;
		try {
			const normalized = target.replace(/\\/g, '/');
			let rel = '';
			const m = normalized.match(/^(.*\.asar)\/(.*)$/i);
			if (m) rel = m[2];
			else if (!path.isAbsolute(target)) rel = normalized;

			if (rel) {
				const platformRel = rel.replace(/\//g, path.sep);
				for (const plugin of this.plugins) {
					const tryPath = path.join(plugin, platformRel);
					if (O.existsSync(tryPath)) { result = this.getDecodedCachePath(tryPath); break; }
				}
			}
		} catch (e) { Logger.error(`路径解析异常: ${target}`, e); }

		if (result) this.pathCache.set(key, result);
		return result;
	}
};

const ScriptInjection = {
	scripts: [],
	builtIn: `
		(function(){
			const SUFFIX=${JSON.stringify(BRAND_SUFFIX)};
			function upd(){try{if(typeof document!=='undefined'&&document.title!==undefined){if(!document.title.includes(SUFFIX))document.title=document.title+SUFFIX;}}catch(e){}}
			function obs(){const t=document.querySelector('title');if(t){new MutationObserver(upd).observe(t,{childList:true,characterData:true});}else{const h=document.querySelector('head');if(h){const ho=new MutationObserver(()=>{if(document.querySelector('title')){upd();ho.disconnect();obs();}});ho.observe(h,{childList:true});}}}
			upd();
			if(document.readyState==='complete'||document.readyState==='interactive')obs();
			else window.addEventListener('DOMContentLoaded',()=>{upd();obs();});
		})();`,

	scan() {
		this.scripts = [];
		this.scripts.push({
			name: 'DCModLoader',
			code: `(function(){console.log('[ModLoader] 内置 Hook: DCModLoader');try{${this.builtIn}}catch(e){console.error('[ModLoader] 内置 Hook 错误',e);}})();`
		});
		PluginManager.plugins.forEach(plugin => {
			const hookPath = path.join(plugin, 'hook.js');
			if (!O.existsSync(hookPath)) return;
			try {
				const code = O.readFileSync(PluginManager.getDecodedCachePath(hookPath), 'utf8');
				const name = path.basename(plugin);
				this.scripts.push({
					name,
					code: `(function(){
console.log('[ModLoader] 插件 Hook: ${name}');
function __dcmlRun(){${code}\n}
try { __dcmlRun(); }
catch (e) {
	if (document.readyState === 'loading') {
		console.warn('[ModLoader] 插件 ${name} 页面就绪前执行失败, DOMContentLoaded 后重试', e);
		document.addEventListener('DOMContentLoaded', function () {
			try { __dcmlRun(); } catch (e2) { console.error('[ModLoader] 插件 ${name} 运行错误', e2); }
		});
	} else {
		console.error('[ModLoader] 插件 ${name} 运行错误', e);
	}
}
})();`
				});
				Logger.debug(`插件 Hook 就绪: ${name}`);
			} catch (e) { Logger.error(`读取 ${hookPath} 失败`, e); }
		});
	},

	injectInto(win) {
		if (this.scripts.length === 0) return;
		const doInject = () => this.scripts.forEach(s =>
			win.webContents.executeJavaScript(s.code)
				.then(() => Logger.debug(`成功向窗口注入: ${s.name}`))
				.catch(e => Logger.error(`注入脚本 ${s.name} 失败`, e)));
		if (!win.webContents.isLoading()) doInject();
		win.webContents.on('did-finish-load', doInject);
	},

	injectAllExisting() {
		const wins = electron.BrowserWindow.getAllWindows();
		if (wins.length) { Logger.debug(`发现 ${wins.length} 个现有窗口, 注入中...`); wins.forEach(w => this.injectInto(w)); }
	}
};

const ScenarioPatch = {
	cache: {},
	get(originalPath, base) {
		if (this.cache[base]) return this.cache[base];
		try {
			let content = O.readFileSync(PluginManager.getDecodedCachePath(originalPath), 'utf8');
			let sections = '';
			const sub = path.join('data', 'scenario', 'system');
			const prefix = `${base}_data`;
			for (const plugin of PluginManager.plugins) {
				const sysDir = path.join(plugin, sub);
				if (!O.existsSync(sysDir)) continue;
				for (const file of O.readdirSync(sysDir)) {
					if (file.startsWith('.') || !file.toLowerCase().endsWith('.ks')) continue;
					if (!file.toLowerCase().startsWith(prefix.toLowerCase())) continue;
					try {
						const patchPath = PluginManager.getDecodedCachePath(path.join(sysDir, file));
						sections += `\n; --- 补丁: ${file} ---\n\n${O.readFileSync(patchPath, 'utf8')}\n`;
					} catch (e) { Logger.error(`读取补丁 ${file} 失败`, e); }
				}
			}
			if (sections) {
				const injection = `\n; --- ModLoader 动态注入开始 ---\n${sections}\n; --- ModLoader 动态注入结束 ---\n`;
				const ri = content.indexOf('[return]');
				content = ri !== -1 ? content.slice(0, ri) + injection + content.slice(ri) : content + injection;
				Logger.debug(`已在 ${base}.ks 注入补丁内容.`);
			}
			try { O.writeFileSync(path.join(PluginManager.cacheDir, `${base}_patched.ks`), content, 'utf8'); } catch (e) {}
			this.cache[base] = content;
			return content;
		} catch (e) { Logger.error(`注入 ${base} 补丁失败`, e); return null; }
	}
};

const Hooks = {
	applyFS() {
		const map = (p) => {
			if (typeof p !== 'string') return p;
			try {
				if (p.toLowerCase().includes('.asar') || p.includes('/Resources/') || p.includes('\\resources\\') || !path.isAbsolute(p)) {
					return PluginManager.resolvePath(p) || p;
				}
			} catch (e) {}
			return p;
		};

		fs.readFileSync = (p, o) => {
			try {
				const n = typeof p === 'string' ? p.replace(/\\/g, '/').toLowerCase() : '';
				if (n.endsWith('data/scenario/system/chara_define.ks')) { const pt = ScenarioPatch.get(map(p), 'chara_define'); if (pt) return pt; }
				if (n.endsWith('data/scenario/system/plugin.ks')) { const pt = ScenarioPatch.get(map(p), 'plugin'); if (pt) return pt; }
				return O.readFileSync(map(p), o);
			} catch (e) { return O.readFileSync(p, o); }
		};
		fs.existsSync = (p) => { try { const m = map(p); return O.existsSync(m) || (m !== p && O.existsSync(p)); } catch (e) { return O.existsSync(p); } };
		fs.statSync = (p, o) => { try { return O.statSync(map(p), o); } catch (e) { return O.statSync(p, o); } };
		fs.lstatSync = (p, o) => { try { return O.lstatSync(map(p), o); } catch (e) { return O.lstatSync(p, o); } };
		fs.readdirSync = (p, o) => { try { return O.readdirSync(map(p), o); } catch (e) { return O.readdirSync(p, o); } };
		fs.accessSync = (p, m) => { try { return O.accessSync(map(p), m); } catch (e) { return O.accessSync(p, m); } };

		fs.readFile = (p, o, c) => {
			const cb = typeof o === 'function' ? o : c;
			const opt = typeof o === 'function' ? null : o;
			const m = map(p);
			O.readFile(m, opt, (err, data) => { if (err && m !== p) return O.readFile(p, opt, cb); cb(err, data); });
		};
		fs.access = (p, m, c) => {
			const cb = typeof m === 'function' ? m : c;
			const mode = typeof m === 'function' ? undefined : m;
			const mp = map(p);
			O.access(mp, mode, (err) => { if (err && mp !== p) return O.access(p, mode, cb); cb(err); });
		};

		if (fs.promises) {
			fs.promises.readFile = async (p, o) => {
				const m = map(p);
				try { return await O.promises.readFile(m, o); } catch (e) { if (m !== p) return O.promises.readFile(p, o); throw e; }
			};
			fs.promises.access = (p, m) => O.promises.access(map(p), m).catch(() => O.promises.access(p, m));
			fs.promises.stat = (p, o) => O.promises.stat(map(p), o).catch(() => O.promises.stat(p, o));
		}

		fs.createReadStream = (p, o) => { try { return O.createReadStream(map(p), o); } catch (e) { return O.createReadStream(p, o); } };
	},

	setupProtocol() {
		const { app, protocol } = electron;
		const register = () => {
			protocol.interceptFileProtocol('file', (req, callback) => {
				try {
					let urlPath;
					try {
						const u = new URL(req.url);
						urlPath = path.normalize(decodeURIComponent(u.pathname));
						if (process.platform === 'win32' && urlPath.startsWith('\\')) urlPath = urlPath.substring(1);
					} catch (e) {
						urlPath = decodeURIComponent(req.url.replace(/^file:\/\/\//, ''));
					}
					const q = urlPath.indexOf('?');
					if (q !== -1) urlPath = urlPath.substring(0, q);
					callback({ path: PluginManager.resolvePath(urlPath) || path.normalize(urlPath) });
				} catch (err) {
					Logger.error('协议拦截致命错误', err);
					callback({ error: -2 });
				}
			});
		};
		if (app.isReady()) register(); else app.whenReady().then(register);
	},

	applyWindow() {
		if (!Env.isMain) return;
		const { app } = electron;
		const setup = () => {
			app.on('browser-window-created', (_e, win) => ScriptInjection.injectInto(win));
			ScriptInjection.injectAllExisting();
		};
		if (app.isReady()) setup(); else app.whenReady().then(setup);
	}
};

let _hooksInstalled = false;
let _pluginsLoaded = false;

function installHooks() {
	if (_hooksInstalled) return;
	_hooksInstalled = true;
	try {
		Hooks.applyFS();
		if (Env.isMain) Hooks.setupProtocol();
	} catch (e) { console.error('[ModLoader] installHooks 失败', e); }
}

function loadPlugins() {
	if (_pluginsLoaded) return;
	_pluginsLoaded = true;
	try {
		PluginManager.init();
		ScriptInjection.scan();
	} catch (e) { console.error('[ModLoader] loadPlugins 失败', e); }
}

if (!Env.isMain) { installHooks(); loadPlugins(); }

module.exports = {
	installHooks,
	loadPlugins,
	injectInto: (win) => ScriptInjection.injectInto(win),
	getScripts: () => ScriptInjection.scripts,
	PluginManager,
	Logger,
	nativeFS: O
};
