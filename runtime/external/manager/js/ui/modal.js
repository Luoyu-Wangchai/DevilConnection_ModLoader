export function createModal() {
	const modalWrap = document.getElementById('modal-container');
	const dialogBox = document.getElementById('confirm-dialog');

	function askConfirm({
		title,
		message,
		hasInput = false,
		defaultValue = '',
		placeholder = ''
	}) {
		return new Promise(resolve => {
			modalWrap.classList.remove('hidden');
			setTimeout(() => {
				dialogBox.classList.add('scale-100', 'opacity-100');
				dialogBox.classList.remove('scale-95', 'opacity-0');
			}, 10);

			document.getElementById('confirm-title').textContent = title;
			document.getElementById('confirm-message').textContent = message;

			const inputWrap = document.getElementById('confirm-input-wrap');
			const input = document.getElementById('confirm-input');
			if (hasInput) {
				inputWrap.classList.remove('hidden');
				input.value = defaultValue;
				input.placeholder = placeholder || '';
				setTimeout(() => input.focus(), 50);
			} else {
				inputWrap.classList.add('hidden');
			}

			const cleanup = (val) => {
				dialogBox.classList.remove('scale-100', 'opacity-100');
				dialogBox.classList.add('scale-95', 'opacity-0');
				setTimeout(() => modalWrap.classList.add('hidden'), 200);
				resolve(val);
			};

			document.getElementById('confirm-ok').onclick = () => cleanup(hasInput ? input.value : true);
			document.getElementById('confirm-cancel').onclick = () => cleanup(null);
		});
	}

	return { askConfirm };
}
