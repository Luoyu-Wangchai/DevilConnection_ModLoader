const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('desktopUI', {
	launchGame: () => invoke('app:launchGame'),

	getModsData: () => invoke('mgr:getModsData'),
	isGameRunning: () => invoke('mgr:isGameRunning'),
	// 模组操作带 expectName（磁盘规范名）做 idx 身份复核，防列表过期时错位操作到别的模组
	toggleModDisabled: (idx, expectName) => invoke('mgr:toggleModDisabled', idx, expectName),
	deleteMod: (idx, expectName) => invoke('mgr:deleteMod', idx, expectName),
	moveModTo: (oldIndex, newIndex) => invoke('mgr:moveModTo', oldIndex, newIndex),
	autoFixOrder: () => invoke('mgr:autoFixOrder'),
	importModFromBuffer: (fileName, bytes) => invoke('mgr:importModFromBuffer', fileName, bytes),
	confirmPendingImport: (token) => invoke('mgr:confirmPendingImport', token),
	cancelPendingImport: (token) => invoke('mgr:cancelPendingImport', token),
	checkModUpdate: (idx, expectName) => invoke('mgr:checkModUpdate', idx, expectName),
	updateMod: (idx, expectName) => invoke('mgr:updateMod', idx, expectName),
	onUpdateModProgress(callback) {
		const listener = (_e, payload) => callback(payload);
		ipcRenderer.on('mgr:updateModProgress', listener);
		return () => ipcRenderer.removeListener('mgr:updateModProgress', listener);
	},
	getStoreList: () => invoke('mgr:getStoreList'),
	storeInstall: (repo, tag) => invoke('mgr:storeInstall', repo, tag),
	storeHistory: (repo) => invoke('mgr:storeHistory', repo),
	onStoreProgress(callback) {
		const listener = (_e, payload) => callback(payload);
		ipcRenderer.on('mgr:storeProgress', listener);
		return () => ipcRenderer.removeListener('mgr:storeProgress', listener);
	},
	getModConfig: (idx, expectName) => invoke('mgr:getModConfig', idx, expectName),
	saveModConfig: (idx, expectName, values) => invoke('mgr:saveModConfig', idx, expectName, values),
	openModsFolder: () => invoke('mgr:openModsFolder'),
	openExternal: (url) => invoke('mgr:openExternal', url),
	getAppInfo: () => invoke('mgr:getAppInfo'),
	checkForUpdate: (beta) => invoke('mgr:checkForUpdate', beta),
	downloadAndApplyUpdate: (beta) => invoke('mgr:downloadAndApplyUpdate', beta),
	downloadAndRunInstaller: (beta) => invoke('mgr:downloadAndRunInstaller', beta),
	cancelUpdate: () => invoke('mgr:cancelUpdate'),
	onUpdateProgress(callback) {
		const listener = (_e, payload) => callback(payload);
		ipcRenderer.on('mgr:updateProgress', listener);
		return () => ipcRenderer.removeListener('mgr:updateProgress', listener);
	},

	autoBackup: (settings) => invoke('mgr:autoBackup', settings),
	getBackupsData: () => invoke('mgr:getBackupsData'),
	restoreBackup: (name) => invoke('mgr:restoreBackup', name),
	renameBackup: (name, nextLabel) => invoke('mgr:renameBackup', name, nextLabel),
	toggleBackupLock: (name) => invoke('mgr:toggleBackupLock', name),
	exportBackupFile: (name) => invoke('mgr:exportBackupFile', name),
	deleteBackup: (name) => invoke('mgr:deleteBackup', name),
	backupNow: (finalName) => invoke('mgr:backupNow', finalName),
	importBackupFromBuffer: (fileName, bytes) => invoke('mgr:importBackupFromBuffer', fileName, bytes),
	exportCurrentSave: () => invoke('mgr:exportCurrentSave')
});
