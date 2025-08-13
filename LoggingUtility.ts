import LocalLLMPlugin from './main';

export class LoggingUtility {
	private static pluginReady: boolean = false;
	private static developerLoggingEnabled: boolean = false;

	static initialize() {
		LoggingUtility.pluginReady = true;
	}

	static setDeveloperLoggingEnabled(enabled: boolean) {
		LoggingUtility.developerLoggingEnabled = enabled;
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

		return LoggingUtility.developerLoggingEnabled;
	}
} 