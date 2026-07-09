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
let appInfo = { displayVersion: 'RV1.2.4', repoUrl: 'https://github.com/Luoyu-Wangchai/DevilConnection_ModLoader' };
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

// in-app 自更新：下载进度弹窗 + 可取消，完成后主进程自动重启
async function runAutoUpdate() {
	const modal = document.getElementById('update-modal');
	const bar = document.getElementById('update-modal-bar');
	const pctEl = document.getElementById('update-modal-pct');
	const phaseEl = document.getElementById('update-modal-phase');
	const cancelBtn = document.getElementById('update-modal-cancel');
	let canceled = false;
	modal.classList.remove('hidden');
	bar.style.width = '0%'; pctEl.textContent = '0%'; phaseEl.textContent = '准备中...';
	cancelBtn.disabled = false; cancelBtn.textContent = '取消';
	const off = desktopApi.onUpdateProgress((p) => {
		if (p.text) phaseEl.textContent = p.text;
		const v = Math.max(0, Math.min(100, Math.round(p.pct || 0)));
		bar.style.width = v + '%'; pctEl.textContent = v + '%';
	});
	cancelBtn.onclick = async () => { canceled = true; cancelBtn.disabled = true; cancelBtn.textContent = '正在取消...'; await desktopApi.cancelUpdate(); };
	const res = normResponse(await desktopApi.downloadAndApplyUpdate());
	off();
	if (res.ok && res.data && res.data.applying) {
		phaseEl.textContent = '更新完成，正在重启游戏...';
		bar.style.width = '100%'; pctEl.textContent = '100%';
		// 游戏即将退出并由助手进程重启，保持弹窗
	} else {
		modal.classList.add('hidden');
		if (!canceled) await askConfirm({ title: '更新失败', message: res.message || '更新过程出错，请稍后重试或手动下载。' });
	}
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
			if (d.canAutoUpdate) {
				const go = await askConfirm({
					title: `发现新版本 ${d.latest}`,
					message: `当前 ${d.current}，将自动下载并更新到 ${d.latest}，完成后自动重启游戏。是否继续？`
				});
				if (go) await runAutoUpdate();
			} else {
				const go = await askConfirm({
					title: `发现新版本 ${d.latest}`,
					message: `当前 ${d.current}，最新 ${d.latest}。该版本不支持自动更新，是否前往 GitHub 手动下载？`
				});
				if (go) desktopApi.openExternal(d.url || appInfo.repoUrl + '/releases');
			}
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
