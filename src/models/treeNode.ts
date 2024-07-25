import { SymbolKindStr } from '../utils';
import { QuickNavKey } from '../webview/input';


export class TreeNode {
	children: TreeNode[];
	parent: TreeNode | null;
	element: HTMLElement;
	private matched = true;
	private matchedChildren = true;

	constructor(element: HTMLDivElement, parent?: TreeNode) {
		this.element = element;
		this.parent = parent || null;
		this.children = [];
		parent?.addChild(this);
		const children = element.querySelector('.outline-children');
		if (!(children?.children)) return;
		for (const child of Array.from(children.children)) {
			new TreeNode(child as HTMLDivElement, this);
		}
	}

	deconstruct() {
		this.children.forEach((child) => child.deconstruct());
		this.children = [];
		this.parent = null;
		this.element.classList.remove('matched');
		this.element.classList.remove('matched-children');
		this.element.dataset.quickNav = '';
		const name = this.element.querySelector('.symbol-name');
		if (name) {
			name.innerHTML = name.textContent || '';
		}
		const keyLabel = this.element.querySelector<HTMLSpanElement>('.quick-nav');
		if (keyLabel) {
			keyLabel.style.display = 'none';
			keyLabel.innerHTML = '';
		}
	}

	setQuickNavKey(quickNavs: Map<string, TreeNode>) {
		if (quickNavs.size >= QuickNavKey.length) return;
		if (this.matched) {
			const key = QuickNavKey[quickNavs.size];
			quickNavs.set(key, this);
			this.element.dataset.quickNav = key;
			const keyLabel = this.element.querySelector<HTMLSpanElement>('.quick-nav');
			if (keyLabel) {
				keyLabel.style.display = 'inline-block';
				keyLabel.innerHTML = key;
			}
		}
		if (this.matchedChildren) {
			this.children.forEach((child) => child.setQuickNavKey(quickNavs));
		}
	}

	match(search: RegExp | string, symbol: SymbolKindStr | null = null): boolean {
		if (!this.matched) return false;
		if (symbol && symbol !== this.element.dataset.kind) {
			this.matched = false;
			this.element.classList.toggle('matched', false);
			return false;
		}
		const name = this.element.querySelector('.symbol-name')!;
		if (!name.textContent) return false;
		if (search instanceof RegExp) {
			const matched = name.textContent.match(search);
			if (matched) {
				name.innerHTML = name.textContent?.replace(search, `<b>${matched[0]}</b>`) || '';
			}
			this.matched = !!matched;
		} else {
			const isCaseSensitive = search.toLowerCase() !== search;
			let matched;
			let str;
			if (isCaseSensitive) {
				matched = name.textContent.indexOf(search);
				str = search;
			} else {
				matched = name.textContent.toLowerCase().indexOf(search.toLowerCase());
				str = name.textContent.substring(matched, matched + search.length);
			}
			if (matched !== -1) {
				name.innerHTML = name.textContent?.replace(str, `<b>${str}</b>`) || '';
			}
			this.matched = matched !== -1;
		}
		this.element.classList.toggle('matched', this.matched);
		return this.matched;
	}

	setMatchedChildren(matched: boolean) {
		this.matchedChildren = matched;
		this.element.classList.toggle('matched-children', matched);
	}

	addChild(child: TreeNode) {
		this.children.push(child);
	}
}
