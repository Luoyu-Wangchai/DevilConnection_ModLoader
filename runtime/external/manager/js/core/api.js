export const desktopApi = {
	launchGame() {
		return window.desktopUI.launchGame();
	},

	getModsData() {
		return window.desktopUI.getModsData();
	},
	toggleModDisabled(idx, expectName) {
		return window.desktopUI.toggleModDisabled(idx, expectName);
	},
	isGameRunning() {
		return window.desktopUI.isGameRunning();
	},
	deleteMod(idx, expectName) {
		return window.desktopUI.deleteMod(idx, expectName);
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
	checkModUpdate(idx, expectName) {
		return window.desktopUI.checkModUpdate(idx, expectName);
	},
	updateMod(idx, expectName) {
		return window.desktopUI.updateMod(idx, expectName);
	},
	onUpdateModProgress(callback) {
		return window.desktopUI.onUpdateModProgress(callback);
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
	getModConfig(idx, expectName) {
		return window.desktopUI.getModConfig(idx, expectName);
	},
	saveModConfig(idx, expectName, values) {
		return window.desktopUI.saveModConfig(idx, expectName, values);
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
	downloadAndRunInstaller(beta) {
		return window.desktopUI.downloadAndRunInstaller(beta);
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
	restoreBackup(name) {
		return window.desktopUI.restoreBackup(name);
	},
	renameBackup(name, nextLabel) {
		return window.desktopUI.renameBackup(name, nextLabel);
	},
	toggleBackupLock(name) {
		return window.desktopUI.toggleBackupLock(name);
	},
	exportBackupFile(name) {
		return window.desktopUI.exportBackupFile(name);
	},
	deleteBackup(name) {
		return window.desktopUI.deleteBackup(name);
	},
	backupNow(finalName) {
		return window.desktopUI.backupNow(finalName);
	},
	importBackupFromBuffer(fileName, bytes) {
		return window.desktopUI.importBackupFromBuffer(fileName, bytes);
	},
	exportCurrentSave() {
		return window.desktopUI.exportCurrentSave();
	}
};
