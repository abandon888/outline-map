/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { SwitchButton } from './components/switchButton';
import { InputArea } from './components/inputArea';
import { SymbolKindStr, throttle } from '../utils';
import Searcher from '../services/searcher';
import { TreeNode } from '../models/treeNode';

customElements.define('switch-button', SwitchButton);
customElements.define('input-area', InputArea);


export const QuickNavKey = '1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
export enum Mode {
	Nav = '',
	Normal = '/',
	Regex = '=',
	Fuzzy = '?',
}

const InputContainerHTML = /*html*/`
<div id="input-container">
	<div id="input-area-container">
		<input-area
			name="input-text"
			id="input-area"
			style="height: auto;overflow-y:hidden; display: flex;font-size: var(--vscode-font-size);flex: 1;"
		></input-area>
		<div class="input-controllers" id="inner-controllers">
			<switch-button id="regex-switch" name="regex" icon="regex" highlight
				desc="Regex mode(=)"
			></switch-button>
			<switch-button id="fuzzy-switch" name="fuzzy" icon="zap" highlight
				desc="Fuzzy mode(?)"
			></switch-button>

		</div>
	</div>
	<div class="input-controllers" id="outer-controllers">
		<switch-button id="nav-switch" name="nav"
			icon-off="clear-all" icon-on="search"
			desc="Nav mode, use arrow keys to navigate"
		></switch-button>
		<switch-button id="fold-down-switch" name="fold-down" icon="fold-down" highlight
		desc="fold-down"
	></switch-button>
	<switch-button id="fold-up-switch" name="fold-up" icon="fold-up" highlight
		desc="fold-up"
	></switch-button>
	</div>
</div>
`;

export class Input {
	private inputArea: InputArea;
	private regexSwitch: SwitchButton;
	private fuzzySwitch: SwitchButton;
	private navSwitch: SwitchButton;
	private static mode: Mode = Mode.Nav;
	private searcher: Searcher | null = null;
	private lastSearch = '';
	private quickNavs : Map<string, TreeNode> | null = null;
	constructor() {
		// todo: better tips
		const container = (new DOMParser())
			.parseFromString(InputContainerHTML, 'text/html')
			.body
			.firstElementChild as HTMLDivElement;

		this.inputArea = container.querySelector<InputArea>('#input-area')!;

		this.regexSwitch = container.querySelector<SwitchButton>('#regex-switch')!;
		this.fuzzySwitch = container.querySelector<SwitchButton>('#fuzzy-switch')!;
		this.navSwitch = container.querySelector<SwitchButton>('#nav-switch')!;
		container.addEventListener('s-change', (event) => {
			const name: string = (event as CustomEvent).detail.name;
			const map: Record<string, Mode>	= {
				regex: Mode.Regex,
				fuzzy: Mode.Fuzzy,
				nav: Mode.Nav,
			};
			this.autoSwitchMode(map[name] as Mode);
			if (name !== 'nav') {
				this.search();
			}
			this.inputArea.focus();
		});

		document.body.insertBefore(container, document.body.firstElementChild);

		this.initKeyEvent();
		this.initInputEvent();
	}

	start() {
		this.inputArea.focus();
		this.inputArea.clear(Mode.Normal);
	}

	intoQuickNav() {
		this.enterNav();
		if (!this.searcher) return;
		if (!this.searcher.foundAny) return;
		this.quickNavs = this.searcher.setQuickNavKey();
	}

	/**
	 * Init key event when press key in input area.
	 * This handler includes:
	 * - keyboard navigation in nav mode
	 * - finish search input and switch to quick nav mode
	 * - finish search and return to normal mode
	 * - keyboard navigation in quick nav mode
	 */
	private initKeyEvent() {
		this.inputArea.addEventListener('keydown', (e) => {
			if (this.quickNavs) {
				this.jump(e.key);
			}
			else if (this.inputArea.mode === Mode.Nav) {
				this.nav(e.key);
			}
			else if (e.key === 'Enter') {
				this.intoQuickNav();
			}
			else if (e.key === 'Escape') {
				this.stopSearch();
			}
		});
	}

	/**
	 * Init input event when input in input area.
	 * This handler includes:
	 * - start search mode
	 * - search when input
	 * - stop search when input is empty
	 */
	private initInputEvent() {
		this.inputArea.addEventListener('input', () => {
			const value = this.inputArea.value;
			if (this.quickNavs) {
				this.inputArea.clear();
				return;
			}
			if (value.length === 0) {
				this.stopSearch();
				return;
			}
			if (this.inputArea.mode === Mode.Nav) {
				this.enterNav();
				return;
			}
			if (this.inputArea.value.length === 2 && this.inputArea.value[1] === '@') {
				// todo: open symbol kind picker
			}
			this.exitNav();
			this.search();
		});
	}

	/**
	 * Search when input in input area.
	 */
	private search() {
		const value = this.inputArea.value;
		const pattern = this.inputArea.searchText;
		const outlineRoot = document.querySelector<HTMLDivElement>('#outline-root')!;
		outlineRoot.classList.toggle('searching', true);
		// When adding at the end, we can reuse the last search result to improve performance
		// As the most common case is adding at the end, this may improve performance a lot
		// In regex mode, we can't reuse the last search result.
		const reuse = value.startsWith(this.lastSearch) && this.inputArea.mode !== Mode.Regex;
		const config = {
			pattern,
			mode: this.inputArea.mode || Mode.Normal,
			filter: this.inputArea.filteredSymbol,
		};
		if (this.searcher && reuse) {
			this.searcher.search(config);
		}
		else {
			this.searcher = new Searcher(outlineRoot, config);
		}
		this.lastSearch = value;
	}

	/**
	 * Automatically change mode according to current mode and input.
	 * Return true if mode is set to given mode.
	 * / = --?--> ?, ? --?--> /
	 * / ? --=--> =, = --=--> /
	 * / = ? --x--> x, x --x--> /
	 * 
	 * @param mode 
	 */
	private autoSwitchMode(mode: Mode): boolean {
		this.fuzzySwitch.active = mode === Mode.Fuzzy && mode !== this.inputArea.mode;
		this.regexSwitch.active = mode === Mode.Regex && mode !== this.inputArea.mode;
		if (mode === Mode.Nav && this.inputArea.mode !== Mode.Nav) {
			this.stopSearch();
			return false;
		}
		this.exitNav();
		if (mode === Mode.Normal || this.inputArea.mode === mode) {
			// to Normal mode
			this.inputArea.mode = Mode.Normal;
			return mode === Mode.Normal;
		}
		// to Regex or Fuzzy mode
		this.inputArea.mode = mode;
		return true;
	}

	// Do some preparation when enter nav mode
	private enterNav() {
		this.navSwitch.active = true;
		this.fuzzySwitch.active = false;
		this.regexSwitch.active = false;
		this.inputArea.clear();
	}

	// Do some preparation when exit nav mode
	private exitNav() {
		this.navSwitch.active = false;
	}

	private nav = throttle((key: string) => {
		let focusingItem = document.body.querySelector('.focus');
		if (!focusingItem) {
			focusingItem = document.body.querySelector('.outline-node');
		}
		switch (key) {
		case 'ArrowUp': {
			let prev = focusingItem?.previousElementSibling;
			if (!prev) {
				prev = focusingItem?.parentElement?.parentElement;
			}
			(prev?.querySelector('.outline-label') as HTMLDivElement)?.click();
			break;
		}
		case 'ArrowDown': {
			let next = focusingItem?.nextElementSibling;
			while (!next && focusingItem) {
				focusingItem = focusingItem?.parentElement?.parentElement as HTMLDivElement | null;
				next = focusingItem?.nextElementSibling as HTMLDivElement | null;
			}
			(next?.querySelector('.outline-label') as HTMLDivElement)?.click();
			break;
		}
		case 'ArrowLeft': {
			const parent = focusingItem?.parentElement?.parentElement;
			(parent?.querySelector('.outline-label') as HTMLDivElement)?.click();
			break;
		}
		case 'ArrowRight': {
			const children = focusingItem?.querySelector('.outline-children') as HTMLDivElement | null;
			if (children?.children.length) {
				((children.children[0] as HTMLDivElement)?.querySelector('.outline-label') as HTMLDivElement)?.click();
			}
			break;
		}}
		setTimeout(() => {
			this.inputArea.focus();
		}, 90);
	},100);

	private jump(key: string) {
		this.stopSearch();
		if(!this.quickNavs) return;
		const node = this.quickNavs.get(key);
		if (!node) return;
		const element = node.element;
		element.querySelector<HTMLElement>('.outline-label')?.click();
		this.quickNavs = null;
		return;
	}

	stopSearch() {
		this.searcher?.deconstruct();
		this.searcher = null;
		this.lastSearch = '';
		this.enterNav();
		document.querySelector('#outline-root')?.classList.toggle('searching', false);
	}

}

