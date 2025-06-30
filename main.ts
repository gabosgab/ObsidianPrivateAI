import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, Notice } from 'obsidian';
import { ChatView } from './ChatView';
import { LoggingUtility } from './LoggingUtility';
import './styles.css';

export const CHAT_VIEW_TYPE = 'local-llm-chat-view';

interface LocalLLMSettings {
	apiEndpoint: string;
	maxTokens: number;
	temperature: number;
	// Search settings
	searchMaxResults: number;
	searchContextPercentage: number;
	searchThreshold: number;
	// Context mode setting
	contextMode: 'open-notes' | 'search' | 'none';
	// Developer logging setting
	enableDeveloperLogging: boolean;
}

const DEFAULT_SETTINGS: LocalLLMSettings = {
	apiEndpoint: 'http://localhost:1234/v1/chat/completions',
	maxTokens: 10000,
	temperature: 0.7,
	// Search defaults
	searchMaxResults: 5,
	searchContextPercentage: 50,
	searchThreshold: 0.3,
	// Default context mode
	contextMode: 'open-notes',
	// Default developer logging setting
	enableDeveloperLogging: false
};

export default class LocalLLMPlugin extends Plugin {
	settings: LocalLLMSettings;

	async onload() {
		LoggingUtility.initialize(this);
		LoggingUtility.log('Loading Private AI plugin');

		await this.loadSettings();

		// Register the view
		this.registerView(
			CHAT_VIEW_TYPE,
			(leaf) => new ChatView(leaf, this)
		);

		// Add ribbon icon to open chat
		this.addRibbonIcon('bot-message-square', 'Open Private AI', () => {
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

		// Add settings tab
		this.addSettingTab(new LocalLLMSettingTab(this.app, this));
	}

	async onunload() {
		LoggingUtility.log('Unloading Private AI Chat plugin');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Notify all open chat views about the settings change
		this.notifyChatViewsOfSettingsChange();
	}

	notifyChatViewsOfSettingsChange() {
		// Get all open chat view leaves
		const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
		leaves.forEach(leaf => {
			const chatView = leaf.view as any;
			if (chatView && typeof chatView.updateContextModeFromSettings === 'function') {
				chatView.updateContextModeFromSettings();
			}
		});
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

		containerEl.createEl('h4', { text: 'Private AI' });

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
				.addOption('open-notes', 'Open Tabs')
				.addOption('search', 'Search Vault')
				.addOption('none', 'No Context')
				.setValue(this.plugin.settings.contextMode)
				.onChange(async (value) => {
					this.plugin.settings.contextMode = value as 'open-notes' | 'search' | 'none';
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

		containerEl.createEl('h4', { text: 'Search Settings' });

		addStyledSlider(
			new Setting(containerEl)
				.setName('Max search results')
				.setDesc('Maximum number of notes to include as context'),
			{
				min: 1, max: 10, step: 1, value: this.plugin.settings.searchMaxResults,
				onChange: async (value) => {
					this.plugin.settings.searchMaxResults = value;
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
				.setDesc('Minimum relevance score for notes to be included (0 = include all, 1 = very strict)'),
			{
				min: 0, max: 1, step: 0.1, value: this.plugin.settings.searchThreshold,
				onChange: async (value) => {
					this.plugin.settings.searchThreshold = value;
					await this.plugin.saveSettings();
				},
				format: (v) => v.toFixed(2)
			}
		);

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
			text: 'Test Connection',
			cls: 'mod-cta'
		});

		testButton.addEventListener('click', async () => {
			testButton.setText('Testing...');
			testButton.disabled = true;

			try {
				// Create a temporary LLM service to test
				const { createLLMService } = await import('./LLMService');
				const llmService = createLLMService({
					apiEndpoint: this.plugin.settings.apiEndpoint,
					maxTokens: this.plugin.settings.maxTokens,
					temperature: this.plugin.settings.temperature
				});

				// Validate config first
				const validation = llmService.validateConfig();
				if (!validation.valid) {
					throw new Error(`Configuration errors:\n${validation.errors.join('\n')}`);
				}

				// Test connection
				const result = await llmService.testConnection();
				
				if (result.success) {
					new Notice('✅ Connection successful! Your LLM server is working.');
					testButton.setText('Test Connection');
					testButton.disabled = false;
				} else {
					throw new Error(result.error || 'Unknown connection error');
				}
			} catch (error) {
				LoggingUtility.error('Connection test failed:', error);
				new Notice(`❌ Connection failed: ${error.message}`);
				testButton.setText('Test Connection');
				testButton.disabled = false;
			}
		});
	}
} 