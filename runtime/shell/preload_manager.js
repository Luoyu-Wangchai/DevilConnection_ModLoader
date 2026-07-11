const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('desktopUI', {
	onTaskProgress(callback) {
		const listener = (_e, payload) => callback(payload);
		ipcRenderer.on('mgr:taskProgress', listener);
		return () => ipcRenderer.removeListener('mgr:taskProgress', listener);
	},
	launchGame: () => invoke('app:launchGame'),

	getModsData: () => invoke('mgr:getModsData'),
	isGameRunning: () => invoke('mgr:isGameRunning'),
	toggleModDisabled: (idx) => invoke('mgr:toggleModDisabled', idx),
	deleteMod: (idx) => invoke('mgr:deleteMod', idx),
	moveModTo: (oldIndex, newIndex) => invoke('mgr:moveModTo', oldIndex, newIndex),
	autoFixOrder: () => invoke('mgr:autoFixOrder'),
	importModFromBuffer: (fileName, bytes) => invoke('mgr:importModFromBuffer', fileName, bytes),
	confirmPendingImport: (token) => invoke('mgr:confirmPendingImport', token),
	cancelPendingImport: (token) => invoke('mgr:cancelPendingImport', token),
	checkModUpdate: (idx) => invoke('mgr:checkModUpdate', idx),
	updateMod: (idx) => invoke('mgr:updateMod', idx),
	getStoreList: () => invoke('mgr:getStoreList'),
	storeInstall: (repo, tag) => invoke('mgr:storeInstall', repo, tag),
	storeHistory: (repo) => invoke('mgr:storeHistory', repo),
	getModConfig: (idx) => invoke('mgr:getModConfig', idx),
	saveModConfig: (idx, values) => invoke('mgr:saveModConfig', idx, values),
	openModsFolder: () => invoke('mgr:openModsFolder'),
	openExternal: (url) => invoke('mgr:openExternal', url),
	getAppInfo: () => invoke('mgr:getAppInfo'),
	checkForUpdate: (beta) => invoke('mgr:checkForUpdate', beta),
	downloadAndApplyUpdate: (beta) => invoke('mgr:downloadAndApplyUpdate', beta),
	cancelUpdate: () => invoke('mgr:cancelUpdate'),
	onUpdateProgress(callback) {
		const listener = (_e, payload) => callback(payload);
		ipcRenderer.on('mgr:updateProgress', listener);
		return () => ipcRenderer.removeListener('mgr:updateProgress', listener);
	},

	autoBackup: (settings) => invoke('mgr:autoBackup', settings),
	getBackupsData: () => invoke('mgr:getBackupsData'),
	restoreBackup: (name, taskId) => invoke('mgr:restoreBackup', name, taskId),
	renameBackup: (name, nextLabel) => invoke('mgr:renameBackup', name, nextLabel),
	toggleBackupLock: (name) => invoke('mgr:toggleBackupLock', name),
	exportBackupFile: (name, taskId) => invoke('mgr:exportBackupFile', name, taskId),
	deleteBackup: (name) => invoke('mgr:deleteBackup', name),
	backupNow: (taskId, finalName) => invoke('mgr:backupNow', taskId, finalName),
	importBackupFromBuffer: (fileName, bytes, taskId) =>
		invoke('mgr:importBackupFromBuffer', fileName, bytes, taskId),
	exportCurrentSave: (taskId) => invoke('mgr:exportCurrentSave', taskId)
});
