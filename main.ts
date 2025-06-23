import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, Notice } from 'obsidian';
import { ChatView } from './ChatView';
import './styles.css';

export const CHAT_VIEW_TYPE = 'local-llm-chat-view';

interface LocalLLMSettings {
	apiEndpoint: string;
	provider: 'ollama' | 'lmstudio' | 'vllm' | 'custom';
	apiKey: string;
	maxTokens: number;
	temperature: number;
	// Search settings
	enableSearch: boolean;
	searchMaxResults: number;
	searchMaxTokens: number;
	searchThreshold: number;
	useCurrentNote: boolean;
}

const DEFAULT_SETTINGS: LocalLLMSettings = {
	apiEndpoint: 'http://localhost:1234/v1/chat/completions',
	provider: 'ollama',
	apiKey: '',
	maxTokens: 1000,
	temperature: 0.7,
	// Search defaults
	enableSearch: true,
	searchMaxResults: 5,
	searchMaxTokens: 2000,
	searchThreshold: 0.3,
	useCurrentNote: false
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

		containerEl.createEl('h2', { text: 'Local LLM Chat Settings' });

		new Setting(containerEl)
			.setName('Provider')
			.setDesc('Select your local LLM provider')
			.addDropdown(dropdown => dropdown
				.addOption('ollama', 'Ollama')
				.addOption('lmstudio', 'LM Studio')
				.addOption('vllm', 'vLLM')
				.addOption('custom', 'Custom')
				.setValue(this.plugin.settings.provider)
				.onChange(async (value) => {
					this.plugin.settings.provider = value as any;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show provider-specific settings
				}));

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
			.setName('API Key (Optional)')
			.setDesc('API key if required by your LLM provider')
			.addText(text => text
				.setPlaceholder('')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Max Tokens')
			.setDesc('Maximum number of tokens in the response')
			.addSlider(slider => slider
				.setLimits(100, 4000, 100)
				.setValue(this.plugin.settings.maxTokens)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.maxTokens = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Controls randomness in the response (0 = deterministic, 1 = very random)')
			.addSlider(slider => slider
				.setLimits(0, 2, 0.1)
				.setValue(this.plugin.settings.temperature)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.temperature = value;
					await this.plugin.saveSettings();
				}));

		// Search settings section
		containerEl.createEl('h3', { text: 'Obsidian Search Settings' });

		new Setting(containerEl)
			.setName('Enable Obsidian Search')
			.setDesc('Search your Obsidian vault for relevant information to include in responses')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableSearch)
				.onChange(async (value) => {
					this.plugin.settings.enableSearch = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Use Current Note as Context')
			.setDesc('When enabled, uses the currently focused note as context instead of searching the entire vault')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useCurrentNote)
				.onChange(async (value) => {
					this.plugin.settings.useCurrentNote = value;
					await this.plugin.saveSettings();
				}));

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
			.setName('Max Context Tokens')
			.setDesc('Maximum tokens to include from search results')
			.addSlider(slider => slider
				.setLimits(500, 4000, 100)
				.setValue(this.plugin.settings.searchMaxTokens)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.searchMaxTokens = value;
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

		// Add provider-specific help text
		const helpEl = containerEl.createEl('div', { cls: 'setting-item-description' });
		helpEl.innerHTML = this.getProviderHelpText(this.plugin.settings.provider);

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
				const llmService = createLLMService(this.plugin.settings.provider, {
					apiEndpoint: this.plugin.settings.apiEndpoint,
					apiKey: this.plugin.settings.apiKey,
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

	private getProviderHelpText(provider: string): string {
		switch (provider) {
			case 'ollama':
				return '<strong>Ollama Setup:</strong><br>1. Install Ollama from <a href="https://ollama.ai">ollama.ai</a><br>2. Run <code>ollama serve</code><br>3. Pull a model: <code>ollama pull llama2</code>';
			case 'lmstudio':
				return '<strong>LM Studio Setup:</strong><br>1. Download LM Studio from <a href="https://lmstudio.ai">lmstudio.ai</a><br>2. Load a model<br>3. Start the local server in the app';
			case 'vllm':
				return '<strong>vLLM Setup:</strong><br>1. Install vLLM: <code>pip install vllm</code><br>2. Start server: <code>python -m vllm.entrypoints.openai.api_server --model meta-llama/Llama-2-7b-chat-hf</code>';
			default:
				return '<strong>Custom Setup:</strong><br>Configure your own LLM endpoint that follows the OpenAI API format.';
		}
	}
} 