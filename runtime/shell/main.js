import { createRequire } from 'module';
import path, { join, relative, resolve } from 'path';

const require = createRequire(import.meta.url);

const modLoaderPath = path.join(process.resourcesPath, 'ModLoader.js');
let ML = null;
try { ML = require(modLoaderPath); if (ML && ML.installHooks) ML.installHooks(); }
catch (e) { console.error('[壳] 加载 ModLoader.js 失败', e); }

import {
	app, BrowserWindow, dialog, globalShortcut, ipcMain, shell
} from 'electron';
import {
	existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync
} from 'fs';
import { initialize, enable } from '@electron/remote/main/index.js';
import { safeStorage } from 'electron/main';
import { EOL } from 'os';
import { format } from 'url';
import { initSteam } from './steam.js';

function steamBypassEnabled() {
	try {
		const ofs = require('original-fs');
		const dir = path.join(process.resourcesPath, 'plugins');
		let disabled = [];
		try { disabled = (JSON.parse(ofs.readFileSync(path.join(dir, 'mods.config.json'), 'utf8')).disabled) || []; } catch (e) {}
		return ofs.readdirSync(dir).some(function (n) {
			if (!/\.asar$/i.test(n)) return false;
			const bare = n.replace(/^\d+_/, '').replace(/\.asar$/i, '');
			return bare === 'dc_steambypass' && disabled.indexOf(n) === -1;
		});
	} catch (e) { return false; }
}

let steamworksClient = null;
const allowNoSteam = steamBypassEnabled();
try {
	steamworksClient = initSteam();
	if (!steamworksClient && !allowNoSteam) app.quit();
} catch (error) {
	if (allowNoSteam) {
		console.warn('[壳] Steam 初始化失败，但已启用 dc_steambypass（本地调试），继续离线运行——成就/截图等 Steam 功能不可用。');
	} else {
		try { dialog.showErrorBox('Error', error.toString()); } catch (e) {}
		app.quit();
	}
}

let loaderWindow = null;
let gameWindow = null;
let remoteInitialized = false;
app.commandLine.appendSwitch('js-flags', '--expose-gc');

function ensureRemoteInitialized() {
	if (remoteInitialized) return;
	initialize();
	remoteInitialized = true;
}

const scSize = { width: 1280, height: 960 };

async function triggerScreenshot(x, y, width, height) {
	const screenshot = await gameWindow.capturePage({ x, y, width, height });
	const tmpPath = resolve('./__screenshot_tmp.png');
	writeFileSync(tmpPath, screenshot.resize({ ...scSize }).toPNG(), { encoding: 'binary' });
	steamworksClient.screenshots.addScreenshotToLibrary(tmpPath, null, width, height);
	rmSync(tmpPath);
}

function activeWindow() {
	if (gameWindow && !gameWindow.isDestroyed()) return gameWindow;
	if (loaderWindow && !loaderWindow.isDestroyed()) return loaderWindow;
	return null;
}

let ModManager = null;
try {
	ModManager = require(path.join(process.resourcesPath, 'Manager.js'));
	if (ModManager && typeof ModManager.setup === 'function') {
		ModManager.setup({
			ipcMain, dialog,
			admZip: require('adm-zip'),
			nativeFS: ML && ML.nativeFS,
			getDialogParent: activeWindow,
			resourcesPath: process.resourcesPath
		});
	}
} catch (e) { console.error('[壳] 加载 Manager.js 失败', e); }

function createLoaderWindow() {
	if (loaderWindow && !loaderWindow.isDestroyed()) { loaderWindow.show(); loaderWindow.focus(); return; }
	ensureRemoteInitialized();
	loaderWindow = new BrowserWindow({
		width: 980, height: 680, minWidth: 720, minHeight: 520,
		title: 'DevilConnection ModLoader',
		backgroundColor: '#15101f',
		autoHideMenuBar: true,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: join(app.getAppPath(), 'preload_manager.js')
		}
	});
	loaderWindow.removeMenu();
	loaderWindow.loadFile(path.join(process.resourcesPath, 'manager', 'index.html'));
	loaderWindow.on('closed', () => { loaderWindow = null; });
}

function createGameWindow() {
	ensureRemoteInitialized();
	gameWindow = new BrowserWindow({
		width: 1280, height: 960, minWidth: 960, minHeight: 720,
		useContentSize: true,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: true,
			webSecurity: true,
			preload: join(app.getAppPath(), 'preload.js')
		},
		fullscreenable: true
	});
	const indexUrl = format({
		pathname: join(app.getAppPath(), './index.html'),
		protocol: 'file', slashes: true
	});
	gameWindow.loadURL(indexUrl);
	gameWindow.removeMenu();
	gameWindow.on('close', function () {
		if (!gameWindow.isDestroyed()) gameWindow.webContents.send('asynchronous-message', 'closeWindow');
	});
	gameWindow.on('closed', () => { gameWindow = null; });
}

ipcMain.handle('app:launchGame', async () => {
	if (gameWindow && !gameWindow.isDestroyed()) {
		gameWindow.focus();
		if (loaderWindow && !loaderWindow.isDestroyed()) loaderWindow.close();
		return { ok: true };
	}
	try { if (ML && typeof ML.loadPlugins === 'function') ML.loadPlugins(); }
	catch (e) { console.error('[壳] 加载插件失败', e); }
	createGameWindow();
	gameWindow.webContents.once('did-finish-load', () => {
		if (loaderWindow && !loaderWindow.isDestroyed()) loaderWindow.close();
	});
	return { ok: true };
});

app.on('ready', () => {
	createLoaderWindow();
	try {
		globalShortcut.register('F10', () => createLoaderWindow());
	} catch (e) {  }
});

app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (e) {} });

app.on('browser-window-created', (_event, window) => {
	ensureRemoteInitialized();
	enable(window.webContents);
	window.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url);
		return { action: 'deny' };
	});
});

app.on('window-all-closed', () => { app.quit(); });

ipcMain.handle('electron:quit', async () => { app.quit(); });
ipcMain.handle('electron:returnSingleInstanceLock', async () => app.requestSingleInstanceLock());
ipcMain.handle('shell:openNewWindow', async (event, url) => { shell.openExternal(url); });
ipcMain.handle('path:returnRelativePath', async (event, from, to) => relative(from, to));
ipcMain.on('getAppPath', async (event) => { event.returnValue = app.getAppPath(); });
ipcMain.on('encrypt', async (event, text) => { event.returnValue = safeStorage.encryptString(text); });
ipcMain.on('decrypt', async (event, encryptedBuffer) => { event.returnValue = safeStorage.decryptString(encryptedBuffer); });

ipcMain.handle('saveFile', async (event, { title, dataUrl }) => {
	const result = await dialog.showSaveDialog(activeWindow(), {
		title, filters: [{ name: 'PNG画像', extensions: 'png' }], defaultPath: 'photo.png'
	});
	if (result.canceled) return null;
	const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
	writeFileSync(result.filePath, base64Data, { encoding: 'base64' });
	return result.filePath;
});

ipcMain.handle('setFullScreen', async (event, isFullScreen) => { if (gameWindow) gameWindow.setFullScreen(isFullScreen); });

ipcMain.handle('patch:apply', async (event, target, gamePath, patchFile) => {
	if (existsSync(patchFile)) {
		var fsExtra = require('fs-extra');
		if ('asar' != target) {
			const AdmZip = require('adm-zip');
			new AdmZip(patchFile).extractAllTo(target + '/update_tmp', true);
			fsExtra.copySync(target + '/update_tmp/', target + '/');
			fsExtra.removeSync(target + '/update_tmp');
			fsExtra.removeSync(patchFile);
			return true;
		}
		return false;
	}
	return false;
});

ipcMain.handle('dialog:showDialog', async (event, options) =>
	dialog.showMessageBoxSync(activeWindow(), {
		type: options.type, buttons: options.buttons, title: options.title,
		message: options.message, detail: options.detail,
		defaultId: options.defaultID, cancelId: options.cancelId
	})
);

ipcMain.handle('debug:readSubDir', async (event, dirPath) => {
	let results = [];
	const walk = (currentPath) => {
		let files = readdirSync(currentPath).map(file => join(currentPath, file));
		files.forEach(fullPath => { results.push(fullPath); if (statSync(fullPath).isDirectory()) walk(fullPath); });
	};
	walk(dirPath);
	return results;
});

ipcMain.handle('debug:toggleDevTools', async () => { if (gameWindow) gameWindow.webContents.toggleDevTools(); });
ipcMain.handle('debug:isMuteAudio', async (event, mute) => {
	if (!gameWindow) return false;
	if (mute !== undefined) gameWindow.webContents.audioMuted = mute;
	else return await gameWindow.webContents.audioMuted;
});
ipcMain.handle('debug:captureWindow', async (event, x, y, width, height) => {
	const screenshot = await gameWindow.capturePage({ x, y, width, height });
	return screenshot.resize({ ...scSize }).toDataURL();
});
ipcMain.handle('debug:registerHotKey', async (event, accelerator) => {
	globalShortcut.register(accelerator, () => { if (gameWindow) { gameWindow.reload(); gameWindow.focus(); } });
});

ipcMain.handle('steamworks:activateAchievement', async (event, achievementId) => {
	if (steamworksClient) steamworksClient.achievement.activate(achievementId);
});
ipcMain.handle('steamworks:triggerScreenshot', async (event, x, y, width, height) => {
	if (steamworksClient) await triggerScreenshot(x, y, width, height);
});
ipcMain.on('getSaveKey', (event) => {
	event.returnValue = steamworksClient ? steamworksClient.localplayer.getSteamId().steamId32 : 1;
});
ipcMain.handle('steamworks:isAppActivated', async () => steamworksClient ? steamworksClient.apps.isSubscribed() : true);

ipcMain.handle('log', async (event, args) => {
	writeFileSync(resolve('./log.txt'), args.join(' ') + EOL, { encoding: 'utf-8', flag: 'a' });
});
