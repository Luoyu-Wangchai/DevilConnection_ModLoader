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

// 上游原作者仓库（致谢用，指向 fork 来源）
const rebuildRepoLink = document.getElementById('rebuild-repo-link');
if (rebuildRepoLink) {
	rebuildRepoLink.onclick = (e) => {
		e.preventDefault();
		desktopApi.openExternal('https://github.com/shouennyou/DevilConnection_ModLoader');
	};
}

// 本 Fork 版本信息（版本号/仓库单一真源 = version.json，经 Manager.js 读出后注入 UI）
let appInfo = { displayVersion: 'RV1.2.2', repoUrl: 'https://github.com/Luoyu-Wangchai/DevilConnection_ModLoader' };
async function initAppInfo() {
	try {
		const res = normResponse(await desktopApi.getAppInfo());
		if (res.ok && res.data) appInfo = { ...appInfo, ...res.data };
	} catch (e) {}
	const titleEl = document.getElementById('app-title');
	if (titleEl) titleEl.textContent = `恶魔连结模组管理器 ${appInfo.displayVersion}`;
	// 所有「Fork rebuild」字样 → 跳本 Fork 仓库
	document.querySelectorAll('.js-fork-link').forEach(a => {
		a.onclick = (e) => { e.preventDefault(); desktopApi.openExternal(appInfo.repoUrl); };
	});
}

// 检查更新：去 GitHub release 比对版本
const cardCheckUpdate = document.getElementById('card-check-update');
if (cardCheckUpdate) {
	const label = document.getElementById('check-update-label');
	const icon = document.getElementById('check-update-icon');
	let checking = false;
	cardCheckUpdate.onclick = async () => {
		if (checking) return;
		checking = true;
		const restore = () => { checking = false; if (label) label.textContent = '检查更新'; if (icon) icon.classList.remove('animate-spin'); };
		if (label) label.textContent = '正在检查...';
		if (icon) icon.classList.add('animate-spin');
		const res = normResponse(await desktopApi.checkForUpdate());
		restore();
		if (!res.ok) {
			await askConfirm({ title: '检查更新失败', message: res.message || '无法连接 GitHub，请检查网络后重试。' });
			return;
		}
		const d = res.data || {};
		if (d.hasUpdate && d.latest) {
			const go = await askConfirm({
				title: `发现新版本 ${d.latest}`,
				message: `当前版本 ${d.current}，最新版本 ${d.latest}。是否前往 GitHub 下载？`
			});
			if (go) desktopApi.openExternal(d.url || appInfo.repoUrl + '/releases');
		} else {
			await askConfirm({
				title: '已是最新版本',
				message: d.note ? `当前版本 ${d.current}（${d.note}）。` : `当前版本 ${d.current} 已是最新。`
			});
		}
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
	await initAppInfo();
	await backupsManager.initBackupSystem();
	await navigation.switchPage('home');
};
