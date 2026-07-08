import { normResponse } from './core/utils.js';
import { desktopApi } from './core/api.js';
import { createTaskRunner } from './core/taskRunner.js';
import { createModal } from './ui/modal.js';
import { createNavigation } from './ui/navigation.js';
import { createModsManager } from './features/mods/index.js';
import { createBackupsManager } from './features/backups/index.js';

const { askConfirm } = createModal();
const { runTask, dispose, isBusy } = createTaskRunner({ askConfirm });

const modsManager = createModsManager({ askConfirm });
const backupsManager = createBackupsManager({ askConfirm, runTask, isBusy });

const navigation = createNavigation({
	onMods: modsManager.refreshMods,
	onBackups: backupsManager.refreshBackups
});

window.switchPage = navigation.switchPage;

modsManager.bindImportButton();
modsManager.bindDropImport();
backupsManager.bindEvents();
navigation.bindNavButtons();

const rebuildRepoLink = document.getElementById('rebuild-repo-link');
if (rebuildRepoLink) {
	rebuildRepoLink.onclick = (e) => {
		e.preventDefault();
		desktopApi.openExternal('https://github.com/shouennyou/DevilConnection_ModLoader');
	};
}

document.getElementById('btn-start').onclick = async () => {
	const btn = document.getElementById('btn-start');
	btn.disabled = true;
	btn.textContent = ' 正在启动... ';
	const res = normResponse(await desktopApi.launchGame());
	if (!res.ok) {
		btn.disabled = false;
		btn.textContent = ' 启动游戏 ';
		await askConfirm({ title: '启动失败', message: res.message || '无法启动游戏' });
	}
};

window.addEventListener('beforeunload', () => { dispose(); });

window.onload = async () => {
	await backupsManager.initBackupSystem();
	await navigation.switchPage('home');
};
