export function renderAsarInstalledCard(sizeText) {
	return `
<div class="card flex items-center justify-between px-6 py-4 bg-white">
	<div class="flex items-center gap-4">
		<div class="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
			<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
		</div>
		<div>
			<div class="font-bold text-slate-700">游戏本体 app.bak.asar <span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 text-[10px] ml-1">已加载</span></div>
			<div class="text-[10px] text-slate-400 mt-0.5">作为最低优先级加载，不参与模组排序</div>
		</div>
	</div>
</div>
	`;
}

export function renderAsarMissingCard() {
	return `
<div class="card flex items-center justify-between px-6 py-4 bg-rose-50 border-rose-100">
	<div class="flex items-center gap-4">
		<div class="w-10 h-10 rounded-xl bg-rose-100 text-rose-500 flex items-center justify-center">
			<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
		</div>
		<div>
			<div class="font-bold text-rose-700">app.asar <span class="px-1.5 py-0.5 rounded bg-rose-200 text-rose-700 text-[10px] ml-1">未检测到</span></div>
			<div class="text-[10px] text-rose-400 mt-0.5">需要导入核心 app.asar 才能正常加载模组</div>
		</div>
	</div>
</div>
	`;
}

export function renderEmptyMods() {
	return '<div class="p-10 text-slate-300 text-center italic text-xs">暂无模组</div>';
}

export function renderModsLoadError(message) {
	return `<div class="p-6 text-rose-500 text-center text-xs">无法加载模组: ${message}</div>`;
}

import { escapeHtml } from '../../core/utils.js';

const NO_META_WARN = '此模组未尝试兼容本加载器!可能会有异常表现!';

export function renderModRow(mod, idx, sizeText) {
	const versionBadge = mod.versionText
		? `<span class="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[10px] font-mono shrink-0">${escapeHtml(mod.versionText)}</span>`
		: '';
	// 版本状态徽章：无更新渠道→橘黄「无法自动更新」；有渠道→占位，前端异步检测后填色（检测到更新/已是最新）
	const statusBadge = mod.hasUpdateChannel
		? `<span data-mod-status class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 text-[10px] shrink-0">检测中…</span>`
		: `<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 text-[10px] shrink-0">无法自动更新</span>`;
	const descLine = mod.hasMeta
		? (mod.description ? `<div class="text-[10px] md:text-[11px] text-slate-400 mt-0.5 truncate">${escapeHtml(mod.description)}</div>` : '')
		: `<div class="text-[10px] md:text-[11px] text-amber-600 mt-0.5 truncate">${NO_META_WARN}</div>`;
	return `
<div class="flex items-center gap-3 p-4 bg-white hover:bg-slate-50 group transition-colors duration-150" data-idx="${idx}">
	<div class="drag-handle">
		<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path></svg>
	</div>
	<div class="flex-1 min-w-0">
		<div class="flex items-center gap-2 min-w-0">
			<span class="font-bold truncate text-slate-700 text-sm md:text-base ${mod.disabled ? 'opacity-50' : ''}">${escapeHtml(mod.displayName || mod.name)}</span>
			${versionBadge}
			${statusBadge}
		</div>
		${descLine}
		<div class="text-[9px] md:text-[10px] text-slate-400 mt-0.5 uppercase tracking-tighter">
			优先级 ${(idx + 1).toString().padStart(3, '0')} · ${sizeText} ${mod.disabled ? '· 已禁用' : ''}${mod.pendingToggle ? ' · 下次启动生效' : ''}
		</div>
	</div>
	<div class="flex gap-2 shrink-0 sm:opacity-0 group-hover:opacity-100">
		${mod.hasUpdateChannel ? '<button data-a="update" class="mod-btn px-2 py-1 text-[10px] font-bold text-sky-600 hover:bg-white rounded border border-slate-100 transition-none">更新</button>' : ''}
		${mod.hasConfig ? '<button data-a="config" class="mod-btn px-2 py-1 text-[10px] font-bold text-accent hover:bg-white rounded border border-slate-100 transition-none">配置</button>' : ''}
		<button data-a="toggle" class="mod-btn px-2 py-1 text-[10px] font-bold ${mod.disabled ? 'text-emerald-600' : 'text-amber-600'} hover:bg-white rounded border border-slate-100 transition-none">${mod.disabled ? '启用' : '禁用'}</button>
		<button data-a="rename" class="mod-btn px-2 py-1 text-[10px] font-bold text-indigo-600 hover:bg-white rounded border border-slate-100 transition-none">改名</button>
		<button data-a="delete" class="mod-btn px-2 py-1 text-[10px] font-bold text-rose-500 hover:bg-white rounded border border-slate-100 transition-none">删除</button>
	</div>
</div>
	`;
}
