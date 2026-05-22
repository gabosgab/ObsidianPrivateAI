import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ImageTextExtractor } from '../src/services/ImageTextExtractor';
import { LoggingUtility } from '../src/utils/LoggingUtility';
import { TFile } from 'obsidian';
import { LLMService } from '../src/services/LLMService';

describe('ImageTextExtractor', () => {
	let llmServiceMock: any;
	let appMock: any;
	let extractor: ImageTextExtractor;

	beforeEach(() => {
		// Reset LoggingUtility static state
		(LoggingUtility as any).pluginReady = false;
		(LoggingUtility as any).developerLoggingEnabled = false;

		llmServiceMock = {
			getAvailableModels: vi.fn().mockResolvedValue([]),
			sendVisionMessage: vi.fn()
		};

		appMock = {
			vault: {
				readBinary: vi.fn()
			}
		};

		extractor = new ImageTextExtractor(llmServiceMock as LLMService, appMock);
	});

	describe('checkVisionCapabilities', () => {
		it('should return cached capabilities if already checked', async () => {
			(extractor as any).capabilitiesChecked = true;
			(extractor as any).visionCapabilities = { supportsVision: true, description: 'cached' };

			const result = await extractor.checkVisionCapabilities();
			expect(result).toEqual({ supportsVision: true, description: 'cached' });
			expect(llmServiceMock.getAvailableModels).not.toHaveBeenCalled();
			expect(llmServiceMock.sendVisionMessage).not.toHaveBeenCalled();
		});

		it('should verify vision capabilities if test passes', async () => {
			llmServiceMock.sendVisionMessage.mockResolvedValue('I can see a yellow smiley face.');

			const result = await extractor.checkVisionCapabilities();

			expect(result.supportsVision).toBe(true);
			expect(result.description).toBe('Vision capability confirmed through test');
			expect(llmServiceMock.getAvailableModels).toHaveBeenCalled();
			expect(llmServiceMock.sendVisionMessage).toHaveBeenCalled();

			// Verify it caches
			const result2 = await extractor.checkVisionCapabilities();
			expect(result2).toBe(result);
			expect(llmServiceMock.sendVisionMessage).toHaveBeenCalledTimes(1);
		});

		it('should return false if model responds with "cannot see"', async () => {
			llmServiceMock.sendVisionMessage.mockResolvedValue('I cannot see any image.');

			const result = await extractor.checkVisionCapabilities();

			expect(result.supportsVision).toBe(false);
			expect(result.description).toBe('Vision capability test failed');
		});

		it('should handle errors during vision capability test gracefully', async () => {
			llmServiceMock.sendVisionMessage.mockRejectedValue(new Error('API Error'));

			const result = await extractor.checkVisionCapabilities();

			expect(result.supportsVision).toBe(false);
			expect(result.description).toBe('Vision capability test failed with error');
		});

		it('should handle errors in the outer check process', async () => {
			llmServiceMock.getAvailableModels.mockRejectedValue(new Error('Network error'));

			const result = await extractor.checkVisionCapabilities();

			expect(result.supportsVision).toBe(false);
			expect(result.description).toBe('Error checking capabilities');
		});
	});

	describe('extractTextFromImage', () => {
		let imageFileMock: TFile;

		beforeEach(() => {
			imageFileMock = { extension: 'png' } as TFile;
		});

		it('should successfully extract text from an image', async () => {
			// Mock readBinary to return an ArrayBuffer with some dummy data
			const buffer = new Uint8Array([104, 101, 108, 108, 111]).buffer; // "hello"
			appMock.vault.readBinary.mockResolvedValue(buffer);
			llmServiceMock.sendVisionMessage.mockResolvedValue('Extracted text line 1\nExtracted text line 2');

			const result = await extractor.extractTextFromImage(imageFileMock);

			expect(result.success).toBe(true);
			expect(result.extractedText).toBe('Extracted text line 1\nExtracted text line 2');
			expect(appMock.vault.readBinary).toHaveBeenCalledWith(imageFileMock);
			expect(llmServiceMock.sendVisionMessage).toHaveBeenCalledWith(
				expect.stringContaining('extract all the text content'),
				'data:image/png;base64,aGVsbG8='
			);
		});

		it('should return no text found when LLM indicates no text was found', async () => {
			const buffer = new ArrayBuffer(0);
			appMock.vault.readBinary.mockResolvedValue(buffer);
			llmServiceMock.sendVisionMessage.mockResolvedValue('No text found in image.');

			const result = await extractor.extractTextFromImage(imageFileMock);

			expect(result.success).toBe(false);
			expect(result.extractedText).toBe('');
			expect(result.error).toBe('No text could be extracted from the image');
		});

		it('should handle readImageAsBase64 errors', async () => {
			appMock.vault.readBinary.mockRejectedValue(new Error('File not found'));

			const result = await extractor.extractTextFromImage(imageFileMock);

			expect(result.success).toBe(false);
			expect(result.extractedText).toBe('');
			expect(result.error).toContain('Extraction failed: Failed to read image file: File not found');
		});

		it('should handle LLM service errors during extraction', async () => {
			const buffer = new ArrayBuffer(0);
			appMock.vault.readBinary.mockResolvedValue(buffer);
			llmServiceMock.sendVisionMessage.mockRejectedValue(new Error('LLM Error'));

			const result = await extractor.extractTextFromImage(imageFileMock);

			expect(result.success).toBe(false);
			expect(result.extractedText).toBe('');
			expect(result.error).toBe('Extraction failed: LLM Error');
		});

		it('should correctly determine mime types for different extensions', async () => {
			const buffer = new ArrayBuffer(0);
			appMock.vault.readBinary.mockResolvedValue(buffer);
			llmServiceMock.sendVisionMessage.mockResolvedValue('text');

			const extensions = [
				{ ext: 'jpg', mime: 'image/jpeg' },
				{ ext: 'jpeg', mime: 'image/jpeg' },
				{ ext: 'gif', mime: 'image/gif' },
				{ ext: 'webp', mime: 'image/webp' },
				{ ext: 'svg', mime: 'image/svg+xml' },
				{ ext: 'bmp', mime: 'image/bmp' },
				{ ext: 'tiff', mime: 'image/tiff' },
				{ ext: 'tif', mime: 'image/tiff' },
				{ ext: 'unknown', mime: 'image/png' } // default
			];

			for (const { ext, mime } of extensions) {
				const file = { extension: ext } as TFile;
				await extractor.extractTextFromImage(file);
				expect(llmServiceMock.sendVisionMessage).toHaveBeenCalledWith(
					expect.any(String),
					`data:${mime};base64,`
				);
			}
		});
	});

	describe('isImageFile', () => {
		it('should identify valid image files', () => {
			const validExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'tif'];

			for (const ext of validExtensions) {
				expect(ImageTextExtractor.isImageFile({ extension: ext } as TFile)).toBe(true);
				expect(ImageTextExtractor.isImageFile({ extension: ext.toUpperCase() } as TFile)).toBe(true);
			}
		});

		it('should return false for non-image files', () => {
			const invalidExtensions = ['txt', 'md', 'pdf', 'csv'];

			for (const ext of invalidExtensions) {
				expect(ImageTextExtractor.isImageFile({ extension: ext } as TFile)).toBe(false);
			}
		});
	});
});
