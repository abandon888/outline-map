import {
	CancellationToken,
	DocumentSymbol,
	ProviderResult,
	SymbolInformation,
	TextDocument,
	type DocumentSymbolProvider,
	Range,
	SymbolKind,
	FoldingRangeProvider,
	Event,
	FoldingContext,
	FoldingRange,
	Position,
	DecorationOptions,
	TextEditorDecorationType,
	window,
	ThemeColor,
	RenameProvider,
	WorkspaceEdit,
	CompletionItemProvider,
	CompletionContext,
	CompletionItem,
	CompletionList,
	CompletionItemKind,
	SnippetString,
	MarkdownString} from 'vscode';
import { config } from './config';

interface Region {
	key: Token;
	keyEnd: Token;
	name: Token;
	nameEnd?: Token;
	description?: Token;
	start: Range;
	end: Range;
}

interface Tag {
	key: Token;
	name: Token;
	description?: Token;
	at: Range;
}

interface RegionMatch {
	type: 'region-start' | 'region-end' | 'tag',
	key: Token;
	name?: Token;
	description?: Token;
}

interface Token {
	type: string,
	text: string,
	range: Range,
}

export class RegionProvider implements DocumentSymbolProvider, FoldingRangeProvider, RenameProvider {

	/** The document to parse */
	document: TextDocument | undefined;
	documentVersion = 0;

	/** The regions in the document */
	regions: Region[] = [];
	/** The tags in the document */
	tags: Tag[] = [];

	symbols: DocumentSymbol[] = [];

	folding: FoldingRange[] = [];

	// decorations: TextEditorDecorationType[] = [];
	keyDecorationType: TextEditorDecorationType;
	nameDecorationType: TextEditorDecorationType;
	descriptionDecorationType: TextEditorDecorationType;


	/** The string that marks the start of a region */
	startRegion = config.regionStart();
	/** The string that marks the end of a region */
	endRegion = config.regionEnd();
	/** The string that marks a tag */
	tag = config.tag();

	renamingRegionOrTag?: Region | Tag;

	onDidChangeFoldingRanges?: Event<void> | undefined;


	constructor() {
		const regionHighlightStyle = config.regionHighlightStyle();
		this.keyDecorationType = window.createTextEditorDecorationType(regionHighlightStyle?.key || {
			color: new ThemeColor('symbolIcon.keywordForeground')
		});
		this.nameDecorationType = window.createTextEditorDecorationType(regionHighlightStyle?.name || {
			color: new ThemeColor('symbolIcon.variableForeground')
		});
		this.descriptionDecorationType = window.createTextEditorDecorationType(regionHighlightStyle?.description || {
		});
	}

	updateDecorationsConfig() {
		const regionHighlightStyle = config.regionHighlightStyle();
		this.keyDecorationType.dispose();
		this.keyDecorationType = window.createTextEditorDecorationType(regionHighlightStyle?.key || {
			color: new ThemeColor('symbolIcon.keywordForeground')
		});
		this.nameDecorationType.dispose();
		this.nameDecorationType = window.createTextEditorDecorationType(regionHighlightStyle?.name || {
			color: new ThemeColor('symbolIcon.variableForeground')
		});
		this.descriptionDecorationType.dispose();
		this.descriptionDecorationType = window.createTextEditorDecorationType(regionHighlightStyle?.description || {
		});
	}

	/**
	 * Clear the regions and tags arrays
	 */
	clear() {
		this.regions = [];
		this.tags = [];
		this.symbols = [];
		this.folding = [];
	}

	/**
	 * if the document has changed, update the regions and tags arrays
	 * @param document 
	 */
	update(document: TextDocument, cancel?: CancellationToken) {
		if (document !== this.document || document.version !== this.documentVersion) {
			this.document = document;
			this.documentVersion = document.version;
			this.parseDocument(cancel);
		}
	}

	/**
	 * Parse the document and update the regions and tags arrays
	 * @param document 
	 */
	parseDocument(cancel?: CancellationToken) {
		if (!this.document) return;
		this.startRegion = config.regionStart();
		this.endRegion = config.regionEnd();
		this.tag = config.tag();
		this.clear();
		const unpaired: Tag[] = [];
		const regions: Region[] = [];
		const tags: Tag[] = [];
		for (let i = 0; i < this.document.lineCount; i++) {
			if (cancel && cancel.isCancellationRequested) {
				return;
			}
			const line = this.document.lineAt(i);
			if (line.isEmptyOrWhitespace) continue;
			const match = this.matchLine(line.text, i);
			if (!match) continue;

			if (match.type !== 'region-end' && match.name) {
				(match.type === 'tag' ? tags : unpaired).push({ 
					name: match.name,
					at: line.range,
					key: match.key,
					description: match.description,
				});
				continue;
			}
			// for unnamed end tags, use the last unpaired start tag, otherwise find the matching start tag
			let startIndex = unpaired.length - 1;
			if (match.name) {
				for (let j = unpaired.length - 1; j >= 0; j--) {
					if (unpaired[j].name === match.name) {
						startIndex = j;
						break;
					}
				}
				// if no matching start tag is found, skip this end tag
				if (startIndex === -1) continue;
			}

			const startTag = unpaired[startIndex];
			if (!startTag) continue;
			unpaired.splice(startIndex, 1);

			regions.push({
				key: startTag.key,
				keyEnd: match.key,
				name: startTag.name,
				nameEnd: match.name,
				start: startTag.at,
				end: line.range,
				description: startTag.description,
			});
		}
		this.regions = regions;
		this.tags = tags;
		this.updateSymbols();
		this.updateFolding();
		this.updateDecorations();
	}

	/**
	 * Update the symbols array from the regions and tags arrays
	 */
	updateSymbols() {
		for (const region of this.regions) {
			const symbol = new DocumentSymbol(
				region.name.text,
				`__om_Region__${region.description?.text || ''}`,
				SymbolKind.Number,
				new Range(region.start.start, region.end.end),
				new Range(region.name.range.start, region.name.range.end),
			);
			this.symbols.push(symbol);
		}

		for (const tag of this.tags) {
			const symbol = new DocumentSymbol(
				tag.name.text,
				`__om_Tag__${tag.description?.text || ''}`,
				SymbolKind.Number,
				tag.at,
				tag.name.range,
			);
			this.symbols.push(symbol);
		}
	}

	/**
	 * Update the folding ranges from the regions array
	 */
	updateFolding() {
		for (const region of this.regions) {
			this.folding.push(new FoldingRange(region.start.start.line, region.end.end.line));
		}
	}

	updateDecorations() {
		const editor = window.activeTextEditor;
		if (!editor) return;
		const keyDecorations: DecorationOptions[] = [];
		const nameDecorations: DecorationOptions[] = [];
		const descriptionDecorations: DecorationOptions[] = [];
		this.regions.forEach((region) => {
			keyDecorations.push(
				{ range: region.key.range },
				{ range: region.keyEnd.range}
			);
			nameDecorations.push(
				{ range: region.name.range, hoverMessage: `${region.key.text} **${region.name.text}** ${region.description?.text || ''}` },
				...(region.nameEnd ? [{ range: region.nameEnd.range, hoverMessage: `${region.key.text} **${region.name.text}** ${region.description?.text || ''}` }] : [])
			);
			if (region.description) {
				descriptionDecorations.push(
					{ range: region.description.range}
				);
			}
		});
		this.tags.forEach((tag) => {
			keyDecorations.push({ range: tag.key.range });
			nameDecorations.push({ range: tag.name.range, hoverMessage: `${tag.key.text} **${tag.name.text}** ${tag.description?.text || ''}` });
			if (tag.description) {
				descriptionDecorations.push({ range: tag.description.range });
			}
		});

		editor.setDecorations(this.keyDecorationType, keyDecorations);
		editor.setDecorations(this.nameDecorationType, nameDecorations);
		editor.setDecorations(this.descriptionDecorationType, descriptionDecorations);
	}

	//#region providers

	provideFoldingRanges(document: TextDocument, context: FoldingContext, token: CancellationToken): ProviderResult<FoldingRange[]> {
		if (token.isCancellationRequested) return;
		this.update(document, token);
		return this.folding;
	}

	provideDocumentSymbols(document: TextDocument, token: CancellationToken)
		: ProviderResult<DocumentSymbol[] | SymbolInformation[]> {
		if (token.isCancellationRequested) return;
		this.update(document, token);
		return this.symbols;
	}

	prepareRename(document: TextDocument, position: Position, token: CancellationToken)
		: ProviderResult<Range | {placeholder: string, range: Range}> {
		if (token.isCancellationRequested) return;
		this.update(document, token);
		const find = (regionOrTags: (Region | Tag)[]) => {
			for (const regionOrTag of regionOrTags) {
				if (regionOrTag.name.range.contains(position)) {
					return [regionOrTag, regionOrTag.name.range] as const;
				}
				else if (('nameEnd' in regionOrTag) && regionOrTag.nameEnd?.range.contains(position)) {
					return [regionOrTag, regionOrTag.nameEnd.range] as const;
				}
			}
		};
		const [regionOrTag, rangeToRename] = find(this.regions) || find(this.tags) || [];
		if (regionOrTag) {
			this.renamingRegionOrTag = regionOrTag;
			return rangeToRename;
		}
		throw new Error('No region or tag found at position');
	}

	provideRenameEdits(document: TextDocument, position: Position, newName: string, token: CancellationToken)
		: ProviderResult<WorkspaceEdit> {
		if (token.isCancellationRequested) return;
		const regionOrTag = this.renamingRegionOrTag;
		if (!regionOrTag) return;
		const edit = new WorkspaceEdit();
		edit.replace(document.uri, regionOrTag.name.range, newName);
		if (('nameEnd' in regionOrTag) && regionOrTag.nameEnd) {
			edit.replace(document.uri, regionOrTag.nameEnd.range, newName);
		}
		this.renamingRegionOrTag = undefined;
		return edit;
	}

	//#endregion providers

	//#region syntax syntax parsing

	/**
	 * Match a line against the region and tag patterns
	 * @param line the line to match
	 * @param n the line number
	 * @returns a RegionMatch object if the line matches, otherwise null
	 */
	private matchLine(line: string, n: number): RegionMatch | null {
		return this.matchStart(line, n) || this.matchEnd(line, n) || this.matchTag(line, n);
	}

	/**
	 * Match a line against the region start pattern
	 * @param line the line to match
	 * @param n the line number
	 * @returns 
	 */
	private matchStart(line: string, n: number): RegionMatch | null {
		const startPattern = new RegExp(`${this.startRegion}[\\t ]+(?<name>[\\S]*)[\\t ]*(?<description>.*)`);
		const matchStart = line.match(startPattern);
		if (!matchStart) {
			return null;
		}
		return this.getTokens(matchStart, this.startRegion, n, 'region-start');
	}

	private matchEnd(line: string, n: number): RegionMatch | null {
		const endPattern = new RegExp(`${this.endRegion}([\t ]+(?<name>[\\S]*))?`);
		const matchEnd = line.match(endPattern);
		if (!matchEnd) {
			return null;
		}
		return this.getTokens(matchEnd, this.endRegion, n, 'region-end');
	}

	private matchTag(line: string, n: number): RegionMatch | null {
		const tagPattern = new RegExp(`${this.tag}[\\t ]+(?<name>[\\S]*)[\\t ]*(?<description>.*)`);
		const matchTag = line.match(tagPattern);
		if (!matchTag) {
			return null;
		}
		return this.getTokens(matchTag, this.tag, n, 'tag');
	}

	/**
	 * Get the tokens from a match
	 * @param match  the match to get tokens from
	 * @param key 
	 * @param n line number
	 * @param type 
	 * @returns 
	 */
	private getTokens(match: RegExpMatchArray, key: string, n: number, type: RegionMatch['type']): RegionMatch {
		let index = match.index || 0; // the beginning of syntax
		const keyToken = {
			type: 'key',
			text: key,
			range: new Range(
				new Position(n, index),
				new Position(n, index + key.length)
			)
		};
		const result: RegionMatch = {
			type,
			key: keyToken,
		};
		const name = match.groups?.name || null;
		if (!name) {
			return result;
		}
		index = (match.index || 0) + match[0].indexOf(match.groups?.name || '', key.length);
		result.name = {
			type: 'name',
			text: name,
			range: new Range(
				new Position(n, index),
				new Position(n, index + name.length)
			)
		};
		const description = match.groups?.description || null;
		if (!description) {
			return result;
		}
		index = (match.index || 0) + match[0].lastIndexOf(description);
		result.description = {
			type: 'description',
			text: description,
			range: new Range(
				new Position(n, index),
				new Position(n, index + description.length)
			)
		};

		return result;
	}

	//#endregion syntax

}

/**
 * A completion provider for regions and tags
 */
export class RegionCompletionProvider implements CompletionItemProvider {

	startRegion = config.regionStart();
	endRegion = config.regionEnd();
	tag = config.tag();
	addCommentLineCommand = { command: 'editor.action.addCommentLine', title: 'Toggle Line Comment' };
	
	get regionCompletionItem() {
		const insertText = new SnippetString(`${this.startRegion} $\{1:name} $\{2:description}\n$0\n${this.endRegion} $\{1:name}`);
		const mdDocument = new MarkdownString(
			'Insert a region pair to fold the content between them');
		const detail = 'Code Region (Outline-Map)';
		mdDocument.appendCodeblock(`${this.startRegion} name description\n...\n${this.endRegion} name`);
		const item = new CompletionItem(this.startRegion, CompletionItemKind.Issue);
		item.insertText = insertText;
		item.documentation = mdDocument;
		item.detail = detail;
		return item;
	}

	get tagCompletionItem() {
		const insertText = new SnippetString(`${this.tag} $\{1:name} $\{2:description}`);
		const mdDocument = new MarkdownString(
			'Insert a tag to mark a specific point in the source code');
		const detail = 'Code Tag (Outline-Map)';
		mdDocument.appendCodeblock(`${this.tag} name description`);
		const item = new CompletionItem(this.tag, CompletionItemKind.Issue);
		item.insertText = insertText;
		item.documentation = mdDocument;
		item.detail = detail;
		return item;
	}

	provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext): ProviderResult<CompletionItem[] | CompletionList<CompletionItem>> {
		if (token.isCancellationRequested) return;
		const currentLine = document.lineAt(position.line).text.trim();

		const regionCompletionItem = this.regionCompletionItem;
		const tagCompletionItem = this.tagCompletionItem;

		if (this.startRegion.startsWith(currentLine) || this.tag.startsWith(currentLine)) {
			regionCompletionItem.command = this.addCommentLineCommand;
			tagCompletionItem.command = this.addCommentLineCommand;
		}

		return [
			regionCompletionItem,
			tagCompletionItem
		];
	}
	
}
