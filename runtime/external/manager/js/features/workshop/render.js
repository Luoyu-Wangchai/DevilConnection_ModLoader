import { escapeHtml } from '../../core/utils.js';

export function renderWorkshopLoading() {
	return '<div class="p-10 text-center text-slate-400">正在连接工坊...</div>';
}

export function renderWorkshopError(message) {
	return `
<div class="p-10 text-center">
	<div class="text-rose-500 text-sm font-bold mb-1">无法连接工坊</div>
	<div class="text-slate-400 text-xs">${escapeHtml(message || '请检查网络后点击「刷新列表」重试')}</div>
</div>`;
}

export function renderWorkshopEmpty() {
	return '<div class="p-10 text-slate-300 text-center italic text-xs">工坊暂无收录模组</div>';
}

// 状态徽章：与模组页同一配色语言（amber=可更新 emerald=最新 sky=本地超前 slate=中性）
function statusBadge(mod) {
	switch (mod.status) {
		case 'outdated':
			return `<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 text-[10px] shrink-0">可更新 ${escapeHtml(mod.remoteDisplay || '')}</span>`;
		case 'current':
			return '<span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 text-[10px] shrink-0">已是最新版本</span>';
		case 'ahead':
			return '<span class="px-1.5 py-0.5 rounded bg-sky-50 text-sky-600 text-[10px] shrink-0">本地版本更新</span>';
		case 'notinstalled':
			return `<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] shrink-0">未安装${mod.remoteDisplay ? ' · 最新 ' + escapeHtml(mod.remoteDisplay) : ''}</span>`;
		case 'noRelease':
			return '<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 text-[10px] shrink-0">暂无发布</span>';
		default:
			return '<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 text-[10px] shrink-0">版本未知</span>';
	}
}

export function renderStoreRow(mod, i, gameRunning) {
	const localBadge = mod.installed && mod.localDisplay
		? `<span class="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[10px] font-mono shrink-0">本地 ${escapeHtml(mod.localDisplay)}</span>`
		: '';
	const disabledChip = (mod.installed && mod.disabled)
		? '<span class="px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 text-[10px] shrink-0">已禁用</span>'
		: '';
	const canRelease = mod.status !== 'noRelease';
	let mainBtn = '';
	if (canRelease && !mod.installed) {
		mainBtn = `<button data-a="install" class="btn-primary !px-4 !py-1.5 text-xs whitespace-nowrap${gameRunning ? ' opacity-40' : ''}">下载</button>`;
	} else if (mod.status === 'outdated') {
		mainBtn = `<button data-a="install" class="btn-primary !px-4 !py-1.5 text-xs whitespace-nowrap${gameRunning ? ' opacity-40' : ''}">更新</button>`;
	}
	const historyBtn = mod.repo
		? `<button data-a="history" class="btn-secondary !px-3 !py-1.5 text-xs whitespace-nowrap">历史版本</button>`
		: '';
	const ghBtn = mod.repo
		? `<button data-a="github" title="打开 GitHub 页面" class="btn-secondary !px-2.5 !py-1.5 text-xs"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg></button>`
		: '';
	return `
<div class="p-4 bg-white hover:bg-slate-50 transition-colors duration-150" data-store-idx="${i}">
	<div class="flex items-center gap-3">
		<div class="flex-1 min-w-0">
			<div class="flex items-center gap-2 min-w-0 flex-wrap">
				<span class="font-bold text-slate-700 truncate">${escapeHtml(mod.name)}</span>
				${localBadge}
				${statusBadge(mod)}
				${disabledChip}
			</div>
			<div class="text-[10px] md:text-[11px] text-slate-400 mt-0.5 truncate">${escapeHtml(mod.desc || '')}</div>
			<div class="text-[10px] text-slate-300 mt-0.5">作者：${escapeHtml(mod.author || '未知')}</div>
		</div>
		<div class="flex items-center gap-2 shrink-0">
			${mainBtn}
			${historyBtn}
			${ghBtn}
		</div>
	</div>
	<div data-history-panel class="hidden mt-3 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3"></div>
</div>`;
}

export function renderHistoryLoading() {
	return '<div class="text-slate-400 text-xs py-2 text-center">正在获取历史版本...</div>';
}

export function renderHistoryError(message) {
	return `<div class="text-rose-500 text-xs py-2 text-center">${escapeHtml(message || '获取失败')}</div>`;
}

export function renderHistoryList(releases, gameRunning) {
	if (!releases || !releases.length) return '<div class="text-slate-400 text-xs py-2 text-center">该模组暂无历史版本</div>';
	const rows = releases.map(r => {
		const pre = r.prerelease ? '<span class="px-1 py-0.5 rounded bg-amber-100 text-amber-600 text-[9px] ml-1">测试版</span>' : '';
		const btn = r.hasAsar
			? `<button data-tag="${escapeHtml(r.tag)}" class="btn-secondary !px-3 !py-1 text-[11px] whitespace-nowrap${gameRunning ? ' opacity-40' : ''}">安装此版本</button>`
			: '<span class="text-[10px] text-slate-300">无安装包</span>';
		return `
<div class="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100 last:border-b-0">
	<div class="min-w-0 flex items-center">
		<span class="font-mono text-xs text-slate-600">${escapeHtml(r.tag || '')}</span>${pre}
		<span class="text-[10px] text-slate-300 ml-2">${escapeHtml(r.date || '')}</span>
	</div>
	${btn}
</div>`;
	}).join('');
	return `<div class="text-[10px] text-slate-400 mb-1">选择一个版本安装（选择旧版本即可降级）：</div>${rows}`;
}
