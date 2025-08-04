import LocalLLMPlugin from './main';
import { SettingsManager } from './SettingsManager';

export class LoggingUtility {
	private static pluginReady: boolean = false;

	static initialize() {
		LoggingUtility.pluginReady = true;
	}

	static log(...args: any[]) {
		// If plugin is not initialized, default to logging (for early initialization/unload)
		// Or if settings are not yet loaded, or if developer logging is enabled
		if (LoggingUtility.isDeveloperLoggingEnabled()) {
			console.log(...args);
		}
	}

	static warn(...args: any[]) {
		// If plugin is not initialized, default to logging (for early initialization/unload)
		// Or if settings are not yet loaded, or if developer logging is enabled
		if (LoggingUtility.isDeveloperLoggingEnabled()) {
			console.warn(...args);
		}
	}

	static error(...args: any[]) {
		// Always log errors regardless of developer logging setting or plugin initialization
		console.error(...args);
	}

	private static isDeveloperLoggingEnabled(): boolean {
		if (!LoggingUtility.pluginReady) {
			return false;
		}

		try {
			// Try to get the settings from SettingsManager
			const settingsManager = SettingsManager.getInstance();
			return settingsManager.getSetting('enableDeveloperLogging');
		} catch (error) {
			// If SettingsManager is not initialized yet
			return false;
		}
	}
} 