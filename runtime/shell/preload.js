const path = require('path');

let ML = null;
try {
	ML = require(path.join(process.resourcesPath, 'ModLoader.js'));
} catch (e) { console.error('[ModLoader preload] 加载 ModLoader.js 失败，模组与汉化将不会注入', e); }

const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');

contextBridge.exposeInMainWorld('electronAPI', {
	readdirSync: (dirPath) => fs.readdirSync(dirPath),
	readFileSync: (filePath, encoding = 'utf8') => fs.readFileSync(filePath, encoding),
	existsSync: (filePath) => fs.existsSync(filePath),
	joinPath: (...args) => path.join(...args),
	extname: (filePath) => path.extname(filePath)
});

contextBridge.exposeInMainWorld('api', {
	returnProcess: () => ({ platform: process.platform, execPath: process.execPath }),
	returnDirName: () => __dirname,

	returnSingleInstanceLock: async () => await ipcRenderer.invoke('electron:returnSingleInstanceLock'),
	quit: async () => { await ipcRenderer.invoke('electron:quit'); },

	returnAppPath: () => ipcRenderer.sendSync('getAppPath'),
	returnRelativePath: async (file_path, item_path) =>
		await ipcRenderer.invoke('path:returnRelativePath', file_path, item_path),

	existFile: p => fs.existsSync(p),
	makeDir: p => { fs.mkdirSync(p); },
	writeFile: (p, value) => { fs.writeFileSync(p, value); },
	writeFileEnc: (p, value) => {
		const encrypted = ipcRenderer.sendSync('encrypt', value);
		fs.writeFileSync(p, encrypted, 'binary');
	},
	readFile: p => fs.readFileSync(p, 'utf-8'),
	readFileDec: p => {
		const buf = fs.readFileSync(p);
		return ipcRenderer.sendSync('decrypt', buf);
	},
	readFileBin: p => fs.readFileSync(p),
	rm: p => { fs.rmSync(p, { recursive: true }); },
	saveFile: async param => await ipcRenderer.invoke('saveFile', param),
	unlink: p => { fs.unlinkSync(p); },
	showDialog: async option => { await ipcRenderer.invoke('dialog:showDialog', option); },
	setFullScreen: async fullscreen => { await ipcRenderer.invoke('setFullScreen', fullscreen); },

	applyPatch: async (unzip_path, local_path, patch_path) =>
		await ipcRenderer.invoke('patch:apply', unzip_path, local_path, patch_path),

	openWebPage: async url => { await ipcRenderer.invoke('shell:openNewWindow', url); },

	readSubDir: async p => await ipcRenderer.invoke('debug:readSubDir', p),
	toggleDevTools: async () => { await ipcRenderer.invoke('debug:toggleDevTools'); },
	isMuteAudio: async enable => { await ipcRenderer.invoke('debug:isMuteAudio', enable); },
	captureWindow: async (x, y, width, height) => await ipcRenderer.invoke('debug:captureWindow', x, y, width, height),
	registerHotKey: async key => { await ipcRenderer.invoke('debug:registerHotKey', key); },
	getSaveKey: () => ipcRenderer.sendSync('getSaveKey'),

	isAppActivated: async () => await ipcRenderer.invoke('steamworks:isAppActivated'),
	activateAchievement: async name => { await ipcRenderer.invoke('steamworks:activateAchievement', name); },
	triggerScreenshot: async (x, y, w, h) => { await ipcRenderer.invoke('steamworks:triggerScreenshot', x, y, w, h); },
	log: async (...args) => { await ipcRenderer.invoke('log', args); }
});

function __dcmlWorkerHook() {
	if (window.__DCML_WORKER_HOOK) return;
	window.__DCML_WORKER_HOOK = true;
	var NW = window.Worker;
	if (!NW) return;
	window.Worker = function (url, options) {
		try {
			var s = String(url);
			if (window.electronAPI && window.electronAPI.readFileSync && !/^(blob:|data:|https?:)/i.test(s)) {
				var abs = new URL(s, location.href);
				if (abs.protocol === 'file:') {
					var p = decodeURIComponent(abs.pathname);
					if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
					var code = window.electronAPI.readFileSync(p, 'utf8');
					if (code != null) {
						try { window.__DCML_LAST_WORKER = { path: p, len: String(code).length, head: String(code).slice(0, 60) }; } catch (_) {}
						return new NW(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })), options);
					}
				}
			}
		} catch (e) { try { console.warn('[ModLoader] Worker hook 回退原生加载:', e && e.message); } catch (_) {} }
		return new NW(url, options);
	};
	try { window.Worker.prototype = NW.prototype; } catch (e) {}
}
try {
	const { webFrame } = require('electron');
	webFrame.executeJavaScript('(' + __dcmlWorkerHook.toString() + ')();');

	if (ML && typeof ML.getScripts === 'function') {
		for (const s of ML.getScripts()) webFrame.executeJavaScript(s.code);
	}
} catch (e) { try { console.error('[ModLoader preload] 注入模组 hook 失败', e); } catch (_) {} }

