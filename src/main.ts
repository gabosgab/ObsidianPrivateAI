import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, Notice } from 'obsidian';
import { ChatView } from './views/ChatView';
import { LoggingUtility } from './utils/LoggingUtility';
import { RAGService } from './services/RAGService';
import '../styles.css';
import manifest from '../manifest.json';

export const CHAT_VIEW_TYPE = 'local-llm-chat-view';

export enum ContextMode {
	OPEN_NOTES = 'open-notes',
	SEARCH = 'search',
	NONE = 'none'
}

interface LocalLLMSettings {
	apiEndpoint: string;
	maxTokens: number;
	temperature: number;
	// System prompt setting
	systemPrompt: string;
	// Model setting (optional - if not set, no model will be sent in payload)
	model?: string;
	// API key (optional) - if specified, used as a Bearer token (works with LM Studio)
	apiKey?: string;
	// Search settings
	searchMaxResults: number;
	searchContextPercentage: number;
	searchThreshold: number;
	// Context mode setting - updated to remove RAG distinction
	contextMode: ContextMode;
	// Developer logging setting
	enableDeveloperLogging: boolean;
	// RAG settings (RAG is now always enabled)
	enableRAG: boolean;
	ragThreshold: number;
	ragMaxResults: number;
	// Embedding settings
	embeddingEndpoint: string;
	embeddingModel: string;
	// Image processing settings
	enableImageTextExtraction: boolean;
	// Exclusion settings for indexing/task processing
	excludedFolders: string[];
	excludedFilePatterns: string[];
	// Context notes visibility setting
	contextNotesVisible: boolean;
	// Review prompt tracking
	usageTimeMs: number;
	lastUsageStartTimestamp: number | null;
	lastReviewPromptTimestamp: number | null;
	reviewLinkClicked: boolean;
}

const DEFAULT_SETTINGS: LocalLLMSettings = {
	apiEndpoint: 'http://localhost:1234/v1/chat/completions',
	maxTokens: 10000,
	temperature: 0.7,
	// Default system prompt
	systemPrompt: "You are a helpful assistant with access to the user's Obsidian vault. When provided with context from their notes, use that information to provide more accurate and relevant responses. Reference specific notes when appropriate, but focus on answering the user's question clearly and concisely.",
	// Search defaults
	searchMaxResults: 5,
	searchContextPercentage: 50,
	searchThreshold: 0.3,
	// Default context mode (search now uses RAG)
	contextMode: ContextMode.OPEN_NOTES,
	// Default developer logging setting
	enableDeveloperLogging: false,
	// RAG defaults (always enabled)
	enableRAG: true,
	ragThreshold: 0.5,
	ragMaxResults: 10,
	// Embedding defaults
	embeddingEndpoint: 'http://localhost:1234/v1/embeddings',
	embeddingModel: 'text-embedding-nomic-embed-text-v1.5',
	// Image processing defaults
	enableImageTextExtraction: true,
	// Indexing exclusions defaults
	excludedFolders: [],
	excludedFilePatterns: [],
	// Default context notes visibility
	contextNotesVisible: false,
	// Review prompt defaults
	usageTimeMs: 0,
	lastUsageStartTimestamp: null,
	lastReviewPromptTimestamp: null,
	reviewLinkClicked: false
};

const REVIEW_PROMPT_THRESHOLD_MS = 60 * 60 * 1000;
const REVIEW_PROMPT_REPEAT_MS = 24 * 60 * 60 * 1000;
const REVIEW_PAGE_URL = 'https://www.obsidianstats.com/plugins/private-ai';
const REVIEW_PROMPT_MESSAGE = 'Enjoying Private AI? A quick review helps others discover it';

export default class LocalLLMPlugin extends Plugin {
	settings: LocalLLMSettings;
	ragService: RAGService;
	private llmService: any; // LLMService instance for image processing
	private usageTrackingIntervalId: number | null = null;
	private reviewPromptPending = false;

	async onload() {
		LoggingUtility.initialize();

		await this.loadSettings();
		this.startUsageTracking();

		// Set developer logging based on settings
		LoggingUtility.setDeveloperLoggingEnabled(this.settings.enableDeveloperLogging);

		// Create LLM service for image processing
		const { createLLMService } = await import('./services/LLMService');
		this.llmService = createLLMService({
			apiEndpoint: this.settings.apiEndpoint,
			apiKey: this.settings.apiKey,
			maxTokens: this.settings.maxTokens,
			temperature: this.settings.temperature,
			systemPrompt: this.settings.systemPrompt
		});

		// Initialize RAG service (always enabled with auto-maintenance)
		this.ragService = new RAGService(this.app, this.manifest, {
			endpoint: this.settings.embeddingEndpoint,
			model: this.settings.embeddingModel,
			apiKey: this.settings.apiKey
		}, {
			autoMaintenance: true,
			backgroundIndexing: true,
			silentMode: false,
			progressCallback: (current, total, message) => {
				this.notifyChatViewsOfRAGProgress(current, total, message);
			},
			completionCallback: () => {
				this.notifyChatViewsOfRAGComplete();
			}
		});

		// Initialize image text extractor in RAG service
		this.ragService.initializeImageTextExtractor(this.llmService);

		// Defer RAG initialization until layout is ready to ensure vault cache is populated
		this.app.workspace.onLayoutReady(async () => {
			await this.ragService.initialize(this.settings);

			// Always start file watcher since RAG is always enabled
			this.ragService.startFileWatcher();
		});

		// Register the view
		this.registerView(
			CHAT_VIEW_TYPE,
			(leaf) => new ChatView(leaf, this)
		);

		// Add ribbon icon to open chat
		this.addRibbonIcon('sparkles', 'Open private AI', () => {
			this.activateView();
		});

		// Add command to open chat
		this.addCommand({
			id: 'open-local-llm-chat',
			name: 'Open',
			callback: () => {
				this.activateView();
			}
		});

		this.addCommand({
			id: 'resume-paused-rag-indexing',
			name: 'Resume paused indexing',
			callback: () => {
				if (!this.ragService) {
					new Notice('RAG service is not initialized yet.');
					return;
				}

				const resumed = this.ragService.retryPausedIndexing();
				if (resumed) {
					new Notice('Retry requested. Indexing is resuming.');
				} else {
					new Notice('Indexing is not currently paused.');
				}
			}
		});

		// Add settings tab
		this.addSettingTab(new LocalLLMSettingTab(this.app, this));
	}

	async onunload() {
		LoggingUtility.log('Unloading Private AI Chat plugin');

		await this.flushUsageTracking();

		// Stop RAG file watcher and close database gracefully
		if (this.ragService) {
			await this.ragService.shutdown();
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);

		// Update developer logging setting
		LoggingUtility.setDeveloperLoggingEnabled(this.settings.enableDeveloperLogging);

		// Update LLM service config
		if (this.llmService) {
			const { createLLMService } = await import('./services/LLMService');
			this.llmService = createLLMService({
				apiEndpoint: this.settings.apiEndpoint,
				apiKey: this.settings.apiKey,
				maxTokens: this.settings.maxTokens,
				temperature: this.settings.temperature,
				systemPrompt: this.settings.systemPrompt
			});

			// Re-initialize image text extractor with updated LLM service
			if (this.ragService) {
				this.ragService.initializeImageTextExtractor(this.llmService);
			}
		}

		// Update RAG service embedding config
		if (this.ragService) {
			this.ragService.updateEmbeddingConfig({
				endpoint: this.settings.embeddingEndpoint,
				model: this.settings.embeddingModel,
				apiKey: this.settings.apiKey
			});
		}

		// Notify all open chat views about the settings change
		this.notifyChatViewsOfSettingsChange();
	}

	private startUsageTracking() {
		if (this.settings.lastUsageStartTimestamp === null) {
			this.settings.lastUsageStartTimestamp = Date.now();
		}

		this.usageTrackingIntervalId = window.setInterval(() => {
			void this.updateUsageAndMaybeShowReviewPrompt();
		}, 60 * 1000);
		this.registerInterval(this.usageTrackingIntervalId);

		void this.updateUsageAndMaybeShowReviewPrompt();
	}

	private async updateUsageAndMaybeShowReviewPrompt() {
		const now = Date.now();
		const lastStart = this.settings.lastUsageStartTimestamp;

		if (lastStart !== null && now > lastStart) {
			this.settings.usageTimeMs += now - lastStart;
		}

		this.settings.lastUsageStartTimestamp = now;
		await this.saveData(this.settings);

		if (this.shouldShowReviewPrompt(now)) {
			this.settings.lastReviewPromptTimestamp = now;
			await this.saveData(this.settings);
			this.showReviewPromptInChat();
		}
	}

	private shouldShowReviewPrompt(now: number): boolean {
		if (this.settings.reviewLinkClicked) {
			return false;
		}

		if (this.settings.usageTimeMs < REVIEW_PROMPT_THRESHOLD_MS) {
			return false;
		}

		if (this.settings.lastReviewPromptTimestamp === null) {
			return true;
		}

		return now - this.settings.lastReviewPromptTimestamp >= REVIEW_PROMPT_REPEAT_MS;
	}

	private async flushUsageTracking() {
		const now = Date.now();
		const lastStart = this.settings.lastUsageStartTimestamp;

		if (lastStart !== null && now > lastStart) {
			this.settings.usageTimeMs += now - lastStart;
		}

		this.settings.lastUsageStartTimestamp = null;
		await this.saveData(this.settings);
	}

	private showReviewPromptInChat() {
		const injected = this.notifyChatViewsOfReviewPrompt();
		if (injected) {
			return;
		}

		// Queue for next chat view render and open the chat view for immediate visibility.
		this.reviewPromptPending = true;
		void this.activateView().then(() => {
			const wasInjected = this.notifyChatViewsOfReviewPrompt();
			if (wasInjected) {
				this.reviewPromptPending = false;
			}
		});
	}

	openReviewPromptManually() {
		this.showReviewPromptInChat();
	}

	async markReviewLinkClicked() {
		if (this.settings.reviewLinkClicked) {
			return;
		}

		this.settings.reviewLinkClicked = true;
		this.reviewPromptPending = false;
		await this.saveData(this.settings);
	}

	consumePendingReviewPrompt(chatView: ChatView) {
		if (!this.reviewPromptPending) {
			return;
		}

		chatView.showReviewPromptBanner(REVIEW_PROMPT_MESSAGE, REVIEW_PAGE_URL);
		this.reviewPromptPending = false;
	}

	notifyChatViewsOfSettingsChange() {
		// Get all open chat view leaves
		this.app.workspace.iterateAllLeaves(leaf => {
			// Check if the view is actually a ChatView instance (not a DeferredView)
			// In Obsidian v1.7.2+, views start as DeferredView until they become visible
			if (leaf.view instanceof ChatView) {
				leaf.view.updateContextModeFromSettings();
			}
		});
	}

	/**
	 * Notify all chat views about RAG indexing progress
	 */
	notifyChatViewsOfRAGProgress(current: number, total: number, message: string) {
		const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
		leaves.forEach(leaf => {
			const chatView = leaf.view as ChatView;
			if (chatView && typeof chatView.showRAGProgress === 'function') {
				chatView.showRAGProgress(current, total, message);
			}
		});
	}

	/**
	 * Notify all chat views that RAG indexing is complete
	 */
	notifyChatViewsOfRAGComplete() {
		const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
		leaves.forEach(leaf => {
			const chatView = leaf.view as ChatView;
			if (chatView && typeof chatView.onRAGIndexingComplete === 'function') {
				chatView.onRAGIndexingComplete();
			}
		});
	}

	private notifyChatViewsOfReviewPrompt(): boolean {
		const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
		let injected = false;

		leaves.forEach(leaf => {
			const chatView = leaf.view as ChatView;
			if (chatView && typeof chatView.showReviewPromptBanner === 'function') {
				chatView.showReviewPromptBanner(REVIEW_PROMPT_MESSAGE, REVIEW_PAGE_URL);
				injected = true;
			}
		});

		return injected;
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			// Create a new leaf in the right sidebar
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: CHAT_VIEW_TYPE,
					active: true,
				});
			}
		}

		// Reveal the leaf in case it is in a collapsed sidebar
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}
}

class LocalLLMSettingTab extends PluginSettingTab {
	plugin: LocalLLMPlugin;

	constructor(app: App, plugin: LocalLLMPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// Helper to create a slider with live value label and custom style
		const addStyledSlider = (setting: Setting, opts: {
			min: number, max: number, step: number, value: number, onChange: (value: number) => Promise<void>,
			format?: (value: number) => string
		}) => {
			let valueLabel: HTMLSpanElement | null = null;
			setting.addSlider(slider => {
				slider.setLimits(opts.min, opts.max, opts.step)
					.setValue(opts.value)
					.setDynamicTooltip()
					.onChange(async (value) => {
						if (valueLabel) valueLabel.textContent = opts.format ? opts.format(value) : value.toString();
						await opts.onChange(value);
					});
				slider.sliderEl.classList.add('local-llm-settings-slider');
				// Live update label as slider moves
				slider.sliderEl.addEventListener('input', (e: Event) => {
					const val = parseFloat((e.target as HTMLInputElement).value);
					if (valueLabel) valueLabel.textContent = opts.format ? opts.format(val) : val.toString();
				});
				valueLabel = document.createElement('span');
				valueLabel.className = 'local-llm-slider-value';
				valueLabel.textContent = opts.format ? opts.format(opts.value) : opts.value.toString();
				slider.sliderEl.parentElement?.appendChild(valueLabel);
			});
		};

		// Add context mode setting
		new Setting(containerEl)
			.setName('Default context mode')
			.setDesc('The default context mode to use when opening a new chat')
			.addDropdown(dropdown => dropdown
				.addOption(ContextMode.OPEN_NOTES, 'Open Tabs')
				.addOption(ContextMode.SEARCH, 'All Notes')
				.addOption(ContextMode.NONE, 'No Context')
				.setValue(this.plugin.settings.contextMode)
				.onChange(async (value) => {
					this.plugin.settings.contextMode = value as ContextMode;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('API endpoint')
			.setDesc('The endpoint URL for your local LLM API')
			.addText(text => text
				.setPlaceholder('http://localhost:1234/v1/chat/completions')
				.setValue(this.plugin.settings.apiEndpoint)
				.onChange(async (value) => {
					this.plugin.settings.apiEndpoint = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('API key')
			.setDesc('Optional API key sent as a Bearer token for API authentication')
			.addText(text => text
				.setPlaceholder('Enter API key')
				.setValue(this.plugin.settings.apiKey ?? '')
				.onChange(async (value) => {
					const trimmedValue = value.trim();
					this.plugin.settings.apiKey = trimmedValue.length > 0 ? trimmedValue : undefined;
					await this.plugin.saveSettings();
				}));

		// Model dropdown setting
		const modelSetting = new Setting(containerEl)
			.setName('Model')
			.setDesc('Select a specific model to use. (Loaded from LM Studio downloaded models.)')
			.addDropdown(dropdown => {
				// Add empty option for no model selection
				dropdown.addOption('', 'Auto (server chooses)');

				// Set current value from saved settings
				const savedModel = this.plugin.settings.model || '';
				dropdown.setValue(savedModel);

				dropdown.onChange(async (value) => {
					this.plugin.settings.model = value === '' ? undefined : value;
					await this.plugin.saveSettings();
				});

				// Store reference to dropdown for dynamic updates
				(this as any).modelDropdown = dropdown;
			});

		// Add refresh models button
		modelSetting.addButton(button => button
			.setButtonText('Refresh Models')
			.setTooltip('Load available models from LM Studio')
			.onClick(async () => {
				await this.loadAvailableModels();
			}));

		// Load models automatically when settings are displayed
		// Use setTimeout to ensure the dropdown is fully initialized first
		setTimeout(() => {
			this.loadAvailableModels();
		}, 0);

		addStyledSlider(
			new Setting(containerEl)
				.setName('Max tokens')
				.setDesc('Maximum number of tokens in the response'),
			{
				min: 100, max: 40000, step: 100, value: this.plugin.settings.maxTokens,
				onChange: async (value) => {
					this.plugin.settings.maxTokens = value;
					await this.plugin.saveSettings();
				}
			}
		);

		addStyledSlider(
			new Setting(containerEl)
				.setName('Temperature')
				.setDesc('Controls randomness in the response (0 = deterministic, 1 = very random) 0.7 is recommended for most models'),
			{
				min: 0, max: 1, step: 0.01, value: this.plugin.settings.temperature,
				onChange: async (value) => {
					this.plugin.settings.temperature = value;
					await this.plugin.saveSettings();
				},
				format: (v) => v.toFixed(2)
			}
		);

		// System prompt setting with textarea below
		new Setting(containerEl)
			.setName('What personal preferences should be considered in responses?')
			.setDesc('Customize the AI\'s personality and behavior. This system prompt will be used in all conversations.');

		const systemPromptTextArea = containerEl.createEl('textarea', {
			cls: 'local-llm-system-prompt-textarea',
			attr: {
				placeholder: 'e.g. "You are a helpful assistant. Please be concise and friendly. Consider that I prefer practical examples over theory."',
				rows: '4'
			}
		});
		systemPromptTextArea.value = this.plugin.settings.systemPrompt;

		systemPromptTextArea.addEventListener('input', async () => {
			this.plugin.settings.systemPrompt = systemPromptTextArea.value;
			await this.plugin.saveSettings();
		});

		new Setting(containerEl).setName('Search').setHeading();

		addStyledSlider(
			new Setting(containerEl)
				.setName('Max search results')
				.setDesc('Maximum number of notes to include as context (uses RAG database for enhanced relevance)'),
			{
				min: 1, max: 10, step: 1, value: this.plugin.settings.ragMaxResults,
				onChange: async (value) => {
					this.plugin.settings.ragMaxResults = value;
					await this.plugin.saveSettings();
				}
			}
		);

		addStyledSlider(
			new Setting(containerEl)
				.setName('Context percentage from search')
				.setDesc('Percentage of max tokens to use for search context (50% = 2000 tokens if max tokens is 4000)'),
			{
				min: 10, max: 80, step: 5, value: this.plugin.settings.searchContextPercentage,
				onChange: async (value) => {
					this.plugin.settings.searchContextPercentage = value;
					await this.plugin.saveSettings();
				},
				format: (v) => v + '%'
			}
		);

		addStyledSlider(
			new Setting(containerEl)
				.setName('Search relevance threshold')
				.setDesc('Minimum relevance score for notes to be included using RAG similarity (0 = include all, 1 = very strict)'),
			{
				min: 0, max: 1, step: 0.1, value: this.plugin.settings.ragThreshold,
				onChange: async (value) => {
					this.plugin.settings.ragThreshold = value;
					await this.plugin.saveSettings();
				},
				format: (v) => v.toFixed(2)
			}
		);

		new Setting(containerEl).setName('All Notes Search').setHeading();

		const ragStats = this.plugin.ragService.getStats();
		const detailedStatus = this.plugin.ragService.getDetailedStatus();
		new Setting(containerEl)
			.setName('RAG database status')
			.setDesc(`Documents indexed: ${ragStats.documentCount} (${detailedStatus.textStats.documentCount} text, ${detailedStatus.imageStats.documentCount} image) | Files: ${ragStats.fileCount} | Last updated: ${ragStats.lastUpdated.toLocaleString()} | Size: ${(ragStats.sizeInBytes / 1024).toFixed(1)} KB | Image processing: ${detailedStatus.imageProcessingEnabled ? 'enabled' : 'disabled'} | Image extractor: ${detailedStatus.imageTextExtractorAvailable ? 'available' : 'unavailable'}`);

		new Setting(containerEl).setName('Indexing Exclusions').setHeading();

		const excludedFoldersSetting = new Setting(containerEl)
			.setName('Excluded folders')
			.setDesc('One folder per line. Supports vault-relative paths (e.g. clippings/_resources) or absolute vault paths.')
			.addTextArea(text => text
				.setPlaceholder('clippings/_resources\nattachments/generated')
				.setValue((this.plugin.settings.excludedFolders || []).join('\n'))
				.then((text) => {
					text.inputEl.rows = 4;
					text.inputEl.addClass('local-llm-exclusion-textarea');
					text.inputEl.addClass('local-llm-exclusion-textarea-large');
				})
				.onChange(async (value) => {
					this.plugin.settings.excludedFolders = this.parseMultilineList(value);
					await this.plugin.saveSettings();
				}));
		excludedFoldersSetting.settingEl.addClass('local-llm-exclusion-setting');

		const excludedFilePatternsSetting = new Setting(containerEl)
			.setName('Excluded file patterns')
			.setDesc('One pattern per line. Examples: *.json, *.csv, *.png, Daily/*.tmp')
			.addTextArea(text => text
				.setPlaceholder('*.json\n*.csv\n*.png')
				.setValue((this.plugin.settings.excludedFilePatterns || []).join('\n'))
				.then((text) => {
					text.inputEl.rows = 3;
					text.inputEl.addClass('local-llm-exclusion-textarea');
					text.inputEl.addClass('local-llm-exclusion-textarea-compact');
				})
				.onChange(async (value) => {
					this.plugin.settings.excludedFilePatterns = this.parseMultilineList(value);
					await this.plugin.saveSettings();
				}));
		excludedFilePatternsSetting.settingEl.addClass('local-llm-exclusion-setting');

		// Smart update RAG database button
		new Setting(containerEl)
			.setName('Update RAG database')
			.setDesc('Update the RAG database by checking for changed files using checksums. Only processes files that have actually changed.')
			.addButton(button => button
				.setButtonText('Smart Update')
				.setCta()
				.onClick(async () => {
					button.setButtonText('Updating...');
					button.setDisabled(true);

					try {
						await this.plugin.ragService.buildIndex((current, total, message) => {
							this.plugin.notifyChatViewsOfRAGProgress(current, total, message);
						});

						// Update stats display
						const newStats = this.plugin.ragService.getStats();
						this.updateStatusDisplay(containerEl, newStats);

						// Notify chat views that indexing is complete
						this.plugin.notifyChatViewsOfRAGComplete();
					} catch (error) {
						LoggingUtility.error('RAG update failed:', error);
						new Notice(`RAG database update failed: ${error.message}`);
					} finally {
						button.setButtonText('Smart Update');
						button.setDisabled(false);
					}
				}));

		// Force rebuild RAG database button
		new Setting(containerEl)
			.setName('Force rebuild RAG database')
			.setDesc('Completely rebuild the entire RAG database from scratch. Use this if you want to regenerate all embeddings.')
			.addButton(button => button
				.setButtonText('Force Rebuild')
				.setWarning()
				.onClick(async () => {
					button.setButtonText('Rebuilding...');
					button.setDisabled(true);

					try {
						await this.plugin.ragService.forceCompleteRebuildIndex((current, total, message) => {
							this.plugin.notifyChatViewsOfRAGProgress(current, total, message);
						});

						// Update stats display
						const newStats = this.plugin.ragService.getStats();
						this.updateStatusDisplay(containerEl, newStats);

						// Notify chat views that indexing is complete
						this.plugin.notifyChatViewsOfRAGComplete();

						new Notice('RAG database completely rebuilt!');
					} catch (error) {
						LoggingUtility.error('RAG rebuild failed:', error);
						new Notice(`RAG database rebuild failed: ${error.message}`);
					} finally {
						button.setButtonText('Force Rebuild');
						button.setDisabled(false);
					}
				}));

		addStyledSlider(
			new Setting(containerEl)
				.setName('RAG relevance threshold')
				.setDesc('Minimum relevance score for RAG results (0 = include all, 1 = very strict)'),
			{
				min: 0, max: 1, step: 0.1, value: this.plugin.settings.ragThreshold,
				onChange: async (value) => {
					this.plugin.settings.ragThreshold = value;
					await this.plugin.saveSettings();
				},
				format: (v) => v.toFixed(2)
			}
		);

		addStyledSlider(
			new Setting(containerEl)
				.setName('Max RAG results')
				.setDesc('Maximum number of notes to retrieve from RAG database'),
			{
				min: 1, max: 10, step: 1, value: this.plugin.settings.ragMaxResults,
				onChange: async (value) => {
					this.plugin.settings.ragMaxResults = value;
					await this.plugin.saveSettings();
				}
			}
		);

		// Embedding endpoint setting
		new Setting(containerEl)
			.setName('Embedding API endpoint')
			.setDesc('The endpoint URL for the embedding API (used for generating vector embeddings)')
			.addText(text => text
				.setPlaceholder('http://localhost:1234/v1/embeddings')
				.setValue(this.plugin.settings.embeddingEndpoint)
				.onChange(async (value) => {
					this.plugin.settings.embeddingEndpoint = value;
					await this.plugin.saveSettings();
					this.loadAvailableEmbeddingModels();
				}));

		// Embedding model dropdown setting
		const embeddingModelSetting = new Setting(containerEl)
			.setName('Embedding model')
			.setDesc('Select a specific embedding model. (Loaded from LM Studio available models list.)')
			.addDropdown(dropdown => {
				const savedEmbeddingModel = this.plugin.settings.embeddingModel || DEFAULT_SETTINGS.embeddingModel;
				dropdown.addOption(savedEmbeddingModel, savedEmbeddingModel);
				dropdown.setValue(savedEmbeddingModel);

				dropdown.onChange(async (value) => {
					this.plugin.settings.embeddingModel = value;
					await this.plugin.saveSettings();
				});

				(this as any).embeddingModelDropdown = dropdown;
			});

		embeddingModelSetting.addButton(button => button
			.setButtonText('Refresh Embedding Models')
			.setTooltip('Load available embedding models from LM Studio')
			.onClick(async () => {
				await this.loadAvailableEmbeddingModels();
			}));

		setTimeout(() => {
			this.loadAvailableEmbeddingModels();
		}, 0);



		// Test embedding connection button
		new Setting(containerEl)
			.setName('Test embedding connection')
			.setDesc('Test if the embedding API endpoint is working correctly')
			.addButton(button => button
				.setButtonText('Test Embedding')
				.setCta()
				.onClick(async () => {
					button.setButtonText('Testing...');
					button.setDisabled(true);

					try {
						// Update the embedding service config with current settings
						this.plugin.ragService.updateEmbeddingConfig({
							endpoint: this.plugin.settings.embeddingEndpoint,
							model: this.plugin.settings.embeddingModel,
							apiKey: this.plugin.settings.apiKey
						});

						// Test the connection
						const result = await this.plugin.ragService.testEmbeddingConnection();

						if (result.success) {
							new Notice(`Embedding API connection successful. Embedding dimension: ${result.dimensions}`);
						} else {
							new Notice(`Embedding API connection failed: ${result.error}`);
						}
					} catch (error) {
						LoggingUtility.error('Embedding test failed:', error);
						new Notice(`Embedding test failed: ${error.message}`);
					} finally {
						button.setButtonText('Test Embedding');
						button.setDisabled(false);
					}
				}));

		new Setting(containerEl).setName('Image Processing').setHeading();

		// Image text extraction setting
		new Setting(containerEl)
			.setName('Enable image text extraction')
			.setDesc('Extract text from images using vision-capable LLM models and add to the RAG index. Requires a vision model like LLaVA, GPT-4V, or similar.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableImageTextExtraction)
				.onChange(async (value) => {
					this.plugin.settings.enableImageTextExtraction = value;
					await this.plugin.saveSettings();
				}));

		// Manual image processing button
		new Setting(containerEl)
			.setName('Process images now')
			.setDesc('Manually trigger image text extraction for all images in your vault. This will use your LLM to extract text and add it to the RAG index.')
			.addButton(button => button
				.setButtonText('Process Images')
				.setCta()
				.onClick(async () => {
					button.setButtonText('Processing...');
					button.setDisabled(true);

					try {
						await this.plugin.ragService.processImagesManually((current, total, message) => {
							this.plugin.notifyChatViewsOfRAGProgress(current, total, message);
						});

						// Update stats display
						const newStats = this.plugin.ragService.getStats();
						this.updateStatusDisplay(containerEl, newStats);

						new Notice('Image processing completed successfully!');
					} catch (error) {
						LoggingUtility.error('Image processing failed:', error);
						// Show user-friendly error message for vision model issues
						if (error.message.includes('vision capabilities')) {
							new Notice('Vision model required: your current LLM model does not support image processing. Please switch to a vision model like Gemma 3 in LM Studio and try again.', 8000);
						} else {
							new Notice(`Image processing failed: ${error.message}`);
						}
					} finally {
						button.setButtonText('Process Images');
						button.setDisabled(false);
					}
				}));

		new Setting(containerEl).setName('Support').setHeading();

		new Setting(containerEl)
			.setName('Review prompt')
			.setDesc('Inject the review prompt into the chat window for testing.')
			.addButton(button => button
				.setButtonText('Show review prompt')
				.setCta()
				.onClick(() => {
					this.plugin.openReviewPromptManually();
				}));

		// Add developer logging setting
		new Setting(containerEl)
			.setName('Enable developer logging')
			.setDesc('Enable additional logging for debugging')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableDeveloperLogging)
				.onChange(async (value) => {
					this.plugin.settings.enableDeveloperLogging = value;
					await this.plugin.saveSettings();
				}));

		// Add connection test button
		const testButton = containerEl.createEl('button', {
			text: 'Test connection',
			cls: 'mod-cta'
		});

		testButton.addEventListener('click', async () => {
			testButton.setText('Testing...');
			testButton.disabled = true;

			try {
				// Create a temporary LLM service to test
				const { createLLMService } = await import('./services/LLMService');
				const llmService = createLLMService({
					apiEndpoint: this.plugin.settings.apiEndpoint,
					apiKey: this.plugin.settings.apiKey,
					maxTokens: this.plugin.settings.maxTokens,
					temperature: this.plugin.settings.temperature,
					systemPrompt: this.plugin.settings.systemPrompt,
					model: this.plugin.settings.model
				});

				// Validate config first
				const validation = llmService.validateConfig();
				if (!validation.valid) {
					throw new Error(`Configuration errors:\n${validation.errors.join('\n')}`);
				}

				// Test connection
				const result = await llmService.testConnection();

				if (result.success) {
					new Notice('Connection successful. Your LLM server is working.');
					testButton.setText('Test connection');
					testButton.disabled = false;
				} else {
					throw new Error(result.error || 'Unknown connection error');
				}
			} catch (error) {
				LoggingUtility.error('Connection test failed:', error);
				new Notice(`Connection failed: ${error.message}`);
				testButton.setText('Test connection');
				testButton.disabled = false;
			}
		});

		// Add spacing between buttons
		containerEl.createEl('br');
		containerEl.createEl('br');

		// Add report problem button
		const reportButton = containerEl.createEl('button', {
			text: 'Report a problem',
			cls: 'mod-cta'
		});

		// Add version display
		containerEl.createEl('p', { text: `Private AI version ${manifest.version}` })

		reportButton.addEventListener('click', () => {
			window.open('https://github.com/gabosgab/ObsidianPrivateAI/issues/new?template=bug_report.md', '_blank');
		});
	}

	/**
	 * Load available models from the LM Studio /v1/models endpoint
	 */
	private async loadAvailableModels(): Promise<void> {
		const dropdown = (this as any).modelDropdown;
		if (!dropdown) return;

		try {
			// Show loading state
			const savedModel = this.plugin.settings.model || '';
			dropdown.selectEl.disabled = true;
			dropdown.selectEl.empty();
			dropdown.selectEl.createEl('option', { value: '', text: 'Loading models...' });

			// Create a temporary LLM service to fetch models
			const { createLLMService } = await import('./services/LLMService');
			const llmService = createLLMService({
					apiEndpoint: this.plugin.settings.apiEndpoint,
					apiKey: this.plugin.settings.apiKey
			});

			// Fetch available models
			const models = await llmService.getAvailableModels();

			// Clear dropdown and add default option
			dropdown.selectEl.empty();
			dropdown.addOption('', 'Auto (server chooses)');

			// Add available models
			if (models.length > 0) {
				models.forEach(model => {
					if (!model.toLowerCase().includes('embed')) {
						dropdown.addOption(model, model);
					}
				});
			} else {
				dropdown.addOption('', 'No models available');
			}

			// Restore saved selection if it still exists
			if (savedModel && models.includes(savedModel)) {
				dropdown.setValue(savedModel);
			} else {
				dropdown.setValue('');
			}

			// Re-enable dropdown
			dropdown.selectEl.disabled = false;

		} catch (error) {
			LoggingUtility.error('Failed to load available models:', error);

			// Show error state
			dropdown.selectEl.empty();
			dropdown.addOption('', 'Auto (server chooses)');
			dropdown.addOption('', 'Failed to load models');

			// Restore saved model even in error state
			const savedModel = this.plugin.settings.model || '';
			dropdown.setValue(savedModel);
			dropdown.selectEl.disabled = false;

			// Show notice to user
			new Notice('Failed to load models from LM Studio. Please check your API endpoint and ensure LM Studio is running.');
		}
	}

	/**
	 * Load available embedding models from the LM Studio model listing endpoints.
	 * Falls back to the current default embedding model when no embedding models are returned.
	 */
	private async loadAvailableEmbeddingModels(): Promise<void> {
		const dropdown = (this as any).embeddingModelDropdown;
		if (!dropdown) return;

		const currentOrDefaultModel = this.plugin.settings.embeddingModel || DEFAULT_SETTINGS.embeddingModel;

		try {
			dropdown.selectEl.disabled = true;
			dropdown.selectEl.empty();
			dropdown.selectEl.createEl('option', { value: '', text: 'Loading embedding models...' });

			const { createLLMService } = await import('./services/LLMService');
			const llmService = createLLMService({
				apiEndpoint: this.plugin.settings.embeddingEndpoint,
				apiKey: this.plugin.settings.apiKey
			});

			const models = await llmService.getAvailableEmbeddingModels();

			dropdown.selectEl.empty();

			if (models.length > 0) {
				models.forEach(model => dropdown.addOption(model, model));

				if (models.includes(currentOrDefaultModel)) {
					dropdown.setValue(currentOrDefaultModel);
				} else {
					dropdown.setValue(models[0]);
					this.plugin.settings.embeddingModel = models[0];
					await this.plugin.saveSettings();
				}
			} else {
				dropdown.addOption(currentOrDefaultModel, currentOrDefaultModel);
				dropdown.setValue(currentOrDefaultModel);
				this.plugin.settings.embeddingModel = currentOrDefaultModel;
				await this.plugin.saveSettings();
			}

			dropdown.selectEl.disabled = false;
		} catch (error) {
			LoggingUtility.error('Failed to load available embedding models:', error);

			dropdown.selectEl.empty();
			dropdown.addOption(currentOrDefaultModel, currentOrDefaultModel);
			dropdown.setValue(currentOrDefaultModel);
			dropdown.selectEl.disabled = false;
		}
	}

	/**
	 * Update the RAG status display after rebuilding
	 */
	private updateStatusDisplay(containerEl: HTMLElement, stats: { documentCount: number; lastUpdated: Date; sizeInBytes: number }): void {
		// Find the status setting by looking for its text content
		const settings = containerEl.querySelectorAll('.setting-item');
		for (let i = 0; i < settings.length; i++) {
			const setting = settings[i];
			const nameEl = setting.querySelector('.setting-item-name');
			if (nameEl && nameEl.textContent === 'RAG database status') {
				const descEl = setting.querySelector('.setting-item-description');
				if (descEl) {
					const detailedStatus = this.plugin.ragService.getDetailedStatus();
					descEl.textContent = `Documents indexed: ${stats.documentCount} (${detailedStatus.textStats.documentCount} text, ${detailedStatus.imageStats.documentCount} image) | Files: ${detailedStatus.totalFiles} | Last updated: ${stats.lastUpdated.toLocaleString()} | Size: ${(stats.sizeInBytes / 1024).toFixed(1)} KB | Image extractor: ${detailedStatus.imageTextExtractorAvailable ? 'available' : 'unavailable'}`;
				}
				break;
			}
		}
	}

	private parseMultilineList(value: string): string[] {
		return value
			.split('\n')
			.map(line => line.trim())
			.filter(line => line.length > 0);
	}
}
