import { TFile, Notice } from 'obsidian';
import { LLMService } from './LLMService';
import { LoggingUtility } from './LoggingUtility';

export interface ImageTextExtractionResult {
	success: boolean;
	extractedText: string;
	error?: string;
	modelCapabilities?: {
		supportsVision: boolean;
		modelName?: string;
	};
}

export interface VisionModelCapabilities {
	supportsVision: boolean;
	modelName?: string;
	description?: string;
}

export class ImageTextExtractor {
	private llmService: LLMService;
	private app: any; // App instance for file operations
	private visionCapabilities: VisionModelCapabilities | null = null;
	private capabilitiesChecked: boolean = false;

	constructor(llmService: LLMService, app: any) {
		this.llmService = llmService;
		this.app = app;
	}

	/**
	 * Check if the current LLM model supports vision capabilities
	 */
	async checkVisionCapabilities(): Promise<VisionModelCapabilities> {
		if (this.capabilitiesChecked && this.visionCapabilities) {
			return this.visionCapabilities;
		}

		try {
			LoggingUtility.log('Checking vision capabilities of LLM model...');
			
			// Try to get available models first
			const availableModels = await this.llmService.getAvailableModels();
			
            // Try a simple vision test with a minimal prompt
            const testResult = await this.testVisionCapability();
            this.visionCapabilities = testResult;

			this.capabilitiesChecked = true;
			LoggingUtility.log('Vision capabilities check result:', this.visionCapabilities);
			
			return this.visionCapabilities;
		} catch (error) {
			LoggingUtility.warn('Error checking vision capabilities:', error);
			this.visionCapabilities = {
				supportsVision: false,
				description: 'Error checking capabilities'
			};
			this.capabilitiesChecked = true;
			return this.visionCapabilities;
		}
	}

	/**
	 * Test vision capability by sending a simple vision prompt
	 */
	private async testVisionCapability(): Promise<VisionModelCapabilities> {
		try {
			// Create a simple test prompt that would require vision
			const testPrompt = `Please analyze this image and describe what you see. If you cannot see any image or if your model doesn't support vision, please respond with "I cannot see any image" or "This model does not support vision capabilities."`;

            // Yellow smiley face
			const testImage = 'data:image/jpeg;base64,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';

            // Try to send the message - if it fails or gives a specific response, we know the capabilities
			const response = await this.llmService.sendVisionMessage(testPrompt, testImage);
			
			// Check if the response indicates vision capability
			const visionIndicators = ['cannot see', 'does not support vision', 'no image', 'no picture'];
			const hasVision = !visionIndicators.some(indicator => 
				response.toLowerCase().includes(indicator.toLowerCase())
			);
			
			return {
				supportsVision: hasVision,
				description: hasVision ? 'Vision capability confirmed through test' : 'Vision capability test failed'
			};
		} catch (error) {
			LoggingUtility.warn('Vision capability test failed:', error);
			return {
				supportsVision: false,
				description: 'Vision capability test failed with error'
			};
		}
	}

	/**
	 * Extract text from an image file
	 */
	async extractTextFromImage(imageFile: TFile): Promise<ImageTextExtractionResult> {
		try {
			// Check vision capabilities first
			const capabilities = await this.checkVisionCapabilities();
			
			if (!capabilities.supportsVision) {
				return {
					success: false,
					extractedText: '',
					error: 'LLM model does not support vision capabilities',
					modelCapabilities: capabilities
				};
			}

			// Read the image file as base64
			const imageData = await this.readImageAsBase64(imageFile);
			
			// Create a vision prompt for text extraction
			const visionPrompt = `Please extract all the text content from this image. Return only the extracted text, formatted clearly and preserving the structure. If there are multiple text elements, separate them with line breaks. If no text is found, respond with "No text found in image."`;
			
			// Send vision message with image and prompt
			const response = await this.llmService.sendVisionMessage(visionPrompt, imageData);
			
			// Check if the response indicates no text was found
			if (response.toLowerCase().includes('no text found') || response.toLowerCase().includes('cannot see')) {
				return {
					success: false,
					extractedText: '',
					error: 'No text could be extracted from the image',
					modelCapabilities: capabilities
				};
			}

			return {
				success: true,
				extractedText: response.trim(),
				modelCapabilities: capabilities
			};

		} catch (error) {
			LoggingUtility.error('Error extracting text from image:', error);
			return {
				success: false,
				extractedText: '',
				error: `Extraction failed: ${error.message}`,
				modelCapabilities: this.visionCapabilities || { supportsVision: false }
			};
		}
	}

	/**
	 * Read image file as base64 string
	 */
	private async readImageAsBase64(imageFile: TFile): Promise<string> {
		try {
			// Read the file as an ArrayBuffer
			const arrayBuffer = await this.app.vault.readBinary(imageFile);
			
			// Convert to base64
			const bytes = new Uint8Array(arrayBuffer);
			let binary = '';
			for (let i = 0; i < bytes.byteLength; i++) {
				binary += String.fromCharCode(bytes[i]);
			}
			
			const base64 = btoa(binary);
			const mimeType = this.getMimeType(imageFile.extension);
			
			return `data:${mimeType};base64,${base64}`;
		} catch (error) {
			LoggingUtility.error('Error reading image file as base64:', error);
			throw new Error(`Failed to read image file: ${error.message}`);
		}
	}

	/**
	 * Get MIME type for image extension
	 */
	private getMimeType(extension: string): string {
		const mimeTypes: Record<string, string> = {
			'png': 'image/png',
			'jpg': 'image/jpeg',
			'jpeg': 'image/jpeg',
			'gif': 'image/gif',
			'webp': 'image/webp',
			'svg': 'image/svg+xml',
			'bmp': 'image/bmp',
			'tiff': 'image/tiff',
			'tif': 'image/tiff'
		};
		
		return mimeTypes[extension.toLowerCase()] || 'image/png';
	}

	/**
	 * Check if a file is an image
	 */
	static isImageFile(file: TFile): boolean {
		const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'tif'];
		return imageExtensions.includes(file.extension.toLowerCase());
	}


}
