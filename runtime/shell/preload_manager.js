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
	toggleModDisabled: (idx) => invoke('mgr:toggleModDisabled', idx),
	renameMod: (idx, name) => invoke('mgr:renameMod', idx, name),
	deleteMod: (idx) => invoke('mgr:deleteMod', idx),
	moveModTo: (oldIndex, newIndex) => invoke('mgr:moveModTo', oldIndex, newIndex),
	importModFromBuffer: (fileName, bytes) => invoke('mgr:importModFromBuffer', fileName, bytes),
	confirmPendingImport: (token) => invoke('mgr:confirmPendingImport', token),
	cancelPendingImport: (token) => invoke('mgr:cancelPendingImport', token),
	getModConfig: (idx) => invoke('mgr:getModConfig', idx),
	saveModConfig: (idx, values) => invoke('mgr:saveModConfig', idx, values),
	openModsFolder: () => invoke('mgr:openModsFolder'),
	openExternal: (url) => invoke('mgr:openExternal', url),
	getAppInfo: () => invoke('mgr:getAppInfo'),
	checkForUpdate: () => invoke('mgr:checkForUpdate'),

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
