import { desktopApi } from '../core/api.js';
import { normResponse, escapeHtml } from '../core/utils.js';

const FIELD_INPUT_CLS =
	'w-full bg-slate-50 border border-transparent rounded-xl px-4 py-2.5 text-sm ' +
	'focus:bg-white focus:border-accent/40 focus:ring-4 ring-accent/10 outline-none transition-all';

function el(html) {
	const t = document.createElement('template');
	t.innerHTML = html.trim();
	return t.content.firstElementChild;
}

const EYE_ON = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>';
const EYE_OFF = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>';

function buildField(field, value) {
	const wrap = el('<div class="space-y-1.5"></div>');
	const labelRow = el(
		`<div class="flex items-center gap-1.5">
			<label class="text-xs font-bold text-slate-600">${escapeHtml(field.label || field.key)}</label>
			${field.required ? '<span class="text-rose-400 text-xs leading-none">*</span>' : ''}
		</div>`
	);
	wrap.appendChild(labelRow);

	let getVal, input;

	if (field.type === 'toggle') {
		const on0 = !!value;
		const sw = el(
			`<button type="button" class="switch ${on0 ? 'switch-on' : 'switch-off'}">
				<span class="switch-dot ${on0 ? 'switch-dot-on' : 'switch-dot-off'}"></span>
			</button>`
		);
		let on = on0;
		sw.onclick = () => {
			on = !on;
			sw.className = 'switch ' + (on ? 'switch-on' : 'switch-off');
			sw.firstElementChild.className = 'switch-dot ' + (on ? 'switch-dot-on' : 'switch-dot-off');
		};
		wrap.appendChild(sw);
		getVal = () => on;
		input = sw;
	} else if (field.type === 'select') {
		input = el(`<select class="${FIELD_INPUT_CLS} cursor-pointer"></select>`);
		for (const opt of (field.options || [])) {
			const o = document.createElement('option');
			o.value = opt.value;
			o.textContent = opt.label !== undefined ? opt.label : opt.value;
			if (String(opt.value) === String(value)) o.selected = true;
			input.appendChild(o);
		}
		wrap.appendChild(input);
		getVal = () => input.value;
	} else if (field.type === 'password') {
		const box = el('<div class="relative"></div>');
		input = el(`<input type="password" class="${FIELD_INPUT_CLS} pr-11" spellcheck="false">`);
		input.value = value == null ? '' : String(value);
		input.placeholder = field.placeholder || '';
		const eye = el('<button type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-accent"></button>');
		eye.innerHTML = EYE_ON;
		eye.onclick = () => {
			const show = input.type === 'password';
			input.type = show ? 'text' : 'password';
			eye.innerHTML = show ? EYE_OFF : EYE_ON;
		};
		box.appendChild(input);
		box.appendChild(eye);
		wrap.appendChild(box);
		getVal = () => input.value;
	} else {
		input = el(`<input type="${field.type === 'number' ? 'number' : 'text'}" class="${FIELD_INPUT_CLS}" spellcheck="false">`);
		input.value = value == null ? '' : String(value);
		input.placeholder = field.placeholder || '';
		wrap.appendChild(input);
		// number 留空返回 ''（而非 Number('')===0），否则必填校验 String(0).trim() 恒通过、必填数字可被留空保存
		getVal = () => {
			if (field.type !== 'number') return input.value;
			return input.value.trim() === '' ? '' : Number(input.value);
		};
	}

	const help = el(`<p class="text-[10px] leading-relaxed text-slate-400">${escapeHtml(field.help || '')}</p>`);
	if (field.help) wrap.appendChild(help);
	const invalidMsg = el('<p class="hidden text-[10px] font-bold text-rose-500">此项必填</p>');
	wrap.appendChild(invalidMsg);

	return {
		root: wrap,
		get: getVal,
		focus: () => { try { input.focus(); } catch (e) {} },
		markInvalid(bad) {
			invalidMsg.classList.toggle('hidden', !bad);
			if (field.type !== 'toggle') {
				input.classList.toggle('ring-4', bad);
				input.classList.toggle('ring-rose-100', bad);
				input.classList.toggle('border-rose-300', bad);
			}
		}
	};
}

export function createConfigModal() {
	async function openConfigModal(idx, modDisplayName, expectName) {
		const res = normResponse(await desktopApi.getModConfig(idx, expectName));
		if (!res.ok) throw new Error(res.message || '读取配置失败');
		const { schema, values } = res.data;

		return new Promise(resolve => {
			const overlay = el(
				'<div class="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4 opacity-0 transition-opacity duration-200"></div>'
			);
			const dialog = el(
				`<div class="bg-white w-full max-w-md rounded-2xl shadow-2xl scale-95 opacity-0 transition-all duration-300 max-h-[85vh] flex flex-col">
					<div class="flex items-start gap-3.5 px-6 pt-6 pb-4">
						<div class="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
						</div>
						<div class="min-w-0 flex-1">
							<h3 class="font-bold text-slate-800 truncate">${escapeHtml(schema.title || modDisplayName || '模组')} · 配置</h3>
							${schema.description ? `<p class="text-[11px] text-slate-400 mt-1 leading-relaxed">${escapeHtml(schema.description)}</p>` : ''}
						</div>
					</div>
					<div data-r="fields" class="px-6 py-1 space-y-4 overflow-y-auto flex-1"></div>
					<div class="flex items-center justify-between gap-2 px-6 py-4 mt-2 border-t border-slate-100">
						<span class="text-[9px] text-slate-300">保存至 plugins/config/</span>
						<div class="flex gap-2">
							<button data-r="cancel" class="px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 rounded-lg">取消</button>
							<button data-r="save" class="bg-accent text-white px-5 py-2 text-sm font-bold rounded-lg shadow-sm hover:brightness-110 active:scale-95 transition-all">保存</button>
						</div>
					</div>
				</div>`
			);
			overlay.appendChild(dialog);
			document.body.appendChild(overlay);

			const fieldsBox = dialog.querySelector('[data-r="fields"]');
			const controls = [];
			for (const f of schema.fields) {
				if (!f || !f.key) continue;
				const c = buildField(f, values[f.key]);
				c.field = f;
				controls.push(c);
				fieldsBox.appendChild(c.root);
			}

			requestAnimationFrame(() => {
				overlay.classList.remove('opacity-0');
				dialog.classList.add('scale-100', 'opacity-100');
				dialog.classList.remove('scale-95', 'opacity-0');
				if (controls[0]) controls[0].focus();
			});

			const close = (saved) => {
				dialog.classList.add('scale-95', 'opacity-0');
				overlay.classList.add('opacity-0');
				setTimeout(() => { overlay.remove(); resolve(saved); }, 200);
				document.removeEventListener('keydown', onKey);
			};
			const onKey = (e) => { if (e.key === 'Escape') close(false); };
			document.addEventListener('keydown', onKey);
			overlay.onclick = (e) => { if (e.target === overlay) close(false); };
			dialog.querySelector('[data-r="cancel"]').onclick = () => close(false);

			const saveBtn = dialog.querySelector('[data-r="save"]');
			saveBtn.onclick = async () => {
				let bad = false;
				for (const c of controls) {
					const empty = c.field.required && String(c.get() == null ? '' : c.get()).trim() === '';
					c.markInvalid(empty);
					if (empty) bad = true;
				}
				if (bad) return;
				const out = {};
				for (const c of controls) out[c.field.key] = c.get();
				saveBtn.disabled = true;
				const r = normResponse(await desktopApi.saveModConfig(idx, expectName, out));
				if (!r.ok) {
					saveBtn.disabled = false;
					saveBtn.textContent = '保存失败';
					saveBtn.classList.add('bg-rose-500');
					setTimeout(() => { saveBtn.textContent = '保存'; saveBtn.classList.remove('bg-rose-500'); saveBtn.disabled = false; }, 1600);
					return;
				}
				saveBtn.textContent = '✓ 已保存';
				saveBtn.classList.remove('bg-accent');
				saveBtn.classList.add('bg-emerald-500');
				setTimeout(() => close(true), 500);
			};
		});
	}

	return { openConfigModal };
}
