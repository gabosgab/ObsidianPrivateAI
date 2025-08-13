import { Plugin } from 'obsidian';
import { LoggingUtility } from './LoggingUtility';
import { ContextMode } from './main';

export interface LocalLLMSettings {
	apiEndpoint: string;
	maxTokens: number;
	temperature: number;
	// System prompt setting
	systemPrompt: string;
	// Search settings
	searchMaxResults: number;
	searchContextPercentage: number;
	searchThreshold: number;
	// Context mode setting
	contextMode: ContextMode;
	// Developer logging setting
	enableDeveloperLogging: boolean;
	// RAG settings
	enableRAG: boolean;
	ragThreshold: number;
	ragMaxResults: number;
	// Embedding settings
	embeddingEndpoint: string;
	embeddingModel: string;
}

export const DEFAULT_SETTINGS: LocalLLMSettings = {
	apiEndpoint: 'http://localhost:1234/v1/chat/completions',
	maxTokens: 10000,
	temperature: 0.7,
	// Default system prompt
	systemPrompt: '',
	// Search defaults
	searchMaxResults: 5,
	searchContextPercentage: 50,
	searchThreshold: 0.3,
	// Default context mode
	contextMode: ContextMode.OPEN_NOTES,
	// Default developer logging setting
	enableDeveloperLogging: false,
	// RAG defaults
	enableRAG: false,
	ragThreshold: 0.5,
	ragMaxResults: 5,
	// Embedding defaults
	embeddingEndpoint: 'http://localhost:1234/v1/embeddings',
	embeddingModel: 'text-embedding-ada-002'
};

export class SettingsManager {
	private static instance: SettingsManager;
	private plugin: Plugin;
	private settings: LocalLLMSettings;
	private settingsChangeCallbacks: (() => void)[] = [];

	private constructor(plugin: Plugin) {
		this.plugin = plugin;
		this.settings = { ...DEFAULT_SETTINGS };
	}

	public static initialize(plugin: Plugin): SettingsManager {
		if (!SettingsManager.instance) {
			SettingsManager.instance = new SettingsManager(plugin);
		}
		return SettingsManager.instance;
	}

	public static getInstance(): SettingsManager {
		if (!SettingsManager.instance) {
			throw new Error('SettingsManager must be initialized before use');
		}
		return SettingsManager.instance;
	}

	public async loadSettings(): Promise<void> {
		try {
			const loadedData = await this.plugin.loadData();
			this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
			LoggingUtility.log('Settings loaded:', this.settings);
		} catch (error) {
			LoggingUtility.error('Failed to load settings:', error);
			this.settings = { ...DEFAULT_SETTINGS };
		}
	}

	public async saveSettings(): Promise<void> {
		try {
			await this.plugin.saveData(this.settings);
			LoggingUtility.log('Settings saved:', this.settings);
			this.notifySettingsChange();
		} catch (error) {
			LoggingUtility.error('Failed to save settings:', error);
		}
	}

	public getSettings(): LocalLLMSettings {
		return { ...this.settings };
	}

	public getSetting<K extends keyof LocalLLMSettings>(key: K): LocalLLMSettings[K] {
		return this.settings[key];
	}

	public async setSetting<K extends keyof LocalLLMSettings>(key: K, value: LocalLLMSettings[K]): Promise<void> {
		this.settings[key] = value;
		await this.saveSettings();
	}

	public async updateSettings(updates: Partial<LocalLLMSettings>): Promise<void> {
		Object.assign(this.settings, updates);
		await this.saveSettings();
	}

	public onSettingsChange(callback: () => void): void {
		this.settingsChangeCallbacks.push(callback);
	}

	public removeSettingsChangeCallback(callback: () => void): void {
		const index = this.settingsChangeCallbacks.indexOf(callback);
		if (index !== -1) {
			this.settingsChangeCallbacks.splice(index, 1);
		}
	}

	private notifySettingsChange(): void {
		this.settingsChangeCallbacks.forEach(callback => {
			try {
				callback();
			} catch (error) {
				LoggingUtility.error('Error in settings change callback:', error);
			}
		});
	}

	public static async cleanup(): Promise<void> {
		if (SettingsManager.instance) {
			SettingsManager.instance.settingsChangeCallbacks = [];
			SettingsManager.instance = undefined as any;
		}
	}
} 