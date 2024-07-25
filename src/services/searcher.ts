import { Mode } from '../types/input';
import {TreeNode} from '../models/treeNode';
import { SymbolKindStr } from '../utils';

interface SearchConfig {
  pattern: string;
  mode: Mode;
  filter: SymbolKindStr | null;
}

class Searcher {
	private static instance: Searcher;
	private tree: TreeNode;
	private searchReg: RegExp | string | null = null;

	foundAny = false;

	constructor(root: HTMLDivElement, init: SearchConfig) {
		this.tree = new TreeNode(root);
		this.search(init);
	}

	public static getInstance(root: HTMLDivElement, init: SearchConfig): Searcher {
		if (!Searcher.instance) {
			Searcher.instance = new Searcher(root, init);
		}
		return Searcher.instance;
	}

	search(config: SearchConfig) {
		const isCaseSensitive = config.pattern.toLowerCase() !== config.pattern;
		switch (config.mode) {
		case Mode.Normal:
			this.searchReg = config.pattern;
			break;
		case Mode.Regex:
			try {
				this.searchReg = new RegExp(config.pattern, isCaseSensitive ? 'u' : 'ui');
			} catch (e) {
				this.searchReg = null;
			}
			break;
		case Mode.Fuzzy:
			this.searchReg = new RegExp(config.pattern.split('').join('.*?'), isCaseSensitive ? 'u' : 'ui');
			break;
		default:
			this.searchReg = null;
			break;
		}
		if (this.searchReg) {
			this.foundAny = this.searchTree(this.tree, this.searchReg, config.filter);
		}
	}

	private searchTree(node: TreeNode, search: RegExp | string, symbol: SymbolKindStr | null = null): boolean {
		const matched = node.match(search, symbol);
		let matchedChildren = false;
		for (const child of node.children) {
			const matched = this.searchTree(child, search, symbol);
			matchedChildren = matchedChildren || matched;
		}
		node.setMatchedChildren(matchedChildren);
		return matched || matchedChildren;
	}

	setQuickNavKey() {
		const quickNavs = new Map<string, TreeNode>();
		this.tree.setQuickNavKey(quickNavs);
		return quickNavs;
	}

	deconstruct() {
		this.tree.deconstruct();
	}
}

export default Searcher;
