import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoggingUtility } from '../../src/utils/LoggingUtility';

describe('LoggingUtility', () => {
	beforeEach(() => {
		// Reset static state
		(LoggingUtility as any).pluginReady = false;
		(LoggingUtility as any).developerLoggingEnabled = false;
		vi.restoreAllMocks();
	});

	describe('initialize', () => {
		it('should set pluginReady to true', () => {
			LoggingUtility.initialize();
			expect((LoggingUtility as any).pluginReady).toBe(true);
		});
	});

	describe('setDeveloperLoggingEnabled', () => {
		it('should set developerLoggingEnabled', () => {
			LoggingUtility.setDeveloperLoggingEnabled(true);
			expect((LoggingUtility as any).developerLoggingEnabled).toBe(true);
			LoggingUtility.setDeveloperLoggingEnabled(false);
			expect((LoggingUtility as any).developerLoggingEnabled).toBe(false);
		});
	});

	describe('log', () => {
		it('should not log if plugin is not ready', () => {
			const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
			LoggingUtility.log('test message');
			expect(spy).not.toHaveBeenCalled();
		});

		it('should not log if developer logging is disabled', () => {
			LoggingUtility.initialize();
			LoggingUtility.setDeveloperLoggingEnabled(false);
			const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
			LoggingUtility.log('test message');
			expect(spy).not.toHaveBeenCalled();
		});

		it('should log if plugin is ready and developer logging is enabled', () => {
			LoggingUtility.initialize();
			LoggingUtility.setDeveloperLoggingEnabled(true);
			const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
			LoggingUtility.log('test message', { data: 123 });
			expect(spy).toHaveBeenCalledWith('test message', { data: 123 });
		});
	});

	describe('warn', () => {
		it('should not warn if plugin is not ready', () => {
			const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			LoggingUtility.warn('test warning');
			expect(spy).not.toHaveBeenCalled();
		});

		it('should not warn if developer logging is disabled', () => {
			LoggingUtility.initialize();
			LoggingUtility.setDeveloperLoggingEnabled(false);
			const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			LoggingUtility.warn('test warning');
			expect(spy).not.toHaveBeenCalled();
		});

		it('should warn if plugin is ready and developer logging is enabled', () => {
			LoggingUtility.initialize();
			LoggingUtility.setDeveloperLoggingEnabled(true);
			const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			LoggingUtility.warn('test warning', { data: 123 });
			expect(spy).toHaveBeenCalledWith('test warning', { data: 123 });
		});
	});

	describe('error', () => {
		it('should always error regardless of settings (plugin not ready)', () => {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
			LoggingUtility.error('test error');
			expect(spy).toHaveBeenCalledWith('test error');
		});

		it('should always error regardless of settings (plugin ready, logging disabled)', () => {
			LoggingUtility.initialize();
			LoggingUtility.setDeveloperLoggingEnabled(false);
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
			LoggingUtility.error('test error');
			expect(spy).toHaveBeenCalledWith('test error');
		});

		it('should always error regardless of settings (plugin ready, logging enabled)', () => {
			LoggingUtility.initialize();
			LoggingUtility.setDeveloperLoggingEnabled(true);
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
			LoggingUtility.error('test error', { data: 123 });
			expect(spy).toHaveBeenCalledWith('test error', { data: 123 });
		});
	});
});
