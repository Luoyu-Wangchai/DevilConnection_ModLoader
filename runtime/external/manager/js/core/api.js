export const desktopApi = {
	onTaskProgress(callback) {
		return window.desktopUI.onTaskProgress(callback);
	},
	launchGame() {
		return window.desktopUI.launchGame();
	},

	getModsData() {
		return window.desktopUI.getModsData();
	},
	toggleModDisabled(idx) {
		return window.desktopUI.toggleModDisabled(idx);
	},
	isGameRunning() {
		return window.desktopUI.isGameRunning();
	},
	deleteMod(idx) {
		return window.desktopUI.deleteMod(idx);
	},
	moveModTo(oldIndex, newIndex) {
		return window.desktopUI.moveModTo(oldIndex, newIndex);
	},
	autoFixOrder() {
		return window.desktopUI.autoFixOrder();
	},
	importModFromBuffer(fileName, bytes) {
		return window.desktopUI.importModFromBuffer(fileName, bytes);
	},
	confirmPendingImport(token) {
		return window.desktopUI.confirmPendingImport(token);
	},
	cancelPendingImport(token) {
		return window.desktopUI.cancelPendingImport(token);
	},
	checkModUpdate(idx) {
		return window.desktopUI.checkModUpdate(idx);
	},
	updateMod(idx) {
		return window.desktopUI.updateMod(idx);
	},
	getStoreList() {
		return window.desktopUI.getStoreList();
	},
	storeInstall(repo, tag) {
		return window.desktopUI.storeInstall(repo, tag);
	},
	storeHistory(repo) {
		return window.desktopUI.storeHistory(repo);
	},
	onStoreProgress(callback) {
		return window.desktopUI.onStoreProgress(callback);
	},
	getModConfig(idx) {
		return window.desktopUI.getModConfig(idx);
	},
	saveModConfig(idx, values) {
		return window.desktopUI.saveModConfig(idx, values);
	},
	openModsFolder() {
		return window.desktopUI.openModsFolder();
	},
	openExternal(url) {
		return window.desktopUI.openExternal(url);
	},
	getAppInfo() {
		return window.desktopUI.getAppInfo();
	},
	checkForUpdate(beta) {
		return window.desktopUI.checkForUpdate(beta);
	},
	downloadAndApplyUpdate(beta) {
		return window.desktopUI.downloadAndApplyUpdate(beta);
	},
	cancelUpdate() {
		return window.desktopUI.cancelUpdate();
	},
	onUpdateProgress(callback) {
		return window.desktopUI.onUpdateProgress(callback);
	},

	autoBackup(settings) {
		return window.desktopUI.autoBackup(settings);
	},
	getBackupsData() {
		return window.desktopUI.getBackupsData();
	},
	restoreBackup(name, taskId) {
		return window.desktopUI.restoreBackup(name, taskId);
	},
	renameBackup(name, nextLabel) {
		return window.desktopUI.renameBackup(name, nextLabel);
	},
	toggleBackupLock(name) {
		return window.desktopUI.toggleBackupLock(name);
	},
	exportBackupFile(name, taskId) {
		return window.desktopUI.exportBackupFile(name, taskId);
	},
	deleteBackup(name) {
		return window.desktopUI.deleteBackup(name);
	},
	backupNow(taskId, finalName) {
		return window.desktopUI.backupNow(taskId, finalName);
	},
	importBackupFromBuffer(fileName, bytes, taskId) {
		return window.desktopUI.importBackupFromBuffer(fileName, bytes, taskId);
	},
	exportCurrentSave(taskId) {
		return window.desktopUI.exportCurrentSave(taskId);
	}
};
