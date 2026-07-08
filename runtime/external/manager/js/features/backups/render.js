export function renderBackupFetchError() {
	return '<div class="p-6 text-center text-rose-400 text-xs">获取失败</div>';
}

export function renderBackupEmpty() {
	return '<div class="p-10 text-center text-slate-300 italic text-xs">暂无备份记录</div>';
}

export function renderBackupRow(item, title, date) {
	return `
<div class="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 hover:bg-slate-50 group gap-2">
	<div class="min-w-0 flex-1 w-full">
		<div class="font-medium text-slate-700 truncate text-sm flex items-center gap-1.5">
			${item.isLocked ? '<svg class="w-3.5 h-3.5 text-amber-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"></path></svg>' : ''}
			${title}
		</div>
		<div class="text-[9px] text-slate-400 mt-0.5">${date} · ${item.sizeText || '未知大小'}</div>
	</div>
	<div class="flex gap-2 w-full sm:w-auto justify-end sm:opacity-0 group-hover:opacity-100">
		<button data-a="restore" class="px-2 py-1 text-[10px] font-bold text-emerald-600 hover:bg-white rounded border border-slate-100">恢复</button>
		<button data-a="rename" class="px-2 py-1 text-[10px] font-bold text-indigo-600 hover:bg-white rounded border border-slate-100">改名</button>
		<button data-a="lock" class="px-2 py-1 text-[10px] font-bold text-amber-600 hover:bg-white rounded border border-slate-100">${item.isLocked ? '解锁' : '锁定'}</button>
		<button data-a="export" class="px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-white rounded border border-slate-100">导出</button>
		<button data-a="delete" class="px-2 py-1 text-[10px] font-bold text-rose-500 hover:bg-white rounded border border-slate-100 disabled:opacity-30 disabled:cursor-not-allowed" ${item.isLocked ? 'disabled' : ''}>删除</button>
	</div>
</div>
	`;
}
