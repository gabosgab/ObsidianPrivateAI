import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, Notice } from 'obsidian';
import { ChatView } from './ChatView';
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
}

const DEFAULT_SETTINGS: LocalLLMSettings = {
	apiEndpoint: 'http://localhost:1234/v1/chat/completions',
	maxTokens: 4000,
	temperature: 0.7,
	// Search defaults
	searchMaxResults: 5,
	searchContextPercentage: 50,
	searchThreshold: 0.3
};

export default class LocalLLMPlugin extends Plugin {
	settings: LocalLLMSettings;

	async onload() {
		console.log('Loading Local LLM Chat plugin');

		await this.loadSettings();

		// Register the view
		this.registerView(
			CHAT_VIEW_TYPE,
			(leaf) => new ChatView(leaf, this)
		);

		// Add ribbon icon to open chat
		this.addRibbonIcon('message-circle', 'Open Local LLM Chat', () => {
			this.activateView();
		});

		// Add command to open chat
		this.addCommand({
			id: 'open-local-llm-chat',
			name: 'Open Local LLM Chat',
			callback: () => {
				this.activateView();
			}
		});

		// Add settings tab
		this.addSettingTab(new LocalLLMSettingTab(this.app, this));
	}

	async onunload() {
		console.log('Unloading Local LLM Chat plugin');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
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

		containerEl.createEl('h1', { text: 'Local LLM Chat Settings' });

		new Setting(containerEl)
			.setName('API Endpoint')
			.setDesc('The endpoint URL for your local LLM API')
			.addText(text => text
				.setPlaceholder('http://localhost:1234/v1/chat/completions')
				.setValue(this.plugin.settings.apiEndpoint)
				.onChange(async (value) => {
					this.plugin.settings.apiEndpoint = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Max Tokens')
			.setDesc('Maximum number of tokens in the response')
			.addSlider(slider => slider
				.setLimits(100, 40000, 100)
				.setValue(this.plugin.settings.maxTokens)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.maxTokens = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Controls randomness in the response (0 = deterministic, 1 = very random) 0.7 is recommended for most models')
			.addSlider(slider => {
				slider.setLimits(0, 1, 0.01)
				.setValue(this.plugin.settings.temperature)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.temperature = value;
					const valueLabel = document.createElement('span');
					valueLabel.style.marginLeft = '10px';
					valueLabel.style.fontWeight = 'bold';
					valueLabel.textContent = value.toFixed(2);
					slider.sliderEl.parentElement?.appendChild(valueLabel);
					await this.plugin.saveSettings();
				});
			});

		// Search settings section
		containerEl.createEl('h3', { text: 'Obsidian Search Settings' });

		new Setting(containerEl)
			.setName('Max Search Results')
			.setDesc('Maximum number of notes to include as context')
			.addSlider(slider => slider
				.setLimits(1, 10, 1)
				.setValue(this.plugin.settings.searchMaxResults)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.searchMaxResults = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Context Percentage from Search')
			.setDesc('Percentage of max tokens to use for search context (50% = 2000 tokens if max tokens is 4000)')
			.addSlider(slider => slider
				.setLimits(10, 80, 5)
				.setValue(this.plugin.settings.searchContextPercentage)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.searchContextPercentage = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Search Relevance Threshold')
			.setDesc('Minimum relevance score for notes to be included (0 = include all, 1 = very strict)')
			.addSlider(slider => slider
				.setLimits(0, 1, 0.1)
				.setValue(this.plugin.settings.searchThreshold)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.searchThreshold = value;
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
				console.error('Connection test failed:', error);
				new Notice(`❌ Connection failed: ${error.message}`);
				testButton.setText('Test Connection');
				testButton.disabled = false;
			}
		});
	}
} 