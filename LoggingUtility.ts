import LocalLLMPlugin from './main';

export class LoggingUtility {
	private static plugin: LocalLLMPlugin | null = null;

	static initialize(plugin: LocalLLMPlugin) {
		LoggingUtility.plugin = plugin;
	}

	static log(...args: any[]) {
		// If plugin is not initialized or settings are undefined, default to logging (for early initialization/unload)
		if (!LoggingUtility.plugin || !LoggingUtility.plugin.settings || LoggingUtility.plugin.settings.enableDeveloperLogging) {
			console.log(...args);
		}
	}

	static warn(...args: any[]) {
		// If plugin is not initialized or settings are undefined, default to logging (for early initialization/unload)
		if (!LoggingUtility.plugin || !LoggingUtility.plugin.settings || LoggingUtility.plugin.settings.enableDeveloperLogging) {
			console.warn(...args);
		}
	}

	static error(...args: any[]) {
		// Always log errors regardless of developer logging setting or plugin initialization
		console.error(...args);
	}
} 