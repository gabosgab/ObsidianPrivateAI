import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, Notice } from 'obsidian';
import { ChatView } from './ChatView';
import { LoggingUtility } from './LoggingUtility';
import { SettingsManager, LocalLLMSettings } from './SettingsManager';
import './styles.css';
import manifest from './manifest.json';

export const CHAT_VIEW_TYPE = 'local-llm-chat-view';

export default class LocalLLMPlugin extends Plugin {
	async onload() {
		LoggingUtility.initialize();

		// Initialize settings manager
		SettingsManager.initialize(this);
		await SettingsManager.getInstance().loadSettings();

		// Register the view
		this.registerView(
			CHAT_VIEW_TYPE,
			(leaf) => new ChatView(leaf)
		);

		// Add ribbon icon to open chat
		this.addRibbonIcon('bot-message-square', 'Open private AI', () => {
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
		
		// Clean up singleton references to prevent memory leaks
		SettingsManager.cleanup();
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
		const settingsManager = SettingsManager.getInstance();

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
				.addOption('open-notes', 'Open tabs')
				.addOption('search', 'Search vault')
				.addOption('last-7-days', 'Last 7 days')
				.addOption('none', 'No context')
				.setValue(settingsManager.getSetting('contextMode'))
				.onChange(async (value) => {
					await settingsManager.setSetting('contextMode', value as 'open-notes' | 'search' | 'last-7-days' | 'none');
					this.plugin.notifyChatViewsOfSettingsChange();
				}));

		new Setting(containerEl)
			.setName('API endpoint')
			.setDesc('The endpoint URL for your local LLM API')
			.addText(text => text
				.setPlaceholder('http://localhost:1234/v1/chat/completions')
				.setValue(settingsManager.getSetting('apiEndpoint'))
				.onChange(async (value) => {
					await settingsManager.setSetting('apiEndpoint', value);
				}));

		addStyledSlider(
			new Setting(containerEl)
				.setName('Max tokens')
				.setDesc('Maximum number of tokens in the response'),
			{
				min: 100, max: 40000, step: 100, value: settingsManager.getSetting('maxTokens'),
				onChange: async (value) => {
					await settingsManager.setSetting('maxTokens', value);
				}
			}
		);

		addStyledSlider(
			new Setting(containerEl)
				.setName('Temperature')
				.setDesc('Controls randomness in the response (0 = deterministic, 1 = very random) 0.7 is recommended for most models'),
			{
				min: 0, max: 1, step: 0.01, value: settingsManager.getSetting('temperature'),
				onChange: async (value) => {
					await settingsManager.setSetting('temperature', value);
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
		systemPromptTextArea.value = settingsManager.getSetting('systemPrompt');
		
		systemPromptTextArea.addEventListener('input', async () => {
			await settingsManager.setSetting('systemPrompt', systemPromptTextArea.value);
		});

		new Setting(containerEl).setName('Search').setHeading();

		addStyledSlider(
			new Setting(containerEl)
				.setName('Max search results')
				.setDesc('Maximum number of notes to include as context'),
			{
				min: 1, max: 10, step: 1, value: settingsManager.getSetting('searchMaxResults'),
				onChange: async (value) => {
					await settingsManager.setSetting('searchMaxResults', value);
				}
			}
		);

		addStyledSlider(
			new Setting(containerEl)
				.setName('Context percentage from search')
				.setDesc('Percentage of max tokens to use for search context (50% = 2000 tokens if max tokens is 4000)'),
			{
				min: 10, max: 80, step: 5, value: settingsManager.getSetting('searchContextPercentage'),
				onChange: async (value) => {
					await settingsManager.setSetting('searchContextPercentage', value);
				},
				format: (v) => v + '%'
			}
		);

		addStyledSlider(
			new Setting(containerEl)
				.setName('Search relevance threshold')
				.setDesc('Minimum relevance score for notes to be included (0 = include all, 1 = very strict)'),
			{
				min: 0, max: 1, step: 0.1, value: settingsManager.getSetting('searchThreshold'),
				onChange: async (value) => {
					await settingsManager.setSetting('searchThreshold', value);
				},
				format: (v) => v.toFixed(2)
			}
		);

		new Setting(containerEl).setName('Support').setHeading();

		// Add developer logging setting
		new Setting(containerEl)
			.setName('Enable developer logging')
			.setDesc('Enable additional logging for debugging')
			.addToggle(toggle => toggle
				.setValue(settingsManager.getSetting('enableDeveloperLogging'))
				.onChange(async (value) => {
					await settingsManager.setSetting('enableDeveloperLogging', value);
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
				const { createLLMService } = await import('./LLMService');
				const settings = settingsManager.getSettings();
				const llmService = createLLMService({
					apiEndpoint: settings.apiEndpoint,
					maxTokens: settings.maxTokens,
					temperature: settings.temperature,
					systemPrompt: settings.systemPrompt
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
					testButton.setText('Test connection');
					testButton.disabled = false;
				} else {
					throw new Error(result.error || 'Unknown connection error');
				}
			} catch (error) {
				LoggingUtility.error('Connection test failed:', error);
				new Notice(`❌ Connection failed: ${error.message}`);
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
} 